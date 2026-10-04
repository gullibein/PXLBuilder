import { useState } from 'react';
import type { ObjectDefinition } from '../../core/types';
import { CATEGORIES, categoryOf } from '../categories';
import { PromptBox } from '../prompt/PromptBox';
import { getActiveScene, useEditor } from '../store';
import { DEFINITION_DRAG_TYPE } from '../viewport/Viewport';

/**
 * Bottom dock: Create (describe a new object) and Objects (the library).
 * Clicking an object picks it up as a brush to draw onto the level.
 */
export function Dock() {
  const dock = useEditor((s) => s.dock);
  const setDock = useEditor((s) => s.setDock);
  return (
    <div className="dock-wrap">
      {dock === 'create' && <CreatePanel />}
      {dock === 'library' && <ObjectsPanel />}
      <BrushChip />
      <nav className="dock" aria-label="Create and objects">
        <button className={`dock-btn primary${dock === 'create' ? ' on' : ''}`} data-testid="dock-create" onClick={() => setDock(dock === 'create' ? null : 'create')}>
          <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
            <path d="M7 2v10M2 7h10" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
          Create
        </button>
        <button className={`dock-btn${dock === 'library' ? ' on' : ''}`} data-testid="dock-library" onClick={() => setDock(dock === 'library' ? null : 'library')}>
          <svg width="15" height="15" viewBox="0 0 16 16" aria-hidden="true">
            <path d="M8 1.8 13.5 5v6L8 14.2 2.5 11V5z M2.5 5 8 8.2 13.5 5 M8 8.2v6" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
          </svg>
          Objects
        </button>
      </nav>
    </div>
  );
}

/** A small preview of an object: its placeholder sprite, to scale within the tile. */
export function Thumb({ def, size = 34 }: { def: ObjectDefinition; size?: number }) {
  const sprite = def.components.Sprite ?? {};
  const w = typeof sprite.width === 'number' ? sprite.width : 32;
  const h = typeof sprite.height === 'number' ? sprite.height : 32;
  const k = size / Math.max(w, h, 1);
  const circle = def.components.Collider?.shape === 'circle';
  const color = typeof sprite.color === 'string' ? sprite.color : '#888';
  const tile = def.metadata.placement === 'tile';
  return (
    <span className="thumb" aria-hidden="true">
      <span
        style={{
          width: Math.max(4, w * k),
          height: Math.max(4, h * k),
          background: tile ? `linear-gradient(${color} 0 0) bottom / 100% 78% no-repeat, color-mix(in srgb, ${color}, white 35%)` : color,
          borderRadius: circle ? '50%' : 3,
        }}
      />
    </span>
  );
}

function ObjectTile({ def, armOnClick = true }: { def: ObjectDefinition; armOnClick?: boolean }) {
  const tool = useEditor((s) => s.tool);
  const armed = tool.kind === 'brush' && tool.definitionId === def.id;
  const { setTool, setDock, selectDefinition, setInspectorOpen } = useEditor.getState();
  return (
    <button
      className={`tile${armed ? ' armed' : ''}`}
      draggable
      aria-pressed={armed}
      data-testid={`definition-${def.name}`}
      title={`${def.description || def.name}\nClick to draw it onto the level, or drag it in. Right-click for details.`}
      onClick={() => {
        if (!armOnClick) return;
        if (armed) setTool({ kind: 'select' });
        else {
          setTool({ kind: 'brush', definitionId: def.id });
          setDock(null);
        }
      }}
      onDragStart={(e) => {
        e.dataTransfer.setData(DEFINITION_DRAG_TYPE, def.id);
        e.dataTransfer.effectAllowed = 'copy';
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        selectDefinition(def.id);
        setInspectorOpen(true);
      }}
    >
      <Thumb def={def} />
      <span className="tile-name">{def.name}</span>
    </button>
  );
}

function ObjectsPanel() {
  const definitions = useEditor((s) => s.project.definitions);
  const [category, setCategory] = useState<string>('All');
  const present = CATEGORIES.filter((c) => definitions.some((d) => categoryOf(d) === c));
  const shown = category === 'All' ? definitions : definitions.filter((d) => categoryOf(d) === category);
  return (
    <section className="dock-panel objects" data-testid="library-panel" aria-label="Objects">
      <nav className="category-list" role="tablist" aria-label="Categories">
        {['All', ...present].map((c) => (
          <button key={c} role="tab" aria-selected={category === c} className={`category${category === c ? ' on' : ''}`} onClick={() => setCategory(c)}>
            {c}
            <span className="n">{c === 'All' ? definitions.length : definitions.filter((d) => categoryOf(d) === c).length}</span>
          </button>
        ))}
      </nav>
      <div className="objects-main">
        <div className="tiles" data-testid="object-library">
          {shown.map((d) => (
            <ObjectTile key={d.id} def={d} />
          ))}
        </div>
        <p className="panel-hint">Click an object to draw with it. Drag across the level to draw a row.</p>
      </div>
    </section>
  );
}

/** Shows what you're drawing with while the brush is active, and how to stop. */
function BrushChip() {
  const tool = useEditor((s) => s.tool);
  const def = useEditor((s) => (s.tool.kind === 'brush' ? s.project.definitions.find((d) => d.id === (s.tool as { definitionId: string }).definitionId) : undefined));
  const setTool = useEditor((s) => s.setTool);
  if (tool.kind !== 'brush' || !def) return null;
  return (
    <div className="brush-chip" data-testid="brush-chip">
      <Thumb def={def} size={18} />
      <span>
        Drawing <strong>{def.name}</strong>
      </span>
      <span className="brush-help">drag for a row · Shift keeps it straight · right-drag erases</span>
      <button className="text-btn" data-testid="brush-done" onClick={() => setTool({ kind: 'select' })}>
        Done <kbd>Esc</kbd>
      </button>
    </div>
  );
}

function CreatePanel() {
  const scene = useEditor(getActiveScene);
  const definitions = useEditor((s) => s.project.definitions);
  return (
    <section className="dock-panel create" data-testid="create-panel" aria-label="Create an object">
      <PromptBox
        ctx={{ kind: 'create', sceneId: scene.id }}
        autoFocus
        placeholder="A flying robot that shoots lasers…"
        testId="create-prompt"
        onEscape={() => useEditor.getState().setDock(null)}
        renderApplied={(outcome) => {
          const created = definitions.filter((d) => outcome.result.createdDefinitionIds.includes(d.id));
          if (!created.length) return null;
          return (
            <div className="created">
              <span className="panel-hint">Click to draw it, or drag it into your level</span>
              <div className="tiles">
                {created.map((d) => (
                  <ObjectTile key={d.id} def={d} />
                ))}
              </div>
            </div>
          );
        }}
      />
    </section>
  );
}
