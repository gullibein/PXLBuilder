/**
 * Changes to the game's music: instruments and songs are assets (kind "instrument" and "music"), and a level can
 * have a song that plays while it is played. Used by the music machine and the AI's operations, on a project draft.
 */
import { musicDataUrl, type Instrument, type Song } from '../audio/music';
import { generateId } from '../ids';
import type { AssetRecord, Id, Project } from '../types';

export type MusicKind = 'instrument' | 'music';

const label = (kind: MusicKind) => (kind === 'music' ? 'song' : 'instrument');

export function musicAssets(project: Pick<Project, 'assets'>, kind: MusicKind): AssetRecord[] {
  return project.assets.filter((a) => a.kind === kind && (kind === 'music' ? a.song : a.instrument));
}

/** A free name: "Song 1", "Lead 2"… */
export function freeMusicName(project: Pick<Project, 'assets'>, kind: MusicKind, base: string): string {
  const taken = new Set(musicAssets(project, kind).map((a) => a.name.toLowerCase()));
  if (!taken.has(base.toLowerCase())) return base;
  let n = 2;
  while (taken.has(`${base} ${n}`.toLowerCase())) n++;
  return `${base} ${n}`;
}

/** Why the name can't be used (empty, or another one of the same kind has it), or null. */
export function musicNameProblem(project: Pick<Project, 'assets'>, kind: MusicKind, name: string, except: Id | null = null): string | null {
  const clean = name.trim();
  if (!clean) return `${kind === 'music' ? 'A' : 'An'} ${label(kind)} needs a name`;
  return musicAssets(project, kind).some((a) => a.id !== except && a.name.toLowerCase() === clean.toLowerCase()) ? `There is already ${kind === 'music' ? 'a' : 'an'} ${label(kind)} called "${clean}"` : null;
}

export function addInstrumentAsset(project: Project, name: string, instrument: Instrument, description = 'Made in the music machine'): Id {
  const id = generateId('ins');
  project.assets.push({ id, name: freeMusicName(project, 'instrument', name.trim() || 'Instrument'), kind: 'instrument', path: `assets/${id}.instrument.json`, data: musicDataUrl(instrument), width: 0, height: 0, instrument, description });
  return id;
}

export function addSongAsset(project: Project, name: string, song: Song, description = 'Written in the music machine'): Id {
  const id = generateId('mus');
  project.assets.push({ id, name: freeMusicName(project, 'music', name.trim() || 'Song'), kind: 'music', path: `assets/${id}.song.json`, data: musicDataUrl(song), width: 0, height: 0, song, description });
  return id;
}

export function setInstrument(project: Project, id: Id, instrument: Instrument): void {
  const a = project.assets.find((x) => x.id === id && x.kind === 'instrument');
  if (!a) throw new Error(`There is no instrument "${id}"`);
  a.instrument = instrument;
  a.data = musicDataUrl(instrument);
}

export function setSong(project: Project, id: Id, song: Song): void {
  const a = project.assets.find((x) => x.id === id && x.kind === 'music');
  if (!a) throw new Error(`There is no song "${id}"`);
  a.song = song;
  a.data = musicDataUrl(song);
}

/** The song that plays in a level (null: none). */
export function setLevelMusic(project: Project, sceneId: Id, songId: Id | null): void {
  const scene = project.scenes.find((s) => s.id === sceneId);
  if (!scene) throw new Error(`There is no level "${sceneId}"`);
  if (songId !== null && !project.assets.some((a) => a.id === songId && a.kind === 'music')) throw new Error(`There is no song "${songId}"`);
  scene.music = songId;
}

/** Removes an instrument (channels playing it go silent) or a song (levels playing it go quiet). */
export function removeMusicAsset(project: Project, id: Id): void {
  const a = project.assets.find((x) => x.id === id);
  if (!a || (a.kind !== 'instrument' && a.kind !== 'music')) return;
  project.assets = project.assets.filter((x) => x.id !== id);
  if (a.kind === 'music') {
    for (const s of project.scenes) if (s.music === id) s.music = null;
    return;
  }
  for (const s of project.assets) {
    if (s.kind !== 'music' || !s.song?.channels.some((c) => c.instrument === id)) continue;
    for (const c of s.song.channels) if (c.instrument === id) c.instrument = null;
    s.data = musicDataUrl(s.song);
  }
}

/** Renames an instrument or a song; scripts that play the song by name follow. Returns the problem, or null. */
export function renameMusicAsset(project: Project, id: Id, name: string): string | null {
  const a = project.assets.find((x) => x.id === id);
  if (!a || (a.kind !== 'instrument' && a.kind !== 'music')) return 'Not found';
  const problem = musicNameProblem(project, a.kind, name, id);
  if (problem) return problem;
  const old = a.name;
  a.name = name.trim();
  if (a.kind === 'music') {
    const rename = (node: unknown): void => {
      if (Array.isArray(node)) return node.forEach(rename);
      if (!node || typeof node !== 'object') return;
      const o = node as Record<string, unknown>;
      if (o.do === 'play_music' && typeof o.music === 'string' && o.music.toLowerCase() === old.toLowerCase()) o.music = a.name;
      for (const v of Object.values(o)) if (v && typeof v === 'object') rename(v);
    };
    for (const d of project.definitions) rename(d.scripts ?? []);
    for (const s of project.scenes) for (const e of s.entities) rename(e.scripts ?? []);
  }
  return null;
}
