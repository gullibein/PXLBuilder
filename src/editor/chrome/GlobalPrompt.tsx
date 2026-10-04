import type { AIContext } from '../../core/ai/context';
import { PromptBox } from '../prompt/PromptBox';
import { getActiveScene, useEditor } from '../store';

/** Secondary, not object-bound prompt for the whole level or the whole game. */
export function GlobalPrompt() {
  const open = useEditor((s) => s.globalPrompt.open);
  const scope = useEditor((s) => s.globalPrompt.scope);
  const scene = useEditor(getActiveScene);
  const setGlobalPrompt = useEditor((s) => s.setGlobalPrompt);
  if (!open) return null;
  const ctx: AIContext = scope === 'project' ? { kind: 'project', sceneId: scene.id } : { kind: 'level', sceneId: scene.id, point: null };
  return (
    <div className="global-prompt" data-testid="global-prompt">
      <div className="scope-toggle" role="radiogroup" aria-label="Scope">
        <button role="radio" aria-checked={scope === 'level'} className={scope === 'level' ? 'on' : ''} onClick={() => setGlobalPrompt(true, 'level')}>
          {scene.name}
        </button>
        <button role="radio" aria-checked={scope === 'project'} className={scope === 'project' ? 'on' : ''} onClick={() => setGlobalPrompt(true, 'project')}>
          Whole game
        </button>
      </div>
      <PromptBox key={`${scope}:${scene.id}`} ctx={ctx} autoFocus onEscape={() => setGlobalPrompt(false)} />
    </div>
  );
}
