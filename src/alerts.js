// Sounds players choose for calls, messages and alerts (real recordings from the game's own sound set),
// and the bridge to the Android app's background notifications (present only inside the app).
export const ALERT_SOUNDS = [
  ['notify', 'Bright chime'], ['match_doorbell', 'Doorbell'], ['match_crystal_chime', 'Crystal chime'],
  ['match_songbird', 'Songbird'], ['match_magic_key', 'Magic key'], ['match_fairy_teleport', 'Fairy sparkle'],
  ['coin', 'Coin'], ['match_mystery_alert', 'Short alert'], ['match_tribal_drum', 'Drum'], ['levelup', 'Fanfare'],
];
export const ALERT_KINDS = [['call', 'Call ringtone'], ['message', 'Message sound'], ['alert', 'Friend request and alert sound']];
const DEFAULTS = { call: 'match_doorbell', message: 'notify', alert: 'match_crystal_chime' };
const key = kind => `bq-sound-${kind}`;
const read = k => { try { return localStorage.getItem(k); } catch { return null; } };
export function alertSound(kind) {
  const v = read(key(kind));
  return ALERT_SOUNDS.some(([id]) => id === v) ? v : (DEFAULTS[kind] || 'notify');
}
export function setAlertSound(kind, id) {
  if (!ALERT_KINDS.some(([k]) => k === kind) || !ALERT_SOUNDS.some(([s]) => s === id)) return false;
  try { localStorage.setItem(key(kind), id); } catch {}
  return true;
}
// window.BQNotify is a JavaScript channel added by the Android app (android-app/lib/main.dart).
export function appBridge() {
  const c = globalThis.BQNotify;
  return c && typeof c.postMessage === 'function' ? c : null;
}
export const APP_NOTIFY_KEY = 'bq-app-notify';

// Settings: one choice per kind, saved and previewed as soon as it changes.
export function initAlertSettings({ $, playSfx, announce }) {
  const host = $('#sound-choice-rows'); if (!host) return;
  for (const [kind, label] of ALERT_KINDS) {
    const row = document.createElement('div'); row.className = 'setting-row';
    const lab = document.createElement('label'); lab.htmlFor = `sound-${kind}`; lab.textContent = label;
    const sel = document.createElement('select'); sel.id = `sound-${kind}`;
    for (const [id, name] of ALERT_SOUNDS) { const o = document.createElement('option'); o.value = id; o.textContent = name; sel.append(o); }
    sel.value = alertSound(kind);
    sel.addEventListener('change', () => { if (setAlertSound(kind, sel.value)) { playSfx(sel.value); announce(`${label}: ${sel.selectedOptions[0].textContent}.`); } });
    row.append(lab, sel); host.append(row);
  }
}
