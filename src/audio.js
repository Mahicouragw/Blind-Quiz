// Recorded game sound effects and music (CC0 / Public domain recordings from Wikimedia Commons,
// see AUDIO_LICENSES.md). This module plays them with plain HTML audio elements; game audio is not
// synthesized. Voice-message processing is handled separately in voice-dsp.js. If a file is missing
// or the browser blocks playback, the game simply continues silently; every sound also has a
// text/announcement equivalent.
const BASE = './assets/audio/';
const SFX = ['correct', 'wrong', 'tick', 'go', 'timeup', 'applause', 'cheer', 'click', 'levelup', 'coin', 'notify'];
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
let music = null, musicSlot = null, fadeTimer = null, unlocked = false, wantedSlot = null;

let pending = null;
let matchInfo = [];
const versions = new Map(); // slot -> file size, appended to the URL so replaced recordings are never served stale
// The manifest is cached once it loads; a failed load (e.g. offline) is retried on the next sound.
async function manifest() {
  if (available) return available;
  if (!pending) pending = (async () => {
    try {
      const res = await fetch(`${BASE}manifest.json`, { cache: 'no-cache' });
      if (!res.ok) return new Set();
      const data = await res.json();
      const found = new Set(Object.keys(data.assets || {}).filter(k => SFX.includes(k) || isTrack(k) || /^match_[a-z0-9_]+$/.test(k)));
      matchInfo = [...found].filter(k => k.startsWith('match_')).map(k => ({ slot: k, name: String(data.assets[k].name || k.slice(6).replace(/_/g, ' ')), mood: String(data.assets[k].mood || 'interesting') }));
      for (const k of found) versions.set(k, data.assets[k].bytes || 0);
      if (found.size) available = found;
      return found;
    } catch { return new Set(); } finally { pending = null; }
  })();
  return pending;
}
function element(slot) {
  if (!cache.has(slot)) { const a = new Audio(`${BASE}${slot}.mp3${versions.get(slot) ? `?v=${versions.get(slot)}` : ''}`); a.preload = 'auto'; cache.set(slot, a); }
  return cache.get(slot);
}

export function configureAudio(next = {}) {
  Object.assign(prefs, next);
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
  const have = await manifest();
  if (!have.has(slot)) return null;
  try {
    const a = element(slot).cloneNode();
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
  if (view === 'soundmatch') return null; // Sound Match is played by ear: no background music over the clues
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
  if (!have.has(slot)) slot = have.has('music_menu') ? 'music_menu' : null;
  if (!slot) return;
  if (musicGroup === slot && music && !music.paused) return;
  const list = [slot, ...[...have].filter(k => new RegExp(`^${slot}\\d+$`).test(k)).sort((a, b) => parseInt(a.slice(slot.length), 10) - parseInt(b.slice(slot.length), 10))];
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

/** Browsers only allow sound after a user gesture; call this from the first tap or key press. */
export function unlockAudio() {
  if (unlocked) return;
  unlocked = true;
  if (wantedSlot) playMusic(wantedSlot);
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
    a.volume = Math.max(prefs.sfxVolume, 0.6);
    a.currentTime = 0;
    matchPlaying = a;
    await a.play();
    return a;
  } catch { return null; }
}
export function stopMatchSound() { if (matchPlaying) { try { matchPlaying.pause(); } catch { /* ignore */ } matchPlaying = null; } }
