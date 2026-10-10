// Private messages between friends, end-to-end encrypted on the device (see src/e2ee.js and Migration 020).
// The server only relays sealed boxes. Each device has its own key, so messages sent before a device was set up
// cannot be read on it; the chat says so honestly instead of pretending.
import { deviceKey, idbStore, seal, open, safetyCode, keyPins, MAX_MESSAGE } from './e2ee.js';
import { alertSound } from './alerts.js';
import { MAX_VOICE_MESSAGE_BYTES, MAX_VOICE_MESSAGE_MS } from './direct.js';
import { createVoicePlaybackControls } from './voice-playback.js';

const POLL_MS = 4000;
const STICKER_PREFIX = '[[bq-sticker:';
export const PRIVATE_STICKERS = Object.freeze({
  party: { emoji: '🎉', label: 'Celebrate' },
  laugh: { emoji: '😂', label: 'That’s funny' },
  great: { emoji: '🌟', label: 'Great job' },
  thanks: { emoji: '💚', label: 'Thank you' },
  smart: { emoji: '🧠', label: 'Brilliant' },
  cheer: { emoji: '🥳', label: 'Let’s go!' },
});

export function createChat({ $, announce, callApi, getSession, go, playSfx = () => {}, currentView = () => '', store = null, pinsStorage = null,
  direct = null, mediaDevices = () => globalThis.navigator?.mediaDevices, Recorder = globalThis.MediaRecorder,
  voiceTimeout = (fn, ms) => setTimeout(fn, ms), clearVoiceTimeout = id => clearTimeout(id) }) {
  let friend = '', me = null, keys = null, lastId = 0, timer = null, registeredFor = '', pendingTrust = null, busy = false;
  let canSend = false, voiceRecorder = null, voiceStream = null, voiceChunks = [], voiceTimer = null, voiceTicker = null;
  let voiceStarted = 0, voiceStoppedAt = 0, voiceFriend = '', voiceCancelled = false, voiceAutoStopped = false;
  let voiceReview = null, voicePreviewUrl = '';
  const account = () => getSession()?.loginId || getSession()?.profile?.loginId || getSession()?.profile?.name || '';
  const keyStore = () => store || (store = idbStore());
  const pins = () => keyPins(pinsStorage || globalThis.localStorage, account());
  const log = $('#chat-log'), status = $('#chat-status'), warn = $('#chat-warning');
  const voiceBox = $('#chat-voice-controls'), voiceStatus = $('#chat-voice-status'), voiceRecordButton = $('#chat-voice-record');
  const voiceRecordActions = $('#chat-voice-record-actions'), voiceReviewBox = $('#chat-voice-review');
  const voicePreview = $('#chat-voice-preview'), voicePreviewControls = $('#chat-voice-preview-controls');
  const voiceSendButton = $('#chat-voice-send'), voiceDiscardButton = $('#chat-voice-discard');
  const voicePreviewPlayback = voicePreview ? createVoicePlaybackControls(voicePreview, { idPrefix: 'chat-voice-preview', label: 'Voice message preview', note: true }) : null;
  if (voicePreviewControls && voicePreviewPlayback) voicePreviewControls.replaceChildren(voicePreviewPlayback.element);
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
    li.append(el('span', 'chat-who', `${who}, ${timeOf(m.createdAt)}: `));
    const stickerId = ok && text.startsWith(STICKER_PREFIX) && text.endsWith(']]') ? text.slice(STICKER_PREFIX.length, -2) : '';
    const sticker = PRIVATE_STICKERS[stickerId] || null;
    if (sticker) {
      li.classList.add('chat-msg-sticker');
      const image = el('span', 'chat-sticker', sticker.emoji); image.setAttribute('role', 'img'); image.setAttribute('aria-label', `${sticker.label} sticker`);
      li.append(image, el('span', 'chat-sticker-caption', sticker.label));
    } else li.append(el('span', ok ? 'chat-text' : 'chat-text chat-locked', text));
    if (m.fromMe && m.read) li.append(el('span', 'chat-read', ' Read.'));
    return { li, text: sticker ? `Sticker: ${sticker.label}` : text, ok, who };
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
        if (!first && !m.fromMe) { playSfx(alertSound('message')); announce(`${friend} says: ${r.text}`); }
      }
      if (first) {
        if (!items.length) log.append(el('li', 'muted chat-empty', `No messages yet. Say hello to ${friend}.`));
        say(items.length ? `${items.length} message${items.length === 1 ? '' : 's'} with ${friend}. Newest at the end.` : '');
      } else if (items.length) log.querySelector('.chat-empty')?.remove();
      canSend = d.relation === 'friends';
      for (const id of ['#chat-send', '#chat-emoji-toggle', '#chat-sticker-toggle', '#chat-voice-record']) { const control = $(id); if (control) control.disabled = !canSend; }
      for (const control of [...($('#chat-emoji-picker')?.querySelectorAll('button') || []), ...($('#chat-sticker-picker')?.querySelectorAll('button') || [])]) control.disabled = !canSend;
      if (!canSend) say(`You and ${friend} are no longer friends, so you cannot send new messages.`);
    } catch (err) { if (first) say(err.message === 'network' ? 'No internet connection.' : 'Messages could not be loaded. Please try again.', true); }
    finally { busy = false; }
  }
  function schedule() { clearTimeout(timer); timer = setTimeout(async () => { if (currentView() !== 'chat') return; await poll(); schedule(); }, POLL_MS); }

  async function openChat(name) {
    cancelVoiceRecording(false); canSend = false;
    for (const id of ['#chat-send', '#chat-emoji-toggle', '#chat-sticker-toggle', '#chat-voice-record']) { const control = $(id); if (control) control.disabled = true; }
    $('#chat-emoji-picker').hidden = true; $('#chat-sticker-picker').hidden = true;
    $('#chat-emoji-toggle').setAttribute('aria-expanded', 'false'); $('#chat-sticker-toggle').setAttribute('aria-expanded', 'false');
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

  async function sendContent(content, successText) {
    if (!canSend) { say(`You and ${friend} are no longer friends, so you cannot send new messages.`, true); return false; }
    const btn = $('#chat-send'); btn.disabled = true;
    try {
      if (await send(content)) { playSfx('click'); await poll(); say(successText); return true; }
      return false;
    } catch (err) {
      say(err.message === 'not_friends' ? `You and ${friend} are no longer friends.`
        : err.message === 'rate_limited' ? 'You are sending messages too fast. Please wait a moment.'
        : 'The message could not be sent. Please try again.', true);
      return false;
    } finally { btn.disabled = !canSend; }
  }

  function togglePicker(which) {
    const emoji = $('#chat-emoji-picker'), sticker = $('#chat-sticker-picker');
    const button = which === 'emoji' ? $('#chat-emoji-toggle') : $('#chat-sticker-toggle');
    const target = which === 'emoji' ? emoji : sticker, other = which === 'emoji' ? sticker : emoji;
    const open = target.hidden;
    target.hidden = !open; other.hidden = true;
    button.setAttribute('aria-expanded', String(open));
    (which === 'emoji' ? $('#chat-sticker-toggle') : $('#chat-emoji-toggle')).setAttribute('aria-expanded', 'false');
    if (open) target.querySelector('button')?.focus();
  }
  function insertEmoji(emoji) {
    const area = $('#chat-text');
    const start = Number.isInteger(area.selectionStart) ? area.selectionStart : area.value.length;
    const end = Number.isInteger(area.selectionEnd) ? area.selectionEnd : start;
    if (typeof area.setRangeText === 'function') area.setRangeText(emoji, start, end, 'end');
    else area.value = `${area.value.slice(0, start)}${emoji}${area.value.slice(end)}`;
    area.focus();
    $('#chat-emoji-picker').hidden = true; $('#chat-emoji-toggle').setAttribute('aria-expanded', 'false');
  }
  function sendSticker(id) {
    const sticker = PRIVATE_STICKERS[id]; if (!sticker) return;
    $('#chat-sticker-picker').hidden = true; $('#chat-sticker-toggle').setAttribute('aria-expanded', 'false');
    return sendContent(`${STICKER_PREFIX}${id}]]`, `Sticker sent: ${sticker.label}.`);
  }

  function stopVoiceMicrophone() {
    clearVoiceTimeout(voiceTimer); clearInterval(voiceTicker); voiceTimer = null; voiceTicker = null;
    const stream = voiceStream; voiceStream = null;
    for (const track of stream?.getTracks?.() || []) { try { track.stop(); } catch { /* ignore */ } }
    voiceRecorder = null; voiceChunks = []; voiceFriend = ''; voiceStarted = 0; voiceStoppedAt = 0; voiceAutoStopped = false;
    voiceRecordButton.disabled = !canSend || !!voiceReview;
  }
  function discardVoiceReview(announceDiscard = false) {
    if (voicePreviewUrl) { try { URL.revokeObjectURL(voicePreviewUrl); } catch { /* ignore */ } voicePreviewUrl = ''; }
    if (voicePreview) { try { voicePreview.pause(); } catch { /* ignore */ } voicePreview.removeAttribute('src'); try { voicePreview.load(); } catch { /* ignore */ } }
    voiceReview = null; voiceReviewBox.hidden = true; voiceRecordActions.hidden = false; voiceBox.hidden = true;
    voiceRecordButton.disabled = !canSend; voiceSendButton.disabled = false; voiceDiscardButton.disabled = false;
    if (announceDiscard) say('Voice message discarded.');
  }
  function cancelVoiceRecording(announceCancel = false) {
    if (!voiceRecorder) {
      if (voiceReview) discardVoiceReview(announceCancel);
      else { voiceBox.hidden = true; voiceRecordButton.disabled = !canSend; if (announceCancel) say('Voice message recording cancelled.'); }
      return;
    }
    voiceCancelled = true;
    clearVoiceTimeout(voiceTimer); clearInterval(voiceTicker);
    try { if (voiceRecorder.state !== 'inactive') voiceRecorder.stop(); else stopVoiceMicrophone(); }
    catch { stopVoiceMicrophone(); }
    if (announceCancel) say('Voice message recording cancelled.');
  }
  function stopVoiceRecording(auto = false) {
    if (!voiceRecorder || voiceRecorder.state === 'inactive') return;
    clearVoiceTimeout(voiceTimer); clearInterval(voiceTicker); voiceTimer = null; voiceTicker = null;
    voiceStoppedAt = Date.now();
    voiceAutoStopped = auto || voiceStoppedAt - voiceStarted >= MAX_VOICE_MESSAGE_MS;
    try { voiceRecorder.stop(); }
    catch { stopVoiceMicrophone(); voiceBox.hidden = true; say('The recording could not be completed. Please try again.', true); }
  }
  async function sendVoicePreview() {
    const pending = voiceReview;
    if (!pending) return;
    if (!canSend || pending.to !== friend) { say(`You and ${friend} are no longer able to send this voice message.`, true); return; }
    if (pendingTrust) { say('First check the safety code warning above, then choose "I compared the code".', true); return; }
    voiceSendButton.disabled = true; voiceDiscardButton.disabled = true; voiceRecordButton.disabled = true;
    voiceStatus.textContent = `Starting a direct voice message to ${pending.to}…`;
    try {
      const started = await direct.startVoiceMessage(pending.to, pending.blob, pending.durationMs);
      if (!started) { voiceSendButton.disabled = false; voiceDiscardButton.disabled = false; voiceRecordButton.disabled = true; return; }
      discardVoiceReview(false);
      say(`Voice message request sent to ${pending.to}. They must be online and accept it to receive the message.`);
    } catch {
      voiceSendButton.disabled = false; voiceDiscardButton.disabled = false; voiceRecordButton.disabled = true;
      voiceStatus.textContent = 'The voice message could not be started. Your preview is still here; try Send again or discard it.';
      say(voiceStatus.textContent, true);
    }
  }
  async function startVoiceRecording() {
    if (!canSend) { say(`You and ${friend} are no longer friends, so you cannot send a voice message.`, true); return; }
    if (!Recorder || !mediaDevices()?.getUserMedia || !direct?.startVoiceMessage || !direct.supported?.()) {
      say('Voice messages are not supported in this browser. Please try a current version of the app or browser.', true); return;
    }
    const target = friend, md = mediaDevices();
    voiceRecordButton.disabled = true;
    let stream;
    try { stream = await md.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true }, video: false }); }
    catch { voiceRecordButton.disabled = !canSend; say('Allow microphone access to record a voice message, then try again.', true); return; }
    if (target !== friend || currentView() !== 'chat') {
      for (const track of stream.getTracks?.() || []) { try { track.stop(); } catch { /* ignore */ } }
      voiceRecordButton.disabled = !canSend; return;
    }
    let recorder;
    try { recorder = new Recorder(stream); recorder.start(250); }
    catch { for (const track of stream.getTracks?.() || []) { try { track.stop(); } catch { /* ignore */ } } voiceRecordButton.disabled = !canSend; say('Recording could not start. Please try again.', true); return; }
    voiceRecorder = recorder; voiceStream = stream; voiceChunks = []; voiceFriend = target; voiceStarted = Date.now(); voiceStoppedAt = 0; voiceCancelled = false; voiceAutoStopped = false;
    recorder.ondataavailable = e => { if (e.data && e.data.size) voiceChunks.push(e.data); };
    recorder.onerror = () => { voiceCancelled = true; stopVoiceMicrophone(); voiceBox.hidden = true; say('The recording stopped unexpectedly. Please try again.', true); };
    recorder.onstop = () => {
      const cancelled = voiceCancelled, autoStopped = voiceAutoStopped, to = voiceFriend;
      const elapsed = Math.max(0, (voiceStoppedAt || Date.now()) - voiceStarted);
      const durationMs = Math.min(MAX_VOICE_MESSAGE_MS, Math.round(elapsed));
      const chunks = voiceChunks, type = recorder.mimeType || chunks.find(c => c.type)?.type || 'audio/webm';
      voiceCancelled = false; stopVoiceMicrophone();
      if (cancelled) { voiceBox.hidden = true; voiceRecordActions.hidden = false; return; }
      if (elapsed > MAX_VOICE_MESSAGE_MS + 1000) { voiceBox.hidden = true; say('The recording exceeded 60 seconds, so it was not sent. Please record a shorter message.', true); return; }
      if (to !== friend || currentView() !== 'chat' || !canSend) { voiceBox.hidden = true; return; }
      const blob = new Blob(chunks, { type });
      if (durationMs < 250 || blob.size < 1) { voiceBox.hidden = true; say('The recording was too short. Please record it again.', true); return; }
      if (blob.size > MAX_VOICE_MESSAGE_BYTES) { voiceBox.hidden = true; say('Voice messages can be up to 60 seconds and 10 MB. This recording was not sent; please record a shorter one.', true); return; }
      voiceReview = { to, blob, durationMs };
      voicePreviewUrl = URL.createObjectURL(blob); voicePreview.src = voicePreviewUrl;
      voiceReviewBox.hidden = false; voiceRecordActions.hidden = true; voiceBox.hidden = false;
      voiceRecordButton.disabled = true; voiceSendButton.disabled = false; voiceDiscardButton.disabled = false;
      voicePreviewPlayback?.apply();
      voiceStatus.textContent = autoStopped
        ? 'Maximum length reached. Your recording is ready to review; it has not been sent.'
        : 'Recording stopped. Your voice message has not been sent yet.';
      announce(`${voiceStatus.textContent} Listen, then choose Send voice message or Discard recording.`, true);
    };
    voiceBox.hidden = false; voiceReviewBox.hidden = true; voiceRecordActions.hidden = false;
    voiceStatus.textContent = 'Recording… 0 seconds. Maximum 60 seconds.';
    voiceBox.querySelector('#chat-voice-stop').disabled = false;
    voiceBox.querySelector('#chat-voice-cancel').disabled = false;
    voiceTicker = setInterval(() => { if (voiceRecorder) voiceStatus.textContent = `Recording… ${Math.min(60, Math.floor((Date.now() - voiceStarted) / 1000))} seconds. Maximum 60 seconds.`; }, 1000);
    voiceTimer = voiceTimeout(() => stopVoiceRecording(true), MAX_VOICE_MESSAGE_MS);
    say('Recording started. At 60 seconds it will stop without sending; preview it and choose Send or Discard.');
  }

  $('#chat-form')?.addEventListener('submit', async e => {
    e.preventDefault();
    const area = $('#chat-text'), text = area.value.trim();
    if (!text) { say('Type a message first.', true); area.focus(); return; }
    if (text.length > MAX_MESSAGE) { say(`Messages can be up to ${MAX_MESSAGE} characters.`, true); return; }
    if (await sendContent(text, 'Sent, end-to-end encrypted.')) { area.value = ''; area.focus(); }
  });
  $('#chat-emoji-toggle')?.addEventListener('click', () => togglePicker('emoji'));
  $('#chat-sticker-toggle')?.addEventListener('click', () => togglePicker('sticker'));
  $('#chat-emoji-picker')?.addEventListener('click', e => {
    const b = e.target.closest('[data-chat-emoji]'); if (b) insertEmoji(b.dataset.chatEmoji);
  });
  $('#chat-sticker-picker')?.addEventListener('click', e => {
    const b = e.target.closest('[data-chat-sticker]'); if (b) sendSticker(b.dataset.chatSticker);
  });
  voiceRecordButton?.addEventListener('click', startVoiceRecording);
  $('#chat-voice-stop')?.addEventListener('click', () => stopVoiceRecording());
  $('#chat-voice-cancel')?.addEventListener('click', () => cancelVoiceRecording(true));
  voiceSendButton?.addEventListener('click', sendVoicePreview);
  voiceDiscardButton?.addEventListener('click', () => discardVoiceReview(true));
  $('#chat-trust')?.addEventListener('click', () => {
    if (!pendingTrust) return;
    const p = pins(); p.accept(friend, pendingTrust.theirKeys); p.accept('@self', pendingTrust.myKeys);
    pendingTrust = null; warn.hidden = true; say('Saved. The new security key is trusted for this chat.'); $('#chat-text')?.focus();
  });
  $('#chat-safety-read')?.addEventListener('click', () => announce($('#chat-safety').textContent.replace(/(\d)/g, '$1 ') || 'No safety code yet.'));

  return { openChat, stop: () => { clearTimeout(timer); canSend = false; cancelVoiceRecording(false); }, get friend() { return friend; } };
}
