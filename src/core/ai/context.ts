/**
 * AI context.
 *
 * The editor's selection establishes an explicit AIContext ("what the user is
 * working with"). buildAIPayload turns it into the small, relevant slice of
 * the project the model needs: the targets in full, everything else in brief.
 * The model never receives the raw project file.
 */
import { generateDungeon } from '../model/dungeon';
import { panelOf, type ObjectPanel } from '../model/panels';
import { ENGINE_PART_INFO } from '../model/engineParts';
import type { EnginePart } from '../script/language';
import { songChip, songSeconds, type Instrument } from '../audio/music';
import type { SongIdea } from './songIdeas';
import { soundLength } from '../audio/sound';
import { audibleNotes, isStepSound, type StepSound } from '../audio/steps';
import type { ComponentRegistry } from '../components/registry';
import { diagnoseLevel, type Problem } from '../debug/diagnose';
import { summarizePlay, type PlayReport, type PlaySummary } from '../debug/playReport';
import { boundsOf, type CameraBounds, type CameraSettings } from '../model/camera';
import { describeRelationship, describeRule } from '../logic/describe';
import { autotileLabel } from '../model/autotile';
import { instantiateDefinition } from '../model/factory';
import { getEntitySize } from '../model/geometry';
import { levelMap, type LevelMap } from '../model/levelMap';
import { LEVEL_CELL } from '../model/placement';
import { levelDesignIdea, type LevelDesignIdea } from './levelIdeas';
import { isTopDownScene } from '../model/topDown';
import { characterReach } from '../model/reach';
import { gridFor } from '../model/spriteResolution';
import { isoShapesOf } from '../model/isoShapes';
import { getDefinitionSprites } from '../model/mutations';
import { resolveEntity } from '../model/resolve';
import type { BehaviorScript, Condition, EntityRef, Id, Project, Relationship, Rule, RuleAction, Scene, Vec2 } from '../types';

export type AIContext =
  /** One selected entity. */
  | { kind: 'entity'; sceneId: Id; entityIds: [Id] }
  /** Three or more selected entities, addressed together. */
  | { kind: 'group'; sceneId: Id; entityIds: Id[] }
  /** Exactly two selected entities: the request is usually about how they relate. Order = selection order. */
  | { kind: 'pair'; sceneId: Id; entityIds: [Id, Id] }
  /**
   * The level itself (world settings, all of its contents). `point` is where the user pointed, if anywhere. `camera`:
   * asked from the level's camera outline (its own conversation, about the camera).
   */
  | { kind: 'level'; sceneId: Id; point: Vec2 | null; camera?: 'start' | 'limits' }
  /** The level's background (color, image, how it moves). */
  | { kind: 'background'; sceneId: Id }
  /** The whole game. */
  | { kind: 'project'; sceneId: Id }
  /** Creating a new object for the library. */
  | { kind: 'create'; sceneId: Id }
  /** One connection (relationship) the user clicked on, e.g. the line from a switch to a door. */
  | { kind: 'connection'; sceneId: Id; relationshipId: Id }
  /** The editor itself (layout, look, controls), not the game. */
  | { kind: 'editor'; sceneId: Id }
  /** One object in the object library (every copy of it), asked from the Objects tab. */
  | { kind: 'object'; sceneId: Id; definitionId: Id; panel?: boolean }
  /** One of the game's sounds, asked from the Sounds tab or the sound editor (null: the Sounds list, or none open). */
  | { kind: 'sound'; sceneId: Id; assetId: Id | null }
  /** A library object's 16 autotile pictures, asked from the Autotile editor. */
  | { kind: 'autotile'; sceneId: Id; definitionId: Id }
  /** One song in the music machine's Songs tab (null: none yet, a new one is asked for). */
  | { kind: 'song'; sceneId: Id; assetId: Id | null }
  /** One instrument in the music machine's Instruments tab (null: none yet). */
  | { kind: 'instrument'; sceneId: Id; assetId: Id | null };

/** Derives the context from a selection (ordered by selection order). */
export function contextFromSelection(sceneId: Id, selected: Id[]): AIContext | null {
  if (selected.length === 0) return null;
  if (selected.length === 1) return { kind: 'entity', sceneId, entityIds: [selected[0]] };
  if (selected.length === 2) return { kind: 'pair', sceneId, entityIds: [selected[0], selected[1]] };
  return { kind: 'group', sceneId, entityIds: [...selected] };
}

/** Stable key used to keep a short conversation per context. */
export function contextKey(ctx: AIContext): string {
  switch (ctx.kind) {
    case 'entity':
    case 'group':
    case 'pair':
      return `${ctx.kind}:${ctx.entityIds.join(',')}`;
    case 'level':
      return ctx.camera ? `camera:${ctx.sceneId}` : `level:${ctx.sceneId}`;
    case 'background':
      return `background:${ctx.sceneId}`;
    case 'project':
      return 'project';
    case 'create':
      return 'create';
    case 'editor':
      return 'editor';
    case 'connection':
      return `connection:${ctx.relationshipId}`;
    case 'object':
      // (Its editor panel is a conversation of its own.)
      return ctx.panel ? `panel:${ctx.definitionId}` : `object:${ctx.definitionId}`;
    case 'sound':
      return `sound:${ctx.assetId ?? 'new'}`;
    case 'autotile':
      return `autotile:${ctx.definitionId}`;
    case 'song':
      return `song:${ctx.assetId ?? 'new'}`;
    case 'instrument':
      return `instrument:${ctx.assetId ?? 'new'}`;
  }
}

export interface EntityDetail {
  id: Id;
  name: string;
  object: { id: Id; name: string; placedCount: number } | null;
  tags: string[];
  position: Vec2;
  size: Vec2;
  rotation: number;
  scale: Vec2;
  components: Record<string, Record<string, unknown>>;
  /** "Component.field" values set on this instance only (overriding its object definition). */
  instanceOverrides: string[];
  /** The pixel grid to use when drawing a sprite for it (draw_sprite): same proportions as its size. */
  spriteGrid: { width: number; height: number };
  /**
   * How it looks now: the normal image and the extra images for situations
   * (jump, run…), each with its pixels when it is pixel art, so a variation
   * ("a jumping sprite") can start from the same drawing.
   */
  look: {
    sprite: LookImage | null;
    situations: Record<string, LookImage>;
    /** An auto-tiled isometric block (Sprite.isoAuto): each of its other shapes by isoShape key (turns, corners, variation). */
    isoShapes?: Record<string, LookImage | null>;
  };
  /** Behavior scripts, in full: its object's (every copy runs them) and its own (only this one). */
  scripts: { object: BehaviorScript[]; own: BehaviorScript[] };
}

export interface LookImage {
  image: string;
  /** Its pixels; an animation also has all its frames (rows is the first). */
  pixelArt: { palette: { key: string; color: string }[]; rows: string[]; frames?: string[][] } | null;
  /** For an animation: how many frames and how fast. */
  animation?: { frames: number; fps: number };
}

/** A library object in full (scope "object"). */
export interface ObjectDetail {
  id: Id;
  name: string;
  description: string;
  category: string;
  tags: string[];
  /** How many copies of it are placed, in all levels (all of them change with it). */
  placedCount: number;
  components: Record<string, Record<string, unknown>>;
  /** The pixel grid to use when drawing a sprite for it (draw_sprite with target "definition"). */
  spriteGrid: { width: number; height: number };
  look: EntityDetail['look'];
  scripts: BehaviorScript[];
  /** Its own editor panel, if it has one. */
  panel?: ObjectPanel;
}

export interface EntityBrief {
  id: Id;
  name: string;
  /** Its library object's name (its components, tags and scripts are the object's: see library). */
  object: string | null;
  x: number;
  y: number;
  /** What this one has of its own (changed on it alone): components, tags, scripts. */
  own?: { components?: string[]; tags?: string[]; scripts?: string[] };
}

/**
 * Editor settings the AI may change (editor scope only). The editor declares
 * them; core only carries them, so the game model knows nothing about the UI.
 */
export interface EditorSettingsPayload {
  /**
   * Each editor setting's current value, by key. What the settings are (labels, descriptions, allowed values), the
   * overlay kinds and metrics never change, so they come once with the instructions (EDITOR SETTINGS, cached).
   */
  values: Record<string, unknown>;
  /** Information drawn over the level while editing (labels, guides): what is shown now. */
  overlays?: unknown[];
}

export interface AIPayload {
  scope: AIContext['kind'];
  /**
   * Only on the first request of a brand-new game (typed in the New game window): the starter the game was made
   * from (current) and the other starters there are. Build on current if it suits the request, else switch_starter.
   */
  newGame?: { current: string; starters: { id: string; is: string }[]; sprites?: 'engine' | 'ai'; spriteSize?: number };
  /** The image generator (generate_background): whether it can be asked, and the size its pictures are made at. */
  imageGenerator?: { ready: boolean; size: 'level' | 'screen' | 'custom'; pixels: { w: number; h: number } };
  /** A brief drawn at random for a NEW song (see "Music"): ignored when only changing a song. */
  songIdea?: SongIdea;
  /** The connection the user selected (scope "connection"): in words and as data. */
  connection?: { id: Id; text: string; type: string; source: EntityRef; target: EntityRef; params: Record<string, unknown>; conditions: Condition[] };
  /** The editor's adjustable settings and overlays, with their current values (editor changes are possible from any scope). */
  editor?: EditorSettingsPayload;
  scope_note: string;
  level: {
    id: Id;
    name: string;
    gravity: Vec2;
    backgroundColor: string;
    background: { image: { name: string; width: number; height: number } | null; fit: 'cover' | 'tile' | 'placed'; parallax: number; parallaxY?: number; scroll?: { x: number; y: number }; stars?: { density: number; speed: { x: number; y: number }; layers: number; color: string }; gradient?: { top: string; bottom: string; bands?: number } };
    isStartLevel: boolean;
    /** The level grid for drawing (draw_tiles, erase_area) and what is already drawn, in cells. */
    grid: { cell: number; occupied: { minCol: number; maxCol: number; minRow: number; maxRow: number } | null };
    /** The camera in play: its settings, what it follows (the entity with a CameraTarget), and the box around everything placed. */
    camera: CameraSettings & { follows: string | null; levelBounds: CameraBounds | null };
    /** The level as a text map, one character per cell (see the legend): what is where, and where the player can get to. */
    map: LevelMap | null;
    /**
     * side: seen from the side, with gravity (platformer). topdown: seen from above (Zelda, Rogue): the player walks in
     * every direction, nothing falls, walls block; playerReach is then null (no jumping).
     */
    view: 'side' | 'topdown';
    /** The game's sprite size: art pixels per 32 px tile of the built-in objects' pictures (32 = as they ship). */
    spriteResolution: number;
    /** The game's own keys, for the actions it changed (set_controls); missing: the engine's (see Controls). */
    controls?: Record<string, string[]>;
    /**
     * For building or rebuilding a level: the layout to use this time (chosen at random by the app, so levels
     * differ), where the start and goal go, and the shapes of the game's other levels. Follow it unless the user
     * asked for a particular layout.
     */
    design?: LevelDesignIdea;
    /** What the player-controlled character can do: the limits a level must respect to be playable. */
    playerReach: { character: string; jumpHeightPx: number; jumpHeightTiles: number; runningJumpDistancePx: number; runningJumpDistanceTiles: number; speed: number } | null;
  };
  /** The selected/target entities, in full. */
  targets: EntityDetail[];
  /** Scope "object": the library object the user asked about, in full (what every copy of it is). */
  object?: ObjectDetail;
  /** Scope "autotile": the object's 16 autotile pictures (or none yet), their size, and its own picture. */
  autotile?: {
    object: { id: Id; name: string; description: string };
    /** Every autotile picture is this many pixels. */
    grid: { width: number; height: number };
    /** The object's own picture (made into the pictures when there are none yet), or its color. */
    look: { pixelArt: { palette: { key: string; color: string }[]; rows: string[] } | null; color: string };
    on: boolean;
    palette: { key: string; color: string }[];
    /** Each picture: which sides have a tile next to them (joined) and which are open (edges go there). */
    tiles: { index: number; joined: string; open: string[]; rows: string[] }[];
  };
  /** Scope "sound": the sound the user asked about, in full. */
  sound?: { id: Id; name: string; description: string; seconds: number; sound: unknown };
  /** The song open in the music machine (song scope): all of it, its channels naming their instruments. */
  song?: { id: Id; name: string; description: string; seconds: number; playsIn: string[]; song: unknown } | null;
  /** The instrument open in the music machine (instrument scope), every setting, and the songs that play it. */
  instrument?: { id: Id; name: string; description: string; instrument: Instrument; playedBy: string[] } | null;
  /** Where the user pointed in the level (world coordinates), if anywhere. */
  point: Vec2 | null;
  /** Asked from the camera outline: the request is about the level's camera (level.camera). */
  aboutCamera?: true;
  /**
   * The other placed things that matter one by one (with ids, for changing that one): the few of a kind (the player,
   * doors, a goal), and any changed on its own. Plain copies of objects placed many times (ground, walls, dirt,
   * coins) are only on level.map, by cell (see otherCopies).
   */
  otherEntities: EntityBrief[];
  /** How many plain copies of each object are on the map but not listed one by one, e.g. { "Dirt": 212 }. */
  otherCopies: Record<string, number>;
  /** Object library. */
  library: {
    id: Id;
    name: string;
    category: string;
    tags: string[];
    components: string[];
    placedCount: number;
    /** Its size in pixels and the 32 px level cells it takes: "32x64 px, 1x2 cells" (a door). */
    size: string;
    /**
     * Behavior scripts every copy runs: id, name and the first sentence of the description. The code itself is in
     * targets[].scripts for the selected things' own objects (codeInTargets); the AI asks for any other ("need_code").
     */
    scripts: { id: Id; name: string; description: string }[];
    codeInTargets?: true;
    /** Sprites collected for this object (left out when none): image asset id, its name, the cell (sprite sheets). */
    sprites?: { assetId: Id; image: string; frame: number; sheet?: true }[];
    /** Look settings not at their defaults (left out when none): Sprite roundCorners, tint, layer. */
    look?: { roundCorners?: number; tint?: true; layer?: number };
  }[];
  /** The level's relationships and rules: in words, plus their data (for editing or removing by id). */
  logic: {
    relationships: { id: Id; text: string; type: string; source: EntityRef; target: EntityRef; params: Record<string, unknown>; conditions: Condition[] }[];
    rules: { id: Id; text: string; name: string; enabled: boolean; when: Rule['when']; conditions: Condition[]; actions: RuleAction[] }[];
  };
  /** Sounds made so far (play them by name with play_sound; remake one with make_sound replaceId). */
  /** The game's sounds; step sounds with their notes (`sound`), to remake one starting from what it is now. */
  sounds: { id: Id; name: string; description: string; seconds: number; sound?: StepSound }[];
  /** The music machine's instruments and songs (songs with their JSON, channels naming instruments), and this level's music. */
  music: {
    levelMusic: string | null;
    instruments: { id: Id; name: string; description: string; instrument: Instrument }[];
    songs: { id: Id; name: string; description: string; seconds: number; playsIn: string[]; song?: unknown; note?: string }[];
  };
  /** Other levels (project scope only lists their contents). */
  otherLevels: { id: Id; name: string; map?: LevelMap | null; entities?: EntityBrief[]; otherCopies?: Record<string, number> }[];
  coordinateSystem: string;
  /** For debugging questions ("why…?"): what can't work as set up, and what happened the last time the level was played. */
  debug: {
    problems: (Omit<Problem, 'key'> & { entities: string[] })[];
    lastPlay: (PlaySummary & { note: string }) | null;
  };
}

/** The last play session, as the editor kept it. */
export interface LastPlay {
  report: PlayReport;
  /** The game was changed since that play (it shows the game as it was). */
  changedSince: boolean;
}

const MAX_BRIEFS = 200;
/** An object placed more often than this in a level is shown on the map only (its plain copies aren't listed). */
const MANY_COPIES = 3;
const MAX_LOGIC = 100;

const SCOPE_NOTES: Record<AIContext['kind'], string> = {
  entity: 'The user selected one entity (see targets). Phrases like "the player", "this", "it" most likely refer to it, but the user may also mention other entities by name.',
  pair: 'The user selected two entities, in this order: targets[0] then targets[1]. The request is most likely about how they relate: usually a relationship between them (create_relationship), sometimes a rule. See logic for what already connects them.',
  group: 'The user selected several entities (see targets) and is addressing them together ("these", "them", "all of them").',
  level: 'The user is addressing the level itself: its world settings and its contents. "here" refers to `point` if set.',
  background:
    'The user is editing the level BACKGROUND (level.background, level.backgroundColor). Use set_background. "Move along with the level" / "scroll with the level" means parallax (0 fixed on screen, 1 moves with the level; about 0.3-0.6 for depth); parallaxY when up/down should differ from left/right, e.g. "stay on screen left/right but not up/down" = parallax 0, parallaxY 1). COLORS: one plain color (set_background color), or a FADE between two (set_background gradient {top, bottom, bands}: "dark blue at the bottom fading to light blue at the top" = top light blue, bottom dark blue; bands 0 smooth, 4-12 in steps like old games; removeGradient true goes back to the plain color). PICTURES: you cannot paint a big picture yourself, but the IMAGE GENERATOR can (context.imageGenerator): generate_background with the scenery described in plain words (what is in it, the time of day, the colors; the app adds the style and brings it down to the game\'s pixels); it is made after your answer and takes about half a minute, at context.imageGenerator.size (and context.imageGenerator.pixels) unless you set its size: "screen" (the screen, staying on it), "level" (as big as the level) or "custom" with customSize (width and height in game pixels) (a wide panorama, a tall tower): what you choose becomes the background card\'s setting too. DECIDE WHAT GOES WHERE: the generator paints the far, still backdrop in one picture (sky, distant mountains, hills, a skyline, a cave wall); you make yourself what is nearer or moves, as objects: clouds drifting across, birds, falling snow or leaves, mist, a sun (create_definition with a Sprite on layer -1 or lower, so it is behind the play but over the backdrop; no Collider, no PhysicsBody; draw_sprite; place a few copies at different heights and sizes; a script giving them a slow velocity, e.g. 4-15 px a second, the farther the slower, that moves each back to the other side of the level when it leaves it), and stars with set_background stars. A backdrop that stays on the screen (parallax 0) with clouds and such in the level (moving with it) looks deep: they pass in front of it. Say what the generator is painting and what you made. With context.imageGenerator.ready false, say the generator has no address yet (the background card\'s settings) and make what you can yourself.',
  project: 'The user is addressing the whole game, across all levels.',
  create: 'The user wants a NEW object added to the object library. Use create_definition. Do not place it unless asked.',
  connection:
    'The user clicked on a CONNECTION (see connection; its two ends are targets[0] = source and targets[1] = target). The request is about what this connection does: change it with update_relationship (id = connection.id), e.g. for a switch (controls): params.action "open" | "close" | "toggle" | "disappear" | "move", with offset (pixels, one tile = 32, negative y = up) and speed for "move". Replace or remove it only if asked; if what they want cannot be expressed by a connection, a rule may do it.',
  object:
    'The user is asking about ONE OBJECT IN THE OBJECT LIBRARY (see `object`, in full), not a placed copy: "this", "it", "this object" mean it. Change the object itself, so every copy of it (object.placedCount, in all levels) changes: every operation with target "definition" and id = object.id (set_component_field, add_component, remove_component, rename, set_tags); draw_sprite with target "definition" and id = object.id for how it looks, on exactly object.spriteGrid. A color change ("make it yellow") is a redraw: draw_sprite with its pixels from object.look.sprite.pixelArt, the colors changed and the shapes kept (when it has no pixel art, set_component_field Sprite.color). Scripts on it with set_script on the definition. Do not place, move or delete copies unless asked.',
  autotile:
    'The user is in the AUTOTILE EDITOR of one object (see `autotile`): its 16 autotile pictures, one per combination of neighbours of the same object: index = up 1 + right 2 + down 4 + left 8 for the sides that HAVE a tile next to them (0 = a tile on its own, 5 = joined up and down (a column\'s middle), 10 = joined left and right (a platform\'s middle), 15 = joined all round (inside a block)); tiles[].joined says it in words. A side that is NOT joined is an open edge of the surface: that is where edges, outlines, grass, highlights, shadows and rounded corners go; a joined side must continue seamlessly into the neighbour (the same pattern, no edge). Change them with draw_autotile (id = autotile.object.id): every picture exactly autotile.grid.width × grid.height pixels, palette keys single letters or digits, "." transparent; send all 16 for a new look ("stone bricks", "a grassy dirt platform", "ice"), or only the ones that change ("rounder corners" -> the pictures with two open sides meeting). Start from the pictures there are now (tiles[].rows) when changing them; with none yet, from autotile.look. Keep them consistent (the same material, light from the top, the same edge thickness) so tiles join without seams. EDGES BELONG ONLY ON OPEN SIDES (tiles[].open): grass, snow, moss or a highlight along the top goes ONLY on the pictures whose open sides include "up" (index 0, 2, 4, 6, 8, 10, 12, 14); the pictures with a tile above (index 1, 3, 5, 7, 9, 11, 13, 15) show the plain material at the top, continuing seamlessly from the tile above (no grass, no highlight, no outline, no cut corners there). The same for the bottom ("down": 0-3 and 8-11 open), left ("left": 0-7 open) and right ("right": 0, 1, 4, 5, 8, 9, 12, 13 open). Check every picture against its open list before answering. Not draw_sprite (that changes the object\'s own picture). Say in one sentence what the tiles look like now.',
  sound:
    'With `sound` missing, the user is asking from the Sounds and music prompt (the ♪ at the top, or the sound editor with no sound open): ANYTHING ABOUT THE GAME\'S SOUND. A sound effect: make the sound they describe with make_sound (a new one; its name short and clear), or change one of context.sounds they name (make_sound replaceId = its id, starting from its notes); if they say what should play it ("when the player jumps", "when a coin is picked up"), make the game play it too (a play_sound script statement or rule action on the right object). Music: a new song with make_song (instruments first with make_instrument, reusing context.music.instruments when they fit) and, for "music for this level" / "background music", set_level_music; a change to a song in context.music.songs with edit_song (only what is asked); "play X when the boss appears" with play_music in a script (see "Music"; ask need_code "topic:music" when that guidance is not here). Instruments: make_instrument (replaceId = an instrument in context.music.instruments to reshape it). Say in one or two sentences what you made or changed. Otherwise: the user is asking about ONE SOUND (see `sound`, with its notes in sound.sound): "this", "it", "this sound" mean it. Change it with make_sound replaceId = sound.id, starting from its notes and changing only what was asked ("lower in pitch": every pitch down, e.g. by 5-12 semitones; "longer": a slower speed or more notes; "softer": lower volumes or smooth). Keep its name unless asked. Nothing else changes.',
  song:
    'The user is in the MUSIC MACHINE\'s Songs tab, working on ONE SONG (see `song`, all of it: its chip (8bit or 16bit, chosen by the user: EVERY instrument it plays must be of that chip, context.music.instruments[].instrument.chip; new ones with make_instrument "chip" the same; never the other chip\'s instruments, the app refuses them), bpm, steps per pattern, channels (each plays one instrument; channels with drum true are the drum kit, shown apart below the others), patterns of notes [channel, step, pitch, length, velocity], and the order the patterns play in). "this", "it", "the song", "the drums", "the melody", "the bass" mean its parts. CHANGE ONLY WHAT IS ASKED with edit_song (id = song.id): "only the drum beat" / "a busier beat" -> edit_song patterns with channels = the drum channels\' indexes and their new notes, in every pattern that should change; "a new melody" -> the lead channel only; "faster" -> bpm only; "add a chorus" -> new patterns and the order. Leave every other note exactly as it is. A melody described in words ("rising, hopeful, ends on a high note", "like a lullaby", "da-da-DUM") -> real notes that fit it, with rests, off-beats and a shape (see "Music"). A feel ("dreamy", "aggressive", "8-bit adventure", "jazzy swing") -> tempo, instruments (make_instrument for new sounds, and change a channel\'s instrument with edit_song channels), rhythm and chords. New instruments go on new channels with edit_song (drum: true for drums), or replace a channel\'s instrument. With song null, or when the user asks for a NEW song, write one with make_song following context.songIdea (a brief drawn at random so no two songs are alike; see "Music") (instruments first with make_instrument, reusing context.music.instruments when they fit; drum channels with "drum":true, after the other channels, usually 3 instruments + 3 drums). Say in one or two sentences what you wrote or changed (key, tempo, what each channel plays).',
  instrument:
    'The user is in the MUSIC MACHINE\'s Instruments tab, shaping ONE INSTRUMENT (see `instrument`, with every setting in instrument.instrument). "this", "it", "the sound" mean it. Change it with make_instrument replaceId = instrument.id, giving only the settings that change (the rest stay); you can use every setting (see "Music"): chip (8bit/16bit) and its waves, volume, attack, decay, sustain, release, pitchDrop/pitchTime, vibratoRate/vibratoDepth/vibratoDelay, arp/arpSpeed, and on 16bit filter/cutoff/resonance/filterEnv, fmRatio/fmIndex, detune, echoTime/echoFeedback/echoMix. Describing words to settings: brighter = higher cutoff or fmIndex, or saw/pulse; darker/warmer/softer = lowpass with a lower cutoff, triangle or sine; punchier/snappier = attack 0, short decay, low sustain, maybe a small pitchDrop; plucky = sustain 0 with a medium decay or the pluck wave; longer/swelling = slow attack, long release; spacey/dreamy = echo and slow vibrato, supersaw pads; metallic/bell = fm with a ratio of 3.5-7; wobbly = vibrato; a drum: kick = pitchDrop 24-30 over 0.05-0.08 s on sine or triangle with sustain 0; snare = noise (bandpass ~2500 on 16bit); hi-hat = metal (8bit) or noise with highpass ~7000 (16bit), very short. Songs that play it (instrument.playedBy) change with it. With instrument null, or when a NEW instrument is asked for, make one with make_instrument (replaceId null) and a short fitting name. Say in one sentence how it sounds now.',
  editor:
    'The user is changing the PXLBuilder EDITOR itself (where things are, how it looks, what it shows over the level), not the game. Use only editor operations (set_editor_setting, add_editor_overlay, remove_editor_overlay). If the request needs something they cannot do, reply unsupported and say what can be changed instead.',
};

function occupiedCells(scene: Scene): AIPayload['level']['grid']['occupied'] {
  if (!scene.entities.length) return null;
  const cols = scene.entities.map((e) => Math.floor(e.transform.position.x / LEVEL_CELL));
  const rows = scene.entities.map((e) => Math.floor(e.transform.position.y / LEVEL_CELL));
  return { minCol: Math.min(...cols), maxCol: Math.max(...cols), minRow: Math.min(...rows), maxRow: Math.max(...rows) };
}

/** Reach of the level's player character (the first placed one, else the library's). */
function playerReach(project: Project, scene: Scene, registry: ComponentRegistry): AIPayload['level']['playerReach'] {
  const placed = scene.entities.map((e) => resolveEntity(project, e, registry)).find((r) => r.components.CharacterController);
  const def = project.definitions.find((d) => d.components.CharacterController);
  const components = placed?.components ?? (def ? def.components : null);
  if (!components) return null;
  const r = characterReach(components, scene.world.gravity.y);
  if (!r) return null;
  const t = (px: number) => Math.round((px / LEVEL_CELL) * 10) / 10;
  // Heights round down: 62.5 px is "1.9 tiles", never "2" (two rows up is out of reach).
  const down = (px: number) => Math.floor((px / LEVEL_CELL) * 10) / 10;
  return { character: placed?.name ?? def!.name, jumpHeightPx: Math.floor(r.height), jumpHeightTiles: down(r.height), runningJumpDistancePx: Math.round(r.distance), runningJumpDistanceTiles: t(r.distance), speed: r.speed };
}

export function buildAIPayload(project: Project, ctx: AIContext, registry: ComponentRegistry, editor?: EditorSettingsPayload, lastPlay?: LastPlay | null, random?: () => number): AIPayload {
  const scene = project.scenes.find((s) => s.id === ctx.sceneId) ?? project.scenes[0];
  const connection = ctx.kind === 'connection' ? scene.relationships.find((r) => r.id === ctx.relationshipId) : undefined;
  const endIds = (ref: EntityRef) => (ref.kind === 'entity' ? [ref.id] : []);
  const targetIds = 'entityIds' in ctx ? ctx.entityIds : connection ? [...endIds(connection.source), ...endIds(connection.target)] : [];
  const placed = (defId: Id) => project.scenes.reduce((n, s) => n + s.entities.filter((e) => e.definitionId === defId).length, 0);
  const fullScripts = scriptsInFull(project, scene, targetIds);

  const detail = (id: Id): EntityDetail | null => {
    const entity = scene.entities.find((e) => e.id === id);
    if (!entity) return null;
    const r = resolveEntity(project, entity, registry);
    const def = project.definitions.find((d) => d.id === entity.definitionId);
    return {
      id: entity.id,
      name: entity.name,
      object: def ? { id: def.id, name: def.name, placedCount: placed(def.id) } : null,
      tags: r.tags,
      position: r.transform.position,
      size: getEntitySize(r),
      rotation: r.transform.rotation,
      scale: r.transform.scale,
      components: r.components,
      instanceOverrides: [...r.overriddenFields],
      spriteGrid: gridFor(getEntitySize(r), project.settings.spriteResolution),
      scripts: { object: def?.scripts ?? [], own: entity.scripts ?? [] },
      look: lookOf(r.components),
    };
  };

  const lookOf = (c: Record<string, Record<string, unknown>>): EntityDetail['look'] => lookOfComponents(project, c);

  /**
   * The level's placed things worth listing one by one, briefly, and how many plain copies are left to the map: an
   * object placed more than a few times (MANY_COPIES) is listed only for copies changed on their own, renamed, or
   * named by the level's logic.
   */
  const briefs = (s: Scene, exclude: Set<Id>): { list: EntityBrief[]; copies: Record<string, number> } => {
    const count = new Map<string, number>();
    for (const e of s.entities) if (e.definitionId) count.set(e.definitionId, (count.get(e.definitionId) ?? 0) + 1);
    const logic = JSON.stringify([s.relationships, s.rules]);
    const list: EntityBrief[] = [];
    const copies: Record<string, number> = {};
    for (const e of s.entities) {
      if (exclude.has(e.id)) continue;
      const def = e.definitionId ? project.definitions.find((d) => d.id === e.definitionId) : undefined;
      const own = {
        ...(Object.keys(e.components ?? {}).length ? { components: Object.keys(e.components) } : {}),
        ...(e.tags?.length ? { tags: e.tags } : {}),
        ...(e.scripts?.length ? { scripts: e.scripts.map((x) => x.name) } : {}),
      };
      const plainName = !def || e.name === def.name || new RegExp(`^${def.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} \\d+$`).test(e.name);
      const plainCopy = !!def && (count.get(def.id) ?? 0) > MANY_COPIES && !Object.keys(own).length && plainName && !logic.includes(e.id);
      if (plainCopy) {
        copies[def.name] = (copies[def.name] ?? 0) + 1;
        continue;
      }
      if (list.length >= MAX_BRIEFS) continue;
      list.push({ id: e.id, name: e.name, object: def?.name ?? null, x: Math.round(e.transform.position.x), y: Math.round(e.transform.position.y), ...(Object.keys(own).length ? { own } : {}) });
    }
    return { list, copies };
  };
  const others = briefs(scene, new Set(targetIds));
  const objectDef = ctx.kind === 'object' ? project.definitions.find((d) => d.id === ctx.definitionId) : undefined;
  const objectDetail = (d: (typeof project.definitions)[number]): ObjectDetail => {
    const r = resolveEntity(project, instantiateDefinition(d, { x: 0, y: 0 }), registry);
    return {
      id: d.id,
      name: d.name,
      description: d.description ?? '',
      category: typeof d.metadata.category === 'string' ? d.metadata.category : 'Custom',
      tags: d.tags,
      placedCount: placed(d.id),
      components: d.components,
      spriteGrid: gridFor(getEntitySize(r), project.settings.spriteResolution),
      look: lookOf(d.components),
      scripts: d.scripts ?? [],
      ...(panelOf(d) ? { panel: panelOf(d)! } : {}),
    };
  };
  const autotileDef = ctx.kind === 'autotile' ? project.definitions.find((d) => d.id === ctx.definitionId) : undefined;
  const autotilePayload = (d: (typeof project.definitions)[number]): NonNullable<AIPayload['autotile']> => {
    const sp = d.components.Sprite ?? {};
    const sheet = typeof sp.autotileSheet === 'string' ? project.assets.find((a) => a.id === sp.autotileSheet && a.autotile) : undefined;
    const frames = sheet?.pixelArt?.frames?.length === 16 ? sheet.pixelArt.frames : null;
    const own = typeof sp.assetId === 'string' ? project.assets.find((a) => a.id === sp.assetId) : undefined;
    const size = getEntitySize(resolveEntity(project, instantiateDefinition(d, { x: 0, y: 0 }), registry));
    const grid = frames ? { width: frames[0][0].length, height: frames[0].length } : gridFor(size, project.settings.spriteResolution);
    return {
      object: { id: d.id, name: d.name, description: d.description ?? '' },
      grid,
      look: { pixelArt: own?.pixelArt ? { palette: own.pixelArt.palette, rows: own.pixelArt.rows } : null, color: typeof sp.color === 'string' ? sp.color : '#888888' },
      on: sp.autotile === true,
      palette: frames ? sheet!.pixelArt!.palette : [],
      tiles: frames ? frames.map((rows, index) => ({ index, joined: autotileLabel(index), open: (['up', 'right', 'down', 'left'] as const).filter((_, i) => !(index & (1 << i))), rows })) : [],
    };
  };
  const soundAsset = ctx.kind === 'sound' ? project.assets.find((a) => a.id === ctx.assetId && a.kind === 'sound' && a.synth) : undefined;

  return {
    scope: ctx.kind,
    scope_note:
      ctx.kind === 'object' && ctx.panel
        ? "EDITOR PANEL for this library object: the user asks what its own panel (beside it in the editor, never in the game) shows and how. Answer with set_panel (or remove_panel); the object's current panel is object.panel. See the panels guidance."
        : SCOPE_NOTES[ctx.kind],
    ...(editor ? { editor } : {}),
    ...(connection ? { connection: { id: connection.id, text: describeRelationship(project, scene, connection), type: connection.type, source: connection.source, target: connection.target, params: connection.params, conditions: connection.conditions } } : {}),
    level: {
      id: scene.id,
      name: scene.name,
      gravity: scene.world.gravity,
      backgroundColor: scene.world.backgroundColor,
      background: {
        image: (() => {
          const a = project.assets.find((x) => x.id === scene.world.background.imageAssetId);
          return a ? { name: a.name, width: a.width, height: a.height } : null;
        })(),
        fit: scene.world.background.fit,
        parallax: scene.world.background.parallax,
        ...(typeof scene.world.background.parallaxY === 'number' ? { parallaxY: scene.world.background.parallaxY } : {}),
        ...(scene.world.background.scroll ? { scroll: scene.world.background.scroll } : {}),
        ...(scene.world.background.stars ? { stars: scene.world.background.stars } : {}),
        ...(scene.world.background.gradient ? { gradient: scene.world.background.gradient } : {}),
      },
      isStartLevel: project.startSceneId === scene.id,
      grid: { cell: LEVEL_CELL, occupied: occupiedCells(scene) },
      map: levelMap(project, scene.id, registry),
      view: isTopDownScene(project, scene, registry) ? 'topdown' : 'side',
      spriteResolution: project.settings.spriteResolution ?? 32,
      ...(project.settings.controls ? { controls: project.settings.controls } : {}),
      // A random level: its recipe, with names for the objects (and what the example the editor shows came out as).
      ...(scene.generator
        ? (() => {
            const g = scene.generator;
            const name = (id: string | null) => (id ? (project.definitions.find((d) => d.id === id)?.name ?? '?') : null);
            const spawn = (list: typeof g.monsters) => list.map((s) => ({ object: name(s.object), weight: s.weight, fromFloor: s.fromFloor }));
            const example = generateDungeon(project, scene, registry, g.preview, g.previewFloor);
            return { generator: { ...g, wall: name(g.wall), floor: name(g.floor), stairs: name(g.stairs), monsters: spawn(g.monsters), loot: spawn(g.loot), example: { rooms: example.rooms, things: example.entities.length, problems: example.problems } } };
          })()
        : {}),
      ...(random && (ctx.kind === 'level' || ctx.kind === 'project') ? { design: levelDesignIdea(project, scene, registry, random) } : {}),
      playerReach: isTopDownScene(project, scene, registry) ? null : playerReach(project, scene, registry),
      camera: {
        ...scene.camera,
        follows: scene.entities.find((e) => resolveEntity(project, e, registry).components.CameraTarget)?.name ?? null,
        levelBounds: boundsOf(
          scene.entities.map((e) => {
            const s = getEntitySize(resolveEntity(project, e, registry));
            return { x: e.transform.position.x, y: e.transform.position.y, w: s.x, h: s.y };
          }),
        ),
      },
    },
    targets: targetIds.map(detail).filter((d): d is EntityDetail => d !== null),
    ...(objectDef ? { object: objectDetail(objectDef) } : {}),
    ...(autotileDef ? { autotile: autotilePayload(autotileDef) } : {}),
    ...(ctx.kind === 'song' ? { song: songFocus(project, ctx.assetId) } : {}),
    ...(ctx.kind === 'instrument' ? { instrument: instrumentFocus(project, ctx.assetId) } : {}),
    ...(soundAsset ? { sound: { id: soundAsset.id, name: soundAsset.name, description: soundAsset.description ?? '', seconds: Math.round(soundLength(soundAsset.synth!) * 100) / 100, sound: soundAsset.synth } } : {}),
    point: ctx.kind === 'level' ? ctx.point : null,
    ...(ctx.kind === 'level' && ctx.camera ? { aboutCamera: true as const } : {}),
    otherEntities: others.list,
    otherCopies: others.copies,
    library: project.definitions.map((d) => ({
      id: d.id,
      name: d.name,
      category: typeof d.metadata.category === 'string' ? d.metadata.category : 'Custom',
      tags: d.tags,
      components: Object.keys(d.components),
      placedCount: placed(d.id),
      size: (() => {
        const s = getEntitySize(resolveEntity(project, instantiateDefinition(d, { x: 0, y: 0 }), registry));
        return `${s.x}x${s.y} px, ${Math.max(1, Math.round(s.x / LEVEL_CELL))}x${Math.max(1, Math.round(s.y / LEVEL_CELL))} cells`;
      })(),
      // (The selected things' own scripts are in targets in full: not twice.)
      scripts: (d.scripts ?? []).map((x) => ({ id: x.id, name: x.name, description: firstSentence(x.description) })),
      ...(fullScripts.has(d.id) || d.id === objectDef?.id ? { codeInTargets: true as const } : {}),
      ...(() => {
        const sprites = getDefinitionSprites(d).map((r) => {
          const a = project.assets.find((x) => x.id === r.assetId);
          return { assetId: r.assetId, image: a?.name ?? '?', frame: r.frame, ...(a?.kind === 'spritesheet' ? { sheet: true as const } : {}) };
        });
        return sprites.length ? { sprites } : {};
      })(),
      ...(() => {
        const sp = d.components.Sprite ?? {};
        const look = {
          ...(typeof sp.roundCorners === 'number' && sp.roundCorners > 0 ? { roundCorners: sp.roundCorners } : {}),
          ...(sp.tint === true ? { tint: true as const } : {}),
          ...(typeof sp.layer === 'number' && sp.layer !== 0 ? { layer: sp.layer } : {}),
        };
        return Object.keys(look).length ? { look } : {};
      })(),
    })),
    logic: {
      relationships: scene.relationships.slice(0, MAX_LOGIC).map((r: Relationship) => ({ id: r.id, text: describeRelationship(project, scene, r), type: r.type, source: r.source, target: r.target, params: r.params, conditions: r.conditions })),
      rules: scene.rules.slice(0, MAX_LOGIC).map((r) => ({ id: r.id, text: describeRule(project, scene, r), name: r.name, enabled: r.enabled, when: r.when, conditions: r.conditions, actions: r.actions })),
    },
    sounds: project.assets
      .filter((a) => a.kind === 'sound' && a.synth)
      .map((a) => ({ id: a.id, name: a.name, description: a.description ?? '', seconds: Math.round(soundLength(a.synth!) * 100) / 100, ...(isStepSound(a.synth) ? { sound: { ...a.synth, notes: a.synth.notes.slice(0, audibleNotes(a.synth)) } } : {}) })),
    music: musicPayload(project, scene),
    otherLevels: project.scenes
      .filter((s) => s.id !== scene.id)
      .map((s) => {
        if (ctx.kind !== 'project') return { id: s.id, name: s.name };
        const b = briefs(s, new Set());
        return { id: s.id, name: s.name, map: levelMap(project, s.id, registry), entities: b.list, otherCopies: b.copies };
      }),
    debug: debugPayload(project, scene, registry, targetIds, lastPlay ?? null),
    coordinateSystem: 'Pixels. x grows to the right, y grows DOWNWARD (so gravity y > 0 pulls down, and "above" means smaller y). Entity positions are centers.',
  };
}

function debugPayload(project: Project, scene: Scene, registry: ComponentRegistry, focus: Id[], lastPlay: LastPlay | null): AIPayload['debug'] {
  const nameOf = (id: Id) => scene.entities.find((e) => e.id === id)?.name ?? id;
  const problems = diagnoseLevel(project, scene.id, registry).map(({ severity, text, entityIds }) => ({ severity, text, entityIds, entities: entityIds.map(nameOf) }));
  if (!lastPlay || lastPlay.report.sceneId !== scene.id) return { problems, lastPlay: null };
  const players = scene.entities.filter((e) => resolveEntity(project, e, registry).components.CharacterController).map((e) => e.id);
  const note = lastPlay.changedSince
    ? 'The game was changed after this play, so it shows the game as it was then; things may already be different.'
    : 'Nothing was changed since this play: it shows the game as it is now.';
  return { problems, lastPlay: { ...summarizePlay(lastPlay.report, focus, players), note } };
}

/** A script's description, short: its first sentence (at most about 120 characters). */
function firstSentence(text: string): string {
  const first = /^.*?[.!?](\s|$)/.exec(text.trim())?.[0].trim() ?? text.trim();
  return first.length <= 120 ? first : `${first.slice(0, 117).replace(/\s+\S*$/, '')}…`;
}

/**
 * The library objects whose scripts go to the AI in full in targets: only the selected things' own objects. The
 * others come as their scripts' names and one-line descriptions, except those sent along (codeToSend); the AI asks for
 * any other it needs (kind "need_code", see codeFor), so a request doesn't pay for code it doesn't read.
 */
function scriptsInFull(project: Project, scene: Scene, targetIds: Id[]): Set<Id> {
  const defs = targetIds.map((id) => scene.entities.find((e) => e.id === id)?.definitionId).filter((x): x is Id => !!x);
  return new Set(defs.filter((id) => project.definitions.find((d) => d.id === id)?.scripts?.length));
}

/**
 * Objects whose full scripts are sent with a request without being asked for (as FULL CODE), so the AI doesn't need a
 * second round trip to read code it obviously needs, and no request pays for code it doesn't mention: those the
 * request names ("make the mole shake while digging"), and those whose scripts act on what it names (the board that
 * spawns and clears the pills, the script that plays the "Pop" sound). Not the selected things' own (they are in
 * targets already).
 */
export function codeToSend(project: Project, ctx: AIContext, request: string): Id[] {
  const scene = project.scenes.find((s) => s.id === ctx.sceneId) ?? project.scenes[0];
  const inTargets = scriptsInFull(project, scene, 'entityIds' in ctx ? ctx.entityIds : []);
  const words = request.toLowerCase().match(/[\p{L}\p{N}_]+/gu) ?? [];
  const named = (name: string) => mentions(words, name);
  // What the request names: objects (by name) and sounds.
  const objects = project.definitions.filter((d) => named(d.name));
  const sounds = project.assets.filter((a) => a.kind === 'sound' && named(a.name));
  const out: Id[] = [];
  for (const d of project.definitions) {
    if (!d.scripts?.length || inTargets.has(d.id)) continue;
    if (objects.includes(d)) {
      out.push(d.id);
      continue;
    }
    const code = JSON.stringify(d.scripts);
    const actsOn = objects.some((o) => code.includes(`"${o.id}"`) || code.includes(`'${o.id}'`)) || sounds.some((a) => code.includes(`"sound":"${a.name}"`) || code.includes(`'${a.name}'`));
    if (actsOn) out.push(d.id);
  }
  return out;
}

/**
 * Whether these words (a request's, lower case) mention this name: the whole name, or for a name of 5 or more
 * letters a word starting with all of it but its last letter, so its other forms count ("enemies" for Enemy, in
 * Icelandic "pillurnar" for Pillur and "Stjórnanda" for Stjórnandi). A name of several words: all of them in a row.
 */
export function mentions(words: string[], name: string): boolean {
  const parts = name.toLowerCase().match(/[\p{L}\p{N}_]+/gu) ?? [];
  if (!parts.length || parts.join('').length < 3) return false;
  const fits = (word: string, part: string) => word === part || word === `${part}s` || word === `${part}es` || ([...part].length >= 5 && word.startsWith(part.slice(0, -1)));
  for (let i = 0; i + parts.length <= words.length; i++) if (parts.every((p, k) => fits(words[i + k], p))) return true;
  return false;
}

/** A picture for the AI: its name and its pixels (an animation's frames too). */
function lookImage(project: Project, assetId: unknown): LookImage | null {
  const a = typeof assetId === 'string' ? project.assets.find((x) => x.id === assetId) : undefined;
  return a ? { image: a.name, pixelArt: a.pixelArt ?? null, ...(a.animation ? { animation: { frames: a.animation.frames.length, fps: a.animation.fps } } : {}) } : null;
}

/** How something looks, for the AI: its picture, its situations' pictures, an auto-tiled isometric block's shapes. */
function lookOfComponents(project: Project, c: Record<string, Record<string, unknown>>): EntityDetail['look'] {
  const situations: Record<string, LookImage> = {};
  for (const [k, v] of Object.entries(c.SpriteStates ?? {})) {
    const img = lookImage(project, v);
    if (img) situations[k] = img;
  }
  const shapes = isoShapesOf(c.Sprite?.isoAuto);
  const pics = Array.isArray(c.Sprite?.isoPictures) ? (c.Sprite.isoPictures as unknown[]) : [];
  return { sprite: lookImage(project, c.Sprite?.assetId), situations, ...(shapes.length ? { isoShapes: Object.fromEntries(shapes.map((s, n) => [s.key, lookImage(project, pics[n])])) } : {}) };
}

/**
 * The full scripts of these library objects (by id or name), for a "need_code" answer. Unknown ones are left out.
 * "look:<id or name>": that object's pictures instead (its look, situations and isometric shapes, with their pixels),
 * to redraw it starting from them.
 */
export function codeFor(project: Project, ids: string[]): { id: Id; name: string; scripts: BehaviorScript[]; look?: EntityDetail['look'] }[] {
  const out: { id: Id; name: string; scripts: BehaviorScript[]; look?: EntityDetail['look'] }[] = [];
  for (const want of ids) {
    const look = /^look:(.+)$/.exec(want.trim());
    if (look) {
      const d = project.definitions.find((x) => x.id === look[1]) ?? project.definitions.find((x) => x.name.toLowerCase() === look[1].trim().toLowerCase());
      if (d && !out.some((o) => o.id === `look:${d.id}`)) out.push({ id: `look:${d.id}`, name: `the pictures of ${d.name}`, scripts: [], look: lookOfComponents(project, d.components) });
      continue;
    }
    // "engine:<part>" (or "engine:<part>:<object id>"): the ready-made script of a part of the engine's own code,
    // made for that object when named (only asked for when one is to become a script, so it isn't sent every time).
    const engine = /^engine:([a-z_]+)(?::(.+))?$/.exec(want.trim());
    if (engine) {
      const info = ENGINE_PART_INFO[engine[1] as EnginePart];
      if (!info || out.some((o) => o.id === want)) continue;
      const def = engine[2] ? project.definitions.find((x) => x.id === engine[2] || x.name.toLowerCase() === engine[2].toLowerCase()) : undefined;
      const script = info.script(def ? { name: def.name, components: def.components } : undefined);
      out.push({ id: want, name: `the ready-made script for ${def ? `the ${def.name}'s ` : ''}${info.label}`, scripts: [{ ...script, id: 'ready-made' }] });
      continue;
    }
    const d = project.definitions.find((x) => x.id === want) ?? project.definitions.find((x) => x.name.toLowerCase() === want.trim().toLowerCase());
    if (d && !out.some((o) => o.id === d.id)) out.push({ id: d.id, name: d.name, scripts: d.scripts ?? [] });
  }
  return out;
}

/** The game's instruments and songs for the AI (a long song's notes are left out). */
function musicPayload(project: Project, scene: Project['scenes'][number]): AIPayload['music'] {
  const instruments = project.assets.filter((a) => a.kind === 'instrument' && a.instrument);
  const nameOf = (id: Id | null) => instruments.find((a) => a.id === id)?.name ?? null;
  let budget = 3000;
  return {
    levelMusic: project.assets.find((a) => a.id === scene.music && a.kind === 'music')?.name ?? null,
    instruments: instruments.map((a) => ({ id: a.id, name: a.name, description: a.description ?? '', instrument: a.instrument! })),
    songs: project.assets
      .filter((a) => a.kind === 'music' && a.song)
      .map((a) => {
        const s = a.song!;
        const notes = s.patterns.reduce((n, p) => n + p.notes.length, 0);
        const fits = notes <= budget;
        if (fits) budget -= notes;
        return {
          id: a.id,
          name: a.name,
          description: a.description ?? '',
          seconds: Math.round(songSeconds(s)),
          playsIn: project.scenes.filter((x) => x.music === a.id).map((x) => x.name),
          ...(fits ? { song: { ...s, channels: s.channels.map((c) => ({ ...c, instrument: nameOf(c.instrument) })) } } : { note: `${notes} notes: too long to show here` }),
        };
      }),
  };
}

function songFocus(project: Project, id: Id | null): AIPayload['song'] {
  const a = id ? project.assets.find((x) => x.id === id && x.kind === 'music' && x.song) : undefined;
  if (!a) return null;
  const s = a.song!;
  const nameOf = (i: Id | null) => project.assets.find((x) => x.id === i)?.name ?? null;
  return { id: a.id, name: a.name, description: a.description ?? '', seconds: Math.round(songSeconds(s)), playsIn: project.scenes.filter((x) => x.music === a.id).map((x) => x.name), song: { ...s, chip: songChip(s, (i) => (i ? (project.assets.find((x) => x.id === i)?.instrument?.chip ?? null) : null)), channels: s.channels.map((c, index) => ({ index, ...c, instrument: nameOf(c.instrument) })) } };
}

function instrumentFocus(project: Project, id: Id | null): AIPayload['instrument'] {
  const a = id ? project.assets.find((x) => x.id === id && x.kind === 'instrument' && x.instrument) : undefined;
  if (!a) return null;
  return { id: a.id, name: a.name, description: a.description ?? '', instrument: a.instrument!, playedBy: project.assets.filter((x) => x.kind === 'music' && x.song?.channels.some((c) => c.instrument === a.id)).map((x) => x.name) };
}
