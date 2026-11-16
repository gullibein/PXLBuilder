/**
 * Ramp shapes (a Collider's shape): which way each rises, and from where to where in its square. A whole ramp rises
 * its full square (45°); a gentle one rises half of it, its lower half (Low) or its upper half (High): a Low and a
 * High side by side make a slope two squares long. Every system that knows ramps reads them here.
 */
export interface RampShape {
  /** 1: rises to the right, -1: to the left. */
  dir: 1 | -1;
  /** Its surface's height at its low side and its high side, as shares of its square. */
  lo: number;
  hi: number;
}

const RAMPS: Record<string, RampShape> = {
  slopeRight: { dir: 1, lo: 0, hi: 1 },
  slopeLeft: { dir: -1, lo: 0, hi: 1 },
  slopeRightLow: { dir: 1, lo: 0, hi: 0.5 },
  slopeRightHigh: { dir: 1, lo: 0.5, hi: 1 },
  slopeLeftLow: { dir: -1, lo: 0, hi: 0.5 },
  slopeLeftHigh: { dir: -1, lo: 0.5, hi: 1 },
};

export const RAMP_SHAPES = Object.keys(RAMPS);

/** The ramp a collider shape is, or null (a box, a circle…). */
export function rampOf(shape: unknown): RampShape | null {
  return typeof shape === 'string' ? (RAMPS[shape] ?? null) : null;
}

/** A whole (45°) ramp. */
export const wholeRamp = (shape: unknown): boolean => {
  const r = rampOf(shape);
  return !!r && r.lo === 0 && r.hi === 1;
};
