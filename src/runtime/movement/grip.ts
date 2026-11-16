/** PhysicsBody.friction when none is set: on such ground, grip is exactly as without friction at all. */
export const DEFAULT_FRICTION = 0.2;

/**
 * How much grip a character has on the ground, from its own friction and the surface's, each relative to the
 * default (both at the default: 1, as it always was). Its acceleration on the ground (speeding up, stopping,
 * turning) is scaled by this: an icy floor (0.05) or icy shoes make it slow to start and stop; a sticky floor
 * makes it snappier. Never quite nothing (it can still get going on ice) and at most 4 times.
 */
export function groundGrip(own: number, surface: number): number {
  return Math.min(4, Math.max(0.15, (own / DEFAULT_FRICTION) * (surface / DEFAULT_FRICTION)));
}
