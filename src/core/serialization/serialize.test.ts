import { describe, expect, it } from 'vitest';
import { createBuiltinRegistry } from '../components/builtin';
import { createAnimatedPixelArtAsset, createImageAsset, createProject, instantiateDefinition } from '../model/factory';
import { soundDataUrl } from '../audio/sound';
import { projectFromBundle, projectToBundle } from './serialize';
import type { AssetRecord } from '../types';

const registry = createBuiltinRegistry();

function game() {
  const p = createProject(registry, 'Small', 'topdown');
  const def = p.definitions[0];
  const scene = p.scenes[0];
  scene.entities = [];
  for (let x = 0; x < 20; x++) scene.entities.push(instantiateDefinition(def, { x: x * 16 + 8, y: 8 }));
  const odd = instantiateDefinition(def, { x: 8, y: 24 }, 'Boss');
  odd.transform.rotation = 90;
  odd.transform.scale = { x: -1, y: 1 };
  odd.tags = ['big'];
  odd.metadata = { note: 1 };
  scene.entities.push(odd);
  const rows = ['ab', 'ba'];
  p.assets.push(createAnimatedPixelArtAsset('Blink', [{ key: 'a', color: '#ff0000' }, { key: 'b', color: '#0000ff' }], [rows, ['aa', 'bb']]));
  const sound = { type: 'steps' as const, speed: 4, notes: [[24, 3, 5, 0] as [number, number, number, number]] };
  p.assets.push({ ...createImageAsset('Beep', soundDataUrl(sound), 0, 0, 'sound.json'), kind: 'sound', synth: sound } as AssetRecord);
  // Pixels whose picture was changed some other way: its file is kept.
  const edited = createAnimatedPixelArtAsset('Edited', [{ key: 'a', color: '#00ff00' }], [['a']]);
  edited.data = 'data:image/png;base64,AAAA';
  p.assets.push(edited);
  return p;
}

describe('saving a game', () => {
  it('reads back exactly as it was', () => {
    const p = game();
    const bundle = JSON.parse(JSON.stringify(projectToBundle(p)));
    expect(projectFromBundle(bundle, registry).project).toEqual(p);
  });

  it('a plain copy writes only its id, object and position; pictures and sounds made from pixels or notes have no file', () => {
    const p = game();
    const files = projectToBundle(p).files;
    const entities = (files[`scenes/${p.scenes[0].id}.json`] as { entities: Record<string, unknown>[] }).entities;
    expect(Object.keys(entities[0]).sort()).toEqual(['definitionId', 'id', 'transform']);
    expect(entities[0].transform).toEqual({ position: { x: 8, y: 8 } });
    expect(entities.at(-1)).toMatchObject({ name: 'Boss', transform: { rotation: 90, scale: { x: -1, y: 1 } }, tags: ['big'], metadata: { note: 1 } });
    const byName = (n: string) => p.assets.find((a) => a.name === n)!.path;
    expect(files[byName('Blink')]).toBeUndefined();
    expect(files[byName('Beep')]).toBeUndefined();
    expect(files[byName('Edited')]).toBe('data:image/png;base64,AAAA');
  });

  it('files saved in the full form still open', () => {
    const p = game();
    const bundle = projectToBundle(p);
    const full = JSON.parse(JSON.stringify({ ...bundle, files: { ...bundle.files, [`scenes/${p.scenes[0].id}.json`]: p.scenes[0], ...Object.fromEntries(p.assets.map((a) => [a.path, a.data])) } }));
    expect(projectFromBundle(full, registry).project).toEqual(p);
  });
});
