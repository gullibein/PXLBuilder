import { useState } from 'react';
import type { ObjectDefinition } from '../../core/types';
import { CATEGORIES, categoryOf } from '../categories';
import { PromptBox } from '../prompt/PromptBox';
import { getActiveScene, useEditor } from '../store';
import { DEFINITION_DRAG_TYPE, placeDefinition } from '../viewport/Viewport';

/** Bottom dock: Create (with AI) and the object library. Both open as popovers above the dock. */
export function Dock() {
  const dock = useEditor((s) => s.dock);
  const setDock = useEditor((s) => s.setDock);
  return (
    <div className="dock-wrap">
      {dock === 'create' && <CreatePanel />}
      {dock === 'library' && <LibraryPanel />}
      <nav className="dock" aria-label="Create and library">
        <button className={`dock-btn primary${dock === 'create' ? ' on' : ''}`} data-testid="dock-create" onClick={() => setDock(dock === 'create' ? null : 'create')}>
          <span aria-hidden="true">+</span> Create
        </button>
        <button className={`dock-btn${dock === 'library' ? ' on' : ''}`} data-testid="dock-library" onClick={() => setDock(dock === 'library' ? null : 'library')}>
          <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
            <rect x="1.5" y="1.5" width="4.5" height="4.5" rx="1" fill="none" stroke="currentColor" strokeWidth="1.3" />
            <rect x="8" y="1.5" width="4.5" height="4.5" rx="1" fill="none" stroke="currentColor" strokeWidth="1.3" />
            <rect x="1.5" y="8" width="4.5" height="4.5" rx="1" fill="none" stroke="currentColor" strokeWidth="1.3" />
            <rect x="8" y="8" width="4.5" height="4.5" rx="1" fill="none" stroke="currentColor" strokeWidth="1.3" />
          </svg>
          Library
        </button>
      </nav>
    </div>
  );
}

/** A small preview of an object: its placeholder sprite, to scale within the tile. */
function Thumb({ def }: { def: ObjectDefinition }) {
  const sprite = def.components.Sprite ?? {};
  const w = typeof sprite.width === 'number' ? sprite.width : 32;
  const h = typeof sprite.height === 'number' ? sprite.height : 32;
  const k = 34 / Math.max(w, h, 1);
  const circle = def.components.Collider?.shape === 'circle';
  return (
    <span className="thumb" aria-hidden="true">
      <span
        style={{
          width: Math.max(4, w * k),
          height: Math.max(4, h * k),
          background: typeof sprite.color === 'string' ? sprite.color : '#888',
          borderRadius: circle ? '50%' : 3,
        }}
      />
    </span>
  );
}

function ObjectTile({ def }: { def: ObjectDefinition }) {
  const camera = useEditor((s) => s.camera);
  const { selectDefinition, setInspectorOpen, setDock } = useEditor.getState();
  return (
    <button
      className="tile"
      draggable
      data-testid={`definition-${def.name}`}
      title={`${def.description || def.name}\nDrag into the level · double-click to place in the middle`}
      onDragStart={(e) => {
        e.dataTransfer.setData(DEFINITION_DRAG_TYPE, def.id);
        e.dataTransfer.effectAllowed = 'copy';
      }}
      onDoubleClick={() => {
        placeDefinition(def.id, { x: camera.x, y: camera.y });
        setDock(null);
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

function LibraryPanel() {
  const definitions = useEditor((s) => s.project.definitions);
  const [category, setCategory] = useState<string>('All');
  const present = CATEGORIES.filter((c) => definitions.some((d) => categoryOf(d) === c));
  const shown = category === 'All' ? definitions : definitions.filter((d) => categoryOf(d) === category);
  return (
    <section className="dock-panel library" data-testid="library-panel" aria-label="Object library">
      <div className="chips" role="tablist">
        {['All', ...present].map((c) => (
          <button key={c} role="tab" aria-selected={category === c} className={`chip${category === c ? ' on' : ''}`} onClick={() => setCategory(c)}>
            {c}
          </button>
        ))}
      </div>
      <div className="tiles" data-testid="object-library">
        {shown.map((d) => (
          <ObjectTile key={d.id} def={d} />
        ))}
      </div>
      <p className="panel-hint">Drag an object into your level. Right-click one to see its details.</p>
    </section>
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
              <span className="panel-hint">Drag into your level</span>
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
