/**
 * What a player's reach gets it over, measured by the route solver itself on small test floors: the highest cliff it
 * climbs and the widest level gap it crosses, with all its moves or without some capabilities. Level builders ask
 * this to make an obstacle that needs a capability: beyond what the player does without it, within what it does
 * with it. Nothing here knows any ability: it is the reach description's own move rules, asked.
 */
import type { LevelGrid } from '../levelGen/grid';
import type { MoveRule } from '../levelGen/moves';
import type { Role } from '../levelGen/roles';
import { solveLevel } from '../levelGen/solver';
import type { ReachDescription } from './reach';

export interface ReachMeasure {
  /** The highest cliff (rows) it gets up, from flat ground with a run-up. */
  rise: number;
  /** The widest gap (cells) in level ground it crosses. */
  gap: number;
}

const MOST = 14;

/** A small level for the solver: rows of role characters ("P" player, "G" goal, "#" ground). */
function floor(rows: string[]): LevelGrid {
  const roles: Record<string, Role> = { P: 'player', G: 'goal', '#': 'ground' };
  return { width: rows[0].length, height: rows.length, placed: [], links: [], get: (c: number, r: number) => roles[rows[r]?.[c] ?? '.'] ?? null } as unknown as LevelGrid;
}

/** The reach's move rules without those of the given capabilities. */
export function movesWithout(reach: ReachDescription, without: readonly string[]): MoveRule[] {
  return (reach.moves ?? []).filter((m) => !m.capability || !without.includes(m.capability.id));
}

const cache = new WeakMap<ReachDescription, Map<string, ReachMeasure>>();

/** What the reach gets over, without the capabilities named (none: with everything it has). */
export function reachMeasure(reach: ReachDescription, without: readonly string[] = []): ReachMeasure {
  const key = [...without].sort().join(',');
  const had = cache.get(reach)?.get(key);
  if (had) return had;
  const limits = reach.limits?.(5);
  if (!limits || !reach.moves) return { rise: 0, gap: 0 };
  const solver = { limits, moves: movesWithout(reach, without) };
  const open = '.'.repeat(30);
  const climbs = (h: number) => {
    // Flat ground, then a cliff h rows high with the goal on top; open sky.
    const height = h + 5;
    const rows: string[] = [];
    for (let r = 0; r < height; r++) {
      const ground = r >= height - 2;
      const cliff = r >= height - 2 - h;
      rows.push((ground ? '#'.repeat(18) : r === height - 3 ? `..P${open.slice(0, 15)}` : open.slice(0, 18)) + (cliff ? '#'.repeat(12) : r === height - 3 - h ? `${open.slice(0, 6)}G${open.slice(0, 5)}` : open.slice(0, 12)));
    }
    return solveLevel(floor(rows), solver).goal;
  };
  const crosses = (g: number) => {
    const row = (left: string, right: string) => left + '.'.repeat(g) + right;
    const rows = [row(open.slice(0, 10), open.slice(0, 10)), row(open.slice(0, 10), open.slice(0, 10)), row(open.slice(0, 10), open.slice(0, 10)), row(`..P${open.slice(0, 7)}`, `${open.slice(0, 6)}G...`), row('#'.repeat(10), '#'.repeat(10))];
    return solveLevel(floor(rows), solver).goal;
  };
  let rise = 0;
  while (rise < MOST && climbs(rise + 1)) rise++;
  let gap = 0;
  while (gap < MOST * 2 && crosses(gap + 1)) gap++;
  const out = { rise, gap };
  if (!cache.has(reach)) cache.set(reach, new Map());
  cache.get(reach)!.set(key, out);
  return out;
}
