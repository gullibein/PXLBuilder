/**
 * The user's own API keys (Anthropic, Google Gemini), for using the AI without
 * a server. A key is kept in this browser only and sent only to its own
 * provider's API. By default it lasts until the page is closed; with
 * "remember" it is saved in this browser's storage.
 */
export interface KeyStore {
  get(): string | null;
  isRemembered(): boolean;
  set(key: string | null, remember: boolean): void;
  onChange(listener: () => void): () => void;
}

export function createKeyStore(storageKey: string): KeyStore {
  let sessionKey: string | null = null;
  const listeners = new Set<() => void>();
  const stored = () => {
    try {
      return localStorage.getItem(storageKey);
    } catch {
      return null;
    }
  };
  return {
    get: () => sessionKey ?? stored(),
    isRemembered: () => !!stored(),
    set(key, remember) {
      const value = key?.trim() || null;
      sessionKey = value;
      try {
        if (value && remember) localStorage.setItem(storageKey, value);
        else localStorage.removeItem(storageKey);
      } catch {
        // Storage unavailable: the key lasts for this page only.
      }
      for (const l of listeners) l();
    },
    onChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

export const anthropicKey = createKeyStore('pxlbuilder.anthropicKey');
export const geminiKey = createKeyStore('pxlbuilder.geminiKey');

export const getApiKey = () => anthropicKey.get();
export const isKeyRemembered = () => anthropicKey.isRemembered();
export const setApiKey = (key: string | null, remember: boolean) => anthropicKey.set(key, remember);
export const onApiKeyChange = (listener: () => void) => anthropicKey.onChange(listener);

/** "sk-ant-…a1b2" for display. */
export function maskKey(key: string): string {
  return key.length > 12 ? `${key.slice(0, 7)}…${key.slice(-4)}` : '••••';
}
