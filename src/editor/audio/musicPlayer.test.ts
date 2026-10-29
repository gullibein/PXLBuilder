import { afterEach, describe, expect, it, vi } from 'vitest';
import { emptySong, preset, type Song } from '../../core/audio/music';
import { playSong } from './musicPlayer';

/** A stand-in audio context with a clock the test moves; it records when each pattern's audio was started. */
function fakeAudio() {
  const starts: { when: number; offset: number; length: number }[] = [];
  const node = () => ({ connect: () => undefined, disconnect: () => undefined, gain: { value: 1, setTargetAtTime: () => undefined }, threshold: { value: 0 }, knee: { value: 0 }, ratio: { value: 0 }, attack: { value: 0 }, release: { value: 0 } });
  const ac = {
    currentTime: 0,
    destination: {},
    createGain: node,
    createDynamicsCompressor: node,
    createBuffer: (_ch: number, length: number) => ({ length, getChannelData: () => new Float32Array(length) }),
    createBufferSource() {
      const src = {
        buffer: null as { length: number } | null,
        onended: null,
        connect: () => undefined,
        start: (when: number, offset = 0) => starts.push({ when, offset, length: src.buffer!.length }),
        stop: () => undefined,
      };
      return src;
    },
  };
  return { ac: ac as unknown as AudioContext & { currentTime: number }, starts };
}

function song(): Song {
  const s = emptySong([{ id: 'lead', name: 'Lead' }], 150);
  s.patterns = ['A', 'B', 'C'].map((name, p) => ({ name, notes: Array.from({ length: 16 }, (_, i) => [0, i, 60 + p + (i % 5), 1, 0.8] as [number, number, number, number, number]) }));
  s.order = [0, 1, 2, 1];
  return s;
}

afterEach(() => vi.useRealTimers());

describe('song player', () => {
  it('queues the patterns back to back, to the sample, even when its timer runs late now and then', () => {
    vi.useFakeTimers();
    const { ac, starts } = fakeAudio();
    const lead = preset('Square lead');
    const s = song();
    const player = playSong(s, () => lead, { loop: true }, ac)!;
    const length = (60 / s.bpm / 4) * s.steps;
    // Six seconds, the timer sometimes held up (a busy frame) for up to a quarter of a second.
    for (let t = 0; t < 6; t += 0.025) {
      ac.currentTime = t;
      vi.advanceTimersByTime(t % 1 < 0.05 ? 250 : 25);
    }
    player.stop();
    expect(starts.length).toBeGreaterThanOrEqual(4);
    for (const [i, st] of starts.entries()) {
      expect(st.offset).toBe(0);
      if (i > 0) expect(st.when - starts[i - 1].when).toBeCloseTo(length, 9);
    }
  });

  it('after the page was asleep a long time, it goes on from where the song is now (no burst of missed patterns)', () => {
    vi.useFakeTimers();
    const { ac, starts } = fakeAudio();
    const lead = preset('Square lead');
    const player = playSong(song(), () => lead, { loop: true }, ac)!;
    vi.advanceTimersByTime(25);
    const before = starts.length;
    ac.currentTime = 120;
    vi.advanceTimersByTime(25);
    player.stop();
    const after = starts.slice(before);
    // Only what plays from now on was queued, at most one pattern already under way.
    expect(after.filter((x) => x.when < 120).length).toBeLessThanOrEqual(1);
    expect(after.length).toBeLessThan(6);
  });
});
