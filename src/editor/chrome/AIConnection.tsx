import { useEffect, useState } from 'react';
import { geminiKey, getApiKey, isKeyRemembered, maskKey, onApiKeyChange, setApiKey } from '../ai/apiKey';
import { setAISettings, useAISettings } from '../ai/aiSettings';
import { testApiKey } from '../ai/browserProvider';
import { listGeminiModels } from '../ai/geminiProvider';
import { claudeSample } from '../ai/sampleProvider';
import { useEditor } from '../store';

/** True inside a claude.ai artifact viewer, where the AI runs on the viewer's Claude account. */
function useClaudeAccount(): boolean | null {
  const [available, setAvailable] = useState<boolean | null>(null);
  useEffect(() => {
    let live = true;
    void claudeSample().then((s) => live && setAvailable(!!s));
    return () => {
      live = false;
    };
  }, []);
  return available;
}

/** Hook: the user's Anthropic key as it changes. */
export function useApiKey(): string | null {
  const [key, setKey] = useState(getApiKey);
  useEffect(() => onApiKeyChange(() => setKey(getApiKey())), []);
  return key;
}

function useGeminiKey(): string | null {
  const [key, setKey] = useState(geminiKey.get);
  useEffect(() => geminiKey.onChange(() => setKey(geminiKey.get())), []);
  return key;
}

type Status = { tone: 'ok' | 'warn' | 'info'; text: string } | null;

function CloseButton({ onClose }: { onClose: () => void }) {
  return (
    <button className="icon-btn" aria-label="Close" onClick={onClose}>
      <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
        <path d="m3.5 3.5 7 7m0-7-7 7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    </button>
  );
}

/** Best quality or fast, for whichever AI answers. */
function SpeedChoice({ fastHint }: { fastHint: string }) {
  const { speed } = useAISettings();
  return (
    <>
      <span className="bg-label">Speed</span>
      <div className="seg" role="radiogroup" aria-label="AI speed">
        <button role="radio" aria-checked={speed === 'best'} className={speed === 'best' ? 'on' : ''} data-testid="ai-speed-best" onClick={() => setAISettings({ speed: 'best' })}>
          Best quality
        </button>
        <button role="radio" aria-checked={speed === 'fast'} className={speed === 'fast' ? 'on' : ''} data-testid="ai-speed-fast" onClick={() => setAISettings({ speed: 'fast' })}>
          Fast
        </button>
      </div>
      <p className="bg-hint">{speed === 'fast' ? fastHint : 'Takes longer, handles hard requests (scripts, whole levels, "why…?") best.'}</p>
    </>
  );
}

/**
 * Where the AI comes from and how fast it answers: Claude (your claude.ai
 * account in the published app; your own Anthropic key or this computer's
 * server elsewhere) or Google Gemini with your own key; best quality or fast.
 */
export function AIConnection() {
  const open = useEditor((s) => s.aiConnectionOpen);
  const setOpen = useEditor((s) => s.setAIConnectionOpen);
  const settings = useAISettings();
  const claudeAccount = useClaudeAccount();
  if (!open) return null;
  const close = () => setOpen(false);

  if (claudeAccount) {
    return (
      <div className="dialog-backdrop" onMouseDown={(e) => e.target === e.currentTarget && close()}>
        <section className="dialog" role="dialog" aria-label="AI connection" data-testid="ai-connection">
          <header className="bg-head">
            <span>AI connection</span>
            <CloseButton onClose={close} />
          </header>
          <p className="dialog-text" data-testid="ai-connection-status">
            Here on claude.ai the AI uses <strong>your Claude account</strong>. No API key is needed. The first time you ask something, claude.ai asks you to allow this page to use Claude; requests count toward your Claude plan's usage.
          </p>
          <SpeedChoice fastHint="Uses claude.ai's quicker model: answers sooner, may get hard requests wrong more often (changes are still checked before they're applied)." />
          <p className="bg-hint">API keys (Anthropic or Gemini) can't be used here: claude.ai doesn't let published pages contact other services. They work when you run PXLBuilder on your computer.</p>
        </section>
      </div>
    );
  }

  return (
    <div className="dialog-backdrop" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <section className="dialog" role="dialog" aria-label="AI connection" data-testid="ai-connection">
        <header className="bg-head">
          <span>AI connection</span>
          <CloseButton onClose={close} />
        </header>
        <span className="bg-label">AI</span>
        <div className="seg" role="radiogroup" aria-label="Which AI">
          <button role="radio" aria-checked={settings.vendor === 'claude'} className={settings.vendor === 'claude' ? 'on' : ''} data-testid="ai-vendor-claude" onClick={() => setAISettings({ vendor: 'claude' })}>
            Claude
          </button>
          <button role="radio" aria-checked={settings.vendor === 'gemini'} className={settings.vendor === 'gemini' ? 'on' : ''} data-testid="ai-vendor-gemini" onClick={() => setAISettings({ vendor: 'gemini' })}>
            Google Gemini
          </button>
        </div>
        <SpeedChoice
          fastHint={
            settings.vendor === 'claude'
              ? 'Claude thinks less before answering: much quicker, may get hard requests wrong more often (changes are still checked before they are applied).'
              : 'Gemini thinks less before answering: quicker, may get hard requests wrong more often (changes are still checked before they are applied).'
          }
        />
        {settings.vendor === 'claude' ? <ClaudeSection /> : <GeminiSection />}
      </section>
    </div>
  );
}

function ClaudeSection() {
  const key = useApiKey();
  const [draft, setDraft] = useState('');
  const [remember, setRemember] = useState(isKeyRemembered());
  const [status, setStatus] = useState<Status>(null);
  const [busy, setBusy] = useState(false);

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
    <>
      <p className="dialog-text" data-testid="ai-connection-status">
        {key ? (
          <>
            Using <strong>your Anthropic API key</strong> <code>{maskKey(key)}</code>
            {isKeyRemembered() ? ', remembered in this browser.' : ', for this session only.'}
          </>
        ) : (
          <>Using this computer's PXLBuilder server, if it has a key. To use the AI anywhere, add your own Anthropic API key.</>
        )}
      </p>
      <label className="bg-label" htmlFor="ai-key">
        {key ? 'Replace key' : 'Your Anthropic API key'}
      </label>
      <input id="ai-key" type="password" autoComplete="off" spellCheck={false} placeholder="sk-ant-…" value={draft} data-testid="ai-key-input" onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void save()} />
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
    </>
  );
}

function GeminiSection() {
  const key = useGeminiKey();
  const { geminiModel } = useAISettings();
  const [draft, setDraft] = useState('');
  const [remember, setRemember] = useState(geminiKey.isRemembered());
  const [status, setStatus] = useState<Status>(null);
  const [busy, setBusy] = useState(false);
  const [models, setModels] = useState<string[]>([]);

  // With a key, list the models it can use (also shows the key still works).
  useEffect(() => {
    if (!key) return setModels([]);
    let live = true;
    void listGeminiModels(key).then((r) => {
      if (!live) return;
      if (r.ok) setModels(r.models);
      else setStatus({ tone: 'warn', text: r.message });
    });
    return () => {
      live = false;
    };
  }, [key]);

  const save = async () => {
    const value = draft.trim();
    if (!value) return;
    setBusy(true);
    setStatus({ tone: 'info', text: 'Checking the key…' });
    const result = await listGeminiModels(value);
    setBusy(false);
    if (!result.ok) return setStatus({ tone: 'warn', text: `${result.message} The key was not saved.` });
    geminiKey.set(value, remember);
    setDraft('');
    // Keep the chosen model if the key can use it; else the first Flash model it offers.
    if (result.models.length && !result.models.includes(geminiModel)) setAISettings({ geminiModel: result.models[0] });
    setStatus({ tone: 'ok', text: 'Connected. The AI now uses Gemini with your key.' });
  };

  const options = models.includes(geminiModel) || !geminiModel ? models : [geminiModel, ...models];
  return (
    <>
      <p className="dialog-text" data-testid="gemini-status">
        {key ? (
          <>
            Using <strong>Google Gemini</strong> with your key <code>{maskKey(key)}</code>
            {geminiKey.isRemembered() ? ', remembered in this browser.' : ', for this session only.'}
          </>
        ) : (
          <>Add your Gemini API key to use Gemini (get one at aistudio.google.com). Until then, prompts say what's missing.</>
        )}
      </p>
      <label className="bg-label" htmlFor="gemini-key">
        {key ? 'Replace key' : 'Your Gemini API key'}
      </label>
      <input id="gemini-key" type="password" autoComplete="off" spellCheck={false} placeholder="AIza…" value={draft} data-testid="gemini-key-input" onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void save()} />
      <label className="dialog-check">
        <input type="checkbox" checked={remember} data-testid="gemini-key-remember" onChange={(e) => setRemember(e.target.checked)} />
        Remember on this device
      </label>
      <div className="dialog-actions">
        <button className="btn-primary" disabled={!draft.trim() || busy} data-testid="gemini-key-save" onClick={() => void save()}>
          Connect
        </button>
        {key && (
          <button
            className="text-btn"
            data-testid="gemini-key-forget"
            onClick={() => {
              geminiKey.set(null, false);
              setStatus({ tone: 'info', text: 'Gemini key removed from this browser.' });
            }}
          >
            Forget my key
          </button>
        )}
      </div>
      {status && (
        <p className={`dialog-status ${status.tone}`} data-testid="gemini-key-result">
          {status.text}
        </p>
      )}
      {key && (
        <>
          <label className="bg-label" htmlFor="gemini-model">
            Model
          </label>
          <select id="gemini-model" data-testid="gemini-model" value={geminiModel} onChange={(e) => setAISettings({ geminiModel: e.target.value })}>
            {options.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </>
      )}
      <p className="bg-hint">
        Your key stays in this browser and is sent only to Google, never to PXLBuilder or anyone else. Requests are billed to (or count against the free quota of) your Google account. Gemini follows the same checked game-changes as Claude, but was tuned less with PXLBuilder: expect more "couldn't be applied" on hard requests.
      </p>
    </>
  );
}
