import { describe, expect, it } from 'vitest';
import { SONG_IDEA_LISTS, songIdea, UNUSUAL_SONG_WORDS } from './songIdeas';
import { TOPICS } from './topics';

/** A repeatable random sequence. */
function seeded(seed: number): () => number {
  let s = seed;
  return () => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648);
}

describe('song briefs', () => {
  it('differ from song to song: time signatures, scales, progressions and melodic tricks', () => {
    const ideas = Array.from({ length: 40 }, (_, i) => songIdea(seeded(i + 1)));
    for (const k of ['meter', 'scale', 'progression', 'drums', 'form'] as const) expect(new Set(ideas.map((x) => x[k])).size).toBeGreaterThan(3);
    // Two melodic tricks, not the same one twice.
    for (const x of ideas) {
      expect(x.melody).toHaveLength(2);
      expect(x.melody[0]).not.toBe(x.melody[1]);
    }
    // Not only 4/4: 3/4 among the usual ones, with its steps a bar.
    expect(SONG_IDEA_LISTS.METERS.usual.some((m) => m.startsWith('3/4') && m.includes('12 steps'))).toBe(true);
  });

  it('the unusual choices (5/4, 7/8, Lydian, Phrygian, key changes…) only when the user asks for an unusual or original song', () => {
    const usual = Array.from({ length: 200 }, (_, i) => songIdea(seeded(i + 1)));
    const everyUnusual = Object.values(SONG_IDEA_LISTS).flatMap((l) => l.unusual);
    for (const x of usual) for (const v of [x.meter, x.scale, x.progression, x.drums, x.form, ...x.melody]) expect(everyUnusual).not.toContain(v);
    const wild = Array.from({ length: 200 }, (_, i) => songIdea(seeded(i + 1), true));
    expect(wild.some((x) => [x.meter, x.scale, x.progression, x.drums, x.form, ...x.melody].some((v) => everyUnusual.includes(v)))).toBe(true);
    expect(UNUSUAL_SONG_WORDS.test('make me happy music')).toBe(false);
    expect(UNUSUAL_SONG_WORDS.test('write a different happy song')).toBe(false);
    expect(UNUSUAL_SONG_WORDS.test('write something original and weird')).toBe(true);
    expect(UNUSUAL_SONG_WORDS.test('an unusual boss theme')).toBe(true);
  });

  it('the music guidance follows the brief and no longer prescribes one progression and one beat', () => {
    const text = TOPICS.music.text;
    expect(text).toContain('context.songIdea');
    expect(text).not.toMatch(/C–Am–F–G/);
    expect(text).not.toMatch(/kick on beats 0 and 8, snare on 4 and 12/);
  });
});
