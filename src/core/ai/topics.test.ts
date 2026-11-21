import { describe, expect, it } from 'vitest';
import { createBuiltinRegistry } from '../components/builtin';
import { buildSystemPrompt } from './capabilities';
import type { AIContext } from './context';
import { userMessage } from './prompt';
import { BOARD_GAME_WORDS, TOPICS, topicsFor } from './topics';
import { SCRIPT_LIMITS, SCRIPT_WORK } from '../script/language';

const level: AIContext = { kind: 'level', sceneId: 's', point: null };

describe('guidance only some requests need', () => {
  it('is not in the instructions sent with every request, only a pointer to it', () => {
    const prompt = buildSystemPrompt(createBuiltinRegistry());
    for (const [key, t] of Object.entries(TOPICS)) {
      expect(prompt).not.toContain(t.text.slice(0, 60));
      // (One the app puts in by itself needs no pointer: the AI never asks for it.)
      if (!t.internal) expect(prompt).toContain(`topic "${key}"`);
    }
  });

  it('goes with requests about it: from its card, or by the words in the request (or the one it follows up)', () => {
    expect(topicsFor({ kind: 'song', sceneId: 's', assetId: null }, 'make it faster')).toContain('music');
    expect(topicsFor({ kind: 'sound', sceneId: 's', assetId: null }, 'deeper')).toContain('sounds');
    expect(topicsFor(level, 'Add some background music to this level')).toEqual(expect.arrayContaining(['music', 'backgrounds']));
    expect(topicsFor(level, 'Make a Tetris game')).toContain('falling_blocks');
    expect(topicsFor(level, 'here is a retro space shooter. please make this game')).toContain('shooters');
    expect(topicsFor(level, 'make a platformer with coins')).not.toContain('shooters');
    expect(topicsFor(level, 'make a Lode Runner game')).toContain('enemies');
    expect(topicsFor(level, 'the enemies should walk like goombas')).toContain('enemies');
    expect(topicsFor(level, 'a game about a cat collecting yarn')).not.toContain('enemies');
    expect(topicsFor(level, 'a game about a cat collecting yarn', [], true)).toContain('enemies');
    expect(TOPICS.enemies.text).toContain('"Walker"');
    expect(TOPICS.enemies.text).toContain('turn_at_ledges false');
    expect(topicsFor(level, 'make it a turn-based game, one square per key press')).toContain('grid_games');
    expect(topicsFor(level, 'Make the player run faster')).toEqual([]);
    expect(topicsFor(level, 'a bit higher', [{ request: 'the coin plays a ding sound' }])).toContain('sounds');
  });

  it("a board game brings its own guidance: no course to get through, the board as its pieces, how big a script may be and how much it may do", () => {
    for (const ask of ['make a chess game', 'Tic-tac-toe against the computer', 'a board game for two', 'connect four', 'a solitaire card game']) expect(topicsFor(level, ask), ask).toContain('board_games');
    // (Chess is no walk from square to square: the stepping guidance of Rogue and Sokoban stays out of it.)
    expect(topicsFor(level, 'make a chess game')).not.toContain('grid_games');
    expect(topicsFor(level, 'make a chess game')).toContain('turns');
    // Every board game is played with the kit's cursor and menus, and none has enemies to choose.
    for (const ask of ['make me a cool tic-tac-toe game', 'connect four', 'a memory game']) expect(topicsFor(level, ask, [], true), ask).toEqual(expect.arrayContaining(['turns', 'board_games']));
    expect(topicsFor(level, 'make me a cool tic-tac-toe game', [], true)).not.toContain('enemies');
    expect(topicsFor(level, 'a platformer about a frog', [], true)).toContain('enemies');
    expect(topicsFor(level, 'a platformer about a frog', [], true)).not.toContain('turns');
    expect(topicsFor(level, 'a platformer with a checkered floor')).not.toContain('board_games');
    // (It goes on in the next request, which no longer says "chess".)
    expect(topicsFor(level, 'Build 2 more levels', [{ request: 'make a chess game' }])).toContain('board_games');
    const text = TOPICS.board_games.text;
    // The numbers are the checker's and the runtime's own.
    expect(text).toContain(`${SCRIPT_LIMITS.handlers} handlers, ${SCRIPT_LIMITS.vars} variables, ${SCRIPT_LIMITS.states} states, ${SCRIPT_LIMITS.statements} statements in all, nested ${SCRIPT_LIMITS.depth} deep, and ${SCRIPT_LIMITS.expression} characters in one expression`);
    expect(text).toContain('one run of a handler 200,000 statements, all scripts in one step 400,000, one each or repeat 2000 rounds');
    expect(SCRIPT_WORK).toEqual({ run: 200_000, step: 400_000, rounds: 2000 });
    expect(text).toMatch(/LEVELS of a board game are other boards or set-ups/);
    expect(text).toMatch(/no CharacterController, no goal/);
    expect(text).toMatch(/never one variable per square/);
    expect(BOARD_GAME_WORDS.test('a game of Chess')).toBe(true);
    expect(BOARD_GAME_WORDS.test('a chessboard-patterned platformer')).toBe(false);
  });

  it('is sent with the request it goes with', () => {
    const body = { context: {} as never, request: 'A song for level 1', history: [], topics: ['music'] };
    expect(userMessage(body)).toContain(TOPICS.music.text);
    expect(userMessage({ ...body, topics: [] })).not.toContain(TOPICS.music.text.slice(0, 60));
  });
});
