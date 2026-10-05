import type { AIContext } from '../../core/ai/context';
import { PromptBox } from '../prompt/PromptBox';
import { getActiveScene, useEditor } from '../store';

/** Secondary, not object-bound prompt for the whole level, the whole game, or the editor itself. */
export function GlobalPrompt() {
  const open = useEditor((s) => s.globalPrompt.open);
  const scope = useEditor((s) => s.globalPrompt.scope);
  const scene = useEditor(getActiveScene);
  const setGlobalPrompt = useEditor((s) => s.setGlobalPrompt);
  if (!open) return null;
  const ctx: AIContext = scope === 'project' ? { kind: 'project', sceneId: scene.id } : scope === 'editor' ? { kind: 'editor', sceneId: scene.id } : { kind: 'level', sceneId: scene.id, point: null };
  return (
    <div className="global-prompt" data-testid="global-prompt">
      <div className="scope-toggle" role="radiogroup" aria-label="Scope">
        <button role="radio" aria-checked={scope === 'level'} className={scope === 'level' ? 'on' : ''} onClick={() => setGlobalPrompt(true, 'level')}>
          {scene.name}
        </button>
        <button role="radio" aria-checked={scope === 'project'} className={scope === 'project' ? 'on' : ''} onClick={() => setGlobalPrompt(true, 'project')}>
          Whole game
        </button>
        <button role="radio" aria-checked={scope === 'editor'} className={scope === 'editor' ? 'on' : ''} data-testid="scope-editor" title="Change the editor itself: where things are, how it looks" onClick={() => setGlobalPrompt(true, 'editor')}>
          Editor
        </button>
      </div>
      <PromptBox
        key={`${scope}:${scene.id}`}
        ctx={ctx}
        autoFocus
        placeholder={scope === 'editor' ? 'Change the editor, e.g. "dock the details panel on the right"…' : undefined}
        testId={scope === 'editor' ? 'editor-prompt' : undefined}
        onEscape={() => setGlobalPrompt(false)}
      />
    </div>
  );
}
