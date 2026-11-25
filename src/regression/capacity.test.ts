/**
 * W0 (docs §30): what the engine costs on worlds of several sizes and shapes, each part of the work measured by
 * itself, before any change to it. In `npm test` the sizes the engine handles today are held to ceilings (a
 * regression shows); CAPACITY=full measures the big worlds too and prints the table (CAPACITY_REPORT=<file>
 * writes it), which takes minutes today.
 */
import { appendFileSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createBuiltinRegistry } from '../core/components/builtin';
import { costLine, measure, type Costs } from './capacity';
import { projectToBundle } from '../core/serialization/serialize';
import { makeWorld, type WorldKind } from './worlds';

const registry = createBuiltinRegistry();
const FULL = process.env.CAPACITY === 'full';
const say = (line: string) => {
  if (process.env.CAPACITY_REPORT) appendFileSync(process.env.CAPACITY_REPORT, `${line}\n`);
};

/** Worlds the engine plays smoothly today: a ceiling on each cost (two to three times what was measured in W0). */
const HELD: [WorldKind, number, number, Partial<Costs>][] = [
  ['city', 60, 34, { stepMs: 4, stepWalkingMs: 4, startMs: 150, openMs: 200, saveMs: 100, drawOneMs: 400, moveOneMs: 50, checkMs: 600, contextMs: 2500 }],
  ['run', 170, 21, { stepMs: 4, stepWalkingMs: 4, startMs: 150, openMs: 200, saveMs: 100, drawOneMs: 400, moveOneMs: 50, checkMs: 600, contextMs: 2500 }],
  ['city', 100, 60, { stepMs: 12, stepWalkingMs: 12, startMs: 300, openMs: 300, saveMs: 150, drawOneMs: 800, moveOneMs: 50, checkMs: 1000, contextMs: 4000 }],
];
/** Bigger and differently shaped: measured only (CAPACITY=full). */
const BIG: [WorldKind, number, number][] = [
  ['run', 600, 60],
  ['run', 40, 600],
  ['city', 250, 150],
  ['mine', 80, 400],
  ['city', 400, 300],
  ['mine', 120, 600],
];

describe('capacity: what each part of the work costs, by the size of the world', () => {
  it('the test worlds are the same every time, of the size asked', () => {
    const a = makeWorld('city', 100, 60, registry);
    const b = makeWorld('city', 100, 60, registry);
    expect(a.things).toBe(b.things);
    const cells = (w: typeof a) => w.project.scenes[0].entities.map((e) => `${e.name}@${e.transform.position.x},${e.transform.position.y}`);
    expect(cells(a)).toEqual(cells(b));
    const xs = a.project.scenes[0].entities.map((e) => e.transform.position.x);
    expect((Math.max(...xs) - Math.min(...xs)) / 32 + 1).toBe(100);
    expect(makeWorld('mine', 20, 30, registry).things).toBeGreaterThan(19 * 23);
    expect(makeWorld('run', 40, 600, registry).rows).toBe(600);
  });

  for (const [kind, cols, rows, ceilings] of HELD)
    it(`${kind} ${cols} by ${rows}: within today's costs`, { timeout: 120000 }, () => {
      const world = makeWorld(kind, cols, rows, registry);
      const c = measure(world, registry);
      say(costLine(world.name, c));
      for (const [k, max] of Object.entries(ceilings)) expect(c[k as keyof Costs], `${world.name}: ${k} (${costLine(world.name, c)})`).toBeLessThanOrEqual(max as number);
    });

  it.skipIf(!FULL)('the big worlds, measured (CAPACITY=full)', { timeout: 3000000 }, () => {
    // (CAPACITY_WRITE=<folder>: the worlds as saved games, for scripts/capacity-browser.mjs; nothing measured.)
    if (process.env.CAPACITY_WRITE) {
      for (const [kind, cols, rows] of [...HELD.map((h) => [h[0], h[1], h[2]] as const), ...BIG]) {
        const world = makeWorld(kind, cols, rows, registry);
        writeFileSync(`${process.env.CAPACITY_WRITE}/${String(world.things).padStart(6, '0')} ${world.name}.pxlproj.json`, JSON.stringify(projectToBundle(world.project)));
      }
      return;
    }
    for (const [kind, cols, rows] of BIG) {
      const world = makeWorld(kind, cols, rows, registry);
      const c = measure(world, registry, { steps: 10, context: world.things < 40000 });
      say(costLine(world.name, c));
      expect(c.things).toBe(world.things);
    }
  });
});
