// Client-side recording effects. Pitch shifting runs in a local AudioWorklet using
// SoundTouchJS 2.1.1; it changes pitch at playbackRate 1, so the speaker's timing
// and recording length are not stretched. No audio is sent to a processing service.
import { voiceEffectFor } from './voice-playback.js';

const PROCESSOR_URL = new URL('./soundtouch-processor.js', import.meta.url).href;
const PROCESSOR_NAME = 'soundtouch-processor';

function unsupported() { return new Error('voice_effect_unsupported'); }

/**
 * Creates a local microphone-to-recorder pipeline for one selected voice style.
 * Call prepare() directly from the Record button handler before requesting the
 * microphone, then pass the microphone stream to connect(). dispose() is safe to
 * call after recording, cancellation, or a setup failure.
 */
export function createVoiceEffectPipeline(style, {
  AudioContextClass = globalThis.AudioContext || globalThis.webkitAudioContext,
  AudioWorkletNodeClass = globalThis.AudioWorkletNode,
  processorUrl = PROCESSOR_URL,
} = {}) {
  const effect = voiceEffectFor(style);
  let context = null, destination = null, prepared = false, connected = false, disposed = false;
  const nodes = [], oscillators = [];

  function track(node) { if (node) nodes.push(node); return node; }
  function startOscillator(oscillator) {
    track(oscillator); oscillators.push(oscillator); oscillator.start();
  }
  function disconnect(node) {
    try { node?.disconnect?.(); } catch { /* Already disconnected. */ }
  }
  function dispose() {
    if (disposed) return;
    disposed = true;
    for (const oscillator of oscillators) { try { oscillator.stop(); } catch { /* It may not have started. */ } }
    for (const node of nodes) disconnect(node);
    for (const track of destination?.stream?.getTracks?.() || []) { try { track.stop(); } catch { /* Ignore a stopped track. */ } }
    try {
      const closing = context && context.state !== 'closed' ? context.close?.() : null;
      closing?.catch?.(() => {});
    } catch { /* Context cleanup must not interrupt cancelling a recording. */ }
  }
  function setParam(node, name, value) {
    const param = node.parameters?.get?.(name);
    if (!param) throw unsupported();
    try { param.value = value; }
    catch { try { param.setValueAtTime(value, context.currentTime); } catch { throw unsupported(); } }
    return param;
  }

  return {
    effect,
    async prepare() {
      if (effect.kind === 'natural') { prepared = true; return; }
      if (disposed) throw unsupported();
      if (typeof AudioContextClass !== 'function') throw unsupported();
      try {
        context = new AudioContextClass();
        // resume() is invoked synchronously from the user's Record action.
        const resume = context.state === 'suspended' ? context.resume?.() : null;
        if (effect.kind === 'pitch') {
          if (!context.audioWorklet?.addModule || typeof AudioWorkletNodeClass !== 'function') throw unsupported();
          await context.audioWorklet.addModule(processorUrl);
        }
        if (resume) await resume;
        if (disposed) throw unsupported();
        prepared = true;
      } catch (error) {
        dispose();
        if (error?.message === 'voice_effect_unsupported') throw error;
        throw unsupported();
      }
    },
    connect(inputStream) {
      if (!inputStream) throw new TypeError('A microphone stream is required.');
      if (effect.kind === 'natural') return inputStream;
      if (!prepared || disposed || connected || !context) throw unsupported();
      try {
        const source = track(context.createMediaStreamSource(inputStream));
        destination = track(context.createMediaStreamDestination());
        connected = true;

        if (effect.kind === 'robot') {
          // A band-pass filter plus a low-level 35 Hz amplitude modulator gives
          // the real microphone voice an electronic/robotic tone; it adds no carrier.
          const filter = track(context.createBiquadFilter());
          filter.type = 'bandpass'; filter.frequency.value = 1100; filter.Q.value = 0.85;
          const gain = track(context.createGain()); gain.gain.value = 0.56;
          const oscillator = context.createOscillator(); oscillator.type = 'sine'; oscillator.frequency.value = 35;
          const depth = track(context.createGain()); depth.gain.value = 0.42;
          source.connect(filter); filter.connect(gain); gain.connect(destination);
          oscillator.connect(depth); depth.connect(gain.gain); startOscillator(oscillator);
          return destination.stream;
        }

        const shifter = track(new AudioWorkletNodeClass(context, PROCESSOR_NAME, {
          numberOfInputs: 1,
          numberOfOutputs: 1,
          outputChannelCount: [2],
          processorOptions: { sampleBufferType: 'circular', interpolationStrategy: 'lanczos' },
        }));
        const pitch = setParam(shifter, 'pitch', 1);
        const pitchSemitones = setParam(shifter, 'pitchSemitones', effect.semitones);
        const playbackRate = setParam(shifter, 'playbackRate', 1);
        // Keep an explicit unity rate: effects move pitch, never speaking tempo.
        playbackRate.value = 1;
        let first = source;
        if (effect.highpass) {
          const filter = track(context.createBiquadFilter());
          filter.type = 'highpass'; filter.frequency.value = effect.highpass;
          source.connect(filter); first = filter;
        }
        first.connect(shifter); shifter.connect(destination);
        if (effect.vibrato) {
          const oscillator = context.createOscillator(); oscillator.type = 'sine';
          oscillator.frequency.value = effect.vibrato.rate;
          const depth = track(context.createGain()); depth.gain.value = effect.vibrato.depth;
          oscillator.connect(depth); depth.connect(pitchSemitones); startOscillator(oscillator);
        }
        // Touch the base pitch parameter above before returning, so unsupported
        // or incompatible processors fail during setup rather than silently recording.
        void pitch;
        return destination.stream;
      } catch (error) {
        dispose();
        if (error?.message === 'voice_effect_unsupported') throw error;
        throw unsupported();
      }
    },
    dispose,
  };
}

export const VOICE_EFFECT_PROCESSOR_URL = PROCESSOR_URL;
