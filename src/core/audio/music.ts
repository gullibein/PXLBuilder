/**
 * The music machine's data and its synthesizer. An instrument is a shaped sound (a wave, an envelope, pitch moves,
 * and on the 16-bit chip a filter, FM and echo); a song is channels (each playing one instrument), patterns of
 * notes on a step grid, and the order the patterns play in. Turned into audio samples here, so a song sounds the
 * same in the editor, in play and in exported games, and can be checked in tests.
 *
 * 8-bit is the NES / Game Boy kind: pulse waves with a duty, a stepped triangle, noise; the volume moves in 16
 * steps, 60 times a second. 16-bit is the SNES / Mega Drive kind: smooth waves, FM, plucked strings, a resonant
 * filter and echo.
 */
import { z } from 'zod';

export const CHIPS = ['8bit', '16bit'] as const;
export type Chip = (typeof CHIPS)[number];

export const WAVES_8BIT = ['pulse50', 'pulse25', 'pulse12', 'triangle', 'noise', 'metal'] as const;
export const WAVES_16BIT = ['saw', 'square', 'triangle', 'sine', 'fm', 'pluck', 'supersaw', 'noise'] as const;
export const ALL_WAVES = [...new Set([...WAVES_8BIT, ...WAVES_16BIT])] as const;
export type MusicWave = (typeof WAVES_8BIT)[number] | (typeof WAVES_16BIT)[number];

export const WAVE_LABELS: Record<MusicWave, string> = {
  pulse50: 'Square',
  pulse25: 'Pulse 25%',
  pulse12: 'Pulse 12%',
  triangle: 'Triangle',
  noise: 'Noise',
  metal: 'Metal noise',
  saw: 'Saw',
  square: 'Square',
  sine: 'Sine',
  fm: 'FM',
  pluck: 'Pluck',
  supersaw: 'Supersaw',
};

export const FILTER_TYPES = ['lowpass', 'highpass', 'bandpass'] as const;

const sec = (max: number) => z.number().min(0).max(max);

export const instrumentSchema = z.object({
  type: z.literal('instrument'),
  chip: z.enum(CHIPS).describe('8bit: NES/Game Boy (pulse, triangle, noise; stepped volume). 16bit: SNES/Mega Drive (smooth waves, FM, pluck, filter, echo)'),
  wave: z.enum(ALL_WAVES as unknown as [MusicWave, ...MusicWave[]]).describe(`8bit waves: ${WAVES_8BIT.join(', ')}. 16bit waves: ${WAVES_16BIT.join(', ')}`),
  volume: z.number().min(0).max(1).default(0.7),
  attack: sec(4).default(0.005).describe('Seconds to full volume'),
  decay: sec(4).default(0.15).describe('Seconds from full volume down to sustain'),
  sustain: z.number().min(0).max(1).default(0.6).describe('Volume held while the note lasts (0 = a hit that dies away)'),
  release: sec(4).default(0.08).describe('Seconds to fade after the note ends'),
  pitchDrop: z.number().min(-48).max(48).default(0).describe('Semitones the note starts above (negative: below) its pitch, sliding to it: 24 over 0.08 s = a kick drum'),
  pitchTime: sec(2).default(0.05).describe('Seconds the pitch slide takes'),
  vibratoRate: z.number().min(0).max(20).default(0).describe('Wobbles per second (0 = none)'),
  vibratoDepth: z.number().min(0).max(2).default(0).describe('How far the pitch wobbles, semitones'),
  vibratoDelay: sec(2).default(0).describe('Seconds before the wobble starts'),
  arp: z.array(z.number().int().min(-24).max(24)).max(8).default([]).describe('Arpeggio: semitone offsets played in turn very fast, e.g. [0,4,7] = a major chord on one channel (the chiptune way)'),
  arpSpeed: z.number().min(1).max(60).default(20).describe('Arpeggio notes per second'),
  // 16-bit only:
  filter: z.enum(FILTER_TYPES).nullable().default(null).describe('16bit only'),
  cutoff: z.number().min(40).max(16000).default(2000).describe('Filter frequency, Hz'),
  resonance: z.number().min(0).max(0.95).default(0.2).describe('Filter peak (0 = soft, 0.9 = whistling)'),
  filterEnv: z.number().min(0).max(1).default(0).describe('How much the filter opens at the start of each note and closes over the decay (a "wow")'),
  fmRatio: z.number().min(0.25).max(16).default(2).describe('FM: the modulator frequency as a multiple of the note (1, 2: warm; 3.5, 7: bells)'),
  fmIndex: z.number().min(0).max(20).default(3).describe('FM: how bright/metallic (falls with the envelope)'),
  detune: z.number().min(0).max(50).default(12).describe('Supersaw: cents between the voices'),
  echoTime: sec(1).default(0).describe('Echo delay seconds (0 = no echo); 16bit only'),
  echoFeedback: z.number().min(0).max(0.9).default(0.35),
  echoMix: z.number().min(0).max(1).default(0.3),
});

export type Instrument = z.infer<typeof instrumentSchema>;
export type InstrumentInput = z.input<typeof instrumentSchema>;

export const MAX_CHANNELS = 12;
export const MAX_PATTERNS = 64;
export const MAX_ORDER = 256;
/** Steps per beat: a step is a 16th note. */
export const STEPS_PER_BEAT = 4;

/** [channel, step, pitch (MIDI: 60 = middle C), length in steps, velocity 0–1]. */
export type SongNote = [number, number, number, number, number];

export const songChannelSchema = z.object({
  name: z.string().max(40).default(''),
  /** The instrument asset's id. */
  instrument: z.string().nullable(),
  volume: z.number().min(0).max(1).default(0.8),
  pan: z.number().min(-1).max(1).default(0),
  mute: z.boolean().default(false),
  /** A drum channel (kick, snare, hats…): shown apart from the instruments, below them. */
  drum: z.boolean().default(false),
});

export const songPatternSchema = z.object({
  name: z.string().max(40).default(''),
  notes: z.array(z.tuple([z.number().int().min(0).max(MAX_CHANNELS - 1), z.number().int().min(0).max(63), z.number().int().min(12).max(108), z.number().int().min(1).max(64), z.number().min(0).max(1)])).max(2048),
});

export const songSchema = z.object({
  type: z.literal('song'),
  bpm: z.number().min(40).max(300).default(120),
  /** Steps in each pattern (16 = one bar of 16th notes). */
  steps: z.number().int().min(4).max(64).default(16),
  channels: z.array(songChannelSchema).min(1).max(MAX_CHANNELS),
  patterns: z.array(songPatternSchema).min(1).max(MAX_PATTERNS),
  /** The patterns in the order they play (indexes into patterns). */
  order: z.array(z.number().int().min(0).max(MAX_PATTERNS - 1)).min(1).max(MAX_ORDER),
  /** Starts over at the end (level music) or plays once (a jingle). */
  loop: z.boolean().default(true),
});

export type Song = z.infer<typeof songSchema>;
export type SongChannel = z.infer<typeof songChannelSchema>;
export type SongPattern = z.infer<typeof songPatternSchema>;

export function isInstrument(x: unknown): x is Instrument {
  return !!x && typeof x === 'object' && (x as { type?: unknown }).type === 'instrument';
}
export function isSong(x: unknown): x is Song {
  return !!x && typeof x === 'object' && (x as { type?: unknown }).type === 'song';
}

/** An instrument with every field filled in (and a wave the chip has). */
export function makeInstrument(input: Partial<InstrumentInput> & { chip: Chip; wave: MusicWave }): Instrument {
  const inst = instrumentSchema.parse({ type: 'instrument', ...input });
  if (!waveFits(inst.chip, inst.wave)) inst.wave = inst.chip === '8bit' ? 'pulse50' : 'saw';
  return inst;
}

export function waveFits(chip: Chip, wave: MusicWave): boolean {
  return (chip === '8bit' ? (WAVES_8BIT as readonly string[]) : (WAVES_16BIT as readonly string[])).includes(wave);
}

/** Ready-made instruments to start from. */
export const INSTRUMENT_PRESETS: { name: string; instrument: Instrument }[] = [
  { name: 'Square lead', instrument: makeInstrument({ chip: '8bit', wave: 'pulse50', attack: 0.01, decay: 0.2, sustain: 0.6, release: 0.05, vibratoRate: 6, vibratoDepth: 0.2, vibratoDelay: 0.25 }) },
  { name: 'Pulse lead', instrument: makeInstrument({ chip: '8bit', wave: 'pulse25', decay: 0.3, sustain: 0.5, release: 0.08 }) },
  { name: 'Thin pulse', instrument: makeInstrument({ chip: '8bit', wave: 'pulse12', decay: 0.2, sustain: 0.4, volume: 0.6 }) },
  { name: 'Triangle bass', instrument: makeInstrument({ chip: '8bit', wave: 'triangle', volume: 0.9, decay: 0.1, sustain: 1, release: 0.03 }) },
  { name: 'Chip arpeggio', instrument: makeInstrument({ chip: '8bit', wave: 'pulse12', arp: [0, 4, 7, 12], arpSpeed: 30, sustain: 0.5, volume: 0.5 }) },
  { name: 'Chip kick', instrument: makeInstrument({ chip: '8bit', wave: 'triangle', volume: 1, attack: 0, decay: 0.12, sustain: 0, release: 0.02, pitchDrop: 24, pitchTime: 0.07 }) },
  { name: 'Chip snare', instrument: makeInstrument({ chip: '8bit', wave: 'noise', volume: 0.7, attack: 0, decay: 0.15, sustain: 0, release: 0.02 }) },
  { name: 'Chip hi-hat', instrument: makeInstrument({ chip: '8bit', wave: 'metal', volume: 0.35, attack: 0, decay: 0.05, sustain: 0, release: 0.01 }) },
  { name: 'Saw lead', instrument: makeInstrument({ chip: '16bit', wave: 'saw', filter: 'lowpass', cutoff: 2400, resonance: 0.3, filterEnv: 0.4, decay: 0.3, sustain: 0.7, vibratoRate: 5, vibratoDepth: 0.15, vibratoDelay: 0.3, echoTime: 0.25, echoFeedback: 0.3, echoMix: 0.2, volume: 0.5 }) },
  { name: 'FM bass', instrument: makeInstrument({ chip: '16bit', wave: 'fm', fmRatio: 1, fmIndex: 4, decay: 0.25, sustain: 0.5, release: 0.05, volume: 0.8 }) },
  { name: 'FM bell', instrument: makeInstrument({ chip: '16bit', wave: 'fm', fmRatio: 3.5, fmIndex: 6, attack: 0, decay: 1.2, sustain: 0, release: 0.8, echoTime: 0.3, echoFeedback: 0.3, echoMix: 0.25, volume: 0.5 }) },
  { name: 'Electric piano', instrument: makeInstrument({ chip: '16bit', wave: 'fm', fmRatio: 1, fmIndex: 1.6, attack: 0.002, decay: 0.8, sustain: 0.25, release: 0.3, volume: 0.6 }) },
  { name: 'Pluck', instrument: makeInstrument({ chip: '16bit', wave: 'pluck', attack: 0, decay: 0.6, sustain: 0.3, release: 0.2, volume: 0.7, echoTime: 0.18, echoFeedback: 0.25, echoMix: 0.2 }) },
  { name: 'String pad', instrument: makeInstrument({ chip: '16bit', wave: 'supersaw', attack: 0.4, decay: 0.5, sustain: 0.8, release: 0.8, filter: 'lowpass', cutoff: 1800, resonance: 0.1, detune: 14, echoTime: 0.35, echoFeedback: 0.4, echoMix: 0.3, volume: 0.35 }) },
  { name: 'Kick', instrument: makeInstrument({ chip: '16bit', wave: 'sine', attack: 0, decay: 0.25, sustain: 0, release: 0.05, pitchDrop: 30, pitchTime: 0.06, volume: 1 }) },
  { name: 'Snare', instrument: makeInstrument({ chip: '16bit', wave: 'noise', filter: 'bandpass', cutoff: 2500, resonance: 0.2, attack: 0, decay: 0.18, sustain: 0, release: 0.05, volume: 0.7 }) },
  { name: 'Hi-hat', instrument: makeInstrument({ chip: '16bit', wave: 'noise', filter: 'highpass', cutoff: 7000, resonance: 0.1, attack: 0, decay: 0.05, sustain: 0, release: 0.02, volume: 0.35 }) },
];

export function preset(name: string): Instrument {
  const p = INSTRUMENT_PRESETS.find((x) => x.name === name);
  if (!p) throw new Error(`No preset "${name}"`);
  return structuredClone(p.instrument);
}

/** The instruments a new song of each chip starts with, a channel each. */
export const STARTER_KITS: Record<Chip, { instruments: string[]; drums: string[] }> = {
  '8bit': { instruments: ['Square lead', 'Pulse lead', 'Triangle bass'], drums: ['Chip kick', 'Chip snare', 'Chip hi-hat'] },
  '16bit': { instruments: ['Saw lead', 'Electric piano', 'FM bass'], drums: ['Kick', 'Snare', 'Hi-hat'] },
};

/** A new song: one empty pattern, a channel per instrument (drum channels marked). */
export function emptySong(instruments: { id: string | null; name: string; drum?: boolean }[], bpm = 120): Song {
  return songSchema.parse({
    type: 'song',
    bpm,
    steps: 16,
    channels: (instruments.length ? instruments : [{ id: null, name: 'Channel 1', drum: false }]).slice(0, MAX_CHANNELS).map((i) => ({ name: i.name, instrument: i.id, drum: i.drum ?? false })),
    patterns: [{ name: 'A', notes: [] }],
    order: [0],
    loop: true,
  });
}

export function midiHz(p: number): number {
  return 440 * 2 ** ((p - 69) / 12);
}

const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
/** "C4" (60), "F#5"… */
export function noteName(p: number): string {
  return `${NAMES[((p % 12) + 12) % 12]}${Math.floor(p / 12) - 1}`;
}

/** "C4", "f#3", "Bb2" → MIDI number, or null. */
export function parseNoteName(s: string): number | null {
  const m = /^([A-Ga-g])([#b]?)(-?\d)$/.exec(s.trim());
  if (!m) return null;
  const base = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 }[m[1].toLowerCase() as 'c'];
  const n = base + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0) + (Number(m[3]) + 1) * 12;
  return n >= 12 && n <= 108 ? n : null;
}

export function stepSeconds(song: Pick<Song, 'bpm'>): number {
  return 60 / song.bpm / STEPS_PER_BEAT;
}
export function patternSeconds(song: Pick<Song, 'bpm' | 'steps'>): number {
  return song.steps * stepSeconds(song);
}
export function songSeconds(song: Pick<Song, 'bpm' | 'steps' | 'order'>): number {
  return song.order.length * patternSeconds(song);
}

/** A small, seedable random number source (so the noise is the same each time). */
export function seeded(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
}

/** How long an instrument's sound goes on after a note ends (release, echo), seconds (at most 4). */
export function tailSeconds(inst: Instrument): number {
  let t = inst.release + 0.01;
  if (inst.wave === 'pluck' || inst.sustain === 0) t = Math.max(t, 0.05);
  if (inst.chip === '16bit' && inst.echoTime > 0 && inst.echoMix > 0) {
    const repeats = inst.echoFeedback > 0.01 ? Math.log(0.01) / Math.log(inst.echoFeedback) : 1;
    t += inst.echoTime * Math.min(12, repeats + 1);
  }
  return Math.min(4, t);
}

const polyBlep = (t: number, dt: number) => {
  if (t < dt) {
    const x = t / dt;
    return x + x - x * x - 1;
  }
  if (t > 1 - dt) {
    const x = (t - 1) / dt;
    return x * x + x + x + 1;
  }
  return 0;
};

/** The envelope level at time t (seconds) of a note held `held` seconds. */
function envelope(inst: Instrument, t: number, held: number): number {
  const level = (u: number) => {
    if (u < inst.attack) return inst.attack > 0 ? u / inst.attack : 1;
    const d = u - inst.attack;
    if (d < inst.decay) return 1 - (1 - inst.sustain) * (inst.decay > 0 ? d / inst.decay : 1);
    return inst.sustain;
  };
  if (t < held) return level(t);
  const r = t - held;
  if (r >= inst.release) return 0;
  return level(held) * (inst.release > 0 ? 1 - r / inst.release : 0);
}

/**
 * Mixes one note into `out` (mono) starting at sample `at`: the instrument at `pitch` (MIDI), held `held` seconds,
 * then its release. The echo is not here (it is per channel: renderChannel).
 */
export function addNote(out: Float32Array, at: number, inst: Instrument, pitch: number, held: number, velocity: number, sampleRate: number, random: () => number): void {
  const total = Math.ceil((held + inst.release + 0.002) * sampleRate);
  const eightBit = inst.chip === '8bit';
  const gain = inst.volume * velocity * 0.35;
  let phase = 0;
  let phase2 = random();
  let phase3 = random();
  let modPhase = 0;
  // Noise: a 15-bit shift register, like the NES (short mode for "metal").
  let lfsr = 1;
  let noiseLevel = 0;
  let noiseClock = 0;
  // Pluck: a Karplus-Strong string.
  let string: Float32Array | null = null;
  let si = 0;
  if (inst.wave === 'pluck') {
    const n = Math.max(2, Math.round(sampleRate / midiHz(pitch)));
    string = new Float32Array(n);
    for (let i = 0; i < n; i++) string[i] = random() * 2 - 1;
  }
  // Filter state (a state-variable filter, the stable "TPT" kind).
  let ic1 = 0;
  let ic2 = 0;
  const useFilter = !eightBit && inst.filter !== null;
  const k2 = 2 - 2 * inst.resonance;
  let g = 0;
  let lastCut = -1;
  let lastEnv = 0;
  for (let k = 0; k < total; k++) {
    const idx = at + k;
    if (idx >= out.length) break;
    const t = k / sampleRate;
    // 8-bit: the volume moves 60 times a second, in 16 steps, each step at the volume it reaches by the end of that
    // 1/60 s (so a note sounds from its very start, not after a silent first step), the release not before its time.
    const tEnv = eightBit ? (t < held ? Math.min((Math.floor(t * 60) + 1) / 60, held) : held + (Math.floor((t - held) * 60) + 1) / 60) : t;
    let env = envelope(inst, tEnv, held);
    if (eightBit) env = Math.round(env * 15) / 15;
    else env = lastEnv += (env - lastEnv) * 0.05; // a few samples of smoothing: no clicks
    if (k > 0 && env <= 0 && t > held) break;
    let p = pitch;
    if (inst.pitchDrop !== 0 && inst.pitchTime > 0 && t < inst.pitchTime) p += inst.pitchDrop * (1 - t / inst.pitchTime);
    if (inst.vibratoRate > 0 && inst.vibratoDepth > 0 && t > inst.vibratoDelay) p += inst.vibratoDepth * Math.sin(2 * Math.PI * inst.vibratoRate * (t - inst.vibratoDelay));
    if (inst.arp.length) p += inst.arp[Math.floor(t * inst.arpSpeed) % inst.arp.length];
    const f = midiHz(p);
    const dt = f / sampleRate;
    phase += dt;
    if (phase >= 1) phase -= Math.floor(phase);
    let x = 0;
    switch (inst.wave) {
      case 'pulse50':
      case 'pulse25':
      case 'pulse12': {
        const duty = inst.wave === 'pulse50' ? 0.5 : inst.wave === 'pulse25' ? 0.25 : 0.125;
        x = phase < duty ? 1 : -1;
        if (!eightBit) x += polyBlep(phase, dt) - polyBlep((phase - duty + 1) % 1, dt);
        x *= 0.6;
        break;
      }
      case 'triangle': {
        const tri = phase < 0.5 ? 4 * phase - 1 : 3 - 4 * phase;
        // The NES triangle has 16 steps.
        x = eightBit ? Math.round(tri * 7.5) / 7.5 : tri;
        break;
      }
      case 'noise':
      case 'metal': {
        if (!eightBit) {
          x = (random() * 2 - 1) * 0.7;
          break;
        }
        // Clocked faster for higher notes.
        noiseClock += (f * 16) / sampleRate;
        while (noiseClock >= 1) {
          noiseClock -= 1;
          const bit = (lfsr ^ (lfsr >> (inst.wave === 'metal' ? 6 : 1))) & 1;
          lfsr = (lfsr >> 1) | (bit << 14);
          noiseLevel = lfsr & 1 ? 0.6 : -0.6;
        }
        x = noiseLevel;
        break;
      }
      case 'saw':
        x = (2 * phase - 1 - polyBlep(phase, dt)) * 0.6;
        break;
      case 'square':
        x = ((phase < 0.5 ? 1 : -1) + polyBlep(phase, dt) - polyBlep((phase + 0.5) % 1, dt)) * 0.5;
        break;
      case 'sine':
        x = Math.sin(2 * Math.PI * phase);
        break;
      case 'fm': {
        modPhase += (f * inst.fmRatio) / sampleRate;
        if (modPhase >= 1) modPhase -= Math.floor(modPhase);
        x = Math.sin(2 * Math.PI * phase + inst.fmIndex * env * Math.sin(2 * Math.PI * modPhase));
        break;
      }
      case 'pluck': {
        const s = string!;
        const next = (si + 1) % s.length;
        x = s[si];
        s[si] = (s[si] + s[next]) * 0.498;
        si = next;
        break;
      }
      case 'supersaw': {
        const c = 2 ** (inst.detune / 1200);
        phase2 += (dt * c) % 1;
        phase3 += (dt / c) % 1;
        if (phase2 >= 1) phase2 -= 1;
        if (phase3 >= 1) phase3 -= 1;
        const saw = (q: number, d: number) => 2 * q - 1 - polyBlep(q, d);
        x = (saw(phase, dt) + saw(phase2, dt * c) + saw(phase3, dt / c)) * 0.3;
        break;
      }
    }
    if (useFilter) {
      const cut = Math.min(sampleRate * 0.45, inst.cutoff * 2 ** (inst.filterEnv * env * 4));
      if (cut !== lastCut) {
        lastCut = cut;
        g = Math.tan((Math.PI * cut) / sampleRate);
      }
      const a1 = 1 / (1 + g * (g + k2));
      const v3 = x - ic2;
      const v1 = a1 * ic1 + g * a1 * v3;
      const v2 = ic2 + g * v1;
      ic1 = 2 * v1 - ic1;
      ic2 = 2 * v2 - ic2;
      x = inst.filter === 'lowpass' ? v2 : inst.filter === 'highpass' ? x - k2 * v1 - v2 : v1 * 1.5;
    }
    out[idx] += x * env * gain;
  }
}

/** The channel's echo, applied to its samples in place (16-bit instruments with echo only). */
export function applyEcho(buf: Float32Array, inst: Instrument, sampleRate: number): void {
  if (inst.chip !== '16bit' || inst.echoTime <= 0 || inst.echoMix <= 0) return;
  const d = Math.max(1, Math.round(inst.echoTime * sampleRate));
  const line = new Float32Array(d);
  let i = 0;
  for (let k = 0; k < buf.length; k++) {
    const delayed = line[i];
    line[i] = buf[k] + delayed * inst.echoFeedback;
    buf[k] += delayed * inst.echoMix;
    i = (i + 1) % d;
  }
}

export interface Rendered {
  left: Float32Array;
  right: Float32Array;
  /** Where the music itself ends (the rest is notes ringing out and echo), in samples. */
  length: number;
}

/** One pattern of the song as stereo samples, with its notes' tails after it. */
export function renderPattern(song: Song, patternIndex: number, instruments: (id: string | null) => Instrument | null, sampleRate: number, seed = 1): Rendered {
  const steps = renderPatternInSteps(song, patternIndex, instruments, sampleRate, seed);
  for (;;) {
    const r = steps.next();
    if (r.done) return r.value;
  }
}

/**
 * The same, a note at a time: it pauses (yields) after each note, so a player can spread the work over several
 * frames and the game never stutters.
 */
export function* renderPatternInSteps(song: Song, patternIndex: number, instruments: (id: string | null) => Instrument | null, sampleRate: number, seed = 1): Generator<void, Rendered> {
  const pattern = song.patterns[patternIndex];
  const step = stepSeconds(song);
  const length = Math.round(patternSeconds(song) * sampleRate);
  const insts = song.channels.map((c) => (c.mute ? null : instruments(c.instrument)));
  // The longest note running past the end, plus the longest tail.
  let over = 0;
  for (const [ch, s, , len] of pattern?.notes ?? []) if (insts[ch]) over = Math.max(over, (s + len) * step - patternSeconds(song) + tailSeconds(insts[ch]!));
  for (const inst of insts) if (inst) over = Math.max(over, tailSeconds(inst));
  const total = length + Math.ceil(Math.min(8, over) * sampleRate);
  const left = new Float32Array(total);
  const right = new Float32Array(total);
  const random = seeded(seed * 7919 + patternIndex * 104729);
  for (const [ch, c] of song.channels.entries()) {
    const inst = insts[ch];
    if (!inst || !pattern) continue;
    const notes = pattern.notes.filter((n) => n[0] === ch);
    if (!notes.length) continue;
    const buf = new Float32Array(total);
    for (const [, s, pitch, len, vel] of notes) {
      addNote(buf, Math.round(s * step * sampleRate), inst, pitch, len * step - 0.004, vel, sampleRate, random);
      yield;
    }
    applyEcho(buf, inst, sampleRate);
    const angle = ((c.pan + 1) * Math.PI) / 4;
    const l = Math.cos(angle) * c.volume * Math.SQRT2;
    const r = Math.sin(angle) * c.volume * Math.SQRT2;
    for (let k = 0; k < total; k++) {
      left[k] += buf[k] * l;
      right[k] += buf[k] * r;
    }
    yield;
  }
  return { left, right, length };
}

/** One note of an instrument on its own (the keyboard in the instrument editor), mono, with its echo. */
export function renderNote(inst: Instrument, pitch: number, held: number, sampleRate: number, seed = 1): Float32Array {
  const out = new Float32Array(Math.ceil((held + tailSeconds(inst)) * sampleRate));
  addNote(out, 0, inst, pitch, held, 1, sampleRate, seeded(seed));
  applyEcho(out, inst, sampleRate);
  return out;
}

/** Reads a value as a JSON object if it is text. */
function asValue(raw: unknown): { value: unknown } | { error: string } {
  if (typeof raw !== 'string') return { value: raw };
  try {
    return { value: JSON.parse(raw) };
  } catch {
    return { error: 'not valid JSON' };
  }
}

export function parseInstrument(raw: unknown): { instrument: Instrument } | { error: string } {
  const v = asValue(raw);
  if ('error' in v) return { error: `Instrument: ${v.error}` };
  const parsed = instrumentSchema.safeParse(v.value && typeof v.value === 'object' ? { type: 'instrument', ...(v.value as object) } : v.value);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { error: `Instrument: ${issue.path.join('.') || 'value'}: ${issue.message}` };
  }
  if (!waveFits(parsed.data.chip, parsed.data.wave)) return { error: `Instrument: the ${parsed.data.chip} chip has no "${parsed.data.wave}" wave (it has ${(parsed.data.chip === '8bit' ? WAVES_8BIT : WAVES_16BIT).join(', ')})` };
  return { instrument: parsed.data };
}

/** Checks a song: its shape, and that the order and notes only use patterns and channels it has. */
export function parseSong(raw: unknown): { song: Song } | { error: string } {
  const v = asValue(raw);
  if ('error' in v) return { error: `Song: ${v.error}` };
  const parsed = songSchema.safeParse(v.value && typeof v.value === 'object' ? { type: 'song', ...(v.value as object) } : v.value);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { error: `Song: ${issue.path.join('.') || 'value'}: ${issue.message}` };
  }
  const song = parsed.data;
  const bad = song.order.find((i) => i >= song.patterns.length);
  if (bad !== undefined) return { error: `Song: order plays pattern ${bad}, but there are only ${song.patterns.length} (numbered from 0)` };
  for (const [pi, p] of song.patterns.entries()) {
    for (const n of p.notes) {
      if (n[0] >= song.channels.length) return { error: `Song: pattern ${pi} has a note on channel ${n[0]}, but there are only ${song.channels.length} (numbered from 0)` };
      if (n[1] >= song.steps) return { error: `Song: pattern ${pi} has a note at step ${n[1]}, but patterns have ${song.steps} steps (numbered from 0)` };
    }
  }
  return { song };
}

export function musicDataUrl(x: Instrument | Song): string {
  return `data:application/json;charset=utf-8,${encodeURIComponent(JSON.stringify(x))}`;
}
