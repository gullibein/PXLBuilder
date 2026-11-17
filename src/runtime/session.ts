/**
 * A game being played, across its levels (docs/engine-architecture-proposal.md §22.7): the level played now, the
 * game's own variables (kept across levels), the levels left for a visit (each kept as it was, to come back to),
 * and whether the game is finished. It has no screen: the play view shows what it plays and is told when the level
 * changes (music, the camera, the recording), and tests play whole games with it.
 *
 * What follows a won level is the game's progression model's to say (core/progression): the session asks it, and
 * never looks at the order of the levels itself. What scripts ask is the same for every model: go_to_level (on to a
 * level by name), visit_level and return_level (to a level and back to the one left, as it was), restart_game.
 */
import type { ComponentRegistry } from '../core/components/registry';
import { gameProgression } from '../core/progression/progression';
import type { Id, Project, Scene } from '../core/types';
import type { InputState } from './input';
import { Runtime } from './runtime';

/** How long a won level stays on screen before the next one, in seconds of the level's time. */
export const WON_PAUSE = 1.5;

export interface SessionHooks {
  /** The level played is about to be left (for another, or back from a visit). */
  leave?(runtime: Runtime): void;
  /**
   * Another level is played now: `back` when it is one that was left for a visit (as it was), else a level begun;
   * `musicFromStart` when its music starts over even if it is the song already playing (the whole game restarted).
   */
  enter?(scene: Scene, runtime: Runtime, how: { musicFromStart: boolean; back: boolean }): void;
}

export class GameSession {
  scene: Scene;
  runtime: Runtime;
  /** The game is finished: the last level was won (play stops; R, restart_game and go_to_level go on). */
  finished = false;
  /** "Level complete!" while moving on, "You finished the game!" after the last level; else null. */
  banner: string | null = null;
  private game: Runtime['game'];
  private visits: { scene: Scene; runtime: Runtime }[] = [];

  constructor(
    readonly project: Project,
    startSceneId: Id,
    private readonly registry: ComponentRegistry,
    private readonly hooks: SessionHooks = {},
  ) {
    this.scene = project.scenes.find((s) => s.id === startSceneId) ?? project.scenes[0];
    this.runtime = new Runtime(project, this.scene.id, registry);
    this.game = this.runtime.game;
  }

  /** How deep in visits the game is (0: in a level of its own). */
  get visiting(): number {
    return this.visits.length;
  }

  /** The level played starts over (R): as the runtime restarts it. */
  restart(): void {
    this.runtime.restart();
    this.finished = false;
  }

  /** One step of the level played (nothing once the game is finished). True when it was played. */
  update(dt: number, input: InputState): boolean {
    if (this.finished) return false;
    this.runtime.update(dt, input);
    return true;
  }

  /** What the step led to: a level won, or what a script asked (another level, a visit, back, the game again). */
  progress(input: InputState): void {
    const project = this.project;
    // A won level: a moment to see it, then the next level (or the end of the game).
    this.banner = null;
    if (this.runtime.completed !== null && !this.runtime.builtinHidden.has('level_end')) {
      const next = gameProgression(project)?.next(project, this.scene.id) ?? null;
      this.banner = next ? 'Level complete!' : 'You finished the game!';
      if (next && this.runtime.time - this.runtime.completed > WON_PAUSE) {
        this.enter(next, false);
        this.banner = null;
      } else if (!next) this.finished = true;
    }
    // A script started the whole game again: its first level, its music from the start, its variables anew.
    if (this.runtime.restartGameRequested) {
      this.game = new Map();
      this.enter(project.scenes.find((s) => s.id === project.startSceneId) ?? project.scenes[0], true);
      this.finished = false;
    }
    // go_to_level: on to that level (by name), as after winning one; the game's variables go along.
    if (this.runtime.goRequest) {
      const go = this.runtime.goRequest;
      this.runtime.goRequest = null;
      const target = this.level(go.level);
      if (target) {
        input.releaseAll();
        this.enter(target, false);
        this.finished = false;
      } else this.runtime.gameplay.emit('script_error', go.by, null, { script: 'go_to_level', message: `there is no level "${go.level}" (levels: ${project.scenes.map((s) => s.name).join(', ')})` });
    }
    // A visit to another level (a battle, a house's inside), and back to the one left, as it was.
    if (this.runtime.visitRequest) {
      const visit = this.runtime.visitRequest;
      const target = this.level(visit.level);
      if (target) {
        input.releaseAll();
        this.runtime.paused = true;
        this.enter(target, false, true);
      } else {
        this.runtime.gameplay.emit('script_error', visit.by, null, { script: 'visit_level', message: `there is no level "${visit.level}" (levels: ${project.scenes.map((s) => s.name).join(', ')})` });
        this.runtime.visitRequest = null;
      }
    }
    if (this.runtime.returnRequest) {
      const result = this.runtime.returnRequest.result;
      this.runtime.returnRequest = null;
      const back = this.visits.pop();
      if (back) {
        const { soundOn, musicOn } = this.runtime;
        input.releaseAll();
        this.hooks.leave?.(this.runtime);
        this.scene = back.scene;
        this.runtime = back.runtime;
        this.runtime.soundOn = soundOn;
        this.runtime.musicOn = musicOn;
        this.hooks.enter?.(this.scene, this.runtime, { musicFromStart: false, back: true });
        this.runtime.returned(result);
      }
    }
  }

  /** A step and what it led to (the play view does the two itself, recording between them). */
  step(dt: number, input: InputState): void {
    this.update(dt, input);
    this.progress(input);
  }

  /** A level by its id or its name (as scripts name it). */
  private level(name: string): Scene | undefined {
    const want = name.trim().toLowerCase();
    return this.project.scenes.find((s) => s.id === name || s.name.trim().toLowerCase() === want);
  }

  /** On to another level (the next one, or the first again): sound and music stay as the game set them. */
  private enter(next: Scene, musicFromStart: boolean, visiting = false): void {
    const { soundOn, musicOn } = this.runtime;
    this.hooks.leave?.(this.runtime);
    if (visiting) this.visits.push({ scene: this.scene, runtime: this.runtime });
    else this.visits = [];
    this.scene = next;
    this.runtime = new Runtime(this.project, next.id, this.registry, this.game);
    this.runtime.soundOn = soundOn;
    this.runtime.musicOn = musicOn;
    this.hooks.enter?.(next, this.runtime, { musicFromStart, back: false });
  }
}
