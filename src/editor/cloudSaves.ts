/**
 * Saves kept with the published app on claude.ai (the artifact's own
 * storage): one click, no download dialogs. Each game has one save, kept
 * up to date: its file is stored as an asset of the artifact, and the
 * `saves/<game id>` document points at it (name, when, size). Outside
 * claude.ai (or where the page isn't allowed to store anything) this is
 * unavailable and saving uses files instead.
 */
import { claudeCapability } from './claudeViewer';

interface ViewerAssets {
  upload(blob: Blob, options?: { type?: string }): Promise<{ id: string; url: string; sizeBytes: number }>;
  delete(ref: string): Promise<unknown>;
}
interface DocSnapshot {
  id: string;
  exists: boolean;
  data(): Record<string, unknown> | undefined;
}
interface ViewerDb {
  doc(path: string): { get(): Promise<DocSnapshot>; set(data: Record<string, unknown>): Promise<void>; delete(): Promise<void> };
  collection(path: string): { get(): Promise<{ docs: DocSnapshot[] }> };
}

export interface CloudSave {
  /** The game's id (one save per game). */
  gameId: string;
  name: string;
  assetId: string;
  savedAt: number;
  bytes: number;
}

async function stores(): Promise<{ assets: ViewerAssets; db: ViewerDb } | null> {
  const [assets, db] = await Promise.all([claudeCapability<ViewerAssets>('assets'), claudeCapability<ViewerDb>('db')]);
  return assets && db ? { assets, db } : null;
}

/** Whether saves can be kept with the app here (the published app on claude.ai, opened by its owner or an editor). */
export async function cloudSavesAvailable(): Promise<boolean> {
  return (await stores()) !== null;
}

/** Segments of a document path allow letters, digits and a few signs only. */
const docId = (gameId: string) => gameId.replace(/[^A-Za-z0-9_\-.~:@+]/g, '_');

const why = (e: unknown) => (e as { code?: string })?.code ?? (e as Error)?.message ?? 'unknown';

/** Stores the game's file as its save (replacing the one before). */
export async function saveToCloud(gameId: string, name: string, text: string): Promise<{ ok: true; bytes: number } | { ok: false; error: string }> {
  const s = await stores();
  if (!s) return { ok: false, error: 'saving here is not available' };
  try {
    const ref = s.db.doc(`saves/${docId(gameId)}`);
    const before = await ref.get().catch(() => null);
    // (Read now, before the new save is written.)
    const old = before?.exists ? before.data()?.assetId : undefined;
    const stored = await s.assets.upload(new Blob([text], { type: 'application/json' }), { type: 'application/json' });
    await ref.set({ gameId, name, assetId: stored.id, savedAt: Date.now(), bytes: stored.sizeBytes });
    // The save before is replaced: its file is no longer needed.
    if (typeof old === 'string' && old !== stored.id) void s.assets.delete(old).catch(() => undefined);
    return { ok: true, bytes: stored.sizeBytes };
  } catch (e) {
    return { ok: false, error: why(e) };
  }
}

/** The saved games, most recent first. */
export async function listCloudSaves(): Promise<CloudSave[]> {
  const s = await stores();
  if (!s) return [];
  const snap = await s.db.collection('saves').get();
  const out: CloudSave[] = [];
  for (const d of snap.docs) {
    const v = d.data();
    if (!v || typeof v.assetId !== 'string') continue;
    out.push({ gameId: String(v.gameId ?? d.id), name: String(v.name ?? 'Game'), assetId: v.assetId, savedAt: Number(v.savedAt) || 0, bytes: Number(v.bytes) || 0 });
  }
  return out.sort((a, b) => b.savedAt - a.savedAt);
}

/** A save's file, as text. */
export async function readCloudSave(save: CloudSave): Promise<string> {
  const res = await fetch(`/_blob/${save.assetId}`);
  if (!res.ok) throw new Error(`the saved file could not be read (${res.status})`);
  return res.text();
}

/** Removes a save and its file. */
export async function deleteCloudSave(save: CloudSave): Promise<void> {
  const s = await stores();
  if (!s) return;
  await s.db.doc(`saves/${docId(save.gameId)}`).delete();
  void s.assets.delete(save.assetId).catch(() => undefined);
}
