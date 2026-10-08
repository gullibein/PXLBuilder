import { useEffect, useRef, useState } from 'react';
import { componentRegistry } from '../../core/components/builtin';
import { applyCamera, drawBackground, drawEntities } from '../../render/renderer';
import { drawScreenDrawings, LookCache } from '../../render/screen';
import { audio, playRecipe } from '../audio/synth';
import { InputState, KEY_BINDINGS } from '../../runtime/input';
import { PlayRecorder } from '../../runtime/recorder';
import { Runtime } from '../../runtime/runtime';
import { imageLookup } from '../images';
import type { PlayReport } from '../../core/debug/playReport';
import { useEditor } from '../store';

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
  /** "Level complete!" while moving on, or "You finished the game!" after the last level. */
  banner: string | null;
}

const sameHud = (a: Hud, b: Hud) => JSON.stringify(a) === JSON.stringify(b);

export function PlayView() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [hud, setHud] = useState<Hud>({ health: null, items: [], messages: [], hasSwitches: false, canShoot: false, banner: null });

  useEffect(() => {
    const canvas = canvasRef.current!;
    const { project, activeSceneId } = useEditor.getState();
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
    const look = () => {
      hasSwitches = runtime.entities.some((e) => e.switch);
      canShoot = runtime.entities.some((e) => e.controller && e.beh.shooter?.trigger === 'key');
    };
    look();
    let shown: Hud = { health: null, items: [], messages: [], hasSwitches, canShoot, banner: null };
    /** The game is finished: the last level was won (play stops, the banner stays). */
    let finished = false;
    const input = new InputState();

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
      const target = useEditor.getState().layout.playPixels;
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
      drawEntities(ctx, runtime.renderList(), images);
      // What scripts drew: labels in the level, then the screen layer (HUDs, scores) on top.
      const drawings = [...runtime.drawings.values()];
      drawScreenDrawings(ctx, drawings, 'world', size, looks, images);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      drawScreenDrawings(ctx, drawings, 'screen', size, looks, images);
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
      const { setLastPlay, logMessage } = useEditor.getState();
      setLastPlay(report, project);
      const summary = playSummaryLine(report);
      if (summary) logMessage(report.scriptErrors.length ? 'warn' : 'info', `${summary} Open Debug to see what happened, or ask the AI why.`);
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
      <div className="hud-keys">Arrows move · Space jumps{hud.hasSwitches ? ' · E uses' : ''}{hud.canShoot ? ' · X shoots' : ''} · R restarts · Esc stops</div>
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
