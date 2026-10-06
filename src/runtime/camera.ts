/**
 * The camera during play: follows its target (smoothing, look-ahead, dead
 * zone), or stays still; keeps inside the level's limits; and runs effects
 * that scripts and rules start (shake, flash, zoom over time, a short look at
 * something, following something else).
 *
 * `camera` is where the camera is; `view()` adds the shake, for drawing.
 */
import { cameraLimits, clampCamera, startCamera, type CameraBounds, type CameraSettings } from '../core/model/camera';
import type { Vec2 } from '../core/types';
import type { Camera } from '../render/renderer';
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
  /** Current look-ahead offset (eases toward facing × lookAhead). */
  private look = 0;
  private shake = { strength: 0, left: 0, total: 0 };
  private flashFx = { color: '#ffffff', left: 0, total: 0 };
  private zoomFx: { from: number; to: number; left: number; total: number } | null = null;
  private focus: { on: RuntimeEntity; left: number } | null = null;
  /** For tests: the shake offset is random; this makes it repeatable. */
  random: () => number = Math.random;

  /** A fresh start (Play started or the level restarted). */
  reset(settings: CameraSettings, target: RuntimeEntity | null, strength: number, level: CameraBounds | null): void {
    this.settings = settings;
    this.target = target;
    this.strength = strength;
    this.level = level;
    this.look = 0;
    this.shake = { strength: 0, left: 0, total: 0 };
    this.flashFx = { color: '#ffffff', left: 0, total: 0 };
    this.zoomFx = null;
    this.focus = null;
    this.camera.zoom = settings.zoom;
    this.snap();
  }

  /** Jumps straight to where it should be now (no easing): used at the start. */
  snap(): void {
    const t = this.target?.alive ? this.target : null;
    const at = startCamera({ ...this.settings, zoom: this.camera.zoom }, t ? { x: t.x, y: t.y } : null, this.level, this.view);
    this.camera.x = at.x;
    this.camera.y = at.y;
  }

  /** The screen size in CSS pixels (Play calls this when the window changes). */
  setView(width: number, height: number): void {
    if (width < 2 || height < 2) return;
    this.view = { width, height };
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
    if (this.focus && this.focus.left > 0) {
      this.focus.left -= dt;
      goal = { x: this.focus.on.x, y: this.focus.on.y };
    } else {
      this.focus = null;
      const t = this.target;
      if (t?.alive) {
        this.look += (t.facing * this.settings.lookAhead - this.look) * k;
        goal = this.deadZone({ x: t.x + this.look, y: t.y });
      } else if (t) {
        // What it followed is gone: hold still where it is.
        goal = { x: this.camera.x, y: this.camera.y };
      } else goal = startCamera(this.settings, null, this.level, this.view);
    }
    goal = clampCamera(goal, cameraLimits(this.settings, this.level), this.view, this.camera.zoom);
    this.camera.x += (goal.x - this.camera.x) * k;
    this.camera.y += (goal.y - this.camera.y) * k;
  }

  /** Inside the dead zone the camera holds still; outside it, it keeps the target at the zone's edge. */
  private deadZone(p: Vec2): Vec2 {
    const dz = this.settings.deadZone;
    const axis = (want: number, at: number, half: number) => (want - at > half ? want - half : want - at < -half ? want + half : at);
    return { x: axis(p.x, this.camera.x, dz.x), y: axis(p.y, this.camera.y, dz.y) };
  }

  /** The camera to draw with (shake included). */
  frame(): Camera {
    if (this.shake.left <= 0) return this.camera;
    const s = this.shake.strength * (this.shake.left / this.shake.total);
    return { x: this.camera.x + (this.random() * 2 - 1) * s, y: this.camera.y + (this.random() * 2 - 1) * s, zoom: this.camera.zoom };
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
    this.look = 0;
    if (!e) this.settings = { ...this.settings, fixedAt: { x: this.camera.x, y: this.camera.y } };
  }
}

function smooth(t: number): number {
  return t * t * (3 - 2 * t);
}
