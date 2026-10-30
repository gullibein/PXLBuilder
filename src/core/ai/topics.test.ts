import { describe, expect, it } from 'vitest';
import { createBuiltinRegistry } from '../components/builtin';
import { buildSystemPrompt } from './capabilities';
import type { AIContext } from './context';
import { userMessage } from './prompt';
import { TOPICS, topicsFor } from './topics';

const level: AIContext = { kind: 'level', sceneId: 's', point: null };

describe('guidance only some requests need', () => {
  it('is not in the instructions sent with every request, only a pointer to it', () => {
    const prompt = buildSystemPrompt(createBuiltinRegistry());
    for (const [key, t] of Object.entries(TOPICS)) {
      expect(prompt).not.toContain(t.text.slice(0, 60));
      expect(prompt).toContain(`topic "${key}"`);
    }
  });

  it('goes with requests about it: from its card, or by the words in the request (or the one it follows up)', () => {
    expect(topicsFor({ kind: 'song', sceneId: 's', assetId: null }, 'make it faster')).toContain('music');
    expect(topicsFor({ kind: 'sound', sceneId: 's', assetId: null }, 'deeper')).toContain('sounds');
    expect(topicsFor(level, 'Add some background music to this level')).toEqual(expect.arrayContaining(['music', 'backgrounds']));
    expect(topicsFor(level, 'Make a Tetris game')).toContain('falling_blocks');
    expect(topicsFor(level, 'make it a turn-based game, one square per key press')).toContain('grid_games');
    expect(topicsFor(level, 'Make the player run faster')).toEqual([]);
    expect(topicsFor(level, 'a bit higher', [{ request: 'the coin plays a ding sound' }])).toContain('sounds');
  });

  it('is sent with the request it goes with', () => {
    const body = { context: {} as never, request: 'A song for level 1', history: [], topics: ['music'] };
    expect(userMessage(body)).toContain(TOPICS.music.text);
    expect(userMessage({ ...body, topics: [] })).not.toContain(TOPICS.music.text.slice(0, 60));
  });
});
