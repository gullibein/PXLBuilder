/** Changes to the game's sounds from the sound editor and the Sounds list (each one undoable). */
import { soundDataUrl } from '../core/audio/sound';
import type { StepSound } from '../core/audio/steps';
import { generateId } from '../core/ids';
import type { Id } from '../core/types';
import { useEditor } from './store';

/** A free name for a new sound: "Sound 1", "Sound 2"… */
export function newSoundName(): string {
  const taken = new Set(useEditor.getState().project.assets.filter((a) => a.kind === 'sound').map((a) => a.name.toLowerCase()));
  let n = 1;
  while (taken.has(`sound ${n}`)) n++;
  return `Sound ${n}`;
}

/** Whether a name is free for a sound (other than this one); the problem if not. */
export function soundNameProblem(name: string, except: Id | null = null): string | null {
  const clean = name.trim();
  if (!clean) return 'A sound needs a name';
  const taken = useEditor.getState().project.assets.some((a) => a.kind === 'sound' && a.id !== except && a.name.toLowerCase() === clean.toLowerCase());
  return taken ? `There is already a sound called "${clean}"` : null;
}

/** Adds a sound made in the sound editor (one undo step); returns its id. */
export function addSound(name: string, sound: StepSound): Id {
  const id = generateId('snd');
  useEditor.getState().edit(`New sound ${name}`, (p) => {
    p.assets.push({ id, name: name.trim(), kind: 'sound', path: `assets/${id}.sound.json`, data: soundDataUrl(sound), width: 0, height: 0, synth: sound, description: 'Made in the sound editor' });
  });
  return id;
}

/** The sound's notes or speed changed. */
export function updateSound(id: Id, sound: StepSound, label: string): void {
  useEditor.getState().edit(label, (p) => {
    const a = p.assets.find((x) => x.id === id && x.kind === 'sound');
    if (!a) return;
    a.synth = sound;
    a.data = soundDataUrl(sound);
  });
}

/** Renames a sound (names are how scripts play it, so they stay unique). Returns an error, or null. */
export function renameSound(id: Id, name: string): string | null {
  const { project, edit } = useEditor.getState();
  const clean = name.trim();
  const problem = soundNameProblem(clean, id);
  if (problem) return problem;
  const a = project.assets.find((x) => x.id === id);
  if (!a || a.name === clean) return null;
  const old = a.name;
  edit(`Rename sound ${old}`, (p) => {
    const asset = p.assets.find((x) => x.id === id)!;
    asset.name = clean;
    // Scripts and rules play sounds by name: they follow the new one.
    for (const d of p.definitions) for (const sc of d.scripts ?? []) renameIn(sc, old, clean);
    for (const s of p.scenes) {
      for (const e of s.entities) for (const sc of e.scripts ?? []) renameIn(sc, old, clean);
      for (const r of s.rules) for (const act of r.actions) if (act.type === 'play_sound' && typeof act.sound === 'string' && act.sound.toLowerCase() === old.toLowerCase()) act.sound = clean;
    }
  });
  return null;
}

/** play_sound statements in a script that name the old sound now name the new one. */
function renameIn(node: unknown, old: string, next: string): void {
  if (Array.isArray(node)) {
    for (const x of node) renameIn(x, old, next);
    return;
  }
  if (!node || typeof node !== 'object') return;
  const o = node as Record<string, unknown>;
  if (o.do === 'play_sound' && typeof o.sound === 'string' && o.sound.toLowerCase() === old.toLowerCase()) o.sound = next;
  for (const v of Object.values(o)) if (v && typeof v === 'object') renameIn(v, old, next);
}
