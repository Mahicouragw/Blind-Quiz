// Rooms (Migration 021) and synchronized room matches (Migration 026): chat, lobbies, player invites,
// live game state, threaded spectator comments, announcements and recorded sound effects.
// Other players are only ever shown by display name.
import { GAME_MODES, presentQuestion } from './game-logic.js';
import { BOARD_GAME_LABELS, SNAKES_AND_LADDERS } from './board-games.js';
import { createVoicePlaybackControls } from './voice-playback.js';

const ROOM_POLL_MS = 3000, WATCH_POLL_MS = 1500, HIDDEN_POLL_MS = 15000;
export const GAME_KINDS = { quiz: 'Quiz', letters: 'Letters to Words', soundmatch: 'Sound Match', ...BOARD_GAME_LABELS };
export const QUIZ_MODES = GAME_MODES.map(([id,name])=>[id,name]);
const SYNC_KINDS = new Set(['quiz','letters','soundmatch','snakes','ludo','carrom','blackjack','chess']);
const isSynchronized = g => SYNC_KINDS.has(g?.kind) && (!['letters','soundmatch'].includes(g.kind) || g.config?.roomSync === true);
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

export function createRooms({ $, announce, callApi, getSession, go, playSfx = () => {}, playMatchSound = () => {}, currentView = () => '', categories = [], questionBank = [], startLive = () => {}, openSignIn = () => {} }) {
  let rec = null, recChunks = [], recStart = 0, recStoppedAt = 0, recTimer = null, recTicker = null, recStream = null, recCancelled = false, recAutoStopped = false;
  let pendingRoomVoice = null, roomVoicePreviewUrl = '', activeRoomAudio = null;
  const seenVoices = new Set(), voiceCache = new Map();
  let roomId = null, room = null, roomPeople = [], chatAfter = null, roomTimer = null, watchId = null, watchGame = null, watchAfter = null, watchTimer = null, watchFirst = true, lastPeople = '', pendingGameId = null, watchReplyTo = null;
  const signedIn = () => !!getSession()?.profile;
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const button = (text, onClick, cls = 'button button-quiet') => { const b = el('button', cls, text); b.type = 'button'; b.addEventListener('click', onClick); return b; };
  const roomVoicePreview = $('#room-voice-preview'), roomVoiceReview = $('#room-voice-review'), roomVoicePreviewControls = $('#room-voice-preview-controls');
  const roomVoicePlayback = roomVoicePreview ? createVoicePlaybackControls(roomVoicePreview, { idPrefix: 'room-voice-preview', label: 'Room voice message preview', note: true }) : null;
  if (roomVoicePreviewControls && roomVoicePlayback) roomVoicePreviewControls.replaceChildren(roomVoicePlayback.element);
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
    : code === 'comments_disabled' ? 'Comments are turned off for this match.'
    : code === 'color_taken' ? 'That color is already chosen by another player.'
    : code === 'choose_color' ? 'Every player must choose a unique game color first.'
    : code === 'not_room_member' ? 'That player is not currently in this room.'
    : code === 'invalid_word' ? 'That word does not fit the available letters.'
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
    if (roomId !== id) { cancelRecording(); if (activeRoomAudio) { try { activeRoomAudio.pause(); } catch { /* ignore */ } activeRoomAudio = null; } roomId = id; room = null; roomPeople = []; chatAfter = null; lastPeople = ''; $('#room-chat').replaceChildren(); seenVoices.clear(); voiceCache.clear(); $('#room-games').replaceChildren(); $('#room-people').replaceChildren(); $('#room-title').textContent = 'Room'; }
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
          startLive({ gameId: target.id, roomId, kind: target.kind, config: target.config || {}, title: target.title, synchronized: isSynchronized(target), phase: target.phase,
            joined: !!player, seat: player?.seat || 0, host: !!target.hostMe, creatorMe:!!target.creatorMe, players: target.players || [], roomMembers: roomPeople, maxPlayers: target.maxPlayers || target.config?.players || 2 });
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
    const people = d.people || [], games = d.games || []; roomPeople = people;
    renderHostOptions(people);
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
  function renderHostOptions(people) {
    const select = $('#room-game-host'); if (!select) return;
    const me = getSession()?.profile?.name || '', prior = select.value || me;
    const names = [...new Set((people || []).map(p => p.name).filter(Boolean))];
    if (me && !names.includes(me)) names.unshift(me);
    select.replaceChildren(...names.map(name => option(name === me ? `${name} (you)` : name, name)));
    if (names.includes(prior)) select.value = prior; else if (names.includes(me)) select.value = me;
  }
  // ---- Voice messages (kept 24 hours on the server) ----------------------------------------
  function voiceLine(v) {
    const secs = Math.max(1, Math.round(v.durationMs / 1000));
    const li = el('li', 'room-chat-line room-voice');
    li.append(el('strong', '', `${v.name}: `), document.createTextNode(`voice message, ${secs} second${secs === 1 ? '' : 's'}. `));
    const load = button(`Load voice message from ${v.name}`, () => playVoice(v, load, audio, controls.element), 'text-button');
    const audio = el('audio', 'room-voice-player'); audio.controls = true; audio.preload = 'metadata'; audio.hidden = true;
    audio.setAttribute('aria-label', `Voice message from ${v.name}, ${secs} seconds`);
    const controls = createVoicePlaybackControls(audio, { idPrefix: `room-voice-${v.id}`, label: `Voice message from ${v.name}` });
    controls.element.hidden = true;
    audio.addEventListener('play', () => {
      if (activeRoomAudio && activeRoomAudio !== audio) { try { activeRoomAudio.pause(); } catch { /* ignore */ } }
      activeRoomAudio = audio;
    });
    audio.addEventListener('ended', () => { if (activeRoomAudio === audio) activeRoomAudio = null; });
    li.append(load, audio, controls.element);
    return li;
  }
  async function playVoice(v, load, audio, controls) {
    try {
      let src = voiceCache.get(v.id);
      if (!src) {
        load.disabled = true; load.textContent = 'Loading…';
        src = (await callApi('room-voice', { id: v.id })).audio;
        if (typeof src !== 'string' || !src.startsWith('data:audio/')) throw new Error('room_unavailable');
        voiceCache.set(v.id, src);
      }
      audio.src = src; audio.hidden = false; controls.hidden = false; audio.load();
      load.hidden = true;
      try { await audio.play(); }
      catch { say($('#room-voice-status'), 'Voice message loaded. Press Play on its audio controls to listen.'); }
    } catch (err) {
      load.disabled = false; load.hidden = false; load.textContent = `Load voice message from ${v.name}`;
      say($('#room-voice-status'), err.message === 'room_unavailable' ? 'This voice message has expired. Voice messages are deleted after 24 hours.' : errorText(err.message), true);
    }
  }
  const recMime = () => { const R = globalThis.MediaRecorder; for (const m of ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/mp4', 'audio/webm']) if (R?.isTypeSupported?.(m)) return m; return ''; };
  function stopRoomRecording(auto = false) {
    if (!rec || rec.state === 'inactive') return;
    clearTimeout(recTimer); recTimer = null; recStoppedAt = Date.now();
    recAutoStopped = auto || recStoppedAt - recStart >= 60000;
    try { rec.stop(); }
    catch { resetRecorder(); say($('#room-voice-status'), 'The recording could not be completed. Please try again.', true); }
  }
  async function toggleRecord() {
    const btn = $('#room-voice-record'), status = $('#room-voice-status');
    if (rec) { stopRoomRecording(); return; }
    if (!roomId || pendingRoomVoice || btn.disabled) return;
    const targetRoom = roomId, Recorder = globalThis.MediaRecorder;
    if (!Recorder || !navigator.mediaDevices?.getUserMedia) { say(status, 'Voice messages cannot be recorded on this device or app version. Please update the browser or the app.', true); return; }
    btn.disabled = true;
    let stream;
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } }); }
    catch { btn.disabled = false; say(status, 'The microphone could not be used. Please allow it and try again.', true); return; }
    if (targetRoom !== roomId || currentView() !== 'room') { for (const track of stream.getTracks?.() || []) { try { track.stop(); } catch { /* ignore */ } } btn.disabled = false; return; }
    const mime = recMime();
    try {
      rec = new Recorder(stream, mime ? { mimeType: mime, audioBitsPerSecond: 24000 } : { audioBitsPerSecond: 24000 });
      recChunks = []; recCancelled = false; recAutoStopped = false; recStart = Date.now(); recStoppedAt = 0; recStream = stream;
      rec.ondataavailable = e => { if (e.data?.size) recChunks.push(e.data); };
      rec.onstop = () => prepareRoomRecording(mime);
      rec.start(1000);
    } catch {
      for (const track of stream.getTracks?.() || []) { try { track.stop(); } catch { /* ignore */ } }
      rec = null; recStream = null; btn.disabled = false; say(status, 'Recording could not start. Please try again.', true); return;
    }
    btn.disabled = false; btn.textContent = 'Stop recording'; $('#room-voice-cancel').textContent = 'Cancel recording'; $('#room-voice-cancel').hidden = false;
    roomVoiceReview.hidden = true; status.textContent = 'Recording… 0 seconds. Maximum 60 seconds.';
    announce('Recording started. At 60 seconds it will stop without sending; preview it and choose Send or Discard.', true);
    recTicker = setInterval(() => { if (rec) status.textContent = `Recording… ${Math.min(60, Math.floor((Date.now() - recStart) / 1000))} seconds. Maximum 60 seconds.`; }, 1000);
    recTimer = setTimeout(() => stopRoomRecording(true), 60000);
  }
  function resetRecorder() {
    clearTimeout(recTimer); clearInterval(recTicker); recTimer = null; recTicker = null;
    for (const track of recStream?.getTracks?.() || []) { try { track.stop(); } catch { /* ignore */ } }
    rec = null; recStream = null; recChunks = []; recStart = 0; recStoppedAt = 0; recAutoStopped = false; recCancelled = false;
    const btn = $('#room-voice-record'), cancel = $('#room-voice-cancel'), send = $('#room-voice-send');
    btn.textContent = 'Record a voice message'; btn.disabled = !!pendingRoomVoice;
    cancel.hidden = true; cancel.disabled = false; cancel.textContent = 'Cancel recording';
    send.hidden = true; send.disabled = false;
  }
  function clearRoomVoiceReview(announceDiscard = false) {
    if (roomVoicePreviewUrl) { try { URL.revokeObjectURL(roomVoicePreviewUrl); } catch { /* ignore */ } roomVoicePreviewUrl = ''; }
    if (roomVoicePreview) { try { roomVoicePreview.pause(); } catch { /* ignore */ } roomVoicePreview.removeAttribute('src'); try { roomVoicePreview.load(); } catch { /* ignore */ } }
    pendingRoomVoice = null; roomVoiceReview.hidden = true;
    const cancel = $('#room-voice-cancel'), send = $('#room-voice-send'), record = $('#room-voice-record');
    cancel.hidden = true; cancel.textContent = 'Cancel recording'; cancel.disabled = false;
    send.hidden = true; send.disabled = false; record.disabled = !roomId; record.textContent = 'Record a voice message';
    if (announceDiscard) say($('#room-voice-status'), 'Recording discarded.');
  }
  function prepareRoomRecording(mime) {
    const stoppedAt = recStoppedAt || Date.now(), elapsed = Math.max(0, stoppedAt - recStart);
    const autoStopped = recAutoStopped, cancelled = recCancelled, chunks = recChunks;
    const blobType = chunks.find(chunk => chunk.type)?.type || mime || 'audio/webm';
    resetRecorder();
    if (cancelled) { say($('#room-voice-status'), 'Recording cancelled.'); return; }
    if (elapsed > 61000) { say($('#room-voice-status'), 'The recording exceeded 60 seconds, so it was not sent. Please record a shorter one.', true); return; }
    const durationMs = Math.min(60000, Math.round(elapsed));
    if (durationMs < 500 || !chunks.length) { say($('#room-voice-status'), 'That recording was too short. Please try again.', true); return; }
    const blob = new Blob(chunks, { type: blobType });
    if (blob.size < 1) { say($('#room-voice-status'), 'The recording was empty. Please try again.', true); return; }
    pendingRoomVoice = { blob, durationMs };
    roomVoicePreviewUrl = URL.createObjectURL(blob); roomVoicePreview.src = roomVoicePreviewUrl;
    roomVoiceReview.hidden = false; roomVoicePlayback?.apply();
    $('#room-voice-send').hidden = false; $('#room-voice-send').disabled = false;
    $('#room-voice-cancel').hidden = false; $('#room-voice-cancel').textContent = 'Discard recording';
    $('#room-voice-record').disabled = true;
    say($('#room-voice-status'), autoStopped
      ? 'Maximum length reached. Your recording is ready to review; it has not been sent.'
      : 'Recording stopped. Preview it, then press Send voice message or Discard recording.');
  }
  async function sendRoomRecording() {
    const pending = pendingRoomVoice, status = $('#room-voice-status'), send = $('#room-voice-send'), cancel = $('#room-voice-cancel');
    if (!pending || !roomId) return;
    send.disabled = true; cancel.disabled = true; $('#room-voice-record').disabled = true;
    status.textContent = 'Preparing your voice message…';
    try {
      const bytes = new Uint8Array(await pending.blob.arrayBuffer()); let bin = '';
      for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
      const type = String(pending.blob.type || 'audio/webm').replace(/\s+/g, '').toLowerCase();
      const audio = `data:${type};base64,${btoa(bin)}`;
      if (audio.length > 400000) {
        send.disabled = false; cancel.disabled = false; $('#room-voice-record').disabled = true;
        say(status, 'That recording is too large for a room message. It was not sent; please discard it and record a shorter one.', true); return;
      }
      status.textContent = 'Sending voice message…';
      await callApi('room-voice-send', { roomId, audio, durationMs: pending.durationMs });
      clearRoomVoiceReview(false); say(status, 'Voice message sent to the room.'); playSfx('click'); pollRoom(false);
    } catch (err) {
      send.disabled = false; cancel.disabled = false; $('#room-voice-record').disabled = true;
      say(status, errorText(err.message), true);
    }
  }
  function cancelRecording() {
    if (rec) { recCancelled = true; clearTimeout(recTimer); recTimer = null; try { rec.stop(); } catch { resetRecorder(); } return; }
    if (pendingRoomVoice) clearRoomVoiceReview(true);
  }

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
      if (g.status === 'playing' && (g.phase === 'lobby' || mine || !isSynchronized(g))) row.append(button(`${mine && g.phase === 'playing' ? 'Return to' : 'Join'} ${g.title}`, () => joinGame(g), 'button button-hot'));
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
    const min = ['chess','ludo','letters','soundmatch'].includes(kind) ? 2 : 1, prior = count.value || '2'; count.replaceChildren();
    if (min === 1) count.append(option('Solo play', '1'));
    for (let n = 2; n <= max; n++) count.append(option(`${n} players`, String(n)));
    count.value = Number(prior) >= min && Number(prior) <= max ? prior : '2';
  }
  async function createGame(e) {
    e.preventDefault();
    if (!roomId) return;
    const kind = $('#room-game-kind').value, players = Number($('#room-game-player-count').value || 2);
    const config = kind === 'quiz' ? { category: $('#room-game-category').value, mode: $('#room-game-mode').value, players }
      : kind === 'soundmatch' ? { level: $('#room-game-level').value, players }
      : kind === 'letters' ? { players } : { players };
    config.hostName = $('#room-game-host').value || getSession()?.profile?.name;
    const title = gameTitle(kind, config, categories);
    try {
      const d = await callApi('game-create', { roomId, kind, title, config });
      announce(`${title} created. ${config.hostName} is the host; the match will wait until every player is ready.`);
      pendingGameId = d.id; await pollRoom(true);
    } catch (err) { say($('#room-status'), errorText(err.message), true); }
  }
  async function joinGame(g) {
    if (isSynchronized(g)) {
      startLive({ gameId: g.id, roomId, kind: g.kind, config: g.config || {}, title: g.title, synchronized: isSynchronized(g), phase: g.phase, roomMembers: roomPeople,
        players: g.players || [], maxPlayers: g.maxPlayers || g.config?.players || 2,
        joined: (g.players || []).some(p => p.name === getSession()?.profile?.name),
        seat: (g.players || []).find(p => p.name === getSession()?.profile?.name)?.seat || 0, host: !!g.hostMe, creatorMe:!!g.creatorMe });
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
    watchId = gameId; watchGame = null; watchAfter = null; watchFirst = true; watchReplyTo = null;
    $('#watch-log').replaceChildren(); $('#watch-scores').replaceChildren(); $('#watch-title').textContent = 'Watching'; $('#watch-join-form').hidden=true;
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
  function renderWatchControls(d) {
    const players=d.players||[],me=getSession()?.profile?.name,already=players.some(p=>p.name===me),form=$('#watch-join-form');
    const canJoin=isSynchronized(d)&&d.phase==='lobby'&&!already;
    form.hidden=!canJoin;
    if(canJoin){
      const occupied=new Set(players.map(p=>Number(p.seat))),seats=$('#watch-join-seat'),max=Number(d.maxPlayers)||Number(d.config?.players)||2;
      seats.replaceChildren(...Array.from({length:max},(_,i)=>i+1).filter(seat=>!occupied.has(seat)).map(seat=>{const opt=el('option','',`Player ${seat}`);opt.value=String(seat);return opt;}));
      if(!seats.options.length)form.hidden=true;
      const colors=d.kind==='ludo'?['red','yellow','green','blue']:d.kind==='chess'?['white','black']:[],colorSelect=$('#watch-join-color');
      $('#watch-join-color-label').hidden=!colors.length;colorSelect.hidden=!colors.length;colorSelect.replaceChildren();
      if(colors.length){const placeholder=el('option','','Choose a color');placeholder.value='';colorSelect.append(placeholder);const taken=new Set(players.map(p=>p.color).filter(Boolean));for(const color of colors)if(!taken.has(color)){const opt=el('option','',color[0].toUpperCase()+color.slice(1));opt.value=color;colorSelect.append(opt);}}
    }
    const enabled=d.commentsEnabled!==false;$('#watch-comment-form').hidden=!enabled;$('#watch-comments-toggle-wrap').hidden=!(d.hostMe||d.creatorMe);$('#watch-comments-toggle').checked=enabled;
  }
  const WATCH_PIECES={K:'♔',Q:'♕',R:'♖',B:'♗',N:'♘',P:'♙',k:'♚',q:'♛',r:'♜',b:'♝',n:'♞',p:'♟'};
  const watchSeed=s=>{let h=2166136261;for(const c of String(s))h=Math.imul(h^c.charCodeAt(0),16777619);return h>>>0;};
  const watchShuffle=(items,key)=>{let a=watchSeed(key);const out=[...items],random=()=>{a+=0x6D2B79F5;let t=a;t=Math.imul(t^t>>>15,t|1);t^=t+Math.imul(t^t>>>7,t|61);return((t^t>>>14)>>>0)/4294967296;};for(let i=out.length-1;i>0;i--){const j=Math.floor(random()*(i+1));[out[i],out[j]]=[out[j],out[i]];}return out;};
  function renderWatchGame(d){
    const host=$('#watch-board'),state=d.state||{};host.replaceChildren();$('#watch-game-state').hidden=d.phase==='lobby'||!state||!Object.keys(state).length;
    if($('#watch-game-state').hidden)return;
    if(d.kind==='quiz'){
      const ids=state.questionIds||[],index=Number(state.currentIndex)||0,q=questionBank.find(item=>item.id===ids[index]);
      if(!q){host.append(el('p','muted',index>=ids.length?'The quiz is complete.':'This question is not on this app version yet. Reload the app to update it.'));return;}
      const mode=d.config?.mode||'classic',presented=presentQuestion(q,mode,items=>watchShuffle(items,`${watchId}:${index}:${mode}`),state.yesNoCandidates?.[index]??null);
      host.append(el('p','eyebrow',`Question ${index+1} of ${ids.length}`),el('h3','watch-question',presented.displayQuestion));const answers=el('ol','watch-answers');for(const answer of presented.displayAnswers)answers.append(el('li','',answer));host.append(answers);return;
    }
    if(d.kind==='letters'){
      const tiles=el('p','room-play-letters-tiles',[...(state.letters||'').toUpperCase()].join(' · '));tiles.setAttribute('aria-label','Available letters');host.append(tiles);
      const found=state.foundWords||[];if(found.length){const list=el('ol','room-play-word-list');for(const item of found)list.append(el('li','',`${String(item.word).toUpperCase()} · Player ${item.seat} · ${item.points} points`));host.append(list);}return;
    }
    if(d.kind==='soundmatch'){
      const count=Number(state.cardCount)||0,matched=new Set(state.matched||[]),visible=new Set(state.visiblePair||[]),names=state.revealedNames||{},grid=el('div','room-play-sound-grid');
      for(let n=1;n<=count;n++){const found=matched.has(n),open=visible.has(n),card=el('div',`room-play-sound-card${found?' is-matched':open?' is-open':''}`,found?`Number ${n}: ${names[String(n)]||'matched'}`:`Number ${n}${open?' · revealed':' · hidden'}`);card.setAttribute('aria-label',card.textContent);grid.append(card);}host.append(grid);return;
    }
    if(d.kind==='snakes'){
      const grid=el('div','snakes-grid watch-snakes-grid');for(let row=9;row>=0;row--)for(let col=0;col<10;col++){const offset=9-row,start=offset*10+1,num=offset%2===0?start+col:start+9-col,cell=el('div',`snake-cell${SNAKES_AND_LADDERS[num]?' has-jump':''}`);cell.append(el('span','snake-number',String(num)));if(SNAKES_AND_LADDERS[num])cell.append(el('small','snake-jump',`${SNAKES_AND_LADDERS[num]>num?'↑':'↓'} ${SNAKES_AND_LADDERS[num]}`));for(const p of state.players||[])if(p.position===num)cell.append(el('span',`game-token seat-${p.seat}`,`P${p.seat}`));grid.append(cell);}host.append(grid);return;
    }
    if(d.kind==='ludo'){
      const track=el('div','ludo-track');for(const p of state.players||[]){const card=el('section',`ludo-player color-${p.color||'default'}`),name=(d.players||[]).find(x=>Number(x.seat)===Number(p.seat))?.name;card.append(el('h3','',`Player ${p.seat}${name?`: ${name}`:''}${p.color?` · ${p.color}`:''}`));const tokens=el('div','ludo-tokens');for(let i=0;i<(p.tokens||[]).length;i++){const pos=p.tokens[i],label=pos<0?'Home':pos===57?'Finish':`Step ${pos+1}`;tokens.append(el('div','ludo-token',`Token ${i+1}: ${label}`));}card.append(tokens);track.append(card);}host.append(track);return;
    }
    if(d.kind==='carrom'){
      const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox','0 0 100 100');svg.setAttribute('role','img');svg.setAttribute('aria-label','Live Carrom board');const rect=document.createElementNS(svg.namespaceURI,'rect');rect.setAttribute('x','4');rect.setAttribute('y','4');rect.setAttribute('width','92');rect.setAttribute('height','92');rect.setAttribute('rx','7');rect.setAttribute('class','carrom-wood');svg.append(rect);for(const [x,y] of [[8,8],[92,8],[8,92],[92,92]]){const c=document.createElementNS(svg.namespaceURI,'circle');c.setAttribute('cx',String(x));c.setAttribute('cy',String(y));c.setAttribute('r','5');c.setAttribute('class','carrom-pocket');svg.append(c);}for(const coin of state.coins||[]){if(coin.pocketed)continue;const c=document.createElementNS(svg.namespaceURI,'circle');c.setAttribute('cx',String(coin.x*100));c.setAttribute('cy',String(coin.y*100));c.setAttribute('r','2.2');c.setAttribute('class',`carrom-coin seat-${coin.owner}`);svg.append(c);}host.append(svg);return;
    }
    if(d.kind==='blackjack'){
      const dealer=el('section','blackjack-hand');dealer.append(el('h3','','Dealer'),el('p','',(state.dealer||[]).map(card=>card==='hidden'?'🂠':card).join('  ')||'Waiting for the deal'));host.append(dealer);for(const player of state.players||[]){const name=(d.players||[]).find(x=>Number(x.seat)===Number(player.seat))?.name,hand=el('section','blackjack-hand');hand.append(el('h3','',`Player ${player.seat}${name?`: ${name}`:''}`),el('p','',`${(player.hand||[]).join('  ')} · ${player.stood?'Stood':player.bust?'Bust':'Playing'}`));host.append(hand);}return;
    }
    if(d.kind==='chess'){
      const grid=el('div','chess-board watch-chess-board');for(let r=0;r<8;r++)for(let c=0;c<8;c++){const piece=state.board?.[r]?.[c]||'',square=el('div',`chess-square ${(r+c)%2?'dark-square':'light-square'}`,WATCH_PIECES[piece]||'');square.setAttribute('aria-label',`${String.fromCharCode(97+c)}${8-r}${piece?`, ${piece===piece.toUpperCase()?'White':'Black'} piece`:', empty'}`);grid.append(square);}host.append(grid);return;
    }
    host.append(el('p','muted',`${d.title} is ${d.phase==='finished'?'complete':'in progress'}.`));
  }
  function renderWatch(d) {
    watchGame=d;renderWatchControls(d);renderWatchGame(d);
    $('#watch-title').textContent = d.title;
    $('#watch-scores').replaceChildren(...(d.players || []).map(p => el('li', '', `Player ${p.seat}: ${p.name}${p.color?`, ${p.color}`:''}: ${p.score}${p.finished ? ', finished' : ''}`)));
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
          reply.disabled=d.commentsEnabled===false;
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
  async function joinFromWatch(e) {
    e.preventDefault();if(!watchGame||!watchId)return;
    const seat=Number($('#watch-join-seat').value),color=$('#watch-join-color').hidden?null:$('#watch-join-color').value;
    if(watchGame.kind==='ludo'||watchGame.kind==='chess'){if(!color){say($('#watch-status'),'Choose a color before joining.',true);return;}}
    try{
      const result=await callApi('game-join',{gameId:watchId,seat,color});clearTimeout(watchTimer);
      startLive({gameId:watchId,roomId,kind:watchGame.kind,config:watchGame.config||{},title:watchGame.title,phase:watchGame.phase,synchronized:isSynchronized(watchGame),joined:true,seat:result.seat,host:!!result.host,creatorMe:!!watchGame.creatorMe,players:watchGame.players||[],roomMembers:watchGame.roomMembers||roomPeople,maxPlayers:watchGame.maxPlayers||watchGame.config?.players||2});
    }catch(err){say($('#watch-status'),errorText(err.message),true);if(['seat_taken','game_full','game_started'].includes(err.message))pollWatch();}
  }
  async function toggleWatchComments(){const checkbox=$('#watch-comments-toggle'),enabled=checkbox.checked;checkbox.disabled=true;try{await callApi('game-comments',{gameId:watchId,enabled});if(watchGame)watchGame.commentsEnabled=enabled;$('#watch-comment-form').hidden=!enabled;say($('#watch-status'),enabled?'Game comments are on.':'Game comments are off.');}catch(err){checkbox.checked=watchGame?.commentsEnabled!==false;say($('#watch-status'),errorText(err.message),true);}finally{checkbox.disabled=false;}}
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
  $('#room-voice-send')?.addEventListener('click', sendRoomRecording);
  $('#room-refresh')?.addEventListener('click', () => pollRoom(true));
  $('#watch-comment-form')?.addEventListener('submit', comment);
  $('#watch-join-form')?.addEventListener('submit',joinFromWatch);
  $('#watch-comments-toggle')?.addEventListener('change',toggleWatchComments);
  $('#watch-reply-cancel')?.addEventListener('click', () => { watchReplyTo = null; $('#watch-comment-text').value = ''; $('#watch-replying').textContent = ''; $('#watch-reply-cancel').hidden = true; });
  $('#watch-back')?.addEventListener('click', () => roomId ? openRoom(roomId) : go('multiplayer'));
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { if (currentView() === 'room') pollRoom(false); if (currentView() === 'watch') pollWatch(); } });

  return { loadRooms, openRoom, openWatch, refreshRoom: () => pollRoom(true), leaveRoom, get roomId() { return roomId; } };
}
