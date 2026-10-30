import { produce } from 'immer';
import { describe, expect, it } from 'vitest';
import { applyOperations } from './commands/operations';
import { createBuiltinRegistry } from './components/builtin';
import { createProject } from './model/factory';
import { getDefinitionSprites } from './model/mutations';
import type { Project } from './types';

const registry = createBuiltinRegistry();
const art = (key: string) => ({ palette: [{ key: 'a', color: key }], rows: Array.from({ length: 8 }, () => 'a'.repeat(8)), frames: null, fps: null });

describe('the AI drawing an object anew', () => {
  const draw = (p: Project, ops: unknown[]) => produce(p, (d) => void applyOperations(d, ops as never, registry));

  it('leaves none of its old pictures in it: old look, old situation looks, and pictures nothing shows any more leave the game', () => {
    const before = createProject(registry, 'Test', 'topdown');
    const player = before.definitions.find((d) => d.name === 'Player')!;
    const oldIds = [player.components.Sprite.assetId, ...Object.values(player.components.SpriteStates).filter((v) => typeof v === 'string')] as string[];
    expect(oldIds.length).toBe(4);
    const after = draw(before, [{ op: 'draw_sprite', target: 'definition', id: player.id, name: 'Knight', situation: null, ...art('#ff0000') }]);
    const p = after.definitions.find((d) => d.id === player.id)!;
    const now = p.components.Sprite.assetId as string;
    expect(oldIds).not.toContain(now);
    expect(Object.values(p.components.SpriteStates).filter((v) => typeof v === 'string')).toEqual([]);
    expect(getDefinitionSprites(p).map((r) => r.assetId)).toEqual([now]);
    for (const id of oldIds) expect(after.assets.some((a) => a.id === id)).toBe(false);
  });

  it('keeps the situation looks drawn in the same answer (before or after the new look)', () => {
    const before = createProject(registry, 'Test', 'topdown');
    const player = before.definitions.find((d) => d.name === 'Player')!;
    const after = draw(before, [
      { op: 'draw_sprite', target: 'definition', id: player.id, name: 'Knight up', situation: 'up', ...art('#00ff00') },
      { op: 'draw_sprite', target: 'definition', id: player.id, name: 'Knight', situation: null, ...art('#ff0000') },
      { op: 'draw_sprite', target: 'definition', id: player.id, name: 'Knight run', situation: 'run', ...art('#0000ff') },
    ]);
    const p = after.definitions.find((d) => d.id === player.id)!;
    const states = p.components.SpriteStates as Record<string, unknown>;
    expect(after.assets.find((a) => a.id === states.up)?.name).toBe('Knight up');
    expect(after.assets.find((a) => a.id === states.run)?.name).toBe('Knight run');
    expect(states.down).toBeNull();
    expect(getDefinitionSprites(p)).toHaveLength(3);
  });

  it('a picture another object still shows stays in the game', () => {
    const before = createProject(registry);
    const enemy = before.definitions.find((d) => d.name === 'Enemy')!;
    const shared = produce(before, (d) => {
      d.definitions.find((x) => x.name === 'Crate')!.components.Sprite.assetId = enemy.components.Sprite.assetId;
    });
    const after = draw(shared, [{ op: 'draw_sprite', target: 'definition', id: enemy.id, name: 'Robot', situation: null, ...art('#888888') }]);
    expect(after.assets.some((a) => a.id === enemy.components.Sprite.assetId)).toBe(true);
  });
});
