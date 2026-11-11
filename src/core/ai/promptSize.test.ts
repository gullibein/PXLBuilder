import { produce } from 'immer';
import { describe, expect, it } from 'vitest';
import { applyOperations, type Operation } from '../commands/operations';
import { componentRegistry } from '../components/builtin';
import { createProject, instantiateDefinition } from '../model/factory';
import * as m from '../model/mutations';
import { expandReadyScript } from '../script/ready';
import type { AIContext } from './context';
import { systemPromptWithReplyFormat } from './prompt';
import { TOPICS, topicsFor } from './topics';

const level: AIContext = { kind: 'level', sceneId: 's', point: null };
const size = (keys: string[]) => keys.reduce((n, k) => n + TOPICS[k].text.length, 0);

describe('what every request costs', () => {
  it('the instructions and reply format sent with every request stay small (they were 200,000 characters)', () => {
    expect(systemPromptWithReplyFormat().length).toBeLessThan(120_000);
  });

  it('a request carries only the guidance it needs', () => {
    expect(topicsFor(level, 'make the player run faster')).toEqual([]);
    expect(topicsFor(level, 'make the coin gold and shiny')).toEqual(['drawing']);
    expect(topicsFor(level, 'why does the player die here?')).toContain('debugging');
    expect(topicsFor(level, 'add a pit with spikes')).toContain('levels');
    expect(topicsFor(level, 'make the jump floatier')).toContain('engine_parts');
    expect(topicsFor(level, 'add a pause menu')).toContain('example_pause_menu');
    expect(topicsFor(level, 'zoom the camera out')).toContain('camera');
    expect(topicsFor(level, 'make the bats faster', [], false, true)).toContain('topdown');
    const fresh = topicsFor({ kind: 'project', sceneId: 's' }, 'a fun platformer', [], true);
    expect(fresh).toEqual(expect.arrayContaining(['levels', 'drawing', 'new_game', 'enemies']));
    // A new game's whole request: well under the old instructions alone.
    expect(systemPromptWithReplyFormat().length + size(fresh)).toBeLessThan(160_000);
  });
});

describe('what the AI writes, made shorter', () => {
  it('make_autotile: the app makes the 16 edge pictures from the object\'s own picture', () => {
    const p = produce(createProject(componentRegistry), (d) => {
      const ops = [
        { op: 'create_definition', ref: 'rock', name: 'Rock', category: 'Platforms', tags: ['ground'], description: 'Rock', components: [{ component: 'Sprite', propsJson: '{"width":32,"height":32}' }, { component: 'Collider', propsJson: '{}' }] },
        { op: 'draw_sprite', target: 'definition', id: 'rock', name: 'Rock', palette: [{ key: 'a', color: '#777777' }, { key: 'b', color: '#555555' }], rows: Array.from({ length: 8 }, (_, i) => (i % 2 ? 'abababab' : 'babababa')), frames: null, fps: null, situation: null },
        { op: 'make_autotile', id: 'rock', edge: 'outline', top: 'grass', round: true },
      ] as unknown as Operation[];
      applyOperations(d, ops, componentRegistry);
    });
    const rock = p.definitions.find((d) => d.name === 'Rock')!;
    expect(rock.components.Sprite.autotile).toBe(true);
    const sheet = p.assets.find((a) => a.id === rock.components.Sprite.autotileSheet);
    expect(sheet?.pixelArt?.frames?.length ?? 0).toBeGreaterThanOrEqual(15);
  });

  it('Stomp and Hurts on touch are ready-made: one line instead of the whole script', () => {
    for (const name of ['Stomp', 'Hurts on touch']) {
      const s = expandReadyScript({ ready: name }) as { name: string; handlers: unknown[] };
      expect(s.name).toBe(name);
      expect(s.handlers.length).toBeGreaterThan(0);
    }
    const p = produce(createProject(componentRegistry), (d) => {
      m.addEntity(d, d.scenes[0].id, instantiateDefinition(d.definitions.find((x) => x.name === 'Player')!, { x: 0, y: 0 }));
      const frog = d.definitions.find((x) => x.name === 'Enemy')!;
      applyOperations(d, [{ op: 'set_script', target: 'definition', id: frog.id, scriptJson: '{"ready":"Hurts on touch","settings":{"amount":2}}' } as unknown as Operation], componentRegistry);
    });
    const hurts = p.definitions.find((x) => x.name === 'Enemy')!.scripts!.filter((s) => s.name === 'Hurts on touch');
    expect(hurts.some((s) => s.vars.some((v) => v.name === 'amount' && v.value === 2))).toBe(true);
  });
});
