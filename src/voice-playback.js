// Free, local playback controls for recorded voice messages. The original recording is never modified.
// Voice styles use the HTML media element's native playbackRate/preservesPitch controls; no audio synthesis,
// Web Audio processing, paid service, or external asset is needed.
const EFFECTS = Object.freeze([
  { id: 'natural', label: 'Natural', rate: 1 },
  { id: 'chipmunk', label: 'Chipmunk (high)', rate: 1.5 },
  { id: 'alien', label: 'Alien (deep)', rate: 0.72 },
  { id: 'robot', label: 'Robot (pitch shift)', rate: 1.12 },
]);
const SPEEDS = Object.freeze([0.5, 0.75, 1, 1.25, 1.5, 2]);
const STYLE_KEY = 'blindquiz.voice-style.v1';
const SPEED_KEY = 'blindquiz.voice-speed.v1';
const effectFor = style => EFFECTS.find(effect => effect.id === style) || EFFECTS[0];
const speedFor = speed => SPEEDS.includes(Number(speed)) ? Number(speed) : 1;

function readPreference(key, fallback, validate) {
  try { const value = globalThis.localStorage?.getItem(key); return validate(value) ? value : fallback; }
  catch { return fallback; }
}
function writePreference(key, value) {
  try { globalThis.localStorage?.setItem(key, value); } catch { /* Private browsing can disable storage. */ }
}

/** Applies a voice-style pitch multiplier and playback speed without moving the playhead. */
export function applyVoicePlayback(audio, style = 'natural', speed = 1) {
  if (!audio) return 1;
  const effect = effectFor(style), multiplier = speedFor(speed);
  const rate = Math.max(0.5, Math.min(2, effect.rate * multiplier));
  const preservePitch = effect.id === 'natural';
  for (const property of ['preservesPitch', 'mozPreservesPitch', 'webkitPreservesPitch']) {
    try { audio[property] = preservePitch; } catch { /* Use whichever native spelling this browser supports. */ }
  }
  try { audio.playbackRate = rate; } catch { /* Leave native controls usable if a browser locks this property. */ }
  return rate;
}

/** Builds accessible, persistent voice-style and speed selectors for an HTMLAudioElement. */
export function createVoicePlaybackControls(audio, { idPrefix = 'voice-message', label = 'Voice message', note = false } = {}) {
  const doc = audio?.ownerDocument || globalThis.document;
  if (!doc || !audio) throw new TypeError('An audio element is required for voice playback controls.');
  const prefix = String(idPrefix).replace(/[^a-zA-Z0-9_-]/g, '-') || 'voice-message';
  const box = doc.createElement('div'); box.className = 'voice-playback-controls';
  const makeSelect = (id, controlLabel, choices) => {
    const wrap = doc.createElement('label'); wrap.className = 'voice-playback-control'; wrap.htmlFor = id;
    const caption = doc.createElement('span'); caption.textContent = controlLabel;
    const select = doc.createElement('select'); select.id = id; select.setAttribute('aria-label', `${label}: ${controlLabel.toLowerCase()}`);
    for (const [value, text] of choices) { const option = doc.createElement('option'); option.value = value; option.textContent = text; select.append(option); }
    wrap.append(caption, select); return { wrap, select };
  };
  const styleControl = makeSelect(`${prefix}-effect`, 'Voice style', EFFECTS.map(effect => [effect.id, effect.label]));
  const speedControl = makeSelect(`${prefix}-speed`, 'Playback speed', SPEEDS.map(speed => [String(speed), `${speed}×`]));
  const styleSelect = styleControl.select, speedSelect = speedControl.select;
  styleSelect.value = readPreference(STYLE_KEY, 'natural', value => EFFECTS.some(effect => effect.id === value));
  speedSelect.value = readPreference(SPEED_KEY, '1', value => SPEEDS.includes(Number(value)));
  const apply = () => applyVoicePlayback(audio, styleSelect.value, speedSelect.value);
  styleSelect.addEventListener('change', () => { writePreference(STYLE_KEY, styleSelect.value); apply(); });
  speedSelect.addEventListener('change', () => { writePreference(SPEED_KEY, speedSelect.value); apply(); });
  box.append(styleControl.wrap, speedControl.wrap);
  if (note) {
    const hint = doc.createElement('small'); hint.className = 'voice-playback-note';
    hint.textContent = 'Free playback effects change the sound you hear only; the original recording stays unchanged.';
    box.append(hint);
  }
  apply();
  return { element: box, styleSelect, speedSelect, apply };
}

export const VOICE_EFFECTS = EFFECTS;
export const VOICE_PLAYBACK_SPEEDS = SPEEDS;
