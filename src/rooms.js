// Rooms (Migration 021): public and private rooms, room chat, games inside a room, and watching a game live.
// Players broadcast what their own game says and plays (announcements, sound effects, Sound Match sounds, score);
// spectators replay those through their own settings (speech, sound effects) and can comment.
// Other players are only ever shown by display name.

const ROOM_POLL_MS = 3000, WATCH_POLL_MS = 1500, HIDDEN_POLL_MS = 15000;
export const GAME_KINDS = { quiz: 'Quiz', letters: 'Letters to Words', soundmatch: 'Sound Match' };
export const QUIZ_MODES = [['classic', 'Classic Quiz'], ['rapid', 'Rapid Fire'], ['random', 'Random Mix'], ['vocabulary', 'Vocabulary'], ['abbreviations', 'Abbreviations'], ['braille', 'Braille']];
export const SM_LEVELS = [['easy', 'Easy'], ['medium', 'Medium'], ['hard', 'Hard']];

/** Title for a room game from its settings, e.g. "Quiz: History, Rapid Fire". */
export function gameTitle(kind, config = {}, categories = []) {
  if (kind === 'quiz') {
    const cat = categories.find(c => c.id === config.category)?.name || 'General knowledge';
    const mode = QUIZ_MODES.find(([id]) => id === config.mode)?.[1] || 'Classic Quiz';
    return `Quiz: ${cat}, ${mode}`;
  }
  if (kind === 'soundmatch') return `Sound Match: ${SM_LEVELS.find(([id]) => id === config.level)?.[1] || 'Easy'}`;
  return 'Letters to Words';
}

/** One line of the live log a spectator reads, or null for events that are only heard (sound effects). */
export function eventText(e) {
  switch (e.kind) {
    case 'say': return `${e.name}'s game: ${e.body}`;
    case 'score': return `${e.name} score: ${e.body}`;
    case 'comment': return `${e.name} commented: ${e.body}`;
    case 'join': return `${e.name} joined the game.`;
    case 'end': return `${e.name} finished.`;
    default: return null;
  }
}

export function createRooms({ $, announce, callApi, getSession, go, playSfx = () => {}, playMatchSound = () => {}, currentView = () => '', categories = [], startLive = () => {}, openSignIn = () => {} }) {
  let roomId = null, room = null, chatAfter = null, roomTimer = null, watchId = null, watchAfter = null, watchTimer = null, watchFirst = true, lastPeople = '';
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
  function openRoom(id) {
    if (!signedIn()) { openSignIn(); return; }
    if (roomId !== id) { roomId = id; room = null; chatAfter = null; lastPeople = ''; $('#room-chat').replaceChildren(); $('#room-games').replaceChildren(); $('#room-people').replaceChildren(); $('#room-title').textContent = 'Room'; }
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
    while (log.children.length > 80) log.firstElementChild.remove();
  }
  function renderGames(games) {
    const host = $('#room-games');
    const focusedId = document.activeElement?.closest?.('[data-game-id]')?.dataset.gameId, focusedText = document.activeElement?.textContent;
    host.replaceChildren(...(games.length ? games.map(g => {
      const li = el('li', 'room-game'); li.dataset.gameId = g.id;
      const players = (g.players || []).map(p => `${p.name} ${p.score}`).join(', ');
      li.append(el('strong', '', g.title), el('small', '', `${g.status === 'playing' ? 'Playing now' : 'Finished'}. Host ${g.host}. ${players ? `Scores: ${players}.` : 'No players yet.'}`));
      const row = el('div', 'room-game-actions');
      if (g.status === 'playing') row.append(button(`Join and play ${g.title}`, () => joinGame(g), 'button button-hot'));
      row.append(button(`Watch ${g.title}`, () => openWatch(g.id), 'button button-outline'));
      li.append(row);
      return li;
    }) : [el('li', 'muted', 'No games yet. Create one below.')]));
    if (focusedId) [...host.querySelectorAll(`[data-game-id="${focusedId}"] button`)].find(b => b.textContent === focusedText)?.focus();
  }
  function syncGameForm() {
    const kind = $('#room-game-kind').value;
    $('#room-game-quiz').hidden = kind !== 'quiz'; $('#room-game-sm').hidden = kind !== 'soundmatch';
  }
  async function createGame(e) {
    e.preventDefault();
    if (!roomId) return;
    const kind = $('#room-game-kind').value;
    const config = kind === 'quiz' ? { category: $('#room-game-category').value, mode: $('#room-game-mode').value } : kind === 'soundmatch' ? { level: $('#room-game-level').value } : {};
    const title = gameTitle(kind, config, categories);
    try {
      const d = await callApi('game-create', { roomId, kind, title, config });
      announce(`${title} created. Others in the room can join or watch.`);
      startLive({ gameId: d.id, roomId, kind, config, title });
    } catch (err) { say($('#room-status'), errorText(err.message), true); }
  }
  async function joinGame(g) {
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
  function leaveRoom() { clearTimeout(roomTimer); if (roomId) callApi('room-leave', { roomId }).catch(() => {}); }

  // ---- Watching a game live ------------------------------------------------------------------
  function openWatch(gameId) {
    watchId = gameId; watchAfter = null; watchFirst = true;
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
      if (text) { log.append(el('li', `watch-line watch-${e.kind}`, text)); }
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
    try { await callApi('room-say', { roomId, gameId: watchId, text }); input.value = ''; announce('Comment sent.'); pollWatch(); }
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
  $('#room-refresh')?.addEventListener('click', () => pollRoom(true));
  $('#watch-comment-form')?.addEventListener('submit', comment);
  $('#watch-back')?.addEventListener('click', () => roomId ? openRoom(roomId) : go('multiplayer'));
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { if (currentView() === 'room') pollRoom(false); if (currentView() === 'watch') pollWatch(); } });

  return { loadRooms, openRoom, openWatch, leaveRoom, get roomId() { return roomId; } };
}
