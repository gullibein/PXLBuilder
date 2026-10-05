import { describe, expect, it } from 'vitest';
import { createWheelInterpreter, type WheelLike } from './wheel';

const ev = (p: Partial<WheelLike>): WheelLike => ({ deltaX: 0, deltaY: 0, deltaMode: 0, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, timeStamp: 0, ...p });

describe('wheel interpretation', () => {
  it('two-finger trackpad scrolling pans, in both directions', () => {
    const read = createWheelInterpreter();
    expect(read(ev({ deltaY: 6 }))).toEqual({ kind: 'pan', dx: 0, dy: 6 });
    expect(read(ev({ deltaX: -12, deltaY: 3, timeStamp: 1000 }))).toEqual({ kind: 'pan', dx: -12, dy: 3 });
    expect(read(ev({ deltaY: 2.5, timeStamp: 2000 })).kind).toBe('pan');
  });

  it('a fast trackpad flick keeps panning even when deltas get large', () => {
    const read = createWheelInterpreter();
    read(ev({ deltaY: 8, timeStamp: 0 }));
    expect(read(ev({ deltaY: 120, timeStamp: 30 })).kind).toBe('pan');
    expect(read(ev({ deltaY: 100, timeStamp: 60 })).kind).toBe('pan');
  });

  it('pinch (ctrlKey) zooms in and out', () => {
    const read = createWheelInterpreter();
    const zoomIn = read(ev({ deltaY: -10, ctrlKey: true }));
    const zoomOut = read(ev({ deltaY: 10, ctrlKey: true }));
    expect(zoomIn.kind === 'zoom' && zoomIn.factor > 1).toBe(true);
    expect(zoomOut.kind === 'zoom' && zoomOut.factor < 1).toBe(true);
  });

  it('Alt + two-finger scroll zooms', () => {
    const read = createWheelInterpreter();
    const r = read(ev({ deltaY: -8, altKey: true }));
    expect(r.kind === 'zoom' && r.factor > 1).toBe(true);
  });

  it('a mouse wheel notch zooms; line-mode wheels too', () => {
    const read = createWheelInterpreter();
    const r = read(ev({ deltaY: 100, timeStamp: 5000 }));
    expect(r.kind === 'zoom' && r.factor < 1).toBe(true);
    expect(read(ev({ deltaY: -3, deltaMode: 1, timeStamp: 9000 })).kind).toBe('zoom');
  });

  it('Shift + mouse wheel pans sideways', () => {
    const read = createWheelInterpreter();
    expect(read(ev({ deltaY: 100, shiftKey: true, timeStamp: 5000 }))).toEqual({ kind: 'pan', dx: 100, dy: 0 });
  });

  it('Alt + mouse wheel zooms by the same moderate step as the plain wheel', () => {
    const read = createWheelInterpreter();
    const plain = read(ev({ deltaY: -100, timeStamp: 5000 }));
    const alt = read(ev({ deltaY: -100, altKey: true, timeStamp: 6000 }));
    expect(alt).toEqual(plain);
    expect(alt.kind === 'zoom' && alt.factor).toBeGreaterThan(1.1);
    expect(alt.kind === 'zoom' && alt.factor).toBeLessThan(1.2);
    // Alt on a horizontal axis (some browsers) works the same.
    expect(read(ev({ deltaX: -100, altKey: true, timeStamp: 7000 }))).toEqual(plain);
  });

  it('a fast-spun or accelerated wheel is capped per event', () => {
    const read = createWheelInterpreter();
    const notch = read(ev({ deltaY: 100, timeStamp: 5000 }));
    const spin = read(ev({ deltaY: 600, altKey: true, timeStamp: 6000 }));
    expect(spin).toEqual(notch);
  });

  it('mouse zoom speed can be tuned', () => {
    const read = createWheelInterpreter(() => 0.5);
    const r = read(ev({ deltaY: -100, timeStamp: 5000 }));
    expect(r.kind === 'zoom' && r.factor).toBeCloseTo(Math.exp(0.065), 5);
  });
});
