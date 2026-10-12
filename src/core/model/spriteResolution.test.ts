import { produce } from 'immer';
import { describe, expect, it } from 'vitest';
import { createBuiltinRegistry } from '../components/builtin';
import { parseQuickCommand } from '../commands/quickCommands';
import { applyOperations, operationSchema } from '../commands/operations';
import { createProject } from './factory';
import * as m from './mutations';
import { checkPixelArt } from './pixelArt';
import { BOX_ART, scale2x, shrink } from './spriteResolution';
import type { Project } from '../types';

const registry = createBuiltinRegistry();
const look = (p: Project, name: string) => {
  const def = p.definitions.find((d) => d.name === name)!;
  return p.assets.find((a) => a.id === (def.components.Sprite as { assetId?: string }).assetId) ?? null;
};
const size = (p: Project, name: string) => {
  const a = look(p, name);
  return a?.pixelArt ? `${a.pixelArt.rows[0].length}x${a.pixelArt.rows.length}` : null;
};

describe('sprite size', () => {
  it('Scale2x doubles with smooth diagonals; shrinking keeps what most of each block is', () => {
    expect(scale2x(['a.', '.a'])).toEqual(['aa..', 'a.a.', '.a.a', '..aa']); // the diagonal stays joined
    // A diagonal edge: the corner pixel takes the neighbours' color.
    expect(scale2x(['aa', 'a.'])).toEqual(['aaaa', 'aaaa', 'aaa.', 'aa..']);
    expect(shrink(['aab.', 'ab..', '....', '..cc'], 2)).toEqual(['a.', '.c']);
  });

  it('the hand-drawn pictures for objects that ship as plain boxes are valid pixel art', () => {
    for (const [name, art] of Object.entries(BOX_ART)) expect(checkPixelArt(art), name).toBeNull();
  });

  it('every built-in object gets ready-made 8×8, 16×16 and 64×64 pictures (proportionally for odd sizes)', () => {
    for (const gameType of ['platformer', 'topdown'] as const) {
      const start = createProject(registry, 'x', gameType);
      for (const res of [8, 16, 64] as const) {
        const p = produce(start, (d) => void m.changeSpriteResolution(d, res, registry));
        expect(p.settings.spriteResolution).toBe(res);
        for (const def of p.definitions) {
          const a = look(p, def.name);
          expect(a?.pixelArt, `${gameType} ${def.name} at ${res}`).toBeTruthy();
          expect(checkPixelArt({ palette: a!.pixelArt!.palette, rows: a!.pixelArt!.rows }), `${gameType} ${def.name} ${res} ${JSON.stringify(a!.pixelArt!.palette)}`).toBeNull();
        }
      }
    }
    const p8 = produce(createProject(registry), (d) => void m.changeSpriteResolution(d, 8, registry));
    expect([size(p8, 'Platform'), size(p8, 'Enemy'), size(p8, 'Hazard'), size(p8, 'Door')]).toEqual(['8x8', '8x8', '8x4', '8x16']);
    const p64 = produce(createProject(registry), (d) => void m.changeSpriteResolution(d, 64, registry));
    // 64 a tile; a two-tile door at most 64 tall.
    expect([size(p64, 'Platform'), size(p64, 'Coin'), size(p64, 'Door')]).toEqual(['64x64', '32x32', '32x64']);
  });

  it("objects with their own drawing keep it; back to 32 is how they ship; the top-down hero's walk cycles change too", () => {
    let p = createProject(registry);
    const shipped = look(p, 'Player')!.id;
    p = produce(p, (d) => {
      m.addAsset(d, { id: 'mine', name: 'Mine', kind: 'image', path: 'assets/mine.png', data: 'data:image/png;base64,AAAA', width: 8, height: 8 });
      m.setDefinitionComponentField(d, d.definitions.find((x) => x.name === 'Enemy')!.id, 'Sprite', 'assetId', 'mine', registry);
    });
    const p16 = produce(p, (d) => void m.changeSpriteResolution(d, 16, registry));
    expect(look(p16, 'Enemy')!.id).toBe('mine');
    expect(size(p16, 'Player')).toBe('14x16');
    const back = produce(p16, (d) => void m.changeSpriteResolution(d, 32, registry));
    expect(look(back, 'Player')!.id).toBe(shipped);
    expect(look(back, 'Platform')).toBeNull(); // a plain box again

    const td = produce(createProject(registry, 'x', 'topdown'), (d) => void m.changeSpriteResolution(d, 8, registry));
    const hero = td.definitions.find((d) => d.name === 'Player')!;
    const states = Object.values(hero.components.SpriteStates ?? {}).filter((v): v is string => typeof v === 'string');
    expect(states.length).toBeGreaterThan(0);
    for (const id of states) expect(td.assets.find((a) => a.id === id)!.pixelArt!.rows[0].length).toBe(8);
  });

  it('reset to defaults keeps the chosen size', () => {
    const p = produce(createProject(registry), (d) => {
      m.changeSpriteResolution(d, 8, registry);
      m.resetAllStarterDefinitions(d, registry);
    });
    expect(size(p, 'Player')).toBe('7x8');
  });

  it('the AI (set_sprite_resolution) and a typed command can change it', () => {
    const ops = operationSchema.array().parse([{ op: 'set_sprite_resolution', resolution: 16 }]);
    const p = produce(createProject(registry), (d) => void applyOperations(d, ops, registry));
    expect(size(p, 'Platform')).toBe('16x16');
    expect(parseQuickCommand('make the sprites 8x8 pixels')).toEqual({ kind: 'sprite_resolution', resolution: 8 });
    expect(parseQuickCommand('16x16 sprites')).toEqual({ kind: 'sprite_resolution', resolution: 16 });
    expect(parseQuickCommand('sprite size 64')).toEqual({ kind: 'sprite_resolution', resolution: 64 });
    expect(parseQuickCommand('make the sprites 12x12')).toBeNull();
  });
});
