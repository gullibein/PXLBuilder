/**
 * Sounds made by the AI (or anyone) as data: a recipe of layers, each a
 * waveform (or noise) whose pitch moves through points, with a volume
 * envelope, an optional wobble (vibrato) and an optional filter. Played by
 * the browser's own synthesizer (editor/audio/synth.ts), so no sound
 * files or network are needed: a quack is a buzzy wave through a band-pass
 * filter dipping in pitch, a spring a sine sliding up with fast vibrato.
 */
import { z } from 'zod';

export const WAVES = ['sine', 'square', 'triangle', 'sawtooth', 'noise'] as const;
export const FILTERS = ['lowpass', 'highpass', 'bandpass'] as const;

/** Longest sound (seconds) and most layers: short effects, not music. */
export const MAX_SOUND_SECONDS = 4;
export const MAX_LAYERS = 8;

const hz = z.number().min(20).max(12000);
const seconds = (max: number) => z.number().min(0).max(max);

export const soundLayerSchema = z.object({
  wave: z.enum(WAVES).describe('sine: pure, round (whistles, boings); square: hollow, retro (blips, quacks); triangle: soft; sawtooth: buzzy, bright; noise: hiss (explosions, wind, hits, splashes)'),
  start: seconds(MAX_SOUND_SECONDS).default(0).describe('When the layer starts, seconds from the start of the sound'),
  length: z.number().min(0.01).max(MAX_SOUND_SECONDS).describe('How long the layer lasts, seconds'),
  pitch: z
    .array(z.tuple([seconds(MAX_SOUND_SECONDS), hz]))
    .min(1)
    .max(16)
    .describe('[time in seconds from the layer start, frequency in Hz] points; the pitch slides smoothly between them (one point = steady). Ignored for noise (color noise with a filter)'),
  volume: z.number().min(0).max(1).default(0.5),
  attack: seconds(2).default(0.005).describe('Fade-in seconds'),
  release: seconds(3).default(0.08).describe('Fade-out seconds at the end of the layer'),
  vibrato: z
    .object({ rate: z.number().min(0.1).max(60).describe('wobbles per second'), depth: z.number().min(0).max(1).describe('how far the pitch wobbles, as a share of it (0.05 = slight, 0.3 = wild)') })
    .nullable()
    .default(null),
  filter: z
    .object({ type: z.enum(FILTERS), freq: hz.describe('Hz'), q: z.number().min(0.1).max(30).default(1).describe('sharpness (higher = narrower, more "vowel"-like)') })
    .nullable()
    .default(null),
});

export const soundRecipeSchema = z.object({
  volume: z.number().min(0).max(1).default(0.8),
  layers: z.array(soundLayerSchema).min(1).max(MAX_LAYERS),
});

export type SoundLayer = z.infer<typeof soundLayerSchema>;
export type SoundRecipe = z.infer<typeof soundRecipeSchema>;

/** How long the sound lasts (seconds). */
export function soundLength(recipe: SoundRecipe): number {
  return Math.max(...recipe.layers.map((l) => l.start + l.length));
}

/** Parses a recipe from the AI (JSON text or an object); returns it with defaults filled in, or an error naming what is wrong. */
export function parseSoundRecipe(raw: unknown): { recipe: SoundRecipe } | { error: string } {
  let value = raw;
  if (typeof raw === 'string') {
    try {
      value = JSON.parse(raw);
    } catch {
      return { error: 'The sound is not valid JSON' };
    }
  }
  const parsed = soundRecipeSchema.safeParse(value);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { error: `Sound: ${issue.path.join('.') || 'value'}: ${issue.message}` };
  }
  const recipe = parsed.data;
  if (soundLength(recipe) > MAX_SOUND_SECONDS) return { error: `Sounds can be at most ${MAX_SOUND_SECONDS} seconds long` };
  // Pitch points in time order (the synthesizer needs them so).
  for (const l of recipe.layers) l.pitch.sort((a, b) => a[0] - b[0]);
  return { recipe };
}

/** The recipe as a data URL (the asset's file contents, saved with the project). */
export function soundDataUrl(recipe: SoundRecipe): string {
  return `data:application/json;charset=utf-8,${encodeURIComponent(JSON.stringify(recipe))}`;
}
