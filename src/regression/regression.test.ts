/**
 * The cross-genre regression suite (docs/engine-architecture-proposal.md §15): representative games of every family
 * PXLBuilder makes, built as it builds them and played on the real runtime. Each test checks the game's defining
 * mechanics, and its trace's fingerprint is golden: a change to the engine that moves any of these games, frame by
 * frame, shows here. (Set REGRESSION_RECORD=1 to print the fingerprints instead of checking them.)
 */
import { describe, expect, it } from 'vitest';
import { createBuiltinRegistry } from '../core/components/builtin';
import { solveLevel } from '../core/levelGen/solver';
import { playerLimits } from '../core/levelGen/limits';
import { findRoles } from '../core/levelGen/roles';
import { Runtime } from '../runtime/runtime';
import { playRoute } from '../runtime/routeBot';
import { boulderDash, mining, spaceShooter } from './games/action';
import { drMario, tetris } from './games/boards';
import { mapLevel, marioLevel } from './games/platformers';
import { body, cellsOf, Player, varOf, withSeed } from './harness';
import { playPrecision, precisionRoom } from './games/precision';
import { playScenario, SCENARIOS } from './movement';
import { createHash } from 'node:crypto';

const registry = createBuiltinRegistry();
const RECORD = !!process.env.REGRESSION_RECORD;
const golden = (name: string, got: string, want: string) => {
  if (RECORD) console.log(`GOLDEN ${JSON.stringify(name)}: '${got}',`);
  else expect(got, `${name}: its trace changed`).toBe(want);
};

/** Fingerprints recorded with the engine before F2 (movement moved behind the movement models). */
const GAMES: Record<string, string> = {
  'mario: generated level': 'ba9fd23c5205d802',
  'mario: stomp and block': '7797b96734514bca',
  'tetris': 'aa4e2126b0418fb0',
  'dr mario': '668aa2b21263d78a',
  'space shooter': '37309329ca55e9b3',
  'mining': 'b31e47b6a0ff3cec',
  'boulder dash': 'd2262247ae5688ad',
  // (Recorded at F2, when its abilities came in: a baseline for later stages.)
  'celeste-inspired': 'd370c109c9930a7b',
};
const MOVES: Record<string, string> = {
  'run and stop': '0de2962d62f36cc2',
  'full jump and short hop': '9f62e6223284c70d',
  'running jump over a gap': 'f9000796869cc116',
  'coyote time (jump just after the edge)': '3a4a084a612ddd80',
  'jump buffer (pressed just before landing)': '2807e2c3d0b61546',
  'double jump': '2a77ba272f943242',
  'ledge grab and climb up': '3c26c68725b05164',
  'ladder up, off the top, and down again': '145349164d5d7d49',
  'swimming strokes and out of the water': 'f5d950d6022e9442',
  'drop through a jump-through platform': '0618cc14a8549801',
  'ramps up and down': '13cf990eea1769be',
  'spring bounce and launch': '1a6315497e0156db',
  'top-down walking (straight and diagonal)': 'add7098a588d2e66',
  'isometric walking (keys follow the screen)': '8efd1bb465ac7f9c',
  'running taken over by a script': '0e62334c57de4634',
  'jumping taken over by a script': 'f9000796869cc116',
  'climbing taken over by a script': '7cee0a8bfd20c936',
};

describe('cross-genre regression suite: every family still plays, frame for frame', () => {
  it('Mario-style: a level of the classic builder, won by the route bot; stomping an enemy; a ? block gives its coin', () => {
    withSeed(1, () => {
      const { project, grid } = marioLevel(registry, 21);
      const lim = playerLimits(project, project.scenes[0].id, findRoles(project, registry).player!.id, registry, 5)!;
      const h = createHash('sha256');
      const r = playRoute(project, project.scenes[0].id, solveLevel(grid, lim).path, registry, (step, p) => h.update(`${step}:${Math.round(p.x)},${Math.round(p.y)};`));
      expect(r.won).toBe(true);
      golden('mario: generated level', h.digest('hex').slice(0, 16), GAMES['mario: generated level']);
    });
    withSeed(1, () => {
      // Stomp: falling onto a walking enemy defeats it. ? block: jumping up into it gives a coin on top.
      const p = mapLevel(registry, ['..........', '..........', '....?.....', '..........', '.P....E...', '##########']);
      const rt = new Runtime(p, p.startSceneId, registry);
      const pl = new Player(rt);
      const coins = () => rt.entities.filter((e) => e.alive && e.name === 'Coin').length;
      const enemies = () => rt.entities.filter((e) => e.alive && e.tags.includes('enemy')).length;
      const before = coins();
      pl.play(0.3);
      pl.play(1.4, [{ at: 0, hold: ['right'] }, { at: 0.48, hold: ['jump'] }, { at: 0.9, hold: [] }], (r) => body(r.entities.find((e) => e.controller)));
      expect(coins()).toBeGreaterThan(before);
      // (The enemy walked into the player's way meanwhile, and was landed on: stomped.)
      expect(enemies()).toBe(0);
      expect(rt.eventLog.some((e) => e.type === 'stomped')).toBe(true);
      pl.play(2, [{ at: 0, hold: ['right', 'jump'] }, { at: 0.5, hold: ['right'] }, { at: 1.2, hold: [] }], (r) => [body(r.entities.find((e) => e.controller)), r.entities.filter((e) => e.alive && e.tags.includes('enemy')).length]);
      golden('mario: stomp and block', pl.fingerprint(), GAMES['mario: stomp and block']);
    });
  });

  it('Tetris: a piece moves as one, stops at the walls, locks; a full row clears and what is above drops', () => {
    withSeed(2, () => {
      const p = tetris(registry, [...Array.from({ length: 6 }, (_, c) => ({ col: c, row: 19 })), { col: 2, row: 18 }]);
      const rt = new Runtime(p, p.startSceneId, registry);
      const pl = new Player(rt);
      const board = () => rt.entities.find((e) => e.name === 'Board');
      const trace = (r: Runtime) => [cellsOf(r, 'active'), cellsOf(r, 'locked'), varOf(board(), 'cleared')];
      pl.play(0.02, [], trace, 1);
      expect(cellsOf(rt, 'active')).toEqual(['3,0', '4,0', '5,0', '6,0']);
      for (let i = 0; i < 6; i++) pl.tap('right', trace);
      // (Against the right wall: columns 6..9.)
      expect([...new Set(cellsOf(rt, 'active').map((c) => c.split(',')[0]))]).toEqual(['6', '7', '8', '9']);
      pl.play(3, [], trace);
      // The row filled and cleared; the block above it (column 2, row 18) dropped into row 19.
      expect(varOf(board(), 'cleared')).toBe(1);
      expect(cellsOf(rt, 'locked')).toContain('2,19');
      golden('tetris', pl.fingerprint(), GAMES.tetris);
    });
  });

  it('Dr. Mario: the pill falls and is steered; four of a colour in a column clear, viruses too; the rest stays', () => {
    withSeed(3, () => {
      const p = drMario(registry, [{ col: 3, row: 14, color: 'red' }, { col: 3, row: 15, color: 'red' }, { col: 6, row: 15, color: 'blue' }]);
      const rt = new Runtime(p, p.startSceneId, registry);
      const pl = new Player(rt);
      const board = () => rt.entities.find((e) => e.name === 'Board');
      const trace = (r: Runtime) => [cellsOf(r, 'active'), cellsOf(r, 'red'), cellsOf(r, 'blue'), varOf(board(), 'cleared')];
      pl.play(0.05, [], trace, 1);
      expect(cellsOf(rt, 'active')).toEqual(['3,0', '3,1']);
      pl.play(3, [], trace);
      expect(cellsOf(rt, 'virus')).toEqual(['6,15']);
      expect(varOf(board(), 'cleared')).toBe(1);
      // A new pill came, and is steered left.
      const cols = () => [...new Set(cellsOf(rt, 'active').map((c) => c.split(',')[0]))];
      expect(cols()).toEqual(['3']);
      pl.tap('left', trace);
      pl.tap('left', trace);
      expect(cols()).toEqual(['1']);
      pl.play(2, [], trace);
      golden('dr mario', pl.fingerprint(), GAMES['dr mario']);
    });
  });

  it('Space shooter: holding fire keeps firing; a shot destroys the saucer above; saucers fire back; the ship stays on screen', () => {
    withSeed(4, () => {
      const p = spaceShooter(registry);
      const rt = new Runtime(p, p.startSceneId, registry);
      const pl = new Player(rt);
      const ship = () => rt.entities.find((e) => e.controller)!;
      const saucers = () => rt.entities.filter((e) => e.alive && e.name === 'Saucer').map((e) => Math.round(e.x));
      expect(saucers()).toEqual([-96, -32, 32, 96]);
      pl.play(2, [{ at: 0, hold: ['fire'] }], (r) => [body(r.entities.find((e) => e.controller)), saucers(), r.entities.filter((e) => e.alive && e.projectile).length]);
      const shots = rt.eventLog.filter((e) => e.type === 'shot');
      expect(saucers()).toEqual([-32, 32, 96]);
      expect(shots.filter((e) => /Player/.test(JSON.stringify(e))).length).toBeGreaterThanOrEqual(5);
      expect(shots.some((e) => /Saucer/.test(JSON.stringify(e)))).toBe(true);
      // Flying down and left a long way: Stay On Screen keeps it inside the view.
      pl.play(3, [{ at: 0, hold: ['down', 'left'] }], (r) => body(r.entities.find((e) => e.controller)));
      expect(Math.abs(ship().y - rt.cam.camera.y)).toBeLessThan(400);
      golden('space shooter', pl.fingerprint(), GAMES['space shooter']);
    });
  });

  it('Mining: digging down through dirt (ore becomes cargo, fuel burns); rock stops the shaft', () => {
    withSeed(5, () => {
      const p = mining(registry);
      const rt = new Runtime(p, p.startSceneId, registry);
      const pl = new Player(rt);
      const hero = rt.entities.find((e) => e.controller)!;
      const y0 = hero.y;
      pl.play(4, [{ at: 0, hold: ['down'] }], (r) => [body(r.entities.find((e) => e.controller)), varOf(hero, 'cargo'), varOf(hero, 'fuel')]);
      // Rows 1..7 dug (ore at 3 and 5); rock at row 8 stops it.
      expect((hero.y - y0) / 32).toBe(7);
      expect(varOf(hero, 'cargo')).toBe(2);
      expect(varOf(hero, 'dug')).toBe(7);
      expect(Number(varOf(hero, 'fuel'))).toBeLessThan(100);
      golden('mining', pl.fingerprint(), GAMES.mining);
    });
  });

  it('Boulder Dash: digging square by square; the boulder falls once its dirt is dug; the diamond is collected; walls stop the player', () => {
    withSeed(6, () => {
      const p = boulderDash(registry);
      const rt = new Runtime(p, p.startSceneId, registry);
      const pl = new Player(rt);
      const hero = rt.entities.find((e) => e.controller)!;
      const trace = (r: Runtime) => [body(hero), cellsOf(r, 'boulder'), cellsOf(r, 'dirt').length];
      pl.play(0.1, [], trace);
      expect(cellsOf(rt, 'boulder')).toEqual(['3,0']);
      pl.play(3, [{ at: 0, hold: ['right'] }], trace);
      expect(cellsOf(rt, 'boulder')).toEqual(['3,1']);
      expect([(hero.x - 16) / 32, (hero.y - 16) / 32]).toEqual([7, 1]);
      expect(rt.entities.filter((e) => e.alive && e.name === 'Coin')).toHaveLength(0);
      expect(cellsOf(rt, 'dirt')).not.toContain('6,1');
      golden('boulder dash', pl.fingerprint(), GAMES['boulder dash']);
    });
  });

  it('Celeste-inspired: a pit only a dash crosses and a shaft only wall jumps climb; each ability needed, both win the room', () => {
    withSeed(8, () => {
      const outcome = (abilities: string[]) => {
        const p = precisionRoom(registry, abilities);
        const rt = new Runtime(p, p.startSceneId, registry);
        const pl = new Player(rt);
        const r = playPrecision(rt, pl, 12, (q) => body(q.entities.find((e) => e.controller)));
        return { ...r, fingerprint: pl.fingerprint() };
      };
      const both = outcome(['wall_jump', 'dash']);
      expect(both).toMatchObject({ won: true, died: false });
      // Only the dash: across the pit, stuck at the bottom of the shaft. Only wall jumps, or neither: into the spikes.
      expect(outcome(['dash'])).toMatchObject({ won: false, died: false });
      expect(outcome(['wall_jump'])).toMatchObject({ won: false, died: true });
      expect(outcome([])).toMatchObject({ won: false, died: true });
      golden('celeste-inspired', both.fingerprint, GAMES['celeste-inspired']);
    });
  });

  it.todo('Momentum platformer (Sonic-inspired): speed builds running downhill and is lost uphill; a loop is gone round at speed and fallen out of when slow (needs the surface movement model and curved ground: slice V3)');

  it('every movement the engine does, frame for frame: running, jumps, coyote time, jump buffer, double jump, ledge grab, ladders, swimming, drop-through, ramps, springs, top-down and isometric walking, parts taken over by scripts', () => {
    for (const s of SCENARIOS) {
      const r = withSeed(7, () => playScenario(s, registry));
      expect(r.samples, s.name).toBeGreaterThan(30);
      golden(`move: ${s.name}`, r.fingerprint, MOVES[s.name]);
    }
  });
});
