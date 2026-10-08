/**
 * Behavior scripts: programs that make an object behave a certain way in
 * play, written by the AI (or by hand) as data.
 *
 * A script is a list of handlers, "when <trigger> [in state S] [if <expr>]
 * do <statements>", with the script's own variables and optional states (a
 * state machine). Statements are a fixed set of game actions plus if/each;
 * values are expressions (expr.ts). There are no loops other than "each"
 * over entities and every run has a step budget, so a script can't freeze
 * the game.
 *
 * This file is the single description of the language: the schema, the
 * checker and the reference text the AI reads all come from the tables
 * below, and the interpreter (runtime/scripts.ts) implements exactly them.
 */
import { z } from 'zod';
import { eventRegistry } from '../logic/vocabulary';
import type { Project } from '../types';
import { componentRegistry } from '../components/builtin';
import { checkComponent, resolveField } from './fields';
import { checkExpr, ExprError, parseExpr, suggest, type Scope } from './expr';

// ---------------------------------------------------------------- data

export type ScriptValue = number | boolean | string;

export type Trigger =
  | { on: 'start' }
  | { on: 'tick' }
  | { on: 'every'; seconds: number }
  | { on: 'enter_state' }
  | { on: 'event'; event: string; with: string | null }
  | { on: 'key'; key: KeyName; edge: 'pressed' | 'held' | 'released' }
  | { on: 'signal'; name: string };

export type KeyName = 'left' | 'right' | 'up' | 'down' | 'jump' | 'interact' | 'fire';

export type Stmt =
  | { do: 'set'; var: string; value: string; on: string | null }
  | { do: 'if'; cond: string; then: Stmt[]; else: Stmt[] }
  | { do: 'each'; tag: string; then: Stmt[] }
  | { do: 'velocity'; x: string | null; y: string | null; on: string | null }
  | { do: 'push'; x: string; y: string; on: string | null }
  | { do: 'move_toward'; target: string; speed: string }
  | { do: 'glide_to'; x: string; y: string; speed: string; on: string | null }
  | { do: 'position'; x: string; y: string; on: string | null }
  | { do: 'jump'; force: string; on: string | null }
  | { do: 'face'; dir: string; on: string | null }
  | { do: 'gravity'; scale: string; on: string | null }
  | { do: 'speed_factor'; value: string; on: string | null }
  | { do: 'shoot'; dx: string; dy: string; speed: string; damage: string; range: string; object: string | null }
  | { do: 'spawn'; object: string; x: string; y: string }
  | { do: 'remove'; target: string | null }
  | { do: 'damage'; target: string; amount: string }
  | { do: 'heal'; target: string; amount: string }
  | { do: 'give_item'; target: string; item: string; count: string }
  | { do: 'take_item'; target: string; item: string; count: string }
  | { do: 'set_open'; target: string; open: string }
  | { do: 'state'; name: string }
  | { do: 'signal'; name: string }
  | { do: 'message'; text: string; seconds: number }
  | { do: 'alpha'; value: string; on: string | null }
  | { do: 'rotate'; by: string | null; to: string | null; seconds: string; on: string | null }
  | { do: 'spin'; speed: string; on: string | null }
  | { do: 'set_field'; component: string; field: string; value: string; on: string | null }
  | { do: 'add_component'; component: string; on: string | null }
  | { do: 'remove_component'; component: string; on: string | null }
  | { do: 'tag'; tag: string; add: boolean; on: string | null }
  | { do: 'repeat'; times: string; then: Stmt[] }
  | {
      do: 'draw';
      id: string;
      shape: DrawShape;
      anchor: DrawAnchor;
      x: string;
      y: string;
      w: string | null;
      h: string | null;
      text: string | null;
      size: string | null;
      color: string;
      object: string | null;
      alpha: string | null;
    }
  | { do: 'erase'; id: string | null }
  | { do: 'builtin_display'; what: 'hearts' | 'items' | 'all'; show: boolean }
  | { do: 'play_sound'; sound: string; volume: string; pitch: string }
  | { do: 'respawn'; target: string | null }
  | { do: 'restart_level' }
  | { do: 'complete_level' }
  | { do: 'camera_shake'; strength: string; seconds: string }
  | { do: 'camera_flash'; color: string; seconds: string }
  | { do: 'camera_zoom'; zoom: string; seconds: string }
  | { do: 'camera_focus'; target: string; seconds: string }
  | { do: 'camera_follow'; target: string | null };

export const DRAW_SHAPES = ['text', 'rect', 'circle', 'sprite'] as const;
export type DrawShape = (typeof DRAW_SHAPES)[number];
export const DRAW_ANCHORS = ['top_left', 'top', 'top_right', 'left', 'center', 'right', 'bottom_left', 'bottom', 'bottom_right', 'world'] as const;
export type DrawAnchor = (typeof DRAW_ANCHORS)[number];

export interface Handler {
  when: Trigger;
  /** Only runs while the script is in this state (null: any state). */
  state: string | null;
  /** Expression that must be true (null: always). */
  if: string | null;
  do: Stmt[];
}

export interface BehaviorScript {
  id: string;
  name: string;
  /** What it does, in plain words (shown in the editor). */
  description: string;
  enabled: boolean;
  vars: { name: string; value: ScriptValue }[];
  /** State names; the first is where it starts. Empty: no states. */
  states: string[];
  handlers: Handler[];
}

// ---------------------------------------------------------------- reference tables

export const KEYS: KeyName[] = ['left', 'right', 'up', 'down', 'jump', 'interact', 'fire'];

/** Names every expression can use (plus the script's variables). */
export const BUILTIN_NAMES: Record<string, string> = {
  self: 'this entity',
  player: 'the nearest entity tagged "player" (null if none)',
  time: 'seconds since the level started',
  dt: 'seconds since the last step (1/60)',
  state: 'the current state name ("" without states)',
  state_time: 'seconds since the current state started',
  screen_w: 'width of the play screen (px), for drawing',
  screen_h: 'height of the play screen (px), for drawing',
  pi: '3.14159…',
};
/** Names that exist only in some handlers. */
export const CONTEXT_NAMES: Record<string, string> = {
  other: 'in "event" handlers: the other entity of the event (who touched it, what hurt it…); in "signal" handlers: who sent the signal',
  it: 'inside "each": the entity being visited',
  i: 'inside "repeat": 0, 1, 2… (which time it is)',
};

/** Properties of an entity: e.x, player.health… (null entity: 0/false/""). */
export const MEMBERS: Record<string, string> = {
  x: 'center x (px; right is +)',
  y: 'center y (px; DOWN is +)',
  vx: 'horizontal speed (px/s)',
  vy: 'vertical speed (px/s; negative = going up)',
  width: 'width (px)',
  height: 'height (px)',
  grounded: 'standing on something',
  facing: '1 facing right, -1 facing left',
  angle: 'how far scripts have turned it (degrees clockwise; 0 = as placed)',
  health: 'current health (0 without Health)',
  max_health: 'maximum health',
  alive: 'still in play',
  open: 'opened (doors)',
  on: 'switched on (switches)',
  spawn_x: 'x where it started',
  spawn_y: 'y where it started',
  gravity: 'its gravity scale now (1 = normal)',
  speed_factor: 'its walking/running speed factor now (1 = normal)',
  name: 'its name',
};

export interface FunctionInfo {
  args: string;
  min: number;
  max: number;
  doc: string;
}

export const FUNCTIONS: Record<string, FunctionInfo> = {
  abs: { args: 'x', min: 1, max: 1, doc: 'absolute value' },
  min: { args: 'a, b, …', min: 2, max: 8, doc: 'smallest' },
  max: { args: 'a, b, …', min: 2, max: 8, doc: 'largest' },
  clamp: { args: 'x, lo, hi', min: 3, max: 3, doc: 'x limited to lo..hi' },
  sign: { args: 'x', min: 1, max: 1, doc: '-1, 0 or 1' },
  sqrt: { args: 'x', min: 1, max: 1, doc: 'square root' },
  floor: { args: 'x', min: 1, max: 1, doc: 'round down' },
  ceil: { args: 'x', min: 1, max: 1, doc: 'round up' },
  round: { args: 'x', min: 1, max: 1, doc: 'round' },
  sin: { args: 'radians', min: 1, max: 1, doc: 'sine' },
  cos: { args: 'radians', min: 1, max: 1, doc: 'cosine' },
  atan2: { args: 'y, x', min: 2, max: 2, doc: 'angle in radians' },
  lerp: { args: 'a, b, t', min: 3, max: 3, doc: 'a + (b - a) * t' },
  rand: { args: 'lo, hi', min: 2, max: 2, doc: 'random number between lo and hi' },
  randint: { args: 'lo, hi', min: 2, max: 2, doc: 'random whole number lo..hi (both included)' },
  chance: { args: 'p', min: 1, max: 1, doc: 'true with probability p (0..1)' },
  dist: { args: 'e[, e2]', min: 1, max: 2, doc: 'distance from self (or from e2) to e; very large if e is null' },
  dx: { args: 'e', min: 1, max: 1, doc: 'e.x - self.x' },
  dy: { args: 'e', min: 1, max: 1, doc: 'e.y - self.y (positive = e is lower)' },
  angle_to: { args: 'e', min: 1, max: 1, doc: 'angle from self to e, radians' },
  nearest: { args: 'tag', min: 1, max: 1, doc: 'nearest other living entity with the tag, or null' },
  count: { args: 'tag', min: 1, max: 1, doc: 'how many living entities have the tag' },
  exists: { args: 'e', min: 1, max: 1, doc: 'e is not null and still in play' },
  has_tag: { args: 'e, tag', min: 2, max: 2, doc: 'e has the tag' },
  items: { args: 'e, item', min: 2, max: 2, doc: 'how many of the item e carries' },
  key: { args: '"left"|"right"|"up"|"down"|"jump"|"interact"|"fire"', min: 1, max: 1, doc: 'the key is held down' },
  pressed: { args: 'key', min: 1, max: 1, doc: 'the key was pressed this step' },
  solid_at: { args: 'x, y', min: 2, max: 2, doc: 'a wall/floor (or a Pushable thing) is at that point (for ledge and wall checks, and whether a grid square is free)' },
  thing_at: { args: 'x, y, tag?', min: 2, max: 3, doc: 'the living entity (not self) at that point, optionally only one with the tag, or null: what is on a grid square (thing_at(self.x + 32, self.y, "enemy"), thing_at(x, y, "barrel"))' },
  can_see: { args: 'e', min: 1, max: 1, doc: 'no wall between self and e' },
  touching: { args: 'tag, e?', min: 1, max: 2, doc: 'self (or e) overlaps a living entity with the tag right now: touching("water"), touching("water", other)' },
  overlaps: { args: 'e', min: 1, max: 1, doc: 'self overlaps e right now' },
  get: { args: 'e, "var"', min: 2, max: 2, doc: "another entity's script variable (0 if it has none)" },
  field: { args: 'e, "Component.field"', min: 2, max: 2, doc: 'any component field of e as it is now: field(self, "Sprite.width"), field(player, "Health.maxHealth"), field(self, "Collider.size.x"), field(self, "Transform.rotation"); null if e lacks the component' },
  has_component: { args: 'e, "Component"', min: 2, max: 2, doc: 'e has that component now' },
};

export interface StatementInfo {
  /** Example JSON. */
  example: string;
  doc: string;
}

export const STATEMENTS: Record<Stmt['do'], StatementInfo> = {
  set: { example: '{"do":"set","var":"hits","value":"hits + 1"}', doc: 'set a variable of this script; with "on": an expression for another entity, set its variable of that name' },
  if: { example: '{"do":"if","cond":"dist(player) < 100","then":[…],"else":[…]}', doc: 'choose' },
  each: { example: '{"do":"each","tag":"enemy","then":[{"do":"damage","target":"it","amount":"1"}]}', doc: 'run "then" for every living entity with the tag, as "it" (at most 200)' },
  velocity: { example: '{"do":"velocity","x":"-80","y":null}', doc: 'set speed in px/s; null keeps that axis. Things with gravity keep falling; set y only to fly or launch' },
  push: { example: '{"do":"push","x":"0","y":"-200","on":"other"}', doc: 'add to speed (here: bounce whoever touched it upward)' },
  move_toward: { example: '{"do":"move_toward","target":"player","speed":"90"}', doc: 'head for an entity: walkers (with gravity) only sideways, flyers (gravity 0) straight at it; sets facing' },
  glide_to: { example: '{"do":"glide_to","x":"self.spawn_x","y":"self.spawn_y - 64","speed":"60"}', doc: 'move smoothly to a point (no gravity while gliding; speed 0 = at once)' },
  position: { example: '{"do":"position","x":"self.x","y":"self.y - 32"}', doc: 'jump to a point instantly' },
  jump: { example: '{"do":"jump","force":"320"}', doc: 'leap up (sets vy = -force); usually guarded with self.grounded' },
  face: { example: '{"do":"face","dir":"sign(dx(player))"}', doc: '1 = right, -1 = left (drawn mirrored)' },
  gravity: { example: '{"do":"gravity","scale":"0.3","on":"other"}', doc: 'change a gravity scale (0 = floats, 1 = normal); it stays until changed again (or it respawns)' },
  speed_factor: { example: '{"do":"speed_factor","value":"0.4","on":"other"}', doc: 'scale how fast it walks/runs: 1 normal, 0.4 slow (water, mud), 1.5 fast; works on the player (whose own running speed is otherwise fixed) and on patrollers; stays until changed (or it respawns)' },
  shoot: { example: '{"do":"shoot","dx":"self.facing","dy":"0","speed":"260","damage":"1","range":"400","object":null}', doc: 'fire a shot in direction (dx, dy) (normalized). It hurts like this entity (same tags + "projectile") through normal damage rules, never its shooter, and vanishes on hits and walls. object: a library object id to fire, or null for a small built-in shot' },
  spawn: { example: '{"do":"spawn","object":"<library object id>","x":"self.x","y":"self.y - 40"}', doc: 'create a copy of a library object' },
  remove: { example: '{"do":"remove","target":null}', doc: 'take it out of play (null = self)' },
  damage: { example: '{"do":"damage","target":"other","amount":"1"}', doc: 'take health (always hurts, with knock back; respects invincibility after a hit)' },
  heal: { example: '{"do":"heal","target":"self","amount":"1"}', doc: 'give health, up to the maximum' },
  give_item: { example: '{"do":"give_item","target":"other","item":"coin","count":"1"}', doc: 'add to its inventory' },
  take_item: { example: '{"do":"take_item","target":"other","item":"key","count":"1"}', doc: 'remove from its inventory' },
  set_open: { example: '{"do":"set_open","target":"self","open":"true"}', doc: 'open (not solid, faded) or close' },
  state: { example: '{"do":"state","name":"chase"}', doc: 'switch to another state (runs its enter_state handlers)' },
  signal: { example: '{"do":"signal","name":"alarm"}', doc: 'tell every script with a matching "signal" handler (they see this entity as "other")' },
  message: { example: '{"do":"message","text":"Hits: {hits}","seconds":2}', doc: 'show text on screen; {expression} parts are filled in' },
  alpha: { example: '{"do":"alpha","value":"0.5"}', doc: 'see-through amount (0 invisible … 1 solid look)' },
  set_field: {
    example: '{"do":"set_field","component":"Sprite","field":"width","value":"field(self, \\"Sprite.width\\") * 1.5","on":null}',
    doc: 'change any field of any component while playing (the component list says what exists): Sprite width/height/color/assetId, Collider size.x/size.y (two-number fields are set one half at a time), CharacterController jumpForce/speed, Health maxHealth, PhysicsBody gravityScale/bodyType, Patrol speed… and "Transform" x/y/rotation/scale.x/scale.y. Numbers are kept within the field\'s limits; a thing without the component gets it first. Read fields back with field(e, "Component.field")',
  },
  add_component: { example: '{"do":"add_component","component":"Climbable","on":null}', doc: 'give it a component (default values; then set_field to tune it): becomes climbable, stompable, collectible, a patroller…' },
  remove_component: { example: '{"do":"remove_component","component":"Damage","on":"other"}', doc: 'take a component away (it stops hurting, stops being solid without Collider, …)' },
  tag: { example: '{"do":"tag","tag":"enemy","add":true,"on":null}', doc: 'add (add true) or remove (add false) a tag (tags decide what hurts what, what a stomp or a door needs, who is "player"…)' },
  repeat: { example: '{"do":"repeat","times":"self.max_health","then":[…]}', doc: 'run "then" N times (at most 200); inside, "i" counts 0, 1, 2…' },
  draw: {
    example: '{"do":"draw","id":"heart{i}","shape":"sprite","anchor":"top_left","x":"16 + i * 40","y":"16","w":"32","h":"32","text":null,"size":null,"color":"#ff4d6d","object":"<library object id>","alpha":null}',
    doc: 'draw on the screen, on top of the game, until erased or drawn again with the same id ("{expression}" parts in id and text are filled in, so "heart{i}" makes one per repeat). shape: text (text, size = font px, color), rect / circle (w, h, color), sprite (a library object\'s look, w × h). anchor: where x, y count from (a screen corner, side or the center; x grows right, y down; the drawing lines up with that corner, e.g. "top_right" with x "-16" sits 16 px from the right edge), or "world" for level coordinates (moves with the camera: labels over things). alpha: 0..1 (null = 1). Use it for health bars, hearts, scores, timers, labels',
  },
  erase: { example: '{"do":"erase","id":"heart{i}"}', doc: 'remove a drawing by id (null = everything this entity drew)' },
  play_sound: {
    example: '{"do":"play_sound","sound":"Quack","volume":"1","pitch":"1"}',
    doc: 'play a sound from the sound list (by its name or id; make one with make_sound). volume 0..1 (an expression: "0.5"); pitch 1 = as made, 2 = an octave higher, 0.5 lower ("rand(0.9, 1.1)" varies it a little each time)',
  },
  builtin_display: { example: '{"do":"builtin_display","what":"hearts","show":false}', doc: 'hide or show the built-in display (hearts, items, or all of it), e.g. when scripts draw their own' },
  rotate: { example: '{"do":"rotate","by":"180","to":null,"seconds":"0.3"}', doc: 'turn it (degrees, clockwise): "by" turns from where it is, "to" turns to an angle (0 = upright as placed); over seconds (0 = at once). Only how it is drawn: it still collides as an upright box' },
  spin: { example: '{"do":"spin","speed":"360"}', doc: 'keep turning at degrees per second (negative = the other way, 0 stops; its angle stays where it is)' },
  respawn: { example: '{"do":"respawn","target":"other"}', doc: 'put it back at its start, full health (null = self)' },
  restart_level: { example: '{"do":"restart_level"}', doc: 'start the level again' },
  complete_level: { example: '{"do":"complete_level"}', doc: 'the level is won: play goes on to the next level' },
  camera_shake: { example: '{"do":"camera_shake","strength":"8","seconds":"0.4"}', doc: 'shake the screen (px, fading out)' },
  camera_flash: { example: '{"do":"camera_flash","color":"#ffffff","seconds":"0.3"}', doc: 'flash the screen in a color ("#rrggbb" text, not an expression)' },
  camera_zoom: { example: '{"do":"camera_zoom","zoom":"1.5","seconds":"0.5"}', doc: 'zoom to a value (0.25–4) over seconds (0 = at once)' },
  camera_focus: { example: '{"do":"camera_focus","target":"nearest(\\"door\\")","seconds":"2"}', doc: 'the camera looks at an entity for a while, then goes back' },
  camera_follow: { example: '{"do":"camera_follow","target":"self"}', doc: 'the camera follows this entity from now on (null: stays still)' },
};

export const TRIGGERS: Record<Trigger['on'], { example: string; doc: string }> = {
  start: { example: '{"on":"start"}', doc: 'once, when the level starts or it appears' },
  tick: { example: '{"on":"tick"}', doc: 'every step (60 times a second): steering, checks' },
  every: { example: '{"on":"every","seconds":2}', doc: 'every N seconds (min 0.05)' },
  enter_state: { example: '{"on":"enter_state"}', doc: 'when the handler\'s "state" is entered (needs "state")' },
  event: { example: '{"on":"event","event":"touch_started","with":"player"}', doc: 'a game event this entity takes part in (as subject or other); "with" = only when the other party has that tag (null: anything)' },
  key: { example: '{"on":"key","key":"fire","edge":"pressed"}', doc: 'player input: pressed (once), held (every step), released' },
  signal: { example: '{"on":"signal","name":"alarm"}', doc: 'another script sent this signal' },
};

// ---------------------------------------------------------------- schema

const expr = z.string().min(1);
const nexpr = expr.nullable().default(null);

const stmt: z.ZodType<Stmt> = z.lazy(() =>
  z.discriminatedUnion('do', [
    z.object({ do: z.literal('set'), var: z.string().min(1), value: expr, on: nexpr }),
    z.object({ do: z.literal('if'), cond: expr, then: z.array(stmt).default([]), else: z.array(stmt).default([]) }),
    z.object({ do: z.literal('each'), tag: z.string().min(1), then: z.array(stmt) }),
    z.object({ do: z.literal('velocity'), x: nexpr, y: nexpr, on: nexpr }),
    z.object({ do: z.literal('push'), x: expr.default('0'), y: expr.default('0'), on: nexpr }),
    z.object({ do: z.literal('move_toward'), target: expr, speed: expr }),
    z.object({ do: z.literal('glide_to'), x: expr, y: expr, speed: expr.default('60'), on: nexpr }),
    z.object({ do: z.literal('position'), x: expr, y: expr, on: nexpr }),
    z.object({ do: z.literal('jump'), force: expr, on: nexpr }),
    z.object({ do: z.literal('face'), dir: expr, on: nexpr }),
    z.object({ do: z.literal('gravity'), scale: expr, on: nexpr }),
    z.object({ do: z.literal('speed_factor'), value: expr, on: nexpr }),
    z.object({
      do: z.literal('shoot'),
      dx: expr,
      dy: expr.default('0'),
      speed: expr.default('240'),
      damage: expr.default('1'),
      range: expr.default('480'),
      object: z.string().min(1).nullable().default(null),
    }),
    z.object({ do: z.literal('spawn'), object: z.string().min(1), x: expr, y: expr }),
    z.object({ do: z.literal('remove'), target: nexpr }),
    z.object({ do: z.literal('damage'), target: expr, amount: expr.default('1') }),
    z.object({ do: z.literal('heal'), target: expr, amount: expr.default('1') }),
    z.object({ do: z.literal('give_item'), target: expr, item: z.string().min(1), count: expr.default('1') }),
    z.object({ do: z.literal('take_item'), target: expr, item: z.string().min(1), count: expr.default('1') }),
    z.object({ do: z.literal('set_open'), target: expr, open: expr }),
    z.object({ do: z.literal('state'), name: z.string().min(1) }),
    z.object({ do: z.literal('signal'), name: z.string().min(1) }),
    z.object({ do: z.literal('message'), text: z.string().min(1).max(200), seconds: z.number().positive().max(60).default(2) }),
    z.object({ do: z.literal('alpha'), value: expr, on: nexpr }),
    z.object({ do: z.literal('rotate'), by: nexpr, to: nexpr, seconds: expr.default('0'), on: nexpr }),
    z.object({ do: z.literal('spin'), speed: expr, on: nexpr }),
    z.object({ do: z.literal('set_field'), component: z.string().min(1), field: z.string().min(1), value: expr, on: nexpr }),
    z.object({ do: z.literal('add_component'), component: z.string().min(1), on: nexpr }),
    z.object({ do: z.literal('remove_component'), component: z.string().min(1), on: nexpr }),
    z.object({ do: z.literal('tag'), tag: z.string().min(1), add: z.boolean().default(true), on: nexpr }),
    z.object({ do: z.literal('repeat'), times: expr, then: z.array(stmt).default([]) }),
    z.object({
      do: z.literal('draw'),
      id: z.string().min(1),
      shape: z.enum(DRAW_SHAPES),
      anchor: z.enum(DRAW_ANCHORS).default('top_left'),
      x: expr.default('0'),
      y: expr.default('0'),
      w: nexpr,
      h: nexpr,
      text: z.string().nullable().default(null),
      size: nexpr,
      color: z.string().default('#ffffff'),
      object: z.string().nullable().default(null),
      alpha: nexpr,
    }),
    z.object({ do: z.literal('erase'), id: z.string().min(1).nullable().default(null) }),
    z.object({ do: z.literal('builtin_display'), what: z.enum(['hearts', 'items', 'all']), show: z.boolean() }),
    z.object({ do: z.literal('play_sound'), sound: z.string().min(1), volume: expr.default('1'), pitch: expr.default('1') }),
    z.object({ do: z.literal('respawn'), target: nexpr }),
    z.object({ do: z.literal('restart_level') }),
    z.object({ do: z.literal('complete_level') }),
    z.object({ do: z.literal('camera_shake'), strength: expr.default('6'), seconds: expr.default('0.4') }),
    z.object({ do: z.literal('camera_flash'), color: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'must be "#rrggbb"').default('#ffffff'), seconds: expr.default('0.3') }),
    z.object({ do: z.literal('camera_zoom'), zoom: expr, seconds: expr.default('0.5') }),
    z.object({ do: z.literal('camera_focus'), target: expr, seconds: expr.default('2') }),
    z.object({ do: z.literal('camera_follow'), target: nexpr }),
  ]),
) as z.ZodType<Stmt>;

const trigger = z.discriminatedUnion('on', [
  z.object({ on: z.literal('start') }),
  z.object({ on: z.literal('tick') }),
  z.object({ on: z.literal('every'), seconds: z.number().min(0.05).max(3600) }),
  z.object({ on: z.literal('enter_state') }),
  z.object({ on: z.literal('event'), event: z.string().min(1), with: z.string().min(1).nullable().default(null) }),
  z.object({ on: z.literal('key'), key: z.enum(KEYS as [KeyName, ...KeyName[]]), edge: z.enum(['pressed', 'held', 'released']).default('pressed') }),
  z.object({ on: z.literal('signal'), name: z.string().min(1) }),
]);

const handler = z.object({
  when: trigger,
  state: z.string().min(1).nullable().default(null),
  if: z.string().min(1).nullable().default(null),
  do: z.array(stmt).min(1),
});

export const scriptSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(60),
  description: z.string().max(400).default(''),
  enabled: z.boolean().default(true),
  vars: z
    .array(z.object({ name: z.string().min(1), value: z.union([z.number().finite(), z.boolean(), z.string().max(200)]) }))
    .default([]),
  states: z.array(z.string().min(1)).default([]),
  handlers: z.array(handler).min(1),
});

// ---------------------------------------------------------------- checking

const LIMITS = { handlers: 40, statements: 400, depth: 8, vars: 40, states: 20 };
const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;
/** Words that can't be variable names. */
const RESERVED = new Set([...Object.keys(BUILTIN_NAMES), ...Object.keys(CONTEXT_NAMES), ...Object.keys(FUNCTIONS), 'true', 'false', 'null', 'and', 'or', 'not']);

/** Every expression slot of a statement (for checking and for describing). */
export function exprSlots(s: Stmt): string[] {
  switch (s.do) {
    case 'set':
      return [s.value, ...(s.on ? [s.on] : [])];
    case 'if':
      return [s.cond];
    case 'each':
    case 'state':
    case 'signal':
    case 'restart_level':
    case 'complete_level':
      return [];
    case 'velocity':
      return [s.x, s.y, s.on].filter((x): x is string => x !== null);
    case 'push':
    case 'position':
      return [s.x, s.y, ...(s.on ? [s.on] : [])];
    case 'move_toward':
      return [s.target, s.speed];
    case 'glide_to':
      return [s.x, s.y, s.speed, ...(s.on ? [s.on] : [])];
    case 'jump':
      return [s.force, ...(s.on ? [s.on] : [])];
    case 'face':
      return [s.dir, ...(s.on ? [s.on] : [])];
    case 'gravity':
      return [s.scale, ...(s.on ? [s.on] : [])];
    case 'speed_factor':
      return [s.value, ...(s.on ? [s.on] : [])];
    case 'shoot':
      return [s.dx, s.dy, s.speed, s.damage, s.range];
    case 'spawn':
      return [s.x, s.y];
    case 'remove':
    case 'respawn':
      return s.target ? [s.target] : [];
    case 'damage':
    case 'heal':
      return [s.target, s.amount];
    case 'give_item':
    case 'take_item':
      return [s.target, s.count];
    case 'set_open':
      return [s.target, s.open];
    case 'message':
      return messageParts(s.text);
    case 'alpha':
      return [s.value, ...(s.on ? [s.on] : [])];
    case 'rotate':
      return [...(s.by ? [s.by] : []), ...(s.to ? [s.to] : []), s.seconds, ...(s.on ? [s.on] : [])];
    case 'spin':
      return [s.speed, ...(s.on ? [s.on] : [])];
    case 'set_field':
      return [s.value, ...(s.on ? [s.on] : [])];
    case 'add_component':
    case 'remove_component':
    case 'tag':
      return s.on ? [s.on] : [];
    case 'repeat':
      return [s.times];
    case 'draw':
      return [...messageParts(s.id), s.x, s.y, ...[s.w, s.h, s.size, s.alpha].filter((v): v is string => v !== null), ...(s.text ? messageParts(s.text) : [])];
    case 'erase':
      return s.id ? messageParts(s.id) : [];
    case 'builtin_display':
      return [];
    case 'play_sound':
      return [s.volume, s.pitch];
    case 'camera_shake':
      return [s.strength, s.seconds];
    case 'camera_flash':
      return [s.seconds];
    case 'camera_zoom':
      return [s.zoom, s.seconds];
    case 'camera_focus':
      return [s.target, s.seconds];
    case 'camera_follow':
      return s.target ? [s.target] : [];
  }
}

/** The {expression} parts of a message text. */
/** A sound by id, or by name (any case). */
export function findSound(project: Project, idOrName: string): Project['assets'][number] | undefined {
  const sounds = project.assets.filter((a) => a.kind === 'sound');
  return sounds.find((a) => a.id === idOrName) ?? sounds.find((a) => a.name.toLowerCase() === idOrName.trim().toLowerCase());
}

export function messageParts(text: string): string[] {
  return [...text.matchAll(/\{([^{}]+)\}/g)].map((m) => m[1]);
}

/**
 * Parses and checks a script (from the AI or a hand edit). Returns the
 * normalized script, or an error naming exactly where the problem is.
 */
export function checkScript(raw: unknown, project: Project): { script: BehaviorScript } | { error: string } {
  const parsed = scriptSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { error: `Script: ${issue.path.join('.') || 'value'}: ${issue.message}` };
  }
  const script = parsed.data as BehaviorScript;
  const name = `Script "${script.name}"`;
  if (script.handlers.length > LIMITS.handlers) return { error: `${name} has too many handlers (max ${LIMITS.handlers})` };
  if (script.vars.length > LIMITS.vars) return { error: `${name} has too many variables (max ${LIMITS.vars})` };
  if (script.states.length > LIMITS.states) return { error: `${name} has too many states (max ${LIMITS.states})` };

  const varNames = new Set<string>();
  for (const v of script.vars) {
    if (!IDENT.test(v.name)) return { error: `${name}: variable name "${v.name}" must be letters, digits and _` };
    if (RESERVED.has(v.name)) return { error: `${name}: "${v.name}" is a built-in name and can't be a variable` };
    if (varNames.has(v.name)) return { error: `${name}: variable "${v.name}" is declared twice` };
    varNames.add(v.name);
  }
  const states = new Set(script.states);
  if (states.size !== script.states.length) return { error: `${name}: a state is listed twice` };
  const objects = new Set(project.definitions.map((d) => d.id));
  const functions = Object.fromEntries(Object.entries(FUNCTIONS).map(([k, f]) => [k, { min: f.min, max: f.max }]));
  const members = new Set(Object.keys(MEMBERS));
  let count = 0;

  for (const [hi, h] of script.handlers.entries()) {
    const where = `${name}, handler ${hi + 1} (${h.when.on})`;
    if (h.state !== null && !states.has(h.state)) return { error: `${where}: unknown state "${h.state}"${suggest(h.state, [...states])}; declare it in "states"` };
    if (h.when.on === 'enter_state' && h.state === null) return { error: `${where}: enter_state needs "state"` };
    if (h.when.on === 'event' && !eventRegistry.has(h.when.event)) {
      return { error: `${where}: unknown event "${h.when.event}"${suggest(h.when.event, eventRegistry.list().map((e) => e.type))}` };
    }
    const base = new Set([...Object.keys(BUILTIN_NAMES), ...varNames]);
    if (h.when.on === 'event' || h.when.on === 'signal') base.add('other');
    const scopeOf = (names: Set<string>): Scope => ({ names, functions, members });
    const checkText = (text: string, names: Set<string>, what: string): string | null => {
      try {
        const err = checkExpr(parseExpr(text), scopeOf(names));
        return err ? `${what} "${text}": ${err}` : null;
      } catch (e) {
        if (e instanceof ExprError) return `${what} "${text}" ${e.message}`;
        throw e;
      }
    };
    if (h.if !== null) {
      const err = checkText(h.if, base, 'condition');
      if (err) return { error: `${where}: ${err}` };
    }
    const walk = (list: Stmt[], names: Set<string>, depth: number, path: string): string | null => {
      if (depth > LIMITS.depth) return `${path}: nested too deeply (max ${LIMITS.depth})`;
      for (const [si, s] of list.entries()) {
        const at = `${path}${path ? ' > ' : ''}step ${si + 1} (${s.do})`;
        if (++count > LIMITS.statements) return `${at}: the script is too long (max ${LIMITS.statements} steps)`;
        for (const text of exprSlots(s)) {
          const err = checkText(text, names, 'expression');
          if (err) return `${at}: ${err}`;
        }
        if (s.do === 'set' && !s.on && !varNames.has(s.var)) return `${at}: unknown variable "${s.var}"${suggest(s.var, [...varNames])}; declare it in "vars"`;
        if (s.do === 'state' && !states.has(s.name)) return `${at}: unknown state "${s.name}"${suggest(s.name, [...states])}; declare it in "states"`;
        if ((s.do === 'spawn' || s.do === 'shoot' || s.do === 'draw') && s.object !== null && !objects.has(s.object)) return `${at}: there is no library object "${s.object}"`;
        if (s.do === 'draw' && s.shape === 'sprite' && s.object === null) return `${at}: a sprite drawing needs "object" (a library object id)`;
        if (s.do === 'play_sound' && !findSound(project, s.sound)) {
          const names = project.assets.filter((a) => a.kind === 'sound').map((a) => a.name);
          return `${at}: there is no sound "${s.sound}"${names.length ? ` (sounds: ${names.join(', ')})` : ' (make one with make_sound first)'}`;
        }
        if (s.do === 'set_field') {
          const target = resolveField(componentRegistry, s.component, s.field);
          if ('error' in target) return `${at}: ${target.error}`;
        }
        if (s.do === 'add_component' || s.do === 'remove_component') {
          const err = checkComponent(componentRegistry, s.component);
          if (err) return `${at}: ${err}`;
        }
        if (s.do === 'repeat') {
          const err = walk(s.then, new Set([...names, 'i']), depth + 1, at);
          if (err) return err;
        }
        if (s.do === 'if') {
          const err = walk(s.then, names, depth + 1, `${at} then`) ?? walk(s.else, names, depth + 1, `${at} else`);
          if (err) return err;
        }
        if (s.do === 'each') {
          const err = walk(s.then, new Set([...names, 'it']), depth + 1, at);
          if (err) return err;
        }
      }
      return null;
    };
    const err = walk(h.do, base, 1, '');
    if (err) return { error: `${where}: ${err}` };
  }
  return { script };
}

// ---------------------------------------------------------------- reference text for the AI

export function describeScriptLanguage(): string {
  const list = (o: Record<string, string>) =>
    Object.entries(o)
      .map(([k, v]) => `  ${k}: ${v}`)
      .join('\n');
  return `Script JSON: {"id","name","description","enabled":true,"vars":[{"name","value"}],"states":["patrol","chase"],"handlers":[{"when":Trigger,"state":null|"name","if":null|"expression","do":[Statement]}]}
- Handlers run top to bottom. "state": only while in that state (states[0] is the start state). "if": an expression that must be true.
- Variables belong to each entity running the script (two goombas count separately). Values: numbers, true/false, text.

Triggers ("when")
${Object.entries(TRIGGERS)
  .map(([k, t]) => `  ${k}: ${t.doc}. ${t.example}`)
  .join('\n')}

Statements ("do"); every value is an expression given as a JSON string ("90", "self.vx * -1", "\\"left\\"")
Movement and look statements (velocity, push, glide_to, position, jump, face, gravity, speed_factor, alpha) act on this entity, or on another one given by "on" (an expression: "other", "it", "player", nearest("enemy")). A zone that affects what enters it (water, wind, a trampoline, a conveyor belt) does it with "on": "other" in its touch handlers, or "on": "it" inside "each" with overlaps(it).
${Object.entries(STATEMENTS)
  .map(([k, s]) => `  ${k}: ${s.doc}. ${s.example}`)
  .join('\n')}

Expressions: numbers, "text" or 'text', true/false/null, + - * / %, < <= > >= == !=, and/or/not (or && || !), cond ? a : b, parentheses.
Names:
${list(BUILTIN_NAMES)}
${list(CONTEXT_NAMES)}
  <your variables>
Properties of an entity (self.x, player.health, other.vy):
${list(MEMBERS)}
Functions:
${Object.entries(FUNCTIONS)
  .map(([k, f]) => `  ${k}(${f.args}): ${f.doc}`)
  .join('\n')}`;
}
