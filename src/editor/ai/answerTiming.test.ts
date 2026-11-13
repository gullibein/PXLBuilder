import { describe, expect, it } from 'vitest';
import { answerTiming } from './runPrompt';

describe("an answer's time, in AI History", () => {
  it('before the first words, and the writing with how fast it went', () => {
    expect(answerTiming(0, 95_000, 132_000, 6500)).toBe('Timing: first words after 95.0 s (the AI working it out before it writes), then 6500 characters written in 37.0 s (176 a second)');
  });
  it('an answer that came all at once: the whole time', () => {
    expect(answerTiming(0, 0, 12_300, 0)).toBe("Timing: the answer came all at once after 12.3 s (this connection doesn't send it as it is written)");
  });
});
