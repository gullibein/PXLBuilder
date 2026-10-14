import { useEffect, useRef, useState } from 'react';
// The console font of the game's text (banners, messages), built in: an exported game needs no internet.
import consoleFontUrl from '@fontsource/press-start-2p/files/press-start-2p-latin-400-normal.woff?url';
import { componentRegistry } from '../../core/components/builtin';
import { applyCamera, drawBackground, drawEntities } from '../../render/renderer';
import { drawScreenDrawings, LookCache } from '../../render/screen';
import { audio, playRecipe } from '../audio/synth';
import { browserPads, GamepadReader, InputState, KEY_BINDINGS, type Action } from '../../runtime/input';
import { PlayRecorder } from '../../runtime/recorder';
import { Runtime } from '../../runtime/runtime';
import { imageLookup } from '../images';
import type { PlayReport } from '../../core/debug/playReport';
import type { Project } from '../../core/types';

/**
 * Play mode: builds a fresh Runtime from the current project, runs it, and
 * draws it with the same renderer as the editor. Leaving play mode discards
 * the runtime; the project is untouched. R restarts.
 */
interface Hud {
  health: { current: number; max: number } | null;
  items: [string, number][];
  messages: string[];
  hasSwitches: boolean;
  canShoot: boolean;
  /** The player walks in every direction (top-down): no jumping. */
  topDown: boolean;
  /** "Level complete!" while moving on, or "You finished the game!" after the last level. */
  banner: string | null;
}

const sameHud = (a: Hud, b: Hud) => JSON.stringify(a) === JSON.stringify(b);

export interface PlayViewProps {
  /** The game to play (a snapshot: playing never changes it) and the level to start at. */
  project: Project;
  startSceneId: string;
  /** The play resolution now (0: the screen's own; else about this many pixels tall), read on every resize. */
  playPixels: () => number;
  /** Play ended (the view closed): what happened, for the editor's Debug tab. */
  onEnd?: (report: PlayReport, project: Project) => void;
  /** The key hints' last part ("Esc stops" in the editor). */
  stopHint?: string;
  /** The key hints under the game (the editor's Play); an exported game shows only the game. */
  keyHints?: boolean;
  /** On-screen buttons for phones and tablets (move, jump, use, shoot), shown on touch screens. */
  touchControls?: boolean;
}

let consoleFont: FontFace | null = null;
/** The console font, added to the page once and loaded now, so "Level complete!" shows in it at once. */
function loadConsoleFont(): void {
  if (consoleFont || typeof FontFace === 'undefined') return;
  consoleFont = new FontFace('Press Start 2P', `url(${consoleFontUrl})`);
  document.fonts.add(consoleFont);
  consoleFont.load().catch(() => undefined);
}

/** A touch screen (phones, tablets): where the on-screen buttons are shown. */
export function isTouchScreen(): boolean {
  return typeof window !== 'undefined' && ('ontouchstart' in window || navigator.maxTouchPoints > 0);
}

export function PlayView(props: PlayViewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // The game's controls, for the on-screen buttons.
  const inputRef = useRef<InputState | null>(null);
  const [hud, setHud] = useState<Hud>({ health: null, items: [], messages: [], hasSwitches: false, canShoot: false, topDown: false, banner: null });

  useEffect(() => {
    const canvas = canvasRef.current!;
    const { project, startSceneId: activeSceneId } = props;
    loadConsoleFont();
    const images = imageLookup(project);
    const looks = new LookCache(project, componentRegistry);
    // Sounds the game plays (made by the synthesizer from their recipes). Started now: Play was just clicked.
    const sounds = new Map(project.assets.filter((a) => a.kind === 'sound' && a.synth).map((a) => [a.id, a.synth!]));
    if (sounds.size) audio();
    // Play starts at the level being edited; a won level goes on to the next one (in the levels' order).
    let scene = project.scenes.find((s) => s.id === activeSceneId) ?? project.scenes[0];
    // The level's own camera settings decide the zoom (not how far the editor is zoomed).
    let runtime = new Runtime(project, scene.id, componentRegistry);
    // What happens is recorded for the Debug tab and the AI ("why did the player die?").
    let recorder = new PlayRecorder(runtime);
    let hasSwitches = false;
    let canShoot = false;
    let topDown = false;
    const look = () => {
      topDown = runtime.entities.some((e) => e.controller?.movement === 'topdown');
      hasSwitches = runtime.entities.some((e) => e.switch);
      canShoot = runtime.entities.some((e) => e.controller && e.beh.shooter?.trigger === 'key');
    };
    look();
    let shown: Hud = { health: null, items: [], messages: [], hasSwitches, canShoot, topDown, banner: null };
    /** The game is finished: the last level was won (play stops, the banner stays). */
    let finished = false;
    const input = new InputState();
    inputRef.current = input;

    const size = { width: 1, height: 1 };
    /**
     * The canvas has as many pixels as the screen area, or, at a lower play
     * resolution, a whole number of times fewer (so every game pixel is the
     * same size on screen), scaled up with hard edges by CSS. Drawing fewer
     * pixels is what makes play fast on weak graphics chips.
     */
    const measure = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      const target = props.playPixels();
      const shrink = target > 0 ? Math.max(1, Math.round((rect.height * dpr) / target)) : 1;
      size.width = rect.width;
      size.height = rect.height;
      canvas.width = Math.max(1, Math.round((rect.width * dpr) / shrink));
      canvas.height = Math.max(1, Math.round((rect.height * dpr) / shrink));
      canvas.dataset.pixels = `${canvas.width}x${canvas.height}`;
      runtime.cam.setView(rect.width, rect.height);
      runtime.screen = { w: rect.width, h: rect.height };
    };
    // Measured now, so the camera starts inside its limits for this screen; then on every resize.
    measure();
    runtime.cam.snap();
    const ro = new ResizeObserver(measure);
    ro.observe(canvas);

    const onKeyDown = (e: KeyboardEvent) => {
      const action = KEY_BINDINGS[e.code];
      if (action) {
        e.preventDefault();
        input.press(action);
      } else if (e.code === 'KeyR' && !e.ctrlKey && !e.metaKey) {
        runtime.restart();
        finished = false;
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      const action = KEY_BINDINGS[e.code];
      if (action) input.release(action);
    };
    const onBlur = () => input.releaseAll();
    const pads = new GamepadReader();
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    canvas.focus();

    let frame = 0;
    let last = performance.now();
    const loop = (now: number) => {
      frame = requestAnimationFrame(loop);
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      // Game controllers: what they hold now, as the same actions as the keys.
      const pad = pads.read(browserPads());
      input.holdOnly(pad.actions, 'pad');
      canvas.dataset.pads = String(pad.connected);
      if (pad.restart) {
        runtime.restart();
        finished = false;
      }
      if (!finished) {
        runtime.update(dt, input);
        recorder.sample();
      }
      // A won level: a moment to see it, then the next level (or the end of the game).
      let banner: string | null = null;
      if (runtime.completed !== null) {
        const nextScene = project.scenes[project.scenes.findIndex((s) => s.id === scene.id) + 1];
        banner = nextScene ? 'Level complete!' : 'You finished the game!';
        if (nextScene && runtime.time - runtime.completed > 1.5) {
          recorder.stop();
          scene = nextScene;
          runtime = new Runtime(project, scene.id, componentRegistry);
          recorder = new PlayRecorder(runtime);
          look();
          measure();
          runtime.cam.snap();
          banner = null;
        } else if (!nextScene) finished = true;
      }
      canvas.dataset.level = scene.name;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      const dpr = canvas.width / size.width;
      const view = runtime.cam.frame();
      drawBackground(ctx, size, dpr, scene.world, view, images);
      applyCamera(ctx, view, size, dpr);
      // (Animations hold still too once the level is won.)
      drawEntities(ctx, runtime.renderList(), images, 0, runtime.completed ?? runtime.time);
      // What scripts drew: labels in the level, then the screen layer (HUDs, scores) on top.
      const drawings = [...runtime.drawings.values()];
      drawScreenDrawings(ctx, drawings, 'world', size, looks, images, runtime.time);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      drawScreenDrawings(ctx, drawings, 'screen', size, looks, images, runtime.time);
      canvas.dataset.drawings = [...runtime.drawings.keys()].join('|');
      for (const s of runtime.soundQueue.splice(0)) {
        const recipe = sounds.get(s.assetId);
        if (recipe) playRecipe(recipe, { volume: s.volume, pitch: s.pitch });
      }
      canvas.dataset.sounds = String(runtime.soundsPlayed);
      const flash = runtime.cam.flash();
      if (flash) {
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.globalAlpha = flash.alpha;
        ctx.fillStyle = flash.color;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.globalAlpha = 1;
      }
      canvas.dataset.camera = `${runtime.camera.x.toFixed(1)},${runtime.camera.y.toFixed(1)},${runtime.camera.zoom.toFixed(2)}`;
      // Observable play state for tests and debugging.
      const player = runtime.entities.find((e) => e.controller);
      if (player) canvas.dataset.look = runtime.lookOf(player).situation + (runtime.lookOf(player).assetId ? ':image' : '');
      if (player) canvas.dataset.player = `${player.x.toFixed(1)},${player.y.toFixed(1)},${player.grounded ? 1 : 0},${player.climbing ? 1 : 0}`;
      canvas.dataset.events = runtime.eventLog
        .filter((ev) => ev.type !== 'touch_started' && ev.type !== 'touch_ended')
        .map((ev) => `${ev.type}:${ev.subject ?? ''}>${ev.other ?? ''}`)
        .join('|');
      // The HUD only re-renders when what it shows changes.
      const next: Hud = {
        health: player?.health && !runtime.builtinHidden.has('hearts') ? { ...player.health } : null,
        items: player?.inventory && !runtime.builtinHidden.has('items') ? [...player.inventory.entries()] : [],
        messages: runtime.messages,
        hasSwitches,
        canShoot,
        topDown,
        banner,
      };
      if (!sameHud(next, shown)) {
        shown = next;
        setHud(next);
      }
    };
    frame = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(frame);
      const report = recorder.report();
      recorder.stop();
      props.onEnd?.(report, project);
      ro.disconnect();
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
    };
  }, []);

  return (
    <div className="play-view">
      <canvas ref={canvasRef} tabIndex={0} data-testid="play-canvas" />
      <div className="hud" data-testid="hud">
        {hud.health && (
          <span className="hud-chip hud-hearts" data-testid="hud-health" aria-label={`Health ${hud.health.current} of ${hud.health.max}`}>
            {Array.from({ length: Math.min(hud.health.max, 12) }, (_, i) => (
              <span key={i} className={i < hud.health!.current ? '' : 'empty'}>
                ♥
              </span>
            ))}
          </span>
        )}
        {hud.items.map(([item, count]) => (
          <span key={item} className="hud-chip" data-testid="hud-item">
            {item}
            {count > 1 && ` ×${count}`}
          </span>
        ))}
      </div>
      {hud.banner && (
        <div className="hud-banner" data-testid="hud-banner">
          {hud.banner}
        </div>
      )}
      {hud.messages.length > 0 && (
        <div className="hud-message" data-testid="hud-message">
          {hud.messages.at(-1)}
        </div>
      )}
      {props.touchControls && isTouchScreen() && <TouchControls input={inputRef} topDown={hud.topDown} use={hud.hasSwitches} shoot={hud.canShoot} />}
      {props.keyHints !== false && <div className="hud-keys">Arrows move{hud.topDown ? '' : ' · Space jumps'}{hud.hasSwitches ? ' · E uses' : ''}{hud.canShoot ? ' · X shoots' : ''} · R restarts · or a game controller{props.stopHint ? ` · ${props.stopHint}` : ''}</div>}
    </div>
  );
}

/** "Last play (34 s): Player died 2 times, fell out 1 time, 1 script problem." Empty when nothing notable happened. */
export function playSummaryLine(report: PlayReport): string {
  const count = (pred: (e: PlayReport['events'][number]) => boolean) => report.events.filter(pred).length;
  const parts: string[] = [];
  const times = (n: number) => `${n} ${n === 1 ? 'time' : 'times'}`;
  const deaths = count((e) => e.type === 'respawned' && e.detail?.reason === 'died');
  const falls = count((e) => e.type === 'respawned' && e.detail?.reason === 'fell');
  const locked = count((e) => e.type === 'locked');
  if (deaths) parts.push(`the player died ${times(deaths)}`);
  if (falls) parts.push(`fell out of the level ${times(falls)}`);
  if (locked) parts.push(`touched something locked ${times(locked)}`);
  if (report.scriptErrors.length) parts.push(`${report.scriptErrors.length} script ${report.scriptErrors.length === 1 ? 'problem' : 'problems'}`);
  if (!parts.length) return '';
  return `Last play (${Math.round(report.duration)} s): ${parts.join(', ')}.`;
}

/**
 * On-screen buttons for touch screens: arrows on the left (left/right, and up/down for ladders or, seen from
 * above, walking), jump (side view), use and shoot on the right when the game has switches or shooting. Each
 * button is held while a finger is on it; several fingers work at once (run and jump).
 */
function TouchControls({ input, topDown, use, shoot }: { input: React.RefObject<InputState | null>; topDown: boolean; use: boolean; shoot: boolean }) {
  const button = (action: Action, label: string, className: string) => (
    <button
      key={action}
      className={`touch-btn ${className}`}
      data-testid={`touch-${action}`}
      aria-label={action}
      onPointerDown={(e) => {
        e.preventDefault();
        input.current?.press(action);
        // Kept until the finger lifts, even if it slides off the button (when the browser allows it).
        try {
          e.currentTarget.setPointerCapture(e.pointerId);
        } catch {
          // No such pointer (a synthetic event): the button still works.
        }
      }}
      onPointerUp={() => input.current?.release(action)}
      onPointerCancel={() => input.current?.release(action)}
      onLostPointerCapture={() => input.current?.release(action)}
      onContextMenu={(e) => e.preventDefault()}
    >
      {label}
    </button>
  );
  return (
    <div className="touch-controls" data-testid="touch-controls">
      <div className="touch-pad">
        {button('up', '▲', 'up')}
        {button('left', '◀', 'left')}
        {button('right', '▶', 'right')}
        {button('down', '▼', 'down')}
      </div>
      <div className="touch-actions">
        {shoot && button('fire', 'X', 'small')}
        {use && button('interact', 'E', 'small')}
        {!topDown && button('jump', 'Jump', 'big')}
      </div>
    </div>
  );
}
