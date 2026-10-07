/**
 * Plays sound recipes (core/audio/sound.ts) with the browser's Web Audio:
 * one oscillator (or noise) per layer, its pitch sliding through the
 * layer's points, an optional wobble and filter, faded in and out. Made on
 * the spot each time, so nothing is downloaded and no files are needed.
 */
import type { SoundRecipe } from '../../core/audio/sound';

let shared: AudioContext | null = null;

/** The page's audio (made on first use; browsers start it on a click or key press). Null where there is none. */
export function audio(): AudioContext | null {
  try {
    if (!shared) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return null;
      shared = new Ctor();
    }
    if (shared.state === 'suspended') void shared.resume();
    return shared;
  } catch {
    return null;
  }
}

let noise: AudioBuffer | null = null;
function whiteNoise(ac: AudioContext): AudioBuffer {
  if (!noise || noise.sampleRate !== ac.sampleRate) {
    noise = ac.createBuffer(1, ac.sampleRate * 2, ac.sampleRate);
    const data = noise.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  }
  return noise;
}

/** Plays the recipe now. `pitch` 1 = as made (2 = an octave up); `volume` 0..1. */
export function playRecipe(recipe: SoundRecipe, opts: { volume?: number; pitch?: number } = {}, ac: AudioContext | null = audio()): void {
  if (!ac) return;
  const pitch = opts.pitch ?? 1;
  const t0 = ac.currentTime + 0.01;
  const master = ac.createGain();
  master.gain.value = recipe.volume * (opts.volume ?? 1);
  master.connect(ac.destination);
  for (const l of recipe.layers) {
    const start = t0 + l.start;
    const end = start + l.length;
    let source: AudioScheduledSourceNode;
    if (l.wave === 'noise') {
      const b = ac.createBufferSource();
      b.buffer = whiteNoise(ac);
      b.loop = true;
      b.playbackRate.value = pitch;
      source = b;
    } else {
      const osc = ac.createOscillator();
      osc.type = l.wave;
      const f = osc.frequency;
      const [first, ...rest] = l.pitch;
      f.setValueAtTime(first[1] * pitch, start);
      let at = start;
      for (const [t, hz] of rest) {
        at = Math.max(at + 0.001, start + t);
        f.exponentialRampToValueAtTime(hz * pitch, at);
      }
      if (l.vibrato && l.vibrato.depth > 0) {
        const lfo = ac.createOscillator();
        lfo.frequency.value = l.vibrato.rate;
        const depth = ac.createGain();
        depth.gain.value = first[1] * pitch * l.vibrato.depth;
        lfo.connect(depth);
        depth.connect(f);
        lfo.start(start);
        lfo.stop(end + 0.05);
      }
      source = osc;
    }
    let node: AudioNode = source;
    if (l.filter) {
      const filter = ac.createBiquadFilter();
      filter.type = l.filter.type;
      filter.frequency.value = l.filter.freq;
      filter.Q.value = l.filter.q;
      node.connect(filter);
      node = filter;
    }
    const env = ac.createGain();
    const attack = Math.min(l.attack, l.length);
    const fadeAt = Math.max(start + attack, end - Math.min(l.release, l.length));
    env.gain.setValueAtTime(0, start);
    env.gain.linearRampToValueAtTime(l.volume, start + Math.max(0.001, attack));
    env.gain.setValueAtTime(l.volume, fadeAt);
    env.gain.linearRampToValueAtTime(0, end);
    node.connect(env);
    env.connect(master);
    source.start(start);
    source.stop(end + 0.05);
  }
}
