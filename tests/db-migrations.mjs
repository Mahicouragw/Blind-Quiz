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
if (failed) process.exit(1);
console.log('PASS database dry run');
