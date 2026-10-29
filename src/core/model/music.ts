/**
 * Changes to the game's music: instruments and songs are assets (kind "instrument" and "music"), and a level can
 * have a song that plays while it is played. Used by the music machine and the AI's operations, on a project draft.
 */
import { musicDataUrl, type Instrument, type Song, type SongChannel, type SongNote } from '../audio/music';
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

/**
 * A change to part of a song (the AI's edit_song): only what it names changes, so "only the drums" or "a new
 * melody" leaves the rest exactly as it was.
 * - bpm, steps, loop, order: replaced when given.
 * - channels: each {index, …fields} changes that channel; without an index it is a new channel (at the end);
 *   {index, remove: true} takes one away with its notes (later channels move up one).
 * - patterns: each {index, name?, channels?, notes?}: with `channels`, the notes of just those channels are replaced
 *   by `notes` (the other channels' notes stay); without, all its notes are. index = the number of patterns adds
 *   one; {index, remove: true} takes it out (and out of the order).
 * Instruments are named (or given by id); pitches can be MIDI numbers or names like "C4". Indexes count from 0, as
 * the song is now, before this change.
 */
export interface SongEdit {
  bpm?: number;
  steps?: number;
  loop?: boolean;
  order?: number[];
  channels?: { index?: number; remove?: boolean; instrument?: string | null; name?: string; volume?: number; pan?: number; mute?: boolean; drum?: boolean }[];
  patterns?: { index: number; remove?: boolean; name?: string; channels?: number[]; notes?: unknown[] }[];
}

/** Applies an edit to a copy of the song; the result still needs checking (parseSong). Throws with what is wrong. */
export function editSong(song: Song, edit: SongEdit, instrumentId: (ref: string) => string | null, pitchOf: (x: unknown) => number | null): Song {
  const s = JSON.parse(JSON.stringify(song)) as Song;
  const fail = (m: string): never => {
    throw new Error(`edit_song: ${m}`);
  };
  if (edit.bpm !== undefined) s.bpm = edit.bpm;
  if (edit.steps !== undefined) s.steps = edit.steps;
  if (edit.loop !== undefined) s.loop = edit.loop;
  const removedChannels: number[] = [];
  for (const c of edit.channels ?? []) {
    const fields = { ...c } as Record<string, unknown>;
    delete fields.index;
    delete fields.remove;
    if (typeof fields.instrument === 'string') {
      const id = instrumentId(fields.instrument);
      if (!id) fail(`there is no instrument "${fields.instrument}"`);
      fields.instrument = id;
    }
    if (c.index === undefined) {
      s.channels.push({ name: '', instrument: null, volume: 0.8, pan: 0, mute: false, drum: false, ...fields } as SongChannel);
      continue;
    }
    if (!s.channels[c.index]) fail(`there is no channel ${c.index} (the song has ${song.channels.length}, numbered from 0)`);
    if (c.remove) removedChannels.push(c.index);
    else Object.assign(s.channels[c.index], fields);
  }
  const removedPatterns: number[] = [];
  for (const pe of edit.patterns ?? []) {
    if (pe.index > s.patterns.length) fail(`pattern ${pe.index}: patterns are numbered from 0, and a new one is number ${s.patterns.length}`);
    if (pe.remove) {
      if (pe.index >= song.patterns.length) fail(`there is no pattern ${pe.index} to remove`);
      removedPatterns.push(pe.index);
      continue;
    }
    if (pe.index === s.patterns.length) s.patterns.push({ name: pe.name ?? '', notes: [] });
    const pattern = s.patterns[pe.index];
    if (pe.name !== undefined) pattern.name = pe.name;
    if (pe.notes === undefined) continue;
    const only = pe.channels ? new Set(pe.channels) : null;
    const notes: SongNote[] = [];
    for (const raw of pe.notes) {
      if (!Array.isArray(raw) || raw.length < 4) fail(`pattern ${pe.index}: a note is [channel, step, pitch, length, velocity]`);
      const n = raw as unknown[];
      const pitch = pitchOf(n[2]);
      if (pitch === null) fail(`pattern ${pe.index}: "${String(n[2])}" is not a note (MIDI numbers, 60 = C4, or names like "C4", "F#3")`);
      const ch = Number(n[0]);
      if (only && !only.has(ch)) fail(`pattern ${pe.index}: a note on channel ${ch}, but this change is only for channels ${[...only].join(', ')}`);
      notes.push([ch, Number(n[1]), pitch!, Number(n[3]), n[4] === undefined ? 0.8 : Number(n[4])]);
    }
    pattern.notes = [...(only ? pattern.notes.filter((n) => !only.has(n[0])) : []), ...notes].sort((a, b) => a[1] - b[1] || a[0] - b[0]);
  }
  if (edit.order !== undefined) s.order = [...edit.order];
  // Removals last, from the highest index down, so the indexes above meant the song as it was.
  for (const i of [...new Set(removedPatterns)].sort((a, b) => b - a)) {
    s.patterns.splice(i, 1);
    s.order = s.order.filter((o) => o !== i).map((o) => (o > i ? o - 1 : o));
  }
  if (!s.order.length) s.order = [0];
  for (const i of [...new Set(removedChannels)].sort((a, b) => b - a)) {
    s.channels.splice(i, 1);
    for (const p of s.patterns) p.notes = p.notes.filter((n) => n[0] !== i).map((n) => (n[0] > i ? [n[0] - 1, n[1], n[2], n[3], n[4]] : n) as SongNote);
  }
  // Notes past a shorter pattern length are dropped.
  for (const p of s.patterns) p.notes = p.notes.filter((n) => n[1] < s.steps);
  return s;
}
