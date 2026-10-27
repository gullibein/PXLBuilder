import { useState } from 'react';
import { getActiveScene, useEditor } from '../store';
import { canAutotile, editSpriteOf, Thumb } from './Dock';

/**
 * A small card at the top right for the object being worked with: the one selected in the level, or else the one
 * last picked in the Objects menu. Its picture and name, Edit sprite, Autotile… (for grid objects) and Details…
 * (the full details). Hidden while the details are open; × hides it until something else is selected or picked.
 */
export function ObjectCard() {
  const scene = useEditor(getActiveScene);
  const definitions = useEditor((s) => s.project.definitions);
  const selected = useEditor((s) => s.selectedEntityIds);
  const picked = useEditor((s) => s.pickedDefinitionId);
  const inspectorOpen = useEditor((s) => s.inspectorOpen);
  const docked = useEditor((s) => s.layout.inspector === 'docked');
  const [dismissed, setDismissed] = useState<string | null>(null);
  // What it is about: one selected thing in the level (its object), or the object picked from the menu.
  const entity = selected.length === 1 ? scene.entities.find((e) => e.id === selected[0]) : undefined;
  const defId = selected.length === 1 ? (entity?.definitionId ?? null) : selected.length === 0 ? picked : null;
  const def = defId ? definitions.find((d) => d.id === defId) : undefined;
  const key = entity ? `entity:${entity.id}` : def ? `object:${def.id}` : null;
  if (!def || !key || dismissed === key || (inspectorOpen && !docked)) return null;
  const details = () => {
    const s = useEditor.getState();
    // A thing in the level: its own details (it stays selected); a picked object: the object's.
    if (!entity) s.selectDefinition(def.id);
    s.setInspectorOpen(true);
  };
  return (
    <aside className="object-card" data-testid="object-card" data-about={entity ? 'entity' : 'object'} aria-label={`${def.name}`}>
      <button className="icon-btn object-card-close" aria-label="Close" title="Close" data-testid="object-card-close" onClick={() => setDismissed(key)}>
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
          <path d="M2 2l6 6M8 2 2 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      </button>
      <div className="object-card-head">
        <Thumb def={def} size={40} />
        <span className="object-card-name" data-testid="object-card-name">
          {entity && entity.name !== def.name ? entity.name : def.name}
        </span>
      </div>
      <button className="chip-btn" data-testid="object-card-edit-sprite" onClick={() => editSpriteOf(def.id)}>
        Edit sprite
      </button>
      {canAutotile(def) && (
        <button className={`chip-btn${def.components.Sprite?.autotile === true ? ' on' : ''}`} data-testid="object-card-autotile" onClick={() => useEditor.getState().setAutotileEditor(def.id)}>
          Autotile…
        </button>
      )}
      <button className="chip-btn" data-testid="object-card-details" onClick={details}>
        Details…
      </button>
    </aside>
  );
}
