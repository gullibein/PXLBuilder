/**
 * What building levels with the engine saves, measured on real levels: for each, what the AI would have had to
 * write to draw that exact level itself (its map and placements: the operations the engine wrote) against the
 * blueprint it writes now; the instructions sent with a request that builds levels (the whole levels guide, or the
 * short one); and what building costs the engine (time, builds tried, the solver's work). Logged as a table
 * (npx vitest run src/core/levelGen/measure.test.ts); the asserts keep the savings from slipping.
 */
import { describe, expect, it } from 'vitest';
import { createBuiltinRegistry } from '../components/builtin';
import { buildAIPayload } from '../ai/context';
import { systemPromptWithReplyFormat, userMessage } from '../ai/prompt';
import type { AIRequestBody } from '../ai/protocol';
import { createProject } from '../model/factory';
import { STRUCTURES } from './blueprint';
import { generateLevel } from './generate';
import type { LevelGrid } from './grid';
import { playerLimits } from './limits';
import { findRoles } from './roles';
import { solveLevel } from './solver';

const registry = createBuiltinRegistry();
/** About how many characters of an answer's JSON make a token (a rough, common figure: a cost estimate only). */
const CHARS_PER_TOKEN = 3.5;
const tokens = (chars: number) => Math.round(chars / CHARS_PER_TOKEN);
const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

describe('what engine-built levels save', () => {
  it('per level: the answer the AI writes (a map and placements, or a blueprint), and the engine’s work', { timeout: 300000 }, () => {
    const p = createProject(registry);
    const sceneId = p.scenes[0].id;
    const lim = playerLimits(p, sceneId, findRoles(p, registry).player!.id, registry, 5)!;
    const rows: { old: number; oldOps: number; neu: number; ms: number; builds: number; states: number }[] = [];
    for (const structure of STRUCTURES)
      for (const seed of [1, 2, 3, 4, 5]) {
        const blueprint = { op: 'generate_level', sceneId, difficulty: 3, structure: null, length: 'medium', focus: [], escalate: null, avoid: [], secrets: 1, routes: null, concept: 'A forest level that slowly introduces springs', sections: [] };
        let grid: LevelGrid | null = null;
        const t = performance.now();
        const r = generateLevel(p, sceneId, { difficulty: 3, structure, seed, length: 'medium', secrets: 1 }, registry, 'classic', { onBuilt: (g) => (grid = g), candidates: 1 });
        const ms = performance.now() - t;
        const states = solveLevel(grid!, lim).states;
        rows.push({ old: JSON.stringify(r.ops).length, oldOps: r.ops.length, neu: JSON.stringify(blueprint).length, ms, builds: r.attempts, states });
      }
    const old = avg(rows.map((r) => r.old));
    const neu = avg(rows.map((r) => r.neu));
    process.stderr.write(
      [
        '',
        `levels measured: ${rows.length} (5 structures × 5 seeds, difficulty 3, medium)`,
        `answer, drawn by the AI (map + placements): ${Math.round(old)} chars ≈ ${tokens(old)} tokens, ${avg(rows.map((r) => r.oldOps)).toFixed(1)} operations`,
        `answer, a blueprint (generate_level): ${Math.round(neu)} chars ≈ ${tokens(neu)} tokens, 1 operation (${(old / neu).toFixed(1)}× smaller)`,
        `engine: ${avg(rows.map((r) => r.ms)).toFixed(0)} ms per level (max ${Math.max(...rows.map((r) => r.ms)).toFixed(0)}), ${avg(rows.map((r) => r.builds)).toFixed(2)} builds, solver ${Math.round(avg(rows.map((r) => r.states)))} states`,
        '',
      ].join('\n'),
    );
    expect(neu * 4).toBeLessThan(old);
    expect(avg(rows.map((r) => r.ms))).toBeLessThan(1000);
  });

  it('per request: the instructions sent with a request that builds whole levels (the full levels guide, or the short one)', () => {
    const p = createProject(registry);
    const ctx = { kind: 'project', sceneId: p.scenes[0].id } as const;
    const context = buildAIPayload(p, ctx as never, registry, undefined, null, () => 0.42);
    const size = (topics: string[]) => {
      const body: AIRequestBody = { context, request: 'Build 2 more levels for this game', history: [], topics };
      return systemPromptWithReplyFormat().length + userMessage(body).length;
    };
    const before = size(['levels', 'backgrounds']);
    const after = size(['levels_builder', 'backgrounds']);
    const newGameBefore = size(['new_game', 'levels', 'drawing', 'enemies']);
    const partOne = size(['new_game', 'drawing', 'enemies']);
    const partTwo = size(['new_game', 'levels_builder', 'drawing', 'enemies']);
    process.stderr.write(
      [
        '',
        `"more levels" request: ${before} chars ≈ ${tokens(before)} tokens with the full levels guide; ${after} ≈ ${tokens(after)} with the short one (−${before - after})`,
        `new game, one answer: ${newGameBefore}; part 1 (objects, no levels guide): ${partOne} (−${newGameBefore - partOne}); part 2 (levels, short guide): ${partTwo} (−${newGameBefore - partTwo})`,
        '',
      ].join('\n'),
    );
    expect(before - after).toBeGreaterThan(15000);
    expect(partOne).toBeLessThan(newGameBefore);
    expect(partTwo).toBeLessThan(newGameBefore);
  });
});
