import { describe, expect, it } from 'vitest';
import { createBuiltinRegistry } from '../components/builtin';
import { createDefinition, createProject, instantiateDefinition } from './factory';
import { addDefinition, setCameraFollow, setPlayPixels } from './mutations';
import { resolveEntity } from './resolve';
import { withoutUnused } from './unused';

const registry = createBuiltinRegistry();

describe('leaving out unused objects', () => {
  it('keeps placed objects, objects a kept script creates, their pictures and every sound', () => {
    const p = createProject(registry);
    const scene = p.scenes[0];
    const piece = createDefinition('Piece', { Sprite: { assetId: null, frame: 1, width: 32, height: 32, color: '#0ff', visible: true, layer: 0 } });
    addDefinition(p, piece, registry);
    const board = createDefinition('Board');
    board.scripts = [{ id: 'scr_1', name: 'Spawner', enabled: true, on: { event: 'start' }, do: [{ do: 'spawn', object: piece.id, x: '0', y: '0', tag: null }] } as never];
    addDefinition(p, board, registry);
    scene.entities = [instantiateDefinition(board, { x: 16, y: 16 })];
    const coin = p.definitions.find((d) => d.name === 'Coin')!;
    p.assets.push({ id: 'snd_1', name: 'Beep', kind: 'sound', path: 'assets/snd_1.sound.json', width: 0, height: 0, data: 'data:,' } as never);
    const r = withoutUnused(p);
    expect(r.project.definitions.map((d) => d.name).sort()).toEqual(['Board', 'Piece']);
    expect(r.objects).toContain('Coin');
    expect(r.objects).toContain('Player');
    expect(r.project.assets.map((a) => a.id)).toContain('snd_1');
    const coinPicture = JSON.stringify(coin.components).match(/ast_[0-9a-f]+/)?.[0];
    if (coinPicture) expect(r.project.assets.some((a) => a.id === coinPicture)).toBe(false);
    expect(r.pictures).toBeGreaterThan(0);
    // The game itself is not changed.
    expect(p.definitions.some((d) => d.name === 'Coin')).toBe(true);
  });
});

describe('the camera card', () => {
  it('follows one placed object, or nothing; the rest of the level stops being followed', () => {
    const p = createProject(registry);
    const scene = p.scenes[0];
    const player = p.definitions.find((d) => d.name === 'Player')!;
    const coin = p.definitions.find((d) => d.name === 'Coin')!;
    scene.entities = [instantiateDefinition(player, { x: 16, y: 16 }), instantiateDefinition(coin, { x: 48, y: 16 })];
    const follows = () => scene.entities.filter((e) => 'CameraTarget' in resolveEntity(p, e, registry).components).map((e) => e.name);
    expect(follows()).toEqual(['Player']);
    setCameraFollow(p, scene.id, scene.entities[1].id, registry);
    expect(follows()).toEqual(['Coin']);
    setCameraFollow(p, scene.id, null, registry);
    expect(follows()).toEqual([]);
    // Only this level: the Player object itself still has its camera target.
    expect('CameraTarget' in player.components).toBe(true);
  });

  it("the play resolution is the game's, or not set", () => {
    const p = createProject(registry);
    setPlayPixels(p, 180);
    expect(p.settings.playPixels).toBe(180);
    setPlayPixels(p, null);
    expect('playPixels' in p.settings).toBe(false);
    expect(() => setPlayPixels(p, -1)).toThrow();
  });
});
