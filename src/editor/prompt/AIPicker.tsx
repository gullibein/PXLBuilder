/**
 * The AI selector next to a prompt: which AI answers, right there. With your own Anthropic key: Claude Opus,
 * Sonnet or Haiku (with prices). With a Gemini key: the Gemini models that key can use (Google's list for it, the
 * Flash models first). On claude.ai: your account's default or quicker model. Plus Best quality / Fast, and the
 * full AI connection settings (keys) one click away. Everything here is the same setting as in AI connection.
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { CLAUDE_MODELS, type ClaudeModel } from '../../core/ai/claude';
import { GEMINI_FLASH_MODELS, setAISettings, useAISettings } from '../ai/aiSettings';
import { listGeminiModels } from '../ai/geminiProvider';
import { useApiKey, useClaudeAccount, useGeminiKey } from '../chrome/AIConnection';
import { useEditor } from '../store';

/** The Gemini models each key can use, asked once per key while the page is open. */
const geminiLists = new Map<string, Promise<string[]>>();
function geminiModelsFor(key: string): Promise<string[]> {
  let list = geminiLists.get(key);
  if (!list) {
    list = listGeminiModels(key).then((r) => (r.ok ? r.models : []));
    geminiLists.set(key, list);
  }
  return list;
}

/** "gemini-3.8-flash" → "Gemini 3.8 Flash". */
export function geminiLabel(id: string): string {
  return id
    .split('-')
    .map((w) => (/^\d/.test(w) ? w : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(' ');
}

/** What the button says: the AI answering now, in a word or two. */
function shortLabel(vendor: string, claudeModel: ClaudeModel, geminiModel: string, hasKey: boolean, claudeAccount: boolean | null): string {
  if (claudeAccount) return 'Claude';
  if (vendor === 'gemini') return geminiLabel(geminiModel).replace(/^Gemini /, '');
  return hasKey ? CLAUDE_MODELS[claudeModel].name.replace('Claude ', '').replace(/ [\d.]+$/, '') : 'Claude';
}

export function AIPicker() {
  const settings = useAISettings();
  const claudeKey = useApiKey();
  const gemKey = useGeminiKey();
  const claudeAccount = useClaudeAccount();
  const [open, setOpen] = useState(false);
  const [gemini, setGemini] = useState<string[]>([]);
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  useEffect(() => {
    if (!open || !gemKey) return;
    let live = true;
    void geminiModelsFor(gemKey).then((m) => live && setGemini(m));
    return () => {
      live = false;
    };
  }, [open, gemKey]);

  useEffect(() => {
    if (!open) return;
    const close = (e: Event) => {
      if (!menu.current?.contains(e.target as Node) && !button.current?.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setOpen(false);
      }
    };
    window.addEventListener('pointerdown', close, true);
    window.addEventListener('keydown', esc, true);
    return () => {
      window.removeEventListener('pointerdown', close, true);
      window.removeEventListener('keydown', esc, true);
    };
  }, [open]);

  // Below the button, or above it when there's no room; kept on screen.
  useLayoutEffect(() => {
    if (!open || !button.current || !menu.current) return;
    const b = button.current.getBoundingClientRect();
    const m = menu.current.getBoundingClientRect();
    const left = Math.max(8, Math.min(b.right - m.width, window.innerWidth - m.width - 8));
    const below = b.bottom + 6;
    const top = below + m.height <= window.innerHeight - 8 ? below : Math.max(8, b.top - 6 - m.height);
    setPos({ left, top });
  }, [open, gemini.length]);

  const pick = (patch: Parameters<typeof setAISettings>[0]) => {
    setAISettings(patch);
    setOpen(false);
  };
  const connection = () => {
    setOpen(false);
    useEditor.getState().setAIConnectionOpen(true);
  };
  const row = (key: string, label: string, hint: string | null, on: boolean, run: () => void, testId: string) => (
    <button key={key} role="menuitemradio" aria-checked={on} className={`menu-row${on ? ' current' : ''}`} data-testid={testId} onClick={run}>
      <span className="check">{on ? '✓' : ''}</span>
      <span className="grow">{label}</span>
      {hint && <span className="muted small">{hint}</span>}
    </button>
  );
  const geminiModels = [...new Set([...GEMINI_FLASH_MODELS, ...gemini])];
  const label = shortLabel(settings.vendor, settings.claudeModel, settings.geminiModel, !!claudeKey, claudeAccount);

  return (
    <>
      <button
        ref={button}
        className="prompt-icon ai-picker"
        title={`AI: ${label}${settings.speed === 'fast' ? ' (fast)' : ''}. Click to choose another.`}
        aria-label="Choose the AI"
        aria-haspopup="menu"
        aria-expanded={open}
        data-testid="ai-picker"
        onClick={() => {
          setPos(null);
          setOpen(!open);
        }}
      >
        <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
          <rect x="3" y="3" width="8" height="8" rx="1.6" fill="none" stroke="currentColor" strokeWidth="1.3" />
          <path d="M5.2 1v2M8.8 1v2M5.2 11v2M8.8 11v2M1 5.2h2M1 8.8h2M11 5.2h2M11 8.8h2" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
          <circle cx="7" cy="7" r="1.3" fill="currentColor" />
        </svg>
        <span className="ai-picker-label">{label}</span>
      </button>
      {open &&
        createPortal(
          <div ref={menu} className="context-menu ai-picker-menu" role="menu" aria-label="AI" data-testid="ai-picker-menu" style={pos ?? { left: -9999, top: -9999 }}>
            {claudeAccount ? (
              <>
                <div className="menu-head">Claude · your claude.ai account</div>
                {row('best', 'Default model', 'best answers', settings.speed === 'best', () => pick({ speed: 'best' }), 'pick-claudeai-best')}
                {row('fast', 'Quicker model', 'answers sooner', settings.speed === 'fast', () => pick({ speed: 'fast' }), 'pick-claudeai-fast')}
              </>
            ) : (
              <>
                <div className="menu-head">Claude{claudeKey ? ' · your Anthropic key' : ''}</div>
                {claudeKey ? (
                  (Object.keys(CLAUDE_MODELS) as ClaudeModel[]).map((m) =>
                    row(m, CLAUDE_MODELS[m].name, `$${CLAUDE_MODELS[m].input} / $${CLAUDE_MODELS[m].output}`, settings.vendor === 'claude' && settings.claudeModel === m, () => pick({ vendor: 'claude', claudeModel: m }), `pick-${m}`),
                  )
                ) : (
                  <>
                    {row('server', "This computer's server", null, settings.vendor === 'claude', () => pick({ vendor: 'claude' }), 'pick-claude-server')}
                    <button className="menu-row link" data-testid="pick-add-claude-key" onClick={connection}>
                      <span className="check" />
                      Add your Anthropic key…
                    </button>
                  </>
                )}
                <div className="menu-head">Google Gemini{gemKey ? ' · your key' : ''}</div>
                {gemKey ? (
                  geminiModels.map((m) => row(m, geminiLabel(m), null, settings.vendor === 'gemini' && settings.geminiModel === m, () => pick({ vendor: 'gemini', geminiModel: m }), `pick-${m}`))
                ) : (
                  <button className="menu-row link" data-testid="pick-add-gemini-key" onClick={connection}>
                    <span className="check" />
                    Add a Gemini key…
                  </button>
                )}
                <div className="menu-head">Speed</div>
                {row('best', 'Best quality', null, settings.speed === 'best', () => pick({ speed: 'best' }), 'pick-speed-best')}
                {row('fast', 'Fast', 'thinks less', settings.speed === 'fast', () => pick({ speed: 'fast' }), 'pick-speed-fast')}
              </>
            )}
            <div className="menu-sep" />
            <button className="menu-row" data-testid="pick-connection" onClick={connection}>
              <span className="check" />
              AI connection…
            </button>
            {claudeKey && !claudeAccount && <p className="muted small ai-picker-note">Claude prices: $ per million tokens in / out.</p>}
          </div>,
          document.body,
        )}
    </>
  );
}
