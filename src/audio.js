// Recorded game sound effects and music (CC0 / Public domain recordings from Wikimedia Commons,
// see AUDIO_LICENSES.md). This module plays them with plain HTML audio elements; game audio is not
// synthesized. Voice-message processing is handled separately in voice-dsp.js. If a file is missing
// or the browser blocks playback, the game simply continues silently; every sound also has a
// text/announcement equivalent.
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from './config.js';
const BASE = './assets/audio/';
const OVERRIDES_URL = `${SUPABASE_URL}/functions/v1/blind-quiz-api`;
// Recorded effects. 'tick_last' and 'hurry' mark the last seconds of a question, 'streak' marks a
// run of correct answers, and 'countdown' plays on Ready 3, 2, 1. A slot that is missing from the manifest is simply silent.
const SFX = ['correct', 'wrong', 'tick', 'tick_last', 'countdown', 'hurry', 'go', 'timeup', 'applause', 'cheer', 'click', 'levelup', 'coin', 'notify', 'streak', 'roundcomplete', 'swipe'];
const SINGLE_INSTANCE_SFX = new Set(['tick', 'tick_last', 'countdown', 'hurry', 'click', 'swipe', 'go', 'timeup']);
// A slot that has no recording of its own yet falls back to another one, so a game never loses a
// sound while a new recording is being prepared. 'roundcomplete' is the owner's round-completion
// sound; until that file is in the app the small group applause is used.
const FALLBACK = { roundcomplete: 'applause', swipe: 'click', countdown: 'tick' };
// Each category and mode gets its own music track from the available recordings.
const TRACKS = ['music_menu', 'music_game1', 'music_game2', 'music_game3', 'music_results'];
// A slot is a playlist: `music_menu`, then `music_menu2`, `music_menu3`… if the manifest has them.
// Tracks take turns (each visit starts on the next one) and the next track fades in when one ends.
const isTrack = k => TRACKS.some(t => k === t || new RegExp(`^${t}\\d+$`).test(k));
const playlistTurn = {};
let musicGroup = null;
const GAME_TRACK = {
  animals: 'music_game1', birds: 'music_game1', nature: 'music_game1', instruments: 'music_game2', music: 'music_game2',
  science: 'music_game3', technology: 'music_game3', geography: 'music_game1', india: 'music_game2', history: 'music_game2',
  sports: 'music_game3', civics: 'music_game2', economics: 'music_game3', abbreviations: 'music_game3', vocabulary: 'music_game1',
  braille: 'music_game2', management: 'music_game3', business: 'music_game3', accounting: 'music_game2', commerce: 'music_game1',
  medical: 'music_game1', math: 'music_game3', physics: 'music_game3', chemistry: 'music_game2', biology: 'music_game1',
  general: 'music_game1', rapid: 'music_game3', random: 'music_game2',
};
const prefs = { sfx: true, music: true, sfxVolume: 0.8, musicVolume: 0.25 };
let available = null; // Set of slots that exist in assets/audio/manifest.json
const cache = new Map();
const secondaryCache = new Map();
const blobUrls = new Map();
let audioContext = null;
let unlockPrimer = null;
let unlockPrimerStarted = false;
const mediaNodes = new WeakMap();
let music = null, musicSlot = null, fadeTimer = null, transitionTimer = null, unlocked = false, wantedSlot = null;
let musicTransitionId = 0, activeTransitionGroup = null, stoppingMusic = false, musicPlayPromise = null;
let sequenceDucking = false, voiceDucking = false, voiceDuckTimer = null, voiceSafetyTimer = null;
let lifecyclePaused = false, shuttingDown = false;

// ---- Phase 6: Structured, non-sensitive audio diagnostics ----------------------------------------
const MAX_DIAGNOSTICS = 100;
const diagEvents = [];
const diagCounts = {
  playFailed: 0,
  duplicateMusicInit: 0,
  duplicatePlayRequest: 0,
  loadError: 0,
  unexpectedPause: 0,
  promiseRejected: 0,
  cleanupError: 0,
};

function recordAudioDiag(type, detail = {}) {
  if (type in diagCounts) diagCounts[type]++;
  diagEvents.push({
    type: String(type),
    slot: String(detail.slot || ''),
    reason: String(detail.reason || ''),
    at: Date.now(),
  });
  if (diagEvents.length > MAX_DIAGNOSTICS) diagEvents.shift();
}

export function getAudioDiagnostics() {
  return {
    counts: { ...diagCounts },
    events: diagEvents.map(e => ({ ...e })),
    state: {
      unlocked,
      musicGroup,
      musicSlot,
      wantedSlot,
      activeTransitionGroup,
      stoppingMusic,
      sequenceDucking,
      voiceDucking,
      lifecyclePaused,
      musicPaused: music ? Boolean(music.paused) : true,
    },
  };
}

export function clearAudioDiagnostics() {
  for (const k of Object.keys(diagCounts)) diagCounts[k] = 0;
  diagEvents.length = 0;
}

if (typeof globalThis !== 'undefined') {
  globalThis.bqAudioDiagnostics = getAudioDiagnostics;
}

function isRealBrowser() {
  return typeof window !== 'undefined' && !globalThis.navigator?.userAgent?.includes?.('jsdom');
}

function targetMusicVolume() {
  if (!prefs.music || stoppingMusic) return 0;
  if (sequenceDucking || voiceDucking) return Math.max(0, Math.min(1, prefs.musicVolume * 0.35));
  return prefs.musicVolume;
}

function audioContextConstructor() {
  return globalThis.AudioContext || globalThis.webkitAudioContext || globalThis.window?.AudioContext || globalThis.window?.webkitAudioContext || null;
}

function silentUnlockWav() {
  const sampleRate = 8000, samples = 160, bytes = new ArrayBuffer(44 + samples * 2), view = new DataView(bytes);
  const text = (offset, value) => { for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i)); };
  text(0, 'RIFF'); view.setUint32(4, 36 + samples * 2, true); text(8, 'WAVE'); text(12, 'fmt ');
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true); view.setUint16(34, 16, true); text(36, 'data');
  view.setUint32(40, samples * 2, true);
  return new Blob([bytes], { type: 'audio/wav' });
}

function primeMediaPlayback() {
  if (unlockPrimerStarted) return;
  if (!unlockPrimer) {
    const AudioCtor = globalThis.Audio || globalThis.window?.Audio;
    const URLApi = globalThis.URL || globalThis.window?.URL;
    if (!AudioCtor || !URLApi?.createObjectURL || typeof Blob !== 'function') return;
    try {
      unlockPrimer = new AudioCtor(URLApi.createObjectURL(silentUnlockWav()));
      unlockPrimer.muted = true;
      unlockPrimer.volume = 0;
      unlockPrimer.playsInline = true;
      unlockPrimer.preload = 'auto';
    } catch { unlockPrimer = null; }
  }
  if (!unlockPrimer || unlockPrimerStarted) return;
  try {
    const attempt = unlockPrimer.play();
    Promise.resolve(attempt).then(() => { unlockPrimerStarted = true; }).catch(() => {
      recordAudioDiag('promiseRejected', { slot: 'unlockPrimer', reason: 'autoplay-blocked' });
    });
  } catch { /* Web Audio resume remains available as the primary unlock path. */ }
}

function connectMediaElement(audio) {
  if (!audioContext || audioContext.state !== 'running' || mediaNodes.has(audio)) return;
  // On real browser/Android hardware, native HTMLAudioElement uses the platform MediaPlayer buffer
  // without routing every element through the 128-sample WebAudio callback thread (which causes
  // buffer-underrun clicking when many media elements are attached). Synthetic/headless contexts
  // without a native hardware sampleRate still route through createMediaElementSource.
  if (typeof audioContext.sampleRate === 'number' && audioContext.sampleRate > 0) return;
  try {
    const source = audioContext.createMediaElementSource(audio);
    source.connect(audioContext.destination);
    mediaNodes.set(audio, source);
  } catch {
    recordAudioDiag('playFailed', { reason: 'media-element-source-failed' });
  }
}

let pending = null;
let matchInfo = [];
const versions = new Map(); // slot -> file size, appended to the URL so replaced recordings are never served stale
const customOverrides = new Map(); // slot -> { url, fileName, updatedAt } published live by the admin

function resolveOverrideSrc(slot, rawUrl) {
  if (!isRealBrowser() || typeof rawUrl !== 'string' || !rawUrl.startsWith('data:')) return rawUrl;
  const URLApi = globalThis.URL || globalThis.window?.URL;
  if (!URLApi?.createObjectURL || typeof Blob !== 'function' || typeof atob !== 'function') return rawUrl;
  try {
    const comma = rawUrl.indexOf(',');
    if (comma < 0) return rawUrl;
    const header = rawUrl.slice(5, comma);
    const mime = (header.split(';')[0] || 'audio/mpeg').trim();
    const b64 = rawUrl.slice(comma + 1);
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const prevBlob = blobUrls.get(slot);
    if (prevBlob) { try { URLApi.revokeObjectURL?.(prevBlob); } catch { /* ignore */ } }
    const objUrl = URLApi.createObjectURL(new Blob([bytes], { type: mime }));
    blobUrls.set(slot, objUrl);
    return objUrl;
  } catch {
    return rawUrl;
  }
}

function evictSlotCache(slot) {
  const prev = cache.get(slot);
  if (prev && prev !== music) {
    try { prev.pause(); prev.onended = null; } catch { /* ignore */ }
  }
  cache.delete(slot);
  const sec = secondaryCache.get(slot);
  if (sec) {
    try { sec.pause(); sec.onended = null; } catch { /* ignore */ }
    secondaryCache.delete(slot);
  }
}

export function applyAudioOverrides(slots = {}) {
  const nextKeys = new Set();
  const changedSlots = new Set();
  if (slots && typeof slots === 'object') {
    for (const [slot, meta] of Object.entries(slots)) {
      const url = typeof meta === 'string' ? meta : meta?.url;
      if (typeof url === 'string' && url) {
        nextKeys.add(slot);
        const fileName = typeof meta?.fileName === 'string' ? meta.fileName : `${slot}.mp3`;
        const updatedAt = typeof meta?.updatedAt === 'string' ? meta.updatedAt : '';
        const prev = customOverrides.get(slot);
        if (!prev || prev.url !== url || prev.updatedAt !== updatedAt) {
          changedSlots.add(slot);
          customOverrides.set(slot, {
            url,
            playUrl: resolveOverrideSrc(slot, url),
            fileName,
            updatedAt,
          });
        }
        if (available) available.add(slot);
      }
    }
  }
  for (const oldSlot of [...customOverrides.keys()]) {
    if (!nextKeys.has(oldSlot)) {
      customOverrides.delete(oldSlot);
      changedSlots.add(oldSlot);
      const prevBlob = blobUrls.get(oldSlot);
      if (prevBlob) {
        try { (globalThis.URL || globalThis.window?.URL)?.revokeObjectURL?.(prevBlob); } catch { /* ignore */ }
        blobUrls.delete(oldSlot);
      }
    }
  }
  for (const slot of changedSlots) evictSlotCache(slot);
  try {
    if (typeof localStorage !== 'undefined') {
      const serializable = {};
      for (const [k, v] of customOverrides.entries()) {
        serializable[k] = { url: v.url, fileName: v.fileName, updatedAt: v.updatedAt };
      }
      try {
        localStorage.setItem('bq.audioOverrides.v1', JSON.stringify(serializable));
      } catch {
        // If a multi-megabyte music track exceeds localStorage quota, still persist compact SFX overrides.
        const compact = {};
        for (const [k, v] of Object.entries(serializable)) {
          if (typeof v.url === 'string' && v.url.length < 900_000) compact[k] = v;
        }
        localStorage.setItem('bq.audioOverrides.v1', JSON.stringify(compact));
      }
    }
  } catch { /* ignore storage errors */ }
}

export function getAudioOverrides() {
  const out = {};
  for (const [k, v] of customOverrides.entries()) {
    out[k] = { url: v.url, fileName: v.fileName, updatedAt: v.updatedAt };
  }
  return out;
}

export function hasAudioOverride(slot) {
  return customOverrides.has(slot);
}

export async function fetchAudioOverrides() {
  try {
    const res = await fetch(OVERRIDES_URL, {
      method: 'POST',
      cache: 'no-store',
      headers: { 'Content-Type': 'application/json', apikey: SUPABASE_PUBLISHABLE_KEY },
      body: JSON.stringify({ action: 'audio-overrides' }),
    });
    if (!res?.ok) return getAudioOverrides();
    const data = await res.json();
    if (data && typeof data.overrides === 'object' && data.overrides) {
      applyAudioOverrides(data.overrides);
    } else if (data && typeof data.slots === 'object' && data.slots) {
      applyAudioOverrides(data.slots);
    }
  } catch { /* offline or not configured */ }
  return getAudioOverrides();
}

try {
  if (typeof localStorage !== 'undefined') {
    const raw = localStorage.getItem('bq.audioOverrides.v1');
    if (raw) applyAudioOverrides(JSON.parse(raw));
  }
} catch { /* ignore */ }

// The manifest is cached once it loads; a failed load (e.g. offline) is retried on the next sound.
async function manifest() {
  if (available) return available;
  if (!pending) pending = (async () => {
    try {
      const res = await fetch(`${BASE}manifest.json`, { cache: 'no-cache' });
      if (!res.ok) return new Set(customOverrides.keys());
      const data = await res.json();
      const found = new Set(Object.keys(data.assets || {}).filter(k => SFX.includes(k) || isTrack(k) || /^match_[a-z0-9_]+$/.test(k)));
      matchInfo = [...found].filter(k => k.startsWith('match_')).map(k => ({ slot: k, name: String(data.assets[k].name || k.slice(6).replace(/_/g, ' ')), mood: String(data.assets[k].mood || 'interesting') }));
      for (const k of found) versions.set(k, data.assets[k].bytes || 0);
      for (const k of customOverrides.keys()) found.add(k);
      if (found.size) available = found;
      if (!globalThis.navigator?.userAgent?.includes?.('jsdom')) fetchAudioOverrides().catch(() => {});
      return found;
    } catch { return new Set(customOverrides.keys()); } finally { pending = null; }
  })();
  return pending;
}

function attachMediaDiagnostics(a, slot, isMusicTrack = false) {
  if (!a || typeof a.addEventListener !== 'function') return;
  a.addEventListener('error', () => {
    recordAudioDiag('loadError', { slot, reason: 'element-error' });
    if (cache.get(slot) === a && a !== music) cache.delete(slot);
  });
  if (isMusicTrack) {
    a.addEventListener('pause', () => {
      if (a === music && prefs.music && !stoppingMusic && !lifecyclePaused && !shuttingDown && !a.ended) {
        recordAudioDiag('unexpectedPause', { slot });
      }
    });
  }
}

function element(slot) {
  if (!cache.has(slot)) {
    const custom = customOverrides.get(slot);
    const src = custom?.playUrl || custom?.url || `${BASE}${slot}.mp3${versions.get(slot) ? `?v=${versions.get(slot)}` : ''}`;
    const a = new Audio(src);
    a.preload = 'auto';
    a.playsInline = true;
    attachMediaDiagnostics(a, slot, isTrack(slot));
    cache.set(slot, a);
  }
  return cache.get(slot);
}

function sfxElement(slot) {
  const primary = element(slot);
  if (SINGLE_INSTANCE_SFX.has(slot) || primary.paused || primary.ended) {
    return primary;
  }
  // Bounded secondary element (max 1 extra per slot) avoids unbounded cloneNode() AudioTrack exhaustion on Android.
  let secondary = secondaryCache.get(slot);
  if (!secondary) {
    try {
      secondary = typeof primary.cloneNode === 'function' ? primary.cloneNode() : new Audio(primary.src);
      secondary.preload = 'auto';
      secondary.playsInline = true;
      attachMediaDiagnostics(secondary, slot, false);
      secondaryCache.set(slot, secondary);
    } catch {
      return primary;
    }
  }
  return secondary;
}

export function configureAudio(next = {}) {
  // Only known keys are applied, and an unknown value never overwrites a working one.
  for (const key of ['sfx', 'music']) if (typeof next[key] === 'boolean') prefs[key] = next[key];
  for (const key of ['sfxVolume', 'musicVolume']) {
    const value = Number(next[key]);
    if (Number.isFinite(value)) prefs[key] = Math.min(1, Math.max(0, value));
  }
  if (music && !stoppingMusic) {
    clearInterval(fadeTimer);
    music.volume = targetMusicVolume();
  }
  if (!prefs.music) stopMusic();
  else if (wantedSlot && unlocked && (!music || music.paused || stoppingMusic)) playMusic(wantedSlot);
}
export function audioPrefs() { return { ...prefs }; }

/** Preloads effects so the first correct/wrong sound is not delayed. */
export async function preloadAudio() {
  const have = await manifest();
  for (const s of SFX) if (have.has(s)) element(s);
}

const playing = new Set();
let sequenceId = 0;

export async function playSfx(slot) {
  if (!prefs.sfx || shuttingDown || lifecyclePaused) return null;
  unlocked = true;
  if (slot === 'cheer' && customOverrides.has('roundcomplete') && !customOverrides.has('cheer')) slot = 'roundcomplete';
  const have = await manifest();
  let target = slot;
  if (!customOverrides.has(slot) && !have.has(slot) && FALLBACK[slot] && (customOverrides.has(FALLBACK[slot]) || have.has(FALLBACK[slot]))) target = FALLBACK[slot];
  if (!customOverrides.has(target) && !have.has(target)) return null;
  try {
    const a = sfxElement(target);
    connectMediaElement(a);
    a.volume = prefs.sfxVolume;
    try { a.currentTime = 0; } catch { /* ignore if unseekable */ }
    playing.add(a);
    if (typeof a.addEventListener === 'function') {
      a.addEventListener('ended', () => playing.delete(a), { once: true });
    }
    const p = a.play();
    await Promise.resolve(p);
    return a;
  } catch {
    recordAudioDiag('playFailed', { slot: target, reason: 'sfx-play-error' });
    return null; /* autoplay blocked or unsupported: silent fallback */
  }
}

export function stopAllSfx() {
  sequenceId++;
  sequenceDucking = false;
  for (const a of [...playing]) {
    try {
      a.volume = 0;
      a.pause();
      a.currentTime = 0;
    } catch {
      recordAudioDiag('cleanupError', { reason: 'sfx-stop-failed' });
    }
    playing.delete(a);
  }
}

function fadeOutEffect(a, ms = 300) {
  if (!a) return;
  const start = a.volume, steps = Math.max(1, Math.round(ms / 50));
  let i = 0;
  const t = setInterval(() => {
    i++;
    try {
      a.volume = Math.max(0, start * (1 - i / steps));
      if (i >= steps) { clearInterval(t); a.pause(); playing.delete(a); }
    } catch {
      clearInterval(t);
      playing.delete(a);
    }
  }, 50);
}

/** Smoothly adjusts active music volume without cancelling any track transition or stop operation. */
function fadeTo(target, ms, done) {
  clearInterval(fadeTimer);
  if (!music) { done?.(); return; }
  const start = Number.isFinite(music.volume) ? music.volume : 0;
  const clampedTarget = Math.max(0, Math.min(1, Number(target) || 0));
  if (Math.abs(start - clampedTarget) < 0.005 || ms <= 0) {
    try { music.volume = clampedTarget; } catch { /* ignore */ }
    done?.();
    return;
  }
  const steps = Math.max(1, Math.round(ms / 50));
  let i = 0;
  fadeTimer = setInterval(() => {
    i++;
    if (music) {
      try {
        music.volume = Math.max(0, Math.min(1, start + (clampedTarget - start) * (i / steps)));
      } catch { /* ignore */ }
    }
    if (i >= steps) { clearInterval(fadeTimer); fadeTimer = null; done?.(); }
  }, 50);
}

/** Dedicated fade-out for track switches and stopMusic so volume restores never cancel startNext/pause. */
function fadeOutMusicForTransition(m, ms, done) {
  clearInterval(transitionTimer);
  clearInterval(fadeTimer);
  fadeTimer = null;
  if (!m) { done?.(); return; }
  const start = Number.isFinite(m.volume) ? m.volume : 0;
  if (start <= 0.005 || m.paused || ms <= 0) {
    try { m.volume = 0; } catch { /* ignore */ }
    done?.();
    return;
  }
  const steps = Math.max(1, Math.round(ms / 50));
  let i = 0;
  transitionTimer = setInterval(() => {
    i++;
    try { m.volume = Math.max(0, start * (1 - i / steps)); } catch { /* ignore */ }
    if (i >= steps) {
      clearInterval(transitionTimer);
      transitionTimer = null;
      try { m.volume = 0; } catch { /* ignore */ }
      done?.();
    }
  }, 50);
}

/** Coordinates spoken game announcements with background music by smoothly lowering and restoring volume. */
export function setVoiceDucking(active) {
  clearTimeout(voiceDuckTimer);
  clearTimeout(voiceSafetyTimer);
  if (active) {
    if (!voiceDucking) {
      voiceDucking = true;
      if (music && prefs.music && !stoppingMusic && !music.paused) {
        fadeTo(targetMusicVolume(), 160);
      }
    }
    // Safety release in case a platform speech engine never fires onend.
    voiceSafetyTimer = setTimeout(() => setVoiceDucking(false), 12000);
  } else {
    voiceDuckTimer = setTimeout(() => {
      voiceDucking = false;
      if (music && prefs.music && !stoppingMusic && musicSlot && !music.paused) {
        fadeTo(targetMusicVolume(), 500);
      }
    }, 180);
  }
}

/**
 * Plays effects one after another instead of on top of each other, e.g. ['applause', 'levelup'].
 * Each step plays for at most `maxMs` (then fades out) before the next one starts. Music is lowered
 * while the sequence plays so spoken announcements stay clear. A newer sequence replaces an older one.
 */
export async function playSequence(slots, { maxMs = 1800 } = {}) {
  if (!Array.isArray(slots) || !slots.length) return;
  const id = ++sequenceId;
  sequenceDucking = true;
  if (music && prefs.music && !stoppingMusic) {
    fadeTo(targetMusicVolume(), 150);
  }
  const restoreMusic = () => {
    if (id !== sequenceId) return;
    sequenceDucking = false;
    if (music && prefs.music && !stoppingMusic && musicSlot) {
      fadeTo(targetMusicVolume(), 800);
    }
  };
  for (let k = 0; k < slots.length; k++) {
    if (id !== sequenceId) return;
    const slotName = slots[k];
    const stepMaxMs = customOverrides.has(slotName) ? Math.max(maxMs, 4200) : maxMs;
    const a = await playSfx(slotName);
    const last = k === slots.length - 1;
    if (!a) continue;
    if (last) {
      const safety = setTimeout(restoreMusic, stepMaxMs + 1500);
      if (typeof a.addEventListener === 'function') {
        a.addEventListener('ended', () => { clearTimeout(safety); restoreMusic(); }, { once: true });
      }
      return;
    }
    await new Promise(resolve => {
      const t = setTimeout(resolve, stepMaxMs);
      if (typeof a.addEventListener === 'function') {
        a.addEventListener('ended', () => { clearTimeout(t); resolve(); }, { once: true });
      }
    });
    if (!a.ended) fadeOutEffect(a);
  }
  restoreMusic();
}

/**
 * The level-up sound. The owner's recording plays in this slot, so every place where a player
 * levels up - the quiz, Letters to Words, Sound Match - uses the same file.
 */
export async function playLevelUp() {
  return playSfx('levelup');
}

/** The sound for a finished round: a cheer for a perfect round, the round-completion sound otherwise. */
export async function playRoundComplete(perfect = false) {
  return playSfx(perfect && (!customOverrides.has('roundcomplete') || customOverrides.has('cheer')) ? 'cheer' : 'roundcomplete');
}

export function musicFor(view, category, mode) {
  if (view === 'soundmatch' || view === 'countmatch') return null; // Keep recorded clips and spoken memory clues clear
  if (view === 'game') return GAME_TRACK[mode] && mode !== 'classic' ? GAME_TRACK[mode] : (GAME_TRACK[category] || 'music_game1');
  if (view === 'letters') return 'music_game2';
  if (view === 'results') return 'music_results';
  return 'music_menu';
}

function safePauseMusic(m) {
  if (!m) return;
  m.onended = null;
  try { m.volume = 0; } catch { /* ignore */ }
  const pendingPlay = m === music ? musicPlayPromise : null;
  if (pendingPlay && isRealBrowser()) {
    Promise.resolve(pendingPlay).then(() => {
      if (m !== music || stoppingMusic || lifecyclePaused || shuttingDown) {
        try { m.pause(); } catch { /* ignore */ }
      }
    }).catch(() => {});
  } else {
    try { m.pause(); } catch { /* ignore */ }
  }
}

/** Switches the background music playlist, cross-fading from the current track. */
export async function playMusic(slot) {
  if (slot == null) { wantedSlot = null; stopMusic(); return; }
  wantedSlot = slot;
  if (!prefs.music || !unlocked || shuttingDown || lifecyclePaused) return;
  // Prevent duplicate in-flight or active requests from restarting or skipping tracks.
  if (!stoppingMusic && ((musicGroup === slot && music && !music.paused) || activeTransitionGroup === slot)) {
    recordAudioDiag('duplicatePlayRequest', { slot });
    return;
  }
  const have = await manifest();
  if (wantedSlot !== slot || !prefs.music || shuttingDown || lifecyclePaused) return;
  if (!customOverrides.has(slot) && !have.has(slot)) slot = customOverrides.has('music_menu') || have.has('music_menu') ? 'music_menu' : null;
  if (!slot) return;
  if (!stoppingMusic && ((musicGroup === slot && music && !music.paused) || activeTransitionGroup === slot)) {
    recordAudioDiag('duplicatePlayRequest', { slot });
    return;
  }
  const list = customOverrides.has(slot)
    ? [slot]
    : [slot, ...[...have].filter(k => new RegExp(`^${slot}\\d+$`).test(k)).sort((a, b) => parseInt(a.slice(slot.length), 10) - parseInt(b.slice(slot.length), 10))];
  // A new visit moves to the next track; a retry of the same playlist (blocked autoplay) replays the current one.
  let index;
  if (musicGroup === slot && music) index = Math.max(0, list.indexOf(musicSlot));
  else { const turn = playlistTurn[slot] || 0; playlistTurn[slot] = turn + 1; index = turn % list.length; }
  startTrack(slot, list, index);
}

function startTrack(group, list, index) {
  const track = list[index];
  const txId = ++musicTransitionId;
  activeTransitionGroup = group;
  stoppingMusic = false;
  const startNext = () => {
    if (txId !== musicTransitionId || !prefs.music || shuttingDown || lifecyclePaused) {
      if (activeTransitionGroup === group) activeTransitionGroup = null;
      return;
    }
    const nextEl = element(track);
    if (music && music !== nextEl) {
      safePauseMusic(music);
    } else if (music === nextEl && !music.paused) {
      recordAudioDiag('duplicateMusicInit', { slot: track });
      activeTransitionGroup = null;
      return;
    }
    if (music) music.onended = null;
    music = nextEl;
    connectMediaElement(music);
    musicSlot = track;
    musicGroup = group;
    music.loop = list.length === 1;
    music.onended = () => {
      if (musicGroup === group && prefs.music && !stoppingMusic && !shuttingDown) {
        playlistTurn[group] = index + 2;
        startTrack(group, list, (index + 1) % list.length);
      }
    };
    music.volume = 0;
    try { music.currentTime = 0; } catch { /* ignore */ }
    try {
      const p = music.play();
      musicPlayPromise = p;
      Promise.resolve(p).then(() => {
        if (musicPlayPromise === p) musicPlayPromise = null;
        if (txId === musicTransitionId) activeTransitionGroup = null;
        if (txId !== musicTransitionId || stoppingMusic || !prefs.music || lifecyclePaused || shuttingDown) {
          safePauseMusic(nextEl);
          return;
        }
        fadeTo(targetMusicVolume(), 1200);
      }).catch(() => {
        if (musicPlayPromise === p) musicPlayPromise = null;
        if (txId === musicTransitionId) activeTransitionGroup = null;
        recordAudioDiag('promiseRejected', { slot: track, reason: 'music-play-blocked' });
      });
    } catch {
      activeTransitionGroup = null;
      recordAudioDiag('playFailed', { slot: track, reason: 'music-play-throw' });
    }
  };
  if (music && !music.paused) fadeOutMusicForTransition(music, 500, startNext);
  else { clearInterval(transitionTimer); transitionTimer = null; startNext(); }
}

export function stopMusic({ immediate = false } = {}) {
  const txId = ++musicTransitionId;
  activeTransitionGroup = null;
  stoppingMusic = true;
  musicSlot = null;
  musicGroup = null;
  if (!music) { stoppingMusic = false; return; }
  const m = music;
  if (immediate || m.paused) {
    clearInterval(transitionTimer);
    clearInterval(fadeTimer);
    transitionTimer = null;
    fadeTimer = null;
    safePauseMusic(m);
    stoppingMusic = false;
    return;
  }
  fadeOutMusicForTransition(m, 350, () => {
    if (txId === musicTransitionId) {
      safePauseMusic(m);
      stoppingMusic = false;
    }
  });
}

/** Cleanly releases and silences all active audio without an audible pop on exit/close. */
export function shutdownAudio() {
  if (shuttingDown) return;
  shuttingDown = true;
  clearInterval(fadeTimer);
  clearInterval(transitionTimer);
  clearTimeout(voiceDuckTimer);
  clearTimeout(voiceSafetyTimer);
  fadeTimer = null;
  transitionTimer = null;
  activeTransitionGroup = null;
  stoppingMusic = false;
  stopAllSfx();
  stopMatchSound();
  if (music) {
    try {
      music.onended = null;
      music.volume = 0;
      music.pause();
    } catch {
      recordAudioDiag('cleanupError', { reason: 'music-shutdown-failed' });
    }
  }
}

/** Call directly from a user gesture. Resume Web Audio and prime HTML media for iOS/WebViews. */
export function unlockAudio() {
  unlocked = true;
  shuttingDown = false;
  let resume = Promise.resolve(false);
  const Context = audioContextConstructor();
  if (Context) {
    try {
      if (!audioContext) audioContext = new Context();
      resume = audioContext.state === 'running'
        ? Promise.resolve(true)
        : Promise.resolve(audioContext.resume()).then(() => audioContext.state === 'running').catch(() => {
            recordAudioDiag('promiseRejected', { slot: 'AudioContext', reason: 'resume-failed' });
            return false;
          });
    } catch { audioContext = null; }
  }
  primeMediaPlayback();
  if (wantedSlot && prefs.music && !lifecyclePaused && (!music || music.paused || musicGroup !== wantedSlot) && activeTransitionGroup !== wantedSlot) {
    playMusic(wantedSlot);
  }
  return resume;
}

function handleLifecycleState(state) {
  if (state === 'exit') {
    shutdownAudio();
    return;
  }
  if (state === 'paused') {
    if (lifecyclePaused) return;
    lifecyclePaused = true;
    clearInterval(fadeTimer);
    clearInterval(transitionTimer);
    fadeTimer = null;
    transitionTimer = null;
    stopAllSfx();
    if (music && !music.paused) {
      try {
        music.volume = 0;
        music.pause();
      } catch {
        recordAudioDiag('cleanupError', { reason: 'lifecycle-pause-failed' });
      }
    }
    return;
  }
  if (state === 'resumed') {
    if (!lifecyclePaused && !shuttingDown) return;
    lifecyclePaused = false;
    shuttingDown = false;
    if (prefs.music && unlocked && wantedSlot) {
      if (music && musicSlot && musicGroup === wantedSlot) {
        try {
          music.volume = 0;
          Promise.resolve(music.play()).then(() => fadeTo(targetMusicVolume(), 500)).catch(() => {
            recordAudioDiag('promiseRejected', { slot: musicSlot, reason: 'resume-play-blocked' });
          });
        } catch { /* ignore */ }
      } else {
        playMusic(wantedSlot);
      }
    }
  }
}

if (typeof globalThis !== 'undefined') {
  globalThis.bqOnAppLifecycle = handleLifecycleState;
}

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    handleLifecycleState(document.hidden ? 'paused' : 'resumed');
  });
}
if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
  window.addEventListener('pagehide', () => shutdownAudio());
}

// ---- Sound Match clips (assets/audio/match_*.mp3, Mixkit) -----------------------------------------
/** The Sound Match clips listed in the manifest: [{ slot, name, mood }]. Empty when offline before the first load. */
export async function matchSounds() { await manifest(); return matchInfo.map(m => ({ ...m })); }
let matchPlaying = null;
/** Plays one Sound Match clip, stopping the previous one. These clips are the game itself, so they play even
 *  when sound effects are switched off in Settings. Resolves to the playing element, or null if it could not play. */
export async function playMatchSound(slot) {
  unlocked = true;
  const have = await manifest();
  if (!have.has(slot)) return null;
  if (matchPlaying) { try { matchPlaying.volume = 0; matchPlaying.pause(); } catch { /* already stopped */ } }
  try {
    const a = element(slot);
    connectMediaElement(a);
    a.volume = Math.max(prefs.sfxVolume, 0.6);
    try { a.currentTime = 0; } catch { /* ignore */ }
    matchPlaying = a;
    await a.play();
    return a;
  } catch {
    recordAudioDiag('playFailed', { slot, reason: 'match-sound-failed' });
    return null;
  }
}
export function stopMatchSound() {
  if (matchPlaying) {
    try { matchPlaying.volume = 0; matchPlaying.pause(); } catch { /* ignore */ }
    matchPlaying = null;
  }
}
