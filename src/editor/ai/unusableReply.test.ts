import { describe, expect, it } from 'vitest';
import { unusableReply } from './aiLog';

const request = 'the player bounces too high when he dies. the death animation replays when the player respawns - that should not happen.';

describe('answers that are not answers', () => {
  it('an answer that only repeats the request, or is empty or tag junk, is unusable', () => {
    expect(unusableReply(request, request)).toBe(true);
    expect(unusableReply(request, `"${request.toUpperCase()}"`)).toBe(true);
    expect(unusableReply(request, '')).toBe(true);
    expect(unusableReply(request, '<invoke name="">\n</invoke>')).toBe(true);
  });

  it('a real answer is fine, also when it quotes the request in a longer reply or is short', () => {
    expect(unusableReply(request, 'The Player already does this: the engine waits 1 s where he died, then respawns him standing still.')).toBe(false);
    expect(unusableReply(request, `You asked: "${request}" The engine now handles all of this, so I removed the old workaround from the Death Hop script and set the respawn delay to 1.5 s.`)).toBe(false);
    expect(unusableReply('make it red', 'Done.')).toBe(false);
  });
});
