/**
 * Docs §30: what the engine costs on worlds of several sizes and shapes, each part of the work measured by
 * itself. In `npm test` five worlds, up to 31,000 things, are held to ceilings (a regression shows);
 * CAPACITY=full measures the bigger worlds and what the level builder costs, and prints the table
 * (CAPACITY_REPORT=<file> writes it).
 */
import { appendFileSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createBuiltinRegistry } from '../core/components/builtin';
import { costLine, measure, type Costs } from './capacity';
import { projectToBundle } from '../core/serialization/serialize';
import { makeWorld, type WorldKind } from './worlds';
import { produce } from 'immer';
import { applyOperations, type Operation } from '../core/commands/operations';
import { createProject } from '../core/model/factory';
import { createHash } from 'node:crypto';
import { buildAIPayload } from '../core/ai/context';
import { InputState } from '../runtime/input';
import { Runtime } from '../runtime/runtime';
import { withSeed } from './harness';

const registry = createBuiltinRegistry();
const FULL = process.env.CAPACITY === 'full';
const say = (line: string) => {
  if (process.env.CAPACITY_REPORT) appendFileSync(process.env.CAPACITY_REPORT, `${line}\n`);
};

/**
 * Worlds held to a ceiling on each cost in `npm test`. The ceilings are several times what W1 measured (the suite
 * runs many files at once) and, for the costs W1 changed, below what W0 measured: a change that brings back a
 * cost that grows with the whole level fails here. The last two are worlds the engine could not play before W1.
 */
const HELD: [WorldKind, number, number, Partial<Costs>][] = [
  ['city', 60, 34, { stepMs: 1, stepWalkingMs: 1, startMs: 150, openMs: 200, saveMs: 100, drawOneMs: 200, moveOneMs: 50, checkMs: 300, contextMs: 800 }],
  ['run', 170, 21, { stepMs: 1.2, stepWalkingMs: 1, startMs: 150, openMs: 200, saveMs: 100, drawOneMs: 200, moveOneMs: 50, checkMs: 300, contextMs: 800 }],
  ['city', 100, 60, { stepMs: 2, stepWalkingMs: 2, startMs: 300, openMs: 300, saveMs: 150, drawOneMs: 250, moveOneMs: 100, checkMs: 400, contextMs: 1200 }],
  ['city', 250, 150, { stepMs: 12, stepWalkingMs: 12, startMs: 600, openMs: 800, saveMs: 400, drawOneMs: 900, moveOneMs: 300, checkMs: 1000, contextMs: 5000 }],
  ['mine', 80, 400, { stepMs: 8, stepWalkingMs: 8, startMs: 1200, openMs: 1200, saveMs: 800, drawOneMs: 4500, moveOneMs: 500, checkMs: 4000, contextMs: 12000 }],
];
/** Bigger and differently shaped: measured only (CAPACITY=full). */
const BIG: [WorldKind, number, number][] = [
  ['run', 600, 60],
  ['run', 40, 600],
  ['city', 400, 300],
  ['mine', 120, 600],
  ['mine', 160, 950],
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

  it('a level of 150,000 things: play starts and steps, and the AI is told about it (more things than one call can take as arguments)', { timeout: 180000 }, () => {
    const world = makeWorld('mine', 160, 950, registry);
    expect(world.things).toBeGreaterThan(150000);
    const id = world.project.scenes[0].id;
    const rt = new Runtime(world.project, id, registry);
    const input = new InputState();
    rt.step(1 / 60, input);
    input.press('right');
    // (No time is held here: the suite's own step-by-step fingerprint reads the level on every step. What a step
    // costs is held by the worlds above, and measured at this size with CAPACITY=full.)
    const x0 = rt.entities.find((e) => e.name === 'Player')!.x;
    for (let i = 0; i < 12; i++) rt.step(1 / 60, input);
    expect(rt.entities.find((e) => e.name === 'Player')!.x).toBeGreaterThan(x0);
    expect(rt.entities.filter((e) => rt.isAsleep(e)).length).toBeGreaterThan(149000);
    const payload = buildAIPayload(world.project, { kind: 'level', sceneId: id } as never, registry);
    expect(JSON.stringify(payload).length).toBeLessThan(40000);
    expect(payload.level.grid.occupied).toMatchObject({ minCol: 0, maxCol: 159 });
  });

  it.skipIf(!FULL)('levels built by the engine, measured: each structure at each length (CAPACITY=full)', { timeout: 3000000 }, () => {
    for (const structure of ['run', 'climb', 'hub'])
      for (const length of ['short', 'long', 'huge']) {
        // (One game every time: a game with no theme chosen gets one from its id, and the theme decides what is built.)
        const p = produce(createProject(registry), (d) => void (d.id = 'prj_capacity'));
        let note = '';
        const t0 = performance.now();
        // (And the same seed: the level built is the same one, so its cost compares and its content can too.)
        const after = withSeed(11, () =>
          produce(p, (d) => {
            const r = applyOperations(d, [{ op: 'generate_level', sceneId: p.scenes[0].id, difficulty: 3, structure, length, focus: [], escalate: null, avoid: [], secrets: 1, concept: null, sections: [] }] as unknown as Operation[], registry);
            note = (r.notes ?? []).find((n) => /built by the engine/.test(n)) ?? '';
          }),
        );
        const ms = Math.round(performance.now() - t0);
        const size = /(\d+ by \d+ cells)/.exec(note)?.[1] ?? '?';
        const level = createHash('sha256').update(after.scenes[0].entities.map((e) => `${e.name}@${e.transform.position.x},${e.transform.position.y}`).join('|')).digest('hex').slice(0, 10);
        say(`built ${structure}, ${length}: ${size}, ${after.scenes[0].entities.length} things (level ${level}), ${ms} ms${/playable/.test(note) ? ', checked: playable' : `: ${note.slice(0, 160)}`}`);
        expect(after.scenes[0].entities.length).toBeGreaterThan(40);
      }
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
      const c = measure(world, registry, { steps: 10 });
      say(costLine(world.name, c));
      expect(c.things).toBe(world.things);
    }
  });
});
