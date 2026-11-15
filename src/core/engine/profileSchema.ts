/**
 * A game's profile: which module of each engine system the game uses, with its settings (docs/engine-architecture-
 * proposal.md). Stored in settings.profile. Module ids are plain strings, so a game naming a module this editor
 * doesn't know still loads (the compatibility check says so); nothing here depends on the modules themselves.
 */
import { z } from 'zod';

export const gameProfileSchema = z.object({
  version: z.literal(1),
  /** The preset it started from (data, engine/presets.ts); null: put together by hand. */
  preset: z.string().nullable(),
  /** How the world is seen: side, top, iso. */
  view: z.string().min(1),
  /** How time passes: realtime, turns. */
  time: z.string().min(1),
  /** How the player moves: a locomotion model, and abilities on top of it. */
  movement: z.object({ model: z.string().min(1), abilities: z.array(z.string()) }),
  /** The kinds of collision geometry the game's levels use. */
  geometry: z.array(z.string()),
  /** Camera behaviours, applied in order. */
  camera: z.array(z.string()),
  /** The object kits the game was made from (the first is its base). */
  kits: z.array(z.string()).min(1),
  /** What builds its levels (null: none: levels made by hand or by the AI), with its settings (sections: genre). */
  generator: z.object({ id: z.string().nullable(), settings: z.record(z.string(), z.unknown()) }),
  /** How its levels hang together. */
  progression: z.object({ model: z.string().min(1) }),
  /** Its look (a theme id: levelGen/profile.ts THEMES), null: not chosen. */
  theme: z.string().nullable(),
});

export type GameProfile = z.infer<typeof gameProfileSchema>;
