import { produce } from 'immer';
import { describe, expect, it } from 'vitest';
import { createBuiltinRegistry } from '../components/builtin';
import { buildSystemPrompt } from '../ai/capabilities';
import { applyOperations, checkOperations, type Operation } from '../commands/operations';
import { createProject } from '../model/factory';
import { projectFromBundle, projectToBundle } from '../serialization/serialize';
import { checkScript } from '../script/language';
import { parseSoundRecipe, soundLength } from './sound';

const registry = createBuiltinRegistry();
const quack = { volume: 0.8, layers: [{ wave: 'sawtooth', length: 0.16, pitch: [[0.16, 240], [0, 330]], filter: { type: 'bandpass', freq: 1100, q: 4 } }] };
const make = (name: string, recipe: unknown, replaceId: string | null = null): Operation => ({ op: 'make_sound', name, description: 'a duck quack', soundJson: JSON.stringify(recipe), replaceId });

describe('sounds', () => {
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

  it('every recipe example the AI is given is a valid recipe', () => {
    const prompt = buildSystemPrompt(registry);
    const examples = [...prompt.matchAll(/^ {2}[a-z /]+: (\{"volume".*\})$/gm)].map((m) => m[1]);
    expect(examples.length).toBeGreaterThanOrEqual(6);
    for (const e of examples) expect(parseSoundRecipe(e)).not.toHaveProperty('error');
  });

  it('make_sound adds a sound (kept when saved and opened again); replaceId remakes it; names stay unique', () => {
    const project = createProject(registry);
    const p1 = produce(project, (d) => void applyOperations(d, [make('Quack', quack)], registry));
    const sound = p1.assets.find((a) => a.kind === 'sound')!;
    expect(sound).toMatchObject({ name: 'Quack', description: 'a duck quack' });
    expect(sound.synth!.layers).toHaveLength(1);
    expect(sound.data.startsWith('data:application/json')).toBe(true);
    const reopened = projectFromBundle(JSON.parse(JSON.stringify(projectToBundle(p1))), registry).project;
    expect(reopened.assets.find((a) => a.id === sound.id)!.synth).toEqual(sound.synth);

    expect(checkOperations(p1, [make('quack', quack)], registry)).toMatch(/already a sound called "quack"/);
    const deeper = { ...quack, layers: [{ ...quack.layers[0], pitch: [[0, 200]] }] };
    const p2 = produce(p1, (d) => void applyOperations(d, [make('Quack', deeper, sound.id)], registry));
    expect(p2.assets.filter((a) => a.kind === 'sound')).toHaveLength(1);
    expect(p2.assets.find((a) => a.id === sound.id)!.synth!.layers[0].pitch).toEqual([[0, 200]]);
  });

  it('scripts play sounds by name; an unknown sound is refused with the list of sounds', () => {
    const p = produce(createProject(registry), (d) => void applyOperations(d, [make('Quack', quack)], registry));
    const script = (sound: string) => ({ id: 'scr_s', name: 'S', handlers: [{ when: { on: 'start' }, do: [{ do: 'play_sound', sound }] }] });
    expect(checkScript(script('quack'), p)).toHaveProperty('script');
    expect(checkScript(script('Moo'), p)).toEqual({ error: expect.stringMatching(/no sound "Moo" \(sounds: Quack\)/) });
  });
});
