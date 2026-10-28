/**
 * Plays songs from the music machine (core/audio/music.ts) with the browser's Web Audio. A song is turned into audio
 * a pattern at a time, a little before it is needed and a few notes per moment, so long songs start at once and the
 * game never stutters; each pattern's audio is kept and reused while the song doesn't change. Edits made while it
 * plays (update) are heard from the next pattern on.
 */
import { patternSeconds, renderNote, renderPatternInSteps, stepSeconds, type Instrument, type Rendered, type Song } from '../../core/audio/music';
import type { AssetRecord, Project } from '../../core/types';
import { audio } from './synth';

/** The sample rate songs are made at (the SNES's): the browser converts it. */
const RATE = 32000;
/** How far ahead of the music the patterns are made and queued, seconds. */
const LOOKAHEAD = 1.5;
/** Milliseconds of making audio per moment (the rest of the frame is the game's). */
const BUDGET_MS = 4;

export type InstrumentLookup = (id: string | null) => Instrument | null;

/** The project's instruments by id. */
export function instrumentsOf(project: Pick<Project, 'assets'>): InstrumentLookup {
  const map = new Map(project.assets.filter((a) => a.kind === 'instrument' && a.instrument).map((a) => [a.id, a.instrument!]));
  return (id) => (id ? (map.get(id) ?? null) : null);
}

export function songAsset(project: Pick<Project, 'assets'>, id: string | null | undefined): AssetRecord | undefined {
  return id ? project.assets.find((a) => a.id === id && a.kind === 'music' && a.song) : undefined;
}

export interface SongPlayer {
  /** The song (or its instruments) changed: heard from the next pattern on. */
  update(song: Song, instruments: InstrumentLookup): void;
  stop(): void;
  /** What is playing now: the place in the order and the step in the pattern (null before it starts or after it ends). */
  position(): { order: number; step: number } | null;
  /** It played to its end (a song that doesn't loop). */
  readonly done: boolean;
}

export interface SongOptions {
  /** Start at this place in the order. */
  from?: number;
  /** Play only this pattern, over and over (the editor's "play pattern"). */
  only?: number;
  /** Override the song's own loop setting. */
  loop?: boolean;
  volume?: number;
}

/** Plays a song now; null where there is no audio. */
export function playSong(first: Song, firstInstruments: InstrumentLookup, opts: SongOptions = {}, ac: AudioContext | null = audio()): SongPlayer | null {
  if (!ac) return null;
  let song = first;
  let instruments = firstInstruments;
  let cache = new Map<number, AudioBuffer>();
  let jobs = new Map<number, Generator<void, Rendered>>();
  const sequence = () => (opts.only !== undefined ? [opts.only] : song.order);
  const loops = () => (opts.only !== undefined ? true : (opts.loop ?? song.loop));

  const master = ac.createGain();
  master.gain.value = opts.volume ?? 1;
  // A gentle limiter: many loud channels at once don't crackle.
  const limiter = ac.createDynamicsCompressor();
  limiter.threshold.value = -6;
  limiter.knee.value = 6;
  limiter.ratio.value = 8;
  limiter.attack.value = 0.003;
  limiter.release.value = 0.15;
  master.connect(limiter);
  limiter.connect(ac.destination);

  const scheduled: { start: number; order: number; seconds: number; step: number; source: AudioBufferSourceNode }[] = [];
  let next = Math.min(Math.max(0, opts.from ?? 0), sequence().length - 1);
  let nextTime = ac.currentTime + 0.08;
  let ended = false;
  let endsAt = Infinity;
  let stopped = false;

  const toBuffer = (r: Rendered) => {
    const b = ac.createBuffer(2, Math.max(1, r.left.length), RATE);
    b.getChannelData(0).set(r.left);
    b.getChannelData(1).set(r.right);
    return b;
  };

  /** Works on the pattern's audio; true when it is ready. `force` finishes it now. */
  const make = (pattern: number, until: number, force: boolean): boolean => {
    if (cache.has(pattern)) return true;
    let job = jobs.get(pattern);
    if (!job) {
      job = renderPatternInSteps(song, pattern, instruments, RATE, pattern + 1);
      jobs.set(pattern, job);
    }
    for (;;) {
      const r = job.next();
      if (r.done) {
        cache.set(pattern, toBuffer(r.value));
        jobs.delete(pattern);
        return true;
      }
      if (!force && performance.now() > until) return false;
    }
  };

  const tick = () => {
    if (stopped) return;
    const until = performance.now() + BUDGET_MS;
    const seq = sequence();
    while (!ended && nextTime < ac.currentTime + LOOKAHEAD) {
      const pattern = seq[next];
      // Behind: it's needed very soon, so it's finished now.
      const urgent = nextTime - ac.currentTime < 0.25;
      if (!make(pattern, until, urgent)) return;
      const source = ac.createBufferSource();
      source.buffer = cache.get(pattern)!;
      source.connect(master);
      const start = Math.max(nextTime, ac.currentTime);
      source.start(start, start - nextTime);
      scheduled.push({ start: nextTime, order: next, seconds: patternSeconds(song), step: stepSeconds(song), source });
      source.onended = () => {
        const i = scheduled.findIndex((s) => s.source === source);
        if (i >= 0) scheduled.splice(i, 1);
      };
      nextTime += patternSeconds(song);
      next++;
      if (next >= seq.length) {
        if (loops()) next = 0;
        else {
          ended = true;
          endsAt = nextTime;
        }
      }
    }
    // Time left: the next pattern in the order gets a head start.
    if (!ended && performance.now() < until) make(seq[next], until, false);
  };

  tick();
  const timer = setInterval(tick, 25);

  return {
    update(s, i) {
      song = s;
      instruments = i;
      cache = new Map();
      jobs = new Map();
      if (next >= sequence().length) next = 0;
    },
    stop() {
      stopped = true;
      clearInterval(timer);
      for (const s of scheduled) {
        try {
          s.source.stop();
        } catch {
          // already ended
        }
      }
      scheduled.length = 0;
      // A moment later (no click), the chain is let go.
      master.gain.setTargetAtTime(0, ac.currentTime, 0.01);
      setTimeout(() => master.disconnect(), 100);
    },
    position() {
      const now = ac.currentTime;
      let at: (typeof scheduled)[number] | null = null;
      for (const s of scheduled) if (s.start <= now && now < s.start + s.seconds) at = s;
      if (!at) return null;
      return { order: at.order, step: Math.floor((now - at.start) / at.step) };
    },
    get done() {
      return stopped || (ended && ac.currentTime > endsAt + 0.5);
    },
  };
}

/**
 * Plays one note of an instrument (the instrument editor's keyboard, a note placed in a song). It is held up to
 * `held` seconds; release() lets it go sooner (it fades as the instrument's release says).
 */
export function playNote(inst: Instrument, pitch: number, held = 0.35, ac: AudioContext | null = audio()): { release(): void } | null {
  if (!ac) return null;
  const samples = renderNote(inst, pitch, held, RATE);
  const b = ac.createBuffer(1, Math.max(1, samples.length), RATE);
  b.getChannelData(0).set(samples);
  const source = ac.createBufferSource();
  source.buffer = b;
  const gain = ac.createGain();
  source.connect(gain);
  gain.connect(ac.destination);
  const start = ac.currentTime;
  source.start();
  return {
    release: () => {
      if (ac.currentTime - start >= held) return;
      gain.gain.setTargetAtTime(0, ac.currentTime, Math.max(0.005, inst.release / 4));
      setTimeout(() => {
        try {
          source.stop();
        } catch {
          // already ended
        }
      }, (inst.release + 0.05) * 1000 + 200);
    },
  };
}
