/**
 * What each part of the work costs on a world (docs §30, W0): one number per operation, measured apart, so that
 * "it got faster" or "it got slower" is said of opening, saving, starting, a step of play, an edit, the level
 * check, the AI's context and a generated level each by itself.
 */
import { produce } from 'immer';
import { buildAIPayload } from '../core/ai/context';
import { applyOperations, type Operation } from '../core/commands/operations';
import type { ComponentRegistry } from '../core/components/registry';
import { levelMap } from '../core/model/levelMap';
import { winProblems } from '../core/model/reachability';
import { projectFromBundle, projectToBundle } from '../core/serialization/serialize';
import { levelReachProblems } from '../core/validation/levelProblems';
import { InputState } from '../runtime/input';
import { Runtime } from '../runtime/runtime';
import type { World } from './worlds';

export interface Costs {
  things: number;
  /** A saved game's text, in megabytes. */
  fileMB: number;
  saveMs: number;
  openMs: number;
  /** Play begins (the runtime made from the level). */
  startMs: number;
  /** One step of play, nobody pressing anything: the middle one of those measured. */
  stepMs: number;
  /** …and with the player walking. */
  stepWalkingMs: number;
  /** One tile drawn (draw_tiles of one cell). */
  drawOneMs: number;
  /** A block of 100 tiles drawn in one operation. */
  draw100Ms: number;
  /** One thing moved (set_transform). */
  moveOneMs: number;
  /** One thing placed (place_instance). */
  placeOneMs: number;
  /** The level check (what can be reached, whether it can be won). */
  checkMs: number;
  /** The map of the level the AI is shown. */
  mapMs: number;
  /** Everything the AI is sent about a level. */
  contextMs: number;
  contextChars: number;
}

const ms = (f: () => void): number => {
  const t = performance.now();
  f();
  return Math.round((performance.now() - t) * 10) / 10;
};
const middle = (xs: number[]): number => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

export function measure(world: World, registry: ComponentRegistry, options: { steps?: number; context?: boolean } = {}): Costs {
  const p = world.project;
  const id = p.scenes[0].id;
  const scene = p.scenes[0];
  let text = '';
  const saveMs = ms(() => void (text = JSON.stringify(projectToBundle(p))));
  const openMs = ms(() => void projectFromBundle(JSON.parse(text), registry));
  let rt!: Runtime;
  const startMs = ms(() => void (rt = new Runtime(p, id, registry)));
  const input = new InputState();
  const steps = options.steps ?? 30;
  rt.step(1 / 60, input);
  const still = Array.from({ length: steps }, () => ms(() => rt.step(1 / 60, input)));
  input.press('right');
  const walking = Array.from({ length: steps }, () => ms(() => rt.step(1 / 60, input)));
  const tile = scene.entities[0].definitionId!;
  const far = { col: world.cols + 4, row: 2 };
  const op = (o: Record<string, unknown>) => ms(() => void produce(p, (d) => void applyOperations(d, [o as Operation], registry)));
  const drawOneMs = op({ op: 'draw_tiles', sceneId: id, definitionRef: tile, rects: [{ ...far, width: 1, height: 1 }], onTop: null });
  const draw100Ms = op({ op: 'draw_tiles', sceneId: id, definitionRef: tile, rects: [{ ...far, width: 10, height: 10 }], onTop: null });
  const moveOneMs = op({ op: 'set_transform', entityId: scene.entities[Math.floor(scene.entities.length / 2)].id, x: far.col * 32 + 16, y: 16, rotation: null, scaleX: null, scaleY: null });
  const placeOneMs = op({ op: 'place_instance', sceneId: id, definitionRef: tile, x: far.col * 32 + 16, y: 16, name: null, ref: null, onTop: true });
  const checkMs = ms(() => {
    levelReachProblems(p, id, registry);
    winProblems(p, id, registry);
  });
  const mapMs = ms(() => void levelMap(p, id, registry));
  let contextChars = 0;
  const contextMs = options.context === false ? -1 : ms(() => void (contextChars = JSON.stringify(buildAIPayload(p, { kind: 'level', sceneId: id } as never, registry)).length));
  return { things: world.things, fileMB: Math.round(text.length / 1e5) / 10, saveMs, openMs, startMs, stepMs: middle(still), stepWalkingMs: middle(walking), drawOneMs, draw100Ms, moveOneMs, placeOneMs, checkMs, mapMs, contextMs, contextChars };
}

export const costLine = (name: string, c: Costs): string =>
  `${name}: ${c.things} things | file ${c.fileMB} MB, save ${c.saveMs} ms, open ${c.openMs} ms | play starts ${c.startMs} ms, a step ${c.stepMs} ms (walking ${c.stepWalkingMs}) | one tile ${c.drawOneMs} ms, 100 tiles ${c.draw100Ms} ms, one moved ${c.moveOneMs} ms, one placed ${c.placeOneMs} ms | check ${c.checkMs} ms, map ${c.mapMs} ms, AI context ${c.contextMs} ms (${c.contextChars} chars)`;
