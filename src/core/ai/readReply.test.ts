import { describe, expect, it } from 'vitest';
import { produce } from 'immer';
import { createBuiltinRegistry } from '../components/builtin';
import { applyOperations } from '../commands/operations';
import { createProject } from '../model/factory';
import { readReply } from './protocol';

const registry = createBuiltinRegistry();

const draw = (id: string, name: string, situation: string | null) => ({ op: 'draw_sprite', target: 'definition', id, name, palette: [{ key: 'O', color: '#6e3b0a' }], rows: Array.from({ length: 8 }, () => 'OOOOOOOO'), frames: null, fps: null, situation });

describe('reading an answer into the reply format', () => {
  it('a ? block\'s used look (and a pressure plate\'s) can be drawn: "used" is a situation', () => {
    const p = createProject(registry);
    const block = p.definitions.find((d) => d.name === 'Question block')!;
    const r = readReply({ kind: 'preview', message: 'm', changes: [], operations: [draw(block.id, 'Used block', 'used')] });
    if (!r.ok) throw new Error(r.issues);
    expect(r.dropped).toEqual([]);
    const after = produce(p, (d) => void applyOperations(d, r.response.operations, registry));
    const used = (after.definitions.find((d) => d.id === block.id)!.components.SpriteStates as { used: string }).used;
    expect(after.assets.find((a) => a.id === used)?.name).toBe('Used block');
  });

  it('one operation not in the format is left out (and said), the rest of a long answer is kept', () => {
    const p = createProject(registry);
    const coin = p.definitions.find((d) => d.name === 'Coin')!;
    const ops = [
      { op: 'set_sprite_resolution', resolution: 8 },
      draw(coin.id, 'Coin', null),
      draw(coin.id, 'Coin sparkle', 'sparkling'),
      { op: 'set_level_profile', genre: 'classic', theme: 'forest' },
    ];
    const r = readReply({ kind: 'preview', message: 'A new look.', changes: ['Coin: redrawn'], operations: ops });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.response.operations.map((o) => o.op)).toEqual(['set_sprite_resolution', 'draw_sprite', 'set_level_profile']);
    expect(r.dropped).toHaveLength(1);
    expect(r.dropped[0]).toMatch(/^draw_sprite "Coin sparkle" \(situation: /);
    expect(r.response.changes.at(-1)).toMatch(/^Not done \(the app couldn't read it\): draw_sprite "Coin sparkle"/);
  });

  it('an answer wrong as a whole (or mostly) still fails', () => {
    expect(readReply({ kind: 'nonsense', message: 'm', changes: [], operations: [] }).ok).toBe(false);
    const bad = Array.from({ length: 6 }, () => ({ op: 'no_such_op' }));
    expect(readReply({ kind: 'apply', message: 'm', changes: [], operations: [...bad, { op: 'set_sprite_resolution', resolution: 8 }] }).ok).toBe(false);
  });
});
