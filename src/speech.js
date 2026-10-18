// The game's own spoken voice, with the player's own pitch, speed and volume.
//
// The screen reader stays the default way to hear the game: the live regions in index.html are
// what TalkBack and VoiceOver read. This module is only used when the player picks "The game's own
// voice" (or "Both") in Settings, so that the game can be played without a screen reader, or with a
// voice that sounds different from the phone's system voice.
//
// It uses the browser's own speech engine (SpeechSynthesis). Nothing is recorded, nothing is
// downloaded, and nothing about the player is sent anywhere. If the browser has no speech engine
// (or the device has no voice installed) every function here is a safe no-op and the game keeps
// working with its live regions only.
import { setVoiceDucking } from './audio.js';

const DEFAULTS = { mode: 'screen', pitch: 1, rate: 1, volume: 1, voice: '' };
const MODES = ['screen', 'app', 'both'];
let prefs = { ...DEFAULTS };
let voices = [];
let spoken = null; // the utterance that is playing right now, if any
let pendingTimer = null;
let lastSpokenMessage = '';
let lastSpokenAt = 0;

const engine = () => (typeof globalThis !== 'undefined' && globalThis.speechSynthesis) || null;
const clamp = (value, min, max) => Math.min(max, Math.max(min, Number(value)));
const isNum = value => typeof value === 'number' && Number.isFinite(value);

/** True when this browser can speak with its own voice. */
export function speechSupported() {
  const s = engine();
  return !!s && typeof globalThis.SpeechSynthesisUtterance === 'function' && typeof s.speak === 'function';
}

/** The voices this device has, as { name, lang, uri, local }. Empty when the platform has none. */
export function speechVoices() {
  const s = engine();
  if (!s || typeof s.getVoices !== 'function') return [];
  try { voices = s.getVoices() || []; } catch { voices = []; }
  return voices.map(v => ({ name: v.name || '', lang: v.lang || '', uri: v.voiceURI || v.name || '', local: v.localService !== false }));
}

/** Picks up voices that the platform loads late (Chrome fills the list after the first tick). */
function watchVoices() {
  const s = engine();
  if (!s) return;
  if (typeof s.addEventListener === 'function') s.addEventListener('voiceschanged', () => { speechVoices(); });
  else if ('onvoiceschanged' in s) { /* older engines only expose the property */ }
  speechVoices();
}

/**
 * Applies the player's voice settings. Unknown or out-of-range values are ignored, so a corrupted
 * saved setting can never silence the game.
 */
export function configureSpeech(next = {}) {
  const before = prefs.mode;
  if (MODES.includes(next.mode)) prefs.mode = next.mode;
  const given = value => value !== undefined && value !== null && value !== '' && isNum(Number(value));
  if (given(next.pitch)) prefs.pitch = clamp(Number(next.pitch), 0.1, 2);
  if (given(next.rate)) prefs.rate = clamp(Number(next.rate), 0.5, 3);
  if (given(next.volume)) prefs.volume = clamp(Number(next.volume), 0, 1);
  if (typeof next.voice === 'string') prefs.voice = next.voice;
  if (before !== prefs.mode) cancelSpeech();
  return { ...prefs };
}

export const speechPrefs = () => ({ ...prefs });

/** Stops the game voice at once (used when the player changes the voice or leaves a screen). */
export function cancelSpeech() {
  if (pendingTimer !== null) {
    clearTimeout(pendingTimer);
    pendingTimer = null;
  }
  const s = engine();
  spoken = null;
  setVoiceDucking(false);
  if (!s) return;
  try { s.cancel(); } catch { /* the engine refused: nothing is playing anyway */ }
}

/**
 * Speaks one message with the player's own pitch, speed and volume.
 * Returns true when the message was handed to the speech engine.
 * A new message replaces the one that is playing: the game never queues up old messages.
 */
function speakWith(text, { preview = false } = {}) {
  const s = engine();
  if (!speechSupported() || prefs.volume <= 0) return false;
  const message = String(text ?? '').replace(/\s+/g, ' ').trim();
  if (!message) return false;
  const now = Date.now();
  if (!preview && message === lastSpokenMessage && now - lastSpokenAt < 60) return true;
  lastSpokenMessage = message;
  lastSpokenAt = now;
  if (pendingTimer !== null) {
    clearTimeout(pendingTimer);
    pendingTimer = null;
  }
  try {
    const u = new globalThis.SpeechSynthesisUtterance(message);
    u.pitch = prefs.pitch;
    u.rate = prefs.rate;
    u.volume = prefs.volume;
    const wanted = prefs.voice;
    if (!voices.length) speechVoices();
    const voice = wanted && (voices.find(v => v.voiceURI === wanted || v.uri === wanted) || voices.find(v => v.name === wanted));
    if (voice) { u.voice = voice; u.lang = String(voice.lang || 'en-IN').replace(/_/g, '-'); }
    else if (wanted && /^[a-z]{2}([-_][A-Za-z0-9]+)?$/.test(wanted)) u.lang = wanted.replace(/_/g, '-'); // a plain language code
    spoken = u;
    u.onstart = () => { if (spoken === u) setVoiceDucking(true); };
    u.onend = u.onerror = () => {
      if (spoken === u) {
        spoken = null;
        setVoiceDucking(false);
      }
    };
    const start = () => {
      pendingTimer = null;
      if (spoken !== u) return;
      try {
        setVoiceDucking(true);
        s.resume?.();
        s.speak(u);
      } catch {
        setVoiceDucking(false);
      }
    };
    if (s.speaking || s.pending) {
      try { s.cancel(); } catch { /* ignore */ }
      pendingTimer = setTimeout(start, 60);
    } else {
      start();
    }
    return true;
  } catch {
    setVoiceDucking(false);
    return false;
  }
}

/**
 * Speaks one message with the player's own pitch, speed and volume.
 * Returns true when the message was handed to the speech engine.
 * A new message replaces the one that is playing: the game never queues up old messages.
 */
export function speak(text, { urgent = false } = {}) {
  if (prefs.mode === 'screen') return false;
  return speakWith(text);
}

/** Speaks a message even when the live-region route is the chosen one (used for swipe feedback). */
export function speakOnly(text) {
  if (prefs.mode !== 'app') return false;
  return speakWith(text);
}

/** Speaks a test message with the current settings, whatever the chosen mode is. */
export function speakPreview(text) {
  return speakWith(text, { preview: true });
}

watchVoices();
