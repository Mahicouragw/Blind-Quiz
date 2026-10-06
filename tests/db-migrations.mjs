// Dry run of every migration (001 onwards) in an in-memory Postgres (PGlite, WebAssembly), then behavioural
// checks of the social functions. Run in the apply workflows before anything touches the live database:
//   npm i --no-save @electric-sql/pglite@0.2 && node tests/db-migrations.mjs
import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';
const db = new PGlite();
// Roles and schema that exist on Supabase. pgcrypto is not bundled with PGlite; gen_random_uuid() is built in.
await db.exec(`create role anon; create role authenticated; create role service_role; create role supabase_admin; create schema if not exists extensions;`);
const dir = new URL('../supabase/migrations/', import.meta.url);
for (const f of readdirSync(dir).sort()) {
  try { await db.exec(readFileSync(new URL(f, dir), 'utf8').replace('create extension if not exists pgcrypto with schema extensions;', '')); console.log('PASS migration', f); }
  catch (e) { console.log('::error::Migration', f, 'failed:', e.message); process.exit(1); }
}
const q = async (s, p) => (await db.query(s, p)).rows;
const mk = async n => (await q(`insert into bq_profiles(display_name,name_normalized,login_id,secret_question,answer_salt,answer_hash) values ($1,lower($1),upper(substr(md5($1),1,8)),'q','s','h') returning id`, [n]))[0].id;
let failed = 0;
const ok = (c, m) => { if (!c) { failed++; console.log('::error::FAIL', m); } else console.log('ok', m); };
const a = await mk('Alice'), b = await mk('Bob'), g = await mk('Goldfish');
await q(`insert into bq_admins(profile_id) values ($1)`, [g]);
const j = async (s, p) => Object.values((await q(s, p))[0])[0];
ok((await j(`select bq_touch($1)`, [a])).unread === 0, 'touch');
await q(`select bq_touch($1)`, [b]);
const on = await j(`select bq_online_players($1)`, [a]); ok(on.length === 1 && on[0].name === 'Bob' && on[0].relation === 'none', 'online');
const card = await j(`select bq_player_card($1,'bob')`, [a]); ok(card.ok && !JSON.stringify(card).match(/login|secret|hash|salt/i), 'card private ' + JSON.stringify(card));
ok((await j(`select bq_friend_request($1,'bob')`, [a])).relation === 'outgoing', 'request');
ok((await j(`select bq_friend_request($1,'alice')`, [a])).code === 'invalid_request', 'self request');
const nb = await j(`select bq_notifications_list($1)`, [b]); ok(nb[0].kind === 'friend_request' && nb[0].actor === 'Alice' && nb[0].relation === 'incoming', 'notif');
ok((await j(`select bq_touch($1)`, [b])).unread === 1, 'unread');
ok((await j(`select bq_friend_respond($1,'alice',true)`, [b])).relation === 'friends', 'accept');
ok((await j(`select bq_friends($1)`, [a])).friends[0].name === 'Bob', 'friends list');
ok((await j(`select bq_notifications_list($1)`, [a]))[0].kind === 'friend_accepted', 'accepted notif');
ok((await j(`select bq_notifications_read($1,null)`, [a])).unread === 0, 'read all');
ok((await j(`select bq_friend_remove($1,'bob')`, [a])).relation === 'none', 'remove');
await q(`select bq_friend_request($1,'alice')`, [b]);
ok((await j(`select bq_friend_request($1,'bob')`, [a])).relation === 'friends', 'reverse auto-accept');
await q(`insert into bq_feedback(profile_id, kind, message, name) values ($1,'problem','It breaks',  'Alice')`, [a]).catch(e => console.log('feedback insert:', e.message));
const fb = await j(`select bq_my_feedback($1)`, [a]); ok(fb[0]?.status === 'sent', 'my feedback ' + JSON.stringify(fb[0]));
ok((await j(`select bq_feedback_reply($1,$2,'Thanks')`, [a, fb[0]?.id])).code === 'forbidden', 'non-admin reply');
ok((await j(`select bq_feedback_reply($1,$2,'Thanks, fixed')`, [g, fb[0]?.id])).ok, 'admin reply');
const fb2 = await j(`select bq_my_feedback($1)`, [a]); ok(fb2[0].status === 'replied' && fb2[0].reply === 'Thanks, fixed', 'replied status');
ok((await j(`select bq_announce($1,'New game added: Sound Match')`, [g])).sent === 3, 'announce');
ok((await j(`select bq_announce($1,'Hello all')`, [a])).code === 'forbidden', 'non-admin announce');
ok((await j(`select bq_set_notifications($1,false)`, [a])).notificationsEnabled === false, 'toggle');
// Migration 020: end-to-end encrypted messages (the database only ever sees public keys and sealed boxes).
if (await j(`select to_regclass('public.bq_messages') is not null`)) {
  const c = await mk('Carol');
  const key = ch => ch.repeat(87) + '=';
  const dA = '11111111-1111-4111-8111-111111111111', dB = '22222222-2222-4222-8222-222222222222', dC = '33333333-3333-4333-8333-333333333333';
  ok((await j(`select bq_register_device($1,$2,$3)`, [a, dA, key('A')])).ok, 'register device');
  await q(`select bq_register_device($1,$2,$3)`, [b, dB, key('B')]); await q(`select bq_register_device($1,$2,$3)`, [c, dC, key('C')]);
  ok((await j(`select bq_register_device($1,$2,$3)`, [b, dA, key('A')])).code === 'invalid_request', 'cannot take over another device id');
  ok((await j(`select bq_register_device($1,$2,'not a key')`, [a, dA])).code === 'invalid_request', 'public key format checked');
  const box = { s: 'c2FsdA==', iv: 'aXZpdml2aXZpdml2', ct: 'Y2lwaGVydGV4dA==' };
  ok((await j(`select bq_message_keys($1,'carol')`, [a])).code === 'not_friends', 'keys only for friends');
  ok((await j(`select bq_send_message($1,'carol',$2,$3)`, [a, dA, { [dC]: box }])).code === 'not_friends', 'messages only between friends');
  const keys = await j(`select bq_message_keys($1,'bob')`, [a]); ok(keys.ok && keys.theirs[0].deviceId === dB && keys.mine[0].deviceId === dA, 'friend keys');
  ok((await j(`select bq_send_message($1,'bob',$2,$3)`, [a, dB, { [dB]: box }])).code === 'device_unknown', 'sender device must be your own');
  ok((await j(`select bq_send_message($1,'bob',$2,$3)`, [a, dA, { [dC]: box }])).code === 'keys_changed', 'boxes only for the two friends\' devices');
  ok((await j(`select bq_send_message($1,'bob',$2,$3)`, [a, dA, { [dA]: box }])).code === 'keys_changed', 'at least one box for the recipient');
  const sent = await j(`select bq_send_message($1,'bob',$2,$3)`, [a, dA, { [dA]: box, [dB]: box }]); ok(sent.ok && sent.id > 0, 'send sealed message');
  await q(`select bq_send_message($1,'bob',$2,$3)`, [a, dA, { [dA]: box, [dB]: box }]);
  const notes = (await j(`select bq_notifications_list($1)`, [b])).filter(n => n.kind === 'message' && !n.read); ok(notes.length === 1 && notes[0].actor === 'Alice', 'one unread message notification per sender');
  const conv = await j(`select bq_conversations($1)`, [b]); ok(conv[0].name === 'Alice' && Number(conv[0].unread) === 2, 'conversations with unread count');
  const got = await j(`select bq_messages_with($1,'alice',$2,null)`, [b, dB]); ok(got.ok && got.messages.length === 2 && got.messages[0].box.ct === box.ct && got.messages[0].senderKey === key('A') && got.messages[0].fromMe === false, 'recipient gets only its own box and the sender key');
  const mine = await j(`select bq_messages_with($1,'bob',$2,$3)`, [a, dA, got.messages[0].id]); ok(mine.messages.length === 1 && mine.messages[0].fromMe && mine.messages[0].read, 'after-id paging; read receipts');
  ok(!(await q(`select column_name from information_schema.columns where table_name='bq_messages'`)).some(r => /body|text|plain/.test(r.column_name)), 'no plaintext column');
  for (const n of [4, 5, 6, 7]) await q(`select bq_register_device($1,$2,$3)`, [a, `0000000${n}-0000-4000-8000-000000000000`, key(String(n))]);
  ok(Number((await q(`select count(*) n from bq_devices where profile_id=$1 and revoked_at is null`, [a]))[0].n) === 4, 'at most 4 active devices');
}
if (failed) process.exit(1);
console.log('PASS database dry run');
