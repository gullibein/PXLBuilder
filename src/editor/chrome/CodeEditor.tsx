/**
 * The Code Editor: the behavior code of one object (right-click → Code). Its
 * scripts, every copy's and (for a placed one) its own, as code to read and
 * edit: saved scripts are checked exactly like the AI's, so a mistake is
 * named with where it is and nothing broken is stored. Its built-in behaviors
 * (the components: Patrol, Damage…) are shown as code too, to read; they are
 * changed in Details. The script language's reference is one click away.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { componentRegistry } from '../../core/components/builtin';
import { resolveEntity } from '../../core/model/resolve';
import { describeScript } from '../../core/script/describe';
import { checkScript, describeScriptLanguage } from '../../core/script/language';
import { removeScript, setScript, setScriptEnabled, type ScriptOwner } from '../../core/script/mutations';
import type { BehaviorScript } from '../../core/types';
import { useEditor } from '../store';

/** A new script to start from: does nothing until handlers say what. */
const NEW_SCRIPT = {
  name: 'New script',
  description: 'What it does, in one sentence.',
  enabled: true,
  vars: [{ name: 'speed', value: 60 }],
  states: [],
  handlers: [{ when: { on: 'tick' }, state: null, if: null, do: [] }],
};

type Selected = { kind: 'script'; owner: ScriptOwner; id: string } | { kind: 'new'; owner: ScriptOwner } | { kind: 'components' } | { kind: 'reference' };

const codeOf = (s: BehaviorScript) => {
  const { id: _id, ...rest } = s;
  return JSON.stringify(rest, null, 2);
};

export function CodeEditor() {
  const target = useEditor((s) => s.codeEditor);
  if (!target) return null;
  return <CodeEditorDialog key={`${target.definitionId}:${target.entityId}`} definitionId={target.definitionId} entityId={target.entityId} />;
}

function CodeEditorDialog({ definitionId, entityId }: { definitionId: string | null; entityId: string | null }) {
  const project = useEditor((s) => s.project);
  const def = definitionId ? project.definitions.find((d) => d.id === definitionId) : undefined;
  const entity = entityId ? project.scenes.flatMap((s) => s.entities).find((e) => e.id === entityId) : undefined;
  const close = () => useEditor.getState().openCodeEditor(null);
  const defOwner: ScriptOwner | null = def ? { target: 'definition', id: def.id } : null;
  const ownOwner: ScriptOwner | null = entity ? { target: 'instance', id: entity.id } : null;
  const groups = [
    ...(defOwner ? [{ owner: defOwner, label: entity ? `Every ${def!.name}` : def!.name, scripts: def!.scripts ?? [] }] : []),
    ...(ownOwner ? [{ owner: ownOwner, label: def ? 'Only this one' : entity!.name, scripts: entity!.scripts ?? [] }] : []),
  ];
  const first = groups.find((g) => g.scripts.length);
  const [sel, setSel] = useState<Selected>(first ? { kind: 'script', owner: first.owner, id: first.scripts[0].id } : { kind: 'components' });
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<'code' | 'readable'>('code');
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const gutterRef = useRef<HTMLDivElement>(null);

  const script = sel.kind === 'script' ? groups.find((g) => g.owner.target === sel.owner.target && g.owner.id === sel.owner.id)?.scripts.find((s) => s.id === sel.id) : undefined;
  const original = sel.kind === 'script' ? (script ? codeOf(script) : '') : sel.kind === 'new' ? JSON.stringify(NEW_SCRIPT, null, 2) : '';
  const code = text ?? original;
  const dirty = text !== null && text !== original;

  // The built-in behaviors as code: the components, as this one has them (its own changes included).
  const components = useMemo(() => {
    const resolved = entity ? resolveEntity(project, entity, componentRegistry) : def ? { components: def.components } : null;
    return resolved ? JSON.stringify(resolved.components, null, 2) : '{}';
  }, [project, entity, def]);

  useEffect(() => {
    setText(null);
    setError(null);
  }, [sel]);

  if (!def && !entity) return null;
  const title = entity ? entity.name : def!.name;

  const choose = (next: Selected) => {
    if (dirty && !window.confirm('Leave this script without saving your changes?')) return;
    setSel(next);
  };
  const save = () => {
    if (sel.kind !== 'script' && sel.kind !== 'new') return;
    let raw: unknown;
    try {
      raw = JSON.parse(code);
    } catch (e) {
      // JSON.parse says where ("…at position 120"): turned into a line number.
      const at = /position (\d+)/.exec((e as Error).message);
      const line = at ? code.slice(0, Number(at[1])).split('\n').length : null;
      return setError(`That isn't valid code${line ? ` (line ${line})` : ''}: check the commas, quotes and brackets.`);
    }
    const id = sel.kind === 'script' ? sel.id : undefined;
    const checked = checkScript({ ...(raw as object), ...(id ? { id } : { id: 'scr_check' }) }, project);
    if ('error' in checked) return setError(checked.error);
    let newId = '';
    const ok = useEditor.getState().edit(`${sel.kind === 'new' ? 'Add' : 'Edit'} script ${checked.script.name}`, (p) => {
      newId = setScript(p, sel.owner, { ...(raw as object), ...(id ? { id } : {}) });
    });
    if (!ok) return setError(useEditor.getState().log.at(-1)?.message ?? "The script couldn't be saved.");
    setError(null);
    setText(null);
    setSel({ kind: 'script', owner: sel.owner, id: newId });
  };

  const lines = code.split('\n').length;
  return (
    <div className="dialog-backdrop" onMouseDown={(e) => e.target === e.currentTarget && !dirty && close()}>
      <section
        className="dialog code-editor"
        role="dialog"
        aria-label="Code editor"
        data-testid="code-editor"
        onKeyDown={(e) => {
          e.stopPropagation();
          if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
            e.preventDefault();
            save();
          } else if (e.key === 'Escape' && !dirty) close();
        }}
      >
        <header className="bg-head">
          <span>
            Code <span className="muted">· {title}</span>
          </span>
          <button className="icon-btn" aria-label="Close" data-testid="code-close" onClick={() => (!dirty || window.confirm('Close without saving your changes?')) && close()}>
            <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
              <path d="m3.5 3.5 7 7m0-7-7 7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </header>
        <div className="code-body">
          <nav className="code-files" aria-label="Behaviors" data-testid="code-files">
            {groups.map((g) => (
              <div key={`${g.owner.target}:${g.owner.id}`} className="code-group">
                <div className="code-group-label">{g.label}</div>
                {g.scripts.map((s) => (
                  <button
                    key={s.id}
                    className={`code-file${sel.kind === 'script' && sel.id === s.id ? ' on' : ''}${s.enabled ? '' : ' off'}`}
                    data-testid={`code-file-${s.name}`}
                    title={s.description}
                    onClick={() => choose({ kind: 'script', owner: g.owner, id: s.id })}
                  >
                    {s.name}
                  </button>
                ))}
                <button className={`code-file new${sel.kind === 'new' && sel.owner.target === g.owner.target ? ' on' : ''}`} data-testid={`code-new-${g.owner.target}`} onClick={() => choose({ kind: 'new', owner: g.owner })}>
                  + New script
                </button>
              </div>
            ))}
            <div className="code-group">
              <div className="code-group-label">Built in</div>
              <button className={`code-file${sel.kind === 'components' ? ' on' : ''}`} data-testid="code-file-components" onClick={() => choose({ kind: 'components' })}>
                Components
              </button>
              <button className={`code-file${sel.kind === 'reference' ? ' on' : ''}`} data-testid="code-file-reference" onClick={() => choose({ kind: 'reference' })}>
                Language reference
              </button>
            </div>
          </nav>
          <div className="code-main">
            {sel.kind === 'components' || sel.kind === 'reference' ? (
              <>
                <p className="muted small">
                  {sel.kind === 'components'
                    ? `${title}'s built-in behaviors (walking back and forth, hurting, being collected…) and settings, as it has them now. To read; change them in Details (I) or by asking the AI.`
                    : 'The behavior script language: what a script can react to (triggers), do (statements) and look at (expressions).'}
                </p>
                <pre className="code-view" data-testid={sel.kind === 'components' ? 'code-components' : 'code-reference'}>
                  {sel.kind === 'components' ? components : describeScriptLanguage()}
                </pre>
              </>
            ) : (
              <>
                <div className="code-toolbar">
                  <div className="scope-toggle" role="tablist">
                    <button role="tab" aria-selected={view === 'code'} className={view === 'code' ? 'on' : ''} data-testid="code-tab-code" onClick={() => setView('code')}>
                      Code
                    </button>
                    <button role="tab" aria-selected={view === 'readable'} className={view === 'readable' ? 'on' : ''} data-testid="code-tab-readable" onClick={() => setView('readable')} disabled={!script}>
                      Readable
                    </button>
                  </div>
                  {script && sel.kind === 'script' && (
                    <>
                      <label className="se-row small">
                        <input
                          type="checkbox"
                          checked={script.enabled}
                          data-testid="code-enabled"
                          onChange={(e) => useEditor.getState().edit(`${e.target.checked ? 'Enable' : 'Disable'} script ${script.name}`, (p) => setScriptEnabled(p, sel.owner, script.id, e.target.checked))}
                        />{' '}
                        On
                      </label>
                      <button
                        className="chip-btn"
                        data-testid="code-delete"
                        onClick={() => {
                          if (!window.confirm(`Remove the script "${script.name}"? (Undo brings it back.)`)) return;
                          if (useEditor.getState().edit(`Remove script ${script.name}`, (p) => removeScript(p, sel.owner, script.id))) setSel({ kind: 'components' });
                        }}
                      >
                        Remove
                      </button>
                    </>
                  )}
                </div>
                {view === 'readable' && script ? (
                  <pre className="code-view" data-testid="code-readable">
                    {describeScript(script).join('\n')}
                  </pre>
                ) : (
                  <div className="code-area">
                    <div className="code-gutter" ref={gutterRef} aria-hidden="true">
                      {Array.from({ length: lines }, (_, i) => (
                        <div key={i}>{i + 1}</div>
                      ))}
                    </div>
                    <textarea
                      ref={areaRef}
                      value={code}
                      spellCheck={false}
                      wrap="off"
                      data-testid="code-text"
                      aria-label="Script code"
                      onScroll={(e) => gutterRef.current && (gutterRef.current.scrollTop = e.currentTarget.scrollTop)}
                      onChange={(e) => setText(e.target.value)}
                      onKeyDown={(e) => {
                        // Tab indents instead of leaving the editor.
                        if (e.key === 'Tab') {
                          e.preventDefault();
                          const el = e.currentTarget;
                          const { selectionStart: a, selectionEnd: b } = el;
                          const next = `${code.slice(0, a)}  ${code.slice(b)}`;
                          setText(next);
                          requestAnimationFrame(() => el.setSelectionRange(a + 2, a + 2));
                        }
                      }}
                    />
                  </div>
                )}
                {error && (
                  <div className="script-error" data-testid="code-error">
                    {error}
                  </div>
                )}
                <footer className="se-footer">
                  <span className="muted small">{dirty ? 'Changed (not saved)' : sel.kind === 'new' ? 'A new script: edit it, then save' : 'Saved'}</span>
                  <span className="grow" />
                  <button className="chip-btn" disabled={!dirty} onClick={() => (setText(null), setError(null))}>
                    Revert
                  </button>
                  <button className="primary-btn" data-testid="code-save" disabled={!dirty && sel.kind !== 'new'} onClick={save} title="Save (Ctrl+S)">
                    Save
                  </button>
                </footer>
              </>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
