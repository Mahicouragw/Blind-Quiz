import assert from 'node:assert/strict';
import { createVoiceEffectPipeline } from '../src/voice-dsp.js';
import { voiceEffectFor, createVoiceEffectSelector, createVoicePlaybackControls } from '../src/voice-playback.js';

const inputTracks = [{ stop() {} }], inputStream = { getTracks: () => inputTracks };
const processorUrl = '/Blind-Quiz/src/soundtouch-processor.js';

class FakeNode {
  constructor() { this.connections = []; this.disconnected = false; }
  connect(target) { this.connections.push(target); return target; }
  disconnect() { this.disconnected = true; }
}
class FakeOscillator extends FakeNode {
  constructor() { super(); this.frequency = { value: 440 }; this.type = 'sine'; this.started = false; this.stopped = false; }
  start() { this.started = true; }
  stop() { this.stopped = true; }
}
class FakeContext {
  constructor() {
    this.state = 'suspended'; this.currentTime = 0; this.closed = false;
    this.modules = []; this.sources = []; this.filters = []; this.gains = []; this.oscillators = [];
    this.destination = { stream: { stopped: false, getTracks() { return [{ stop() { this.stopped = true; } }]; } } };
    this.audioWorklet = { addModule: async url => { this.modules.push(url); } };
  }
  async resume() { this.state = 'running'; }
  async close() { this.state = 'closed'; this.closed = true; }
  createMediaStreamSource(stream) { const node = new FakeNode(); node.stream = stream; this.sources.push(node); return node; }
  createMediaStreamDestination() { this.destinationNode = new FakeNode(); this.destinationNode.stream = this.destination.stream; return this.destinationNode; }
  createBiquadFilter() { const node = new FakeNode(); node.frequency = { value: 350 }; node.Q = { value: 1 }; node.type = 'lowpass'; this.filters.push(node); return node; }
  createGain() { const node = new FakeNode(); node.gain = { value: 1 }; this.gains.push(node); return node; }
  createOscillator() { const node = new FakeOscillator(); this.oscillators.push(node); return node; }
}
class FakeWorkletNode extends FakeNode {
  constructor(context, name, options) {
    super(); this.context = context; this.name = name; this.options = options;
    this.parameters = new Map([['pitch', { value: 1 }], ['pitchSemitones', { value: 0 }], ['playbackRate', { value: 0 }]]);
    context.workletNode = this;
  }
}

// Natural records the microphone stream as-is and has no Web Audio dependency.
{
  const pipeline = createVoiceEffectPipeline('natural', { AudioContextClass: null, AudioWorkletNodeClass: null });
  await pipeline.prepare();
  assert.equal(pipeline.connect(inputStream), inputStream);
  pipeline.dispose();
  assert.equal(voiceEffectFor('missing').id, 'natural');
}

// All pitch options alter pitch while keeping playbackRate at unity.
for (const [style, expectedSemitones] of [['higher', 4], ['lower', -4], ['chipmunk', 10], ['alien', 6]]) {
  let context;
  class Context extends FakeContext { constructor() { super(); context = this; } }
  const pipeline = createVoiceEffectPipeline(style, { AudioContextClass: Context, AudioWorkletNodeClass: FakeWorkletNode, processorUrl });
  await pipeline.prepare();
  assert.equal(context.state, 'running', `${style}: audio context resumes from the Record action`);
  assert.deepEqual(context.modules, [processorUrl], `${style}: processor is loaded from the local app`);
  const resultStream = pipeline.connect(inputStream);
  assert.equal(resultStream, context.destination.stream, `${style}: recorder receives the processed stream`);
  assert.equal(context.sources[0].stream, inputStream, `${style}: DSP starts from the real microphone`);
  const worklet = context.workletNode;
  assert.equal(worklet.name, 'soundtouch-processor');
  assert.equal(worklet.parameters.get('pitchSemitones').value, expectedSemitones);
  assert.equal(worklet.parameters.get('playbackRate').value, 1, `${style}: pitch changes do not alter speaking tempo`);
  assert.equal(context.sources[0].connections.at(-1), style === 'alien' ? context.filters[0] : worklet);
  if (style === 'alien') {
    assert.equal(context.oscillators[0].started, true, 'Alien adds gentle local vibrato to the real voice');
    assert.equal(context.oscillators[0].frequency.value, 4.5);
    assert(context.oscillators[0].connections[0].connections.includes(worklet.parameters.get('pitchSemitones')));
  }
  pipeline.dispose();
  assert.equal(context.closed, true, `${style}: AudioContext closes after recording`);
  assert.equal(context.oscillators.every(oscillator => oscillator.stopped), true);
}

// Robot is a real-voice band-pass/ring-modulation effect and needs no generated voice/carrier.
{
  let context;
  class Context extends FakeContext { constructor() { super(); this.audioWorklet = { addModule: async () => assert.fail('Robot does not need a pitch-shifter worklet') }; context = this; } }
  const pipeline = createVoiceEffectPipeline('robot', { AudioContextClass: Context, AudioWorkletNodeClass: null });
  await pipeline.prepare();
  const resultStream = pipeline.connect(inputStream);
  assert.equal(resultStream, context.destination.stream);
  assert.equal(context.sources[0].connections[0], context.filters[0]);
  assert.equal(context.filters[0].type, 'bandpass');
  assert.equal(context.filters[0].connections[0], context.gains[0]);
  assert.equal(context.gains[0].connections[0], context.destinationNode);
  assert.equal(context.oscillators[0].started, true);
  assert.equal(context.oscillators[0].connections[0].connections[0], context.gains[0].gain);
  pipeline.dispose();
  assert.equal(context.oscillators[0].stopped, true);
  assert.equal(context.closed, true);
}

// Unsupported pitch processing fails clearly instead of sending an unfiltered clip as if successful.
{
  let context;
  class Context extends FakeContext { constructor() { super(); context = this; } }
  const pipeline = createVoiceEffectPipeline('higher', { AudioContextClass: Context, AudioWorkletNodeClass: null });
  await assert.rejects(() => pipeline.prepare(), /voice_effect_unsupported/);
  assert.equal(context.closed, true);
}

// Playback UI is a speed-only normal -> faster -> slower -> normal cycle.
{
  class Element {
    constructor(tagName, ownerDocument) { this.tagName = tagName.toUpperCase(); this.ownerDocument = ownerDocument; this.children = []; this.dataset = {}; this.attributes = {}; this.listeners = new Map(); this.textContent = ''; }
    append(...items) { this.children.push(...items); }
    replaceChildren(...items) { this.children = items; }
    addEventListener(type, fn) { const list = this.listeners.get(type) || []; list.push(fn); this.listeners.set(type, list); }
    removeEventListener(type, fn) { this.listeners.set(type, (this.listeners.get(type) || []).filter(listener => listener !== fn)); }
    dispatchEvent(event) { for (const fn of this.listeners.get(event.type) || []) fn({ ...event, currentTarget: this }); }
    click() { for (const fn of this.listeners.get('click') || []) fn({ currentTarget: this }); }
    setAttribute(name, value) { this.attributes[name] = String(value); }
  }
  const memory = new Map(), view = { localStorage: { getItem: key => memory.get(key) ?? null, setItem: (key, value) => memory.set(key, value) }, addEventListener() {}, removeEventListener() {} };
  class CustomEvent {}
  view.CustomEvent = CustomEvent;
  const doc = { defaultView: view, createElement: tag => new Element(tag, doc) };
  const audio = new Element('audio', doc); audio.playbackRate = 1; audio.preservesPitch = false;
  const controls = createVoicePlaybackControls(audio, { idPrefix: 'unit-voice', label: 'Test voice' });
  const button = controls.speedButton;
  assert.equal(button.dataset.speed, '1');
  assert.equal(audio.preservesPitch, true);
  button.click(); assert.equal(button.dataset.speed, '1.25'); assert.equal(audio.playbackRate, 1.25);
  button.click(); assert.equal(button.dataset.speed, '0.75'); assert.equal(audio.playbackRate, 0.75);
  button.click(); assert.equal(button.dataset.speed, '1'); assert.equal(audio.playbackRate, 1);
  assert.equal(controls.element.children[0].children.some(child => child.tagName === 'SELECT'), false, 'listeners get no voice-style filter selector');

  // The sender's style remains available across chat/room selectors even when browser storage is blocked.
  const blockedView = {};
  Object.defineProperty(blockedView, 'localStorage', { get() { throw new Error('storage disabled'); } });
  const blockedDoc = { defaultView: blockedView, createElement: tag => new Element(tag, blockedDoc) };
  const firstContainer = new Element('div', blockedDoc), secondContainer = new Element('div', blockedDoc);
  const first = createVoiceEffectSelector(firstContainer, { id: 'first-style' });
  first.select.value = 'alien'; first.select.dispatchEvent({ type: 'change' });
  const second = createVoiceEffectSelector(secondContainer, { id: 'second-style' });
  assert.equal(second.value, 'alien');
  second.select.value = 'robot'; second.select.dispatchEvent({ type: 'change' });
  assert.equal(first.refresh(), 'robot', 'refresh uses the session preference if localStorage cannot be read');
  first.destroy(); second.destroy();
}

console.log('ok local voice DSP applies pitch/timbre to microphone audio at unity tempo, cleans up, and leaves recipients speed-only playback');
