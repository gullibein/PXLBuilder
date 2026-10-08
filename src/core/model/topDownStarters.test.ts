import { produce } from 'immer';
import { describe, expect, it } from 'vitest';
import { createBuiltinRegistry } from '../components/builtin';
import { projectFromBundle, projectToBundle, checkIntegrity, checkComponents } from '../serialization/serialize';
import { InputState } from '../../runtime/input';
import { Runtime } from '../../runtime/runtime';
import { createProject, instantiateDefinition } from './factory';
import { levelMap } from './levelMap';
import * as m from './mutations';
import { checkPixelArt } from './pixelArt';
import { isTopDownScene } from './topDown';

const registry = createBuiltinRegistry();
const def = (p: ReturnType<typeof createProject>, name: string) => p.definitions.find((d) => d.name === name)!;

describe('a new top-down game', () => {
  const project = createProject(registry, 'Dungeon', 'topdown');

  it('remembers it is top-down, has no gravity, and is seen from above', () => {
    expect(project.settings.gameType).toBe('topdown');
    expect(project.scenes[0].world.gravity).toEqual({ x: 0, y: 0 });
    expect(isTopDownScene(project, project.scenes[0], registry)).toBe(true);
  });

  it('has the top-down starter objects, under the same names as the platformer ones', () => {
    expect(project.definitions.map((d) => d.name)).toEqual(['Player', 'Wall', 'Floor', 'Enemy', 'Coin', 'Key', 'Door', 'Switch', 'Hazard', 'Teleporter', 'Goal', 'Barrel']);
    expect(def(project, 'Player').components.CharacterController.movement).toBe('topdown');
    expect(def(project, 'Enemy').components.Wander).toBeTruthy();
    // The floor is only a look, under everything.
    expect(def(project, 'Floor').components.Collider).toBeUndefined();
    expect(def(project, 'Floor').components.Sprite.layer).toBe(-1);
  });

  it('every picture it uses is in the project, as valid pixel art', () => {
    const ids = new Set(project.assets.map((a) => a.id));
    for (const d of project.definitions) {
      for (const id of [d.components.Sprite?.assetId, ...Object.values(d.components.SpriteStates ?? {})]) if (id) expect(ids).toContain(id);
    }
    for (const a of project.assets) if (a.pixelArt) expect(checkPixelArt(a.pixelArt)).toBeNull();
    expect(checkIntegrity(project)).toEqual([]);
    expect(checkComponents(project, registry)).toEqual([]);
  });

  it('keeps being a top-down game after saving and loading', () => {
    const loaded = projectFromBundle(JSON.parse(JSON.stringify(projectToBundle(project))), registry).project;
    expect(loaded.settings.gameType).toBe('topdown');
  });

  it('"reset objects" brings back the top-down objects (with all of the hero\'s looks)', () => {
    const changed = produce(project, (d) => {
      m.setDefinitionComponentField(d, def(project, 'Player').id, 'CharacterController', 'speed', 999, registry);
      d.definitions = d.definitions.filter((x) => x.name !== 'Floor');
      d.assets = d.assets.filter((a) => a.id !== def(project, 'Floor').components.Sprite.assetId);
    });
    const reset = produce(changed, (d) => void m.resetAllStarterDefinitions(d, registry));
    expect(def(reset, 'Player').components.CharacterController.speed).toBe(150);
    expect(def(reset, 'Player').components.CharacterController.movement).toBe('topdown');
    expect(def(reset, 'Floor').components.Sprite.layer).toBe(-1);
    expect(checkIntegrity(reset)).toEqual([]);
    const ids = new Set(reset.assets.map((a) => a.id));
    for (const id of Object.values(def(reset, 'Player').components.SpriteStates)) if (id) expect(ids).toContain(id);
  });

  it('a platformer game is still made as before', () => {
    const p = createProject(registry);
    expect(p.settings.gameType).toBe('platformer');
    expect(p.scenes[0].world.gravity.y).toBe(980);
    expect(def(p, 'Player').components.CharacterController.movement).toBe('platformer');
    expect(def(p, 'Platform')).toBeTruthy();
  });

  it('a room painted with floor, walls around it, plays: the hero walks and the slime wanders', () => {
    const p = produce(project, (d) => {
      const sceneId = d.scenes[0].id;
      const put = (name: string, col: number, row: number) => m.addEntity(d, sceneId, instantiateDefinition(d.definitions.find((x) => x.name === name)!, { x: col * 32 + 16, y: row * 32 + 16 }));
      for (let c = -4; c <= 4; c++) for (let r = -3; r <= 3; r++) {
        if (Math.abs(c) === 4 || Math.abs(r) === 3) put('Wall', c, r);
        else put('Floor', c, r);
      }
      put('Player', 0, 0);
      put('Enemy', 2, 1);
    });
    const map = levelMap(p, p.scenes[0].id, registry)!;
    // Floor cells read as walkable floor on the AI's map, not as things in the way.
    expect(map.rows.join('\n')).toMatch(/#_+P_+#/);
    const rt = new Runtime(p, p.scenes[0].id, registry);
    const hero = rt.find('Player')!;
    const slime = rt.find('Enemy')!;
    const input = new InputState();
    input.press('left');
    for (let i = 0; i < 120; i++) rt.update(1 / 60, input);
    // Stops at the left wall (its right edge is at x = -96).
    expect(hero.x).toBeCloseTo(-96 + 11, 0);
    expect(rt.lookOf(hero).situation).toBe('idle');
    const start = { x: slime.x, y: slime.y };
    for (let i = 0; i < 240; i++) rt.update(1 / 60, new InputState());
    expect(Math.hypot(slime.x - start.x, slime.y - start.y)).toBeGreaterThan(5);
  });
});
