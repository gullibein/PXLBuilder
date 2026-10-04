import { componentRegistry } from '../../core/components/builtin';
import * as m from '../../core/model/mutations';
import { resolveEntity } from '../../core/model/resolve';
import type { ComponentMap, Id, ObjectDefinition, Scene } from '../../core/types';
import { CATEGORIES, categoryOf } from '../categories';
import { getActiveScene, useEditor } from '../store';
import { FieldEditor, ListInput, NumberInput, TextInput, Vec2Input } from './FieldEditor';

export function Inspector() {
  const project = useEditor((s) => s.project);
  const scene = useEditor(getActiveScene);
  const selectedIds = useEditor((s) => s.selectedEntityIds);
  const selectedDefinitionId = useEditor((s) => s.selectedDefinitionId);

  let body;
  if (selectedIds.length === 1) {
    body = <EntityInspector scene={scene} entityId={selectedIds[0]} />;
  } else if (selectedIds.length > 1) {
    body = <MultiInspector scene={scene} ids={selectedIds} />;
  } else if (selectedDefinitionId) {
    const def = project.definitions.find((d) => d.id === selectedDefinitionId);
    body = def ? <DefinitionInspector def={def} /> : null;
  } else {
    body = <SceneInspector scene={scene} />;
  }
  const setInspectorOpen = useEditor((s) => s.setInspectorOpen);
  return (
    <aside className="drawer" data-testid="inspector" aria-label="Details">
      <header className="drawer-head">
        <span className="drawer-title">Details</span>
        <button className="icon-btn" aria-label="Close details" data-testid="close-details" onClick={() => setInspectorOpen(false)}>
          <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
            <path d="m3.5 3.5 7 7m0-7-7 7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </button>
      </header>
      <div className="drawer-body">{body}</div>
    </aside>
  );
}

function Row(props: { label: string; children: React.ReactNode; overridden?: boolean; onRevert?: () => void; hint?: string }) {
  return (
    <div className={`row${props.overridden ? ' overridden' : ''}`} title={props.hint}>
      <span className="row-label">
        {props.overridden && <span className="override-dot" title="Overrides the object definition" />}
        {props.label}
      </span>
      <span className="row-value">
        {props.children}
        {props.onRevert && (
          <button className="icon-btn" title="Revert to definition value" onClick={props.onRevert}>
            ↺
          </button>
        )}
      </span>
    </div>
  );
}

function Section(props: { title: string; children: React.ReactNode; actions?: React.ReactNode; testId?: string }) {
  return (
    <section className="section" data-testid={props.testId}>
      <header>
        <span>{props.title}</span>
        <span className="section-actions">{props.actions}</span>
      </header>
      <div className="section-body">{props.children}</div>
    </section>
  );
}

/** Renders component sections plus an "Add component" picker. Used for both entities and definitions. */
function ComponentList(props: {
  components: ComponentMap;
  overridden?: Set<string>;
  onSet: (type: string, field: string, value: unknown) => void;
  onRevert?: (type: string, field: string) => void;
  onAdd: (type: string) => void;
  onRemove: (type: string) => void;
}) {
  const types = Object.keys(props.components);
  const available = componentRegistry.list().filter((c) => !(c.type in props.components));
  return (
    <>
      {types.map((type) => {
        const schema = componentRegistry.get(type);
        const values = props.components[type];
        return (
          <Section
            key={type}
            title={schema?.label ?? type}
            testId={`component-${type}`}
            actions={
              <button className="icon-btn" title={`Remove ${type}`} data-testid={`remove-component-${type}`} onClick={() => props.onRemove(type)}>
                ✕
              </button>
            }
          >
            {schema ? (
              Object.entries(schema.fields).map(([field, fieldSchema]) => {
                const key = `${type}.${field}`;
                const overridden = props.overridden?.has(key) ?? false;
                return (
                  <Row
                    key={field}
                    label={field}
                    hint={fieldSchema.description}
                    overridden={overridden}
                    onRevert={overridden && props.onRevert ? () => props.onRevert!(type, field) : undefined}
                  >
                    <FieldEditor schema={fieldSchema} value={values[field]} testId={`field-${key}`} onCommit={(v) => props.onSet(type, field, v)} />
                  </Row>
                );
              })
            ) : (
              <div className="muted">Unknown component type; data is preserved.</div>
            )}
          </Section>
        );
      })}
      {available.length > 0 && (
        <select
          className="add-component"
          value=""
          data-testid="add-component"
          onChange={(e) => {
            if (e.target.value) props.onAdd(e.target.value);
          }}
        >
          <option value="">+ Add component…</option>
          {available.map((c) => (
            <option key={c.type} value={c.type} title={c.description}>
              {c.label}
            </option>
          ))}
        </select>
      )}
    </>
  );
}

function EntityInspector({ scene, entityId }: { scene: Scene; entityId: Id }) {
  const project = useEditor((s) => s.project);
  const edit = useEditor((s) => s.edit);
  const selectDefinition = useEditor((s) => s.selectDefinition);
  const entity = scene.entities.find((e) => e.id === entityId);
  if (!entity) return null;
  const resolved = resolveEntity(project, entity, componentRegistry);
  const def = project.definitions.find((d) => d.id === entity.definitionId);
  const sid = scene.id;
  const t = entity.transform;
  const inheritedTags = def?.tags ?? [];

  return (
    <div data-testid="entity-inspector">
      <div className="inspector-head">
        <TextInput value={entity.name} testId="entity-name" onCommit={(v) => edit('Rename entity', (p) => m.renameEntity(p, sid, entityId, v))} />
        <code className="id" title="Stable entity id">
          {entity.id}
        </code>
      </div>
      {def ? (
        <div className="instance-of">
          Instance of{' '}
          <button className="link" onClick={() => selectDefinition(def.id)}>
            {def.name}
          </button>
          <button
            className="small"
            title="Detach from the object definition, keeping current values"
            onClick={() => edit('Unlink entity', (p) => m.unlinkEntity(p, sid, entityId, componentRegistry))}
          >
            Unlink
          </button>
        </div>
      ) : (
        <div className="instance-of muted">Standalone entity</div>
      )}

      <Section title="Transform" testId="transform">
        <Row label="position">
          <Vec2Input value={t.position} testId="transform-position" onCommit={(position) => edit('Move entity', (p) => m.setEntityTransform(p, sid, entityId, { position }))} />
        </Row>
        <Row label="rotation">
          <NumberInput value={t.rotation} testId="transform-rotation" onCommit={(rotation) => edit('Rotate entity', (p) => m.setEntityTransform(p, sid, entityId, { rotation }))} />
        </Row>
        <Row label="scale">
          <Vec2Input value={t.scale} step={0.1} testId="transform-scale" onCommit={(scale) => edit('Scale entity', (p) => m.setEntityTransform(p, sid, entityId, { scale }))} />
        </Row>
      </Section>

      <Section title="Tags" testId="tags">
        {inheritedTags.length > 0 && (
          <Row label="inherited">
            <span className="tags">
              {inheritedTags.map((tag) => (
                <span key={tag} className="tag">
                  {tag}
                </span>
              ))}
            </span>
          </Row>
        )}
        <Row label={def ? 'instance' : 'tags'}>
          <ListInput value={entity.tags} placeholder="e.g. boss, tutorial" testId="entity-tags" onCommit={(tags) => edit('Set tags', (p) => m.setEntityTags(p, sid, entityId, tags))} />
        </Row>
      </Section>

      <ComponentList
        components={resolved.components}
        overridden={resolved.overriddenFields}
        onSet={(type, field, value) =>
          edit(`Set ${type}.${field}`, (p) => m.setEntityComponentField(p, sid, entityId, type, field, value, componentRegistry), { coalesceKey: `${entityId}.${type}.${field}` })
        }
        onRevert={(type, field) => edit(`Revert ${type}.${field}`, (p) => m.revertEntityComponentField(p, sid, entityId, type, field))}
        onAdd={(type) => edit(`Add ${type}`, (p) => m.addEntityComponent(p, sid, entityId, type, componentRegistry))}
        onRemove={(type) => edit(`Remove ${type}`, (p) => m.removeEntityComponent(p, sid, entityId, type))}
      />
    </div>
  );
}

function MultiInspector({ scene, ids }: { scene: Scene; ids: Id[] }) {
  const selectEntities = useEditor((s) => s.selectEntities);
  const entities = scene.entities.filter((e) => ids.includes(e.id));
  return (
    <div data-testid="multi-inspector">
      <div className="inspector-head">
        <strong>{entities.length} entities selected</strong>
      </div>
      <ul className="plain-list">
        {entities.map((e) => (
          <li key={e.id}>
            <button className="link" onClick={() => selectEntities([e.id])}>
              {e.name}
            </button>
          </li>
        ))}
      </ul>
      <p className="muted">Drag in the viewport to move them together. Delete or Ctrl+D act on the whole selection.</p>
    </div>
  );
}

function DefinitionInspector({ def }: { def: ObjectDefinition }) {
  const project = useEditor((s) => s.project);
  const edit = useEditor((s) => s.edit);
  const instances = m.countInstances(project, def.id);
  return (
    <div data-testid="definition-inspector">
      <div className="inspector-head">
        <TextInput value={def.name} testId="definition-name" onCommit={(v) => edit('Rename object', (p) => m.renameDefinition(p, def.id, v))} />
        <code className="id">{def.id}</code>
      </div>
      <div className="instance-of muted">
        Object definition · {instances} {instances === 1 ? 'instance' : 'instances'}. Changes apply to all instances that don't override them.
      </div>
      <Section title="Details">
        <Row label="description">
          <TextInput value={def.description} onCommit={(v) => edit('Set description', (p) => m.setDefinitionDescription(p, def.id, v))} />
        </Row>
        <Row label="category">
          <select
            value={categoryOf(def)}
            data-testid="definition-category"
            onChange={(e) => edit('Set category', (p) => m.setDefinitionCategory(p, def.id, e.target.value))}
          >
            {CATEGORIES.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </Row>
        <Row label="tags">
          <ListInput value={def.tags} testId="definition-tags" onCommit={(tags) => edit('Set tags', (p) => m.setDefinitionTags(p, def.id, tags))} />
        </Row>
      </Section>
      <ComponentList
        components={def.components}
        onSet={(type, field, value) =>
          edit(`Set ${def.name} ${type}.${field}`, (p) => m.setDefinitionComponentField(p, def.id, type, field, value, componentRegistry), { coalesceKey: `${def.id}.${type}.${field}` })
        }
        onAdd={(type) => edit(`Add ${type} to ${def.name}`, (p) => m.addDefinitionComponent(p, def.id, type, componentRegistry))}
        onRemove={(type) => edit(`Remove ${type} from ${def.name}`, (p) => m.removeDefinitionComponent(p, def.id, type))}
      />
      <button
        className="danger"
        data-testid="delete-definition"
        title={instances ? `Its ${instances} placed copies stay in your levels as standalone objects.` : undefined}
        onClick={() => edit(`Delete ${def.name}`, (p) => m.deleteDefinition(p, def.id, componentRegistry))}
      >
        Delete from library
      </button>
    </div>
  );
}

function SceneInspector({ scene }: { scene: Scene }) {
  const project = useEditor((s) => s.project);
  const edit = useEditor((s) => s.edit);
  const sid = scene.id;
  const selectEntities = useEditor((s) => s.selectEntities);
  return (
    <div data-testid="scene-inspector">
      <Section title="Level">
        <Row label="name">
          <TextInput value={scene.name} testId="scene-name" onCommit={(v) => edit('Rename scene', (p) => m.renameScene(p, sid, v))} />
        </Row>
        <Row label="starts the game">
          <input
            type="checkbox"
            checked={project.startSceneId === sid}
            disabled={project.startSceneId === sid}
            onChange={() => edit('Set start scene', (p) => m.setStartScene(p, sid))}
          />
        </Row>
      </Section>
      <Section title="World" testId="world">
        <Row label="gravity" hint="Pixels per second squared">
          <Vec2Input value={scene.world.gravity} testId="world-gravity" onCommit={(gravity) => edit('Set gravity', (p) => m.setWorldSettings(p, sid, { gravity }))} />
        </Row>
        <Row label="background">
          <input
            type="color"
            value={scene.world.backgroundColor}
            data-testid="world-background"
            onChange={(e) => edit('Set background', (p) => m.setWorldSettings(p, sid, { backgroundColor: e.target.value }), { coalesceKey: `${sid}.background` })}
          />
        </Row>
      </Section>
      <Section title={`In this level (${scene.entities.length})`} testId="outline">
        {scene.entities.length === 0 && <p className="muted">Nothing here yet. Open the Library to add objects.</p>}
        <ul className="outline">
          {scene.entities.map((e) => (
            <li key={e.id}>
              <button className="link" onClick={() => selectEntities([e.id])}>
                {e.name}
              </button>
            </li>
          ))}
        </ul>
      </Section>
      <Section title="Project">
        <Row label="name">
          <TextInput value={project.name} testId="project-name" onCommit={(v) => edit('Rename project', (p) => m.renameProject(p, v))} />
        </Row>
        <Row label="grid size">
          <NumberInput value={project.settings.gridSize} step={1} onCommit={(v) => edit('Set grid size', (p) => m.setGridSize(p, v))} />
        </Row>
      </Section>
      {project.scenes.length > 1 && (
        <button className="danger" data-testid="delete-scene" onClick={() => edit(`Delete ${scene.name}`, (p) => m.removeScene(p, sid))}>
          Delete this level
        </button>
      )}
    </div>
  );
}
