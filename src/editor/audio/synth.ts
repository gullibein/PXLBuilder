/**
 * Plays the game's sounds with the browser's Web Audio. Step sounds (core/audio/steps.ts) are turned into
 * samples and played as they are. Older recipes (core/audio/sound.ts):
 * one oscillator (or noise) per layer, its pitch sliding through the
 * layer's points, an optional wobble and filter, faded in and out. Made on
 * the spot each time, so nothing is downloaded and no files are needed.
 */
import type { GameSound, SoundRecipe } from '../../core/audio/sound';
import { isStepSound, renderSteps, type StepSound } from '../../core/audio/steps';

let shared: AudioContext | null = null;

/**
 * Keeps the game's audio ready while it plays: a silent signal so the computer's sound output doesn't fall asleep
 * between sounds (the first sound after a quiet while would come late, or not at all), and the audio woken up again
 * as soon as the page is back in view or anything is pressed (browsers pause it in a hidden tab, another app, or
 * before the first click). Returns the way to let it rest again.
 */
export function keepAudioAwake(ac: AudioContext | null = audio()): () => void {
  if (!ac) return () => undefined;
  const keep = awake.get(ac) ?? { since: ac.currentTime, keepers: 0 };
  keep.keepers++;
  awake.set(ac, keep);
  const silence = ac.createConstantSource();
  const mute = ac.createGain();
  mute.gain.value = 0;
  silence.offset.value = 0;
  silence.connect(mute);
  mute.connect(ac.destination);
  silence.start();
  const wake = () => {
    if (ac.state !== 'running' && ac.state !== 'closed') void ac.resume().catch(() => undefined);
  };
  const onVisible = () => document.visibilityState === 'visible' && wake();
  document.addEventListener('visibilitychange', onVisible);
  window.addEventListener('focus', wake);
  window.addEventListener('pointerdown', wake, true);
  window.addEventListener('keydown', wake, true);
  wake();
  return () => {
    if (--keep.keepers <= 0) awake.delete(ac);
    try {
      silence.stop();
    } catch {
      // already stopped
    }
    mute.disconnect();
    document.removeEventListener('visibilitychange', onVisible);
    window.removeEventListener('focus', wake);
    window.removeEventListener('pointerdown', wake, true);
    window.removeEventListener('keydown', wake, true);
  };
}

/** Audio kept awake (keepAudioAwake): since when (the audio clock), and by how many. */
const awake = new WeakMap<AudioContext, { since: number; keepers: number }>();
/** Silence the sound output needs before music starts: speakers and headphones fade in what comes first after a quiet time. */
const WARM_UP = 0.3;

/**
 * How long to wait (seconds) before starting music so its first note is heard in full: the sound output may fade in
 * what comes right after it wakes, so music starts only once it has been running (silently) for a moment.
 */
export function warmUpLead(ac: AudioContext): number {
  const keep = awake.get(ac);
  if (ac.state !== 'running' || !keep) return WARM_UP;
  return Math.max(0.05, keep.since + WARM_UP - ac.currentTime);
}

/** Makes the game's sounds ready to play at once (each step sound's audio made now, not on its first play). */
export function prepareSounds(sounds: Iterable<GameSound>, ac: AudioContext | null = audio()): void {
  if (!ac) return;
  for (const s of sounds) if (isStepSound(s)) stepBuffer(s, ac);
}

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

/** Step sounds as audio, made once per sound (sounds are never changed in place: an edit makes a new one). */
const rendered = new WeakMap<StepSound, AudioBuffer>();
function stepBuffer(sound: StepSound, ac: AudioContext): AudioBuffer {
  let buffer = rendered.get(sound);
  if (!buffer || buffer.sampleRate !== ac.sampleRate) {
    const samples = renderSteps(sound, ac.sampleRate);
    buffer = ac.createBuffer(1, Math.max(1, samples.length), ac.sampleRate);
    buffer.getChannelData(0).set(samples);
    rendered.set(sound, buffer);
  }
  return buffer;
}

export interface Playing {
  /** When it started (the audio clock, seconds). */
  startedAt: number;
  stop(): void;
}

/** Plays a game sound now. `pitch` 1 = as made (2 = an octave up); `volume` 0..1. */
export function playSound(sound: GameSound, opts: { volume?: number; pitch?: number } = {}, ac: AudioContext | null = audio()): Playing | null {
  if (!ac) return null;
  if (!isStepSound(sound)) {
    playRecipe(sound, opts, ac);
    return { startedAt: ac.currentTime, stop: () => undefined };
  }
  const source = ac.createBufferSource();
  source.buffer = stepBuffer(sound, ac);
  source.playbackRate.value = opts.pitch ?? 1;
  const gain = ac.createGain();
  gain.gain.value = opts.volume ?? 1;
  source.connect(gain);
  gain.connect(ac.destination);
  const startedAt = ac.currentTime + 0.01;
  source.start(startedAt);
  return {
    startedAt,
    stop: () => {
      try {
        source.stop();
      } catch {
        // already ended
      }
    },
  };
}
