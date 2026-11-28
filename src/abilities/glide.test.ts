/**
 * V1.1, the proof of T1 (docs/engine-architecture-proposal.md §24): a third ability, Glide, that only this file
 * knows. It is one definition, registered with one call. Nothing in the engine names it, and no engine file was
 * changed for it; yet the editor's components, the AI's operations and guidance, the runtime, scripts, the game's
 * profile and report, the player's reach, the level builder, the route solver and validation all have it, each from
 * the same definition.
 *
 * Without a bot part its levels are built and solved, and stay uncertain (nothing played them). With one, they are
 * played on the real runtime and validated.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { produce } from 'immer';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { describeComponents } from '../core/ai/capabilities';
import { TOPICS } from '../core/ai/topics';
import { applyOperations } from '../core/commands/operations';
import { componentRegistry, createBuiltinRegistry } from '../core/components/builtin';
import type { ComponentRegistry } from '../core/components/registry';
import { gameFacts } from '../core/engine/actual';
import { modules } from '../core/engine/modules';
import { checkGame, profileChoices, profileOf, projectFromPreset, setGameProfile } from '../core/engine/profile';
import { mechanics, readBlueprint } from '../core/levelGen/blueprint';
import { generateLevel, type GenerateResult } from '../core/levelGen/generate';
import type { LevelGrid } from '../core/levelGen/grid';
import { standing, type MoveRule } from '../core/levelGen/moves';
import { Section, type Pattern } from '../core/levelGen/pattern';
import { registerPattern, unregisterPattern } from '../core/levelGen/patterns/index';
import { findRoles } from '../core/levelGen/roles';
import { solveLevel } from '../core/levelGen/solver';
import { playerReach, reachAbilityIds, solverReach } from '../core/reach/reach';
import { checkScript, MEMBERS } from '../core/script/language';
import { setScript } from '../core/script/mutations';
import type { Project } from '../core/types';
import { levelReachProblems } from '../core/validation/levelProblems';
import { mapLevel } from '../regression/games/platformers';
import { InputState } from '../runtime/input';
import { botMoves } from '../runtime/routeBot';
import { Runtime } from '../runtime/runtime';
import { abilityDefinitions, registerAbility, unregisterAbility } from './index';
import type { AbilityBot, AbilityDefinition } from './types';

// ------------------------------------------------------------------------------------------------ the ability
// Glide: holding Jump while falling, the character falls slowly (its component's fallSpeed), so it is carried
// further across. Everything the engine has of it is in this one definition.

const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d);

/** From the ground, a jump glided down: `cells` further across than the jump, level or down. An estimate in cells. */
function glideMove(cells: number): MoveRule {
  return {
    id: 'glide',
    mechanics: ['glide'],
    capability: { id: 'glide', numbers: { cells } },
    successors(s, v) {
      if (!standing(s, v) || cells <= 0) return;
      const far = (rise: number) => v.lim.gap(rise) + (rise <= 0 ? cells : 0);
      for (const dir of [-1, 1])
        for (let rise = 0; rise >= -3; rise--)
          for (let k = v.lim.gap(rise) + 2; k <= far(rise) + 1; k++) if (v.canJump(s.c, s.r, dir * k, rise, s.away, far)) v.push(s.c + dir * k, s.r - rise, s.kh, s.so, s.cr, s.id, 'glide', 5 + k);
    },
  };
}

const GLIDE: AbilityDefinition = {
  id: 'glide',
  describe: 'Hold Jump while falling to glide down slowly, carried further across',
  plural: 'glides',
  component: {
    type: 'Glide',
    label: 'Glide',
    description: 'A player-controlled platformer character falls slowly while Jump is held, so a jump carries it further.',
    category: 'Behavior',
    fields: { fallSpeed: { kind: 'number', default: 60, min: 10, step: 10, description: 'Fastest fall while gliding (px/s)' } },
  },
  worksWith: ['arcade'],
  order: 25,
  runtime: {
    after({ e, input }) {
      const s = (e.ability.glide ??= { on: false }) as { on: boolean };
      s.on = !e.grounded && !e.climbing && !e.hanging && e.vy > 0 && input.isDown('jump');
      if (s.on) e.vy = Math.min(e.vy, num((e.base.components.Glide as Record<string, unknown> | undefined)?.fallSpeed, 60));
    },
    states: (e) => ((e.ability.glide as { on: boolean } | undefined)?.on ? ['gliding'] : []),
  },
  scriptNames: { gliding: { state: 'gliding', doc: 'gliding down, Jump held (Glide)' } },
  reach: {
    // The way down from the top of the jump, at the glide's speed instead of falling: that much longer in the air,
    // at running speed. Kept well under the estimate.
    move(c, base) {
      const top = (base.jumpForce * base.jumpForce) / (2 * base.gravity);
      const longer = top / num(c.Glide?.fallSpeed, 60) - base.jumpForce / base.gravity;
      return glideMove(Math.max(0, Math.floor((base.speed * longer * 0.8) / 32)));
    },
    estimated: true,
  },
  topic: 'precision_moves',
};

/** How the route bot plays a glide: a run to the edge, Jump, held all the way (the glide), steering to the landing. */
const GLIDE_BOT: AbilityBot = {
  moves: ['glide'],
  step({ p, input, from, to, here, fromX, toX, hold, mem }) {
    const m = mem as { jumped?: boolean };
    const jdir = Math.sign(to.col - from.col);
    if (!m.jumped) {
      const atTakeoff = here.col === from.col && jdir * (p.x - (fromX + jdir * 11)) >= -3;
      if (p.grounded && atTakeoff && !input.isDown('jump')) {
        hold('jump', true);
        m.jumped = true;
      } else {
        const back = here.col !== from.col ? Math.sign(fromX - p.x) : jdir;
        hold('right', back > 0);
        hold('left', back < 0);
      }
      return;
    }
    hold('right', toX - p.x > 3);
    hold('left', toX - p.x < -3);
  },
};

/** A level pattern that requires it (patterns are the level builder's, found by the capability they require: not the ability's). */
const GLIDE_GAP: Pattern = {
  id: 'glide_gap',
  version: 1,
  name: 'a gap too wide to jump: glided over',
  mechanics: ['glide'],
  fits: ['teach', 'test', 'twist'],
  needs: ['ground'],
  requires: ['glide'],
  variants: [{ id: 'plain' }],
  difficulty: [1, 5],
  width: (lim, _d, _v, caps) => [lim.gap(0) + (caps.glide?.cells ?? 1) + 8, lim.gap(0) + (caps.glide?.cells ?? 1) + 10],
  build(ctx) {
    const s = new Section(ctx);
    // (A cell under what the glide is estimated to add: room to land.)
    const g = ctx.without(['glide']).gap + Math.max(1, Math.floor(ctx.caps.glide.cells) - 1);
    s.flat(0, 3, ctx.entry);
    s.flat(4 + g, s.w - 1, ctx.entry);
    return ctx.entry;
  },
};

// ------------------------------------------------------------------------------------------------ the proof

let registry: ComponentRegistry;
const player = (p: Project) => p.definitions.find((d) => d.name === 'Player')!;
/** The classic platformer whose player has these abilities (through the profile). */
const game = (abilities: string[]) => produce(projectFromPreset('classic-platformer', registry), (d) => void setGameProfile(d, { theme: 'forest', abilities }, registry));
const reachOf = (p: Project) => playerReach(p, p.scenes[0].id, findRoles(p, registry).player!.id, registry)!;
function build(p: Project, seed = 2): { r: GenerateResult; grid: LevelGrid; sections: string[] } {
  let grid: LevelGrid | null = null;
  const r = generateLevel(p, p.scenes[0].id, { difficulty: 3, seed, structure: 'run', length: 'short', sections: [{ pattern: 'glide_gap' }] }, registry, 'classic', { candidates: 1, onBuilt: (g) => (grid = g) });
  return { r, grid: grid!, sections: (r.madeBy.fingerprint as { sections: string[] }).sections };
}
const built = (sections: string[]) => sections.some((s) => s.includes(':glide_gap/'));

describe('V1.1: Glide, an ability only a test knows, registered with one call', () => {
  beforeAll(() => {
    // The one call. (Its level pattern is registered as any pattern is.)
    registerAbility(GLIDE);
    registerPattern(GLIDE_GAP);
    registry = createBuiltinRegistry();
  });
  afterAll(() => {
    unregisterAbility('glide');
    unregisterPattern('glide_gap');
  });

  it('the editor and the AI: its component is there, with its settings; add_component gives it to an object, and a wrong setting is refused', () => {
    expect(registry.get('Glide')).toMatchObject({ label: 'Glide', category: 'Behavior' });
    // (The editor's own registry follows: the inspector and the profile panel list it.)
    expect(componentRegistry.get('Glide')?.fields.fallSpeed.default).toBe(60);
    const p = projectFromPreset('platformer', registry);
    const withIt = produce(p, (d) => void applyOperations(d, [{ op: 'add_component', target: 'definition', id: player(p).id, component: 'Glide', propsJson: '{"fallSpeed":40}' } as never], registry));
    expect(player(withIt).components.Glide).toEqual({ fallSpeed: 40 });
    expect(() => produce(p, (d) => void applyOperations(d, [{ op: 'add_component', target: 'definition', id: player(p).id, component: 'Glide', propsJson: '{"fallSpeed":"fast"}' } as never], registry))).toThrow(/fallSpeed/);
  });

  it('the AI\'s guidance: its component is described in the topic it names, and listed as such in the instructions', () => {
    expect(describeComponents(registry)).toMatch(/^ {2}Glide: \(topic "precision_moves"\)$/m);
    expect(TOPICS.precision_moves.text).toMatch(/Glide: A player-controlled platformer character falls slowly while Jump is held/);
    expect(TOPICS.precision_moves.text).toMatch(/fallSpeed/);
  });

  it('the profile and the report: it is a movement ability a profile can give; the profile shows it for the character that has it; from above it does nothing, and that is said', () => {
    expect(modules.get('ability', 'glide')).toMatchObject({ component: 'Glide', requires: ['locomotion:arcade'] });
    expect(profileChoices().choices.abilities).toContain('glide');
    const p = game(['glide']);
    expect(player(p).components.Glide).toEqual({ fallSpeed: 60 });
    expect(profileOf(p, registry).movement.abilities).toEqual(['glide']);
    expect(gameFacts(p, registry).players.map((x) => [x.name, x.abilities.map((a) => `${a.id}:${a.works}`)])).toEqual([['Player', ['glide:true']]]);
    expect(checkGame(p, registry).state).toBe('ok');
    // Taken away through the profile: its component goes.
    expect(player(produce(p, (d) => void setGameProfile(d, { abilities: [] }, registry))).components.Glide).toBeUndefined();
    // On a character that walks from above: refused when asked for through the profile, and reported when it is there.
    const top = projectFromPreset('topdown', registry);
    expect(() => produce(top, (d) => void setGameProfile(d, { abilities: ['glide'] }, registry))).toThrow(/ability "glide" needs locomotion:arcade/);
    const hero = top.definitions.find((d) => d.components.CharacterController)!;
    const odd = produce(top, (d) => void (d.definitions.find((x) => x.id === hero.id)!.components.Glide = registry.createDefault('Glide')));
    const check = checkGame(odd, registry);
    expect(check.state === 'degraded' && check.notes.join(' ')).toMatch(new RegExp(`${hero.name}: its Glide \\(glide\\) needs arcade movement, so on this character it does nothing`));
    expect(profileOf(odd, registry).movement.abilities).toEqual([]);
  });

  /** A jump with Jump held to the end: how long it is in the air, and whether it was ever gliding. */
  function jump(p: Project) {
    const rt = new Runtime(p, p.scenes[0].id, registry);
    const input = new InputState();
    const e = rt.entities.find((x) => x.controller)!;
    for (let i = 0; i < 30; i++) rt.update(1 / 60, input);
    input.press('jump');
    let air = 0;
    let glided = false;
    for (let i = 0; i < 400; i++) {
      rt.update(1 / 60, input);
      if (!e.grounded) air++;
      else if (air > 0) break;
      if (rt.motion(e)!.states.includes('gliding')) glided = true;
    }
    return { rt, e, air: air / 60, glided };
  }
  const room = () => mapLevel(registry, ['........', 'P.......', '########']);
  const withGlide = (p: Project) => produce(p, (d) => void (player(d).components.Glide = registry.createDefault('Glide')));

  it('the runtime: Jump held, the character glides down (much longer in the air); without the component it falls as ever', () => {
    const plain = jump(room());
    const glided = jump(withGlide(room()));
    expect(plain.glided).toBe(false);
    expect(glided.glided).toBe(true);
    expect(glided.air).toBeGreaterThan(plain.air * 1.6);
  });

  it('scripts: self.gliding is a name scripts may read, true while it glides; taken out of the engine, the name is unknown again', () => {
    expect(MEMBERS.gliding).toBe('gliding down, Jump held (Glide)');
    const watch = { name: 'Watch', description: '', vars: [{ name: 'glided', value: 0 }], handlers: [{ when: { on: 'tick' }, if: 'self.gliding', do: [{ do: 'set', var: 'glided', value: '1' }] }] };
    const p = produce(withGlide(room()), (d) => void setScript(d, { target: 'definition', id: player(d).id }, watch));
    const { rt, e } = jump(p);
    expect(rt.scripts.errors).toEqual([]);
    expect(e.scripts[0].vars.get('glided')).toBe(1);
    // (And never true without the ability.)
    const q = produce(room(), (d) => void setScript(d, { target: 'definition', id: player(d).id }, watch));
    expect(jump(q).e.scripts[0].vars.get('glided')).toBe(0);
  });

  it('the player\'s reach: a capability with its numbers, from the component\'s own setting; estimated; not simulated (no bot part)', () => {
    expect(reachAbilityIds()).toContain('glide');
    const r = reachOf(game(['glide']));
    expect(r.abilities).toEqual(['glide']);
    expect(r.capabilities.glide.cells).toBeGreaterThanOrEqual(2);
    expect(r.approximate).toEqual(['glide']);
    expect(r.covers.moves).toContain('glide');
    expect(r.covers.simulator).not.toContain('glide');
    // A slower glide carries further.
    const slow = produce(game(['glide']), (d) => void ((player(d).components.Glide as { fallSpeed: number }).fallSpeed = 30));
    expect(reachOf(slow).capabilities.glide.cells).toBeGreaterThan(r.capabilities.glide.cells);
    expect(reachOf(game([])).capabilities.glide).toBeUndefined();
  });

  it('the level builder\'s vocabulary: a level can be asked for by it (focus: glide); a word that is no mechanic is refused, with the ones there are', () => {
    expect(mechanics()).toContain('glide');
    expect(readBlueprint({ difficulty: 2, focus: ['glide'], avoid: ['dash'] }).focus).toEqual(['glide']);
    expect(() => readBlueprint({ difficulty: 2, focus: ['hover'] })).toThrow(/hover\\?" is not a mechanic \(there are: .*glide/);
  });

  it('the level builder and the route solver: its pattern is built only for a player that has it; the route goes by a glide; without it there is no way', () => {
    expect(built(build(game([])).sections)).toBe(false);
    const { grid, sections } = build(game(['glide']));
    expect(built(sections)).toBe(true);
    const route = solveLevel(grid, solverReach(reachOf(game(['glide'])))!);
    expect(route.goal).toBe(true);
    expect(route.path.map((x) => x.move)).toContain('glide');
    expect(solveLevel(grid, solverReach(reachOf(game([])))!).goal).toBe(false);
  });

  it('validation without a bot part: built and solved, and uncertain, never validated; said plainly', () => {
    expect(botMoves()).not.toContain('glide');
    for (const seed of [1, 2, 3]) {
      const { r, sections } = build(game(['glide']), seed);
      expect(built(sections)).toBe(true);
      expect(r.state, `seed ${seed}`).toBe('uncertain');
      expect(r.notes.join(' ')).toMatch(/needs the player's glide/);
      expect(r.notes.join(' ')).toMatch(/not proven playable/);
    }
  });

  it('a hand-made level: the jump checker alone can\'t say a glider gets everywhere, so the level is said to be unjudged (in the ability\'s own words)', () => {
    const far = withGlide(mapLevel(registry, ['P............G', '###.......####']));
    const told = levelReachProblems(far, far.scenes[0].id, registry);
    expect(told.map((x) => x.key)).toContain('reach-unjudged');
    expect(told.find((x) => x.key === 'reach-unjudged')!.text).toMatch(/Its glides aren't judged by the jump checker/);
    // (Without the ability the checker says what it finds out of reach.)
    const plain = mapLevel(registry, ['P............G', '###.......####']);
    expect(levelReachProblems(plain, plain.scenes[0].id, registry).map((x) => x.key)).not.toContain('reach-unjudged');
  });

  describe('with a bot part added to the same definition', () => {
    beforeAll(() => {
      unregisterAbility('glide');
      registerAbility({ ...GLIDE, bot: GLIDE_BOT });
    });
    afterAll(() => {
      unregisterAbility('glide');
      registerAbility(GLIDE);
    });

    it('the route bot plays its moves on the real runtime, and the same levels are validated: played, not assumed', () => {
      expect(botMoves()).toContain('glide');
      expect(reachOf(game(['glide'])).covers.simulator).toContain('glide');
      for (const seed of [1, 2, 3]) {
        const { r, sections } = build(game(['glide']), seed);
        expect(built(sections)).toBe(true);
        expect(r.state, `seed ${seed}: ${r.notes.join(' / ')}`).toBe('validated');
      }
    });

    it('the level needs it: the same level with the player\'s Glide taken away is not winnable (no route, and the plain player can\'t be played across)', () => {
      const { grid } = build(game(['glide']));
      expect(solveLevel(grid, solverReach(reachOf(game([])))!).goal).toBe(false);
    });
  });
});

describe('V1.1: where abilities are in the code', () => {
  const SRC = new URL('../', import.meta.url).pathname;
  const files = (dir: string): string[] => readdirSync(dir).flatMap((f) => (statSync(join(dir, f)).isDirectory() ? files(join(dir, f)) : /\.tsx?$/.test(f) && !/\.test\.|\.generated\./.test(f) ? [join(dir, f)] : []));
  /** A file's code without its comments (prose about an ability is no part of the ability). */
  const code = (f: string) => readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\s\/\/ .*$/gm, '');
  const naming = (re: RegExp) =>
    files(SRC)
      .filter((f) => re.test(code(f)))
      .map((f) => f.slice(SRC.length))
      .sort();

  it('nothing in the engine names Glide: no file but this test has its id, its component or its script name as code', () => {
    expect(naming(/['"]glide['"]|\bGlide\b|\.gliding\b/)).toEqual([]);
  });

  it('taken out again, every system has forgotten it', () => {
    const before = abilityDefinitions().map((d) => d.id);
    registerAbility({ ...GLIDE, id: 'glide2', component: { ...GLIDE.component, type: 'Glide2' }, scriptNames: { gliding2: { state: 'gliding', doc: 'x' } }, bot: GLIDE_BOT });
    expect(modules.get('ability', 'glide2')).toBeDefined();
    unregisterAbility('glide2');
    expect(abilityDefinitions().map((d) => d.id)).toEqual(before);
    expect(modules.get('ability', 'glide2')).toBeUndefined();
    expect(componentRegistry.get('Glide2')).toBeUndefined();
    expect(MEMBERS.gliding2).toBeUndefined();
    expect(mechanics()).not.toContain('glide2');
    expect(reachAbilityIds()).not.toContain('glide2');
    expect(createBuiltinRegistry().get('Glide2')).toBeUndefined();
    const c = checkScript({ id: 's', name: 'W', description: '', vars: [], handlers: [{ when: { on: 'tick' }, if: 'self.gliding2', do: [{ do: 'face', dir: '1' }] }] }, projectFromPreset('platformer', createBuiltinRegistry()));
    expect('error' in c && c.error).toMatch(/gliding2/);
  });

  it('dash and wall jump are each one definition: their runtime, component, move rule and bot step are in src/abilities and nowhere else', () => {
    // Code that implements or registers them (not prose that mentions them: guidance, comments).
    const implementing = naming(/WallState|DashState|function (wallJump|dash)Move|type: '(WallJump|Dash)'|to\.move === '(dash|wall_jump|wall_slide)'|ability\('(wall_jump|dash)'|case '(dashing|wall_sliding)'/);
    expect(implementing).toEqual(['abilities/dash.ts', 'abilities/wallJump.ts']);
    // The other files whose code still says their names at all, each for a reason of its own; none implements or
    // registers anything of them.
    const mentioning = naming(/\bwall_jump\b|\bWallJump\b|\bwallSliding\b|\bwall_sliding\b|\bdashing\b|(?<!Boulder )\bDash\b|'dash'/).filter((f) => !f.startsWith('abilities/'));
    expect(mentioning).toEqual([
      // The AI's guidance for precision platformers (prose for the model).
      'core/ai/topics.ts',
      // The two level patterns that require them (patterns are the level builder's: each names the capability it needs).
      'core/levelGen/patterns/abilities.ts',
      // A worked example for the AI of an ability written as a script (its key and the words that bring it).
      'core/script/examples.ts',
      // ('dash' as a line style of the editor's wires: another word.)
      'editor/viewport/Viewport.tsx',
      // The evaluation case that asks for a game with them (a case names the abilities the game must have).
      'evaluation/cases.ts',
      // A regression game made with them.
      'regression/games/precision.ts',
    ]);
  });
});
