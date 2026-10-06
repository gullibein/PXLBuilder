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
import type { ComponentRegistry } from '../components/registry';
import type { Id, Project, Vec2 } from '../types';
import { getEntitySize } from './geometry';
import { characterReach, type Reach } from './reach';
import { resolveEntity, type ResolvedEntity } from './resolve';

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
  | { status: 'ok'; unreachable: Unreachable; reach: Reach }
  | { status: 'no-player' }
  | { status: 'no-ground'; player: string }
  | { status: 'uncertain'; why: string };

const EDGE = 2;
const MARGIN = 0.92;

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

const gapBetween = (a: { left: number; right: number }, b: { left: number; right: number }) => Math.max(0, b.left - a.right, a.left - b.right);

/** Horizontal distance a full jump covers before coming down to `rise` above where it started (rise < 0: lower). */
function jumpDistance(reach: Reach, rise: number): number {
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

  const isSolid = (r: ResolvedEntity) => {
    const col = r.components.Collider;
    if (!col || col.isTrigger === true) return false;
    if (r.components.PhysicsBody?.bodyType === 'dynamic') return false;
    if (r.components.Openable?.startsOpen === true) return false;
    return true;
  };
  const solids = all.filter((r) => r !== player && isSolid(r));

  // Things that move solids or change how the player moves can't be judged statically.
  if (solids.some((r) => r.components.MovingPlatform || r.scripts.length)) return { status: 'uncertain', why: 'moving or scripted platforms' };
  if (player.scripts.length) return { status: 'uncertain', why: 'the player runs scripts' };
  if (scene.relationships.some((r) => r.type === 'controls' && (r.params.action === 'move' || r.params.action === 'disappear'))) return { status: 'uncertain', why: 'switches move platforms' };

  const base = characterReach(player.components, scene.world.gravity.y);
  if (!base) return { status: 'uncertain', why: 'the player has no jump' };
  const extra = Number(player.components.DoubleJump?.extraJumps ?? 0);
  // Double jump: each extra jump adds about another full jump in height and air time.
  const reach: Reach = extra > 0 ? { ...base, height: base.height * (1 + extra), distance: base.distance * (1 + extra), jumpForce: base.jumpForce * Math.sqrt(1 + extra) } : base;
  const pBox = boxOf(player);
  const pHeight = pBox.bottom - pBox.top;
  const pHalf = (pBox.right - pBox.left) / 2;
  // Ledge grab: a wall top a bit above the jump's peak can still be caught and climbed.
  const grab = player.components.LedgeGrab ? pHeight * 0.6 : 0;

  // Standable tops: the top of a solid with nothing solid sitting right on it.
  const boxes = solids.map((r) => ({ r, b: boxOf(r) }));
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

  const canJump = (from: Span, to: { left: number; right: number; top: number }) => {
    const rise = from.top - to.top;
    if (rise > reach.height * MARGIN + grab) return false;
    const d = jumpDistance(reach, Math.max(-4000, Math.min(rise, reach.height * MARGIN)));
    return gapBetween(from, to) <= Math.max(0, d * MARGIN) + pHalf;
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
      for (const [a, b] of teleports) {
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
      r.components.Switch ||
      r.components.Openable ||
      r.tags.some((t) => /^(goal|exit|finish|flag|checkpoint)$/i.test(t)) ||
      scene.relationships.some((rel) => rel.type === 'teleports_to' && rel.source.kind === 'entity' && rel.source.id === r.id));
  const within = (b: Box) =>
    [...reachedSpans].some((i) => {
      const s = spans[i];
      return gapBetween(s, b) <= pHalf + 4 && b.bottom >= s.top - (reach.height * MARGIN + pHeight + grab) && b.top <= s.top + 4;
    }) || [...reachedLadders].some((i) => gapBetween(ladders[i], b) <= pHalf * 2 && b.bottom >= ladders[i].top - pHeight && b.top <= ladders[i].bottom);
  const things = all.filter((r) => important(r) && !within(boxOf(r))).map((r) => ({ id: r.id, name: r.name }));

  const platforms = spans
    .map((s, i) => ({ s, i }))
    .filter(({ s, i }) => !reachedSpans.has(i) && s.right - s.left >= 64 && !solids.some((o) => {
      const b = boxOf(o);
      return b.bottom <= s.top && b.bottom >= s.top - 64 && b.left < s.right && b.right > s.left;
    }))
    .map(({ s }) => ({ ids: s.ids, left: Math.round(s.left), right: Math.round(s.right), top: Math.round(s.top) }));

  return { status: 'ok', unreachable: { things, platforms }, reach };
}

/** The problems in words (for the Debug tab and for sending back to the AI). Empty when the level can be got through. */
export function reachabilityProblems(project: Project, sceneId: Id, registry: ComponentRegistry): { key: string; text: string; entityIds: Id[] }[] {
  const r = levelReachability(project, sceneId, registry);
  if (r.status === 'no-ground') return [{ key: 'reach-no-ground', text: `${r.player} starts above nothing to stand on: it falls out of the level at once.`, entityIds: [] }];
  if (r.status !== 'ok') return [];
  const tiles = (px: number) => Math.round((px / 32) * 10) / 10;
  const limits = `the player jumps about ${tiles(r.reach.height)} tiles high and ${tiles(r.reach.distance)} tiles far`;
  const out: { key: string; text: string; entityIds: Id[] }[] = [];
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
