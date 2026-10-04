import { useState } from 'react';
import { describeRelationship, describeRule } from '../../core/logic/describe';
import { relationshipsOf, rulesAbout } from '../../core/graph/graph';
import * as logic from '../../core/logic/mutations';
import { relationshipRegistry } from '../../core/logic/vocabulary';
import type { EntityRef, Id, Project, Relationship, Rule, Scene } from '../../core/types';
import { PromptBox } from '../prompt/PromptBox';
import { getActiveScene, useEditor } from '../store';

/**
 * The level's logic: how things are connected (relationships) and its rules,
 * as plain sentences. Most logic is made by describing it; this card shows
 * what exists, lets you switch rules off and remove things, and has a prompt
 * for the level ("when the player has all coins, open the exit").
 */
export function LogicPanel() {
  const open = useEditor((s) => s.logicOpen);
  const scene = useEditor(getActiveScene);
  const project = useEditor((s) => s.project);
  if (!open) return null;
  const { setLogicOpen } = useEditor.getState();
  const empty = scene.relationships.length === 0 && scene.rules.length === 0;
  return (
    <section className="background-panel logic-panel" data-testid="logic-panel" aria-label="Logic">
      <header className="bg-head">
        <span>
          <LogicIcon />
          Logic
        </span>
        <button className="icon-btn" aria-label="Close logic" onClick={() => setLogicOpen(false)}>
          <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
            <path d="m3.5 3.5 7 7m0-7-7 7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </button>
      </header>
      {empty ? (
        <p className="bg-hint" data-testid="logic-empty">
          Nothing is connected yet. Select two things and say how they work together ("this switch opens this door"), or describe a rule below.
        </p>
      ) : (
        <>
          {scene.relationships.length > 0 && (
            <div className="bg-section">
              <span className="bg-label">Connections</span>
              <RelationshipList project={project} scene={scene} relationships={scene.relationships} />
            </div>
          )}
          {scene.rules.length > 0 && (
            <div className="bg-section">
              <span className="bg-label">Rules</span>
              <RuleList project={project} scene={scene} rules={scene.rules} />
            </div>
          )}
        </>
      )}
      <div className="bg-prompt">
        <PromptBox key={scene.id} ctx={{ kind: 'level', sceneId: scene.id, point: null }} placeholder="Describe how things work…" testId="logic-prompt" onEscape={() => setLogicOpen(false)} />
      </div>
    </section>
  );
}

export function LogicIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 18 18" aria-hidden="true">
      <circle cx="4.5" cy="4.5" r="2.2" fill="none" stroke="currentColor" strokeWidth="1.4" />
      <circle cx="13.5" cy="9" r="2.2" fill="none" stroke="currentColor" strokeWidth="1.4" />
      <circle cx="4.5" cy="13.5" r="2.2" fill="none" stroke="currentColor" strokeWidth="1.4" />
      <path d="M6.5 5.5 11.4 8M6.5 12.5l4.9-2.5" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

function RemoveButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button className="icon-btn logic-remove" title={label} aria-label={label} onClick={onClick}>
      <svg width="12" height="12" viewBox="0 0 14 14" aria-hidden="true">
        <path d="m3.5 3.5 7 7m0-7-7 7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    </button>
  );
}

export function RelationshipList({ project, scene, relationships }: { project: Project; scene: Scene; relationships: Relationship[] }) {
  const edit = useEditor((s) => s.edit);
  return (
    <ul className="logic-list" data-testid="relationship-list">
      {relationships.map((r) => {
        const simulated = relationshipRegistry.get(r.type)?.simulated === true;
        return (
          <li key={r.id} className="logic-item" data-testid="relationship-item">
            <span className="logic-text">
              {describeRelationship(project, scene, r)}
              {!simulated && (
                <span className="logic-note" title="Recorded in the design; nothing happens in play yet">
                  {' '}
                  · not in play yet
                </span>
              )}
            </span>
            <RemoveButton label="Remove connection" onClick={() => edit('Remove connection', (p) => logic.removeRelationship(p, scene.id, r.id))} />
          </li>
        );
      })}
    </ul>
  );
}

export function RuleList({ project, scene, rules }: { project: Project; scene: Scene; rules: Rule[] }) {
  const edit = useEditor((s) => s.edit);
  return (
    <ul className="logic-list" data-testid="rule-list">
      {rules.map((r) => (
        <li key={r.id} className={`logic-item${r.enabled ? '' : ' off'}`} data-testid="rule-item">
          <input
            type="checkbox"
            checked={r.enabled}
            title={r.enabled ? 'On: switch this rule off' : 'Off: switch this rule on'}
            aria-label={r.enabled ? 'Switch rule off' : 'Switch rule on'}
            data-testid="rule-enabled"
            onChange={(e) => edit(e.target.checked ? 'Switch rule on' : 'Switch rule off', (p) => logic.setRuleEnabled(p, scene.id, r.id, e.target.checked))}
          />
          <span className="logic-text">
            {r.name && <strong>{r.name}: </strong>}
            {describeRule(project, scene, r)}
          </span>
          <RemoveButton label="Remove rule" onClick={() => edit('Remove rule', (p) => logic.removeRule(p, scene.id, r.id))} />
        </li>
      ))}
    </ul>
  );
}

/** Inspector section: what this entity is connected to, its rules, and a small form to connect it to something. */
export function EntityLogic({ scene, entityId }: { scene: Scene; entityId: Id }) {
  const project = useEditor((s) => s.project);
  const { outgoing, incoming } = relationshipsOf(project, scene, entityId);
  const relationships = [...outgoing, ...incoming.filter((r) => !outgoing.includes(r))];
  const rules = rulesAbout(project, scene, entityId);
  return (
    <div data-testid="entity-logic">
      {relationships.length > 0 && <RelationshipList project={project} scene={scene} relationships={relationships} />}
      {rules.length > 0 && <RuleList project={project} scene={scene} rules={rules} />}
      {relationships.length === 0 && rules.length === 0 && <p className="muted logic-none">Not connected to anything.</p>}
      <AddConnection scene={scene} entityId={entityId} />
    </div>
  );
}

function AddConnection({ scene, entityId }: { scene: Scene; entityId: Id }) {
  const project = useEditor((s) => s.project);
  const edit = useEditor((s) => s.edit);
  const types = relationshipRegistry.list().sort((a, b) => Number(b.simulated) - Number(a.simulated));
  const [type, setType] = useState(types[0].type);
  const [target, setTarget] = useState('');
  const options: { value: string; label: string; ref: EntityRef }[] = [
    ...scene.entities.filter((e) => e.id !== entityId).map((e) => ({ value: `entity:${e.id}`, label: e.name, ref: { kind: 'entity' as const, id: e.id } })),
    ...project.definitions.map((d) => ({ value: `object:${d.id}`, label: `every ${d.name}`, ref: { kind: 'object' as const, id: d.id } })),
  ];
  const chosen = options.find((o) => o.value === target);
  const add = () => {
    if (!chosen) return;
    const ok = edit('Connect', (p) => {
      logic.addRelationship(p, scene.id, { type, source: { kind: 'entity', id: entityId }, target: chosen.ref, params: {}, conditions: [] });
    });
    if (ok) setTarget('');
  };
  return (
    <div className="logic-add" data-testid="add-connection">
      <select value={type} aria-label="Connection type" data-testid="connection-type" onChange={(e) => setType(e.target.value)}>
        {types.map((t) => (
          <option key={t.type} value={t.type} title={t.description}>
            {t.verb}
            {t.simulated ? '' : ' (design only)'}
          </option>
        ))}
      </select>
      <select value={target} aria-label="Connect to" data-testid="connection-target" onChange={(e) => setTarget(e.target.value)}>
        <option value="">choose…</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <button className="chip-btn" disabled={!chosen} data-testid="connection-add" onClick={add}>
        Add
      </button>
    </div>
  );
}
