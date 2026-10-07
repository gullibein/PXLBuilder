import { produce } from 'immer';
import { describe, expect, it } from 'vitest';
import { createBuiltinRegistry } from '../components/builtin';
import * as logic from '../logic/mutations';
import { createDefinition, createProject, instantiateDefinition } from './factory';
import * as m from './mutations';
import { levelReachability, reachabilityProblems } from './reachability';
import type { Id, Project } from '../types';

const registry = createBuiltinRegistry();

/** Ground from x=-144 to 144 (top at y=32), the player standing at x=0; `build` adds more. Tiles are 32 px. */
function level(build: (place: (name: string, x: number, y: number) => Id, d: Project, sceneId: Id) => void = () => {}) {
  const base = createProject(registry);
  const sceneId = base.scenes[0].id;
  const project = produce(base, (d) => {
    d.scenes[0].entities = [];
    const place = (name: string, x: number, y: number) => {
      const e = instantiateDefinition(d.definitions.find((x) => x.name === name)!, { x, y });
      m.addEntity(d, sceneId, e);
      return e.id;
    };
    for (let x = -144; x <= 144; x += 32) place('Platform', x, 48);
    place('Player', 0, 16);
    build(place, d, sceneId);
  });
  return { project, sceneId, check: () => levelReachability(project, sceneId, registry), problems: () => reachabilityProblems(project, sceneId, registry) };
}
const unreachable = (r: ReturnType<typeof levelReachability>) => (r.status === 'ok' ? r.unreachable : null);

describe('can the player get there?', () => {
  it('a coin on a platform three tiles up is out of reach (the player jumps about 1.9 tiles)', () => {
    const l = level((place) => {
      for (const x of [96, 128]) place('Platform', x, -48);
      place('Coin', 112, -80);
    });
    expect(unreachable(l.check())!.things.map((t) => t.name)).toEqual(['Coin']);
    expect(unreachable(l.check())!.platforms).toHaveLength(1);
    expect(l.problems()[0].text).toMatch(/can't get to Coin from where it starts \(the player jumps about 1\.9 tiles high/);
    expect(l.problems()[1].text).toMatch(/1 platform is out of the player's reach.*add a ladder/);
  });

  it('…but a ladder up to it, or a platform one tile up, makes it reachable', () => {
    const ladder = level((place) => {
      for (const x of [96, 128]) place('Platform', x, -48);
      place('Coin', 112, -80);
      for (const y of [16, -16, -48]) place('Ladder', 64, y);
    });
    expect(unreachable(ladder.check())).toEqual({ things: [], platforms: [] });
    const steps = level((place) => {
      for (const x of [96, 128]) place('Platform', x, 16); // one tile up
      for (const x of [160, 192]) place('Platform', x, -16); // and one more
      place('Coin', 176, -48);
    });
    expect(steps.problems()).toEqual([]);
  });

  it('a gap wider than a running jump cuts the level off; a teleporter bridges it', () => {
    const gap = level((place) => {
      for (const x of [480, 512, 544]) place('Platform', x, 48);
      place('Key', 512, 20);
    });
    expect(unreachable(gap.check())!.things.map((t) => t.name)).toEqual(['Key']);
    const tele = level((place, d, sceneId) => {
      for (const x of [480, 512, 544]) place('Platform', x, 48);
      place('Key', 512, 20);
      const def = createDefinition('Pad', { Sprite: registry.createDefault('Sprite', { width: 24, height: 8 }), Collider: registry.createDefault('Collider', { size: { x: 24, y: 8 }, isTrigger: true }) });
      m.addDefinition(d, def, registry);
      const a = instantiateDefinition(def, { x: 96, y: 28 }, 'Pad A');
      const b = instantiateDefinition(def, { x: 544, y: 28 }, 'Pad B');
      m.addEntity(d, sceneId, a);
      m.addEntity(d, sceneId, b);
      logic.addRelationship(d, sceneId, { type: 'teleports_to', source: { kind: 'entity', id: a.id }, target: { kind: 'entity', id: b.id }, params: {}, conditions: [] });
    });
    expect(unreachable(tele.check())!.things.map((t) => t.name)).toEqual([]);
  });

  it('a player above nothing falls out at once', () => {
    const l = level((_place, d, sceneId) => {
      const p = d.scenes[0].entities.find((e) => e.name === 'Player')!;
      m.setEntityTransform(d, sceneId, p.id, { position: { x: 900, y: 16 } });
    });
    expect(l.check()).toEqual({ status: 'no-ground', player: 'Player' });
    expect(l.problems()[0].text).toMatch(/starts above nothing/);
  });

  it('moving platforms make it uncertain: no verdict, no false alarm', () => {
    const l = level((place, d, sceneId) => {
      const id = place('Stone', 96, -48);
      m.addEntityComponent(d, sceneId, id, 'MovingPlatform', registry, { offset: { x: 0, y: 64 } });
      place('Coin', 96, -80);
    });
    expect(l.check().status).toBe('uncertain');
    expect(l.problems()).toEqual([]);
  });

  it('double jump reaches higher', () => {
    const l = level((place, d) => {
      for (const x of [96, 128]) place('Platform', x, -16); // two tiles up
      place('Coin', 112, -48);
      const player = d.definitions.find((x) => x.name === 'Player')!;
      player.components.DoubleJump = { extraJumps: 1 };
    });
    expect(l.problems()).toEqual([]);
  });

  it('a player that starts inside a platform or on spikes', () => {
    const stuck = level((place) => place('Stone', 0, 16));
    expect(stuck.problems()[0].text).toMatch(/^Player starts inside Stone: move the start onto free ground/);
    const spikes = level((place) => place('Hazard', 0, 24));
    expect(spikes.problems()[0].text).toMatch(/^Player starts touching Hazard, which hurts it at once/);
    const beside = level((place) => place('Hazard', 96, 24));
    expect(beside.problems()).toEqual([]);
  });
});
