// Dry run of every migration (001 onwards) in an in-memory Postgres (PGlite, WebAssembly), then behavioural
// checks of the social functions. Run in the apply workflows before anything touches the live database:
//   npm i --no-save @electric-sql/pglite@0.2 && node tests/db-migrations.mjs
import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';
import { reduceBoardGame } from '../src/board-games.js';
const db = new PGlite();
// Roles and schema that exist on Supabase. pgcrypto is not bundled with PGlite; gen_random_uuid() is built in.
await db.exec(`create role anon; create role authenticated; create role service_role; create role supabase_admin; create schema if not exists extensions;`);
const dir = new URL('../supabase/migrations/', import.meta.url);
let legacyQuizId=null,legacyProfileId=null;
for (const f of readdirSync(dir).sort()) {
  try {
    if(f==='202610090026_multiplayer_room_games.sql'){
      const profile=(await db.query(`insert into bq_profiles(display_name,name_normalized,login_id,secret_question,answer_salt,answer_hash) values ('Legacy Player','legacy player','OLD12345','q','s','h') returning id`)).rows[0];legacyProfileId=profile.id;
      legacyQuizId=(await db.query(`insert into bq_room_games(room_id,host_id,kind,title) values ('b1a1d000-0000-4000-8000-000000000001',$1,'quiz','Old unsynchronized quiz') returning id`,[profile.id])).rows[0].id;
    }
    await db.exec(readFileSync(new URL(f, dir), 'utf8').replace('create extension if not exists pgcrypto with schema extensions;', '')); console.log('PASS migration', f);
  }catch (e) { console.log('::error::Migration', f, 'failed:', e.message); process.exit(1); }
}
const q = async (s, p) => (await db.query(s, p)).rows;
if(legacyQuizId){const legacy=(await q(`select status,phase from bq_room_games where id=$1`,[legacyQuizId]))[0];if(legacy.status!=='finished'||legacy.phase!=='finished')throw new Error('Migration 026 left an unsynchronized legacy quiz active');console.log('PASS migration 026 closes legacy quizzes with no shared question state');await q(`delete from bq_profiles where id=$1`,[legacyProfileId]);}
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
// Migration 021: rooms, chat, live games, spectators, comments.
if (await j(`select to_regclass('public.bq_rooms') is not null`)) {
  const dd = await mk('Dave');
  const rooms = await j(`select bq_rooms_list($1)`, [dd]); ok(rooms.length === 3 && rooms.map(r => r.name).join() === 'Blind Quiz,Word Lovers,Sound Lounge', 'three default public rooms');
  const pub = rooms[0].id;
  const st = await j(`select bq_room_state($1,$2,null)`, [a, pub]); ok(st.ok && st.people.some(p => p.name === 'Alice'), 'entering a room shows you there');
  ok((await j(`select bq_rooms_list($1)`, [dd]))[0].users >= 1, 'room list counts users');
  ok((await j(`select bq_room_say($1,$2,null,'Hello room')`, [a, pub])).ok, 'room chat');
  ok((await j(`select bq_room_state($1,$2,null)`, [dd, pub])).chat.at(-1).body === 'Hello room', 'others read the chat');
  const priv = (await j(`select bq_room_create($1,'Alice private',false)`, [a])).id;
  ok((await j(`select bq_room_state($1,$2,null)`, [dd, priv])).code === 'room_unavailable', 'private room closed to others');
  ok(!(await j(`select bq_rooms_list($1)`, [dd])).some(r => r.id === priv), 'private room hidden from others');
  ok((await j(`select bq_room_invite($1,$2,'dave')`, [a, priv])).code === 'not_friends', 'invites only for friends');
  ok((await j(`select bq_room_invite($1,$2,'bob')`, [a, priv])).ok && (await j(`select bq_room_state($1,$2,null)`, [b, priv])).ok, 'invited friend can enter');
  ok((await j(`select bq_notifications_list($1)`, [b])).some(n => n.kind === 'room_invite' && n.ref === priv), 'room invite notification');
  const g = (await j(`select bq_game_create($1,$2,'letters','Letters to Words',$3)`, [a, pub, {}])).id; ok(!!g, 'create game');
  ok((await j(`select bq_rooms_list($1)`, [dd]))[0].games === 1, 'room list counts games');
  ok((await j(`select bq_game_post($1,$2,$3)`, [dd, g, [{ k: 'say', b: 'hack' }]])).code === 'game_unavailable', 'spectators cannot post game events');
  const posted = await j(`select bq_game_post($1,$2,$3)`, [a, g, [{ k: 'sfx', b: 'correct' }, { k: 'say', b: 'Correct! The answer is B: 1857.' }, { k: 'score', b: '1' }, { k: 'sfx', b: 'bad slot!' }, { k: 'evil', b: 'x' }]]);
  ok(posted.stored === 3, 'only valid events are stored');
  const w = await j(`select bq_game_watch($1,$2,null)`, [dd, g]); ok(w.ok && w.events.map(e => e.kind).join() === 'sfx,say,score' && w.players[0].score === 1, 'spectator sees sounds, announcements and score');
  ok((await j(`select bq_game_join($1,$2)`, [dd, g])).kind === 'letters', 'join a game');
  ok((await j(`select bq_room_say($1,$2,$3,'Nice one!')`, [dd, pub, g])).ok && (await j(`select bq_game_watch($1,$2,$3)`, [b, g, w.events.at(-1).id])).events.some(e => e.kind === 'comment' && e.body === 'Nice one!'), 'comments on a game');
  await q(`select bq_game_post($1,$2,$3)`, [a, g, [{ k: 'end', b: '' }]]);
  ok((await j(`select bq_game_watch($1,$2,null)`, [dd, g])).status === 'finished' && (await j(`select bq_game_post($1,$2,$3)`, [dd, g, [{ k: 'say', b: 'late' }]])).code === 'game_finished', 'host ending finishes the game');

  // Migration 026: numbered seats, invitations, a shared ready gate, server-scored answers and threaded comments.
  const memberGame=await j(`select bq_game_create($1,$2,'quiz','Room member invite',$3)`,[a,pub,{category:'history',mode:'classic',players:2}]);
  const memberInvite=await j(`select bq_game_invite($1,$2,'dave')`,[a,memberGame.id]);
  const memberAccepted=await j(`select bq_game_invite_respond($1,$2,true)`,[dd,memberGame.id]);
  const memberRelation=await j(`select bq_relation($1,$2)`,[a,dd]);
  ok(memberInvite.ok&&memberAccepted.ok&&memberAccepted.accepted&&memberAccepted.seat===2&&memberRelation!=='friends','an active room member who is not a friend can accept an invite into Player 2');
  const quizIds=['bq-en-0415','bq-en-0416'];
  const quizAnswers=(await q(`select correct_answer from bq_questions where id=any($1::text[]) order by id`,[quizIds])).map(row=>row.correct_answer);
  const shared = await j(`select bq_game_create($1,$2,'quiz','Shared quick decision',$3)`, [a,pub,{category:'history',mode:'quickdecision',players:2}]);
  ok(shared.ok && shared.phase==='lobby' && shared.maxPlayers===2, 'new quiz games open in a ready-up lobby');
  ok((await j(`select bq_game_ready($1,$2,true)`,[a,shared.id])).ok, 'host can ready up');
  ok((await j(`select bq_game_start($1,$2,$3)`,[a,shared.id,{questionIds:['bq-en-0415'],answerKeys:['The answer']}])).code==='waiting_for_players','lobby cannot start before all player seats join');
  const waitingState=await j(`select bq_game_state($1,$2,null)`,[a,shared.id]);
  ok(waitingState.phase==='lobby'&&!waitingState.state.questionIds,'lobby players receive no question data before the shared start');
  const invite=await j(`select bq_game_invite($1,$2,'bob')`,[a,shared.id]);
  ok(invite.ok && (await j(`select bq_notifications_list($1)`,[b])).some(n=>n.kind==='game_invite'&&n.ref===shared.id&&n.body.startsWith('game-invite|')), 'friend receives a room-game invitation request');
  const accepted=await j(`select bq_game_invite_respond($1,$2,true)`,[b,shared.id]);
  ok(accepted.ok&&accepted.accepted&&accepted.roomId===pub&&accepted.seat===2,'accepting the request joins the same numbered game slot');
  ok((await j(`select bq_game_ready($1,$2,true)`,[b,shared.id])).ok,'invited player can ready up');
  await j(`select bq_game_ready($1,$2,false)`,[b,shared.id]);
  const notReady=await j(`select bq_game_start($1,$2,$3)`,[a,shared.id,{questionIds:['bq-en-0415'],answerKeys:['The answer']}]);
  ok(notReady.code==='players_not_ready','every player must ready before the shared start');
  await j(`select bq_game_ready($1,$2,true)`,[b,shared.id]);
  ok((await j(`select bq_game_start($1,$2,$3)`,[a,shared.id,{questionIds:quizIds,answerKeys:['host supplied lie','host supplied lie']}])).ok,'host starts one shared ordered question set');
  const sharedState=await j(`select bq_game_state($1,$2,null)`,[a,shared.id]);
  const bobSharedState=await j(`select bq_game_state($1,$2,null)`,[b,shared.id]);
  const privateKeys=await j(`select state->'answerKeys' from bq_room_games where id=$1`,[shared.id]);
  ok(sharedState.ok&&bobSharedState.ok&&sharedState.phase==='playing'&&sharedState.state.currentIndex===0&&JSON.stringify(sharedState.state.questionIds)===JSON.stringify(bobSharedState.state.questionIds)&&bobSharedState.seat===2&&!bobSharedState.hostMe&&!('answerKeys' in sharedState.state)&&JSON.stringify(privateKeys)===JSON.stringify(quizAnswers),'both players receive the same question order while the database keeps its verified answer key private');
  const forgedQuizPost=await j(`select bq_game_post($1,$2,$3)`,[a,shared.id,[{k:'score',b:'999'},{k:'end',b:''}]]);
  const intactQuiz=await j(`select bq_game_state($1,$2,null)`,[a,shared.id]);
  ok(forgedQuizPost.code==='invalid_request'&&intactQuiz.phase==='playing'&&intactQuiz.players[0].score===0,'legacy event posting cannot forge shared-quiz scores, sounds, or match endings');
  const fast1=await j(`select bq_game_answer($1,$2,0,$3)`,[a,shared.id,quizAnswers[0]]);
  const fast2=await j(`select bq_game_answer($1,$2,0,$3)`,[b,shared.id,quizAnswers[0]]);
  ok(fast1.correct&&fast1.points===2&&fast2.correct&&fast2.points===1,'fastest correct response earns the bonus; another correct response still scores');
  await q(`update bq_room_games set state=jsonb_set(state,'{solvedAt}',to_jsonb(now()-interval '4 seconds'),true) where id=$1`,[shared.id]);
  const advanced=await j(`select bq_game_state($1,$2,null)`,[b,shared.id]);
  ok(advanced.state.currentIndex===1&&advanced.players.find(p=>p.name==='Alice').score===2&&advanced.players.find(p=>p.name==='Bob').score===1,'polling advances the shared question and keeps both scores synchronized');
  await j(`select bq_game_answer($1,$2,1,$3)`,[a,shared.id,quizAnswers[1]]);
  await j(`select bq_game_answer($1,$2,1,'an incorrect answer')`,[b,shared.id]);
  ok((await j(`select bq_game_watch($1,$2,null)`,[dd,shared.id])).status==='finished','shared quiz finishes for players and spectators together');
  const comment=await j(`select bq_room_comment($1,$2,$3,null,'The room can see this comment')`,[a,pub,shared.id]);
  const parent=(await j(`select bq_game_watch($1,$2,null)`,[dd,shared.id])).events.find(e=>e.kind==='comment');
  ok(comment.ok&&parent.name==='Alice','players and spectators both read a game comment');
  ok((await j(`select bq_room_comment($1,$2,$3,$4,'A visible reply')`,[b,pub,shared.id,parent.id])).ok,'a spectator can reply to the comment');
  const thread=(await j(`select bq_game_watch($1,$2,null)`,[dd,shared.id])).events.filter(e=>e.kind==='comment');
  ok(thread.length===2&&thread[1].replyTo===parent.id&&thread[1].replyName==='Alice'&&thread[1].body==='A visible reply','threaded replies stay visible to every room watcher');
  const roomGame=(await j(`select bq_room_state($1,$2,null)`,[dd,pub])).games.find(item=>item.id===shared.id);
  ok(roomGame.commentCount===2&&roomGame.recentComments.length===2&&roomGame.phase==='finished','room cards display live status and recent comments');

  const yesNoGame=await j(`select bq_game_create($1,$2,'quiz','Yes or No test',$3)`,[a,pub,{category:'history',mode:'yesno',players:1}]);
  await j(`select bq_game_ready($1,$2,true)`,[a,yesNoGame.id]);
  await j(`select bq_game_start($1,$2,$3)`,[a,yesNoGame.id,{questionIds:[quizIds[0]],answerKeys:['forged host key'],answerOptions:[['forged choice']]}]);
  const yesNoState=await j(`select bq_game_state($1,$2,null)`,[a,yesNoGame.id]);
  const yesNoKey=await j(`select state->'answerKeys' from bq_room_games where id=$1`,[yesNoGame.id]);
  const yesNoOptions=await j(`select answers from bq_questions where id=$1`,[quizIds[0]]);
  const yesNoChoice=yesNoState.state.yesNoCandidates[0],yesNoAnswer=yesNoChoice===quizAnswers[0]?'Yes':'No';
  const yesNoScored=await j(`select bq_game_answer($1,$2,0,$3)`,[a,yesNoGame.id,yesNoAnswer]);
  ok(yesNoKey[0]===quizAnswers[0]&&yesNoState.state.yesNoCandidates.length===1&&yesNoOptions.includes(yesNoChoice)&&!('answerKeys' in yesNoState.state)&&yesNoScored.correct&&yesNoScored.finished,'Yes or No uses a server-selected database answer choice and scores Yes/No against the private key');
  const fallbackId='bq-en-1417',fallbackQuestion=(await q(`select correct_answer,answers from bq_questions where id=$1`,[fallbackId]))[0];
  await q(`delete from bq_questions where id=$1`,[fallbackId]);
  const fallbackYesNo=await j(`select bq_game_create($1,$2,'quiz','Fallback Yes or No',$3)`,[a,pub,{category:'general',mode:'yesno',players:1}]);
  await j(`select bq_game_ready($1,$2,true)`,[a,fallbackYesNo.id]);
  await j(`select bq_game_start($1,$2,$3)`,[a,fallbackYesNo.id,{questionIds:[fallbackId],answerKeys:[fallbackQuestion.correct_answer],answerOptions:[fallbackQuestion.answers]}]);
  const fallbackState=await j(`select bq_game_state($1,$2,null)`,[a,fallbackYesNo.id]);
  const fallbackCandidate=fallbackState.state.yesNoCandidates[0],fallbackAnswer=fallbackCandidate===fallbackQuestion.correct_answer?'Yes':'No';
  const fallbackScored=await j(`select bq_game_answer($1,$2,0,$3)`,[a,fallbackYesNo.id,fallbackAnswer]);
  ok(fallbackState.ok&&fallbackScored.correct&&fallbackScored.finished,'Yes or No remains playable from verified-range source content while Migration 025 is unapplied');

  const board=await j(`select bq_game_create($1,$2,'snakes','Snakes test',$3)`,[a,pub,{players:1}]);
  ok(board.ok&&board.phase==='lobby'&&board.maxPlayers===1,'board games support a solo room lobby');
  await j(`select bq_game_ready($1,$2,true)`,[a,board.id]);
  const boardState={kind:'snakes',players:[{seat:1,score:0,position:0}],turnSeat:1,lastRoll:null,winner:null};
  await j(`select bq_game_start($1,$2,$3)`,[a,board.id,boardState]);
  const forgedBoardPost=await j(`select bq_game_post($1,$2,$3)`,[a,board.id,[{k:'score',b:'999'},{k:'end',b:''}]]);
  const intactBoard=await j(`select bq_game_state($1,$2,null)`,[a,board.id]);
  ok(forgedBoardPost.code==='invalid_request'&&intactBoard.phase==='playing'&&intactBoard.players[0].score===0,'legacy event posting cannot forge board-game scores, sounds, or match endings');
  const boardSnapshot=await j(`select state from bq_room_games where id=$1`,[board.id]);
  const boardMove=reduceBoardGame('snakes',boardSnapshot,1,{type:'roll'},()=>.5);
  const action=await j(`select bq_game_action($1,$2,$3)`,[a,board.id,{type:'roll',expectedState:boardSnapshot,state:boardMove.state,announcement:boardMove.announcement,sfx:boardMove.sfx,sounds:boardMove.sounds,finished:boardMove.finished}]);
  ok(action.ok&&(await j(`select bq_game_watch($1,$2,null)`,[dd,board.id])).events.some(e=>e.kind==='sfx'&&e.body==='tick'),'board-game actions update shared state and publish action-timed dice/token sounds');
  const staleBoard=await j(`select bq_game_action($1,$2,$3)`,[a,board.id,{type:'roll',expectedState:boardSnapshot,state:boardSnapshot,announcement:'forged stale roll',sfx:'click',sounds:['click']}]);
  const afterStaleBoard=await j(`select state from bq_room_games where id=$1`,[board.id]);
  ok(staleBoard.code==='stale_action'&&afterStaleBoard.players[0].position===boardMove.state.players[0].position,'serialized board actions reject stale state snapshots instead of overwriting a newer move');
  const bj=await j(`select bq_game_create($1,$2,'blackjack','Blackjack test',$3)`,[a,pub,{players:1}]);await j(`select bq_game_ready($1,$2,true)`,[a,bj.id]);
  await j(`select bq_game_start($1,$2,$3)`,[a,bj.id,{kind:'blackjack'}]);
  const privateBj=await j(`select bq_game_state($1,$2,null)`,[a,bj.id]);
  ok(privateBj.ok&&!('deck' in privateBj.state)&&privateBj.state.dealer[1]==='hidden','Blackjack hides the shuffled deck and dealer hole card from players');
  const blackjackSnapshot=await j(`select state from bq_room_games where id=$1`,[bj.id]);
  const stood=await j(`select bq_game_action($1,$2,$3)`,[a,bj.id,{type:'stand',expectedState:blackjackSnapshot,state:{},announcement:'Player 1 stands.',sfx:'click',sounds:['click']}]);
  const settled=await j(`select bq_game_state($1,$2,null)`,[a,bj.id]);
  ok(stood.ok&&stood.finished&&settled.phase==='finished'&&settled.state.dealer[1]!=='hidden'&&settled.players[0].score>=-1,'Blackjack deals, resolves and records a server-owned round');
  ok((await j(`select bq_game_create($1,$2,'chess','Chess invalid players',$3)`,[a,pub,{players:3}])).code==='invalid_request','Chess rejects more than two seats');
  ok(!(await q(`select has_function_privilege('anon','public.bq_game_start(uuid,uuid,jsonb)','execute')`))[0].has_function_privilege,'new match RPCs remain service-role only');

  const m1 = await j(`select bq_match_invite($1,'bob')`, [a]), m2 = await j(`select bq_match_invite($1,'bob')`, [a]);
  ok(m1.ok && m1.roomId === m2.roomId && (await j(`select bq_room_state($1,$2,null)`, [b, m1.roomId])).ok && (await j(`select bq_match_invite($1,'carol')`, [a])).code === 'not_friends', 'match invite: friends only, one private room reused');
  ok((await j(`select bq_room_remove($1,$2)`, [dd, pub])).code === 'forbidden' && (await j(`select bq_room_remove($1,$2)`, [a, priv])).ok, 'only owners remove their own rooms; defaults stay');
}
// Migration 022: no five-room cap; 10 per hour against spam; rooms unused for 30 days are removed, default rooms never.
if (await j(`select to_regclass('public.bq_rooms') is not null`)) {
  const ee = await mk('Erin');
  const made = [];
  for (let i = 0; i < 10; i++) made.push(await j(`select bq_room_create($1,$2,true)`, [ee, `Erin room ${i}`]));
  ok(made.every(r => r.ok), 'more than five rooms per player');
  ok((await j(`select bq_room_create($1,'One too many',true)`, [ee])).code === 'too_many_requests', 'at most 10 new rooms per hour');
  await q(`update public.bq_rooms set created_at = now() - interval '40 days' where owner_id = $1 and name in ('Erin room 0','Erin room 1')`, [ee]);
  await q(`update public.bq_rooms set created_at = now() - interval '40 days' where is_default`);
  await q(`insert into public.bq_room_members (room_id, profile_id, last_seen_at) select id, $1, now() - interval '2 days' from public.bq_rooms where name = 'Erin room 1'`, [ee]);
  await q(`update public.bq_rooms set created_at = now() - interval '2 hours' where owner_id = $1 and name not in ('Erin room 0','Erin room 1')`, [ee]);
  ok((await j(`select bq_room_create($1,'Fresh room',true)`, [ee])).ok, 'creating works again after an hour');
  const left = (await q(`select name from public.bq_rooms where owner_id = $1 or is_default`, [ee])).map(r => r.name);
  ok(!left.includes('Erin room 0') && left.includes('Erin room 1') && ['Blind Quiz', 'Word Lovers', 'Sound Lounge'].every(n => left.includes(n)), 'unused rooms are removed after 30 days; used and default rooms stay');
}
// Migration 023: room voice messages (24 hours) and sealed signals for direct transfers and calls between friends.
if (await j(`select to_regclass('public.bq_signals') is not null`)) {
  const dB = '22222222-2222-4222-8222-222222222222', dC = '33333333-3333-4333-8333-333333333333';
  const [{ device_id: dA, public_key: keyA }] = await q(`select device_id, public_key from public.bq_devices where profile_id = $1 and revoked_at is null order by created_at limit 1`, [a]);
  const box = { s: 'c2FsdA==', iv: 'aXZpdml2aXZpdml2', ct: 'Y2lwaGVydGV4dA==' }, sess = '44444444-4444-4444-8444-444444444444';
  const c = (await q(`select id from public.bq_profiles where name_normalized = 'carol'`))[0].id;
  await j(`select bq_touch($1)`, [b]);
  ok((await j(`select bq_signal_send($1,'carol',$2,$3,'ring',$4)`, [a, dA, sess, { [dC]: box }])).code === 'not_friends', 'calls and transfers only between friends');
  ok((await j(`select bq_signal_send($1,'bob',$2,$3,'ring',$4)`, [a, dB, sess, { [dB]: box }])).code === 'device_unknown', 'sender must use their own device');
  ok((await j(`select bq_signal_send($1,'bob',$2,$3,'ring',$4)`, [a, dA, sess, { [dA]: box }])).code === 'keys_changed', 'signals are sealed for the friend\'s devices only');
  ok((await j(`select bq_signal_send($1,'bob',$2,$3,'ring',$4)`, [a, dA, sess, { [dB]: box }])).ok, 'ring a friend who is online');
  ok((await j(`select bq_touch($1)`, [b])).ring === 1, 'the heartbeat tells the friend a call or file is waiting');
  ok((await j(`select bq_signal_send($1,'bob',$2,$3,'signal',$4)`, [a, dA, sess, { [dB]: box }])).ok, 'connection setup signal');
  const got = await j(`select bq_signals_poll($1,$2,null)`, [b, dB]);
  ok(got.ok && got.signals.length === 2 && got.signals[0].from === 'Alice' && got.signals[0].senderKey === keyA && got.signals[0].box.ct === box.ct, 'the friend gets the sealed signals with the sender key');
  ok((await j(`select bq_signals_poll($1,$2,$3)`, [b, dB, got.signals[1].id])).signals.length === 0, 'poll after the last id');
  ok((await j(`select bq_signals_poll($1,$2,null)`, [c, dB])).code === 'device_unknown', 'nobody else can read a device\'s signals');
  await q(`update public.bq_profiles set last_seen_at = now() - interval '10 minutes' where id = $1`, [b]);
  ok((await j(`select bq_signal_send($1,'bob',$2,$3,'ring',$4)`, [a, dA, sess, { [dB]: box }])).code === 'player_offline', 'files and calls need the friend online');
  await q(`update public.bq_signals set created_at = now() - interval '20 minutes'`);
  await q(`select bq_signal_send($1,'bob',$2,$3,'signal',$4)`, [a, dA, sess, { [dB]: box }]);
  ok(Number((await q(`select count(*) n from public.bq_signals`))[0].n) === 1, 'signals are deleted after 10 minutes');
  const room = (await j(`select bq_rooms_list($1)`, [a]))[0].id;
  const voice = 'data:audio/webm;codecs=opus;base64,' + 'QUFB'.repeat(50);
  const v = await j(`select bq_room_voice_send($1,$2,$3,4200)`, [a, room, voice]); ok(v.ok, 'send a voice message to a room');
  ok((await j(`select bq_room_voice_send($1,$2,'data:text/html;base64,PHNjcmlwdD4=',4200)`, [a, room])).code === 'invalid_request', 'only audio is accepted');
  ok((await j(`select bq_room_voice_send($1,$2,$3,90000)`, [a, room, voice])).code === 'invalid_request', 'at most 60 seconds');
  const st = await j(`select bq_room_state($1,$2,null)`, [c, room]); ok(st.voices.some(x => x.id === v.id && x.name === 'Alice' && x.durationMs === 4200) && !JSON.stringify(st.voices).includes('base64'), 'room state lists voice messages without the audio');
  ok((await j(`select bq_room_voice_get($1,$2)`, [c, v.id])).audio === voice, 'anyone in a public room can play it');
  await q(`update public.bq_room_voices set created_at = now() - interval '25 hours'`);
  ok((await j(`select bq_room_voice_get($1,$2)`, [c, v.id])).code === 'room_unavailable', 'voice messages expire after 24 hours');
  await j(`select bq_room_state($1,$2,null)`, [c, room]);
  ok(Number((await q(`select count(*) n from public.bq_room_voices`))[0].n) === 0, 'expired voice messages are deleted');
}
// Migration 024: background notifications for the Android app (per-phone key, own notifications only).
{
  const h1 = 'a'.repeat(64), h2 = 'b'.repeat(64);
  ok((await j(`select bq_notify_register($1,'not-a-hash')`, [a])).code === 'invalid_request', 'phone keys must be SHA-256 hashes');
  ok((await j(`select bq_notify_register($1,$2)`, [a, h1])).ok, 'register a phone for background notifications');
  ok((await j(`select bq_notify_check($1,0,false)`, [h2])).code === 'session_expired', 'an unknown phone key reads nothing');
  await q(`update public.bq_notifications set read_at = now() where profile_id = $1`, [a]);
  await q(`update public.bq_profiles set notifications_enabled = true where id = $1`, [a]);
  await q(`insert into public.bq_notifications (profile_id, kind, actor_id) values ($1,'friend_request',$2)`, [a, b]);
  await q(`insert into public.bq_notifications (profile_id, kind, actor_id, body) values ($1,'announcement',$2,'New game: Sound Match')`, [a, g]);
  await q(`insert into public.bq_notifications (profile_id, kind, actor_id, body) values ($1,'message',$2,'secret?')`, [a, b]);
  await q(`insert into public.bq_notifications (profile_id, kind, actor_id) values ($1,'friend_request',$2)`, [b, a]);
  const c1 = await j(`select bq_notify_check($1,0,false)`, [h1]);
  ok(c1.ok && c1.enabled && c1.items.length === 3 && c1.items[0].kind === 'friend_request' && c1.items[0].actor === 'Bob', 'the phone gets the player\'s own new notifications ' + JSON.stringify(c1.items));
  ok(c1.items.some(x => x.kind === 'announcement' && x.body === 'New game: Sound Match') && c1.items.find(x => x.kind === 'message').body === '', 'announcements show their text; message notifications carry no text');
  ok(!JSON.stringify(c1).match(/login|secret_question|hash|salt/i), 'no private fields in background checks');
  ok((await j(`select bq_notify_check($1,$2,false)`, [h1, c1.latest])).items.length === 0, 'already shown notifications are not repeated');
  await q(`update public.bq_profiles set notifications_enabled = false where id = $1`, [a]);
  ok((await j(`select bq_notify_check($1,0,false)`, [h1])).items.length === 0, 'the notification switch also silences the phone');
  await q(`update public.bq_profiles set notifications_enabled = true where id = $1`, [a]);
  for (let i = 0; i < 6; i++) await q(`select bq_notify_register($1,$2)`, [a, String(i).repeat(64)]);
  ok(Number((await q(`select count(*) n from public.bq_notify_tokens where profile_id = $1`, [a]))[0].n) === 5, 'at most 5 phones per player');
  await q(`select bq_notify_register($1,$2)`, [a, h1]);
  ok((await j(`select bq_notify_check($1,0,true)`, [h1])).stopped && (await j(`select bq_notify_check($1,0,false)`, [h1])).code === 'session_expired', 'signing out on the phone removes its key');
  ok((await j(`select bq_notify_forget($1)`, [a])).ok && Number((await q(`select count(*) n from public.bq_notify_tokens where profile_id = $1`, [a]))[0].n) === 0, 'forget all phones');
}
if (failed) process.exit(1);
console.log('PASS database dry run');
