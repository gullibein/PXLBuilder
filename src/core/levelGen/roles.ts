/**
 * The parts a level is built from (ground, a ledge, an enemy, a coin…) and which of the game's library objects
 * plays each: the level builder places roles, and the game's own objects (drawn by the AI or the user, or the
 * starters) are what appear. It never makes objects of its own: a part the game has no object for is simply not
 * used (patterns that need it are left out).
 *
 * An object is found by what it is (its components, its collider, its scripts), not by its name, so renamed and
 * redrawn objects still count. When several fit, the one placed most often in the game wins, then the starter's.
 */
import type { ComponentRegistry } from '../components/registry';
import { instantiateDefinition } from '../model/factory';
import { getEntitySize } from '../model/geometry';
import { LEVEL_CELL } from '../model/placement';
import { resolveEntity } from '../model/resolve';
import type { ComponentMap, Id, ObjectDefinition, Project } from '../types';

export type Role =
  | 'player'
  | 'ground'
  | 'ledge'
  | 'oneway'
  | 'rampRight'
  | 'rampLeft'
  | 'ladder'
  | 'hazard'
  | 'lava'
  | 'water'
  | 'deepWater'
  | 'enemy'
  | 'coin'
  | 'key'
  | 'heart'
  | 'door'
  | 'switch'
  | 'plate'
  | 'teleporter'
  | 'goal'
  | 'crate'
  | 'spring'
  | 'block'
  | 'brick'
  | 'pipeTop'
  | 'pipe'
  | 'mover';

export interface RoleObject {
  id: Id;
  name: string;
  /** Its size in cells (a door 1×2, a pipe 2×1). */
  cells: { w: number; h: number };
}

export type Roles = Partial<Record<Role, RoleObject>>;

interface Info {
  def: ObjectDefinition;
  c: ComponentMap;
  scripts: string[];
  tags: string[];
  starter: string;
}

const scriptNames = (d: ObjectDefinition) => (d.scripts ?? []).map((s) => s.name);
const collider = (i: Info) => i.c.Collider as { shape?: string; oneWay?: boolean; isTrigger?: boolean } | undefined;
const solidBox = (i: Info) => {
  const col = collider(i);
  return !!col && !col.isTrigger && !col.oneWay && (col.shape ?? 'box') !== 'slopeRight' && col.shape !== 'slopeLeft' && (i.c.PhysicsBody as { bodyType?: string } | undefined)?.bodyType !== 'dynamic';
};
const hurts = (i: Info) => i.scripts.includes('Hurts on touch') || i.tags.includes('hazard');
const moves = (i: Info) => !!(i.c.Patrol || i.c.Wander || i.c.MovingPlatform || i.c.Shooter) || i.scripts.some((s) => /walker|chaser|hopper|flyer|swooper/i.test(s));
const plain = (i: Info) => !i.scripts.length && !i.c.Openable && !i.c.Pushable && !i.c.Switch && !i.c.Goal && !i.c.MovingPlatform && !i.c.Liquid;
const liquid = (i: Info) => i.c.Liquid as { swim?: boolean } | undefined;

/** What makes an object fit each role (in the order roles are filled: the first that takes an object keeps it). */
const FITS: [Role, (i: Info) => boolean][] = [
  ['player', (i) => !!i.c.CharacterController],
  ['goal', (i) => !!i.c.Goal],
  ['door', (i) => !!i.c.Openable],
  ['plate', (i) => !!i.c.Switch && (i.scripts.includes('Pressure plate') || i.tags.includes('plate'))],
  ['switch', (i) => !!i.c.Switch],
  ['ladder', (i) => !!i.c.Climbable],
  ['crate', (i) => !!i.c.Pushable],
  ['mover', (i) => !!i.c.MovingPlatform],
  ['lava', (i) => !!liquid(i) && liquid(i)!.swim === false],
  ['deepWater', (i) => !!liquid(i) && liquid(i)!.swim !== false && (i.starter === 'Deep water' || /deep/i.test(i.def.name))],
  ['water', (i) => !!liquid(i) && liquid(i)!.swim !== false],
  ['spring', (i) => i.scripts.includes('Spring') || i.tags.includes('spring')],
  ['block', (i) => i.scripts.includes('Question block') || i.tags.includes('question')],
  ['brick', (i) => i.scripts.includes('Brick block') || i.tags.includes('brick')],
  ['enemy', (i) => (i.tags.includes('enemy') || !!i.c.Patrol) && !i.c.CharacterController],
  ['hazard', (i) => hurts(i) && !moves(i) && !liquid(i)],
  ['key', (i) => i.tags.includes('key') || (i.c.Collectible as { itemId?: string } | undefined)?.itemId === 'key'],
  ['heart', (i) => i.tags.includes('heart') || Number((i.c.Collectible as { heal?: number } | undefined)?.heal ?? 0) > 0],
  ['coin', (i) => !!i.c.Collectible],
  ['teleporter', (i) => i.tags.includes('teleporter')],
  ['rampRight', (i) => collider(i)?.shape === 'slopeRight'],
  ['rampLeft', (i) => collider(i)?.shape === 'slopeLeft'],
  ['oneway', (i) => !!collider(i)?.oneWay && !collider(i)?.isTrigger],
  ['pipeTop', (i) => i.tags.includes('pipe') && (i.starter === 'Pipe top' || /top|rim/i.test(i.def.name))],
  ['pipe', (i) => i.tags.includes('pipe')],
  ['ground', (i) => solidBox(i) && plain(i) && (i.tags.includes('ground') || i.starter === 'Platform' || !!(i.c.Sprite as { autotile?: boolean } | undefined)?.autotile)],
  ['ledge', (i) => solidBox(i) && plain(i)],
];

/** How often each object is placed in the game (any level). */
function placedCounts(project: Project): Map<Id, number> {
  const n = new Map<Id, number>();
  for (const s of project.scenes) for (const e of s.entities) if (e.definitionId) n.set(e.definitionId, (n.get(e.definitionId) ?? 0) + 1);
  return n;
}

/** Which of the game's objects plays each role (roles the game has no object for are missing). */
export function findRoles(project: Project, registry: ComponentRegistry): Roles {
  const placed = placedCounts(project);
  const infos: Info[] = project.definitions.map((def) => ({
    def,
    c: resolveEntity(project, instantiateDefinition(def, { x: 0, y: 0 }), registry).components,
    scripts: scriptNames(def),
    tags: def.tags,
    starter: typeof def.metadata.starter === 'string' ? def.metadata.starter : '',
  }));
  const taken = new Set<Id>();
  const roles: Roles = {};
  for (const [role, fits] of FITS) {
    const options = infos.filter((i) => !taken.has(i.def.id) && fits(i));
    if (!options.length) continue;
    // (Placed most often first; then a starter object; then library order.)
    const best = [...options].sort((a, b) => (placed.get(b.def.id) ?? 0) - (placed.get(a.def.id) ?? 0) || Number(!!b.starter) - Number(!!a.starter))[0];
    taken.add(best.def.id);
    const size = getEntitySize(resolveEntity(project, instantiateDefinition(best.def, { x: 0, y: 0 }), registry));
    roles[role] = { id: best.def.id, name: best.def.name, cells: { w: Math.max(1, Math.round(size.x / LEVEL_CELL)), h: Math.max(1, Math.round(size.y / LEVEL_CELL)) } };
  }
  return roles;
}

/** The roles of this list the game has no object for. */
export function missingRoles(roles: Roles, needed: readonly Role[]): Role[] {
  return needed.filter((r) => !roles[r]);
}
