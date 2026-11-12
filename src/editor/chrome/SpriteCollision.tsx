import { useEffect, useRef } from 'react';
import { componentRegistry } from '../../core/components/builtin';
import type { Box } from '../../core/components/schema';
import { boxesFromPixels } from '../../core/model/colliderBoxes';
import { setDefinitionComponentField } from '../../core/model/mutations';
import type { SpriteDraft } from '../../core/model/spriteDraft';
import type { ObjectDefinition } from '../../core/types';
import { useEditor } from '../store';

/**
 * The sprite editor's collision mode: what the object collides with, drawn over its picture and changed there.
 * Box: one box, dragged out. Shape: several boxes, each dragged out (right-click takes one away). Pixel-perfect:
 * boxes covering exactly the picture's pixels, worked out again whenever the picture changes. Each change is one
 * Undo step on the object (all its copies), saved at once (not with the picture).
 */
export type CollisionMode = 'box' | 'shape' | 'pixels';

export function collisionModeOf(def: ObjectDefinition): CollisionMode {
  const col = def.components.Collider;
  if (col?.shape === 'boxes') return col.fromPixels === true ? 'pixels' : 'shape';
  return 'box';
}

/** The object's collision as boxes in its own pixels (from its sprite's top-left corner). */
export function collisionBoxes(def: ObjectDefinition): Box[] {
  const col = def.components.Collider;
  const sw = Number(def.components.Sprite?.width) || 32;
  const sh = Number(def.components.Sprite?.height) || 32;
  if (!col) return [];
  if (col.shape === 'boxes') return Array.isArray(col.boxes) ? (col.boxes as Box[]) : [];
  const size = (col.size as { x: number; y: number }) ?? { x: sw, y: sh };
  const off = (col.offset as { x: number; y: number }) ?? { x: 0, y: 0 };
  const h = col.shape === 'circle' ? size.x : size.y;
  return [{ x: sw / 2 + off.x - size.x / 2, y: sh / 2 + off.y - h / 2, w: size.x, h }];
}

function edit(def: ObjectDefinition, label: string, fields: Record<string, unknown>): void {
  useEditor.getState().edit(label, (p) => {
    for (const [f, v] of Object.entries(fields)) setDefinitionComponentField(p, def.id, 'Collider', f, v, componentRegistry);
  });
}

/** Sets the mode: Box keeps (or makes) one box, Shape starts from the box there is, Pixel-perfect works the boxes out. */
export function setCollisionMode(def: ObjectDefinition, mode: CollisionMode, pixels: readonly string[]): void {
  const sw = Number(def.components.Sprite?.width) || 32;
  const sh = Number(def.components.Sprite?.height) || 32;
  const now = collisionBoxes(def);
  if (mode === 'pixels') {
    edit(def, 'Collision: pixel-perfect', { shape: 'boxes', fromPixels: true, matchSprite: false, boxes: boxesFromPixels(pixels, sw, sh) });
  } else if (mode === 'shape') {
    edit(def, 'Collision: shape', { shape: 'boxes', fromPixels: false, matchSprite: false, boxes: now.length ? now : [{ x: 0, y: 0, w: sw, h: sh }] });
  } else {
    // (The box round what there was.)
    const l = now.length ? Math.min(...now.map((b) => b.x)) : 0;
    const t = now.length ? Math.min(...now.map((b) => b.y)) : 0;
    const r = now.length ? Math.max(...now.map((b) => b.x + b.w)) : sw;
    const bt = now.length ? Math.max(...now.map((b) => b.y + b.h)) : sh;
    edit(def, 'Collision: box', { shape: 'box', fromPixels: false, boxes: [], matchSprite: false, size: { x: r - l, y: bt - t }, offset: { x: (l + r) / 2 - sw / 2, y: (t + bt) / 2 - sh / 2 } });
  }
}

export function CollisionBar({ def, draft, frame }: { def: ObjectDefinition; draft: SpriteDraft; frame: number }) {
  const mode = collisionModeOf(def);
  const boxes = collisionBoxes(def);
  const modes: { mode: CollisionMode; label: string; tip: string }[] = [
    { mode: 'box', label: 'Box', tip: 'One box: drag it out over the picture' },
    { mode: 'shape', label: 'Shape', tip: 'Several boxes: drag out each one; right-click a box to take it away' },
    { mode: 'pixels', label: 'Pixel-perfect', tip: 'Boxes covering exactly the picture’s pixels, worked out again whenever the picture changes' },
  ];
  return (
    <div className="se-collision-bar" data-testid="se-collision-bar">
      <span className="se-seg" role="radiogroup" aria-label="Collision">
        {modes.map((m) => (
          <button key={m.mode} role="radio" aria-checked={mode === m.mode} className={mode === m.mode ? 'on' : ''} data-testid={`se-col-${m.mode}`} title={m.tip} onClick={() => setCollisionMode(def, m.mode, draft.frames[frame] ?? draft.frames[0])}>
            {m.label}
          </button>
        ))}
      </span>
      <span className="muted small" data-testid="se-col-count">
        {mode === 'box' ? 'Drag out the box it collides with.' : mode === 'shape' ? `${boxes.length} box${boxes.length === 1 ? '' : 'es'} · drag out another; right-click one to take it away.` : `${boxes.length} box${boxes.length === 1 ? '' : 'es'} covering its pixels.`}
        {def.components.PhysicsBody?.bodyType === 'dynamic' && mode !== 'box' ? ' It moves as the box round them all (walls and floors); touching counts each box.' : ''}
      </span>
      {mode === 'shape' && boxes.length > 0 && (
        <button className="chip-btn" data-testid="se-col-clear" onClick={() => edit(def, 'Collision: clear the boxes', { boxes: [] })}>
          Clear
        </button>
      )}
    </div>
  );
}

/** Over the picture: the collision boxes, and (Box, Shape) dragging out a box. */
export function CollisionOverlay({ def, draft }: { def: ObjectDefinition; draft: SpriteDraft }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const dragRef = useRef<{ from: { x: number; y: number }; to: { x: number; y: number } } | null>(null);
  const mode = collisionModeOf(def);
  const boxes = collisionBoxes(def);
  const sw = Number(def.components.Sprite?.width) || 32;
  const sh = Number(def.components.Sprite?.height) || 32;
  // Picture pixels to the object's pixels.
  const kx = sw / draft.width;
  const ky = sh / draft.height;
  const S = 8;

  const draw = () => {
    const c = ref.current;
    if (!c) return;
    c.width = draft.width * S;
    c.height = draft.height * S;
    const g = c.getContext('2d')!;
    g.clearRect(0, 0, c.width, c.height);
    const shown = [...boxes];
    const d = dragRef.current;
    const live = d ? rectOf(d.from, d.to) : null;
    if (live && mode === 'box') shown.length = 0;
    for (const b of shown) {
      g.fillStyle = 'rgba(255, 80, 80, 0.28)';
      g.strokeStyle = 'rgba(255, 110, 110, 0.95)';
      g.lineWidth = 2;
      g.fillRect((b.x / kx) * S, (b.y / ky) * S, (b.w / kx) * S, (b.h / ky) * S);
      g.strokeRect((b.x / kx) * S + 1, (b.y / ky) * S + 1, (b.w / kx) * S - 2, (b.h / ky) * S - 2);
    }
    if (live) {
      g.fillStyle = 'rgba(255, 214, 102, 0.3)';
      g.strokeStyle = '#ffd666';
      g.lineWidth = 2;
      g.fillRect(live.x * S, live.y * S, live.w * S, live.h * S);
      g.strokeRect(live.x * S + 1, live.y * S + 1, live.w * S - 2, live.h * S - 2);
    }
  };
  useEffect(draw);

  const pixelAt = (e: React.PointerEvent) => {
    const r = ref.current!.getBoundingClientRect();
    return { x: Math.max(0, Math.min(draft.width - 1, Math.floor(((e.clientX - r.left) / r.width) * draft.width))), y: Math.max(0, Math.min(draft.height - 1, Math.floor(((e.clientY - r.top) / r.height) * draft.height))) };
  };
  const rectOf = (a: { x: number; y: number }, b: { x: number; y: number }) => ({ x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x) + 1, h: Math.abs(a.y - b.y) + 1 });
  const toObject = (r: { x: number; y: number; w: number; h: number }): Box => ({ x: r.x * kx, y: r.y * ky, w: r.w * kx, h: r.h * ky });

  const down = (e: React.PointerEvent) => {
    e.preventDefault();
    if (mode === 'pixels') return;
    const p = pixelAt(e);
    if (e.button === 2) {
      // Right-click: the box under it goes (Shape).
      if (mode !== 'shape') return;
      const ox = (p.x + 0.5) * kx;
      const oy = (p.y + 0.5) * ky;
      const i = boxes.findIndex((b) => ox >= b.x && ox <= b.x + b.w && oy >= b.y && oy <= b.y + b.h);
      if (i >= 0) edit(def, 'Collision: take a box away', { boxes: boxes.filter((_, j) => j !== i) });
      return;
    }
    (e.target as Element).setPointerCapture(e.pointerId);
    dragRef.current = { from: p, to: p };
    draw();
  };
  const move = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    d.to = pixelAt(e);
    draw();
  };
  const up = () => {
    const d = dragRef.current;
    dragRef.current = null;
    if (!d) return;
    const b = toObject(rectOf(d.from, d.to));
    if (mode === 'shape') edit(def, 'Collision: add a box', { boxes: [...boxes, b] });
    else edit(def, 'Collision: box', { shape: 'box', matchSprite: false, size: { x: b.w, y: b.h }, offset: { x: b.x + b.w / 2 - sw / 2, y: b.y + b.h / 2 - sh / 2 } });
  };

  return (
    <canvas
      ref={ref}
      className="se-collision-layer"
      data-testid="se-collision-layer"
      data-boxes={boxes.map((b) => `${Math.round(b.x)},${Math.round(b.y)},${Math.round(b.w)},${Math.round(b.h)}`).join(' ')}
      style={{ cursor: mode === 'pixels' ? 'default' : 'crosshair' }}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={up}
      onContextMenu={(e) => e.preventDefault()}
    />
  );
}
