// Sender-selected effects are baked into the microphone recording. Playback controls
// intentionally change speed only, so a listener cannot replace the sender's style.
const EFFECTS = Object.freeze([
  { id: 'natural', label: 'Natural', kind: 'natural', semitones: 0 },
  { id: 'higher', label: 'Higher voice', kind: 'pitch', semitones: 4 },
  { id: 'lower', label: 'Lower voice', kind: 'pitch', semitones: -4 },
  { id: 'chipmunk', label: 'Chipmunk', kind: 'pitch', semitones: 10 },
  { id: 'alien', label: 'Alien', kind: 'pitch', semitones: 6, vibrato: { rate: 4.5, depth: 1.2 }, highpass: 260 },
  { id: 'robot', label: 'Robot', kind: 'robot' },
]);
const SPEEDS = Object.freeze([
  { rate: 1, label: 'Normal' },
  { rate: 1.25, label: 'Faster' },
  { rate: 0.75, label: 'Slower' },
]);
const STYLE_KEY = 'blindquiz.voice-recording-style.v1';
const SPEED_KEY = 'blindquiz.voice-speed.v1';
let sessionStylePreference = 'natural';
const effectFor = style => EFFECTS.find(effect => effect.id === style) || EFFECTS[0];
const speedFor = speed => SPEEDS.find(item => item.rate === Number(speed)) || SPEEDS[0];
const rateText = rate => Number.isInteger(rate) ? String(rate) : String(rate).replace(/0+$/, '').replace(/\.$/, '');

function storageFor(doc) {
  try { return doc?.defaultView?.localStorage || globalThis.localStorage; }
  catch { return null; }
}
function readPreference(storage, key, fallback, validate) {
  try { const value = storage?.getItem(key); return validate(value) ? value : fallback; }
  catch { return fallback; }
}
function writePreference(storage, key, value) {
  try { storage?.setItem(key, value); } catch { /* Private browsing can disable storage. */ }
}

/** Builds the sender's persistent effect selector; callers lock it while recording/reviewing. */
export function createVoiceEffectSelector(container, { id = 'voice-recording-style', label = 'Voice style', hint = true } = {}) {
  if (!container) return null;
  const doc = container.ownerDocument || globalThis.document;
  if (!doc) throw new TypeError('A document is required for the voice-style selector.');
  const storage = storageFor(doc);
  const wrap = doc.createElement('label'); wrap.className = 'voice-effect-control'; wrap.htmlFor = id;
  const caption = doc.createElement('span'); caption.textContent = label;
  const select = doc.createElement('select'); select.id = id; select.setAttribute('aria-label', label);
  for (const effect of EFFECTS) {
    const option = doc.createElement('option'); option.value = effect.id; option.textContent = effect.label; select.append(option);
  }
  select.value = readPreference(storage, STYLE_KEY, sessionStylePreference, value => EFFECTS.some(effect => effect.id === value));
  sessionStylePreference = select.value;
  wrap.append(caption, select);
  if (hint) {
    const help = doc.createElement('small'); help.id = `${id}-hint`; help.className = 'voice-effect-note';
    help.textContent = 'Applied to your real recording before you preview or send it; the recording stays the same length.';
    select.setAttribute('aria-describedby', help.id);
    wrap.append(help);
  }
  container.replaceChildren(wrap);
  const onChange = () => {
    sessionStylePreference = select.value;
    writePreference(storage, STYLE_KEY, select.value);
  };
  const refresh = () => {
    select.value = readPreference(storage, STYLE_KEY, sessionStylePreference, value => EFFECTS.some(effect => effect.id === value));
    sessionStylePreference = select.value;
    return select.value;
  };
  select.addEventListener('change', onChange);
  return {
    element: wrap,
    select,
    get value() { return select.value; },
    get disabled() { return select.disabled; },
    set disabled(value) { select.disabled = !!value; },
    setLocked(value) { select.disabled = !!value; },
    refresh,
    destroy() { select.removeEventListener('change', onChange); },
  };
}

/** Applies a listener's playback speed while preserving the already-recorded voice pitch. */
export function applyVoicePlayback(audio, speed = 1) {
  if (!audio) return 1;
  const rate = speedFor(speed).rate;
  for (const property of ['preservesPitch', 'mozPreservesPitch', 'webkitPreservesPitch']) {
    try { audio[property] = true; } catch { /* Use whichever native spelling this browser supports. */ }
  }
  try { audio.playbackRate = rate; } catch { /* Leave native controls usable if a browser locks this property. */ }
  return rate;
}

/** Builds a single-button speed cycle: normal, faster, slower, then normal. */
export function createVoicePlaybackControls(audio, { idPrefix = 'voice-message', label = 'Voice message', note = false } = {}) {
  const doc = audio?.ownerDocument || globalThis.document;
  if (!doc || !audio) throw new TypeError('An audio element is required for voice playback controls.');
  const prefix = String(idPrefix).replace(/[^a-zA-Z0-9_-]/g, '-') || 'voice-message';
  const storage = storageFor(doc);
  const box = doc.createElement('div'); box.className = 'voice-playback-controls';
  const wrap = doc.createElement('div'); wrap.className = 'voice-playback-control';
  const caption = doc.createElement('span'); caption.textContent = 'Playback speed';
  const button = doc.createElement('button'); button.type = 'button'; button.className = 'button button-quiet voice-speed-button'; button.id = `${prefix}-speed`;
  let speed = speedFor(readPreference(storage, SPEED_KEY, '1', value => SPEEDS.some(item => item.rate === Number(value))));
  const update = () => {
    const text = `${speed.label} (${rateText(speed.rate)}×)`;
    button.textContent = `Playback speed: ${text}`;
    button.setAttribute('aria-label', `${label}: playback speed ${speed.label.toLowerCase()}, ${rateText(speed.rate)} times normal. Activate to change.`);
    button.dataset.speed = String(speed.rate);
    applyVoicePlayback(audio, speed.rate);
  };
  button.addEventListener('click', () => {
    const index = SPEEDS.findIndex(item => item.rate === speed.rate);
    speed = SPEEDS[(index + 1) % SPEEDS.length];
    writePreference(storage, SPEED_KEY, String(speed.rate));
    update();
  });
  wrap.append(caption, button); box.append(wrap);
  if (note) {
    const hint = doc.createElement('small'); hint.id = `${prefix}-speed-note`; hint.className = 'voice-playback-note';
    hint.textContent = 'The sender’s voice style is part of the recording. This changes only your playback speed.';
    button.setAttribute('aria-describedby', hint.id);
    box.append(hint);
  }
  update();
  return { element: box, speedButton: button, apply: update, get speed() { return speed.rate; } };
}

export function voiceEffectLabel(style) { return effectFor(style).label; }
export function voiceEffectFor(style) { return effectFor(style); }
export const VOICE_EFFECTS = EFFECTS;
export const VOICE_PLAYBACK_SPEEDS = SPEEDS;
