// Calls and file transfers between friends (Migration 023). Both friends must be online.
// The server only relays small end-to-end sealed signals (src/e2ee.js sealData) that set up a direct WebRTC
// connection; files and call audio/video then travel device to device (DTLS-encrypted), and are never stored.
// The connection fingerprints travel inside the sealed signals, so a server in the middle cannot hijack them.
// Flow: ring (to all the friend's devices) -> accept (from one device) -> offer -> answer -> connected.
import { deviceKey, idbStore, sealData, openData, keyPins, MAX_SIGNAL } from './e2ee.js';

const ICE = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }];
const CHUNK = 64 * 1024, HIGH_WATER = 8 * 1024 * 1024, MAX_FILE = 2 * 1024 * 1024 * 1024;
const RING_MS = 60000, CONNECT_MS = 30000, FAST_POLL_MS = 1000;

export function formatSize(n) {
  if (n >= 1024 * 1024 * 1024) return `${(n / 1024 / 1024 / 1024).toFixed(1)} GB`;
  if (n >= 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  if (n >= 1024) return `${Math.round(n / 1024)} KB`;
  return `${n} bytes`;
}
/** Keeps a connection description under the sealed-signal limit by dropping IPv6 and TCP candidates if needed. */
export function trimSdp(sdp, max = MAX_SIGNAL - 200) {
  if (sdp.length <= max) return sdp;
  return sdp.split('\r\n').filter(l => !(l.startsWith('a=candidate') && (/ tcp /i.test(l) || / [0-9a-f]*:[0-9a-f:]+ \d+ typ /i.test(l)))).join('\r\n');
}
const safeName = n => String(n || 'file').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').slice(0, 120) || 'file';

export function createDirect({ $, announce, callApi, getSession, playSfx = () => {}, store = null, pinsStorage = null,
  RTC = globalThis.RTCPeerConnection, mediaDevices = () => globalThis.navigator?.mediaDevices, onCallState = () => {} }) {
  let me = null, registeredFor = '', after = null, pollTimer = null, active = null, polling = false;
  const handled = new Set();
  const account = () => getSession()?.loginId || getSession()?.profile?.loginId || getSession()?.profile?.name || '';
  const pins = () => keyPins(pinsStorage || globalThis.localStorage, account());
  const panel = $('#direct-panel'), title = $('#direct-title'), text = $('#direct-text'), actions = $('#direct-actions'), progress = $('#direct-progress');
  const el = (tag, cls, t) => { const e = document.createElement(tag); if (cls) e.className = cls; if (t != null) e.textContent = t; return e; };
  const button = (t, onClick, cls = 'button button-outline') => { const b = el('button', cls, t); b.type = 'button'; b.addEventListener('click', onClick); return b; };
  const uuid = () => globalThis.crypto.randomUUID();
  const supported = () => typeof RTC === 'function' && !!globalThis.crypto?.subtle;

  // ---- Panel -------------------------------------------------------------------------------
  function show(heading, body, buttons = [], { alert = false, urgent = false, focus = true } = {}) {
    panel.hidden = false;
    panel.setAttribute('role', alert ? 'alertdialog' : 'region');
    title.textContent = heading; text.textContent = body;
    actions.replaceChildren(...buttons);
    if (body) announce(`${heading}. ${body}`, urgent);
    if (focus && buttons[0]) setTimeout(() => buttons[0].focus(), 40);
  }
  function hidePanel() { panel.hidden = true; progress.hidden = true; $('#direct-videos').hidden = true; actions.replaceChildren(); }
  function setProgress(pct) { progress.hidden = false; progress.value = pct; progress.setAttribute('aria-valuetext', `${pct} percent`); }
  const closeButton = () => button('Close', hidePanel, 'button button-quiet');

  // ---- Keys and signals ----------------------------------------------------------------------
  async function ensureMe() {
    if (!supported()) throw new Error('unsupported');
    me = await deviceKey(store || (store = idbStore()), account());
    if (registeredFor !== account()) { await callApi('register-device', { deviceId: me.deviceId, publicKey: me.publicKey }); registeredFor = account(); }
    return me;
  }
  async function friendDevices(friend) {
    const d = await callApi('message-keys', { name: friend });
    const theirs = d.theirs || [], keys = theirs.map(k => k.publicKey);
    const p = pins(), c = p.check(friend, keys);
    if (c.firstTime) p.accept(friend, keys);
    else if (c.changed) throw new Error('keys_changed_confirm');
    if (!theirs.length) throw new Error('no_devices');
    return theirs;
  }
  async function send(sess, kind, obj, targets) {
    const boxes = await sealData({ ...obj, s: sess.id }, me, targets);
    return callApi('signal-send', { name: sess.friend, deviceId: me.deviceId, session: sess.id, kind, boxes });
  }
  const toPeer = (sess, obj) => send(sess, 'signal', obj, [{ deviceId: sess.peerDevice, publicKey: sess.peerKey }]).catch(() => {});

  function schedulePoll() { clearTimeout(pollTimer); if (active) pollTimer = setTimeout(poll, FAST_POLL_MS); }
  async function poll() {
    if (polling || !getSession()?.profile) return;
    polling = true;
    try {
      await ensureMe();
      const d = await callApi('signals', { deviceId: me.deviceId, afterId: after });
      for (const s of d.signals || []) {
        after = Math.max(after || 0, s.id);
        if (handled.has(s.id)) continue; handled.add(s.id);
        let obj; try { obj = await openData(s.box, me, s.senderDevice, s.senderKey); } catch { continue; }
        if (obj.s !== s.session) continue;
        await handle(s, obj);
      }
    } catch { /* offline or not ready: try again on the next heartbeat */ }
    finally { polling = false; schedulePoll(); }
  }

  function errorText(code, friend) {
    return code === 'player_offline' ? `${friend} is not online right now. Calls and files work only when you are both online.`
      : code === 'not_friends' ? `You need to be friends with ${friend} first.`
      : code === 'keys_changed_confirm' ? `${friend}'s security key changed. Open your chat with ${friend} and confirm the safety code first.`
      : code === 'no_devices' ? `${friend} has not opened private messages on any device yet, so a direct connection cannot be set up.`
      : code === 'unsupported' ? 'This device or app version cannot make direct connections. Please update the browser or the app.'
      : code === 'media' ? 'The microphone or camera could not be used. Please allow it and try again.'
      : code === 'rate_limited' ? 'Too many attempts. Please wait a little and try again.'
      : code === 'network' ? 'No internet connection. Please check it and try again.'
      : 'Something went wrong. Please try again.';
  }

  // ---- Starting (caller) ---------------------------------------------------------------------
  async function startFile(friend, file) {
    if (!file) return;
    if (file.size > MAX_FILE) { show('File too large', `${file.name} is ${formatSize(file.size)}. Files up to 2 GB can be sent.`, [closeButton()]); return; }
    return ring(friend, { kind: 'file', file, meta: { t: 'file', name: safeName(file.name), size: file.size, mime: String(file.type || 'application/octet-stream').slice(0, 100) } });
  }
  function startCall(friend, video = false) { return ring(friend, { kind: 'call', video, meta: { t: 'call', video: !!video } }); }

  async function ring(friend, { kind, file = null, video = false, meta }) {
    if (active) { show('Already busy', 'Finish the current call or transfer first.', [closeButton()]); return; }
    const sess = active = { id: uuid(), friend, role: 'caller', kind, file, video, meta, devices: [] };
    show(kind === 'file' ? 'Sending a file' : video ? 'Video call' : 'Audio call', `Contacting ${friend}…`, [button('Cancel', () => cancel(sess), 'button button-quiet')], { focus: false });
    try {
      await ensureMe();
      if (kind === 'call') sess.stream = await getMedia(video);
      sess.devices = await friendDevices(friend);
      await send(sess, 'ring', meta, sess.devices);
    } catch (err) { finish(sess, kind === 'file' ? 'File not sent' : 'Call not started', errorText(err.message === 'NotAllowedError' ? 'media' : err.message, friend)); return; }
    if (active !== sess) return;
    show(kind === 'file' ? 'Sending a file' : video ? 'Video call' : 'Audio call',
      kind === 'file' ? `Waiting for ${friend} to accept ${meta.name}, ${formatSize(meta.size)}.` : `Calling ${friend}…`,
      [button('Cancel', () => cancel(sess), 'button button-quiet')]);
    sess.ringTimer = setTimeout(() => { if (active === sess && !sess.peerDevice) { cancel(sess, false); finish(sess, 'No answer', `${friend} did not answer.`); } }, RING_MS);
    schedulePoll();
  }
  async function getMedia(video) {
    const md = mediaDevices();
    if (!md?.getUserMedia) throw new Error('media');
    try { return await md.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true }, video: video ? { facingMode: 'user', width: { ideal: 640 } } : false }); }
    catch { throw new Error('media'); }
  }
  function cancel(sess, tell = true) {
    if (tell && me) send(sess, 'signal', { t: 'cancel' }, sess.peerDevice ? [{ deviceId: sess.peerDevice, publicKey: sess.peerKey }] : sess.devices).catch(() => {});
    if (tell) finish(sess, 'Cancelled', '');
  }

  // ---- Incoming (callee) ---------------------------------------------------------------------
  async function handle(s, obj) {
    const sess = active && active.id === s.session ? active : null;
    if (s.kind === 'ring' && (obj.t === 'file' || obj.t === 'call')) {
      const peer = { deviceId: s.senderDevice, publicKey: s.senderKey };
      if (active) { send({ id: s.session, friend: s.from }, 'signal', { t: 'busy' }, [peer]).catch(() => {}); return; }
      const inc = active = { id: s.session, friend: s.from, role: 'callee', kind: obj.t, video: !!obj.video, meta: obj, peerDevice: s.senderDevice, peerKey: s.senderKey };
      if (obj.t === 'file') obj.name = safeName(obj.name);
      const what = obj.t === 'file' ? `${s.from} wants to send you a file: ${obj.name}, ${formatSize(Number(obj.size) || 0)}.` : `${s.from} is calling you${obj.video ? ' with video' : ''}.`;
      playSfx('notify');
      show(obj.t === 'file' ? 'Incoming file' : obj.video ? 'Incoming video call' : 'Incoming call', what,
        [button(obj.t === 'file' ? 'Accept file' : 'Answer', () => accept(inc), 'button button-hot'), button('Decline', () => decline(inc), 'button button-quiet')], { alert: true, urgent: true });
      inc.ringTimer = setTimeout(() => { if (active === inc && !inc.accepted) finish(inc, 'Missed', `You missed ${obj.t === 'file' ? 'a file' : 'a call'} from ${s.from}.`); }, RING_MS);
      schedulePoll();
      return;
    }
    if (!sess) return;
    if (sess.peerDevice && s.senderDevice !== sess.peerDevice) {
      // The caller's other devices are told nothing; another of OUR devices answering means this one stops ringing.
      if (sess.role === 'caller' && obj.t === 'accept') toPeer({ ...sess, peerDevice: s.senderDevice, peerKey: s.senderKey }, { t: 'taken' });
      return;
    }
    switch (obj.t) {
      case 'accept': if (sess.role === 'caller' && !sess.peerDevice) { sess.peerDevice = s.senderDevice; sess.peerKey = s.senderKey; clearTimeout(sess.ringTimer); makeOffer(sess); } break;
      case 'offer': if (sess.role === 'callee' && sess.accepted && typeof obj.sdp === 'string') makeAnswer(sess, obj.sdp); break;
      case 'answer': if (sess.role === 'caller' && sess.pc && typeof obj.sdp === 'string') { try { await sess.pc.setRemoteDescription({ type: 'answer', sdp: obj.sdp }); } catch { fail(sess); } } break;
      case 'decline': finish(sess, sess.kind === 'file' ? 'File declined' : 'Call declined', `${sess.friend} declined.`); break;
      case 'busy': finish(sess, 'Busy', `${sess.friend} is busy right now.`); break;
      case 'taken': finish(sess, 'Answered elsewhere', 'You answered on another device.'); break;
      case 'cancel': finish(sess, 'Cancelled', `${sess.friend} cancelled.`); break;
      case 'end': finish(sess, sess.kind === 'call' ? 'Call ended' : 'Transfer ended', sess.kind === 'call' ? `${sess.friend} hung up.` : ''); break;
      default: break;
    }
  }
  async function accept(sess) {
    if (sess.accepted) return;
    sess.accepted = true; clearTimeout(sess.ringTimer);
    show(sess.kind === 'file' ? 'Receiving a file' : 'Connecting', 'Connecting directly…', [button(sess.kind === 'file' ? 'Stop' : 'Hang up', () => hangUp(sess), 'button button-quiet')], { focus: false });
    try { if (sess.kind === 'call') sess.stream = await getMedia(sess.video); }
    catch { toPeer(sess, { t: 'decline' }); finish(sess, 'Call not answered', errorText('media', sess.friend)); return; }
    await toPeer(sess, { t: 'accept' });
    sess.connectTimer = setTimeout(() => { if (active === sess && !sess.connected) fail(sess); }, CONNECT_MS);
    schedulePoll();
  }
  function decline(sess) { toPeer(sess, { t: 'decline' }); finish(sess, 'Declined', ''); }

  // ---- WebRTC --------------------------------------------------------------------------------
  function newPc(sess) {
    const pc = sess.pc = new RTC({ iceServers: ICE });
    if (sess.stream) for (const t of sess.stream.getTracks()) pc.addTrack(t, sess.stream);
    pc.onconnectionstatechange = () => {
      const st = pc.connectionState;
      if (st === 'connected' && !sess.connected) { sess.connected = true; clearTimeout(sess.connectTimer); clearTimeout(pollTimer); if (sess.kind === 'call') inCall(sess); }
      else if (st === 'failed') fail(sess);
      else if ((st === 'disconnected' || st === 'closed') && sess.connected && active === sess) {
        sess.dropTimer = setTimeout(() => { if (active === sess && pc.connectionState !== 'connected') finish(sess, sess.kind === 'call' ? 'Call ended' : 'Connection lost', sess.kind === 'call' ? 'The connection ended.' : 'The connection was lost before the file finished.'); }, 5000);
      }
    };
    pc.ontrack = e => {
      const stream = e.streams[0]; if (!stream) return;
      const v = $('#direct-remote'), a = $('#direct-audio-out');
      if (sess.video) { $('#direct-videos').hidden = false; v.srcObject = stream; $('#direct-local').srcObject = sess.stream || null; }
      else a.srcObject = stream;
    };
    if (!sess.connectTimer) sess.connectTimer = setTimeout(() => { if (active === sess && !sess.connected) fail(sess); }, CONNECT_MS);
    return pc;
  }
  const gathered = pc => new Promise(resolve => {
    if (pc.iceGatheringState === 'complete') return resolve();
    const t = setTimeout(resolve, 4000);
    pc.addEventListener('icegatheringstatechange', () => { if (pc.iceGatheringState === 'complete') { clearTimeout(t); resolve(); } });
  });
  async function makeOffer(sess) {
    try {
      show(sess.kind === 'file' ? 'Sending a file' : 'Connecting', `${sess.friend} accepted. Connecting directly…`, [button(sess.kind === 'file' ? 'Stop' : 'Hang up', () => hangUp(sess), 'button button-quiet')], { focus: false });
      const pc = newPc(sess);
      if (sess.kind === 'file') fileSender(sess, pc.createDataChannel('file', { ordered: true }));
      else control(sess, pc.createDataChannel('ctl'));
      await pc.setLocalDescription(await pc.createOffer());
      await gathered(pc);
      await toPeer(sess, { t: 'offer', sdp: trimSdp(pc.localDescription.sdp) });
      schedulePoll();
    } catch { fail(sess); }
  }
  async function makeAnswer(sess, sdp) {
    if (sess.pc) return;
    try {
      const pc = newPc(sess);
      pc.ondatachannel = e => { if (e.channel.label === 'ctl') control(sess, e.channel); else fileReceiver(sess, e.channel); };
      await pc.setRemoteDescription({ type: 'offer', sdp });
      await pc.setLocalDescription(await pc.createAnswer());
      await gathered(pc);
      await toPeer(sess, { t: 'answer', sdp: trimSdp(pc.localDescription.sdp) });
    } catch { fail(sess); }
  }
  function fail(sess) {
    if (active !== sess) return;
    toPeer(sess, { t: 'end' });
    finish(sess, 'Could not connect', `A direct connection to ${sess.friend} could not be made. This can happen on some mobile networks. Try again, ideally with both of you on Wi-Fi.`);
  }

  // ---- Files ---------------------------------------------------------------------------------
  function progressAnnouncer(sess, verb) {
    let last = -1;
    return (done, total) => {
      const pct = total ? Math.floor(done / total * 100) : 100; setProgress(pct);
      const step = Math.floor(pct / 25);
      if (step !== last) { last = step; if (pct < 100) { text.textContent = `${verb} ${sess.meta.name}: ${pct} percent.`; if (pct > 0) announce(`${pct} percent`); } }
    };
  }
  function fileSender(sess, dc) {
    sess.dc = dc; dc.binaryType = 'arraybuffer'; dc.bufferedAmountLowThreshold = 1024 * 1024;
    const tick = progressAnnouncer(sess, 'Sending');
    dc.onopen = async () => {
      try {
        const f = sess.file, total = f.size;
        dc.send(JSON.stringify({ h: 1, name: sess.meta.name, size: total, mime: sess.meta.mime }));
        tick(0, total);
        for (let o = 0; o < total; o += CHUNK) {
          if (active !== sess) return;
          if (dc.bufferedAmount > HIGH_WATER) await new Promise(r => { dc.onbufferedamountlow = () => { dc.onbufferedamountlow = null; r(); }; });
          dc.send(await f.slice(o, o + CHUNK).arrayBuffer());
          tick(Math.min(total, o + CHUNK), total);
        }
        dc.send(JSON.stringify({ done: 1 }));
        text.textContent = `Waiting for ${sess.friend} to confirm…`;
      } catch { fail(sess); }
    };
    dc.onmessage = e => { try { const m = JSON.parse(e.data); if (m.got === sess.file.size) { playSfx('correct'); finish(sess, 'File sent', `${sess.friend} received ${sess.meta.name}.`); } } catch { /* ignore */ } };
  }
  function fileReceiver(sess, dc) {
    sess.dc = dc; dc.binaryType = 'arraybuffer';
    let head = null, got = 0, parts = [], app = null;
    const tick = progressAnnouncer(sess, 'Receiving');
    const appSink = globalThis.BQFiles && typeof globalThis.BQFiles.postMessage === 'function' ? globalThis.BQFiles : null;
    dc.onmessage = e => {
      if (typeof e.data === 'string') {
        let m; try { m = JSON.parse(e.data); } catch { return; }
        if (m.h && !head) {
          head = { name: safeName(m.name), size: Number(m.size) || 0, mime: String(m.mime || 'application/octet-stream').slice(0, 100) };
          if (head.size > MAX_FILE || head.size !== Number(sess.meta.size)) { fail(sess); return; }
          if (appSink) { app = sess.id; appSink.postMessage(JSON.stringify({ op: 'open', id: app, name: head.name, mime: head.mime, size: head.size })); }
          tick(0, head.size);
        } else if (m.done && head) {
          if (got !== head.size) { fail(sess); return; }
          dc.send(JSON.stringify({ got }));
          playSfx('correct');
          if (app) { appSink.postMessage(JSON.stringify({ op: 'close', id: app })); finish(sess, 'File received', `${head.name} from ${sess.friend} was received. Choose where to save or open it.`); }
          else saveInBrowser(sess, head, parts);
          parts = [];
        }
        return;
      }
      if (!head) return;
      got += e.data.byteLength;
      if (got > head.size) { fail(sess); return; }
      if (app) { const a = new Uint8Array(e.data); let s = ''; for (let i = 0; i < a.length; i += 0x8000) s += String.fromCharCode.apply(null, a.subarray(i, i + 0x8000)); appSink.postMessage(JSON.stringify({ op: 'chunk', id: app, data: btoa(s) })); }
      else parts.push(e.data);
      tick(got, head.size);
    };
  }
  function saveInBrowser(sess, head, parts) {
    const url = URL.createObjectURL(new Blob(parts, { type: head.mime }));
    const a = el('a', 'button button-hot', `Save ${head.name}`); a.href = url; a.download = head.name;
    end(sess);
    show('File received', `${head.name}, ${formatSize(head.size)}, from ${sess.friend}. It is not stored anywhere else, so save it now.`, [a, button('Close', () => { URL.revokeObjectURL(url); hidePanel(); }, 'button button-quiet')]);
  }

  // ---- Calls ---------------------------------------------------------------------------------
  function inCall(sess) {
    playSfx('go');
    const started = Date.now();
    const mute = button('Mute', () => { const tr = sess.stream?.getAudioTracks() || []; const on = tr[0]?.enabled !== false; tr.forEach(t => { t.enabled = !on; }); mute.textContent = on ? 'Unmute' : 'Mute'; mute.setAttribute('aria-pressed', String(on)); announce(on ? 'Microphone off.' : 'Microphone on.'); });
    mute.setAttribute('aria-pressed', 'false');
    const btns = [mute];
    if (sess.video) {
      const cam = button('Camera off', () => { const tr = sess.stream?.getVideoTracks() || []; const on = tr[0]?.enabled !== false; tr.forEach(t => { t.enabled = !on; }); cam.textContent = on ? 'Camera on' : 'Camera off'; announce(on ? 'Camera off.' : 'Camera on.'); });
      btns.push(cam);
    }
    btns.push(button('Hang up', () => hangUp(sess), 'button button-hot'));
    show(sess.video ? 'Video call' : 'Audio call', `In a call with ${sess.friend}. The call goes directly between your devices and is encrypted.`, btns);
    sess.clock = setInterval(() => { const s = Math.floor((Date.now() - started) / 1000); title.textContent = `${sess.video ? 'Video call' : 'Audio call'} with ${sess.friend}, ${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; }, 1000);
    onCallState(true);
  }
  // Inside a call, hang-up travels over the call connection itself, so it arrives at once (signals are not polled then).
  function control(sess, ch) { sess.ctl = ch; ch.onmessage = e => { if (e.data === 'end' && active === sess) finish(sess, 'Call ended', `${sess.friend} hung up.`); }; }
  function hangUp(sess) { try { if (sess.ctl?.readyState === 'open') sess.ctl.send('end'); } catch { /* ignore */ } if (sess.peerDevice) toPeer(sess, { t: 'end' }); finish(sess, sess.kind === 'call' ? 'Call ended' : 'Stopped', ''); }

  // ---- Ending --------------------------------------------------------------------------------
  function end(sess) {
    clearTimeout(sess.ringTimer); clearTimeout(sess.connectTimer); clearTimeout(sess.dropTimer); clearInterval(sess.clock);
    try { sess.dc?.close(); } catch { /* ignore */ }
    try { sess.pc?.close(); } catch { /* ignore */ }
    for (const t of sess.stream?.getTracks() || []) t.stop();
    const v = $('#direct-remote'), a = $('#direct-audio-out'), l = $('#direct-local');
    if (v) v.srcObject = null; if (a) a.srcObject = null; if (l) l.srcObject = null;
    if (active === sess) { active = null; clearTimeout(pollTimer); }
    if (sess.kind === 'call') onCallState(false);
  }
  function finish(sess, heading, body) {
    if (sess.finished) return; sess.finished = true;
    end(sess);
    if (!body) { hidePanel(); announce(heading); return; }
    show(heading, body, [closeButton()]);
  }

  return { startFile, startCall, poll, supported, get busy() { return !!active; } };
}
