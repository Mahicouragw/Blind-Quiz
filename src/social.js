// Multiplayer stage 1 (Migration 019): presence heartbeat, notifications, player cards, friends,
// the notifications setting, "My feedback" with read/replied status, and admin replies and announcements.
// Other players are only ever addressed by display name; cards never contain a Login ID or secret question.

import { alertSound, appBridge, APP_NOTIFY_KEY } from './alerts.js';

// 10 s while visible, so a call or file from a friend rings quickly; 60 s in the background.
const HEARTBEAT_MS = 10000, HIDDEN_HEARTBEAT_MS = 60000;
const DEVICE_KEY = 'bq.deviceNotifications';

// Achievements are earned from the public card stats, so every player sees the same badges.
export const ACHIEVEMENTS = [
  ['first-answer', 'First answer', 'Answered a first question', p => p.questionsAnswered >= 1],
  ['century', 'Century', 'Answered 100 questions', p => p.questionsAnswered >= 100],
  ['thousand', 'Quiz marathon', 'Answered 1000 questions', p => p.questionsAnswered >= 1000],
  ['sharp-ear', 'Sharp ear', 'Gave 50 correct answers', p => p.questionsCorrect >= 50],
  ['finisher', 'Finisher', 'Completed 10 quizzes', p => p.quizzesCompleted >= 10],
  ['hot-streak', 'Hot streak', 'Best streak of 10 or more', p => p.bestStreak >= 10],
  ['word-finder', 'Word finder', 'Found 50 different words', p => p.wordsFound >= 50],
  ['word-master', 'Word master', 'Found 500 different words', p => p.wordsFound >= 500],
  ['sound-memory', 'Sound memory', 'Finished 10 Sound Match games', p => p.soundMatchGames >= 10],
  ['level-5', 'Rising star', 'Reached level 5', p => p.level >= 5],
];
export const achievementsFor = p => ACHIEVEMENTS.filter(([, , , test]) => test(p || {})).map(([id, name, desc]) => ({ id, name, desc }));

const RELATION_TEXT = { friends: 'Friend', outgoing: 'Friend request sent', incoming: 'Sent you a friend request', none: '' };
export function notificationText(n) {
  const who = n.actor || 'A player';
  switch (n.kind) {
    case 'friend_request': return `${who} sent you a friend request.`;
    case 'friend_accepted': return `${who} accepted your friend request. You are now friends.`;
    case 'message': return `New message from ${who}.`;
    case 'feedback_reply': return `The Blind Quiz developer replied to your feedback: ${n.body}`;
    case 'announcement': return `Announcement: ${n.body}`;
    case 'room_invite': return `${who} invited you to a room.`;
    case 'game_invite': return String(n.body||'').startsWith('host-request|') ? `${who} selected you to host a room game.` : `${who} invited you to a match.`;
    default: return n.body || 'New notification.';
  }
}

export function createSocial({ $, announce, callApi, getSession, go, openSignIn, playSfx = () => {}, currentView = () => '', openChat = () => {}, openRoom = () => {}, loadRooms = () => {}, onRing = () => {} }) {
  const bell = $('#notif-open');
  let timer = null, unread = 0, enabled = true, lastUnread = null, cardName = '', mpTab = 'online';
  const signedIn = () => !!getSession()?.profile;
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const button = (text, onClick, cls = 'button button-quiet') => { const b = el('button', cls, text); b.type = 'button'; b.addEventListener('click', onClick); return b; };
  const say = (node, text, urgent = false) => { if (!node) return; node.textContent = text; if (text) announce(text, urgent); };
  const fmt = iso => { try { return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }); } catch { return ''; } };
  const errorText = code => code === 'rate_limited' ? 'Too many requests. Please wait a little and try again.'
    : code === 'network' ? 'No internet connection. Please check it and try again.'
    : code === 'player_unavailable' ? 'No player with that name was found.'
    : code === 'too_many_requests' ? 'You have many friend requests waiting for an answer. Please wait until some are answered.'
    : code === 'request_unavailable' ? 'That invitation is no longer waiting.'
    : code === 'game_full' ? 'There is no player slot left in that match.'
    : code === 'game_unavailable' ? 'That match is no longer available.'
    : code === 'not_friends' ? 'This game invite is only available to friends.'
    : code === 'not_room_member' ? 'That player is not currently in this room.'
    : code === 'already_joined' ? 'That player has already joined the match.'
    : code === 'session_expired' ? 'Your session has ended. Please sign in again.'
    : code === 'unknown_action' ? 'Multiplayer is still being switched on for everyone. Please try again a little later.'
    : 'Something went wrong. Please try again.';

  // ---- Bell and heartbeat ----------------------------------------------------------------------
  function renderBell() {
    if (!bell) return;
    bell.hidden = !signedIn();
    bell.textContent = unread ? `Notifications (${unread})` : 'Notifications';
    bell.setAttribute('aria-label', unread ? `Notifications, ${unread} new` : 'Notifications, none new');
    bell.classList.toggle('has-unread', unread > 0);
  }
  function deviceAlert(text) {
    try {
      if (localStorage.getItem(DEVICE_KEY) !== 'on' || typeof Notification === 'undefined' || Notification.permission !== 'granted' || !document.hidden) return;
      new Notification('Blind Quiz', { body: text, icon: 'assets/icon-192.png', tag: 'bq-notification' });
    } catch {}
  }
  async function touch() {
    if (!signedIn()) { unread = 0; renderBell(); return; }
    try {
      const d = await callApi('touch');
      unread = Number(d.unread) || 0; enabled = d.notificationsEnabled !== false;
      if (Number(d.ring) > 0) onRing();
      if (lastUnread !== null && unread > lastUnread && enabled) {
        // Never interrupt a running game with speech; the bell count still changes.
        if (!['game', 'soundmatch', 'letters'].includes(currentView())) { playSfx(alertSound('alert')); announce(`You have ${unread} new notification${unread === 1 ? '' : 's'}.`); }
        deviceAlert(`You have ${unread} new notification${unread === 1 ? '' : 's'}.`);
      }
      lastUnread = unread; renderBell();
      if (currentView() === 'multiplayer' && mpTab === 'online') loadOnline({ quiet: true });
    } catch {}
  }
  function schedule() { clearTimeout(timer); if (!signedIn()) return; timer = setTimeout(async () => { await touch(); schedule(); }, document.hidden ? HIDDEN_HEARTBEAT_MS : HEARTBEAT_MS); }
  function start() { lastUnread = null; renderBell(); if (signedIn()) touch(); schedule(); if (currentView() === 'settings') refreshSettings(); appNotify(); }
  function stop() { clearTimeout(timer); unread = 0; lastUnread = null; renderBell(); appBridge()?.postMessage(JSON.stringify({ op: 'logout' })); }

  // ---- Android app: notifications while Blind Quiz is closed (checked about every 15 minutes, no Firebase) ----
  const appWanted = () => { try { return localStorage.getItem(APP_NOTIFY_KEY) !== 'off'; } catch { return true; } };
  async function appNotify() {
    const bridge = appBridge(); if (!bridge || !signedIn() || !appWanted()) return;
    try { const d = await callApi('notify-register'); bridge.postMessage(JSON.stringify({ op: 'enable', token: d.token })); }
    catch {}
  }
  // The app answers with { op: 'enabled', granted } after Android's notification permission question.
  globalThis.bqAppNotify = msg => {
    const status = $('#notif-settings-status'); if (!status || !msg) return;
    if (msg.op === 'enabled') say(status, msg.granted ? 'Phone notifications are on. Blind Quiz checks about every 15 minutes, even when it is closed.' : 'Notifications are blocked for Blind Quiz. You can allow them in your phone settings.', !msg.granted);
  };
  document.addEventListener('visibilitychange', () => { if (!document.hidden && signedIn()) { touch(); schedule(); } });

  // ---- Notifications view ----------------------------------------------------------------------
  const list = $('#notif-list'), summary = $('#notif-summary');
  async function respondGameInvite(n, accept, row) {
    row?.querySelectorAll('button').forEach(b => { b.disabled = true; });
    try {
      const d = await callApi('game-invite-respond', { gameId: n.ref, accept });
      if (accept && d.roomId && d.gameId) { announce(`Game invite accepted. Joining ${n.actor || 'your friend'} in the room.`); openRoom(d.roomId, d.gameId); }
      else { announce(accept ? 'Game invite accepted.' : 'Game invite declined.'); }
      if (row) row.replaceWith(el('p', 'muted', accept ? 'Accepted.' : 'Declined.'));
    } catch (err) { row?.querySelectorAll('button').forEach(b => { b.disabled = false; }); announce(errorText(err.message), true); }
  }
  function renderNotification(n) {
    const li = el('li', `notif-item${n.read ? '' : ' unread'}`);
    li.append(el('p', 'notif-text', notificationText(n)), el('p', 'inbox-meta', `${fmt(n.createdAt)}${n.read ? '' : ' · New'}`));
    if (n.kind === 'friend_request' && n.relation === 'incoming' && n.actor) {
      const row = el('div', 'notif-actions');
      row.append(button(`Accept ${n.actor}`, () => respond(n.actor, true, row), 'button button-hot'), button(`Reject ${n.actor}`, () => respond(n.actor, false, row)));
      li.append(row);
    } else if (n.kind === 'friend_request' && n.relation === 'friends') li.append(el('p', 'muted', 'Accepted.'));
    if (n.kind === 'message' && n.actor) li.append(button(`Open chat with ${n.actor}`, () => openChat(n.actor), 'button button-outline'));
    if (n.kind === 'game_invite' && n.ref && String(n.body||'').startsWith('host-request|')) {
      const [,roomId]=String(n.body).split('|');li.append(button(`Open the room game hosted by ${n.actor||'a player'}`,()=>openRoom(roomId,n.ref),'button button-hot'));
    } else if (n.kind === 'game_invite' && n.ref && String(n.body||'').startsWith('game-invite|')) {
      const row=el('div','notif-actions');row.append(button(`Accept ${n.actor||'player'}’s game invite`,()=>respondGameInvite(n,true,row),'button button-hot'),button('Decline',()=>respondGameInvite(n,false,row)));li.append(row);
    } else if (['room_invite','game_invite'].includes(n.kind) && n.ref) li.append(button(n.kind === 'game_invite' ? `Open the match room with ${n.actor || 'your friend'}` : 'Enter the room', () => openRoom(n.ref), 'button button-hot'));
    if (n.actor && ['friend_request', 'friend_accepted'].includes(n.kind)) li.append(button(`Open ${n.actor}'s player card`, () => openCard(n.actor), 'text-button'));
    return li;
  }
  async function loadNotifications() {
    summary.textContent = 'Loading notifications…'; list.innerHTML = '';
    try {
      const d = await callApi('notifications'); const items = d.items || [];
      list.append(...items.map(renderNotification));
      const fresh = items.filter(n => !n.read).length;
      summary.textContent = items.length ? `${items.length} notification${items.length === 1 ? '' : 's'}, ${fresh} new.` : 'No notifications yet.';
      announce(summary.textContent);
      if (fresh) { const r = await callApi('notifications-read', { ids: null }); unread = r.unread || 0; lastUnread = unread; renderBell(); }
    } catch (err) { say(summary, errorText(err.message), true); }
  }
  async function respond(name, accept, row) {
    row?.querySelectorAll('button').forEach(b => { b.disabled = true; });
    try {
      await callApi('friend-respond', { name, accept });
      const text = accept ? `You and ${name} are now friends.` : `You rejected the friend request from ${name}.`;
      if (row) row.replaceWith(el('p', 'muted', accept ? 'Accepted.' : 'Rejected.'));
      if (accept) playSfx('correct');
      announce(text);
      if (currentView() === 'multiplayer') loadFriends();
      if (currentView() === 'player') openCard(name, { keepFocus: true });
    } catch (err) { row?.querySelectorAll('button').forEach(b => { b.disabled = false; }); announce(errorText(err.message), true); }
  }
  function openNotifications() { if (!signedIn()) { openSignIn(); return; } go('notifications'); loadNotifications(); }

  // ---- Multiplayer: online players and friends -------------------------------------------------
  function playerItem(p, extra = []) {
    const li = el('li', 'player-item');
    const status = [`level ${p.level}`, p.online === true ? 'online' : p.online === false ? 'offline' : '', RELATION_TEXT[p.relation] || ''].filter(Boolean).join(', ');
    const b = button(`${p.name}`, () => openCard(p.name), 'player-button');
    b.setAttribute('aria-label', `${p.name}, ${status}. Open player card`);
    b.append(el('small', '', status));
    li.append(b, ...extra);
    return li;
  }
  async function loadOnline({ quiet = false } = {}) {
    const host = $('#mp-online-list'), status = $('#mp-online-status');
    if (!quiet) status.textContent = 'Looking for players online…';
    try {
      const d = await callApi('online-players'); const items = d.items || [];
      host.replaceChildren(...items.map(p => playerItem(p)));
      const text = items.length ? `${items.length} other player${items.length === 1 ? ' is' : 's are'} online now.` : 'No other players are online right now. Try again a little later.';
      if (!quiet) say(status, text); else status.textContent = text;
    } catch (err) { if (!quiet) say(status, errorText(err.message), true); }
  }
  async function loadFriends() {
    const status = $('#mp-friends-status');
    status.textContent = 'Loading friends…';
    try {
      const d = await callApi('friends');
      const incoming = d.incoming || [], friends = d.friends || [], outgoing = d.outgoing || [];
      $('#mp-incoming-title').hidden = !incoming.length; $('#mp-outgoing-title').hidden = !outgoing.length;
      $('#mp-incoming-list').replaceChildren(...incoming.map(p => { const row = el('div', 'notif-actions'); row.append(button(`Accept ${p.name}`, () => respond(p.name, true, row), 'button button-hot'), button(`Reject ${p.name}`, () => respond(p.name, false, row))); return playerItem({ ...p, relation: 'incoming' }, [row]); }));
      $('#mp-friend-list').replaceChildren(...(friends.length ? friends.map(p => playerItem({ ...p, relation: 'friends' }, [button(`Message ${p.name}`, () => openChat(p.name), 'button button-outline')])) : [el('li', 'muted', 'No friends yet. Open a player card and choose Add friend.')]));
      $('#mp-outgoing-list').replaceChildren(...outgoing.map(p => playerItem({ ...p, relation: 'outgoing' })));
      say(status, `${friends.length} friend${friends.length === 1 ? '' : 's'}${incoming.length ? `, ${incoming.length} friend request${incoming.length === 1 ? '' : 's'} waiting for you` : ''}.`);
    } catch (err) { say(status, errorText(err.message), true); }
  }
  function setTab(tab) {
    mpTab = tab;
    document.querySelectorAll('[data-mp-tab]').forEach(b => { const on = b.dataset.mpTab === tab; b.classList.toggle('active', on); b.setAttribute('aria-pressed', String(on)); });
    $('#mp-online').hidden = tab !== 'online'; $('#mp-friends').hidden = tab !== 'friends';
    const roomsBox = $('#mp-rooms'); if (roomsBox) roomsBox.hidden = tab !== 'rooms';
    if (tab === 'online') loadOnline(); else if (tab === 'rooms') loadRooms(); else loadFriends();
  }
  function openMultiplayer() {
    const ok = signedIn();
    $('#mp-signin').hidden = ok; $('#mp-body').hidden = !ok;
    go('multiplayer');
    if (ok) setTab(mpTab);
  }

  // ---- Player card -----------------------------------------------------------------------------
  async function openCard(name, { keepFocus = false } = {}) {
    if (!signedIn()) { openSignIn(); return; }
    cardName = name;
    const status = $('#player-status'), stats = $('#player-stats'), badges = $('#player-badges'), actions = $('#player-actions');
    $('#player-title').textContent = name; stats.replaceChildren(); badges.replaceChildren(); actions.replaceChildren();
    if (!keepFocus && currentView() !== 'player') go('player');
    status.textContent = 'Loading player card…';
    try {
      const { player: p } = await callApi('player-card', { name });
      if (cardName !== name) return;
      $('#player-title').textContent = p.name;
      const acc = p.questionsAnswered ? Math.round(p.questionsCorrect / p.questionsAnswered * 100) : 0;
      const rows = [['Status', p.self ? 'This is you' : p.online ? 'Online now' : 'Offline'], ['Level', p.level], ['XP', p.xp], ['Coins', p.coins], ['Questions answered', p.questionsAnswered], ['Correct answers', `${p.questionsCorrect}, ${acc} percent`], ['Quizzes completed', p.quizzesCompleted], ['Best streak', p.bestStreak], ['Words found', p.wordsFound], ['Sound Match games', p.soundMatchGames], ['Playing since', p.memberSince]];
      stats.replaceChildren(...rows.map(([k, v]) => { const li = el('li'); li.append(el('span', 'stat-label', `${k}, `), el('span', 'stat-value', String(v ?? 0))); return li; }));
      const got = achievementsFor(p);
      badges.replaceChildren(...(got.length ? got.map(a => { const li = el('li', 'badge'); li.append(el('strong', '', a.name), el('span', 'sr-only', '. '), el('small', '', a.desc)); return li; }) : [el('li', 'muted', 'No achievements yet.')]));
      renderCardActions(p);
      status.textContent = `${p.name}: level ${p.level}, ${p.online ? 'online now' : 'offline'}${RELATION_TEXT[p.relation] ? `, ${RELATION_TEXT[p.relation].toLowerCase()}` : ''}.`;
    } catch (err) { say(status, errorText(err.message), true); }
  }
  function renderCardActions(p) {
    const actions = $('#player-actions'); actions.replaceChildren();
    if (p.self) { actions.append(el('p', 'muted', 'This is how other players see your card. Your Login ID and secret question are never shown.')); return; }
    const act = (action, okText) => async () => {
      actions.querySelectorAll('button').forEach(b => { b.disabled = true; });
      try { const d = await callApi(action, { name: p.name }); announce(okText(d.relation)); await openCard(p.name, { keepFocus: true }); setTimeout(() => actions.querySelector('button')?.focus(), 80); }
      catch (err) { actions.querySelectorAll('button').forEach(b => { b.disabled = false; }); announce(errorText(err.message), true); }
    };
    if (p.relation === 'friends') {
      actions.append(el('p', 'muted', `You and ${p.name} are friends.`));
      actions.append(button(`Send ${p.name} a match`, async e => {
        const b = e.currentTarget; b.disabled = true;
        try { const d = await callApi('match-invite', { name: p.name }); announce(`Match invitation sent to ${p.name}. Opening your match room.`); openRoom(d.roomId); }
        catch (err) { b.disabled = false; announce(err.message === 'not_friends' ? `You need to be friends with ${p.name} to send a match.` : errorText(err.message), true); }
      }, 'button button-hot'));
      actions.append(button(`Send ${p.name} a private message`, () => openChat(p.name), 'button button-outline'));
      actions.append(button(`Remove ${p.name} from friends`, act('friend-remove', () => `${p.name} was removed from your friends.`)));
    } else if (p.relation === 'incoming') {
      const row = el('div', 'notif-actions');
      row.append(button(`Accept ${p.name}`, () => respond(p.name, true, row), 'button button-hot'), button(`Reject ${p.name}`, () => respond(p.name, false, row)));
      actions.append(el('p', '', `${p.name} sent you a friend request.`), row);
    } else if (p.relation === 'outgoing') {
      actions.append(el('p', 'muted', `Friend request sent. ${p.name} will see it in their notifications.`));
      actions.append(button('Cancel friend request', act('friend-remove', () => 'Friend request cancelled.')));
    } else {
      actions.append(el('p', 'muted', `To send ${p.name} a match, you need to be friends first.`));
      actions.append(button('Add friend: send a friend request', act('friend-request', r => r === 'friends' ? `You and ${p.name} are now friends.` : `Friend request sent to ${p.name}.`), 'button button-hot'));
    }
  }

  // ---- Settings: notifications switch, device notifications, My feedback -------------------------
  async function refreshSettings() {
    const ok = signedIn();
    const box = $('#notif-settings'), mine = $('#my-feedback-box');
    if (box) box.hidden = !ok; if (mine) mine.hidden = !ok;
    if (!ok) return;
    const appBox = $('#app-notify-box'), inApp = !!appBridge();
    if (appBox) { appBox.hidden = !inApp; $('#app-notify-on').checked = appWanted(); }
    const deviceBtn = $('#notif-device');
    if (deviceBtn && inApp) deviceBtn.hidden = true;
    else if (deviceBtn) { const on = localStorage.getItem(DEVICE_KEY) === 'on' && typeof Notification !== 'undefined' && Notification.permission === 'granted'; deviceBtn.textContent = on ? 'Stop showing them on this device' : 'Also show them on this device'; deviceBtn.hidden = typeof Notification === 'undefined'; }
    try { const d = await callApi('touch'); enabled = d.notificationsEnabled !== false; $('#notif-on').checked = enabled; unread = Number(d.unread) || 0; renderBell(); } catch {}
    loadMyFeedback();
  }
  async function loadMyFeedback() {
    const host = $('#my-feedback-list'), status = $('#my-feedback-status'); if (!host) return;
    try {
      const d = await callApi('my-feedback'); const items = d.items || [];
      status.textContent = items.length ? '' : 'You have not sent any feedback yet.';
      host.replaceChildren(...items.map(f => {
        const li = el('li', 'inbox-item');
        const word = f.status === 'replied' ? 'Replied' : f.status === 'read' ? 'Read by the developer' : 'Sent, not read yet';
        li.append(el('p', 'inbox-meta', `${fmt(f.createdAt)} · ${word}`), el('p', 'inbox-message', f.message));
        if (f.reply) li.append(el('p', 'feedback-reply', `Reply from the developer: ${f.reply}`));
        return li;
      }));
    } catch { status.textContent = 'Your feedback could not be loaded.'; }
  }
  $('#notif-on')?.addEventListener('change', async e => {
    const want = e.target.checked, status = $('#notif-settings-status');
    try { await callApi('set-notifications', { enabled: want }); enabled = want; say(status, want ? 'Notifications are on.' : 'Notifications are off. Friend requests still wait for you in Notifications.'); }
    catch (err) { e.target.checked = !want; say(status, errorText(err.message), true); }
  });
  $('#notif-device')?.addEventListener('click', async () => {
    const status = $('#notif-settings-status');
    if (localStorage.getItem(DEVICE_KEY) === 'on') { localStorage.setItem(DEVICE_KEY, 'off'); say(status, 'Device notifications are off.'); refreshSettings(); return; }
    try {
      const perm = await Notification.requestPermission();
      if (perm === 'granted') { localStorage.setItem(DEVICE_KEY, 'on'); say(status, 'Done. While Blind Quiz is open in the background, new notifications also appear on this device.'); }
      else say(status, 'Notifications are blocked for this site. You can allow them in your browser settings.', true);
    } catch { say(status, 'This device does not support notifications here.', true); }
    refreshSettings();
  });

  $('#app-notify-on')?.addEventListener('change', async e => {
    const want = e.target.checked, status = $('#notif-settings-status');
    try { localStorage.setItem(APP_NOTIFY_KEY, want ? 'on' : 'off'); } catch {}
    if (want) { say(status, 'Turning on phone notifications.'); await appNotify(); }
    else { appBridge()?.postMessage(JSON.stringify({ op: 'disable' })); say(status, 'Phone notifications are off. You still see them in Notifications when Blind Quiz is open.'); }
  });
  $('#app-notify-sounds')?.addEventListener('click', () => {
    appBridge()?.postMessage(JSON.stringify({ op: 'sounds' }));
    say($('#notif-settings-status'), 'Opening your phone settings. Choose a sound for each kind of notification.');
  });

  // ---- Wiring ----------------------------------------------------------------------------------
  bell?.addEventListener('click', openNotifications);
  $('#notif-refresh')?.addEventListener('click', loadNotifications);
  $('#mp-open')?.addEventListener('click', openMultiplayer);
  $('#mp-signin-button')?.addEventListener('click', () => openSignIn());
  document.querySelectorAll('[data-mp-tab]').forEach(b => b.addEventListener('click', () => setTab(b.dataset.mpTab)));
  $('#mp-online-refresh')?.addEventListener('click', () => loadOnline());
  $('#mp-rooms-refresh')?.addEventListener('click', () => loadRooms());
  $('#mp-find-form')?.addEventListener('submit', e => { e.preventDefault(); const n = $('#mp-find-name').value.trim(); if (n.length < 2) { announce('Type a player name first.', true); return; } openCard(n); });

  return { start, stop, touch, openNotifications, openMultiplayer, openCard, refreshSettings, loadNotifications };
}
