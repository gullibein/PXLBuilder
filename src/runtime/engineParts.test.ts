import { produce } from 'immer';
import { describe, expect, it } from 'vitest';
import { createBuiltinRegistry } from '../core/components/builtin';
import { ENGINE_PART_INFO, scriptedPart } from '../core/model/engineParts';
import { createProject, instantiateDefinition } from '../core/model/factory';
import * as m from '../core/model/mutations';
import type { Project, Vec2 } from '../core/types';
import { applyOperations } from '../core/commands/operations';
import { InputState, type Action } from './input';
import { Runtime } from './runtime';

const registry = createBuiltinRegistry();

/**
 * Ground at y=48 from x=-160 to 96 (a ledge at its right end), a ladder at x=-120, the Player at x=0. With
 * `scripted`, the Player's jumping is done by the ready-made Jumping script instead of the engine.
 */
function level(scripted: boolean, edit: (d: Project) => void = () => {}): Runtime {
  let project = createProject(registry);
  const sceneId = project.scenes[0].id;
  project = produce(project, (d) => {
    const place = (name: string, pos: Vec2) => m.addEntity(d, sceneId, instantiateDefinition(d.definitions.find((x) => x.name === name)!, pos));
    for (let x = -160; x <= 96; x += 32) place('Platform', { x, y: 48 });
    for (let y = 16; y >= -80; y -= 32) place('Ladder', { x: -120, y });
    place('Player', { x: 0, y: 16 });
    const player = d.definitions.find((x) => x.name === 'Player')!;
    if (scripted) player.scripts = [...(player.scripts ?? []), ENGINE_PART_INFO.jumping.script()];
    edit(d);
  });
  return new Runtime(project, sceneId, registry);
}

/** Plays `keys` (step -> keys held from then on) for `steps` fixed steps; where the player is, step by step. */
function play(rt: Runtime, keys: Record<number, Action[]>, steps: number): string[] {
  const input = new InputState();
  let held: Action[] = [];
  const out: string[] = [];
  for (let i = 0; i < steps; i++) {
    if (keys[i]) {
      for (const k of held) if (!keys[i].includes(k)) input.release(k);
      for (const k of keys[i]) if (!held.includes(k)) input.press(k);
      held = keys[i];
    }
    rt.update(1 / 120, input);
    const p = rt.find('Player')!;
    out.push(`${p.x.toFixed(6)},${p.y.toFixed(6)},${p.vx.toFixed(6)},${p.vy.toFixed(6)},${p.grounded}`);
  }
  return out;
}

/** The same keys, with the engine's jumping and with the Jumping script: the player is in the same place every step. */
function same(keys: Record<number, Action[]>, steps: number, edit?: (d: Project) => void) {
  const engine = play(level(false, edit), keys, steps);
  const script = play(level(true, edit), keys, steps);
  expect(script.findIndex((s, i) => s !== engine[i])).toBe(-1);
  expect(script).toEqual(engine);
  return engine;
}

describe('engine parts done by a script instead', () => {
  it('the ready-made Jumping script jumps exactly as the engine does: a full jump, and a short hop when let go early', () => {
    const full = same({ 30: ['jump'], 200: [] }, 260);
    const hop = same({ 30: ['jump'], 45: [], 200: [] }, 260);
    // (It really jumped, and the hop is lower.)
    const top = (trace: string[]) => Math.min(...trace.map((t) => Number(t.split(',')[1])));
    expect(top(full)).toBeLessThan(16 - 40);
    expect(top(hop)).toBeGreaterThan(top(full) + 10);
  });

  it('…a press just before landing still jumps, and so does one just after running off a ledge', () => {
    // Jump, and press again a few steps before landing.
    const steps = play(level(false), { 30: ['jump'], 31: [] }, 400);
    const landed = steps.findIndex((t, i) => i > 40 && t.endsWith('true'));
    same({ 30: ['jump'], 31: [], [landed - 8]: ['jump'], [landed - 7]: [] }, 400);
    // Run right off the ledge (x = 112) and press jump just after.
    const run = play(level(false), { 0: ['right'] }, 200);
    const off = run.findIndex((t, i) => i > 0 && t.endsWith('false'));
    same({ 0: ['right'], [off + 4]: ['right', 'jump'], [off + 5]: ['right'] }, 300);
  });

  it('…double jumps with DoubleJump, and jumps off a ladder', () => {
    const dj = (d: Project) => m.addDefinitionComponent(d, d.definitions.find((x) => x.name === 'Player')!.id, 'DoubleJump', registry);
    same({ 30: ['jump'], 31: [], 70: ['jump'], 71: [], 120: ['jump'], 121: [] }, 400, dj);
    // Walk left to the ladder, climb up, jump off.
    same({ 0: ['left'], 60: ['left', 'up'], 120: ['up'], 150: ['jump'], 151: [] }, 400);
  });

  it('the jump height setting still works with the script, and switching the script off gives jumping back to the engine', () => {
    const higher = (d: Project) => m.setDefinitionComponentField(d, d.definitions.find((x) => x.name === 'Player')!.id, 'CharacterController', 'jumpForce', 500, registry);
    same({ 30: ['jump'], 200: [] }, 260, higher);
    const off = level(true, (d) => {
      const s = d.definitions.find((x) => x.name === 'Player')!.scripts!.find((x) => x.takesOver === 'jumping')!;
      s.enabled = false;
    });
    expect(play(off, { 30: ['jump'], 200: [] }, 260)).toEqual(play(level(false), { 30: ['jump'], 200: [] }, 260));
    expect(scriptedPart(off.project.definitions.find((x) => x.name === 'Player')!.scripts, 'jumping')).toBe(false);
  });

  it('a script that took jumping over, changed: the engine no longer jumps by itself (only the script decides)', () => {
    const rt = level(true, (d) => {
      const s = d.definitions.find((x) => x.name === 'Player')!.scripts!.find((x) => x.takesOver === 'jumping')!;
      // A changed jump: twice as high a speed.
      s.handlers[0].do = s.handlers[0].do.map((st) => JSON.parse(JSON.stringify(st).replaceAll("field(self, 'CharacterController.jumpForce')", "field(self, 'CharacterController.jumpForce') * 2")));
    });
    const engine = play(level(false), { 30: ['jump'], 200: [] }, 60);
    const changed = play(rt, { 30: ['jump'], 200: [] }, 60);
    // (Gravity is added after the jump in the same step: the difference is one more jumpForce, 350.)
    expect(Number(changed[31].split(',')[3]) - Number(engine[31].split(',')[3])).toBeCloseTo(-350, 3);
    expect(rt.scripts.errors).toEqual([]);
  });
});

describe('use_script_for (the AI turning an engine part into a script, after the user said yes)', () => {
  const apply = (p: Project, ops: unknown[]) => produce(p, (d) => void applyOperations(d, ops as never, registry));
  const player = (p: Project) => p.definitions.find((x) => x.name === 'Player')!;

  it('gives the object the ready-made script (or the changed one asked for), once; removing it gives the part back', () => {
    const base = createProject(registry);
    const id = player(base).id;
    const once = apply(base, [{ op: 'use_script_for', target: 'definition', id, part: 'jumping', scriptJson: null }]);
    expect(player(once).scripts!.filter((s) => s.takesOver === 'jumping').map((s) => s.name)).toEqual(['Jumping']);
    expect(scriptedPart(player(once).scripts, 'jumping')).toBe(true);
    // A changed one, asked again: replaces it (never two scripts doing one part).
    const changed = { ...ENGINE_PART_INFO.jumping.script(), name: 'Floaty jumping', id: undefined };
    const twice = apply(once, [{ op: 'use_script_for', target: 'definition', id, part: 'jumping', scriptJson: JSON.stringify(changed) }]);
    expect(player(twice).scripts!.filter((s) => s.takesOver === 'jumping').map((s) => s.name)).toEqual(['Floaty jumping']);
    // (The mark is kept even when the changed script leaves it out.)
    const unmarked = apply(once, [{ op: 'use_script_for', target: 'definition', id, part: 'jumping', scriptJson: JSON.stringify({ ...changed, takesOver: undefined }) }]);
    expect(scriptedPart(player(unmarked).scripts, 'jumping')).toBe(true);
    const back = apply(twice, [{ op: 'remove_script', target: 'definition', id, scriptId: player(twice).scripts!.find((s) => s.takesOver)!.id }]);
    expect(scriptedPart(player(back).scripts, 'jumping')).toBe(false);
  });

  it('an object without a Character Controller has no jumping to take over', () => {
    const base = createProject(registry);
    const coin = base.definitions.find((x) => x.name === 'Coin')!;
    expect(() => apply(base, [{ op: 'use_script_for', target: 'definition', id: coin.id, part: 'jumping', scriptJson: null }])).toThrow(/no CharacterController/);
  });
});
