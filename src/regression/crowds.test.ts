/**
 * Worlds full of things that act (docs §30, W1.1). In `npm test`: each kind of crowd does act (they move, shots
 * appear) and a frame of 300 of them is held to a ceiling. CAPACITY=full: each kind at rising numbers, until a
 * frame of play takes longer than a frame has (CAPACITY_REPORT=<file> writes the table).
 */
import { appendFileSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createBuiltinRegistry } from '../core/components/builtin';
import { projectToBundle } from '../core/serialization/serialize';
import { CROWDS, CROWD_IS, makeCrowd, playCrowd } from './crowds';

const registry = createBuiltinRegistry();
const FULL = process.env.CAPACITY === 'full';
const say = (line: string) => {
  if (process.env.CAPACITY_REPORT) appendFileSync(process.env.CAPACITY_REPORT, `${line}\n`);
};

describe('crowds: worlds of things that act', () => {
  for (const kind of CROWDS)
    it(`${kind}: 300 of them act, and a frame of play stays short`, { timeout: 120000 }, () => {
      const cost = playCrowd(makeCrowd(kind, 300, registry), registry, 50, 150);
      // They do what the world is for: nearly all moved while measured (crates have landed and lie still; shots fly).
      if (kind === 'crates') expect(cost.moved).toBeLessThan(4);
      else if (kind === 'shooters') expect(cost.appeared).toBeGreaterThan(40);
      else if (kind === 'shooters, waiting') expect(cost.appeared).toBeGreaterThan(0);
      else if (kind === 'hunters') expect(cost.moved).toBeGreaterThan(200);
      else expect(cost.moved).toBeGreaterThan(250);
      // (Several times what was measured: the suite runs many files at once and fingerprints every step. The kinds
      // whose cost grows with the square of their number are already slow at 300: docs §30.13.)
      const slow = kind === 'hunters' || kind === 'hunters, all hunting' || kind === 'shooters, waiting' || kind === 'crates';
      expect(cost.frameMs, `${kind}: ${JSON.stringify(cost)}`).toBeLessThan(slow ? 160 : 40);
    });

  it.skipIf(!FULL)('each kind at rising numbers, measured (CAPACITY=full)', { timeout: 3000000 }, () => {
    // (CAPACITY_WRITE=<folder>: some of the worlds as saved games, for scripts/capacity-browser.mjs; nothing measured.)
    if (process.env.CAPACITY_WRITE) {
      for (const kind of CROWDS)
        for (const n of [300, 1000, 3000]) {
          const crowd = makeCrowd(kind, n, registry);
          writeFileSync(`${process.env.CAPACITY_WRITE}/${kind.replace(/, /g, ' ')} ${String(n).padStart(5, '0')}.pxlproj.json`, JSON.stringify(projectToBundle(crowd.project)));
        }
      return;
    }
    for (const kind of CROWDS) {
      // (CROWDS_ONLY=<start of a kind's name>: only those kinds.)
      if (process.env.CROWDS_ONLY && !kind.startsWith(process.env.CROWDS_ONLY)) continue;
      say(`${kind}: ${CROWD_IS[kind]}`);
      for (const n of [100, 250, 500, 1000, 2000, 5000, 10000]) {
        const cost = playCrowd(makeCrowd(kind, n, registry), registry, 60, 180);
        say(`  ${kind} ${n}: a frame ${cost.frameMs} ms (worst ${cost.worstMs}); ${cost.things} things at the start, ${cost.thingsAtEnd} at the end; ${cost.moved} moved, ${cost.appeared} appeared while measured`);
        expect(cost.count).toBe(n);
        // (Far past what a frame has: bigger numbers of this kind say nothing more, and take minutes.)
        if (cost.frameMs > 120) break;
      }
    }
  });
});
