/**
 * Can the player get to everything in a level? Follows the player from its
 * start across the surfaces it can stand on, by walking, jumping (the real
 * arc from its Character Controller and gravity), falling, climbing ladders
 * and taking teleporters, and lists what it can never get to.
 *
 * It's a static estimate, used to catch levels that can't be finished (an AI
 * level with platforms out of jumping range). It errs on the side of
 * "reachable": walls in the way and headroom are not modelled, so it may miss
 * a problem but should not report one that isn't there. Levels with moving
 * solids or player scripts (a jetpack…) are marked uncertain and not judged.
 */
import { hurtsOnTouch, onlyOnTouch, touchHarm } from './ruleScripts';
import type { ComponentRegistry } from '../components/registry';
import type { Id, Project, Vec2 } from '../types';
import { refMatches } from '../logic/refs';
import { getEntitySize } from './geometry';
import { characterReach, type Reach } from './reach';
import { resolveEntity, type ResolvedEntity } from './resolve';
import { LEVEL_CELL } from './placement';
import { moverPath } from './movingPath';
import { isTopDownScene } from './topDown';

interface Box {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/** A stretch of surface the player can stand on. */
interface Span {
  left: number;
  right: number;
  top: number;
  ids: Id[];
}

export interface Unreachable {
  /** Things the player needs (items, switches, doors, exits, teleporters) that it can't get to. */
  things: { id: Id; name: string }[];
  /** Open platforms (2+ tiles wide, nothing right above them) it can never stand on. */
  platforms: { ids: Id[]; left: number; right: number; top: number }[];
}

export type ReachabilityResult =
  /** Seen from above: which free cells (32 px) the player can walk to, and the free cells walled off from it. */
  | { status: 'topdown'; unreachable: Unreachable; cells: { col: number; row: number; reached: boolean }[] }
  | { status: 'ok'; unreachable: Unreachable; reach: Reach; surfaces: { left: number; right: number; top: number; reached: boolean }[] }
  | { status: 'no-player' }
  | { status: 'no-ground'; player: string }
  | { status: 'uncertain'; why: string };

const EDGE = 2;
const MARGIN = 0.92;

/** A collider of several boxes (shape "boxes"), where it is: each box (else its one box). */
function partsOfResolved(r: ResolvedEntity): Box[] {
  const col = r.components.Collider;
  const list = col?.shape === 'boxes' && Array.isArray(col.boxes) ? (col.boxes as { x: number; y: number; w: number; h: number }[]).filter((b) => b.w > 0 && b.h > 0) : [];
  if (!list.length) return [boxOf(r)];
  const { position, scale } = r.transform;
  const sw = Number(r.components.Sprite?.width ?? 32);
  const sh = Number(r.components.Sprite?.height ?? 32);
  return list.map((b) => {
    const cx = position.x + (b.x + b.w / 2 - sw / 2) * scale.x;
    const cy = position.y + (b.y + b.h / 2 - sh / 2) * scale.y;
    const w = b.w * Math.abs(scale.x);
    const h = b.h * Math.abs(scale.y);
    return { left: cx - w / 2, right: cx + w / 2, top: cy - h / 2, bottom: cy + h / 2 };
  });
}

function boxOf(r: ResolvedEntity): Box {
  const { position, scale } = r.transform;
  const col = r.components.Collider;
  let w: number;
  let h: number;
  let off: Vec2 = { x: 0, y: 0 };
  if (col && typeof col.size === 'object' && col.size) {
    const s = col.size as Vec2;
    w = s.x;
    h = col.shape === 'circle' ? s.x : s.y;
    if (typeof col.offset === 'object' && col.offset) off = col.offset as Vec2;
  } else {
    const s = getEntitySize(r);
    w = s.x;
    h = s.y;
  }
  w *= Math.abs(scale.x);
  h *= Math.abs(scale.y);
  const cx = position.x + off.x * scale.x;
  const cy = position.y + off.y * scale.y;
  return { left: cx - w / 2, right: cx + w / 2, top: cy - h / 2, bottom: cy + h / 2 };
}

/**
 * Statements that leave how things move alone (sounds, lives, items, messages, events…). A script with only these
 * (and conditions and loops around them) doesn't stop the level being judged: one with anything else (velocity,
 * jump, gravity, a teleport, a field changed…) might, so the level is then left unjudged.
 */
const KEEPS_MOVEMENT = new Set([
  'set', 'if', 'each', 'repeat', 'face', 'shoot', 'spawn', 'damage', 'kill', 'heal', 'give_item', 'take_item', 'set_switch', 'set_health',
  'invincible', 'respawn_after', 'defeated', 'state', 'signal', 'emit', 'message', 'alpha', 'tag', 'draw', 'erase', 'builtin_display',
  'go_to_level', 'play_sound', 'play_music', 'stop_music', 'respawn', 'restart_level', 'restart_game', 'pause', 'resume', 'set_sound',
  'set_music', 'complete_level', 'camera_shake',
]);

/** `ownOnly`: only what moves the script's owner counts (a spring bouncing whoever lands on it doesn't move the spring). */
export function changesMovement(script: unknown, ownOnly = false): boolean {
  const sc = script as { enabled?: boolean; takesOver?: string; handlers?: unknown } | null;
  if (sc?.enabled === false) return false;
  // (One that does part of the engine's own work, its movement say, instead of the engine.)
  if (sc?.takesOver) return true;
  let moves = false;
  const walk = (v: unknown): void => {
    if (moves || !v || typeof v !== 'object') return;
    if (Array.isArray(v)) return v.forEach(walk);
    const o = v as Record<string, unknown>;
    if (typeof o.do === 'string' && !KEEPS_MOVEMENT.has(o.do) && !(ownOnly && typeof o.on === 'string' && o.on !== 'self')) {
      moves = true;
      return;
    }
    Object.values(o).forEach(walk);
  };
  walk(sc?.handlers ?? script);
  return moves;
}

/**
 * A double (triple…) jump: each extra jump pressed at the top of the one before adds a whole jump's height, which a
 * player who knows about it does easily. Counted a little under that (it still takes timing).
 */
const EXTRA_JUMP = 0.95;
function withExtraJumps(base: Reach, extra: number): Reach {
  if (!(extra > 0)) return base;
  const k = 1 + EXTRA_JUMP * extra;
  return { ...base, height: base.height * k, distance: base.distance * k, jumpForce: base.jumpForce * Math.sqrt(k) };
}

const gapBetween = (a: { left: number; right: number }, b: { left: number; right: number }) => Math.max(0, b.left - a.right, a.left - b.right);

/** Horizontal distance a full jump covers before coming down to `rise` above where it started (rise < 0: lower). */
export function jumpDistance(reach: Reach, rise: number): number {
  const v = reach.jumpForce;
  const g = reach.gravity;
  const disc = v * v - 2 * g * rise;
  if (disc < 0) return -1;
  return reach.speed * ((v + Math.sqrt(disc)) / g);
}

export function levelReachability(project: Project, sceneId: Id, registry: ComponentRegistry): ReachabilityResult {
  const scene = project.scenes.find((s) => s.id === sceneId);
  if (!scene) return { status: 'no-player' };
  const all = scene.entities.map((e) => resolveEntity(project, e, registry));
  const player = all.find((r) => r.components.CharacterController);
  if (!player) return { status: 'no-player' };
  if (isTopDownScene(project, scene, registry)) return topDownReachability(scene, all, player);

  const isSolid = (r: ResolvedEntity) => {
    const col = r.components.Collider;
    if (!col || col.isTrigger === true) return false;
    if (r.components.PhysicsBody?.bodyType === 'dynamic') return false;
    if (r.components.Openable?.startsOpen === true) return false;
    return true;
  };
  // (Enemies are no floors to count on, however they move.)
  const enemy = (r: ResolvedEntity) => r.tags.some((t) => /^(enemy|enemies|monster|guard)$/i.test(t)) || !!r.components.Patrol || hurtsOnTouch(r.scripts, player.tags);
  const solids = all.filter((r) => r !== player && isSolid(r) && !enemy(r));

  // Things that move solids or change how the player moves can't be judged statically.
  if (solids.some((r) => r.components.MovingPlatform || r.scripts.some((sc) => changesMovement(sc, true)))) return { status: 'uncertain', why: 'moving or scripted platforms' };
  if (player.scripts.some((sc) => changesMovement(sc))) return { status: 'uncertain', why: 'the player runs scripts that change how it moves' };
  if (scene.relationships.some((r) => r.type === 'controls' && (r.params.action === 'move' || r.params.action === 'disappear'))) return { status: 'uncertain', why: 'switches move platforms' };

  const base = characterReach(player.components, scene.world.gravity.y);
  if (!base) return { status: 'uncertain', why: 'the player has no jump' };
  const extra = Number(player.components.DoubleJump?.extraJumps ?? 0);
  // Double jump: each extra jump adds about another full jump in height and air time.
  const reach: Reach = withExtraJumps(base, extra);
  const pBox = boxOf(player);
  const pHeight = pBox.bottom - pBox.top;
  const pHalf = (pBox.right - pBox.left) / 2;
  // Ledge grab: a wall top a bit above the jump's peak can still be caught and climbed.
  const grab = player.components.LedgeGrab ? pHeight * 0.6 : 0;

  // Standable tops: the top of a solid with nothing solid sitting right on it.
  // (A collider of several boxes: each is a wall or floor of its own.)
  const boxes = solids.flatMap((r) => partsOfResolved(r).map((b) => ({ r, b })));
  const tops: Span[] = [];
  for (const { r, b } of boxes) {
    const covered = boxes.some(({ r: o, b: ob }) => o !== r && ob.bottom >= b.top - 4 && ob.bottom <= b.top + EDGE && ob.left < b.right - EDGE && ob.right > b.left + EDGE);
    if (!covered && !(r.components.Climbable && r.components.Collider?.isTrigger)) tops.push({ left: b.left, right: b.right, top: b.top, ids: [r.id] });
  }
  // Merge side-by-side tops at the same height into spans.
  tops.sort((a, b) => a.top - b.top || a.left - b.left);
  const spans: Span[] = [];
  for (const t of tops) {
    const last = spans.at(-1);
    if (last && Math.abs(last.top - t.top) <= EDGE && t.left <= last.right + EDGE) {
      last.right = Math.max(last.right, t.right);
      last.ids.push(...t.ids);
    } else spans.push({ ...t, ids: [...t.ids] });
  }

  // Spikes and other things that stay put and hurt the player: the floor under them is no floor to walk on. They
  // cut it in two, jumped over (canJump) as far as the jump keeps the whole body above them.
  const meRef = { id: player.id, definitionId: player.definitionId, tags: player.tags };
  const hazards = all
    .filter((r) => r !== player && !r.tags.some((t) => /^(enemy|enemies|monster|guard)$/i.test(t)) && !r.components.Patrol && r.components.PhysicsBody?.bodyType !== 'dynamic' && !r.components.MovingPlatform && !r.scripts.some((sc) => changesMovement(sc)))
    .filter((r) => hurtsOnTouch(r.scripts, player.tags) || scene.relationships.some((rel) => rel.type === 'damages' && refMatches(rel.source, { id: r.id, definitionId: r.definitionId, tags: r.tags }) && refMatches(rel.target, meRef)))
    .map(boxOf);
  for (let i = 0; i < spans.length; i++) {
    const sp = spans[i];
    const on = hazards.filter((h) => h.bottom >= sp.top - 16 && h.bottom <= sp.top + 2 && h.left < sp.right && h.right > sp.left).sort((a, b) => a.left - b.left);
    if (!on.length) continue;
    const pieces: Span[] = [];
    let x = sp.left;
    for (const h of on) {
      if (h.left - x >= 1) pieces.push({ left: x, right: h.left, top: sp.top, ids: sp.ids });
      x = Math.max(x, h.right);
    }
    if (sp.right - x >= 1) pieces.push({ left: x, right: sp.right, top: sp.top, ids: sp.ids });
    spans.splice(i, 1, ...pieces);
    i += pieces.length - 1;
  }

  // Ramps: walked up and down, from the ground at the foot to the ground at the top (whatever the jump).
  const rampLinks: [number, number][] = [];
  for (const r of solids) {
    const shape = r.components.Collider?.shape;
    if (shape !== 'slopeRight' && shape !== 'slopeLeft') continue;
    const b = boxOf(r);
    const highX = shape === 'slopeRight' ? b.right : b.left;
    const lowX = shape === 'slopeRight' ? b.left : b.right;
    const near = (top: number, x: number) => spans.findIndex((s) => Math.abs(s.top - top) <= EDGE + 2 && x >= s.left - EDGE - 1 && x <= s.right + EDGE + 1);
    const high = near(b.top, highX);
    const low = near(b.bottom, lowX);
    if (high >= 0 && low >= 0 && high !== low) rampLinks.push([low, high], [high, low]);
  }

  // Water to swim in: from anywhere in a pool (its floor, ledges under water) up to the banks round its surface, and back.
  const pools: Box[] = [];
  for (const r of all) {
    if (!r.components.Liquid || r.components.Liquid.swim === false) continue;
    const b = boxOf(r);
    const near = pools.find((p) => b.left <= p.right + 1 && b.right >= p.left - 1 && b.top <= p.bottom + 1 && b.bottom >= p.top - 1);
    if (near) {
      near.left = Math.min(near.left, b.left);
      near.right = Math.max(near.right, b.right);
      near.top = Math.min(near.top, b.top);
      near.bottom = Math.max(near.bottom, b.bottom);
    } else pools.push({ ...b });
  }
  const poolSpans: { pool: Box; spans: number[] }[] = [];
  for (const p of pools) {
    const touching = spans
      .map((s, i) => ({ s, i }))
      .filter(({ s }) => (s.right > p.left && s.left < p.right && s.top >= p.top - EDGE && s.top <= p.bottom + EDGE) || (gapBetween(s, p) <= pHalf * 2 + 8 && Math.abs(s.top - p.top) <= reach.height + pHeight))
      .map(({ i }) => i);
    for (const a of touching) for (const b of touching) if (a !== b) rampLinks.push([a, b]);
    poolSpans.push({ pool: p, spans: touching });
  }

  // Ladders: stacked climbable pieces form columns.
  const ladderBoxes = all.filter((r) => r.components.Climbable).map((r) => boxOf(r)).sort((a, b) => a.left - b.left || a.top - b.top);
  const ladders: Box[] = [];
  for (const b of ladderBoxes) {
    const col = ladders.find((l) => Math.abs(l.left - b.left) <= 4 && b.top <= l.bottom + EDGE && b.bottom >= l.top - EDGE);
    if (col) {
      col.top = Math.min(col.top, b.top);
      col.bottom = Math.max(col.bottom, b.bottom);
    } else ladders.push({ ...b });
  }

  // Where the player starts: the first surface below its feet.
  const under = (x: number, bottom: number, within: number) =>
    spans
      .map((s, i) => ({ s, i }))
      .filter(({ s }) => x >= s.left - pHalf && x <= s.right + pHalf && s.top >= bottom - 4 && s.top <= bottom + within)
      .sort((a, b) => a.s.top - b.s.top)[0]?.i;
  const start = under(player.transform.position.x, pBox.bottom, 4000);
  if (start === undefined) return { status: 'no-ground', player: player.name };

  // Teleporters: from the surface under one to the surface under the other.
  const byId = new Map(all.map((r) => [r.id, r]));
  const teleports: [number, number][] = [];
  for (const rel of scene.relationships) {
    if (rel.type !== 'teleports_to' || rel.source.kind !== 'entity' || rel.target.kind !== 'entity') continue;
    const from = byId.get(rel.source.id);
    const to = byId.get(rel.target.id);
    if (!from || !to) continue;
    const a = under(from.transform.position.x, boxOf(from).bottom, 96);
    const b = under(to.transform.position.x, boxOf(to).bottom, 4000);
    if (a !== undefined && b !== undefined) teleports.push([a, b]);
  }

  // Crates (things to push) standing on a floor: pushed along it under a ledge, the player jumps from on top of
  // one (the highest crate there) instead of from the floor.
  const lift = new Map<Span, number>();
  for (const r of all) {
    if (!r.components.Pushable || r === player) continue;
    const b = boxOf(r);
    const cx = (b.left + b.right) / 2;
    const on = spans.find((s) => Math.abs(s.top - b.bottom) <= 4 && cx >= s.left && cx <= s.right);
    if (on) lift.set(on, Math.max(lift.get(on) ?? 0, b.bottom - b.top));
  }
  // What the head hits jumping up: solids that block from below (not jump-through platforms or ramps; doors count
  // as open: getting what opens them is checked on its own).
  const ceilings = boxes.filter(({ r }) => !r.components.Openable && r.components.Collider?.oneWay !== true && r.components.Collider?.shape !== 'slopeRight' && r.components.Collider?.shape !== 'slopeLeft').map(({ b }) => b);
  const blocked = (left: number, right: number, top: number, bottom: number) => left < right && top < bottom && ceilings.some((c) => c.left < right && c.right > left && c.top < bottom && c.bottom > top);
  /**
   * Jumping UP (or across, level) onto a surface takes room: somewhere on the floor to jump from with nothing just over the player's
   * head (up to where its feet reach the landing's height), and nothing in the way between there and the landing at
   * that height (a low ceiling over the way to a step leaves the step out of reach). Tried along the floor a few
   * pixels apart.
   */
  const roomToJump = (from: Span, floor: number, to: { left: number; right: number; top: number }, reachX: number) => {
    const headAtLanding = to.top - pHeight;
    for (let x = from.left; x <= from.right; x += 8) {
      const body = { left: x - pHalf, right: x + pHalf };
      const away = gapBetween(body, to);
      if (away > reachX) continue;
      // Straight up from here, head and all, to the landing's height.
      if (blocked(body.left + 2, body.right - 2, headAtLanding, floor - 1)) continue;
      // Across to the landing, at its height.
      const l = x < to.left ? body.right - 2 : to.right;
      const r = x < to.left ? to.left : body.left + 2;
      if (away > 0 && blocked(l, r, headAtLanding, to.top - 2)) continue;
      return true;
    }
    return false;
  };
  /**
   * Across hazards lying between two stretches of the same floor: the jump must keep the whole body above them, for
   * as long as it takes to pass (the jump table's spike rule), and a ceiling over them caps how high it gets.
   */
  const overHazards = (from: Span, to: { left: number; right: number; top: number }) => {
    if (Math.abs(from.top - to.top) > EDGE) return true;
    const gl = Math.min(from.right, to.right);
    const gr = Math.max(from.left, to.left);
    const between = hazards.filter((h) => h.left < gr && h.right > gl && h.bottom >= from.top - 16 && h.bottom <= from.top + 2);
    if (!between.length) return true;
    const tall = from.top - Math.min(...between.map((h) => h.top));
    const over = ceilings.filter((c) => c.left < gr + pHalf && c.right > gl - pHalf && c.bottom <= from.top - pHeight + 1);
    const clear = over.length ? from.top - Math.max(...over.map((c) => c.bottom)) : Infinity;
    const apex = Math.min(reach.height * MARGIN, clear - pHeight);
    if (apex <= tall) return false;
    const t = 2 * Math.sqrt((2 * (apex - tall)) / reach.gravity);
    return gr - gl <= reach.speed * t * MARGIN - pHalf * 2;
  };
  // Springs (the ready-made Spring script): a launch from on top of one, its "launch" times the jump's height.
  const springs = new Map<Span, number>();
  for (const r of solids) {
    const sc = r.scripts.find((x) => x.name === 'Spring' && x.enabled !== false);
    if (!sc) continue;
    const launch = Number(sc.vars.find((v) => v.name === 'launch')?.value ?? 2);
    const on = spans.find((sp) => sp.ids.includes(r.id));
    if (on && launch > 0) springs.set(on, Math.max(springs.get(on) ?? 0, launch));
  }
  const own = reach;
  const canJump = (from: Span, to: { left: number; right: number; top: number }) => {
    if (!overHazards(from, to)) return false;
    const jump = (up: number, reach: Reach = own) => {
      const rise = from.top - up - to.top;
      if (rise > reach.height * MARGIN + grab) return false;
      const d = jumpDistance(reach, Math.max(-4000, Math.min(rise, reach.height * MARGIN)));
      const reachX = Math.max(0, d * MARGIN);
      if (gapBetween(from, to) > reachX + pHalf) return false;
      // (Down: not checked; the jump arcs over what is lower than where it starts.)
      return rise < -EDGE || roomToJump(from, from.top - up, to, reachX);
    };
    // (From a spring: launched as high as it says, its launch times the jump's height.)
    const launch = springs.get(from);
    return jump(0) || ((lift.get(from) ?? 0) > 0 && jump(lift.get(from)!)) || (!!launch && jump(0, { ...own, height: own.height * launch, jumpForce: own.jumpForce * Math.sqrt(launch), distance: own.distance * Math.sqrt(launch) }));
  };

  // Search: spans and ladders.
  const reachedSpans = new Set<number>([start]);
  const reachedLadders = new Set<number>();
  const queue: ['s' | 'l', number][] = [['s', start]];
  while (queue.length) {
    const [kind, i] = queue.shift()!;
    if (kind === 's') {
      const from = spans[i];
      spans.forEach((to, j) => {
        if (!reachedSpans.has(j) && canJump(from, to)) {
          reachedSpans.add(j);
          queue.push(['s', j]);
        }
      });
      ladders.forEach((l, j) => {
        // Get onto a ladder whose lowest part is within jumping height (plus the body's own height) and range.
        if (reachedLadders.has(j) || l.bottom < from.top - reach.height * MARGIN - pHeight || l.top > from.top + 4000) return;
        if (gapBetween(from, l) <= jumpDistance(reach, 0) * MARGIN + pHalf) {
          reachedLadders.add(j);
          queue.push(['l', j]);
        }
      });
      for (const [a, b] of [...teleports, ...rampLinks]) {
        if (a === i && !reachedSpans.has(b)) {
          reachedSpans.add(b);
          queue.push(['s', b]);
        }
      }
    } else {
      const l = ladders[i];
      spans.forEach((to, j) => {
        // Step off a ladder onto a surface beside it or at its top (or anything below, by letting go).
        if (reachedSpans.has(j) || gapBetween(l, to) > pHalf * 2 + 8 || to.top < l.top - pHeight) return;
        reachedSpans.add(j);
        queue.push(['s', j]);
      });
    }
  }

  // What the player needs, and whether a reached surface (or ladder) gets it close enough.
  const important = (r: ResolvedEntity) =>
    r !== player &&
    (r.components.Collectible ||
      r.components.Goal ||
      r.components.Switch ||
      r.components.Openable ||
      r.tags.some((t) => /^(goal|exit|finish|flag|checkpoint)$/i.test(t)) ||
      scene.relationships.some((rel) => rel.type === 'teleports_to' && rel.source.kind === 'entity' && rel.source.id === r.id));
  const within = (b: Box) =>
    [...reachedSpans].some((i) => {
      const s = spans[i];
      return gapBetween(s, b) <= pHalf + 4 && b.bottom >= s.top - (reach.height * MARGIN + pHeight + grab) && b.top <= s.top + 4;
    }) || [...reachedLadders].some((i) => gapBetween(ladders[i], b) <= pHalf * 2 && b.bottom >= ladders[i].top - pHeight && b.top <= ladders[i].bottom)
    // Swimming: anywhere in a pool it gets into, and a whole jump out of it at the surface (the surface's jump is a
    // full one).
    || poolSpans.some(({ pool, spans: at }) => at.some((i) => reachedSpans.has(i)) && gapBetween(pool, b) <= pHalf + 4 && b.bottom >= pool.top - (reach.height * MARGIN + pHeight) && b.top <= pool.bottom);
  const things = all.filter((r) => important(r) && !within(boxOf(r))).map((r) => ({ id: r.id, name: r.name }));

  // An enclosed level's roof (the top of its ceiling, across nearly all of it) is no platform to get onto.
  const levelLeft = Math.min(...boxes.map(({ b }) => b.left));
  const levelRight = Math.max(...boxes.map(({ b }) => b.right));
  const levelTop = Math.min(...boxes.map(({ b }) => b.top));
  const roof = (s: Span) => s.top <= levelTop + EDGE && s.right - s.left >= (levelRight - levelLeft) * 0.8 && s.top < pBox.top;
  const platforms = spans
    .map((s, i) => ({ s, i }))
    .filter(({ s, i }) => !reachedSpans.has(i) && !roof(s) && s.right - s.left >= 64 && !solids.some((o) => {
      const b = boxOf(o);
      return b.bottom <= s.top && b.bottom >= s.top - 64 && b.left < s.right && b.right > s.left;
    }))
    .map(({ s }) => ({ ids: s.ids, left: Math.round(s.left), right: Math.round(s.right), top: Math.round(s.top) }));

  return { status: 'ok', unreachable: { things, platforms }, reach, surfaces: spans.map((s, i) => ({ left: s.left, right: s.right, top: s.top, reached: reachedSpans.has(i) })) };
}

/**
 * Seen from above: the player walks from its start through free cells (no
 * wall in them), in four directions, and through teleporters. Doors count as
 * open (getting their key is checked separately, by the key being reachable),
 * and things that move or fly don't block. A cell is free when nothing solid
 * covers more than a sliver of it, so it errs on the side of "reachable".
 */
function topDownReachability(scene: Project['scenes'][number], all: ResolvedEntity[], player: ResolvedEntity): ReachabilityResult {
  if (all.some((r) => r.components.MovingPlatform || (r.scripts.length && r !== player && r.components.Collider && r.components.PhysicsBody?.bodyType !== 'dynamic'))) return { status: 'uncertain', why: 'moving or scripted walls' };
  if (player.scripts.length) return { status: 'uncertain', why: 'the player runs scripts' };
  const C = LEVEL_CELL;
  const walls = all
    .filter((r) => r !== player && r.components.Collider && r.components.Collider.isTrigger !== true && r.components.PhysicsBody?.bodyType !== 'dynamic' && !r.components.Openable)
    .map(boxOf);
  const key = (c: number, r: number) => `${c},${r}`;
  const blocked = new Set<string>();
  for (const b of walls) {
    for (let c = Math.floor((b.left + EDGE) / C); c <= Math.floor((b.right - EDGE) / C); c++) {
      for (let r = Math.floor((b.top + EDGE) / C); r <= Math.floor((b.bottom - EDGE) / C); r++) blocked.add(key(c, r));
    }
  }
  // The level's extent, one cell beyond everything: walking past it leads nowhere.
  const boxes = all.map(boxOf);
  const minC = Math.floor(Math.min(...boxes.map((b) => b.left)) / C) - 1;
  const maxC = Math.floor(Math.max(...boxes.map((b) => b.right)) / C) + 1;
  const minR = Math.floor(Math.min(...boxes.map((b) => b.top)) / C) - 1;
  const maxR = Math.floor(Math.max(...boxes.map((b) => b.bottom)) / C) + 1;
  const inside = (c: number, r: number) => c >= minC && c <= maxC && r >= minR && r <= maxR;
  const cellOf = (p: Vec2) => [Math.floor(p.x / C), Math.floor(p.y / C)] as const;

  const byId = new Map(all.map((r) => [r.id, r]));
  const jumps = new Map<string, string[]>();
  for (const rel of scene.relationships) {
    if (rel.type !== 'teleports_to' || rel.source.kind !== 'entity' || rel.target.kind !== 'entity') continue;
    const from = byId.get(rel.source.id);
    const to = byId.get(rel.target.id);
    if (!from || !to) continue;
    const a = key(...cellOf(from.transform.position));
    jumps.set(a, [...(jumps.get(a) ?? []), key(...cellOf(to.transform.position))]);
  }

  const flood = (from: string[], within: (c: number, r: number) => boolean) => {
    const seen = new Set(from);
    const queue = [...from];
    while (queue.length) {
      const k = queue.pop()!;
      const [c, r] = k.split(',').map(Number);
      const next = [key(c + 1, r), key(c - 1, r), key(c, r + 1), key(c, r - 1), ...(jumps.get(k) ?? [])];
      for (const n of next) {
        const [nc, nr] = n.split(',').map(Number);
        if (seen.has(n) || blocked.has(n) || !within(nc, nr)) continue;
        seen.add(n);
        queue.push(n);
      }
    }
    return seen;
  };
  const reached = flood([key(...cellOf(player.transform.position))], inside);
  // Free cells walled off from the player that aren't just the open space around the level: closed-off rooms.
  const outside = flood(
    Array.from({ length: maxC - minC + 1 }, (_, i) => [key(minC + i, minR), key(minC + i, maxR)]).flat().concat(Array.from({ length: maxR - minR + 1 }, (_, i) => [key(minC, minR + i), key(maxC, minR + i)]).flat()).filter((k) => !blocked.has(k)),
    inside,
  );
  const cells: { col: number; row: number; reached: boolean }[] = [];
  for (let c = minC + 1; c < maxC; c++) {
    for (let r = minR + 1; r < maxR; r++) {
      const k = key(c, r);
      if (blocked.has(k)) continue;
      if (reached.has(k)) cells.push({ col: c, row: r, reached: true });
      else if (!outside.has(k)) cells.push({ col: c, row: r, reached: false });
    }
  }

  const important = (r: ResolvedEntity) =>
    r !== player &&
    (r.components.Collectible ||
      r.components.Goal ||
      r.components.Switch ||
      r.components.Openable ||
      r.tags.some((t) => /^(goal|exit|finish|flag|checkpoint)$/i.test(t)) ||
      scene.relationships.some((rel) => rel.type === 'teleports_to' && rel.source.kind === 'entity' && rel.source.id === r.id));
  // Got to when it is in, or right next to, a cell the player reaches.
  const near = (b: Box) => {
    for (let c = Math.floor((b.left - 4) / C); c <= Math.floor((b.right + 4) / C); c++) {
      for (let r = Math.floor((b.top - 4) / C); r <= Math.floor((b.bottom + 4) / C); r++) if (reached.has(key(c, r))) return true;
    }
    return false;
  };
  const things = all.filter((r) => important(r) && !near(boxOf(r))).map((r) => ({ id: r.id, name: r.name }));
  return { status: 'topdown', unreachable: { things, platforms: [] }, cells };
}

/** What the player overlaps where it starts: solids it is stuck in, and things that hurt it at once. */
export function startConflicts(project: Project, sceneId: Id, registry: ComponentRegistry): { player: string; solid: { id: Id; name: string }[]; hurts: { id: Id; name: string }[] } | null {
  const scene = project.scenes.find((s) => s.id === sceneId);
  if (!scene) return null;
  const placed = scene.entities.map((e) => ({ e, r: resolveEntity(project, e, registry) }));
  const p = placed.find(({ r }) => r.components.CharacterController);
  if (!p) return null;
  const pb = boxOf(p.r);
  const overlapping = (b: Box) => Math.min(pb.right, b.right) - Math.max(pb.left, b.left) > EDGE && Math.min(pb.bottom, b.bottom) - Math.max(pb.top, b.top) > EDGE;
  const solid: { id: Id; name: string }[] = [];
  const hurts: { id: Id; name: string }[] = [];
  for (const { e, r } of placed) {
    if (e === p.e || !r.components.Collider) continue;
    const b = boxOf(r);
    // Touching counts for damage (standing right on spikes), overlapping for being stuck.
    const touching = Math.min(pb.right, b.right) - Math.max(pb.left, b.left) > 0 && Math.min(pb.bottom, b.bottom) - Math.max(pb.top, b.top) >= -1;
    const isSolidHere = r.components.Collider.isTrigger !== true && r.components.PhysicsBody?.bodyType !== 'dynamic' && r.components.Openable?.startsOpen !== true;
    if (isSolidHere && overlapping(b)) solid.push({ id: e.id, name: e.name });
    const target = { id: e.id, definitionId: e.definitionId, tags: r.tags };
    const me = { id: p.e.id, definitionId: p.e.definitionId, tags: p.r.tags };
    const harmful =
      (!!p.r.components.Health && hurtsOnTouch(r.scripts, p.r.tags)) ||
      scene.relationships.some((rel) => rel.type === 'damages' && refMatches(rel.source, target) && refMatches(rel.target, me));
    if (harmful && touching) hurts.push({ id: e.id, name: e.name });
  }
  return { player: p.e.name, solid, hurts };
}

/**
 * Layout mistakes a person wouldn't make: spikes, doors or switches floating
 * in mid-air, an item that can only be picked up by touching something that
 * hurts, and a stand-in (a Coin renamed "Key" when there is a Key object).
 */
export function layoutProblems(project: Project, sceneId: Id, registry: ComponentRegistry): { key: string; text: string; entityIds: Id[] }[] {
  const scene = project.scenes.find((s) => s.id === sceneId);
  if (!scene) return [];
  const placed = scene.entities.map((e) => ({ e, r: resolveEntity(project, e, registry), b: boxOf(resolveEntity(project, e, registry)) }));
  const player = placed.find(({ r }) => r.components.CharacterController);
  const out: { key: string; text: string; entityIds: Id[] }[] = [];
  const names = (list: { e: { name: string } }[]) => {
    const counts = new Map<string, number>();
    for (const { e } of list) counts.set(e.name, (counts.get(e.name) ?? 0) + 1);
    return [...counts].map(([n, c]) => (c > 1 ? `${n} (${c})` : n)).join(', ');
  };
  const solid = (r: ResolvedEntity) => !!r.components.Collider && r.components.Collider.isTrigger !== true && r.components.PhysicsBody?.bodyType !== 'dynamic';
  const surfaces = placed.filter(({ r }) => solid(r) && !touchHarm(r.scripts));
  const overlapX = (a: Box, b: Box) => Math.min(a.right, b.right) - Math.max(a.left, b.left);
  const overlapY = (a: Box, b: Box) => Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
  const near = (a: number, b: number) => Math.abs(a - b) <= 3;
  const attached = (x: { e: { id: Id }; b: Box }) =>
    surfaces.some(({ e, b }) => e.id !== x.e.id && ((overlapX(x.b, b) > 1 && (near(x.b.bottom, b.top) || near(x.b.top, b.bottom) || overlapY(x.b, b) > 1)) || (overlapY(x.b, b) > 1 && (near(x.b.right, b.left) || near(x.b.left, b.right)))));
  const moves = (r: ResolvedEntity) => r.components.PhysicsBody?.bodyType === 'dynamic' || r.components.Patrol || r.components.Wander || r.components.MovingPlatform || r.components.CharacterController || r.scripts.some((sc) => !onlyOnTouch(sc));

  // Floating spikes, doors and switches.
  // (Seen from above nothing needs something under it.)
  const fixed = isTopDownScene(project, scene, registry) ? [] : placed.filter(({ r }) => !moves(r) && (touchHarm(r.scripts) || r.components.Openable || r.components.Switch));
  const floating = fixed.filter((x) => !attached(x));
  if (floating.length) {
    out.push({
      key: `float:${floating.map((x) => x.e.id).sort().join(',')}`,
      text: `${names(floating)} ${floating.length === 1 ? 'floats' : 'float'} in mid-air with nothing under, over or beside ${floating.length === 1 ? 'it' : 'them'}: put spikes on the ground (or under a ceiling, or on a wall), and doors and switches on the ground.`,
      entityIds: floating.map((x) => x.e.id),
    });
  }

  // Items that can only be had by getting hurt.
  if (player) {
    const me = { id: player.e.id, definitionId: player.e.definitionId, tags: player.r.tags };
    const hurts = placed.filter(
      ({ e, r }) =>
        (!!player.r.components.Health && hurtsOnTouch(r.scripts, player.r.tags)) ||
        scene.relationships.some((rel) => rel.type === 'damages' && refMatches(rel.source, { id: e.id, definitionId: e.definitionId, tags: r.tags }) && refMatches(rel.target, me)),
    );
    const trapped = placed.filter((x) => x.r.components.Collectible && hurts.some((h) => overlapX(x.b, h.b) > 0 && overlapY(x.b, h.b) > 0));
    if (trapped.length) {
      out.push({
        key: `trapped:${trapped.map((x) => x.e.id).sort().join(',')}`,
        text: `${names(trapped)} ${trapped.length === 1 ? 'is' : 'are'} inside something that hurts the player, so picking ${trapped.length === 1 ? 'it' : 'them'} up costs health: move ${trapped.length === 1 ? 'it' : 'them'} clear of hazards.`,
        entityIds: trapped.map((x) => x.e.id),
      });
    }
    // Moving platforms whose rider touches something that hurts along the way (a platform moving along the top of
    // the lava: whoever stands on it has its feet in it).
    const pH = player.b.bottom - player.b.top;
    const burning: typeof placed = [];
    const what = new Set<string>();
    for (const x of placed) {
      const mv = x.r.components.MovingPlatform;
      if (!mv || !solid(x.r)) continue;
      const path = moverPath(mv);
      // (Along every stretch, every few pixels: where the rider's body is, standing on top of it.)
      const steps: Vec2[] = [];
      for (let i = 0; i + 1 < path.length + (mv.loop === true ? 1 : 0); i++) {
        const a = path[i];
        const b = path[(i + 1) % path.length];
        const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 8));
        for (let k = 0; k <= n; k++) steps.push({ x: a.x + ((b.x - a.x) * k) / n, y: a.y + ((b.y - a.y) * k) / n });
      }
      const hit = hurts.filter((h) => h.e.id !== x.e.id && !h.r.components.MovingPlatform && steps.some((d) => {
        const rider = { left: x.b.left + d.x + 4, right: x.b.right + d.x - 4, top: x.b.top + d.y - pH, bottom: x.b.top + d.y + 1 };
        return overlapX(rider, h.b) > 0 && overlapY(rider, h.b) > 0;
      }));
      if (hit.length) {
        burning.push(x);
        for (const h of hit) what.add(h.e.name);
      }
    }
    if (burning.length) {
      out.push({
        key: `rider-hurt:${burning.map((x) => x.e.id).sort().join(',')}`,
        text: `Standing on ${names(burning)}, the player touches ${[...what].join(', ')} along the way, so it gets hurt riding it: move the platform (its start and its path) up so its top is a whole cell above what hurts (a platform over lava rides in the row above the lava's top, the lava filling the pit under it), or move what hurts away from its path.`,
        entityIds: burning.map((x) => x.e.id),
      });
    }
  }

  // Stand-ins: a copy named after another library object ("Key" that is really a Coin).
  for (const { e } of placed) {
    const own = project.definitions.find((d) => d.id === e.definitionId);
    const other = project.definitions.find((d) => d.id !== e.definitionId && d.name.toLowerCase() === e.name.trim().toLowerCase());
    if (own && other && own.name.toLowerCase() !== e.name.trim().toLowerCase()) {
      out.push({
        key: `standin:${e.id}`,
        text: `The "${e.name}" here is really a ${own.name} (renamed), not the ${other.name} object: it behaves and is collected as a ${own.name}. Use the ${other.name} object instead.`,
        entityIds: [e.id],
      });
    }
  }
  return out;
}

/** The problems in words (for the Debug tab and for sending back to the AI). Empty when the level can be got through. */
export function reachabilityProblems(project: Project, sceneId: Id, registry: ComponentRegistry): { key: string; text: string; entityIds: Id[] }[] {
  const start = startConflicts(project, sceneId, registry);
  const startProblems: { key: string; text: string; entityIds: Id[] }[] = [];
  if (start?.solid.length) startProblems.push({ key: `start-in-solid:${start.solid.map((s) => s.id).sort().join(',')}`, text: `${start.player} starts inside ${[...new Set(start.solid.map((s) => s.name))].join(', ')}: move the start onto free ground (or move what's in the way).`, entityIds: start.solid.map((s) => s.id) });
  if (start?.hurts.length) startProblems.push({ key: `start-on-hazard:${start.hurts.map((s) => s.id).sort().join(',')}`, text: `${start.player} starts touching ${[...new Set(start.hurts.map((s) => s.name))].join(', ')}, which hurts it at once: start it on safe ground, away from hazards and enemies.`, entityIds: start.hurts.map((s) => s.id) });
  const r = levelReachability(project, sceneId, registry);
  if (r.status === 'topdown') {
    const out = [...startProblems, ...layoutProblems(project, sceneId, registry)];
    if (r.unreachable.things.length) {
      const names = [...new Set(r.unreachable.things.map((t) => t.name))];
      out.push({
        key: `reach-things:${r.unreachable.things.map((t) => t.id).sort().join(',')}`,
        text: `The player can't walk to ${names.slice(0, 6).join(', ')}${names.length > 6 ? ` and ${names.length - 6} more` : ''} from where it starts: walls are in the way (seen from above; doors count as open, teleporters counted). Leave a gap in the wall, add a door, or move it.`,
        entityIds: r.unreachable.things.map((t) => t.id),
      });
    }
    return out;
  }
  if (r.status === 'no-ground') return [...startProblems, ...layoutProblems(project, sceneId, registry), { key: 'reach-no-ground', text: `${r.player} starts above nothing to stand on: it falls out of the level at once.`, entityIds: [] }];
  if (r.status !== 'ok') return [...startProblems, ...layoutProblems(project, sceneId, registry)];
  const tiles = (px: number) => Math.round((px / 32) * 10) / 10;
  const limits = `the player jumps about ${Math.floor((r.reach.height / 32) * 10) / 10} tiles high and ${tiles(r.reach.distance)} tiles far`;
  const out: { key: string; text: string; entityIds: Id[] }[] = [...startProblems, ...layoutProblems(project, sceneId, registry)];
  if (r.unreachable.things.length) {
    const names = [...new Set(r.unreachable.things.map((t) => t.name))];
    out.push({
      key: `reach-things:${r.unreachable.things.map((t) => t.id).sort().join(',')}`,
      text: `The player can't get to ${names.slice(0, 6).join(', ')}${names.length > 6 ? ` and ${names.length - 6} more` : ''} from where it starts (${limits}; walking, jumping, ladders and teleporters counted).`,
      entityIds: r.unreachable.things.map((t) => t.id),
    });
  }
  if (r.unreachable.platforms.length) {
    const n = r.unreachable.platforms.length;
    out.push({
      key: `reach-platforms:${r.unreachable.platforms.map((p) => p.ids[0]).sort().join(',')}`,
      text: `${n} ${n === 1 ? 'platform is' : 'platforms are'} out of the player's reach (${limits}): ${r.unreachable.platforms
        .slice(0, 4)
        .map((p) => `x ${p.left}…${p.right} at y ${p.top}`)
        .join('; ')}${n > 4 ? '…' : ''}. Lower them, close the gaps, or add a ladder.`,
      entityIds: r.unreachable.platforms.flatMap((p) => p.ids),
    });
  }
  return out;
}

/**
 * What the level checker counts as within the player's reach, in cells, so whoever builds a level knows exactly
 * (the same numbers the checker uses): for each height of the landing compared with where it jumps from (rows; +
 * higher), the widest gap of empty cells it clears; how high a ladder's lowest piece may hang over a floor and still
 * be caught; how much a crate to stand on adds.
 */
export interface JumpTable {
  /** For each rise in rows (1: the landing one row higher, 0 level, -3 three rows lower): the widest gap of empty cells between the two floors it still jumps. Rises not listed are too high. */
  gaps: { rise: number; cells: number }[];
  /** The most rows higher a floor it can jump up onto may be. */
  maxRiseRows: number;
  /** Empty rows there may be between a floor and the lowest piece of a ladder over it, for the player to jump and catch it. */
  ladderGapRows: number;
  /** Rows a one-cell crate (pushed under a ledge) adds to how high it gets. */
  crateRows: number;
  /** The most rows above a floor that a launch from a Spring standing on it (Jump held) gets the player up onto. */
  springRows: number;
  /** The widest row of floor hazards it jumps over from the same floor (cells): half a cell tall (spikes), a whole cell tall. */
  spikeCells: { halfCellTall: number; cellTall: number };
}

export function jumpTable(components: ResolvedEntity['components'], gravityY: number): JumpTable | null {
  const base = characterReach(components, gravityY);
  if (!base) return null;
  const extra = Number(components.DoubleJump?.extraJumps ?? 0);
  const reach: Reach = withExtraJumps(base, extra);
  const col = components.Collider as { size?: { x?: number; y?: number } } | undefined;
  const sprite = components.Sprite as { width?: number; height?: number } | undefined;
  const pW = Number(col?.size?.x ?? sprite?.width ?? 32);
  const pH = Number(col?.size?.y ?? sprite?.height ?? 32);
  const grab = components.LedgeGrab ? pH * 0.6 : 0;
  const CELL = 32;
  const maxRise = reach.height * MARGIN + grab;
  const gaps: JumpTable['gaps'] = [];
  for (let rows = Math.floor(maxRise / CELL); rows >= -6; rows--) {
    const d = jumpDistance(reach, Math.max(-4000, Math.min(rows * CELL, reach.height * MARGIN)));
    if (d < 0) continue;
    // (Landing with its whole body on the far floor, not on its corner: what a player can count on.)
    gaps.push({ rise: rows, cells: Math.max(0, Math.floor((d * MARGIN) / CELL + 1e-9)) });
  }
  // Over hazards its whole body stays above them all the way: the time its feet are higher than their tops.
  const over = (tall: number) => {
    if (reach.height * MARGIN <= tall) return 0;
    const t = 2 * Math.sqrt((2 * (reach.height * MARGIN - tall)) / reach.gravity);
    return Math.max(0, Math.floor((reach.speed * t * MARGIN - pW) / CELL + 1e-9));
  };
  return {
    gaps,
    maxRiseRows: Math.max(0, Math.floor(maxRise / CELL)),
    ladderGapRows: Math.max(0, Math.floor((reach.height * MARGIN + pH) / CELL + 1e-9) - 1),
    crateRows: 1,
    // (The spring's pad is half a cell over the floor; the launch is twice the jump.)
    springRows: Math.max(0, Math.floor((reach.height * 2 * MARGIN + CELL / 2) / CELL + 1e-9)),
    spikeCells: { halfCellTall: over(CELL / 2), cellTall: over(CELL) },
  };
}

/**
 * Can the level be won at all, whatever the player reaches? Nothing to finish it (no Goal, no rule or script that
 * completes the level or goes on to another), or a key that opens nothing in it (its door was left out). Checked on
 * what the AI builds: the answer goes back when it would leave the level like this.
 */
export function winProblems(project: Project, sceneId: Id, registry: ComponentRegistry): { key: string; text: string; entityIds: Id[] }[] {
  const scene = project.scenes.find((s) => s.id === sceneId);
  if (!scene) return [];
  const placed = scene.entities.map((e) => ({ e, r: resolveEntity(project, e, registry) }));
  if (!placed.some(({ r }) => r.components.CharacterController)) return [];
  const out: { key: string; text: string; entityIds: Id[] }[] = [];
  const scriptText = [...project.definitions.flatMap((d) => d.scripts ?? []), ...scene.entities.flatMap((e) => e.scripts ?? [])].map((s) => JSON.stringify(s?.handlers ?? s)).join('\n');
  const ruleText = JSON.stringify(scene.rules ?? []);
  const finishes =
    placed.some(({ r }) => r.components.Goal || r.tags.some((t) => /^(goal|exit|finish)$/i.test(t))) ||
    /"(complete_level|go_to_level|visit_level)"/.test(ruleText) ||
    /"(complete_level|go_to_level|visit_level)"/.test(scriptText);
  if (!finishes) out.push({ key: 'win-no-goal', text: "The level can't be won: there is no Goal (or other way to finish it: a rule or script that completes the level). Place the Goal (or what stands for it) where the player gets to last.", entityIds: [] });

  // Keys: an item named or tagged a key that no door here asks for, and that no rule or script uses.
  const keys = placed.filter(({ r }) => r.components.Collectible && (r.tags.some((t) => /key/i.test(t)) || /key/i.test(String(r.components.Collectible.itemId ?? '')) || /\bkey\b/i.test(r.name)));
  const unused = keys.filter(({ e, r }) => {
    const me = { id: e.id, definitionId: e.definitionId, tags: r.tags };
    const item = String(r.components.Collectible.itemId || r.name.toLowerCase());
    const door = scene.relationships.some(
      (rel) => rel.type === 'requires' && refMatches(rel.target, me) && placed.some(({ e: o, r: or }) => o.id !== e.id && refMatches(rel.source, { id: o.id, definitionId: o.definitionId, tags: or.tags })),
    );
    const mentioned = [scriptText, ruleText].some((t) => t.includes(`"${item}"`) || t.includes(`'${item}'`) || t.includes(e.definitionId ?? '\0') || t.includes(e.id));
    return !door && !mentioned;
  });
  if (unused.length) {
    const names = [...new Set(unused.map(({ e }) => e.name))];
    out.push({ key: `win-key-opens-nothing:${unused.map(({ e }) => e.id).sort().join(',')}`, text: `${names.join(', ')} ${unused.length === 1 ? 'opens' : 'open'} nothing: no door in this level needs ${unused.length === 1 ? 'it' : 'them'} (a door "requires" it). Place the door it opens, connected with requires, or leave the key out.`, entityIds: unused.map(({ e }) => e.id) });
  }
  return out;
}
