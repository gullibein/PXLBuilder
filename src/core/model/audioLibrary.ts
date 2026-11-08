/**
 * The user's own library of sounds, instruments and songs, kept apart from any one game (editor/audioLibrary.ts
 * stores it): an item is saved from a game and added to another. A song carries its instruments with it.
 */
import { parseInstrument, parseSong, type Instrument, type Song } from '../audio/music';
import { soundDataUrl } from '../audio/sound';
import type { Id, Project } from '../types';
import { generateId } from '../ids';
import { addInstrumentAsset, addSongAsset } from './music';

export type LibraryKind = 'sound' | 'instrument' | 'song';

export interface LibraryItem {
  id: string;
  kind: LibraryKind;
  name: string;
  description: string;
  savedAt: number;
  /** What it is, as JSON: the sound, the instrument, or { song, instruments: [{ id, name, instrument }] }. */
  json: string;
}

/** An item of the game's sound, instrument or song (null: not one of those). */
export function libraryItemOf(project: Project, assetId: Id, now = Date.now()): LibraryItem | null {
  const a = project.assets.find((x) => x.id === assetId);
  if (!a) return null;
  const base = { id: generateId('lib'), name: a.name, description: a.description ?? '', savedAt: now };
  if (a.kind === 'sound' && a.synth) return { ...base, kind: 'sound', json: JSON.stringify(a.synth) };
  if (a.kind === 'instrument' && a.instrument) return { ...base, kind: 'instrument', json: JSON.stringify(a.instrument) };
  if (a.kind === 'music' && a.song) {
    // (The instruments it plays go with it.)
    const used = [...new Set(a.song.channels.map((c) => c.instrument).filter((x): x is string => !!x))];
    const instruments = used.flatMap((id) => {
      const i = project.assets.find((x) => x.id === id && x.kind === 'instrument' && x.instrument);
      return i ? [{ id, name: i.name, instrument: i.instrument! }] : [];
    });
    return { ...base, kind: 'song', json: JSON.stringify({ song: a.song, instruments }) };
  }
  return null;
}

const sameJson = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** A name of this kind no other asset of the game has ("Name", else "Name 2"…). */
function freeName(project: Project, kind: 'sound', name: string): string {
  const taken = new Set(project.assets.filter((a) => a.kind === kind).map((a) => a.name.toLowerCase()));
  if (!taken.has(name.toLowerCase())) return name;
  let n = 2;
  while (taken.has(`${name} ${n}`.toLowerCase())) n++;
  return `${name} ${n}`;
}

/**
 * Adds a library item to the game (inside an edit): a new sound, instrument or song (with its instruments: the
 * game's own one where it already has the very same instrument, else added). Returns the new asset's id. Throws on
 * an item that can't be read.
 */
export function addLibraryItem(project: Project, item: LibraryItem): Id {
  const data = JSON.parse(item.json) as unknown;
  if (item.kind === 'sound') {
    const id = generateId('snd');
    const synth = data as NonNullable<Project['assets'][number]['synth']>;
    project.assets.push({ id, name: freeName(project, 'sound', item.name), kind: 'sound', path: `assets/${id}.sound.json`, data: soundDataUrl(synth), width: 0, height: 0, synth, description: item.description || 'From your library' });
    return id;
  }
  if (item.kind === 'instrument') {
    const parsed = parseInstrument(data);
    if ('error' in parsed) throw new Error(parsed.error);
    return addInstrumentAsset(project, item.name, parsed.instrument, item.description || 'From your library');
  }
  const { song, instruments } = data as { song: Song; instruments: { id: string; name: string; instrument: Instrument }[] };
  const map = new Map<string, string>();
  for (const i of instruments) {
    const have = project.assets.find((a) => a.kind === 'instrument' && a.name.toLowerCase() === i.name.toLowerCase() && sameJson(a.instrument, i.instrument));
    map.set(i.id, have ? have.id : addInstrumentAsset(project, i.name, i.instrument, 'From your library'));
  }
  const parsed = parseSong({ ...song, channels: song.channels.map((c) => ({ ...c, instrument: c.instrument ? (map.get(c.instrument) ?? null) : null })) });
  if ('error' in parsed) throw new Error(parsed.error);
  return addSongAsset(project, item.name, parsed.song, item.description || 'From your library');
}
