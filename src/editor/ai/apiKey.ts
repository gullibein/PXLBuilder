/**
 * The user's own Anthropic API key, for using the AI without a server
 * (e.g. the published app). It is kept in this browser only and sent only to
 * the Anthropic API. By default it lasts until the page is closed; with
 * "remember" it is saved in this browser's storage.
 */
const STORAGE_KEY = 'pxlbuilder.anthropicKey';
let sessionKey: string | null = null;
const listeners = new Set<() => void>();

export function getApiKey(): string | null {
  if (sessionKey) return sessionKey;
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

export function isKeyRemembered(): boolean {
  try {
    return !!localStorage.getItem(STORAGE_KEY);
  } catch {
    return false;
  }
}

export function setApiKey(key: string | null, remember: boolean): void {
  const value = key?.trim() || null;
  sessionKey = value;
  try {
    if (value && remember) localStorage.setItem(STORAGE_KEY, value);
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Storage unavailable: the key lasts for this page only.
  }
  for (const l of listeners) l();
}

export function onApiKeyChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** "sk-ant-…a1b2" for display. */
export function maskKey(key: string): string {
  return key.length > 12 ? `${key.slice(0, 7)}…${key.slice(-4)}` : '••••';
}
