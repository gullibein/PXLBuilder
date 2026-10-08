import { produce } from 'immer';
import { describe, expect, it } from 'vitest';
import { createBuiltinRegistry } from './components/builtin';
import { createImageAsset, createProject, instantiateDefinition } from './model/factory';
import * as m from './model/mutations';
import { resolveEntity } from './model/resolve';

const registry = createBuiltinRegistry();

function setup() {
  const project = createProject(registry);
  const sceneId = project.scenes[0].id;
  const enemy = project.definitions.find((d) => d.name === 'Enemy')!;
  const e = instantiateDefinition(enemy, { x: 0, y: 0 });
  return { project: produce(project, (d) => m.addEntity(d, sceneId, e)), sceneId, enemy, entityId: e.id };
}
const comps = (p: ReturnType<typeof setup>['project'], sceneId: string, id: string) => resolveEntity(p, m.getEntity(p, sceneId, id), registry).components;

describe('sprite and collider size link', () => {
  it('is on by default: changing the sprite size resizes the collider (instance)', () => {
    const { project, sceneId, entityId } = setup();
    const p = produce(project, (d) => m.setEntityComponentField(d, sceneId, entityId, 'Sprite', 'width', 48, registry));
    expect(comps(p, sceneId, entityId).Collider.size).toEqual({ x: 48, y: 30 });
  });

  it('works the other way: changing the collider resizes the sprite (definition)', () => {
    const { project, enemy } = setup();
    const p = produce(project, (d) => m.setDefinitionComponentField(d, enemy.id, 'Collider', 'size', { x: 40, y: 20 }, registry));
    const def = p.definitions.find((d) => d.id === enemy.id)!;
    expect(def.components.Sprite).toMatchObject({ width: 40, height: 20 });
  });

  it('can be broken, then sizes change independently; relinking snaps the collider to the sprite', () => {
    const { project, sceneId, entityId } = setup();
    let p = produce(project, (d) => m.setEntityComponentField(d, sceneId, entityId, 'Collider', 'matchSprite', false, registry));
    p = produce(p, (d) => m.setEntityComponentField(d, sceneId, entityId, 'Sprite', 'height', 64, registry));
    expect(comps(p, sceneId, entityId).Collider.size).toEqual({ x: 30, y: 30 });
    p = produce(p, (d) => m.setEntityComponentField(d, sceneId, entityId, 'Collider', 'matchSprite', true, registry));
    expect(comps(p, sceneId, entityId).Collider.size).toEqual({ x: 30, y: 64 });
  });

  it('the starter ladder is unlinked (its collider is narrower than its art)', () => {
    const { project } = setup();
    expect(project.definitions.find((d) => d.name === 'Ladder')!.components.Collider.matchSprite).toBe(false);
  });
});

describe('object sprites', () => {
  it('collects sprites per object and switches the one in use', () => {
    const { project, enemy } = setup();
    const sheet = createImageAsset('robots', 'data:image/png;base64,AAAA', 64, 32, 'png');
    let p = produce(project, (d) => {
      m.addAsset(d, sheet);
      m.setAssetGrid(d, sheet.id, { columns: 4, rows: 2, cellWidth: 16, cellHeight: 16, offsetX: 0, offsetY: 0, spacingX: 0, spacingY: 0 });
      m.useDefinitionSprite(d, enemy.id, { assetId: sheet.id, frame: 6 }, registry);
      m.addDefinitionSprite(d, enemy.id, { assetId: sheet.id, frame: 2 });
      m.addDefinitionSprite(d, enemy.id, { assetId: sheet.id, frame: 2 });
    });
    const def = () => p.definitions.find((d) => d.id === enemy.id)!;
    expect(p.assets.find((a) => a.id === sheet.id)!.kind).toBe('spritesheet');
    expect(def().components.Sprite).toMatchObject({ assetId: sheet.id, frame: 6, width: 30, height: 30 });
    // Its built-in drawing stays listed (to go back to), then the cells in the order they were added, no duplicates.
    expect(m.getDefinitionSprites(def())).toEqual([
      { assetId: enemy.components.Sprite.assetId, frame: 1 },
      { assetId: sheet.id, frame: 6 },
      { assetId: sheet.id, frame: 2 },
    ]);
    p = produce(p, (d) => m.removeDefinitionSprite(d, enemy.id, { assetId: sheet.id, frame: 2 }));
    expect(m.getDefinitionSprites(def())).toHaveLength(2);
  });

  it('rejects a grid that does not fit the image', () => {
    const { project } = setup();
    const img = createImageAsset('small', 'data:image/png;base64,AAAA', 32, 32, 'png');
    expect(() =>
      produce(project, (d) => {
        m.addAsset(d, img);
        m.setAssetGrid(d, img.id, { columns: 3, rows: 1, cellWidth: 16, cellHeight: 16, offsetX: 0, offsetY: 0, spacingX: 0, spacingY: 0 });
      }),
    ).toThrow(/wide/);
  });
});
