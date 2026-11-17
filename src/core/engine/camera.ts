/**
 * Which camera behaviours a game has (docs/engine-architecture-proposal.md §20), in the same four steps as its
 * geometry (engine/geometry.ts): registered (a behaviour exists), selected (the profile lists it), supported (what
 * it requires is given by the profile's other modules), active (what the camera in play does: the supported ones,
 * in the profile's order). What a game uses whose behaviour isn't active works in the stated lesser way (`without`),
 * and the compatibility report says so.
 *
 * Data only, so the runtime and the exported player can ask it; the behaviours themselves are in runtime/camera.
 */
import type { GameType } from '../types';
import { profileTags, statusOf, type GeometryKind, type GeometryStatus } from './geometry';
import { inferProfileFromObjects } from './infer';
import { gameProfileSchema, type GameProfile } from './profileSchema';

export const CAMERA_BEHAVIORS: GeometryKind[] = [
  { id: 'follow', version: 2, describe: "Follows the object with a Camera Target (smoothing, look-ahead the way it faces, a dead zone, the level's edges)", requires: [], without: 'the camera stays still (on its fixed point, or the middle of the level)' },
  {
    id: 'velocity_look_ahead',
    version: 1,
    describe: 'Looks further ahead the faster its target moves (fast games: more of what is coming)',
    requires: ['camera:follow'],
    fallback: { 'camera:follow': 'without "follow" there is nothing to look ahead of: it does nothing' },
    without: 'the camera looks ahead only as far as its fixed look-ahead setting',
  },
  {
    id: 'rooms',
    version: 1,
    describe: 'Camera zones: the view is held inside the zone its target is in, and slides or cuts to the next (rooms, screens, arenas)',
    requires: ['view:side|view:top'],
    fallback: { 'view:side|view:top': 'seen at an angle (isometric), camera zones are not used' },
    without: 'camera zones are not used (the camera goes through them)',
  },
];

/** The four steps for a profile's camera. */
export function cameraStatus(p: GameProfile, provided: ReadonlySet<string> = profileTags(p)): GeometryStatus {
  return statusOf(CAMERA_BEHAVIORS, p.camera, provided);
}

type Def = { name: string; components: Record<string, unknown>; scripts?: unknown };

/** The camera behaviours a game's objects use (whatever its profile says), with the objects using each. */
export function cameraUsed(definitions: readonly Def[]): Map<string, string[]> {
  const used = new Map<string, string[]>();
  for (const d of definitions) {
    const id = d.components.CameraZone ? 'rooms' : d.components.CameraTarget ? 'follow' : null;
    if (id) used.set(id, [...(used.get(id) ?? []), d.name]);
  }
  return used;
}

/** What the game's objects use that its profile's camera doesn't make active, and what happens instead. */
export function cameraNotes(p: GameProfile, definitions: readonly Def[], provided?: ReadonlySet<string>): string[] {
  const status = cameraStatus(p, provided);
  const notes: string[] = [];
  for (const [id, names] of cameraUsed(definitions)) {
    if (status.active.includes(id)) continue;
    const b = CAMERA_BEHAVIORS.find((x) => x.id === id)!;
    const why = status.unsupported.find((u) => u.id === id)?.why ?? `the game's profile doesn't select the camera behaviour "${id}"`;
    notes.push(`${names.slice(0, 3).join(', ')}${names.length > 3 ? '…' : ''}: ${why}, so ${b.without}`);
  }
  return notes;
}

/** The active camera behaviours of a game, in order: its stored profile's, else the one worked out from its objects. */
export function gameCamera(project: { definitions: Def[]; settings: { profile?: unknown; gameType?: GameType } }): string[] {
  const stored = gameProfileSchema.safeParse(project.settings.profile);
  return cameraStatus(stored.success ? stored.data : inferProfileFromObjects(project as Parameters<typeof inferProfileFromObjects>[0])).active;
}
