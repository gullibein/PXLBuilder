import { useState } from 'react';
import { componentRegistry } from '../../core/components/builtin';
import { createDefinition, createScene } from '../../core/model/factory';
import { addDefinition, addScene, removeScene, renameScene } from '../../core/model/mutations';
import { DEFINITION_DRAG_TYPE, placeDefinition } from '../viewport/Viewport';
import { getActiveScene, useEditor } from '../store';
import { TextInput } from './FieldEditor';

/** Left column: scenes, object library and the active scene's entity outline. */
export function LibraryPanel() {
  return (
    <div className="panel library">
      <ScenesSection />
      <ObjectsSection />
      <OutlineSection />
    </div>
  );
}

function ScenesSection() {
  const scenes = useEditor((s) => s.project.scenes);
  const startSceneId = useEditor((s) => s.project.startSceneId);
  const activeSceneId = useEditor((s) => s.activeSceneId);
  const setActiveScene = useEditor((s) => s.setActiveScene);
  const edit = useEditor((s) => s.edit);
  const [renaming, setRenaming] = useState<string | null>(null);

  const add = () => {
    const scene = createScene(`Level ${scenes.length + 1}`);
    if (edit('Add scene', (p) => addScene(p, scene))) setActiveScene(scene.id);
  };

  return (
    <div className="lib-section">
      <div className="panel-title">
        Scenes
        <button className="icon-btn" title="Add scene" data-testid="add-scene" onClick={add}>
          +
        </button>
      </div>
      <ul className="item-list" data-testid="scene-list">
        {scenes.map((s) => (
          <li key={s.id} className={s.id === activeSceneId ? 'active' : ''} onClick={() => setActiveScene(s.id)} onDoubleClick={() => setRenaming(s.id)}>
            {renaming === s.id ? (
              <TextInput
                value={s.name}
                onCommit={(name) => {
                  edit('Rename scene', (p) => renameScene(p, s.id, name));
                  setRenaming(null);
                }}
              />
            ) : (
              <span className="grow">
                {s.name}
                {s.id === startSceneId && <span className="badge" title="Start scene">start</span>}
              </span>
            )}
            {scenes.length > 1 && (
              <button
                className="icon-btn hover-only"
                title="Delete scene"
                onClick={(e) => {
                  e.stopPropagation();
                  if (confirm(`Delete scene "${s.name}" and everything in it?`)) edit('Delete scene', (p) => removeScene(p, s.id));
                }}
              >
                ✕
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function ObjectsSection() {
  const definitions = useEditor((s) => s.project.definitions);
  const selectedDefinitionId = useEditor((s) => s.selectedDefinitionId);
  const selectDefinition = useEditor((s) => s.selectDefinition);
  const camera = useEditor((s) => s.camera);
  const edit = useEditor((s) => s.edit);

  const createNew = () => {
    const def = createDefinition('New Object', { Sprite: componentRegistry.createDefault('Sprite') });
    if (edit('New object', (p) => addDefinition(p, def, componentRegistry))) selectDefinition(def.id);
  };

  return (
    <div className="lib-section">
      <div className="panel-title">Object Library</div>
      <ul className="item-list" data-testid="object-library">
        {definitions.map((d) => {
          const color = typeof d.components.Sprite?.color === 'string' ? d.components.Sprite.color : '#888';
          return (
            <li
              key={d.id}
              draggable
              data-testid={`definition-${d.name}`}
              className={d.id === selectedDefinitionId ? 'active' : ''}
              title={`${d.description}\nDrag into the viewport to place, double-click to place at view center`}
              onDragStart={(e) => {
                e.dataTransfer.setData(DEFINITION_DRAG_TYPE, d.id);
                e.dataTransfer.effectAllowed = 'copy';
              }}
              onClick={() => selectDefinition(d.id)}
              onDoubleClick={() => placeDefinition(d.id, { x: camera.x, y: camera.y })}
            >
              <span className="swatch" style={{ background: color }} />
              <span className="grow">{d.name}</span>
            </li>
          );
        })}
      </ul>
      <button className="new-object" data-testid="new-object" onClick={createNew}>
        + New Object
      </button>
    </div>
  );
}

function OutlineSection() {
  const scene = useEditor(getActiveScene);
  const selected = useEditor((s) => s.selectedEntityIds);
  const selectEntities = useEditor((s) => s.selectEntities);
  return (
    <div className="lib-section grow-section">
      <div className="panel-title">Scene Outline</div>
      <ul className="item-list" data-testid="outline">
        {scene.entities.length === 0 && <li className="muted static">Drag objects from the library into the viewport.</li>}
        {scene.entities.map((e) => (
          <li
            key={e.id}
            className={selected.includes(e.id) ? 'active' : ''}
            onClick={(ev) => {
              if (ev.shiftKey || ev.ctrlKey || ev.metaKey) {
                selectEntities(selected.includes(e.id) ? selected.filter((id) => id !== e.id) : [...selected, e.id]);
              } else {
                selectEntities([e.id]);
              }
            }}
          >
            <span className="grow">{e.name}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
