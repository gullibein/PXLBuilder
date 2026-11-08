import { describe, expect, it } from 'vitest';
import { SONG_IDEA_LISTS, songIdea } from './songIdeas';
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
    // Not only 4/4: odd and compound meters are among them, with their steps a bar.
    expect(SONG_IDEA_LISTS.METERS.some((m) => m.startsWith('5/4') && m.includes('20 steps'))).toBe(true);
    expect(SONG_IDEA_LISTS.METERS.some((m) => m.startsWith('3/4') && m.includes('12 steps'))).toBe(true);
  });

  it('the music guidance follows the brief and no longer prescribes one progression and one beat', () => {
    const text = TOPICS.music.text;
    expect(text).toContain('context.songIdea');
    expect(text).not.toMatch(/C–Am–F–G/);
    expect(text).not.toMatch(/kick on beats 0 and 8, snare on 4 and 12/);
  });
});
