import { useEffect, useRef, useState } from 'react';
import { componentRegistry } from '../../core/components/builtin';
import { applyCamera, drawBackground, drawEntities } from '../../render/renderer';
import { InputState, KEY_BINDINGS } from '../../runtime/input';
import { Runtime } from '../../runtime/runtime';
import { imageLookup } from '../images';
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
}

const sameHud = (a: Hud, b: Hud) => JSON.stringify(a) === JSON.stringify(b);

export function PlayView() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [hud, setHud] = useState<Hud>({ health: null, items: [], messages: [], hasSwitches: false });

  useEffect(() => {
    const canvas = canvasRef.current!;
    const { project, activeSceneId, camera } = useEditor.getState();
    const images = imageLookup(project);
    const zoom = Math.min(3, Math.max(0.75, camera.zoom));
    const runtime = new Runtime(project, activeSceneId, componentRegistry, { zoom });
    const hasSwitches = runtime.entities.some((e) => e.switch);
    let shown: Hud = { health: null, items: [], messages: [], hasSwitches };
    const input = new InputState();
    const scene = project.scenes.find((s) => s.id === activeSceneId) ?? project.scenes[0];

    const size = { width: 1, height: 1 };
    const ro = new ResizeObserver(() => {
      const rect = canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      size.width = rect.width;
      size.height = rect.height;
      canvas.width = Math.max(1, Math.round(rect.width * dpr));
      canvas.height = Math.max(1, Math.round(rect.height * dpr));
    });
    ro.observe(canvas);

    const onKeyDown = (e: KeyboardEvent) => {
      const action = KEY_BINDINGS[e.code];
      if (action) {
        e.preventDefault();
        input.press(action);
      } else if (e.code === 'KeyR' && !e.ctrlKey && !e.metaKey) {
        runtime.restart();
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
      runtime.update(dt, input);
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      const dpr = canvas.width / size.width;
      drawBackground(ctx, size, dpr, scene.world, runtime.camera, images);
      applyCamera(ctx, runtime.camera, size, dpr);
      drawEntities(ctx, runtime.renderList(), images);
      // Observable play state for tests and debugging.
      const player = runtime.entities.find((e) => e.controller);
      if (player) canvas.dataset.player = `${player.x.toFixed(1)},${player.y.toFixed(1)},${player.grounded ? 1 : 0},${player.climbing ? 1 : 0}`;
      canvas.dataset.events = runtime.eventLog
        .filter((ev) => ev.type !== 'touch_started' && ev.type !== 'touch_ended')
        .map((ev) => `${ev.type}:${ev.subject ?? ''}>${ev.other ?? ''}`)
        .join('|');
      // The HUD only re-renders when what it shows changes.
      const next: Hud = {
        health: player?.health ? { ...player.health } : null,
        items: player?.inventory ? [...player.inventory.entries()] : [],
        messages: runtime.messages,
        hasSwitches,
      };
      if (!sameHud(next, shown)) {
        shown = next;
        setHud(next);
      }
    };
    frame = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(frame);
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
      {hud.messages.length > 0 && (
        <div className="hud-message" data-testid="hud-message">
          {hud.messages.at(-1)}
        </div>
      )}
      <div className="hud-keys">Arrows move · Space jumps{hud.hasSwitches ? ' · E uses' : ''} · R restarts · Esc stops</div>
    </div>
  );
}
