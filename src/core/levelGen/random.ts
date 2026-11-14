/**
 * Seeded randomness: the same seed gives the same numbers, so the same blueprint and seed build the same level.
 * Every choice the level builder makes comes from one of these (never Math.random).
 */

/** A small, fast, seeded random number source in [0, 1) (mulberry32). Also the random dungeon's. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0 || 0x9e3779b9;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The choices the builder makes, from one seed. */
export interface Random {
  /** A number in [0, 1). */
  next(): number;
  /** A whole number from lo to hi, both included (hi < lo: lo). */
  int(lo: number, hi: number): number;
  /** True with this chance (0..1). */
  chance(p: number): boolean;
  /** One of the list (it must not be empty). */
  pick<T>(list: readonly T[]): T;
  /** One of the list, more likely the higher its weight (weights ≤ 0 never; all ≤ 0: the first). */
  weighted<T>(list: readonly T[], weight: (item: T) => number): T;
  /** The list in a random order (a new list). */
  shuffle<T>(list: readonly T[]): T[];
  /** A random source of its own for a part (a section), from this one: the part's choices don't shift the rest. */
  fork(): Random;
}

export function makeRandom(seed: number): Random {
  const next = seededRandom(seed);
  const r: Random = {
    next,
    int: (lo, hi) => (hi <= lo ? lo : lo + Math.floor(next() * (hi - lo + 1))),
    chance: (p) => next() < p,
    pick: (list) => {
      if (!list.length) throw new Error('pick from an empty list');
      return list[Math.floor(next() * list.length)];
    },
    weighted: (list, weight) => {
      if (!list.length) throw new Error('pick from an empty list');
      const ws = list.map((x) => Math.max(0, weight(x)));
      const total = ws.reduce((a, b) => a + b, 0);
      if (total <= 0) return list[0];
      let k = next() * total;
      for (let i = 0; i < list.length; i++) {
        k -= ws[i];
        if (k < 0) return list[i];
      }
      return list[list.length - 1];
    },
    shuffle: (list) => {
      const out = [...list];
      for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1));
        [out[i], out[j]] = [out[j], out[i]];
      }
      return out;
    },
    fork: () => makeRandom(Math.floor(next() * 4294967296)),
  };
  return r;
}

/** A new seed (for a level nobody gave one): any whole number that fits in 32 bits. */
export function newLevelSeed(): number {
  return Math.floor(Math.random() * 2147483647);
}
