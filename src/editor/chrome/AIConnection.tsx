import { useEffect, useState } from 'react';
import { getApiKey, isKeyRemembered, maskKey, onApiKeyChange, setApiKey } from '../ai/apiKey';
import { testApiKey } from '../ai/browserProvider';
import { useEditor } from '../store';

/** Hook: the user's key as it changes. */
export function useApiKey(): string | null {
  const [key, setKey] = useState(getApiKey);
  useEffect(() => onApiKeyChange(() => setKey(getApiKey())), []);
  return key;
}

/**
 * Where the AI comes from: the user's own Anthropic API key (works anywhere,
 * including the published app), or this computer's PXLBuilder server.
 */
export function AIConnection() {
  const open = useEditor((s) => s.aiConnectionOpen);
  const setOpen = useEditor((s) => s.setAIConnectionOpen);
  const key = useApiKey();
  const [draft, setDraft] = useState('');
  const [remember, setRemember] = useState(isKeyRemembered());
  const [status, setStatus] = useState<{ tone: 'ok' | 'warn' | 'info'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  if (!open) return null;

  const save = async () => {
    const value = draft.trim();
    if (!value) return;
    setBusy(true);
    setStatus({ tone: 'info', text: 'Checking the key…' });
    const result = await testApiKey(value);
    setBusy(false);
    if (result.ok) {
      setApiKey(value, remember);
      setDraft('');
      setStatus({ tone: 'ok', text: 'Connected. The AI now uses your key.' });
    } else {
      setStatus({ tone: 'warn', text: `${result.message} The key was not saved.` });
    }
  };

  return (
    <div className="dialog-backdrop" onMouseDown={(e) => e.target === e.currentTarget && setOpen(false)}>
      <section className="dialog" role="dialog" aria-label="AI connection" data-testid="ai-connection">
        <header className="bg-head">
          <span>AI connection</span>
          <button className="icon-btn" aria-label="Close" onClick={() => setOpen(false)}>
            <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
              <path d="m3.5 3.5 7 7m0-7-7 7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </header>
        <p className="dialog-text" data-testid="ai-connection-status">
          {key ? (
            <>
              Using <strong>your Anthropic API key</strong> <code>{maskKey(key)}</code>
              {isKeyRemembered() ? ', remembered in this browser.' : ', for this session only.'}
            </>
          ) : (
            <>Using this computer's PXLBuilder server, if it has a key. To use the AI anywhere (also in the published app), add your own Anthropic API key.</>
          )}
        </p>
        <label className="bg-label" htmlFor="ai-key">
          {key ? 'Replace key' : 'Your Anthropic API key'}
        </label>
        <input
          id="ai-key"
          type="password"
          autoComplete="off"
          spellCheck={false}
          placeholder="sk-ant-…"
          value={draft}
          data-testid="ai-key-input"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && void save()}
        />
        <label className="dialog-check">
          <input type="checkbox" checked={remember} data-testid="ai-key-remember" onChange={(e) => setRemember(e.target.checked)} />
          Remember on this device
        </label>
        <div className="dialog-actions">
          <button className="btn-primary" disabled={!draft.trim() || busy} data-testid="ai-key-save" onClick={() => void save()}>
            Connect
          </button>
          {key && (
            <button
              className="text-btn"
              data-testid="ai-key-forget"
              onClick={() => {
                setApiKey(null, false);
                setStatus({ tone: 'info', text: 'Key removed from this browser.' });
              }}
            >
              Forget my key
            </button>
          )}
        </div>
        {status && (
          <p className={`dialog-status ${status.tone}`} data-testid="ai-key-result">
            {status.text}
          </p>
        )}
        <p className="bg-hint">
          Your key stays in this browser and is sent only to Anthropic, never to PXLBuilder or anyone else. Requests are billed to your Anthropic account. Anyone using this browser profile can use a remembered key, so don't remember it on a shared computer. Get a key at console.anthropic.com.
        </p>
      </section>
    </div>
  );
}
