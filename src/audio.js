// Recorded game sound effects and music (CC0 / Public domain recordings from Wikimedia Commons,
// see AUDIO_LICENSES.md). This module plays them with plain HTML audio elements; game audio is not
// synthesized. Voice-message processing is handled separately in voice-dsp.js. If a file is missing
// or the browser blocks playback, the game simply continues silently; every sound also has a
// text/announcement equivalent.
const BASE = './assets/audio/';
const OVERRIDES_URL = 'https://zchircgdkyjnowqcdwvf.supabase.co/storage/v1/object/public/bq-audio/overrides.json';
// Recorded effects. 'tick_last' and 'hurry' mark the last seconds of a question, 'streak' marks a
// run of correct answers, and 'countdown' plays on Ready 3, 2, 1. A slot that is missing from the manifest is simply silent.
const SFX = ['correct', 'wrong', 'tick', 'tick_last', 'countdown', 'hurry', 'go', 'timeup', 'applause', 'cheer', 'click', 'levelup', 'coin', 'notify', 'streak', 'roundcomplete', 'swipe'];
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
let audioContext = null;
let unlockPrimer = null;
let unlockPrimerStarted = false;
const mediaNodes = new WeakMap();
let music = null, musicSlot = null, fadeTimer = null, unlocked = false, wantedSlot = null;

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
    Promise.resolve(attempt).then(() => { unlockPrimerStarted = true; }).catch(() => {});
  } catch { /* Web Audio resume remains available as the primary unlock path. */ }
}

function connectMediaElement(audio) {
  if (!audioContext || audioContext.state !== 'running' || mediaNodes.has(audio)) return;
  try {
    const source = audioContext.createMediaElementSource(audio);
    source.connect(audioContext.destination);
    mediaNodes.set(audio, source);
  } catch { /* Older WebViews can keep using ordinary HTML audio playback. */ }
}

let pending = null;
let matchInfo = [];
const versions = new Map(); // slot -> file size, appended to the URL so replaced recordings are never served stale
const customOverrides = new Map(); // slot -> { url, fileName, updatedAt } published live by the admin

export function applyAudioOverrides(slots = {}) {
  customOverrides.clear();
  if (slots && typeof slots === 'object') {
    for (const [slot, meta] of Object.entries(slots)) {
      const url = typeof meta === 'string' ? meta : meta?.url;
      if (typeof url === 'string' && url) {
        customOverrides.set(slot, {
          url,
          fileName: typeof meta?.fileName === 'string' ? meta.fileName : `${slot}.mp3`,
          updatedAt: typeof meta?.updatedAt === 'string' ? meta.updatedAt : '',
        });
        if (available) available.add(slot);
      }
    }
  }
  cache.clear();
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('bq.audioOverrides.v1', JSON.stringify(Object.fromEntries(customOverrides)));
    }
  } catch { /* ignore storage errors */ }
}

export function getAudioOverrides() {
  return Object.fromEntries(customOverrides);
}

export function hasAudioOverride(slot) {
  return customOverrides.has(slot);
}

export async function fetchAudioOverrides() {
  try {
    const res = await fetch(`${OVERRIDES_URL}?t=${Date.now()}`, { cache: 'no-store' });
    if (!res?.ok) return getAudioOverrides();
    const data = await res.json();
    if (data && typeof data.slots === 'object' && data.slots) applyAudioOverrides(data.slots);
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
      fetchAudioOverrides().catch(() => {});
      return found;
    } catch { return new Set(customOverrides.keys()); } finally { pending = null; }
  })();
  return pending;
}
function element(slot) {
  if (!cache.has(slot)) {
    const custom = customOverrides.get(slot);
    const src = custom?.url || `${BASE}${slot}.mp3${versions.get(slot) ? `?v=${versions.get(slot)}` : ''}`;
    const a = new Audio(src);
    a.preload = 'auto';
    cache.set(slot, a);
  }
  return cache.get(slot);
}

export function configureAudio(next = {}) {
  // Only known keys are applied, and an unknown value never overwrites a working one.
  for (const key of ['sfx', 'music']) if (typeof next[key] === 'boolean') prefs[key] = next[key];
  for (const key of ['sfxVolume', 'musicVolume']) {
    const value = Number(next[key]);
    if (Number.isFinite(value)) prefs[key] = Math.min(1, Math.max(0, value));
  }
  if (music) music.volume = prefs.musicVolume;
  if (!prefs.music) stopMusic();
  else if (wantedSlot && unlocked) playMusic(wantedSlot);
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
  if (!prefs.sfx) return null;
  unlocked = true;
  if (slot === 'cheer' && customOverrides.has('roundcomplete') && !customOverrides.has('cheer')) slot = 'roundcomplete';
  const have = await manifest();
  let target = slot;
  if (!customOverrides.has(slot) && !have.has(slot) && FALLBACK[slot] && (customOverrides.has(FALLBACK[slot]) || have.has(FALLBACK[slot]))) target = FALLBACK[slot];
  if (!customOverrides.has(target) && !have.has(target)) return null;
  try {
    const a = element(target).cloneNode();
    connectMediaElement(a);
    a.volume = prefs.sfxVolume;
    playing.add(a);
    a.addEventListener('ended', () => playing.delete(a), { once: true });
    await a.play();
    return a;
  } catch { return null; /* autoplay blocked or unsupported: silent fallback */ }
}
function fadeOutEffect(a, ms = 300) {
  const start = a.volume, steps = Math.max(1, Math.round(ms / 50));
  let i = 0;
  const t = setInterval(() => { i++; a.volume = Math.max(0, start * (1 - i / steps)); if (i >= steps) { clearInterval(t); a.pause(); playing.delete(a); } }, 50);
}
/**
 * Plays effects one after another instead of on top of each other, e.g. ['applause', 'levelup'].
 * Each step plays for at most `maxMs` (then fades out) before the next one starts. Music is lowered
 * while the sequence plays so spoken announcements stay clear. A newer sequence replaces an older one.
 */
export async function playSequence(slots, { maxMs = 1800 } = {}) {
  const id = ++sequenceId;
  if (music && prefs.music) music.volume = Math.min(music.volume, prefs.musicVolume * 0.4);
  for (let k = 0; k < slots.length; k++) {
    if (id !== sequenceId) return;
    const a = await playSfx(slots[k]);
    const last = k === slots.length - 1;
    if (!a) continue;
    if (last) { a.addEventListener('ended', () => { if (id === sequenceId && music && prefs.music && musicSlot) fadeTo(prefs.musicVolume, 800); }, { once: true }); return; }
    await new Promise(resolve => { const t = setTimeout(resolve, maxMs); a.addEventListener('ended', () => { clearTimeout(t); resolve(); }, { once: true }); });
    if (!a.ended) fadeOutEffect(a);
  }
  if (id === sequenceId && music && prefs.music && musicSlot) fadeTo(prefs.musicVolume, 800);
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

function fadeTo(target, ms, done) {
  clearInterval(fadeTimer);
  if (!music) { done?.(); return; }
  const start = music.volume, steps = Math.max(1, Math.round(ms / 50));
  let i = 0;
  fadeTimer = setInterval(() => {
    i++;
    if (music) music.volume = Math.max(0, Math.min(1, start + (target - start) * (i / steps)));
    if (i >= steps) { clearInterval(fadeTimer); done?.(); }
  }, 50);
}

export function musicFor(view, category, mode) {
  if (view === 'soundmatch' || view === 'countmatch') return null; // Keep recorded clips and spoken memory clues clear
  if (view === 'game') return GAME_TRACK[mode] && mode !== 'classic' ? GAME_TRACK[mode] : (GAME_TRACK[category] || 'music_game1');
  if (view === 'letters') return 'music_game2';
  if (view === 'results') return 'music_results';
  return 'music_menu';
}

/** Switches the background music playlist, cross-fading from the current track. */
export async function playMusic(slot) {
  if (slot == null) { wantedSlot = null; stopMusic(); return; }
  wantedSlot = slot;
  if (!prefs.music || !unlocked) return;
  const have = await manifest();
  if (!customOverrides.has(slot) && !have.has(slot)) slot = customOverrides.has('music_menu') || have.has('music_menu') ? 'music_menu' : null;
  if (!slot) return;
  if (musicGroup === slot && music && !music.paused) return;
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
  const startNext = () => {
    if (music) { music.pause(); music.onended = null; }
    music = element(track);
    connectMediaElement(music);
    musicSlot = track;
    musicGroup = group;
    music.loop = list.length === 1;
    music.onended = () => { if (musicGroup === group && prefs.music) { playlistTurn[group] = index + 2; startTrack(group, list, (index + 1) % list.length); } };
    music.volume = 0;
    music.currentTime = 0;
    try { Promise.resolve(music.play()).then(() => fadeTo(prefs.musicVolume, 1200)).catch(() => {}); } catch { /* blocked: retried on the next gesture */ }
  };
  if (music && !music.paused) fadeTo(0, 500, startNext); else startNext();
}

export function stopMusic() {
  if (!music) return;
  const m = music;
  fadeTo(0, 400, () => { m.pause(); });
  musicSlot = null;
  musicGroup = null;
}

/** Call directly from a user gesture. Resume Web Audio and prime HTML media for iOS/WebViews. */
export function unlockAudio() {
  unlocked = true;
  let resume = Promise.resolve(false);
  const Context = audioContextConstructor();
  if (Context) {
    try {
      if (!audioContext) audioContext = new Context();
      resume = audioContext.state === 'running' ? Promise.resolve(true) : Promise.resolve(audioContext.resume()).then(() => audioContext.state === 'running').catch(() => false);
    } catch { audioContext = null; }
  }
  primeMediaPlayback();
  if (wantedSlot) playMusic(wantedSlot);
  return resume;
}

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (!music) return;
    if (document.hidden) music.pause();
    else if (prefs.music && musicSlot) { try { Promise.resolve(music.play()).catch(() => {}); } catch { /* ignore */ } }
  });
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
  if (matchPlaying) { try { matchPlaying.pause(); } catch { /* already stopped */ } }
  try {
    const a = element(slot);
    connectMediaElement(a);
    a.volume = Math.max(prefs.sfxVolume, 0.6);
    a.currentTime = 0;
    matchPlaying = a;
    await a.play();
    return a;
  } catch { return null; }
}
export function stopMatchSound() { if (matchPlaying) { try { matchPlaying.pause(); } catch { /* ignore */ } matchPlaying = null; } }
