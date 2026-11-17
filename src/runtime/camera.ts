/**
 * The camera during play: a pipeline of behaviours (cameraBehaviors.ts: follow,
 * velocity look-ahead, rooms; the ones the game's profile makes active) says
 * where it wants to look and inside what; this keeps that inside the limits
 * and moves there (eased, slid or cut), and runs the effects that scripts and
 * rules start (shake, flash, zoom over time, a short look at something,
 * following something else).
 *
 * `camera` is where the camera is; `view()` adds the shake, for drawing.
 */
import { cameraLimits, clampCamera, fitZoom, startCamera, type CameraBounds, type CameraSettings } from '../core/model/camera';
import type { Vec2 } from '../core/types';
import { worldBoundsOfView, type Camera } from '../render/renderer';
import { makePipeline, type CameraBehavior, type CameraContext, type CameraPlan, type CameraZone } from './cameraBehaviors';
import type { RuntimeEntity } from './runtime';

/** Used until Play tells the camera how big the screen is (tests, the first frame). */
const DEFAULT_VIEW = { width: 960, height: 600 };

export class CameraController {
  readonly camera: Camera = { x: 0, y: 0, zoom: 1 };
  private view = { ...DEFAULT_VIEW };
  private settings!: CameraSettings;
  private level: CameraBounds | null = null;
  private target: RuntimeEntity | null = null;
  private strength = 0.15;
  /** The behaviours in play, in order (a fresh pipeline at every start). */
  private pipeline: CameraBehavior[] = makePipeline(['follow']);
  private behaviorIds: readonly string[] = ['follow'];
  /** The level's camera zones now, and how the target moves (given by the runtime). */
  private zones: () => readonly CameraZone[] = () => [];
  private motionOf: (e: RuntimeEntity) => CameraContext['motion'] = (e) => ({ vx: e.vx, vy: e.vy, floats: false });
  /** A slide into another zone under way: from where, and how far along. */
  private slide: { from: Vec2; left: number; total: number } | null = null;
  private shake = { strength: 0, left: 0, total: 0 };
  private flashFx = { color: '#ffffff', left: 0, total: 0 };
  private zoomFx: { from: number; to: number; left: number; total: number } | null = null;
  private focus: { on: RuntimeEntity; left: number } | null = null;
  /** For tests: the shake offset is random; this makes it repeatable. */
  random: () => number = Math.random;

  /**
   * A fresh start (Play started or the level restarted). `behaviors`: the camera behaviours active in the game, in
   * order (by default: follow, the camera as it always was); `world`: the level's zones and how things move.
   */
  reset(settings: CameraSettings, target: RuntimeEntity | null, strength: number, level: CameraBounds | null, behaviors: readonly string[] = ['follow'], world?: { zones: () => readonly CameraZone[]; motionOf: (e: RuntimeEntity) => CameraContext['motion'] }): void {
    this.settings = settings;
    this.target = target;
    this.strength = strength;
    this.level = level;
    this.behaviorIds = behaviors;
    this.pipeline = makePipeline(behaviors);
    if (world) {
      this.zones = world.zones;
      this.motionOf = world.motionOf;
    }
    this.slide = null;
    this.shake = { strength: 0, left: 0, total: 0 };
    this.flashFx = { color: '#ffffff', left: 0, total: 0 };
    this.zoomFx = null;
    this.focus = null;
    this.camera.zoom = fitZoom(settings, this.view, level) ?? settings.zoom;
    this.snap();
  }

  /** Jumps straight to where it should be now (no easing): used at the start. */
  snap(): void {
    const plan: CameraPlan = { goal: null, limits: cameraLimits(this.settings, this.level), transition: null };
    const ctx = this.context(0, 1);
    for (const b of this.pipeline) b.start?.(plan, ctx);
    const at = clampCamera(plan.goal ?? this.stillPoint(), plan.limits, this.view, this.camera.zoom);
    this.camera.x = at.x;
    this.camera.y = at.y;
    this.slide = null;
  }

  /** Where a still camera looks: its fixed point, or the middle of the level. */
  private stillPoint(): Vec2 {
    return this.settings.fixedAt ?? (this.level ? { x: (this.level.minX + this.level.maxX) / 2, y: (this.level.minY + this.level.maxY) / 2 } : { x: 0, y: 0 });
  }

  private context(dt: number, k: number): CameraContext {
    const t = this.target;
    return { settings: this.settings, camera: this.camera, view: this.view, target: t, motion: t ? this.motionOf(t) : null, zones: this.zones(), dt, k };
  }

  /** The behaviours in play (their ids, in order). */
  get behaviors(): readonly string[] {
    return this.behaviorIds;
  }

  /** The screen size in CSS pixels (Play calls this when the window changes). */
  setView(width: number, height: number): void {
    if (width < 2 || height < 2) return;
    this.view = { width, height };
    // Fitted to the screen: the zoom follows the window (unless a zoom effect is running).
    const fit = this.settings && !this.zoomFx ? fitZoom(this.settings, this.view, this.level) : null;
    if (fit && fit !== this.camera.zoom) {
      this.camera.zoom = fit;
      this.snap();
    }
  }

  /** What the camera shows now, in the level (without any shake). */
  visible(): { minX: number; minY: number; maxX: number; maxY: number } {
    if (this.camera.iso) {
      const b = worldBoundsOfView(this.camera, this.view);
      return { minX: b.left, minY: b.top, maxX: b.right, maxY: b.bottom };
    }
    const hw = this.view.width / 2 / this.camera.zoom;
    const hh = this.view.height / 2 / this.camera.zoom;
    return { minX: this.camera.x - hw, minY: this.camera.y - hh, maxX: this.camera.x + hw, maxY: this.camera.y + hh };
  }

  /** What it follows now (null: stays still). */
  get following(): RuntimeEntity | null {
    return this.target;
  }

  update(dt: number): void {
    if (this.zoomFx) {
      const z = this.zoomFx;
      z.left = Math.max(0, z.left - dt);
      const t = z.total > 0 ? 1 - z.left / z.total : 1;
      this.camera.zoom = z.from + (z.to - z.from) * smooth(t);
      if (z.left <= 0) this.zoomFx = null;
    }
    if (this.shake.left > 0) this.shake.left = Math.max(0, this.shake.left - dt);
    if (this.flashFx.left > 0) this.flashFx.left = Math.max(0, this.flashFx.left - dt);

    const k = 1 - Math.pow(1 - Math.min(0.999, Math.max(0.001, this.strength)), dt * 60);
    let goal: Vec2;
    const plan: CameraPlan = { goal: null, limits: cameraLimits(this.settings, this.level), transition: null };
    if (this.focus && this.focus.left > 0) {
      // A look at something: the behaviours wait (and the level's own limits hold).
      this.focus.left -= dt;
      goal = { x: this.focus.on.x, y: this.focus.on.y };
    } else {
      this.focus = null;
      const ctx = this.context(dt, k);
      for (const b of this.pipeline) b.apply(plan, ctx);
      // (Nothing to look at: where a still camera looks.)
      goal = plan.goal ?? startCamera(this.settings, null, this.level, this.view);
    }
    // (Seen at an angle, the screen shows a diamond of the level: the flat limits don't apply.)
    if (!this.camera.iso) goal = clampCamera(goal, plan.limits, this.view, this.camera.zoom);
    if (plan.transition === 'cut') {
      this.slide = null;
      this.camera.x = goal.x;
      this.camera.y = goal.y;
      return;
    }
    if (plan.transition) this.slide = { from: { x: this.camera.x, y: this.camera.y }, left: plan.transition.slide, total: plan.transition.slide };
    if (this.slide) {
      // Sliding into another zone: from where it was to where it wants to be there, in a fixed time.
      const s = this.slide;
      s.left = Math.max(0, s.left - dt);
      const t = smooth(s.total > 0 ? 1 - s.left / s.total : 1);
      this.camera.x = s.from.x + (goal.x - s.from.x) * t;
      this.camera.y = s.from.y + (goal.y - s.from.y) * t;
      if (s.left <= 0) this.slide = null;
      return;
    }
    this.camera.x += (goal.x - this.camera.x) * k;
    this.camera.y += (goal.y - this.camera.y) * k;
  }

  /** Sliding into another zone now. */
  get sliding(): boolean {
    return this.slide !== null;
  }

  /** The camera to draw with (shake included). */
  frame(): Camera {
    if (this.shake.left <= 0) return this.camera;
    const s = this.shake.strength * (this.shake.left / this.shake.total);
    return { x: this.camera.x + (this.random() * 2 - 1) * s, y: this.camera.y + (this.random() * 2 - 1) * s, zoom: this.camera.zoom, iso: this.camera.iso };
  }

  /** The flash to draw over the screen, if one is running. */
  flash(): { color: string; alpha: number } | null {
    if (this.flashFx.left <= 0) return null;
    return { color: this.flashFx.color, alpha: 0.8 * (this.flashFx.left / this.flashFx.total) };
  }

  // ---------------------------------------------------------------- effects

  startShake(strength: number, seconds: number): void {
    if (seconds <= 0 || strength <= 0) return;
    this.shake = { strength: Math.min(64, strength), left: seconds, total: seconds };
  }

  startFlash(color: string, seconds: number): void {
    if (seconds <= 0) return;
    this.flashFx = { color: /^#[0-9a-f]{6}$/i.test(color) ? color : '#ffffff', left: seconds, total: seconds };
  }

  zoomTo(zoom: number, seconds: number): void {
    const to = Math.min(4, Math.max(0.25, zoom));
    if (seconds <= 0) {
      this.zoomFx = null;
      this.camera.zoom = to;
    } else this.zoomFx = { from: this.camera.zoom, to, left: seconds, total: seconds };
  }

  /** Looks at something for a while, then goes back. */
  focusOn(e: RuntimeEntity, seconds: number): void {
    if (seconds > 0) this.focus = { on: e, left: seconds };
  }

  /** Follows something else from now on (null: stay where it is). */
  follow(e: RuntimeEntity | null): void {
    this.target = e;
    for (const b of this.pipeline) b.retarget?.();
    if (!e) this.settings = { ...this.settings, fixedAt: { x: this.camera.x, y: this.camera.y } };
  }
}

function smooth(t: number): number {
  return t * t * (3 - 2 * t);
}
