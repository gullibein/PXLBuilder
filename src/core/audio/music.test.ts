import { describe, expect, it } from 'vitest';
import {
  emptySong,
  INSTRUMENT_PRESETS,
  makeInstrument,
  noteName,
  parseInstrument,
  parseNoteName,
  parseSong,
  patternSeconds,
  preset,
  renderNote,
  renderPattern,
  STARTER_KITS,
  type Instrument,
  type Song,
} from './music';

const SR = 22050;
const rms = (a: Float32Array, from = 0, to = a.length) => {
  let s = 0;
  for (let i = from; i < to; i++) s += a[i] * a[i];
  return Math.sqrt(s / Math.max(1, to - from));
};
const peak = (a: Float32Array) => a.reduce((m, x) => Math.max(m, Math.abs(x)), 0);

/** Zero crossings per second: about the note's frequency for a plain wave. */
function frequency(a: Float32Array, from: number, to: number): number {
  let n = 0;
  for (let i = from + 1; i < to; i++) if (a[i - 1] < 0 && a[i] >= 0) n++;
  return n / ((to - from) / SR);
}

describe('music', () => {
  it('names notes the usual way (60 = C4) and reads them back', () => {
    expect(noteName(60)).toBe('C4');
    expect(noteName(69)).toBe('A4');
    expect(noteName(61)).toBe('C#4');
    expect(parseNoteName('A4')).toBe(69);
    expect(parseNoteName('Bb3')).toBe(58);
    expect(parseNoteName('c#5')).toBe(73);
    expect(parseNoteName('H2')).toBeNull();
  });

  it('every preset is a valid instrument that makes sound', () => {
    for (const { name, instrument } of INSTRUMENT_PRESETS) {
      expect(parseInstrument(instrument), name).toHaveProperty('instrument');
      const out = renderNote(instrument, 57, 0.25, SR);
      expect(rms(out), name).toBeGreaterThan(0.005);
      expect(peak(out), name).toBeLessThanOrEqual(1);
    }
  });

  it('plays the note at its pitch (A4 = 440 Hz)', () => {
    for (const wave of ['pulse50', 'triangle'] as const) {
      const out = renderNote(makeInstrument({ chip: '8bit', wave, sustain: 1 }), 69, 0.5, SR);
      expect(frequency(out, SR * 0.1, SR * 0.4)).toBeGreaterThan(430);
      expect(frequency(out, SR * 0.1, SR * 0.4)).toBeLessThan(450);
    }
    const sine = renderNote(makeInstrument({ chip: '16bit', wave: 'sine', sustain: 1 }), 57, 0.5, SR);
    expect(frequency(sine, SR * 0.1, SR * 0.4)).toBeCloseTo(220, -1);
  });

  it('8-bit volume moves in 16 steps, 60 times a second; 16-bit is smooth', () => {
    const slow = { attack: 0, decay: 0.5, sustain: 0, release: 0.01 };
    const levels = (inst: Instrument) => {
      const out = renderNote(inst, 69, 0.5, SR);
      // The square's height is the volume: count the different heights it takes over the decay.
      return new Set(Array.from(out.subarray(0, SR * 0.45)).map((x) => Math.abs(x).toFixed(4))).size;
    };
    expect(levels(makeInstrument({ chip: '8bit', wave: 'pulse50', ...slow }))).toBeLessThanOrEqual(17);
    expect(levels(makeInstrument({ chip: '16bit', wave: 'square', ...slow }))).toBeGreaterThan(100);
  });

  it('an 8-bit note sounds from its very first moment (no silent first step), also with a short attack', () => {
    for (const attack of [0, 0.01, 0.03]) {
      const out = renderNote(makeInstrument({ chip: '8bit', wave: 'pulse50', attack, sustain: 1 }), 69, 0.3, SR);
      expect(rms(out, 0, Math.round(SR * 0.004)), `attack ${attack}`).toBeGreaterThan(0.02);
    }
  });

  it('a note sounds for its length plus its release, then is silent', () => {
    const inst = makeInstrument({ chip: '8bit', wave: 'pulse50', sustain: 1, release: 0.1 });
    const out = renderNote(inst, 60, 0.3, SR);
    expect(rms(out, 0, SR * 0.28)).toBeGreaterThan(0.05);
    expect(rms(out, SR * 0.42)).toBe(0);
  });

  it('a pattern has sound where its notes are and silence elsewhere; muted channels are silent', () => {
    const lead = preset('Square lead');
    const insts = new Map([['lead', lead]]);
    const song: Song = { ...emptySong([{ id: 'lead', name: 'Lead' }]), bpm: 120 };
    song.patterns[0].notes = [[0, 0, 60, 2, 1]];
    const r = renderPattern(song, 0, (id) => insts.get(id ?? '') ?? null, SR);
    expect(r.length).toBe(Math.round(patternSeconds(song) * SR));
    const step = (60 / 120 / 4) * SR;
    expect(rms(r.left, 0, step * 2)).toBeGreaterThan(0.05);
    expect(rms(r.left, step * 4, r.length)).toBe(0);
    song.channels[0].mute = true;
    const m = renderPattern(song, 0, (id) => insts.get(id ?? '') ?? null, SR);
    expect(peak(m.left)).toBe(0);
  });

  it('pans channels left and right', () => {
    const insts = new Map([['a', preset('Triangle bass')]]);
    const song = emptySong([{ id: 'a', name: 'A' }]);
    song.patterns[0].notes = [[0, 0, 48, 4, 1]];
    song.channels[0].pan = -1;
    const r = renderPattern(song, 0, (id) => insts.get(id ?? '') ?? null, SR);
    expect(rms(r.left)).toBeGreaterThan(0.05);
    expect(rms(r.right)).toBeLessThan(1e-6);
  });

  it('echo keeps the sound going after the note', () => {
    const dry = makeInstrument({ chip: '16bit', wave: 'saw', sustain: 0, decay: 0.05, release: 0.01 });
    const wet = { ...dry, echoTime: 0.2, echoFeedback: 0.4, echoMix: 0.5 };
    expect(rms(renderNote(dry, 60, 0.05, SR), SR * 0.15)).toBe(0);
    expect(rms(renderNote(wet, 60, 0.05, SR), Math.round(SR * 0.2), Math.round(SR * 0.25))).toBeGreaterThan(0.01);
  });

  it('noise sounds the same every time (seeded)', () => {
    const inst = preset('Chip snare');
    expect(Array.from(renderNote(inst, 60, 0.1, SR, 3))).toEqual(Array.from(renderNote(inst, 60, 0.1, SR, 3)));
  });

  it('checks songs: patterns the order plays, channels and steps of the notes', () => {
    const song = emptySong([{ id: 'a', name: 'A' }]);
    expect(parseSong(song)).toHaveProperty('song');
    expect(parseSong({ ...song, order: [0, 1] })).toEqual({ error: expect.stringContaining('only 1') });
    expect(parseSong({ ...song, patterns: [{ name: 'A', notes: [[1, 0, 60, 1, 1]] }] })).toEqual({ error: expect.stringContaining('channel 1') });
    expect(parseSong({ ...song, patterns: [{ name: 'A', notes: [[0, 20, 60, 1, 1]] }] })).toEqual({ error: expect.stringContaining('step 20') });
    expect(parseInstrument({ chip: '8bit', wave: 'fm' })).toEqual({ error: expect.stringContaining('no "fm" wave') });
    expect(parseInstrument({ chip: '16bit', wave: 'fm' })).toHaveProperty('instrument');
  });

  it('renders a busy pattern quickly enough to stream while playing', () => {
    for (const chip of ['8bit', '16bit'] as const) {
      const kit = [...STARTER_KITS[chip].instruments, ...STARTER_KITS[chip].drums].map((name) => ({ id: name, name }));
      const insts = new Map(kit.map((k) => [k.id, preset(k.name)]));
      const song = emptySong(kit, 140);
      for (let s = 0; s < 16; s++) for (let c = 0; c < kit.length; c++) song.patterns[0].notes.push([c, s, 48 + c * 5, 1, 0.8]);
      const t0 = performance.now();
      renderPattern(song, 0, (id) => insts.get(id ?? '') ?? null, 44100);
      // A 1.7 s pattern: must take far less than that.
      expect(performance.now() - t0).toBeLessThan(400);
    }
  });
});
