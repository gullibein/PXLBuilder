/**
 * Behavior scripts in the details panel: what each one does (its description
 * and the script as readable steps), switched on/off, removed, or edited by
 * hand as JSON (checked the same way as the AI's).
 */
import { useState } from 'react';
import { describeScript } from '../../core/script/describe';
import { checkScript } from '../../core/script/language';
import { removeScript, setScript, setScriptEnabled, type ScriptOwner } from '../../core/script/mutations';
import type { BehaviorScript } from '../../core/types';
import { useEditor } from '../store';

export interface ScriptGroup {
  owner: ScriptOwner;
  /** "From Enemy (every copy)" / "Only this one". */
  label: string | null;
  scripts: BehaviorScript[];
}

export function ScriptList({ groups }: { groups: ScriptGroup[] }) {
  const total = groups.reduce((n, g) => n + g.scripts.length, 0);
  if (!total) {
    return <div className="muted small" data-testid="scripts-empty">No scripts yet. Describe a behavior in the prompt ("chases the player when it gets close") and the AI writes one.</div>;
  }
  return (
    <div className="script-list" data-testid="script-list">
      {groups.map((g) =>
        g.scripts.length ? (
          <div key={`${g.owner.target}:${g.owner.id}`}>
            {g.label && <div className="muted small script-group">{g.label}</div>}
            {g.scripts.map((s) => (
              <ScriptCard key={s.id} owner={g.owner} script={s} />
            ))}
          </div>
        ) : null,
      )}
    </div>
  );
}

function ScriptCard({ owner, script }: { owner: ScriptOwner; script: BehaviorScript }) {
  const edit = useEditor((s) => s.edit);
  const project = useEditor((s) => s.project);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const save = () => {
    let raw: unknown;
    try {
      raw = JSON.parse(draft ?? '');
    } catch {
      setError('That is not valid JSON.');
      return;
    }
    const checked = checkScript({ ...(raw as object), id: script.id }, project);
    if ('error' in checked) {
      setError(checked.error);
      return;
    }
    if (edit(`Edit script ${script.name}`, (p) => void setScript(p, owner, checked.script))) {
      setDraft(null);
      setError(null);
    }
  };

  return (
    <div className={`script-card${script.enabled ? '' : ' off'}`} data-testid={`script-${script.name}`}>
      <div className="script-head">
        <label className="script-toggle" title={script.enabled ? 'Switch off (stays here)' : 'Switch on'}>
          <input type="checkbox" checked={script.enabled} data-testid="script-enabled" onChange={(e) => edit(`${e.target.checked ? 'Enable' : 'Disable'} script ${script.name}`, (p) => setScriptEnabled(p, owner, script.id, e.target.checked))} />
        </label>
        <button className="script-name link" onClick={() => setOpen(!open)} data-testid="script-open" aria-expanded={open}>
          {open ? '▾' : '▸'} {script.name}
        </button>
        <button className="icon" title="Remove script" data-testid="script-remove" onClick={() => edit(`Remove script ${script.name}`, (p) => removeScript(p, owner, script.id))}>
          ×
        </button>
      </div>
      {script.description && <div className="script-desc">{script.description}</div>}
      {open && draft === null && (
        <>
          <pre className="script-code" data-testid="script-code">
            {describeScript(script).join('\n')}
          </pre>
          <button className="link small" data-testid="script-edit" onClick={() => setDraft(JSON.stringify(stripId(script), null, 2))}>
            Edit as code
          </button>
        </>
      )}
      {draft !== null && (
        <div className="script-editor">
          <textarea value={draft} spellCheck={false} data-testid="script-json" onChange={(e) => setDraft(e.target.value)} rows={14} />
          {error && (
            <div className="script-error" data-testid="script-error">
              {error}
            </div>
          )}
          <div className="script-editor-actions">
            <button className="primary small" data-testid="script-save" onClick={save}>
              Save
            </button>
            <button
              className="small"
              onClick={() => {
                setDraft(null);
                setError(null);
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function stripId(s: BehaviorScript): Omit<BehaviorScript, 'id'> {
  const { id: _id, ...rest } = s;
  return rest;
}
