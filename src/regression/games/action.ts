/**
 * Action games of the regression suite, each made the way PXLBuilder makes it: a space shooter (the shooters guide:
 * the top-down starter, the ship's Shooter and StayOnScreen, saucers that fire back), a Motherload-like mining game
 * (a side view, the player digging by script, fuel and cargo), and a Boulder Dash-like game (the top-down starter,
 * the player stepping square by square by script, boulders that fall by script, diamonds).
 */
import { produce } from 'immer';
import type { ComponentRegistry } from '../../core/components/registry';
import { applyOperations, type Operation } from '../../core/commands/operations';
import { createDefinition, instantiateDefinition } from '../../core/model/factory';
import * as m from '../../core/model/mutations';
import { setScript } from '../../core/script/mutations';
import { projectFromPreset } from '../../core/engine/profile';
import type { Project } from '../../core/types';
import gridMove from '../../runtime/fixtures/gridMove.json';

const at = (col: number, row: number) => ({ x: col * 32 + 16, y: row * 32 + 16 });

/** The space shooter: the ship at the bottom, four saucers in a row above it (the e2e test's build, as the guide says). */
export function spaceShooter(registry: ComponentRegistry): Project {
  const base = produce(projectFromPreset('topdown', registry, 'Space shooter'), (d) => {
    d.scenes[0].entities = [];
    m.addEntity(d, d.scenes[0].id, instantiateDefinition(d.definitions.find((x) => x.name === 'Player')!, { x: -96, y: 160 }));
  });
  const sceneId = base.scenes[0].id;
  const player = base.definitions.find((d) => d.name === 'Player')!.id;
  const ops = [
    { op: 'set_background', sceneId, color: '#05060f', fit: null, parallax: null, parallaxY: null, removeImage: false, scroll: null, stars: { density: 15, speedX: 0, speedY: 120, layers: 3, color: '#ffffff' } },
    { op: 'add_component', target: 'definition', id: player, component: 'StayOnScreen', propsJson: '{}' },
    { op: 'add_component', target: 'definition', id: player, component: 'Shooter', propsJson: JSON.stringify({ trigger: 'key', direction: 'up', interval: 0.2, speed: 450 }) },
    {
      op: 'create_definition',
      ref: 'saucer',
      name: 'Saucer',
      description: 'An alien saucer.',
      category: 'Enemies',
      tags: ['enemy'],
      components: [
        { component: 'Sprite', propsJson: '{"width":24,"height":14,"color":"#9a7bd8"}' },
        { component: 'Collider', propsJson: '{"size":{"x":24,"y":14},"isTrigger":true}' },
        { component: 'Health', propsJson: '{"maxHealth":1,"currentHealth":1}' },
        { component: 'Shooter', propsJson: JSON.stringify({ direction: 'down', interval: 1, variation: 0.8, targetTag: '' }) },
      ],
    },
    ...[0, 1, 2, 3].map((i) => ({ op: 'place_instance', sceneId, definitionRef: 'saucer', x: -96 + i * 64, y: -160, name: null, ref: null })),
  ] as unknown as Operation[];
  return produce(base, (d) => void applyOperations(d, ops, registry));
}

/**
 * Mining: a side view; a field of dirt (Platform tiles tagged "dirt"), rock that can't be dug (Stone), ore in the
 * dirt; the player digs down (and sideways) by script, burning fuel, and carries the ore as cargo.
 */
export function mining(registry: ComponentRegistry): Project {
  return produce(projectFromPreset('platformer', registry, 'Mining'), (d) => {
    const sceneId = d.scenes[0].id;
    d.scenes[0].entities = [];
    const named = (n: string) => d.definitions.find((x) => x.name === n)!;
    const dirt = named('Platform');
    dirt.tags.push('dirt');
    const rock = named('Stone');
    const ore = createDefinition('Ore', { Sprite: registry.createDefault('Sprite', { width: 32, height: 32, color: '#f0c040' }), Collider: registry.createDefault('Collider', { size: { x: 32, y: 32 } }), PhysicsBody: registry.createDefault('PhysicsBody', { bodyType: 'static' }) }, ['dirt', 'ore']);
    d.definitions.push(ore);
    // Columns -6..6, rows 1..10 of ground; the player on top at column 0. Ore at rows 3 and 5 under the player; rock
    // at row 8 under it (the shaft stops there); rock walls at both sides.
    for (let c = -6; c <= 6; c++)
      for (let r = 1; r <= 10; r++) {
        const def = Math.abs(c) === 6 || r === 10 || (c === 0 && r === 8) ? rock : c === 0 && (r === 3 || r === 5) ? ore : dirt;
        m.addEntity(d, sceneId, instantiateDefinition(def, at(c, r)));
      }
    const player = named('Player');
    m.addEntity(d, sceneId, instantiateDefinition(player, at(0, 0)));
    setScript(d, { target: 'definition', id: player.id }, {
      name: 'Digger',
      description: 'Digs the dirt below (Down) or beside it (Left/Right, against it), burning fuel; ore dug is cargo.',
      vars: [
        { name: 'fuel', value: 100 },
        { name: 'cargo', value: 0 },
        { name: 'dug', value: 0 },
      ],
      handlers: [
        {
          when: { on: 'every', seconds: 0.3 },
          if: 'self.grounded and fuel > 0',
          do: [
            {
              do: 'if',
              cond: "key('down') and thing_at(self.x, self.y + 32, 'dirt') != null",
              then: [
                { do: 'if', cond: "has_tag(thing_at(self.x, self.y + 32, 'dirt'), 'ore')", then: [{ do: 'set', var: 'cargo', value: 'cargo + 1' }], else: [] },
                { do: 'remove', target: "thing_at(self.x, self.y + 32, 'dirt')" },
                { do: 'set', var: 'dug', value: 'dug + 1' },
                { do: 'set', var: 'fuel', value: 'fuel - 1' },
              ],
              else: [],
            },
            {
              do: 'if',
              cond: "key('right') and thing_at(self.x + 32, self.y, 'dirt') != null",
              then: [{ do: 'remove', target: "thing_at(self.x + 32, self.y, 'dirt')" }, { do: 'set', var: 'dug', value: 'dug + 1' }, { do: 'set', var: 'fuel', value: 'fuel - 1' }],
              else: [],
            },
          ],
        },
        { when: { on: 'every', seconds: 1 }, if: 'fuel > 0', do: [{ do: 'set', var: 'fuel', value: 'fuel - 0.5' }] },
      ],
    });
  });
}

/**
 * Boulder Dash: a walled room on the top-down starter; dirt (Floor, a trigger, tagged "dirt"), boulders (Barrel,
 * tagged "boulder") that fall a square at a time by script when nothing is under them, diamonds (Coin) to collect;
 * the player steps square by square with the grid-move script (Character Controller speed 0).
 */
export function boulderDash(registry: ComponentRegistry): Project {
  return produce(projectFromPreset('topdown', registry, 'Boulder Dash'), (d) => {
    const sceneId = d.scenes[0].id;
    d.scenes[0].entities = [];
    const named = (n: string) => d.definitions.find((x) => x.name === n)!;
    const player = named('Player');
    setScript(d, { target: 'definition', id: player.id }, gridMove);
    player.components.CharacterController.speed = 0;
    const dirt = named('Floor');
    dirt.tags = ['dirt'];
    dirt.components.Collider = { ...named('Wall').components.Collider, isTrigger: true };
    const boulder = named('Barrel');
    boulder.tags.push('boulder');
    setScript(d, { target: 'definition', id: boulder.id }, {
      name: 'Falls',
      description: 'Falls a square at a time while nothing is under it.',
      vars: [],
      handlers: [
        {
          when: { on: 'every', seconds: 0.15 },
          if: 'not solid_at(self.x, self.y + 32) and thing_at(self.x, self.y + 32) == null',
          do: [{ do: 'glide_to', x: 'self.x', y: 'self.y + 32', speed: '400', on: null }],
        },
      ],
    });
    const put = (n: string, c: number, r: number) => m.addEntity(d, sceneId, instantiateDefinition(named(n), at(c, r)));
    // A room 9 wide, 6 tall. Row 1: the player at column 1, dirt to its right, a diamond at column 5; a boulder at
    // column 3 above the dirt at column 3 (row 0); under it nothing but dirt down to the floor.
    for (let c = 0; c <= 8; c++) {
      put('Wall', c, -1);
      put('Wall', c, 5);
    }
    for (let r = 0; r <= 4; r++) {
      put('Wall', 0, r);
      put('Wall', 8, r);
    }
    put('Player', 1, 1);
    put('Barrel', 3, 0);
    for (const [c, r] of [[2, 1], [3, 1], [4, 1], [3, 2], [3, 3], [6, 1], [2, 0], [4, 0]]) put('Floor', c, r);
    put('Coin', 5, 1);
  });
}
