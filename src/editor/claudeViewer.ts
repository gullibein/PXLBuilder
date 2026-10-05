/**
 * The claude.ai artifact viewer's capabilities, when PXLBuilder runs as a
 * published page (`window.claude.use(name)`). Outside a viewer (local dev, a
 * saved copy) every capability is null, and the app uses its own way instead.
 */
const cache = new Map<string, Promise<unknown>>();

export function claudeCapability<T>(name: string): Promise<T | null> {
  let p = cache.get(name);
  if (!p) {
    const claude = (globalThis as { claude?: { use?: (name: string) => Promise<unknown> } }).claude;
    p = claude?.use ? claude.use(name).then((x) => x ?? null, () => null) : Promise.resolve(null);
    cache.set(name, p);
  }
  return p as Promise<T | null>;
}

export interface ViewerDownloads {
  save(request: { filename: string; data: string | Blob }): Promise<{ status: 'saved' | 'delivered' }>;
}
