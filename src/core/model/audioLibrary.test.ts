import { produce } from 'immer';
import { describe, expect, it } from 'vitest';
import { emptySong, makeInstrument } from '../audio/music';
import { createBuiltinRegistry } from '../components/builtin';
import { addLibraryItem, libraryItemOf } from './audioLibrary';
import { createProject } from './factory';
import { addInstrumentAsset, addSongAsset } from './music';

const registry = createBuiltinRegistry();

function gameWithMusic() {
  let songId = '';
  let leadId = '';
  const project = produce(createProject(registry), (p) => {
    leadId = addInstrumentAsset(p, 'Sunny pluck', makeInstrument({ chip: '16bit', wave: 'pluck', decay: 0.4 }));
    const bass = addInstrumentAsset(p, 'Round bass', makeInstrument({ chip: '16bit', wave: 'sine' }));
    const song = emptySong([{ id: leadId, name: 'Lead' }, { id: bass, name: 'Bass' }], 110, '16bit');
    song.patterns[0].notes.push([0, 0, 72, 2, 0.8], [1, 0, 48, 4, 0.7]);
    songId = addSongAsset(p, 'Happy walk', song);
    p.assets.push({ id: 'snd_boing', name: 'Boing', kind: 'sound', path: 'assets/snd_boing.sound.json', data: 'data:,', width: 0, height: 0, synth: { type: 'steps', speed: 8, smooth: 0, notes: [[30, 1, 5, 0]] } as never });
  });
  return { project, songId, leadId };
}

describe('your library of sounds, instruments and songs (for other games)', () => {
  it('a song goes with its instruments into another game, playing them there', () => {
    const { project, songId } = gameWithMusic();
    const item = libraryItemOf(project, songId)!;
    expect(item.kind).toBe('song');
    expect(item.name).toBe('Happy walk');
    const other = createProject(registry);
    let added = '';
    const after = produce(other, (p) => void (added = addLibraryItem(p, item)));
    const song = after.assets.find((a) => a.id === added)!;
    expect(song.name).toBe('Happy walk');
    expect(song.song!.chip).toBe('16bit');
    expect(song.song!.patterns[0].notes).toHaveLength(2);
    // Its channels play the instruments that came with it, now this game's own.
    const names = song.song!.channels.map((c) => after.assets.find((a) => a.id === c.instrument)?.name);
    expect(names).toEqual(['Sunny pluck', 'Round bass']);
    // Added again: the very same instruments are reused (not doubled), the song gets a name of its own.
    let again = '';
    const twice = produce(after, (p) => void (again = addLibraryItem(p, item)));
    expect(twice.assets.filter((a) => a.kind === 'instrument' && a.name === 'Sunny pluck')).toHaveLength(1);
    expect(twice.assets.find((a) => a.id === again)!.name).toBe('Happy walk 2');
  });

  it('a sound and an instrument too', () => {
    const { project, leadId } = gameWithMusic();
    const sound = libraryItemOf(project, 'snd_boing')!;
    const inst = libraryItemOf(project, leadId)!;
    expect([sound.kind, inst.kind]).toEqual(['sound', 'instrument']);
    const other = createProject(registry);
    let s = '';
    let i = '';
    const after = produce(other, (p) => {
      s = addLibraryItem(p, sound);
      i = addLibraryItem(p, inst);
    });
    expect(after.assets.find((a) => a.id === s)).toMatchObject({ kind: 'sound', name: 'Boing' });
    expect(after.assets.find((a) => a.id === s)!.synth).toEqual(project.assets.find((a) => a.id === 'snd_boing')!.synth);
    expect(after.assets.find((a) => a.id === i)!.instrument).toEqual(project.assets.find((a) => a.id === leadId)!.instrument);
    // Not a sound, instrument or song: nothing to save.
    expect(libraryItemOf(project, project.assets.find((a) => a.kind === 'image')?.id ?? 'none')).toBeNull();
  });
});
