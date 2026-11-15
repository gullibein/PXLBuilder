/**
 * The level-builder roles the objects of each kit play, declared by the kit (by the object's starter name). The
 * level builder still recognises objects by what they are (levelGen/roles.ts) for objects drawn by the user or the
 * AI; a declared role counts as well, so a kit object keeps its part however it is changed. Data only: no imports.
 */
import type { Role } from '../levelGen/roles';

export const KIT_ROLES: Record<string, Partial<Record<string, Role>>> = {
  platformer: {
    Player: 'player',
    Goal: 'goal',
    Door: 'door',
    'Pressure plate': 'plate',
    Switch: 'switch',
    Ladder: 'ladder',
    Crate: 'crate',
    'Deep water': 'deepWater',
    Water: 'water',
    Spring: 'spring',
    'Question block': 'block',
    Brick: 'brick',
    Enemy: 'enemy',
    Hazard: 'hazard',
    Key: 'key',
    Heart: 'heart',
    Coin: 'coin',
    Teleporter: 'teleporter',
    Ramp: 'rampRight',
    'Ramp left': 'rampLeft',
    Bridge: 'oneway',
    'Pipe top': 'pipeTop',
    Pipe: 'pipe',
    Platform: 'ground',
    Stone: 'ledge',
  },
  // (The top-down kits all build on the top-down starter objects: the same names and parts.)
  topdown: { Player: 'player', Goal: 'goal', Key: 'key', Door: 'door', Coin: 'coin', Switch: 'switch', Teleporter: 'teleporter', Hazard: 'hazard', Enemy: 'enemy' },
};
