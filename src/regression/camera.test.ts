/**
 * F5's non-regression goldens (docs/engine-architecture-proposal.md §20): where the camera is, frame by frame, in a
 * game of every family played with the same inputs, and through every camera setting and effect. Recorded before the
 * camera moved behind its behaviour pipeline; they must stay identical. (REGRESSION_RECORD=1 prints them.)
 */
import { produce } from 'immer';
import { describe, expect, it } from 'vitest';
import { createBuiltinRegistry } from '../core/components/builtin';
import { projectFromPreset } from '../core/engine/profile';
import type { Project } from '../core/types';
import { Runtime } from '../runtime/runtime';
import { boulderDash, mining, spaceShooter } from './games/action';
import { drMario, tetris } from './games/boards';
import { digRoom } from './games/digging';
import { mapLevel, marioLevel } from './games/platformers';
import { precisionRoom } from './games/precision';
import { Player, withSeed, type InputStep } from './harness';

const registry = createBuiltinRegistry();
const RECORD = !!process.env.REGRESSION_RECORD;
const golden = (name: string, got: string, want: string) => {
  if (RECORD) console.log(`GOLDEN ${JSON.stringify(name)}: '${got}',`);
  else expect(got, `${name}: the camera's path changed`).toBe(want);
};

const round = (n: number) => Math.round(n * 100) / 100;
/** The camera now: where it is, its zoom, and what is drawn (shake included), and the flash. */
const cameraOf = (rt: Runtime) => {
  const c = rt.cam.camera;
  const f = rt.cam.frame();
  const fl = rt.cam.flash();
  return [round(c.x), round(c.y), round(c.zoom), round(f.x), round(f.y), fl ? round(fl.alpha) : 0];
};

/** The same keys for every game: right, a jump, left, up, down with fire, nothing. */
const KEYS: InputStep[] = [
  { at: 0, hold: ['right'] },
  { at: 1, hold: ['right', 'jump'] },
  { at: 1.5, hold: ['left'] },
  { at: 2.2, hold: ['up'] },
  { at: 2.6, hold: ['down', 'fire'] },
  { at: 3, hold: [] },
];

export const CAMERA_GAMES: Record<string, () => Project> = {
  'mario: generated level': () => marioLevel(registry, 21).project,
  tetris: () => tetris(registry, [{ col: 2, row: 18 }]),
  'dr mario': () => drMario(registry, [{ col: 3, row: 14, color: 'red' }]),
  'space shooter': () => spaceShooter(registry),
  mining: () => mining(registry),
  'boulder dash': () => boulderDash(registry),
  'celeste-inspired': () => precisionRoom(registry),
  'lode-runner-inspired': () => digRoom(registry),
  'top-down starter': () => projectFromPreset('topdown', registry),
  'rpg starter': () => projectFromPreset('rpg', registry),
  'roguelike starter': () => projectFromPreset('roguelike', registry),
  'isometric starter': () => projectFromPreset('isometric', registry),
  'platformer starter': () => projectFromPreset('platformer', registry),
};

export function cameraTrace(project: Project, seconds = 3.5, during?: (rt: Runtime, pl: Player) => void): string {
  return withSeed(11, () => {
    const rt = new Runtime(project, project.startSceneId ?? project.scenes[0].id, registry);
    rt.cam.random = Math.random;
    const pl = new Player(rt);
    if (during) during(rt, pl);
    else pl.play(seconds, KEYS, cameraOf, 3);
    return pl.fingerprint();
  });
}

/** A long floor with every camera setting in use, and every effect started in turn. */
function settingsLevel(camera: Record<string, unknown>): Project {
  const rows = ['.'.repeat(60), '.'.repeat(60), '.'.repeat(60), `..P${'.'.repeat(50)}G......`, '#'.repeat(60), '#'.repeat(60)];
  return produce(mapLevel(registry, rows), (d) => {
    d.scenes[0].camera = { zoom: 1, lookAhead: 0, deadZone: { x: 0, y: 0 }, bounds: 'level', customBounds: null, fixedAt: null, ...camera } as never;
  });
}

const SETTINGS: Record<string, Record<string, unknown>> = {
  'look-ahead and dead zone': { zoom: 1.5, lookAhead: 150, deadZone: { x: 40, y: 30 } },
  'custom bounds': { bounds: 'custom', customBounds: { minX: 0, minY: -200, maxX: 900, maxY: 192 } },
  'no bounds, zoomed out': { bounds: 'none', zoom: 0.5 },
  'fit to height': { fit: 'height', fitSize: 192 },
};

const effects = (rt: Runtime, pl: Player) => {
  const goal = rt.entities.find((e) => e.name === 'Goal')!;
  pl.play(1, [{ at: 0, hold: ['right'] }], cameraOf, 3);
  rt.cam.startShake(8, 0.4);
  rt.cam.startFlash('#ff0000', 0.3);
  pl.play(0.6, [{ at: 0, hold: ['right'] }], cameraOf, 3);
  rt.cam.zoomTo(2, 0.5);
  pl.play(0.7, [{ at: 0, hold: ['right', 'jump'] }], cameraOf, 3);
  rt.cam.focusOn(goal, 0.6);
  pl.play(1, [{ at: 0, hold: ['left'] }], cameraOf, 3);
  rt.cam.zoomTo(1, 0);
  rt.cam.follow(goal);
  pl.play(0.6, [], cameraOf, 3);
  rt.cam.follow(null);
  pl.play(0.4, [{ at: 0, hold: ['right'] }], cameraOf, 3);
  rt.cam.setView(640, 360);
  rt.restart();
  pl.play(0.5, [{ at: 0, hold: ['right'] }], cameraOf, 3);
};

const CAMERAS: Record<string, string> = {
  'mario: generated level': '769dde086919e568',
  tetris: '0474e968827c1488',
  'dr mario': '4e3f0b420178e29e',
  'space shooter': 'ba087185524efe52',
  mining: 'fb66818585da8bb2',
  'boulder dash': '06e4eafb2f537107',
  'celeste-inspired': '142cc79464b4180b',
  'lode-runner-inspired': 'd28989e3ec5df398',
  'top-down starter': 'd8a194da8345a409',
  'rpg starter': 'c5aef5a928d658de',
  'roguelike starter': 'ce37c360255db9bc',
  'isometric starter': 'cce80dd61058c616',
  'platformer starter': 'd8a194da8345a409',
  'look-ahead and dead zone': '46181f3e25afbcdd',
  'custom bounds': '250a60b2d747d918',
  'no bounds, zoomed out': '1be709798fffede4',
  'fit to height': 'e3de8d1722b3d6bd',
  effects: '419b1c640749f160',
};

describe('F5 non-regression: the camera of every family, and every camera setting and effect', () => {
  it('the camera\'s path in each game of the regression suite (boards, shooters, mining, Boulder Dash, platformers, starters) is unchanged', () => {
    for (const [name, make] of Object.entries(CAMERA_GAMES)) golden(`camera: ${name}`, cameraTrace(withSeed(1, make)), CAMERAS[name]);
  });

  it('every camera setting (look-ahead, dead zone, bounds, zoom, fit) and effect (shake, flash, zoom, focus, follow, a new screen size, restart) is unchanged', () => {
    for (const [name, camera] of Object.entries(SETTINGS)) golden(`camera: ${name}`, cameraTrace(settingsLevel(camera)), CAMERAS[name]);
    golden('camera: effects', cameraTrace(settingsLevel({ lookAhead: 80 }), 0, effects), CAMERAS.effects);
  });
});
