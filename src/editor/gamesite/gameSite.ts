/**
 * PXLGameSite: the games people using this app have put up for everyone to
 * play, kept in the published app's own database on claude.ai (who can see
 * them is whoever the app is shared with). Each person writes only their own
 * part, `gamesite/<their id>` and below; everyone can read all of it:
 * - `gamesite/<id>`: the list of that person's games (name, when, size), so
 *   the site lists every game by reading one document per person;
 * - `gamesite/<id>/shots/<game>`: the game's picture (a small PNG);
 * - `gamesite/<id>/parts/<game>~<n>`: the game file, in pieces (a document
 *   holds at most 256 KB).
 */
import { claudeCapability } from '../claudeViewer';

interface Snap {
  id: string;
  exists: boolean;
  data(): Record<string, unknown> | undefined;
}
interface Db {
  doc(path: string): { get(): Promise<Snap>; set(data: Record<string, unknown>): Promise<void>; delete(): Promise<void> };
  collection(path: string): { get(): Promise<{ docs: Snap[] }> };
}
interface Viewer {
  id(): Promise<string>;
  profiles?(ids: string[]): Promise<Record<string, { name?: string }>>;
  can?(what: string): Promise<boolean | null> | boolean | null;
}

export interface SiteGame {
  /** Whose it is (an id, not a name: names are looked up when shown). */
  owner: string;
  gameId: string;
  name: string;
  savedAt: number;
  bytes: number;
  parts: number;
}

/** Characters of the game file per piece (a piece's document stays well under 256 KB even with escaping). */
const PIECE = 90_000;
const MAX_BYTES = 4_000_000;

const segment = (s: string) => s.replace(/[^A-Za-z0-9_\-.:@+]/g, '_').slice(0, 120) || 'x';

async function stores(): Promise<{ db: Db; user: Viewer } | null> {
  const [db, user] = await Promise.all([claudeCapability<Db>('db'), claudeCapability<Viewer>('user')]);
  return db && user ? { db, user } : null;
}

/** Whether PXLGameSite is here (the published app on claude.ai, signed in). */
export async function gameSiteAvailable(): Promise<boolean> {
  return (await stores()) !== null;
}

/** Who is looking (to mark their own games), or null. */
export async function myId(): Promise<string | null> {
  const s = await stores();
  return s ? await s.user.id() : null;
}

const why = (e: unknown) => (e as { code?: string })?.code ?? (e as Error)?.message ?? 'unknown';

/** Puts the game up (or replaces the one put up before under the same game). */
export async function publishGame(gameId: string, name: string, text: string, shot: string | null): Promise<{ ok: true } | { ok: false; error: string }> {
  const s = await stores();
  if (!s) return { ok: false, error: 'PXLGameSite is only in the published app on claude.ai' };
  if (text.length > MAX_BYTES) return { ok: false, error: `the game is too big for PXLGameSite (${Math.round(text.length / 1e6)} MB; up to 4 MB). Saving without unused objects makes it smaller.` };
  try {
    // (Exactly the viewer's id: the database lets each person write only under it.)
    const me = await s.user.id();
    const gid = segment(gameId);
    const listRef = s.db.doc(`gamesite/${me}`);
    const list = ((await listRef.get()).data()?.games ?? {}) as Record<string, Omit<SiteGame, 'owner' | 'gameId'>>;
    const before = list[gid]?.parts ?? 0;
    const parts = Math.max(1, Math.ceil(text.length / PIECE));
    for (let i = 0; i < parts; i++) await s.db.doc(`gamesite/${me}/parts/${gid}~${i}`).set({ i, text: text.slice(i * PIECE, (i + 1) * PIECE) });
    for (let i = parts; i < before; i++) await s.db.doc(`gamesite/${me}/parts/${gid}~${i}`).delete().catch(() => undefined);
    if (shot) await s.db.doc(`gamesite/${me}/shots/${gid}`).set({ png: shot });
    await listRef.set({ games: { ...list, [gid]: { name: name.slice(0, 80) || 'Untitled game', savedAt: Date.now(), bytes: text.length, parts } } });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: why(e) };
  }
}

/** Every game on the site, the newest first. */
export async function listSiteGames(): Promise<SiteGame[]> {
  const s = await stores();
  if (!s) return [];
  const people = await s.db.collection('gamesite').get();
  const out: SiteGame[] = [];
  for (const p of people.docs) {
    const games = (p.data()?.games ?? {}) as Record<string, Partial<SiteGame>>;
    for (const [gameId, g] of Object.entries(games)) {
      if (!g || typeof g.name !== 'string') continue;
      out.push({ owner: p.id, gameId, name: g.name, savedAt: Number(g.savedAt) || 0, bytes: Number(g.bytes) || 0, parts: Math.max(1, Number(g.parts) || 1) });
    }
  }
  return out.sort((a, b) => b.savedAt - a.savedAt);
}

/** A game's picture (a PNG data URL), or null. */
export async function siteGameShot(g: SiteGame): Promise<string | null> {
  const s = await stores();
  if (!s) return null;
  const png = (await s.db.doc(`gamesite/${g.owner}/shots/${g.gameId}`).get()).data()?.png;
  return typeof png === 'string' && png.startsWith('data:image/png') ? png : null;
}

/** A game's file, as text. */
export async function siteGameText(g: SiteGame): Promise<string> {
  const s = await stores();
  if (!s) throw new Error('PXLGameSite is not available here');
  const pieces: string[] = [];
  for (let i = 0; i < g.parts; i++) {
    const t = (await s.db.doc(`gamesite/${g.owner}/parts/${g.gameId}~${i}`).get()).data()?.text;
    if (typeof t !== 'string') throw new Error('part of the game is missing');
    pieces.push(t);
  }
  return pieces.join('');
}

/** Takes one of your own games off the site. */
export async function removeSiteGame(g: SiteGame): Promise<void> {
  const s = await stores();
  if (!s) return;
  const listRef = s.db.doc(`gamesite/${g.owner}`);
  const games = { ...(((await listRef.get()).data()?.games ?? {}) as Record<string, unknown>) };
  delete games[g.gameId];
  await listRef.set({ games });
  await s.db.doc(`gamesite/${g.owner}/shots/${g.gameId}`).delete().catch(() => undefined);
  for (let i = 0; i < g.parts; i++) await s.db.doc(`gamesite/${g.owner}/parts/${g.gameId}~${i}`).delete().catch(() => undefined);
}

/** People's names for their ids (empty where not known). */
export async function ownerNames(ids: string[]): Promise<Record<string, string>> {
  const s = await stores();
  if (!s?.user.profiles || !ids.length) return {};
  try {
    const p = await s.user.profiles(ids);
    return Object.fromEntries(ids.map((id) => [id, p[id]?.name || '']));
  } catch {
    return {};
  }
}
