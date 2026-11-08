/**
 * Where the user's library of sounds, instruments and songs is kept (core/model/audioLibrary.ts makes and adds the
 * items). On claude.ai: the viewer's own private part of the app's database (data/users/<id>), so it is there in
 * every game they open, on any device. Elsewhere (a copy on the computer, GitHub Pages): this browser's storage.
 */
import { create } from 'zustand';
import type { LibraryItem } from '../core/model/audioLibrary';
import { claudeCapability } from './claudeViewer';

interface Snap {
  exists: boolean;
  data(): Record<string, unknown> | undefined;
}
interface DocRef {
  set(data: Record<string, unknown>): Promise<void>;
  delete(): Promise<void>;
  collection(path: string): ColRef;
}
interface ColRef {
  get(): Promise<{ docs: Snap[] }>;
  doc(id?: string): DocRef;
}
interface Db {
  doc(path: string): DocRef;
}
interface User {
  id(): Promise<string | null>;
}

const LOCAL_KEY = 'pxlbuilder.audioLibrary';

/** The viewer's own library collection on claude.ai, or null (not there, signed out, no id: this browser instead). */
async function account(): Promise<ColRef | null> {
  const [db, user] = await Promise.all([claudeCapability<Db>('db'), claudeCapability<User>('user')]);
  if (!db || !user) return null;
  const uid = await user.id().catch(() => null);
  if (!uid) return null;
  try {
    return db.doc(`data/users/${uid}/audio`).collection('items');
  } catch {
    return null;
  }
}

function readLocal(): LibraryItem[] {
  try {
    const v = JSON.parse(localStorage.getItem(LOCAL_KEY) ?? '[]') as unknown;
    return Array.isArray(v) ? (v as LibraryItem[]) : [];
  } catch {
    return [];
  }
}

function writeLocal(items: LibraryItem[]): void {
  try {
    localStorage.setItem(LOCAL_KEY, JSON.stringify(items));
  } catch {
    throw new Error("this browser didn't allow saving it (its storage is off or full)");
  }
}

const isItem = (d: Record<string, unknown> | undefined): d is Record<string, unknown> & LibraryItem => !!d && typeof d.id === 'string' && typeof d.json === 'string' && (d.kind === 'sound' || d.kind === 'instrument' || d.kind === 'song');

interface LibraryState {
  items: LibraryItem[];
  /** Where it is kept: your claude.ai account, or this browser; null until known. */
  where: 'account' | 'browser' | null;
  loading: boolean;
  error: string | null;
}

export const useAudioLibrary = create<LibraryState>(() => ({ items: [], where: null, loading: false, error: null }));

/** Reads the library (again). */
export async function loadLibrary(): Promise<void> {
  useAudioLibrary.setState({ loading: true, error: null });
  try {
    const col = await account();
    if (col) {
      const snap = await col.get();
      const items = snap.docs.map((d) => d.data()).filter(isItem);
      useAudioLibrary.setState({ items: items.map(({ id, kind, name, description, savedAt, json }) => ({ id, kind, name, description, savedAt, json })), where: 'account', loading: false });
    } else useAudioLibrary.setState({ items: readLocal(), where: 'browser', loading: false });
  } catch (e) {
    useAudioLibrary.setState({ loading: false, error: (e as { code?: string })?.code ?? (e as Error)?.message ?? 'unknown' });
  }
}

/** Saves an item to the library. */
export async function saveToLibrary(item: LibraryItem): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const col = await account();
    if (col) await col.doc(item.id).set({ ...item });
    else writeLocal([...readLocal().filter((x) => x.id !== item.id), item]);
    useAudioLibrary.setState((s) => ({ items: [...s.items.filter((x) => x.id !== item.id), item] }));
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as { code?: string })?.code ?? (e as Error)?.message ?? 'unknown' };
  }
}

/** Deletes an item from the library. */
export async function deleteFromLibrary(id: string): Promise<void> {
  const col = await account();
  if (col) await col.doc(id).delete();
  else writeLocal(readLocal().filter((x) => x.id !== id));
  useAudioLibrary.setState((s) => ({ items: s.items.filter((x) => x.id !== id) }));
}
