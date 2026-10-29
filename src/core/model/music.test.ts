import { produce } from 'immer';
import { describe, expect, it } from 'vitest';
import { buildAIPayload } from '../ai/context';
import { applyOperations, type Operation } from '../commands/operations';
import { createBuiltinRegistry } from '../components/builtin';
import { checkScript } from '../script/language';
import { setScript } from '../script/mutations';
import { projectFromBundle, projectToBundle } from '../serialization/serialize';
import { InputState } from '../../runtime/input';
import { Runtime } from '../../runtime/runtime';
import { createProject, instantiateDefinition } from './factory';
import { addEntity } from './mutations';
import { removeMusicAsset, renameMusicAsset } from './music';
import { emptySong, STARTER_KITS } from '../audio/music';
import type { Project } from '../types';

const registry = createBuiltinRegistry();
const apply = (p: Project, ops: unknown[]) => produce(p, (d) => void applyOperations(d, ops as Operation[], registry));

const LEAD = '{"chip":"8bit","wave":"pulse25","decay":0.2,"sustain":0.5}';
const KICK = '{"chip":"8bit","wave":"triangle","attack":0,"decay":0.12,"sustain":0,"pitchDrop":24,"pitchTime":0.07}';
const SONG = JSON.stringify({
  bpm: 130,
  steps: 16,
  channels: [{ instrument: 'Lead' }, { instrument: 'kick' }],
  patterns: [
    { name: 'A', notes: [[0, 0, 'C5', 2, 1], [0, 4, 76, 2], [1, 0, 36, 1, 1], [1, 8, 36, 1, 1]] },
    { name: 'B', notes: [[0, 0, 'G4', 4, 1]] },
  ],
  order: [0, 0, 1],
});

function withMusic() {
  const project = createProject(registry);
  const sceneId = project.scenes[0].id;
  const made = apply(project, [
    { op: 'make_instrument', name: 'Lead', description: 'a thin chip lead', instrumentJson: LEAD, replaceId: null },
    { op: 'make_instrument', name: 'Kick', description: 'a chip kick', instrumentJson: KICK, replaceId: null },
    { op: 'make_song', name: 'Theme', description: 'the level tune', songJson: SONG, replaceId: null },
    { op: 'set_level_music', sceneId, music: 'Theme' },
  ]);
  return { project: made, sceneId, song: made.assets.find((a) => a.kind === 'music')! };
}

describe('music in the game', () => {
  it('the AI makes instruments, a song that names them, and the level music', () => {
    const { project, sceneId, song } = withMusic();
    const lead = project.assets.find((a) => a.name === 'Lead')!;
    const kick = project.assets.find((a) => a.name === 'Kick')!;
    expect(lead.kind).toBe('instrument');
    expect(lead.instrument).toMatchObject({ chip: '8bit', wave: 'pulse25', sustain: 0.5, release: 0.08 });
    expect(song.name).toBe('Theme');
    expect(song.song!.channels.map((c) => c.instrument)).toEqual([lead.id, kick.id]);
    // Note names become MIDI numbers, a missing velocity is filled in.
    expect(song.song!.patterns[0].notes[0]).toEqual([0, 0, 72, 2, 1]);
    expect(song.song!.patterns[0].notes[1]).toEqual([0, 4, 76, 2, 0.8]);
    expect(project.scenes.find((s) => s.id === sceneId)!.music).toBe(song.id);
  });

  it('refuses what cannot work, saying why', () => {
    const { project } = withMusic();
    const tryOps = (ops: unknown[]) => () => apply(project, ops);
    expect(tryOps([{ op: 'make_instrument', name: 'Bell', description: '', instrumentJson: '{"chip":"8bit","wave":"fm"}', replaceId: null }])).toThrow(/no "fm" wave/);
    expect(tryOps([{ op: 'make_instrument', name: 'lead', description: '', instrumentJson: LEAD, replaceId: null }])).toThrow(/already an instrument called/);
    expect(tryOps([{ op: 'make_song', name: 'X', description: '', songJson: SONG.replace('"kick"', '"Tuba"'), replaceId: null }])).toThrow(/instrument "Tuba"/);
    expect(tryOps([{ op: 'make_song', name: 'X', description: '', songJson: SONG.replace('[0, 0, 1]', '[0, 5]').replace('[0,0,1]', '[0,5]'), replaceId: null }])).toThrow(/pattern 5/);
    expect(tryOps([{ op: 'set_level_music', sceneId: project.scenes[0].id, music: 'Nope' }])).toThrow(/no song "Nope"/);
  });

  it('a song is rewritten in place (same asset), keeping what plays it', () => {
    const { project, song } = withMusic();
    const faster = apply(project, [{ op: 'make_song', name: 'Theme', description: 'faster', songJson: SONG.replace('"bpm":130', '"bpm":180'), replaceId: song.id }]);
    expect(faster.assets.filter((a) => a.kind === 'music')).toHaveLength(1);
    expect(faster.assets.find((a) => a.id === song.id)!.song!.bpm).toBe(180);
    expect(faster.scenes[0].music).toBe(song.id);
  });

  it('instruments, songs and level music are saved and loaded', () => {
    const { project, song } = withMusic();
    const loaded = projectFromBundle(JSON.parse(JSON.stringify(projectToBundle(project))), registry);
    expect(loaded.project.scenes[0].music).toBe(song.id);
    expect(loaded.project.assets.find((a) => a.id === song.id)!.song).toEqual(song.song);
    expect(loaded.project.assets.find((a) => a.name === 'Lead')!.instrument).toEqual(project.assets.find((a) => a.name === 'Lead')!.instrument);
  });

  it('deleting an instrument silences its channels; deleting a song takes it off its levels', () => {
    const { project, song } = withMusic();
    const lead = project.assets.find((a) => a.name === 'Lead')!;
    const d = structuredClone(project);
    removeMusicAsset(d, lead.id);
    expect(d.assets.find((a) => a.id === song.id)!.song!.channels[0].instrument).toBeNull();
    removeMusicAsset(d, song.id);
    expect(d.scenes[0].music).toBeNull();
  });

  it('scripts play and stop music by name; renaming a song keeps them working', () => {
    const { project, song } = withMusic();
    expect(checkScript({ id: 'scr_boss', name: 'Boss', description: '', enabled: true, vars: [], states: [], handlers: [{ when: { on: 'start' }, do: [{ do: 'play_music', music: 'Nope' }] }] }, project)).toEqual({ error: expect.stringContaining('no song "Nope" (songs: Theme)') });
    const d = structuredClone(project);
    const player = d.definitions.find((x) => x.name === 'Player')!;
    setScript(d, { target: 'definition', id: player.id }, { name: 'Music', handlers: [{ when: { on: 'start' }, do: [{ do: 'stop_music' }] }, { when: { on: 'key', key: 'fire' }, do: [{ do: 'play_music', music: 'theme' }] }] });
    addEntity(d, d.scenes[0].id, instantiateDefinition(player, { x: 0, y: 0 }));
    expect(renameMusicAsset(d, song.id, 'Boss theme')).toBeNull();
    expect(JSON.stringify(player.scripts)).toContain('"music":"Boss theme"');
    const rt = new Runtime(d, d.scenes[0].id, registry);
    const input = new InputState();
    rt.update(1 / 60, input);
    expect(rt.musicRequest).toEqual({ assetId: null });
    rt.musicRequest = null;
    input.press('fire');
    rt.update(1 / 60, input);
    expect(rt.musicRequest).toEqual({ assetId: song.id });
  });

  it('the AI sees the instruments, the songs (channels by instrument name) and the level music', () => {
    const { project, sceneId } = withMusic();
    const payload = buildAIPayload(project, { kind: 'level', sceneId, point: null }, registry);
    expect(payload.music.levelMusic).toBe('Theme');
    expect(payload.music.instruments.map((i) => i.name)).toEqual(['Lead', 'Kick']);
    expect(payload.music.songs[0]).toMatchObject({ name: 'Theme', playsIn: [project.scenes[0].name], song: { bpm: 130, channels: [{ instrument: 'Lead' }, { instrument: 'Kick' }] } });
  });

  it('edit_song changes only what it names: the drums of one pattern, leaving the melody as it was', () => {
    const { project, song } = withMusic();
    // Channel 1 (Kick) becomes a drum channel, and gets a new beat in pattern 0; the lead's notes stay.
    const changed = apply(project, [{ op: 'edit_song', id: song.id, changesJson: JSON.stringify({ channels: [{ index: 1, drum: true }], patterns: [{ index: 0, channels: [1], notes: [[1, 0, 36, 1, 1], [1, 4, 36, 1], [1, 8, 'C2', 1, 1], [1, 12, 36, 1, 1]] }] }) }]);
    const s = changed.assets.find((a) => a.id === song.id)!.song!;
    expect(s.channels[1].drum).toBe(true);
    expect(s.patterns[0].notes.filter((n) => n[0] === 1).map((n) => n[1])).toEqual([0, 4, 8, 12]);
    expect(s.patterns[0].notes.filter((n) => n[0] === 0)).toEqual(song.song!.patterns[0].notes.filter((n) => n[0] === 0));
    expect(s.patterns[1]).toEqual(song.song!.patterns[1]);
    expect(s.bpm).toBe(130);
  });

  it('edit_song adds channels and patterns, changes the order and tempo, and removes things', () => {
    const { project, song } = withMusic();
    const changed = apply(project, [
      { op: 'edit_song', id: 'Theme', changesJson: JSON.stringify({ bpm: 100, channels: [{ instrument: 'lead', volume: 0.5 }, { index: 1, remove: true }], patterns: [{ index: 2, name: 'C', notes: [[0, 0, 'E5', 4, 1]] }, { index: 1, remove: true }], order: [0, 1, 2, 0] }) },
    ]);
    const s = changed.assets.find((a) => a.id === song.id)!.song!;
    expect(s.bpm).toBe(100);
    // The kick channel went: the new lead channel (added at the end) moved up to 1.
    expect(s.channels.map((c) => c.name)).toEqual(['Lead', 'Lead']);
    expect(s.channels[1].volume).toBe(0.5);
    expect(s.patterns.map((p) => p.name)).toEqual(['A', 'C']);
    // Pattern 1 (B) went: the order loses it and C is now 1.
    expect(s.order).toEqual([0, 1, 0]);
    expect(s.patterns[0].notes.every((n) => n[0] === 0)).toBe(true);
  });

  it('edit_song says what is wrong', () => {
    const { project, song } = withMusic();
    const tryEdit = (changes: unknown) => () => apply(project, [{ op: 'edit_song', id: song.id, changesJson: JSON.stringify(changes) }]);
    expect(tryEdit({ patterns: [{ index: 0, channels: [1], notes: [[0, 0, 60, 1, 1]] }] })).toThrow(/only for channels 1/);
    expect(tryEdit({ channels: [{ index: 7, volume: 1 }] })).toThrow(/no channel 7/);
    expect(tryEdit({ channels: [{ instrument: 'Tuba' }] })).toThrow(/no instrument "Tuba"/);
    expect(tryEdit({ patterns: [{ index: 0, notes: [[0, 0, 'H9', 1, 1]] }] })).toThrow(/not a note/);
  });

  it('reshaping an instrument keeps every setting it does not mention', () => {
    const { project } = withMusic();
    const lead = project.assets.find((a) => a.name === 'Lead')!;
    const changed = apply(project, [{ op: 'make_instrument', name: 'Lead', description: 'with vibrato', instrumentJson: '{"vibratoRate":6,"vibratoDepth":0.3}', replaceId: lead.id }]);
    const inst = changed.assets.find((a) => a.id === lead.id)!.instrument!;
    expect(inst).toMatchObject({ chip: '8bit', wave: 'pulse25', sustain: 0.5, vibratoRate: 6, vibratoDepth: 0.3 });
  });

  it('the song and instrument prompts send the open one in full (channels by index and instrument name)', () => {
    const { project, sceneId, song } = withMusic();
    const p = buildAIPayload(project, { kind: 'song', sceneId, assetId: song.id }, registry);
    expect(p.scope).toBe('song');
    expect(p.song).toMatchObject({ id: song.id, name: 'Theme', song: { channels: [{ index: 0, instrument: 'Lead' }, { index: 1, instrument: 'Kick' }] } });
    const lead = project.assets.find((a) => a.name === 'Lead')!;
    const q = buildAIPayload(project, { kind: 'instrument', sceneId, assetId: lead.id }, registry);
    expect(q.instrument).toMatchObject({ id: lead.id, playedBy: ['Theme'], instrument: { wave: 'pulse25' } });
    expect(buildAIPayload(project, { kind: 'song', sceneId, assetId: null }, registry).song).toBeNull();
  });

  it('a new song has three instrument channels and three drum channels', () => {
    const kit = [...STARTER_KITS['8bit'].instruments.map((name) => ({ id: name, name })), ...STARTER_KITS['8bit'].drums.map((name) => ({ id: name, name, drum: true }))];
    expect(emptySong(kit).channels.map((c) => c.drum)).toEqual([false, false, false, true, true, true]);
  });
});
