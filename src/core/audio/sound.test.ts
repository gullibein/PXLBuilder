import { produce } from 'immer';
import { describe, expect, it } from 'vitest';
import { createBuiltinRegistry } from '../components/builtin';
import { buildSystemPrompt } from '../ai/capabilities';
import { applyOperations, checkOperations, type Operation } from '../commands/operations';
import { createProject } from '../model/factory';
import { projectFromBundle, projectToBundle } from '../serialization/serialize';
import { checkScript } from '../script/language';
import { parseSoundRecipe, soundLength } from './sound';
import { audibleNotes, parseSteps, pitchHz, pitchName, renderSteps, stepSeconds, type StepSound } from './steps';

const registry = createBuiltinRegistry();
const quack = { volume: 0.8, layers: [{ wave: 'sawtooth', length: 0.16, pitch: [[0.16, 240], [0, 330]], filter: { type: 'bandpass', freq: 1100, q: 4 } }] };
/** A quack as a step sound: a nasal buzz dipping in pitch, twice. */
const quackSteps = { type: 'steps', speed: 6, notes: [[22, 2, 6, 0], [20, 2, 5, 1], [18, 2, 3, 5], [0, 0, 0, 0], [21, 2, 5, 0], [17, 2, 3, 5]] };
const make = (name: string, recipe: unknown, replaceId: string | null = null): Operation => ({ op: 'make_sound', name, description: 'a duck quack', soundJson: JSON.stringify(recipe), replaceId });

describe('sounds', () => {
  it('a step sound: its notes, its length and its pitches', () => {
    const r = parseSteps(quackSteps);
    if ('error' in r) throw new Error(r.error);
    expect(audibleNotes(r.sound)).toBe(6);
    expect(stepSeconds(r.sound)).toBeCloseTo((6 * 6) / 120);
    expect(soundLength(r.sound)).toBeCloseTo(0.3);
    expect(pitchHz(24)).toBeCloseTo(261.6, 0);
    expect(pitchName(24)).toBe('C4');
    expect(pitchName(33)).toBe('A4');
    expect(pitchHz(33)).toBeCloseTo(440, 0);
  });

  it('a wrong step sound says what is wrong', () => {
    expect(parseSteps({ type: 'steps', speed: 8, notes: [[64, 0, 5, 0]] })).toEqual({ error: expect.stringMatching(/notes\.0\.0/) });
    expect(parseSteps({ type: 'steps', speed: 8, notes: [[24, 9, 5, 0]] })).toEqual({ error: expect.stringMatching(/notes\.0\.1/) });
    expect(parseSteps({ type: 'steps', speed: 0, notes: [[24, 0, 5, 0]] })).toEqual({ error: expect.stringMatching(/speed/) });
    expect(parseSteps({ type: 'steps', speed: 8, notes: Array(33).fill([24, 0, 5, 0]) })).toEqual({ error: expect.stringMatching(/notes/) });
    expect(parseSteps({ type: 'steps', speed: 8, notes: [[24, 0, 0, 0]] })).toEqual({ error: expect.stringMatching(/nothing would be heard/) });
  });

  it('renders notes as audio: as long as the notes that sound, quiet where the volume is 0, at the right pitch', () => {
    const rate = 22050;
    const sound: StepSound = { type: 'steps', speed: 12, notes: [[33, 3, 7, 0], [33, 3, 0, 0], [33, 3, 4, 0], [24, 0, 0, 0]] };
    const out = renderSteps(sound, rate);
    const note = (12 / 120) * rate;
    expect(out.length).toBe(Math.round(3 * note));
    const peak = (a: number, b: number) => Math.max(...Array.from(out.subarray(Math.round(a), Math.round(b)), Math.abs));
    // Note 1 loud, note 2 silent (after the short smoothing), note 3 quieter than note 1.
    expect(peak(note * 0.2, note)).toBeGreaterThan(0.15);
    expect(peak(note * 1.3, note * 2)).toBeLessThan(0.001);
    expect(peak(note * 2.3, note * 3 - 200)).toBeLessThan(peak(note * 0.2, note));
    // A 440 Hz square: about 2 × 440 sign changes a second.
    let flips = 0;
    for (let k = Math.round(note * 0.2) + 1; k < note; k++) if (Math.sign(out[k]) !== Math.sign(out[k - 1])) flips++;
    const seconds = (note * 0.8) / rate;
    expect(flips / seconds).toBeGreaterThan(2 * 440 * 0.9);
    expect(flips / seconds).toBeLessThan(2 * 440 * 1.1);
    // Every wave and effect renders without going out of range.
    for (let w = 0; w < 8; w++)
      for (let e = 0; e < 6; e++) {
        const all = renderSteps({ type: 'steps', speed: 4, notes: [[10, w, 7, 0], [50, w, 7, e]] }, rate);
        expect(all.every((x) => Number.isFinite(x) && Math.abs(x) <= 1)).toBe(true);
      }
  });

  it('a recipe gets its defaults, its pitch points in time order, and its length', () => {
    const r = parseSoundRecipe(quack);
    if ('error' in r) throw new Error(r.error);
    expect(r.recipe.layers[0]).toMatchObject({ start: 0, volume: 0.5, vibrato: null, pitch: [[0, 330], [0.16, 240]] });
    expect(soundLength(r.recipe)).toBeCloseTo(0.16);
  });

  it('a wrong recipe says what is wrong', () => {
    expect(parseSoundRecipe({ layers: [] })).toEqual({ error: expect.stringMatching(/layers/) });
    expect(parseSoundRecipe({ layers: [{ wave: 'kazoo', length: 0.1, pitch: [[0, 300]] }] })).toEqual({ error: expect.stringMatching(/wave/) });
    expect(parseSoundRecipe({ layers: [{ wave: 'sine', start: 3, length: 3, pitch: [[0, 300]] }] })).toEqual({ error: expect.stringMatching(/at most 4 seconds/) });
    expect(parseSoundRecipe('{nope')).toEqual({ error: 'The sound is not valid JSON' });
  });

  it('every sound example the AI is given is a valid step sound', () => {
    const prompt = buildSystemPrompt(registry);
    const examples = [...prompt.matchAll(/^ {2}[a-z /]+: (\{"type":"steps".*\})$/gm)].map((m) => m[1]);
    expect(examples.length).toBeGreaterThanOrEqual(6);
    for (const e of examples) expect(parseSteps(e)).not.toHaveProperty('error');
  });

  it('make_sound adds a sound (kept when saved and opened again); replaceId remakes it; names stay unique', () => {
    const project = createProject(registry);
    const p1 = produce(project, (d) => void applyOperations(d, [make('Quack', quackSteps)], registry));
    const sound = p1.assets.find((a) => a.kind === 'sound')!;
    expect(sound).toMatchObject({ name: 'Quack', description: 'a duck quack' });
    expect((sound.synth as StepSound).notes).toHaveLength(6);
    expect(sound.data.startsWith('data:application/json')).toBe(true);
    const reopened = projectFromBundle(JSON.parse(JSON.stringify(projectToBundle(p1))), registry).project;
    expect(reopened.assets.find((a) => a.id === sound.id)!.synth).toEqual(sound.synth);

    expect(checkOperations(p1, [make('quack', quackSteps)], registry)).toMatch(/already a sound called "quack"/);
    // The AI makes step sounds (editable); an old-style recipe is refused.
    expect(checkOperations(p1, [make('Moo', quack)], registry)).toMatch(/Sound: type/);
    const deeper = { ...quackSteps, notes: quackSteps.notes.map(([p, w, v, e]) => [Math.max(0, p - 12), w, v, e]) };
    const p2 = produce(p1, (d) => void applyOperations(d, [make('Quack', deeper, sound.id)], registry));
    expect(p2.assets.filter((a) => a.kind === 'sound')).toHaveLength(1);
    expect((p2.assets.find((a) => a.id === sound.id)!.synth as StepSound).notes[0]).toEqual([10, 2, 6, 0]);
    // A game saved with an older recipe sound still opens with it.
    const old = produce(p1, (d) => void (d.assets.find((a) => a.kind === 'sound')!.synth = (parseSoundRecipe(quack) as { recipe: never }).recipe));
    expect(projectFromBundle(JSON.parse(JSON.stringify(projectToBundle(old))), registry).project.assets.find((a) => a.kind === 'sound')!.synth).toHaveProperty('layers');
  });

  it('scripts play sounds by name; an unknown sound is refused with the list of sounds', () => {
    const p = produce(createProject(registry), (d) => void applyOperations(d, [make('Quack', quackSteps)], registry));
    const script = (sound: string) => ({ id: 'scr_s', name: 'S', handlers: [{ when: { on: 'start' }, do: [{ do: 'play_sound', sound }] }] });
    expect(checkScript(script('quack'), p)).toHaveProperty('script');
    expect(checkScript(script('Moo'), p)).toEqual({ error: expect.stringMatching(/no sound "Moo" \(sounds: Quack\)/) });
  });
});
