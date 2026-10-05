/**
 * How far a character can jump, from its Character Controller and gravity.
 * A full jump (button held) rises jumpForce²/(2g); with a running start it
 * covers speed × airtime (2·jumpForce/g) before landing at the same height.
 * Used by the editor's jump guides and to tell the AI what a level must allow.
 */
import type { ComponentMap } from '../types';

export interface Reach {
  height: number;
  distance: number;
  speed: number;
  jumpForce: number;
  gravity: number;
}

export function characterReach(components: ComponentMap, worldGravityY: number): Reach | null {
  const cc = components.CharacterController;
  const scale = typeof components.PhysicsBody?.gravityScale === 'number' ? components.PhysicsBody.gravityScale : 1;
  const g = worldGravityY * scale;
  const jf = cc?.jumpForce;
  const speed = cc?.speed;
  if (!cc || !(g > 0) || typeof jf !== 'number' || typeof speed !== 'number') return null;
  return { height: (jf * jf) / (2 * g), distance: (speed * 2 * jf) / g, speed, jumpForce: jf, gravity: g };
}
