import { produce } from 'immer';
import { describe, expect, it } from 'vitest';
import { buildAIPayload } from './ai/context';
import { applyOperations } from './commands/operations';
import { createBuiltinRegistry } from './components/builtin';
import { createProject, instantiateDefinition } from './model/factory';
import * as m from './model/mutations';
import type { Vec2 } from './types';
import { InputState } from '../runtime/input';
import { Runtime } from '../runtime/runtime';

const registry = createBuiltinRegistry();

function level() {
  let project = createProject(registry);
  const sceneId = project.scenes[0].id;
  const playerDef = project.definitions.find((d) => d.name === 'Player')!;
  let playerId = '';
  project = produce(project, (d) => {
    const place = (name: string, pos: Vec2) => {
      const e = instantiateDefinition(d.definitions.find((x) => x.name === name)!, pos);
      m.addEntity(d, sceneId, e);
      return e.id;
    };
    for (let x = -480; x <= 480; x += 32) place('Platform', { x, y: 48 });
    playerId = place('Player', { x: 0, y: 16 });
  });
  return { project, sceneId, playerDef, playerId };
}

/** A 28×32 drawing in one color (a different pose for each situation in a real game). */
const pose = (key: string) => ({ palette: [{ key, color: '#ff00ff' }], rows: Array(32).fill(key.repeat(28)) });

describe('sprites by situation', () => {
  it('the AI sees the current look with its pixels (the starter player is pixel art)', () => {
    const { project, sceneId, playerId } = level();
    const payload = buildAIPayload(project, { kind: 'entity', sceneId, entityIds: [playerId] }, registry);
    const look = payload.targets[0].look;
    expect(look.sprite?.image).toBe('Player');
    expect(look.sprite?.pixelArt?.rows).toHaveLength(32);
    expect(look.sprite?.pixelArt?.rows[0]).toHaveLength(28);
    expect(look.situations).toEqual({});
  });

  it('draw_sprite with a situation adds an image for that situation and keeps the normal look', () => {
    const { project, playerDef, sceneId, playerId } = level();
    const p = produce(project, (d) => void applyOperations(d, [{ op: 'draw_sprite', frames: null, fps: null, target: 'definition', id: playerDef.id, name: 'Player jumping', ...pose('j'), situation: 'jump' }], registry));
    const def = p.definitions.find((d) => d.id === playerDef.id)!;
    const jump = p.assets.find((a) => a.name === 'Player jumping')!;
    expect(def.components.Sprite.assetId).toBe(playerDef.components.Sprite.assetId);
    expect(def.components.SpriteStates.jump).toBe(jump.id);
    expect(jump.pixelArt?.rows).toHaveLength(32);
    expect(m.getDefinitionSprites(def)).toContainEqual({ assetId: jump.id, frame: 1 });
    // ...and the AI sees it next time.
    expect(buildAIPayload(p, { kind: 'entity', sceneId, entityIds: [playerId] }, registry).targets[0].look.situations.jump.image).toBe('Player jumping');
  });

  it('in play the image follows what the player is doing: running, jumping, falling (jump image), standing', () => {
    const { project, playerDef } = level();
    const p = produce(project, (d) =>
      void applyOperations(
        d,
        [
          { op: 'draw_sprite', frames: null, fps: null, target: 'definition', id: playerDef.id, name: 'Jump', ...pose('j'), situation: 'jump' },
          { op: 'draw_sprite', frames: null, fps: null, target: 'definition', id: playerDef.id, name: 'Run', ...pose('r'), situation: 'run' },
        ],
        registry,
      ),
    );
    const id = (name: string) => p.assets.find((a) => a.name === name)!.id;
    const rt = new Runtime(p, p.scenes[0].id, registry);
    const input = new InputState();
    const player = rt.find('Player')!;
    const drawn = () => rt.renderList().find((r) => r.name === 'Player')!.components.Sprite.assetId;
    const run = (s: number) => {
      for (let t = 0; t < s; t += 1 / 60) rt.update(1 / 60, input);
    };
    run(0.3);
    expect(rt.lookOf(player)).toEqual({ situation: 'idle', assetId: null });
    expect(drawn()).toBe(playerDef.components.Sprite.assetId);
    input.press('right');
    run(0.3);
    expect(rt.lookOf(player).situation).toBe('run');
    expect(drawn()).toBe(id('Run'));
    input.release('right');
    input.press('jump');
    run(0.1);
    expect(rt.lookOf(player).situation).toBe('jump');
    expect(drawn()).toBe(id('Jump'));
    run(0.3);
    expect(rt.lookOf(player).situation).toBe('fall');
    expect(drawn()).toBe(id('Jump')); // no falling image: the jumping one
    input.release('jump');
    run(1);
    expect(rt.lookOf(player).situation).toBe('idle');
    expect(drawn()).toBe(playerDef.components.Sprite.assetId);
  });
});
