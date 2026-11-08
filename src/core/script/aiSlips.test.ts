import { produce } from 'immer';
import { describe, expect, it } from 'vitest';
import { applyOperations, type Operation } from '../commands/operations';
import { createBuiltinRegistry } from '../components/builtin';
import { codeFor, codeToSend, mentions } from '../ai/context';
import { createProject } from '../model/factory';
import { scriptSchema } from './language';

const registry = createBuiltinRegistry();

describe('what AIs commonly write in scripts', () => {
  it('a null for a setting with a default means the default (a sprite drawing with "color": null)', () => {
    const r = scriptSchema.safeParse({
      id: 's1',
      name: 'Dig',
      handlers: [{ when: { on: 'tick' }, do: [{ do: 'draw', id: 'pose', shape: 'sprite', anchor: 'world', x: 'self.x', y: 'self.y', w: '32', h: '32', text: null, size: null, color: null, object: 'def_1', alpha: null }] }],
    });
    expect(r.success).toBe(true);
    expect((r.data!.handlers[0].do[0] as { color: string }).color).toBe('#ffffff');
    // A setting that must be given is still required.
    expect(scriptSchema.safeParse({ id: 's1', name: 'x', handlers: [{ when: { on: 'tick' }, do: [{ do: 'draw', id: null, shape: 'rect' }] }] }).success).toBe(false);
  });

  it('a drawing of an object made in the same answer names it by its ref', () => {
    const p = createProject(registry);
    const player = p.definitions.find((d) => d.name === 'Player')!;
    const ops = [
      { op: 'create_definition', ref: 'dd', name: 'Mole Dig', description: '', category: 'Custom', tags: [], components: [{ component: 'Sprite', propsJson: '{"width":32,"height":32}' }] },
      {
        op: 'set_script',
        target: 'definition',
        id: player.id,
        scriptJson: JSON.stringify({ id: 'dig', name: 'Dig', handlers: [{ when: { on: 'tick' }, do: [{ do: 'draw', id: 'pose', shape: 'sprite', anchor: 'world', x: 'self.x', y: 'self.y', w: '32', h: '32', object: 'dd' }] }] }),
      },
    ] as unknown as Operation[];
    const next = produce(p, (d) => void applyOperations(d, ops, registry));
    const made = next.definitions.find((d) => d.name === 'Mole Dig')!;
    const drawn = next.definitions.find((d) => d.id === player.id)!.scripts![0].handlers[0].do[0] as { object: string };
    expect(drawn.object).toBe(made.id);
  });

  it("the scripts of the objects a request names are sent along in full (no round trip to ask; nothing else is sent)", () => {
    const p = createProject(registry);
    const player = p.definitions.find((d) => d.name === 'Player')!;
    const coin = p.definitions.find((d) => d.name === 'Coin')!;
    const script = (id: string) => ({ id, name: 'S', description: '', enabled: true, vars: [], states: [], handlers: [{ when: { on: 'start' as const }, state: null, if: null, do: [{ do: 'tag' as const, tag: 'x', add: true, on: null }] }] });
    player.scripts = [script('a') as never];
    coin.scripts = [script('b') as never];
    p.scenes[0].entities = [{ id: 'e1', name: 'Player', definitionId: player.id, transform: { position: { x: 0, y: 0 }, rotation: 0, scale: { x: 1, y: 1 } }, components: {}, removedComponents: [], tags: [], metadata: {} }];
    const full = (request: string) => JSON.stringify(codeFor(p, codeToSend(p, { kind: 'level', sceneId: p.scenes[0].id, point: null }, request)).map((c) => c.name));
    expect(full('make it rain')).toBe('[]');
    expect(full('the coins should spin')).toBe('["Coin"]');
    expect(full('the player should jump higher')).toBe('["Player"]');
  });

  it('also the scripts that act on what a request names, and its names in other forms (Icelandic too)', () => {
    const p = createProject(registry);
    const box = p.definitions.find((d) => d.name === 'Box') ?? p.definitions[0];
    const board = p.definitions.find((d) => d.name !== box.name && !d.scripts?.length) ?? p.definitions[1];
    box.name = 'Pillur';
    board.name = 'Stjórnandi';
    const handler = (act: Record<string, unknown>) => ({ when: { on: 'start' as const }, state: null, if: null, do: [act] });
    box.scripts = [{ id: 'c', name: 'Litur', description: '', enabled: true, vars: [], states: [], handlers: [handler({ do: 'tag', tag: 'x', add: true, on: null })] }] as never;
    board.scripts = [
      { id: 'd', name: 'Dr. Mario', description: '', enabled: true, vars: [], states: [], handlers: [handler({ do: 'spawn', object: box.id, x: '0', y: '0', tag: 'active' }), handler({ do: 'play_sound', sound: 'Pop', volume: '1', pitch: '1' })] },
    ] as never;
    p.assets.push({ id: 'snd_pop', kind: 'sound', name: 'Pop' } as never);
    for (const d of p.definitions) if (d !== box && d !== board) d.scripts = [];
    const full = (request: string) => JSON.stringify(codeFor(p, codeToSend(p, { kind: 'level', sceneId: p.scenes[0].id, point: null }, request)).map((c) => c.name).sort());
    // "pillurnar" is Pillur ("the pills"); the board spawns them, so its code goes too.
    expect(full('þegar pillurnar hverfa þurfa þær að blikka')).toBe('["Pillur","Stjórnandi"]');
    // A sound named: the script that plays it.
    expect(full('spilum frekar "pop" hljóðið')).toBe('["Stjórnandi"]');
    // Another form of the board's own name.
    expect(full('breyttu Stjórnanda')).toBe('["Stjórnandi"]');
    expect(full('gerðu lag')).toBe('[]');
    expect(mentions(['enemies'], 'Enemy')).toBe(true);
    expect(mentions(['coins'], 'Coin')).toBe(true);
    expect(mentions(['corn'], 'Coin')).toBe(false);
    expect(mentions(['the', 'goal', 'flag'], 'Goal Flag')).toBe(true);
  });
});
