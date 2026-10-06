// End-to-end encryption for private messages (Task 19 stage C, Migration 020). WebCrypto only, no libraries.
//
// Every device creates its own ECDH P-256 key pair. The private key is NON-EXTRACTABLE and is kept in IndexedDB
// on this device; only the public key is sent to the server. A message is sealed separately for every active
// device of both friends:
//   shared = ECDH(my private key, their public key)
//   key    = HKDF-SHA-256(shared, salt = 16 random bytes, info = "bq-dm-v1|<sender device>|<recipient device>")
//   box    = AES-256-GCM(key, iv = 12 random bytes, aad = same info string, plaintext)
// The server and anyone reading the database see only ciphertext. Changing any byte makes AES-GCM decryption
// fail, so a tampered message is shown as "could not be verified", never as altered text.
// Keys are remembered per friend (trust on first use); a new or changed key shows a warning and a new
// safety code that both friends can compare.

const te = new TextEncoder(), td = new TextDecoder();
const subtle = () => globalThis.crypto.subtle;
export const b64 = buf => { const a = new Uint8Array(buf); let s = ''; for (let i = 0; i < a.length; i++) s += String.fromCharCode(a[i]); return btoa(s); };
export const unb64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
export const MAX_MESSAGE = 1000;

// ---- Storage of this device's key (IndexedDB in the browser; a Map in tests) ----------------------------
export function idbStore(dbName = 'blindquiz-e2ee') {
  const open = () => new Promise((ok, no) => { const r = indexedDB.open(dbName, 1); r.onupgradeneeded = () => r.result.createObjectStore('keys'); r.onsuccess = () => ok(r.result); r.onerror = () => no(r.error); });
  const run = async (mode, fn) => { const db = await open(); return new Promise((ok, no) => { const tx = db.transaction('keys', mode); const req = fn(tx.objectStore('keys')); tx.oncomplete = () => { ok(req?.result); db.close(); }; tx.onerror = () => { no(tx.error); db.close(); }; }); };
  return { get: k => run('readonly', s => s.get(k)), set: (k, v) => run('readwrite', s => s.put(v, k)) };
}
export const memoryStore = () => { const m = new Map(); return { get: async k => m.get(k), set: async (k, v) => { m.set(k, v); } }; };

// Returns { deviceId, privateKey (non-extractable CryptoKey), publicKey (base64 raw, 88 chars) } for this account.
export async function deviceKey(store, account) {
  const slot = `device:${account}`;
  const have = await store.get(slot);
  if (have?.privateKey && have.deviceId && have.publicKey) return have;
  const pair = await subtle().generateKey({ name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits']);
  const publicKey = b64(await subtle().exportKey('raw', pair.publicKey));
  const rec = { deviceId: globalThis.crypto.randomUUID(), privateKey: pair.privateKey, publicKey, createdAt: Date.now() };
  await store.set(slot, rec);
  return rec;
}

const importPublic = pub => subtle().importKey('raw', unb64(pub), { name: 'ECDH', namedCurve: 'P-256' }, false, []);
async function boxKey(privateKey, theirPublic, salt, info, usage) {
  const bits = await subtle().deriveBits({ name: 'ECDH', public: await importPublic(theirPublic) }, privateKey, 256);
  const hk = await subtle().importKey('raw', bits, 'HKDF', false, ['deriveKey']);
  return subtle().deriveKey({ name: 'HKDF', hash: 'SHA-256', salt, info: te.encode(info) }, hk, { name: 'AES-GCM', length: 256 }, false, [usage]);
}
const infoFor = (from, to) => `bq-dm-v1|${from}|${to}`;

// Seals one message for every target device ({deviceId, publicKey}); returns { [deviceId]: { s, iv, ct } }.
export async function seal(text, me, targets) {
  const plain = te.encode(JSON.stringify({ v: 1, t: String(text).slice(0, MAX_MESSAGE), at: Date.now() }));
  const boxes = {};
  for (const t of targets) {
    const salt = globalThis.crypto.getRandomValues(new Uint8Array(16)), iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
    const info = infoFor(me.deviceId, t.deviceId);
    const key = await boxKey(me.privateKey, t.publicKey, salt, info, 'encrypt');
    const ct = await subtle().encrypt({ name: 'AES-GCM', iv, additionalData: te.encode(info) }, key, plain);
    boxes[t.deviceId] = { s: b64(salt), iv: b64(iv), ct: b64(ct) };
  }
  return boxes;
}

// Opens the box addressed to this device. Throws if the box was altered, or was not sealed by that sender key.
export async function open(box, me, senderDevice, senderKey) {
  if (!box || typeof box.ct !== 'string') throw new Error('no_box');
  const info = infoFor(senderDevice, me.deviceId);
  const key = await boxKey(me.privateKey, senderKey, unb64(box.s), info, 'decrypt');
  const plain = await subtle().decrypt({ name: 'AES-GCM', iv: unb64(box.iv), additionalData: te.encode(info) }, key, unb64(box.ct));
  const msg = JSON.parse(td.decode(plain));
  if (msg?.v !== 1 || typeof msg.t !== 'string') throw new Error('bad_message');
  return msg;
}

// Safety code: the same 30 digits on both phones when both see the same keys (order-independent).
export async function safetyCode(keysA, keysB) {
  const side = keys => [...keys].sort().join(',');
  const pair = [side(keysA), side(keysB)].sort().join('|');
  const h = new Uint8Array(await subtle().digest('SHA-256', te.encode(`bq-safety-v1|${pair}`)));
  let digits = '';
  for (let i = 0; i < 30; i += 5) digits += String(((h[i] << 24 | h[i + 1] << 16 | h[i + 2] << 8 | h[i + 3]) >>> 0) % 100000).padStart(5, '0') + ' ';
  return digits.trim();
}

// Trust on first use: remembers each friend's device keys; reports keys that are new since last time.
export function keyPins(storage = globalThis.localStorage, account = '') {
  const slot = `bq.e2ee.pins.${account}`;
  const read = () => { try { return JSON.parse(storage.getItem(slot) || '{}'); } catch { return {}; } };
  return {
    check(friend, keys) {
      const all = read(), known = all[friend.toLowerCase()];
      const fresh = known ? keys.filter(k => !known.includes(k)) : [];
      return { firstTime: !known, changed: fresh.length > 0, fresh };
    },
    accept(friend, keys) { const all = read(); all[friend.toLowerCase()] = [...new Set(keys)]; try { storage.setItem(slot, JSON.stringify(all)); } catch {} },
  };
}
