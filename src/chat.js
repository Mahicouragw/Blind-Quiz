// Private messages between friends, end-to-end encrypted on the device (see src/e2ee.js and Migration 020).
// The server only relays sealed boxes. Each device has its own key, so messages sent before a device was set up
// cannot be read on it; the chat says so honestly instead of pretending.
import { deviceKey, idbStore, seal, open, safetyCode, keyPins, MAX_MESSAGE } from './e2ee.js';

const POLL_MS = 4000;

export function createChat({ $, announce, callApi, getSession, go, playSfx = () => {}, currentView = () => '', store = null, pinsStorage = null }) {
  let friend = '', me = null, keys = null, lastId = 0, timer = null, registeredFor = '', pendingTrust = null, busy = false;
  const account = () => getSession()?.loginId || getSession()?.profile?.loginId || getSession()?.profile?.name || '';
  const keyStore = () => store || (store = idbStore());
  const pins = () => keyPins(pinsStorage || globalThis.localStorage, account());
  const log = $('#chat-log'), status = $('#chat-status'), warn = $('#chat-warning');
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const timeOf = iso => { try { return new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }); } catch { return ''; } };
  const say = (text, urgent = false) => { status.textContent = text; if (text) announce(text, urgent); };

  async function ensureDevice() {
    if (!globalThis.crypto?.subtle || (typeof indexedDB === 'undefined' && !store)) throw new Error('no_crypto');
    me = await deviceKey(keyStore(), account());
    if (registeredFor !== account()) { await callApi('register-device', { deviceId: me.deviceId, publicKey: me.publicKey }); registeredFor = account(); }
    return me;
  }

  // Fetches both people's device keys and compares them with the pinned ones (trust on first use).
  async function loadKeys() {
    const d = await callApi('message-keys', { name: friend });
    keys = { theirs: d.theirs || [], mine: d.mine || [] };
    const theirKeys = keys.theirs.map(k => k.publicKey), myKeys = keys.mine.map(k => k.publicKey);
    const code = await safetyCode(theirKeys, myKeys);
    $('#chat-safety').textContent = `Safety code: ${code}`;
    const p = pins(), them = p.check(friend, theirKeys), self = p.check('@self', myKeys.filter(k => k !== me.publicKey));
    if (them.firstTime) p.accept(friend, theirKeys);
    if (self.firstTime) p.accept('@self', myKeys.filter(k => k !== me.publicKey));
    if (them.changed || self.changed) {
      pendingTrust = { theirKeys, myKeys: myKeys.filter(k => k !== me.publicKey) };
      $('#chat-warning-text').textContent = them.changed
        ? `${friend} has a new device or reinstalled the game, so their security key changed. Compare the safety code with ${friend} in person or by phone before you send anything private.`
        : 'A new device was added to your own account. If that was not you, sign out everywhere by changing your secret answer.';
      warn.hidden = false; announce($('#chat-warning-text').textContent, true);
    } else { warn.hidden = true; pendingTrust = null; }
    return keys;
  }

  async function render(m) {
    const li = el('li', `chat-msg ${m.fromMe ? 'mine' : 'theirs'}`);
    let text, ok = true;
    if (!m.box) { text = 'This message was sent before this device was set up, so it can only be read on the other device.'; ok = false; }
    else {
      try { text = (await open(m.box, me, m.senderDevice, m.senderKey)).t; }
      catch { text = 'This message could not be verified, so it is hidden. It may have been changed on the way.'; ok = false; }
    }
    const who = m.fromMe ? 'You' : friend;
    li.append(el('span', 'chat-who', `${who}, ${timeOf(m.createdAt)}: `), el('span', ok ? 'chat-text' : 'chat-text chat-locked', text));
    if (m.fromMe && m.read) li.append(el('span', 'chat-read', ' Read.'));
    return { li, text, ok, who };
  }

  async function poll({ first = false } = {}) {
    if (busy || !friend) return;
    busy = true;
    try {
      const d = await callApi('messages', { name: friend, deviceId: me.deviceId, afterId: first ? null : lastId });
      const items = d.messages || [];
      if (first) log.replaceChildren();
      for (const m of items) {
        const r = await render(m);
        log.append(r.li); lastId = Math.max(lastId, m.id);
        if (!first && !m.fromMe) { playSfx('notify'); announce(`${friend} says: ${r.text}`); }
      }
      if (first) {
        if (!items.length) log.append(el('li', 'muted chat-empty', `No messages yet. Say hello to ${friend}.`));
        say(items.length ? `${items.length} message${items.length === 1 ? '' : 's'} with ${friend}. Newest at the end.` : '');
      } else if (items.length) log.querySelector('.chat-empty')?.remove();
      $('#chat-send').disabled = d.relation !== 'friends';
      if (d.relation !== 'friends') say(`You and ${friend} are no longer friends, so you cannot send new messages.`);
    } catch (err) { if (first) say(err.message === 'network' ? 'No internet connection.' : 'Messages could not be loaded. Please try again.', true); }
    finally { busy = false; }
  }
  function schedule() { clearTimeout(timer); timer = setTimeout(async () => { if (currentView() !== 'chat') return; await poll(); schedule(); }, POLL_MS); }

  async function openChat(name) {
    friend = name; lastId = 0; keys = null;
    $('#chat-title').textContent = `Chat with ${name}`; log.replaceChildren(); warn.hidden = true; $('#chat-safety').textContent = '';
    go('chat'); say('Opening the encrypted chat…');
    try { await ensureDevice(); await loadKeys(); await poll({ first: true }); schedule(); }
    catch (err) {
      say(err.message === 'no_crypto' ? 'This browser cannot do end-to-end encryption, so private messages are not available here.'
        : err.message === 'not_friends' ? `Private messages are only for friends. Send ${name} a friend request first.`
        : err.message === 'unknown_action' ? 'Private messages are still being switched on for everyone. Please try again a little later.'
        : 'The chat could not be opened. Please try again.', true);
    }
  }

  async function send(text) {
    if (pendingTrust) { say('First check the safety code warning above, then choose "I compared the code".', true); return false; }
    const targets = [...keys.theirs, ...keys.mine.filter(k => k.deviceId !== me.deviceId), { deviceId: me.deviceId, publicKey: me.publicKey }];
    const boxes = await seal(text, me, targets);
    try { await callApi('send-message', { name: friend, deviceId: me.deviceId, boxes }); }
    catch (err) {
      if (err.message === 'keys_changed') { await loadKeys(); if (!pendingTrust) return send(text); return false; }
      if (err.message === 'device_unknown') { registeredFor = ''; await ensureDevice(); return send(text); }
      throw err;
    }
    return true;
  }

  $('#chat-form')?.addEventListener('submit', async e => {
    e.preventDefault();
    const area = $('#chat-text'), text = area.value.trim();
    if (!text) { say('Type a message first.', true); area.focus(); return; }
    if (text.length > MAX_MESSAGE) { say(`Messages can be up to ${MAX_MESSAGE} characters.`, true); return; }
    const btn = $('#chat-send'); btn.disabled = true;
    try { if (await send(text)) { area.value = ''; playSfx('click'); await poll(); say('Sent, end-to-end encrypted.'); area.focus(); } }
    catch (err) { say(err.message === 'not_friends' ? `You and ${friend} are no longer friends.` : err.message === 'rate_limited' ? 'You are sending messages too fast. Please wait a moment.' : 'The message could not be sent. Please try again.', true); }
    finally { btn.disabled = false; }
  });
  $('#chat-trust')?.addEventListener('click', () => {
    if (!pendingTrust) return;
    const p = pins(); p.accept(friend, pendingTrust.theirKeys); p.accept('@self', pendingTrust.myKeys);
    pendingTrust = null; warn.hidden = true; say('Saved. The new security key is trusted for this chat.'); $('#chat-text')?.focus();
  });
  $('#chat-safety-read')?.addEventListener('click', () => announce($('#chat-safety').textContent.replace(/(\d)/g, '$1 ') || 'No safety code yet.'));

  return { openChat, stop: () => clearTimeout(timer), get friend() { return friend; } };
}
