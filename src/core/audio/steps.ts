/**
 * Step sounds, like PICO-8's sound effects: up to 32 notes played one after the other, each with a pitch, a wave,
 * a volume and an effect, all notes as long as the sound's speed says. Small and easy to edit by hand (the sound
 * editor draws them as bars) and for the AI to write. Turned into audio samples here (renderSteps), so they sound
 * the same everywhere: in the editor, in play, in exported games.
 */
import { z } from 'zod';

/** The waves, by number. */
export const STEP_WAVES = ['triangle', 'tilted saw', 'saw', 'square', 'pulse', 'organ', 'noise', 'phaser'] as const;
/** The effects, by number (0 = none). */
export const STEP_EFFECTS = ['none', 'slide', 'vibrato', 'drop', 'fade in', 'fade out'] as const;
export const MAX_NOTES = 32;
export const PITCHES = 64;
export const MAX_VOLUME = 7;
export const MAX_SPEED = 60;
/** One speed unit: 1/120 of a second (speed 8 = a note every 1/15 s). */
export const TICK_SECONDS = 1 / 120;

/** [pitch 0–63 (semitones above C2; 24 = middle C), wave 0–7, volume 0–7 (0 = silent), effect 0–5]. */
export type StepNote = [number, number, number, number];

export interface StepSound {
  type: 'steps';
  /** How long each note lasts, in 1/120 s (1 = fastest). */
  speed: number;
  notes: StepNote[];
}

const note = z.tuple([
  z.number().int().min(0).max(PITCHES - 1),
  z.number().int().min(0).max(STEP_WAVES.length - 1),
  z.number().int().min(0).max(MAX_VOLUME),
  z.number().int().min(0).max(STEP_EFFECTS.length - 1),
]);

export const stepSoundSchema = z.object({
  type: z.literal('steps'),
  speed: z.number().int().min(1).max(MAX_SPEED),
  notes: z.array(note).min(1).max(MAX_NOTES),
});

export function isStepSound(x: unknown): x is StepSound {
  return !!x && typeof x === 'object' && (x as { type?: unknown }).type === 'steps';
}

/** A new, silent sound (32 notes at volume 0). */
export function emptySteps(speed = 12): StepSound {
  return { type: 'steps', speed, notes: Array.from({ length: MAX_NOTES }, () => [24, 0, 0, 0] as StepNote) };
}

/** All 32 notes (missing ones silent), for editing. */
export function fullNotes(s: StepSound): StepNote[] {
  return Array.from({ length: MAX_NOTES }, (_, i) => (s.notes[i] ? [...s.notes[i]] : [24, 0, 0, 0]) as StepNote);
}

/** How many notes actually sound (up to the last one with a volume). */
export function audibleNotes(s: StepSound): number {
  for (let i = s.notes.length - 1; i >= 0; i--) if (s.notes[i][2] > 0) return i + 1;
  return 0;
}

export function stepSeconds(s: StepSound): number {
  return audibleNotes(s) * s.speed * TICK_SECONDS;
}

/** The note's frequency: pitch 0 = C2 (65.4 Hz), 12 = C3, 24 = C4 (middle C, 262 Hz)… */
export function pitchHz(p: number): number {
  return 65.406 * 2 ** (p / 12);
}

const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
/** "C4", "F#5"… */
export function pitchName(p: number): string {
  return `${NAMES[p % 12]}${Math.floor(p / 12) + 2}`;
}

const tri = (t: number) => (t < 0.5 ? 4 * t - 1 : 3 - 4 * t);

/**
 * The sound as samples (-1..1) at a sample rate: notes in order, the wave's phase carried on from note to note (no
 * clicks), volume changes smoothed over a couple of milliseconds, the very end faded out. `random` makes the noise.
 */
export function renderSteps(s: StepSound, sampleRate: number, random: () => number = Math.random): Float32Array {
  const count = audibleNotes(s);
  const noteSamples = s.speed * TICK_SECONDS * sampleRate;
  const out = new Float32Array(Math.round(count * noteSamples));
  let phase = 0;
  let phase2 = 0;
  let noise = 0;
  let noiseStep = -1;
  let vol = 0;
  const smooth = 1 - Math.exp(-1 / (0.002 * sampleRate));
  for (let i = 0; i < count; i++) {
    const [p, w, v, e] = s.notes[i];
    const prev = i > 0 ? s.notes[i - 1][0] : p;
    const start = Math.round(i * noteSamples);
    const end = Math.round((i + 1) * noteSamples);
    for (let k = start; k < end; k++) {
      const u = (k - start) / (end - start);
      let pitch = e === 1 ? prev + (p - prev) * u : p;
      if (e === 2) pitch += 0.5 * Math.sin((2 * Math.PI * 7 * k) / sampleRate);
      let f = pitchHz(pitch);
      if (e === 3) f *= 1 - u;
      let target = v / MAX_VOLUME;
      if (e === 4) target *= u;
      if (e === 5) target *= 1 - u;
      vol += (target - vol) * smooth;
      phase = (phase + f / sampleRate) % 1;
      phase2 = (phase2 + (f * 1.0109) / sampleRate) % 1;
      let x: number;
      switch (w) {
        case 0:
          x = tri(phase);
          break;
        case 1:
          x = phase < 0.875 ? (phase / 0.875) * 2 - 1 : 1 - ((phase - 0.875) / 0.125) * 2;
          break;
        case 2:
          x = (2 * phase - 1) * 0.7;
          break;
        case 3:
          x = phase < 0.5 ? 0.55 : -0.55;
          break;
        case 4:
          x = phase < 0.3125 ? 0.55 : -0.55;
          break;
        case 5:
          x = (tri(phase) + tri((phase * 2) % 1) * 0.6) * 0.65;
          break;
        case 6: {
          // A new random level 16 times a cycle: higher notes are brighter hiss.
          const at = Math.floor((k * f * 16) / sampleRate);
          if (at !== noiseStep) {
            noiseStep = at;
            noise = random() * 2 - 1;
          }
          x = noise * 0.7;
          break;
        }
        default:
          x = (tri(phase) + tri(phase2)) * 0.5;
      }
      out[k] = x * vol * 0.4;
    }
  }
  // The last few milliseconds fade out (no click at the end).
  const fade = Math.min(out.length, Math.round(0.005 * sampleRate));
  for (let j = 0; j < fade; j++) out[out.length - 1 - j] *= j / fade;
  return out;
}

/** Reads a step sound (JSON text or an object), or says what is wrong with it. */
export function parseSteps(raw: unknown): { sound: StepSound } | { error: string } {
  let value = raw;
  if (typeof raw === 'string') {
    try {
      value = JSON.parse(raw);
    } catch {
      return { error: 'The sound is not valid JSON' };
    }
  }
  const parsed = stepSoundSchema.safeParse(value);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { error: `Sound: ${issue.path.join('.') || 'value'}: ${issue.message}` };
  }
  if (!audibleNotes(parsed.data)) return { error: 'Sound: every note has volume 0, so nothing would be heard' };
  return { sound: parsed.data };
}
