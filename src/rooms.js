// Rooms (Migration 021) and synchronized room matches (Migration 026): chat, lobbies, player invites,
// live game state, threaded spectator comments, announcements and recorded sound effects.
// Other players are only ever shown by display name.
import { GAME_MODES } from './game-logic.js';
import { BOARD_GAME_LABELS } from './board-games.js';

const ROOM_POLL_MS = 3000, WATCH_POLL_MS = 1500, HIDDEN_POLL_MS = 15000;
export const GAME_KINDS = { quiz: 'Quiz', letters: 'Letters to Words', soundmatch: 'Sound Match', ...BOARD_GAME_LABELS };
export const QUIZ_MODES = GAME_MODES.map(([id,name])=>[id,name]);
const SYNC_KINDS = new Set(['quiz','snakes','ludo','carrom','blackjack','chess']);
export const SM_LEVELS = [['easy', 'Easy'], ['medium', 'Medium'], ['hard', 'Hard']];

/** Title for a room game from its settings, e.g. "Quiz: History, Rapid Fire". */
export function gameTitle(kind, config = {}, categories = []) {
  if (kind === 'quiz') {
    const cat = categories.find(c => c.id === config.category)?.name || 'General knowledge';
    const mode = QUIZ_MODES.find(([id]) => id === config.mode)?.[1] || 'Classic Quiz';
    return `Quiz: ${cat}, ${mode}`;
  }
  if (kind === 'soundmatch') return `Sound Match: ${SM_LEVELS.find(([id]) => id === config.level)?.[1] || 'Easy'}`;
  if (BOARD_GAME_LABELS[kind]) return BOARD_GAME_LABELS[kind];
  return 'Letters to Words';
}

/** One line of the live log a spectator reads, or null for events that are only heard (sound effects). */
export function eventText(e) {
  switch (e.kind) {
    case 'say': return `${e.name}'s game: ${e.body}`;
    case 'score': return `${e.name} score: ${e.body}`;
    case 'comment': return e.replyTo ? `${e.name} replied to ${e.replyName || 'a comment'}: ${e.body}` : `${e.name} commented: ${e.body}`;
    case 'join': return `${e.name} joined the game.`;
    case 'end': return `${e.name} finished.`;
    default: return null;
  }
}

export function createRooms({ $, announce, callApi, getSession, go, playSfx = () => {}, playMatchSound = () => {}, currentView = () => '', categories = [], startLive = () => {}, openSignIn = () => {} }) {
  let rec = null, recChunks = [], recStart = 0, recTimer = null, recStream = null, recCancelled = false;
  const seenVoices = new Set(), voiceCache = new Map();
  let roomId = null, room = null, chatAfter = null, roomTimer = null, watchId = null, watchAfter = null, watchTimer = null, watchFirst = true, lastPeople = '', pendingGameId = null, watchReplyTo = null;
  const signedIn = () => !!getSession()?.profile;
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const button = (text, onClick, cls = 'button button-quiet') => { const b = el('button', cls, text); b.type = 'button'; b.addEventListener('click', onClick); return b; };
  const say = (node, text, urgent = false) => { if (!node) return; node.textContent = text; if (text) announce(text, urgent); };
  const errorText = code => code === 'rate_limited' ? 'Too many requests. Please wait a little and try again.'
    : code === 'network' ? 'No internet connection. Please check it and try again.'
    : code === 'room_unavailable' ? 'This room is private or no longer exists.'
    : code === 'game_unavailable' ? 'This game is no longer available.'
    : code === 'game_full' ? 'This game is full. Up to six players can play together.'
    : code === 'game_finished' ? 'This game has already finished.'
    : code === 'seat_taken' ? 'That player slot has already been chosen. Please choose another.'
    : code === 'game_started' ? 'The match has already started; you can watch from the room.'
    : code === 'players_not_ready' ? 'Wait for every player to select Ready.'
    : code === 'waiting_for_players' ? 'Waiting for the other player to join.'
    : code === 'not_friends' ? 'You can only invite friends. Send a friend request first.'
    : code === 'player_unavailable' ? 'No player with that name was found.'
    : code === 'too_many_requests' ? 'You have created a lot in the last hour. Please wait a little and try again.'
    : code === 'session_expired' ? 'Your session has ended. Please sign in again.'
    : code === 'unknown_action' ? 'Rooms are still being switched on for everyone. Please try again a little later.'
    : 'Something went wrong. Please try again.';
  const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
  const pollDelay = ms => document.hidden ? HIDDEN_POLL_MS : ms;

  // ---- Rooms list (Multiplayer > Rooms) -------------------------------------------------------
  async function loadRooms() {
    const host = $('#mp-room-list'), status = $('#mp-rooms-status'); if (!host) return;
    status.textContent = 'Loading rooms…';
    try {
      const d = await callApi('rooms'); const items = d.items || [];
      host.replaceChildren(...items.map(r => {
        const li = el('li', 'room-item');
        const info = `${r.isPublic ? 'Public' : 'Private'} room, ${plural(r.games, 'game')}, ${plural(r.users, 'player')} inside${r.mine ? ', your room' : ''}`;
        const b = button(r.name, () => openRoom(r.id), 'player-button room-button');
        b.setAttribute('aria-label', `${r.name}. ${info}. Enter room`);
        b.append(el('small', '', info));
        li.append(b);
        return li;
      }));
      say(status, items.length ? `${plural(items.length, 'room')}.` : 'No rooms yet.');
    } catch (err) { say(status, errorText(err.message), true); }
  }
  async function createRoom(e) {
    e.preventDefault();
    const name = $('#room-new-name').value.trim().replace(/\s+/g, ' '), isPublic = $('#room-new-public').checked, status = $('#mp-rooms-status');
    if (name.length < 3) { say(status, 'Give your room a name of at least three letters.', true); $('#room-new-name').focus(); return; }
    try { const d = await callApi('room-create', { name, isPublic }); $('#room-new-name').value = ''; announce(`Room ${name} created.`); openRoom(d.id); }
    catch (err) { say(status, errorText(err.message), true); }
  }

  // ---- Inside a room -------------------------------------------------------------------------
  function openRoom(id, gameId = null) {
    if (!signedIn()) { openSignIn(); return; }
    pendingGameId = gameId || null;
    if (roomId !== id) { roomId = id; room = null; chatAfter = null; lastPeople = ''; $('#room-chat').replaceChildren(); seenVoices.clear(); $('#room-games').replaceChildren(); $('#room-people').replaceChildren(); $('#room-title').textContent = 'Room'; }
    if (currentView() !== 'room') go('room', { focus: '#room-title' });
    $('#room-status').textContent = 'Entering the room…';
    pollRoom(true);
  }
  function scheduleRoom() { clearTimeout(roomTimer); roomTimer = setTimeout(() => pollRoom(false), pollDelay(ROOM_POLL_MS)); }
  async function pollRoom(first) {
    clearTimeout(roomTimer);
    if (!roomId || currentView() !== 'room') return;
    try {
      const d = await callApi('room-state', { roomId, afterId: chatAfter });
      if (currentView() !== 'room' || d.room?.id !== roomId) return;
      renderRoom(d, first);
      if (pendingGameId) {
        const target = (d.games || []).find(item => item.id === pendingGameId);
        if (target) {
          pendingGameId = null;
          const me = getSession()?.profile?.name;
          const player = (target.players || []).find(p => p.name === me);
          startLive({ gameId: target.id, roomId, kind: target.kind, config: target.config || {}, title: target.title,
            joined: !!player, seat: player?.seat || 0, host: !!target.hostMe, players: target.players || [], maxPlayers: target.maxPlayers || target.config?.players || 2 });
        } else { pendingGameId = null; say($('#room-status'), 'That game invitation is no longer available.', true); }
      }
    } catch (err) {
      if (err.message === 'room_unavailable') { say($('#room-status'), errorText(err.message), true); roomId = null; return; }
      if (first) say($('#room-status'), errorText(err.message), true);
    }
    scheduleRoom();
  }
  function renderRoom(d, first) {
    room = d.room;
    $('#room-title').textContent = room.name;
    $('#room-kind').textContent = room.isPublic ? 'PUBLIC ROOM' : 'PRIVATE ROOM';
    $('#room-remove').hidden = !room.mine || room.isDefault;
    $('#room-invite-box').hidden = room.isPublic && !room.mine;
    const people = d.people || [], games = d.games || [];
    const names = people.map(p => p.name).join(', ');
    $('#room-people').replaceChildren(...people.map(p => el('li', 'room-person', `${p.name}, level ${p.level}`)));
    $('#room-people-title').textContent = `In this room (${people.length})`;
    if (first) say($('#room-status'), `You are in ${room.name}. ${plural(people.length, 'player')} here, ${plural(games.filter(g => g.status === 'playing').length, 'game')} being played.`);
    else if (lastPeople && names !== lastPeople) $('#room-status').textContent = `${plural(people.length, 'player')} here.`;
    lastPeople = names;
    renderGames(games);
    const log = $('#room-chat');
    for (const c of d.chat || []) {
      chatAfter = Math.max(chatAfter || 0, c.id);
      const li = el('li', 'room-chat-line'); li.append(el('strong', '', `${c.name}: `), document.createTextNode(c.body)); log.append(li);
      if (!first && c.name !== getSession()?.profile?.name) { announce(`${c.name} says: ${c.body}`); playSfx('notify'); }
    }
    for (const v of d.voices || []) {
      if (seenVoices.has(v.id)) continue; seenVoices.add(v.id);
      log.append(voiceLine(v));
      if (!first && v.name !== getSession()?.profile?.name) { announce(`${v.name} sent a voice message, ${Math.max(1, Math.round(v.durationMs / 1000))} seconds.`); playSfx('notify'); }
    }
    while (log.children.length > 80) log.firstElementChild.remove();
  }
  // ---- Voice messages (kept 24 hours on the server) ----------------------------------------
  function voiceLine(v) {
    const secs = Math.max(1, Math.round(v.durationMs / 1000));
    const li = el('li', 'room-chat-line room-voice'); li.append(el('strong', '', `${v.name}: `), document.createTextNode(`voice message, ${secs} second${secs === 1 ? '' : 's'}. `));
    const b = button(`Play voice message from ${v.name}`, () => playVoice(v, b), 'text-button'); li.append(b);
    return li;
  }
  async function playVoice(v, b) {
    try {
      let src = voiceCache.get(v.id);
      if (!src) { b.textContent = 'Loading…'; src = (await callApi('room-voice', { id: v.id })).audio; voiceCache.set(v.id, src); }
      const a = new Audio(src); b.textContent = 'Playing…';
      a.onended = a.onerror = () => { b.textContent = `Play voice message from ${v.name}`; };
      await a.play();
    } catch (err) { b.textContent = `Play voice message from ${v.name}`; say($('#room-voice-status'), err.message === 'room_unavailable' ? 'This voice message has expired. Voice messages are deleted after 24 hours.' : errorText(err.message), true); }
  }
  const recMime = () => { const R = globalThis.MediaRecorder; for (const m of ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/mp4', 'audio/webm']) if (R?.isTypeSupported?.(m)) return m; return ''; };
  async function toggleRecord() {
    const btn = $('#room-voice-record'), status = $('#room-voice-status');
    if (rec) { rec.stop(); return; }
    if (!roomId) return;
    if (!globalThis.MediaRecorder || !navigator.mediaDevices?.getUserMedia) { say(status, 'Voice messages cannot be recorded on this device or app version. Please update the browser or the app.', true); return; }
    try { recStream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } }); }
    catch { say(status, 'The microphone could not be used. Please allow it and try again.', true); return; }
    announce('Recording starts after this message. Press Stop and send when you finish. Up to 60 seconds.', true);
    await new Promise(r => setTimeout(r, 2600));
    const mime = recMime();
    rec = new MediaRecorder(recStream, mime ? { mimeType: mime, audioBitsPerSecond: 24000 } : { audioBitsPerSecond: 24000 });
    recChunks = []; recCancelled = false; recStart = Date.now();
    rec.ondataavailable = e => { if (e.data?.size) recChunks.push(e.data); };
    rec.onstop = () => sendRecording(mime);
    rec.start(1000);
    btn.textContent = 'Stop and send'; $('#room-voice-cancel').hidden = false; status.textContent = 'Recording…';
    recTimer = setTimeout(() => rec?.stop(), 60000);
  }
  function resetRecorder() {
    clearTimeout(recTimer); for (const t of recStream?.getTracks() || []) t.stop();
    rec = null; recStream = null; $('#room-voice-record').textContent = 'Record a voice message'; $('#room-voice-cancel').hidden = true;
  }
  async function sendRecording(mime) {
    const durationMs = Math.min(60000, Date.now() - recStart), status = $('#room-voice-status'), chunks = recChunks, cancelled = recCancelled;
    resetRecorder();
    if (cancelled) { say(status, 'Recording cancelled.'); return; }
    if (durationMs < 500 || !chunks.length) { say(status, 'That recording was too short. Please try again.', true); return; }
    const blob = new Blob(chunks, { type: (chunks[0].type || mime || 'audio/webm') });
    const type = (blob.type || 'audio/webm').replace(/\s+/g, '').toLowerCase();
    const bytes = new Uint8Array(await blob.arrayBuffer()); let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    const audio = `data:${type};base64,${btoa(bin)}`;
    if (audio.length > 400000) { say(status, 'That voice message is too long. Please record a shorter one.', true); return; }
    status.textContent = 'Sending voice message…';
    try { await callApi('room-voice-send', { roomId, audio, durationMs: Math.max(500, durationMs) }); say(status, 'Voice message sent.'); playSfx('click'); pollRoom(false); }
    catch (err) { say(status, errorText(err.message), true); }
  }
  function cancelRecording() { if (rec) { recCancelled = true; rec.stop(); } }
  function renderGames(games) {
    const host = $('#room-games');
    const focusedId = document.activeElement?.closest?.('[data-game-id]')?.dataset.gameId, focusedText = document.activeElement?.textContent;
    host.replaceChildren(...(games.length ? games.map(g => {
      const li = el('li', 'room-game'); li.dataset.gameId = g.id;
      const players = (g.players || []).map(p => `Player ${p.seat}: ${p.name}${p.ready ? ' ready' : ''}${Number(p.score) ? ` (${p.score})` : ''}`).join(' · ');
      const phase = g.phase === 'lobby' ? 'Waiting for players to get ready' : g.status === 'playing' ? 'Playing now' : 'Finished';
      const comments = Number(g.commentCount) ? ` ${plural(Number(g.commentCount), 'comment')}.` : '';
      li.append(el('strong', '', g.title), el('small', '', `${phase}. Host ${g.host}. ${players || 'No players yet.'}${comments}`));
      const row = el('div', 'room-game-actions');
      const me = getSession()?.profile?.name, mine = (g.players || []).some(p => p.name === me);
      if (g.status === 'playing' && (g.phase === 'lobby' || mine || !SYNC_KINDS.has(g.kind))) row.append(button(`${mine && g.phase === 'playing' ? 'Return to' : 'Join'} ${g.title}`, () => joinGame(g), 'button button-hot'));
      row.append(button(`Watch ${g.title}`, () => openWatch(g.id), 'button button-outline'));
      li.append(row);
      const recent = g.recentComments || [];
      if (recent.length) { const comments = el('ul', 'room-game-comments'); for (const c of recent) comments.append(el('li', 'room-game-comment', `${c.replyTo ? `↳ ${c.name} replied to ${c.replyName || 'a comment'}: ` : `${c.name}: `}${c.body}`)); li.append(comments); }
      return li;
    }) : [el('li', 'muted', 'No games yet. Create one below.')]));
    if (focusedId) [...host.querySelectorAll(`[data-game-id="${focusedId}"] button`)].find(b => b.textContent === focusedText)?.focus();
  }
  function syncGameForm() {
    const kind = $('#room-game-kind').value, count = $('#room-game-player-count');
    $('#room-game-quiz').hidden = kind !== 'quiz'; $('#room-game-sm').hidden = kind !== 'soundmatch';
    $('#room-game-player-count-wrap').hidden = !SYNC_KINDS.has(kind);
    const max = ['chess','carrom','blackjack'].includes(kind) ? 2 : kind === 'ludo' || kind === 'snakes' ? 4 : 6;
    const min = kind === 'chess' ? 2 : 1, prior = count.value || '2'; count.replaceChildren();
    if (min === 1) count.append(option('Solo play', '1'));
    for (let n = 2; n <= max; n++) count.append(option(`${n} players`, String(n)));
    count.value = Number(prior) >= min && Number(prior) <= max ? prior : '2';
  }
  async function createGame(e) {
    e.preventDefault();
    if (!roomId) return;
    const kind = $('#room-game-kind').value, players = Number($('#room-game-player-count').value || 2);
    const config = kind === 'quiz' ? { category: $('#room-game-category').value, mode: $('#room-game-mode').value, players }
      : kind === 'soundmatch' ? { level: $('#room-game-level').value, players: 2 }
      : kind === 'letters' ? { players: 2 } : { players };
    const title = gameTitle(kind, config, categories);
    try {
      const d = await callApi('game-create', { roomId, kind, title, config });
      announce(`${title} created. The match will wait until its players are ready.`);
      startLive({ gameId: d.id, roomId, kind, config, title, joined: true, host: true, seat: 1, maxPlayers: d.maxPlayers || players });
    } catch (err) { say($('#room-status'), errorText(err.message), true); }
  }
  async function joinGame(g) {
    if (SYNC_KINDS.has(g.kind)) {
      startLive({ gameId: g.id, roomId, kind: g.kind, config: g.config || {}, title: g.title,
        players: g.players || [], maxPlayers: g.maxPlayers || g.config?.players || 2,
        joined: (g.players || []).some(p => p.name === getSession()?.profile?.name),
        seat: (g.players || []).find(p => p.name === getSession()?.profile?.name)?.seat || 0, host: !!g.hostMe });
      return;
    }
    try { const d = await callApi('game-join', { gameId: g.id }); startLive({ gameId: g.id, roomId, kind: d.kind, config: d.config || {}, title: d.title }); }
    catch (err) { say($('#room-status'), errorText(err.message), true); }
  }
  async function sendChat(e) {
    e.preventDefault();
    const input = $('#room-chat-text'), text = input.value.trim();
    if (!text || !roomId) return;
    try { await callApi('room-say', { roomId, text }); input.value = ''; pollRoom(false); }
    catch (err) { say($('#room-status'), errorText(err.message), true); }
  }
  async function invite(e) {
    e.preventDefault();
    const input = $('#room-invite-name'), name = input.value.trim();
    if (name.length < 2) { say($('#room-invite-status'), 'Type a friend\'s name first.', true); return; }
    try { await callApi('room-invite', { roomId, name }); input.value = ''; say($('#room-invite-status'), `${name} was invited. They will see it in their notifications.`); }
    catch (err) { say($('#room-invite-status'), errorText(err.message), true); }
  }
  async function removeRoom() {
    if (!room?.mine) return;
    try { await callApi('room-remove', { roomId }); announce(`Room ${room.name} removed.`); roomId = null; room = null; go('home', { confirmed: true }); }
    catch (err) { say($('#room-status'), errorText(err.message), true); }
  }
  /** Called when the player leaves the room screen for good (not to watch or play in it). */
  function leaveRoom() { cancelRecording(); clearTimeout(roomTimer); if (roomId) callApi('room-leave', { roomId }).catch(() => {}); }

  // ---- Watching a game live ------------------------------------------------------------------
  function openWatch(gameId) {
    watchId = gameId; watchAfter = null; watchFirst = true; watchReplyTo = null;
    $('#watch-log').replaceChildren(); $('#watch-scores').replaceChildren(); $('#watch-title').textContent = 'Watching';
    go('watch', { focus: '#watch-title' });
    $('#watch-status').textContent = 'Connecting to the game…';
    pollWatch();
  }
  async function pollWatch() {
    clearTimeout(watchTimer);
    if (!watchId || currentView() !== 'watch') return;
    try {
      const d = await callApi('game-watch', { gameId: watchId, afterId: watchAfter });
      if (currentView() !== 'watch') return;
      renderWatch(d);
      if (d.status === 'finished' && !(d.events || []).length) { $('#watch-status').textContent = 'This game has finished.'; return; }
    } catch (err) { if (watchFirst) { say($('#watch-status'), errorText(err.message), true); return; } }
    watchTimer = setTimeout(pollWatch, pollDelay(WATCH_POLL_MS));
  }
  function renderWatch(d) {
    $('#watch-title').textContent = d.title;
    $('#watch-scores').replaceChildren(...(d.players || []).map(p => el('li', '', `${p.name}: ${p.score}${p.finished ? ', finished' : ''}`)));
    const log = $('#watch-log'), events = d.events || [];
    // Old events are shown as text only; sounds and announcements play for what happens from now on.
    const live = !watchFirst;
    let spoken = 0, sounds = 0;
    for (const e of events) {
      watchAfter = Math.max(watchAfter || 0, e.id);
      const text = eventText(e);
      if (text) {
        const line = el('li', `watch-line watch-${e.kind}${e.replyTo ? ' is-reply' : ''}`, text);
        if (e.kind === 'comment') {
          const reply = button('Reply', () => { watchReplyTo = Number(e.id); $('#watch-comment-text').value = `@${e.name} `; $('#watch-replying').textContent = `Replying to ${e.name}.`; $('#watch-reply-cancel').hidden = false; $('#watch-comment-text').focus(); }, 'text-button');
          reply.setAttribute('aria-label', `Reply to ${e.name}'s comment`); line.append(reply);
        }
        log.append(line);
      }
      if (!live) continue;
      if (e.kind === 'sfx' && sounds < 3) { sounds++; playSfx(e.body); }
      else if (e.kind === 'match' && sounds < 3) { sounds++; playMatchSound(e.body); }
      else if (e.kind === 'say' && spoken < 2) { spoken++; announce(e.body); }
      else if (e.kind === 'comment' || e.kind === 'join' || e.kind === 'end') announce(text);
    }
    while (log.children.length > 150) log.firstElementChild.remove();
    if (watchFirst) say($('#watch-status'), d.status === 'finished' ? `${d.title} has finished.` : `Watching ${d.title} live. You hear the player's game sounds and announcements with your own settings.`);
    watchFirst = false;
  }
  async function comment(e) {
    e.preventDefault();
    const input = $('#watch-comment-text'), text = input.value.trim();
    if (!text || !watchId || !roomId) return;
    try { await callApi('game-comment', { roomId, gameId: watchId, text, replyTo: watchReplyTo }); input.value = ''; watchReplyTo = null; $('#watch-replying').textContent = ''; $('#watch-reply-cancel').hidden = true; announce('Comment sent.'); pollWatch(); }
    catch (err) { say($('#watch-status'), errorText(err.message), true); }
  }

  // ---- Wiring --------------------------------------------------------------------------------
  const option = (text, value) => { const o = document.createElement('option'); o.value = value; o.textContent = text; return o; };
  function fillGameForm() {
    const cat = $('#room-game-category'); if (cat && !cat.options.length) for (const c of categories) cat.append(option(c.name, c.id));
    const mode = $('#room-game-mode'); if (mode && !mode.options.length) for (const [id, name] of QUIZ_MODES) mode.append(option(name, id));
    const lvl = $('#room-game-level'); if (lvl && !lvl.options.length) for (const [id, name] of SM_LEVELS) lvl.append(option(name, id));
  }
  fillGameForm(); syncGameForm();
  $('#room-create-form')?.addEventListener('submit', createRoom);
  $('#room-game-kind')?.addEventListener('change', syncGameForm);
  $('#room-game-form')?.addEventListener('submit', createGame);
  $('#room-chat-form')?.addEventListener('submit', sendChat);
  $('#room-invite-form')?.addEventListener('submit', invite);
  $('#room-remove')?.addEventListener('click', removeRoom);
  $('#room-voice-record')?.addEventListener('click', toggleRecord);
  $('#room-voice-cancel')?.addEventListener('click', cancelRecording);
  $('#room-refresh')?.addEventListener('click', () => pollRoom(true));
  $('#watch-comment-form')?.addEventListener('submit', comment);
  $('#watch-reply-cancel')?.addEventListener('click', () => { watchReplyTo = null; $('#watch-comment-text').value = ''; $('#watch-replying').textContent = ''; $('#watch-reply-cancel').hidden = true; });
  $('#watch-back')?.addEventListener('click', () => roomId ? openRoom(roomId) : go('multiplayer'));
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { if (currentView() === 'room') pollRoom(false); if (currentView() === 'watch') pollWatch(); } });

  return { loadRooms, openRoom, openWatch, refreshRoom: () => pollRoom(true), leaveRoom, get roomId() { return roomId; } };
}
