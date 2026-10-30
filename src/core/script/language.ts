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
  | { on: 'paused' }
  | { on: 'every'; seconds: number }
  | { on: 'enter_state' }
  | { on: 'event'; event: string; with: string | null }
  | { on: 'key'; key: KeyName; edge: 'pressed' | 'held' | 'released' }
  | { on: 'signal'; name: string }
  | { on: 'landed_on' }
  | { on: 'contact' }
  | { on: 'hurt' };

export type KeyName = 'left' | 'right' | 'up' | 'down' | 'jump' | 'interact' | 'fire' | 'menu';

export type Stmt =
  | { do: 'set'; var: string; value: string; on: string | null }
  | { do: 'if'; cond: string; then: Stmt[]; else: Stmt[] }
  | { do: 'each'; tag: string; then: Stmt[] }
  | { do: 'velocity'; x: string | null; y: string | null; on: string | null }
  | { do: 'push'; x: string; y: string; on: string | null }
  | { do: 'move_toward'; target: string; speed: string }
  | { do: 'chase'; target: string; speed: string }
  | { do: 'heading'; x: string; y: string }
  | { do: 'carry'; x: string; y: string }
  | { do: 'climbing'; value: string }
  | { do: 'stand_on_ladder' }
  | { do: 'grab_ledge'; dir: string }
  | { do: 'climb_ledge' }
  | { do: 'let_go' }
  | { do: 'glide_to'; x: string; y: string; speed: string; on: string | null }
  | { do: 'position'; x: string; y: string; on: string | null }
  | { do: 'jump'; force: string; on: string | null }
  | { do: 'face'; dir: string; on: string | null }
  | { do: 'climb'; dir: string; speed: string | null; on: string | null }
  | { do: 'gravity'; scale: string; on: string | null }
  | { do: 'speed_factor'; value: string; on: string | null }
  | { do: 'shoot'; dx: string; dy: string; speed: string; damage: string; range: string; object: string | null }
  | { do: 'spawn'; object: string; x: string; y: string; tag: string | null }
  | { do: 'move_group'; tag: string; dx: string; dy: string }
  | { do: 'turn_group'; tag: string; x: string; y: string; dir: string }
  | { do: 'remove'; target: string | null }
  | { do: 'damage'; target: string; amount: string }
  | { do: 'kill'; target: string }
  | { do: 'heal'; target: string; amount: string }
  | { do: 'give_item'; target: string; item: string; count: string }
  | { do: 'take_item'; target: string; item: string; count: string }
  | { do: 'set_open'; target: string; open: string; by?: string | null }
  | { do: 'set_switch'; target: string; value: string }
  | { do: 'set_health'; target: string; value: string }
  | { do: 'invincible'; seconds: string; on: string | null }
  | { do: 'knock_back'; from: string; strength: string }
  | { do: 'respawn_after'; seconds: string }
  | { do: 'defeated'; target: string }
  | { do: 'state'; name: string }
  | { do: 'signal'; name: string }
  | { do: 'emit'; event: string; other: string | null; subject?: string | null; detail?: Record<string, string> }
  | { do: 'bounce'; speed: string; on: string | null }
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
  | { do: 'play_music'; music: string }
  | { do: 'stop_music' }
  | { do: 'respawn'; target: string | null }
  | { do: 'restart_level' }
  | { do: 'restart_game' }
  | { do: 'pause' }
  | { do: 'resume' }
  | { do: 'set_sound'; enabled: string }
  | { do: 'set_music'; enabled: string }
  | { do: 'complete_level'; by?: string | null }
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
  /** The part of the engine's own code it does instead of the engine (the engine leaves that part to it). */
  takesOver?: EnginePart;
  /** Its variables and what they start at; `setting`: one to tune (shown in the object's Details to change). */
  vars: { name: string; value: ScriptValue; setting?: boolean }[];
  /** State names; the first is where it starts. Empty: no states. */
  states: string[];
  handlers: Handler[];
}

// ---------------------------------------------------------------- reference tables

export const KEYS: KeyName[] = ['left', 'right', 'up', 'down', 'jump', 'interact', 'fire', 'menu'];

/** Names every expression can use (plus the script's variables). */
export const BUILTIN_NAMES: Record<string, string> = {
  self: 'this entity',
  player: 'the nearest entity tagged "player" (null if none)',
  time: 'seconds since the level started',
  dt: 'seconds since the last step (1/120: the game runs 120 steps a second)',
  state: 'the current state name ("" without states)',
  state_time: 'seconds since the current state started',
  screen_w: 'width of the play screen (px), for drawing',
  screen_h: 'height of the play screen (px), for drawing',
  pi: '3.14159…',
  paused: 'true while the game is paused (pause / resume)',
  sound_on: 'true while sound effects are on (set_sound)',
  music_on: 'true while music is on (set_music)',
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
  climbing: 'on a ladder, climbing or holding on',
  hanging: 'hanging from a ledge (LedgeGrab)',
  bumped: 'the side it bumped into a wall on in the last step (-1 left, 1 right, 0 none)',
  following: 'being steered by a "follows" connection right now',
  blinking: 'blinking after a hit (it can\'t be hurt meanwhile)',
  floats: 'not pulled down: no gravity, or it isn\'t a falling body (fliers, things seen from above)',
  climb_dir: 'which way it is climbing a ladder (-1 up, 1 down, 0 not)',
  heading_x: 'which way it looks, sideways (-1, 0, 1; see "heading")',
  heading_y: 'which way it looks, up or down (-1, 0, 1)',
  facing: '1 facing right, -1 facing left',
  angle: 'how far scripts have turned it (degrees clockwise; 0 = as placed)',
  health: 'current health (0 without Health)',
  max_health: 'maximum health',
  alive: 'still in play',
  dead: 'it has died: waiting to come back (a player) or leaving play',
  open: 'opened (doors)',
  on: 'switched on (switches)',
  spawn_x: 'x where it started',
  spawn_y: 'y where it started',
  gravity: 'its gravity scale now (1 = normal)',
  speed_factor: 'its walking/running speed factor now (1 = normal)',
  feet: 'the y of the bottom of its body (what ladder tops are compared with)',
  hang_side: 'the side of the ledge it hangs from (1 right, -1 left; 0 when not hanging)',
  grip: 'how well it grips the floor it stands on (1 = normal, less on ice, more on rough ground): its own friction times the floor\'s',
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
  pick: { args: 'cond, a, b', min: 3, max: 3, doc: 'a if cond is true, else b: pick(music_on, "on", "off"), pick(choice == 1, "#ffd84a", "#ffffff")' },
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
  key: { args: '"left"|"right"|"up"|"down"|"jump"|"interact"|"fire"|"menu"', min: 1, max: 1, doc: 'the key is held down ("menu": Escape, P or a controller\'s Start)' },
  pressed: { args: 'key', min: 1, max: 1, doc: 'the key was pressed this step' },
  released: { args: 'key', min: 1, max: 1, doc: 'the key was let go this step' },
  solid_at: { args: 'x, y', min: 2, max: 2, doc: 'a wall/floor (or a Pushable thing) is at that point (for ledge and wall checks, and whether a grid square is free)' },
  thing_at: { args: 'x, y, tag?', min: 2, max: 3, doc: 'the living entity (not self) at that point, optionally only one with the tag, or null: what is on a grid square (thing_at(self.x + 32, self.y, "enemy"), thing_at(x, y, "barrel"))' },
  fits: {
    args: 'tag, dx, dy, block?',
    min: 3,
    max: 4,
    doc: 'every living entity with the tag could move by dx, dy: no wall there, and (with block) no other entity with the block tag there. fits("active", 0, 32, "locked"): the falling piece can drop one square',
  },
  fits_turned: {
    args: 'tag, x, y, dir, block?',
    min: 4,
    max: 5,
    doc: 'the same for a quarter turn of the group around x, y (dir 1 clockwise, -1 the other way): fits_turned("active", pivot_x, pivot_y, 1, "locked")',
  },
  count_in: {
    args: 'tag, x1, y1, x2, y2',
    min: 5,
    max: 5,
    doc: 'how many living entities with the tag have their middle inside the box x1..x2, y1..y2: a full row is count_in("locked", left, row_y - 1, right, row_y + 1) == columns',
  },
  can_see: { args: 'e', min: 1, max: 1, doc: 'no wall between self and e' },
  touching: { args: 'tag, e?', min: 1, max: 2, doc: 'self (or e) overlaps a living entity with the tag right now: touching("water"), touching("water", other)' },
  overlaps: { args: 'e', min: 1, max: 1, doc: 'self overlaps e right now' },
  ladder_here: { args: '', min: 0, max: 0, doc: 'there is a ladder it can climb where it is (at least half of it in the ladder\'s width)' },
  ladder_x: { args: '', min: 0, max: 0, doc: 'the middle x of the ladder it is at (0 when there is none)' },
  ladder_top: { args: '', min: 0, max: 0, doc: 'the y of the top of the ladder it is at (0 when there is none): compare self.feet with it' },
  floor_below_ladder: { args: '', min: 0, max: 0, doc: 'it stands on the floor (not on a ladder top): Down there does not climb' },
  inside: { args: 'e', min: 1, max: 1, doc: 'the middle of e is inside self\'s body (standing on it, seen from above: not just brushing its edge)' },
  on_ladder: { args: 'e?', min: 0, max: 1, doc: 'self (or e) is at a ladder it can climb (at least half of it in the ladder\'s width), or climbing one' },
  get: { args: 'e, "var"', min: 2, max: 2, doc: "another entity's script variable (0 if it has none)" },
  field: { args: 'e, "Component.field"', min: 2, max: 2, doc: 'any component field of e as it is now: field(self, "Sprite.width"), field(player, "Health.maxHealth"), field(self, "Collider.size.x"), field(self, "Transform.rotation"); null if e lacks the component' },
  has_component: { args: 'e, "Component"', min: 2, max: 2, doc: 'e has that component now' },
  wall_ahead: { args: 'dx, dy', min: 2, max: 2, doc: 'a wall right in front of it that way (dx -1/1 sideways, or dy -1/1 up/down): what makes a patroller turn' },
  ledge_ahead: { args: 'dir', min: 1, max: 1, doc: 'no floor just ahead of its feet that way (-1 left, 1 right; a ladder top counts as floor): a ledge to turn at' },
  ladder_choice: {
    args: 'dir, reach',
    min: 2,
    max: 2,
    doc: 'walking dir and reaching a ladder\'s middle within reach px: which ways it could climb it (1 up, 2 down, 3 both, 0 none); asked again at the same ladder it says 0 (it decides once per ladder it passes)',
  },
  shots_in_air: { args: '', min: 0, max: 0, doc: 'how many shots are flying (at most 100 at once: no more are fired meanwhile)' },
  nearest_player: { args: '', min: 0, max: 0, doc: 'the nearest player-controlled character (null when there is none)' },
  collects: { args: 'e', min: 1, max: 1, doc: 'e may pick this up (it has an Inventory, or a "collects" connection lets it)' },
};

export interface StatementInfo {
  /** Example JSON. */
  example: string;
  doc: string;
}

export const STATEMENTS: Record<Stmt['do'], StatementInfo> = {
  set: { example: '{"do":"set","var":"hits","value":"hits + 1"}', doc: 'set a variable of this script; with "on": an expression for another entity, set its variable of that name' },
  if: { example: '{"do":"if","cond":"dist(player) < 100","then":[…],"else":[…]}', doc: 'choose' },
  each: { example: '{"do":"each","tag":"enemy","then":[{"do":"damage","target":"it","amount":"1"}]}', doc: 'run "then" for every living entity with the tag, as "it" (at most 2000)' },
  velocity: { example: '{"do":"velocity","x":"-80","y":null}', doc: 'set speed in px/s; null keeps that axis. Things with gravity keep falling; set y only to fly or launch' },
  push: { example: '{"do":"push","x":"0","y":"-200","on":"other"}', doc: 'add to speed, divided by its PhysicsBody mass (here: bounce whoever touched it upward; mass 2 goes half as fast)' },
  chase: {
    example: '{"do":"chase","target":"nearest_player()","speed":"100"}',
    doc: 'one step of chasing it as enemies do: flyers (no gravity) straight at it; walkers sideways, and up or down by ladder when it is higher or lower (walking to a ladder that goes that way, lining up, climbing, stepping off level with it); sets facing',
  },
  climbing: {
    example: '{"do":"climbing","value":"true"}',
    doc: 'start (true) or stop (false) climbing the ladder it is at: while climbing nothing pulls it down and ladder tops don\'t hold it up; its speed is what the script sets (the player\'s Climbing script does this with Up/Down)',
  },
  stand_on_ladder: { example: '{"do":"stand_on_ladder"}', doc: 'climbing up and at the top of its ladder: put its feet on the ladder\'s top, stop and end the climb; the engine\'s controls do nothing more with it this step' },
  grab_ledge: { example: '{"do":"grab_ledge","dir":"1"}', doc: 'hang from the ledge on that side (-1 left, 1 right) if there is one at hand height with room to stand on top (the engine\'s ledge test): stops it, self.hanging becomes true and "ledge_grabbed" happens' },
  climb_ledge: { example: '{"do":"climb_ledge"}', doc: 'hanging from a ledge: climb up onto it (standing on top); the engine\'s controls do nothing more with it this step' },
  let_go: { example: '{"do":"let_go"}', doc: 'stop hanging from the ledge (it falls)' },
  carry: {
    example: '{"do":"carry","x":"2","y":"0"}',
    doc: 'what stands on top of it moves along by x, y px (sideways only as far as walls let it): for a platform that moves itself, by how far it moves this step',
  },
  heading: { example: '{"do":"heading","x":"1","y":"0"}', doc: 'which way it looks (x, y each -1, 0 or 1): what top-down looks and shots aimed "facing" go by' },
  move_toward: { example: '{"do":"move_toward","target":"player","speed":"90"}', doc: 'head for an entity: walkers (with gravity) only sideways, flyers (gravity 0) straight at it; sets facing' },
  glide_to: { example: '{"do":"glide_to","x":"self.spawn_x","y":"self.spawn_y - 64","speed":"60"}', doc: 'move smoothly to a point (no gravity while gliding; speed 0 = at once)' },
  position: { example: '{"do":"position","x":"self.x","y":"self.y - 32"}', doc: 'jump to a point instantly' },
  jump: { example: '{"do":"jump","force":"320"}', doc: 'leap up (sets vy = -force); usually guarded with self.grounded' },
  face: { example: '{"do":"face","dir":"sign(dx(player))"}', doc: '1 = right, -1 = left (drawn mirrored)' },
  climb: {
    example: '{"do":"climb","dir":"-1","speed":"80"}',
    doc: 'climb the ladder it is at (on_ladder()): dir -1 up, 1 down, 0 hold still on it. It first lines up with the ladder\'s middle (so platform edges beside the ladder can\'t catch it), then climbs on by itself until the ladder\'s top (standing on it) or the floor, or another climb; speed null = 80. Setting a sideways velocity while holding (dir 0) steps off. For enemies (the player climbs with Up/Down)',
  },
  gravity: { example: '{"do":"gravity","scale":"0.3","on":"other"}', doc: 'change a gravity scale (0 = floats, 1 = normal); it stays until changed again (or it respawns)' },
  speed_factor: { example: '{"do":"speed_factor","value":"0.4","on":"other"}', doc: 'scale how fast it walks/runs: 1 normal, 0.4 slow (water, mud), 1.5 fast; works on the player (whose own running speed is otherwise fixed) and on patrollers; stays until changed (or it respawns)' },
  shoot: { example: '{"do":"shoot","dx":"self.facing","dy":"0","speed":"260","damage":"1","range":"400","object":null}', doc: 'fire a shot in direction (dx, dy) (normalized). It hurts like this entity (same tags + "projectile") through normal damage rules, never its shooter, and vanishes on hits and walls. object: a library object id to fire, or null for a small built-in shot' },
  spawn: { example: '{"do":"spawn","object":"<library object id>","x":"self.x","y":"self.y - 40","tag":null}', doc: 'create a copy of a library object; tag: a tag it gets at once (null: none), e.g. "active" for the blocks of a falling piece, to move them together with move_group' },
  move_group: {
    example: '{"do":"move_group","tag":"active","dx":"-32","dy":"0"}',
    doc: 'move every living entity with the tag by dx, dy at once (a piece of several blocks moves as one); check first with fits(tag, dx, dy, "locked") so it never moves into walls or other blocks',
  },
  turn_group: {
    example: '{"do":"turn_group","tag":"active","x":"pivot_x","y":"pivot_y","dir":"1"}',
    doc: 'turn every living entity with the tag a quarter turn around the point x, y (dir 1 clockwise, -1 the other way): a falling piece rotates; check first with fits_turned(tag, x, y, dir, "locked")',
  },
  remove: { example: '{"do":"remove","target":null}', doc: 'take it out of play (null = self)' },
  damage: { example: '{"do":"damage","target":"other","amount":"1"}', doc: 'take health (always hurts, with knock back; respects invincibility after a hit)' },
  kill: { example: '{"do":"kill","target":"self"}', doc: 'it dies now, even while blinking after a hit (its health goes to 0; "died" runs; a player then respawns after its Health.respawnDelay, anything else is removed). Setting Health.currentHealth to 0 is a death too' },
  heal: { example: '{"do":"heal","target":"self","amount":"1"}', doc: 'give health, up to the maximum' },
  give_item: { example: '{"do":"give_item","target":"other","item":"coin","count":"1"}', doc: 'add to its inventory' },
  take_item: { example: '{"do":"take_item","target":"other","item":"key","count":"1"}', doc: 'remove from its inventory' },
  set_open: { example: '{"do":"set_open","target":"self","open":"true","by":"other"}', doc: 'open (not solid, faded) or close; "opened"/"closed" happen with "by" as the other party (null: this entity)' },
  set_health: { example: '{"do":"set_health","target":"self","value":"self.health - damage_taken"}', doc: 'set its current health (kept between 0 and its maximum); nothing else happens by itself (kill it at 0 with kill)' },
  invincible: { example: '{"do":"invincible","seconds":"1"}', doc: 'it blinks (its hurt look) and can\'t be hurt for that long (0: no longer)' },
  knock_back: { example: '{"do":"knock_back","from":"other","strength":"160"}', doc: 'shove it away from "from" for a moment, as a hit does (sideways and a little up; seen from above straight away), less the heavier it is (PhysicsBody mass); it stops climbing' },
  respawn_after: { example: '{"do":"respawn_after","seconds":"1"}', doc: 'a player that died: stays where it died, without controls, that long, then comes back at its start with full health (the engine does the coming back)' },
  defeated: { example: '{"do":"defeated","target":"self"}', doc: 'it leaves play as a defeated thing: shown a moment in its defeated look (SpriteStates.defeated) if it has one, fading' },
  set_switch: { example: '{"do":"set_switch","target":"self","value":"not self.on"}', doc: 'turn a switch on (true) or off (false) without "switch_activated" (emit it to make what it controls react)' },
  state: { example: '{"do":"state","name":"chase"}', doc: 'switch to another state (runs its enter_state handlers)' },
  bounce: {
    example: '{"do":"bounce","speed":"320","on":"other"}',
    doc: 'bounce it up off this (sets vy = -speed, off the ground) and it can\'t be hurt for 0.2 s, so landing on a thing that hurts on contact is never also a hit from it: what a stomp does to the stomper',
  },
  emit: {
    example: '{"do":"emit","event":"stomped","other":"other"}',
    doc: 'announce a game event with this entity as its subject (or "subject": another, e.g. "other" for "collected", whose subject is who picks it up) and "other" as its other party (or null), with an optional "detail" of named values ({"needs": "\'key\'"}) shown in the play log: rules, other scripts\' "event" handlers and the play log hear it, like the events the engine makes. E.g. "stomped" after a stomp, so whatever listens for stomps hears it',
  },
  signal: { example: '{"do":"signal","name":"alarm"}', doc: 'tell every script with a matching "signal" handler (they see this entity as "other")' },
  message: { example: '{"do":"message","text":"Hits: {hits}","seconds":2}', doc: 'show text on screen; {expression} parts are filled in' },
  alpha: { example: '{"do":"alpha","value":"0.5"}', doc: 'see-through amount (0 invisible … 1 solid look)' },
  set_field: {
    example: '{"do":"set_field","component":"Sprite","field":"width","value":"field(self, \\"Sprite.width\\") * 1.5","on":null}',
    doc: 'change any field of any component while playing (the component list says what exists): Sprite width/height/color/assetId, Collider size.x/size.y (two-number fields are set one half at a time), CharacterController jumpForce/speed, Health maxHealth, PhysicsBody gravityScale/bodyType, Patrol speed… and "Transform" x/y/rotation/scale.x/scale.y. Numbers are kept within the field\'s limits; a thing without the component gets it first. Read fields back with field(e, "Component.field")',
  },
  add_component: { example: '{"do":"add_component","component":"Climbable","on":null}', doc: 'give it a component (default values; then set_field to tune it): becomes climbable, stompable, collectible, a patroller…' },
  remove_component: { example: '{"do":"remove_component","component":"Collectible","on":"other"}', doc: 'take a component away (it stops being picked up, stops being solid without Collider, …)' },
  tag: { example: '{"do":"tag","tag":"enemy","add":true,"on":null}', doc: 'add (add true) or remove (add false) a tag (tags decide what hurts what, what a stomp or a door needs, who is "player"…)' },
  repeat: { example: '{"do":"repeat","times":"self.max_health","then":[…]}', doc: 'run "then" N times (at most 2000); inside, "i" counts 0, 1, 2…' },
  draw: {
    example: '{"do":"draw","id":"heart{i}","shape":"sprite","anchor":"top_left","x":"16 + i * 40","y":"16","w":"32","h":"32","text":null,"size":null,"color":"#ff4d6d","object":"<library object id>","alpha":null}',
    doc: 'draw on the screen, on top of the game, until erased or drawn again with the same id ("{expression}" parts in id and text are filled in, so "heart{i}" makes one per repeat). shape: text (text, size = font px, color; at a low game resolution, text under about 12 screen px is drawn in a 3×5 pixel font like PICO-8\'s, capitals only), rect / circle (w, h, color), sprite (a library object\'s look, w × h). anchor: where x, y count from (a screen corner, side or the center; x grows right, y down; the drawing lines up with that corner, e.g. "top_right" with x "-16" sits 16 px from the right edge), or "world" for level coordinates (moves with the camera: labels over things, a pose drawn on a thing): with "world", x, y is the CENTER of the drawing, the same point as a thing\'s own x, y: "self.x", "self.y" puts it exactly on the thing (not at its top-left corner). alpha: 0..1 (null = 1). Use it for health bars, hearts, scores, timers, labels',
  },
  erase: { example: '{"do":"erase","id":"heart{i}"}', doc: 'remove a drawing by id (null = everything this entity drew)' },
  play_sound: {
    example: '{"do":"play_sound","sound":"Quack","volume":"1","pitch":"1"}',
    doc: 'play a sound from the sound list (by its name or id; make one with make_sound). volume 0..1 (an expression: "0.5"); pitch 1 = as made, 2 = an octave higher, 0.5 lower ("rand(0.9, 1.1)" varies it a little each time)',
  },
  play_music: { example: '{"do":"play_music","music":"Boss theme"}', doc: 'play a song from the music list (by name or id) instead of the music playing now (the level\'s music, or another song); it loops if the song is set to loop' },
  stop_music: { example: '{"do":"stop_music"}', doc: 'stop the music' },
  builtin_display: { example: '{"do":"builtin_display","what":"hearts","show":false}', doc: 'show or hide the built-in display (hearts, items, or all of it). A game starts with it hidden (nothing is on the screen until asked for): show true is a quick way to get plain hearts or a list of carried items; anything else (score, lives, a health bar, a level counter…) is drawn by a script' },
  rotate: { example: '{"do":"rotate","by":"180","to":null,"seconds":"0.3"}', doc: 'turn it (degrees, clockwise): "by" turns from where it is, "to" turns to an angle (0 = upright as placed); over seconds (0 = at once). Only how it is drawn: it still collides as an upright box' },
  spin: { example: '{"do":"spin","speed":"360"}', doc: 'keep turning at degrees per second (negative = the other way, 0 stops; its angle stays where it is)' },
  respawn: { example: '{"do":"respawn","target":"other"}', doc: 'put it back at its start, full health (null = self)' },
  restart_level: { example: '{"do":"restart_level"}', doc: 'start the level again' },
  restart_game: { example: '{"do":"restart_game"}', doc: 'start the whole game again, from its first level' },
  pause: {
    example: '{"do":"pause"}',
    doc: 'pause the game (for a pause menu): everything stops (movement, enemies, timers, "tick" and "every" handlers, events); only "key" handlers and "paused" handlers still run (the menu reads keys in "key" handlers and draws itself in a "paused" handler) and drawings stay. "paused" is true meanwhile',
  },
  resume: { example: '{"do":"resume"}', doc: 'the game goes on after pause' },
  set_sound: { example: '{"do":"set_sound","enabled":"not sound_on"}', doc: 'sound effects on (true) or off (false) for the whole game, every level; "sound_on" tells which' },
  set_music: { example: '{"do":"set_music","enabled":"not music_on"}', doc: 'music on (true) or off (false) for the whole game (it goes on silently, so it comes back where it is); "music_on" tells which' },
  complete_level: { example: '{"do":"complete_level","by":"other"}', doc: 'the level is won: play goes on to the next level; "by": who won it ("level_completed" happens with it as the subject; null: this entity)' },
  camera_shake: { example: '{"do":"camera_shake","strength":"8","seconds":"0.4"}', doc: 'shake the screen (px, fading out)' },
  camera_flash: { example: '{"do":"camera_flash","color":"#ffffff","seconds":"0.3"}', doc: 'flash the screen in a color ("#rrggbb" text, not an expression)' },
  camera_zoom: { example: '{"do":"camera_zoom","zoom":"1.5","seconds":"0.5"}', doc: 'zoom to a value (0.25–4) over seconds (0 = at once)' },
  camera_focus: { example: '{"do":"camera_focus","target":"nearest(\\"door\\")","seconds":"2"}', doc: 'the camera looks at an entity for a while, then goes back' },
  camera_follow: { example: '{"do":"camera_follow","target":"self"}', doc: 'the camera follows this entity from now on (null: stays still)' },
};

export const TRIGGERS: Record<Trigger['on'], { example: string; doc: string }> = {
  start: { example: '{"on":"start"}', doc: 'once, when the level starts or it appears' },
  tick: { example: '{"on":"tick"}', doc: 'every step (120 times a second): steering, checks' },
  paused: { example: '{"on":"paused"}', doc: 'every step WHILE THE GAME IS PAUSED (and only then): draw a pause menu here, from its variables' },
  every: { example: '{"on":"every","seconds":2}', doc: 'every N seconds (min 0.05)' },
  enter_state: { example: '{"on":"enter_state"}', doc: 'when the handler\'s "state" is entered (needs "state")' },
  event: { example: '{"on":"event","event":"touch_started","with":"player"}', doc: 'a game event this entity takes part in (as subject or other); "with" = only when the other party has that tag (null: anything)' },
  key: { example: '{"on":"key","key":"fire","edge":"pressed"}', doc: 'player input: pressed (once), held (every step), released (the keys, touch buttons or a game controller: the same actions)' },
  signal: { example: '{"on":"signal","name":"alarm"}', doc: 'another script sent this signal' },
  landed_on: {
    example: '{"on":"landed_on"}',
    doc: 'something came down onto the top of this one this step ("other" is it): it was falling (not rising) and its feet were above this one\'s top a moment before, and it isn\'t floating (no gravity). The exact test for a stomp: runs before "contact", so a stomp can bounce the stomper before anything hurts it',
  },
  contact: {
    example: '{"on":"contact"}',
    doc: 'every step while something touches this one (overlapping, standing on it or pressed against it; "other" is it), after "landed_on" handlers and picking things up. For what touching does: hurting, pushing, slowing down',
  },
  hurt: {
    example: '{"on":"hurt"}',
    doc: 'it is hit (a "damages" connection, a shot, a script\'s damage, a rule), only when a script of its own took being hurt over (its "Being hurt" script): "other" is what hurt it (null: nothing), "damage_taken" how much. The engine does nothing else: the handler takes the health (set_health), makes it blink (invincible), knocks it back, announces "damaged" and kills it at 0',
  },
};

// ---------------------------------------------------------------- schema

const expr = z.string().min(1);
const nexpr = expr.nullable().default(null);

/**
 * A null for a setting that has a default (an AI writing "color": null on a sprite drawing) means "the default", as a
 * missing setting does: it is dropped before checking, instead of failing the whole script. Settings that may be null
 * keep their null.
 */
function nullMeansDefault(options: readonly z.ZodObject[]): (value: unknown) => unknown {
  return (value) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
    const v = value as Record<string, unknown>;
    const option = options.find((o) => (o.shape.do as z.ZodLiteral).value === v.do);
    if (!option) return value;
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v)) {
      const field = option.shape[k] as z.ZodType | undefined;
      if (val === null && field && !field.safeParse(null).success) continue;
      out[k] = val;
    }
    return out;
  };
}

const stmt: z.ZodType<Stmt> = z.lazy(() => {
  const union = z.discriminatedUnion('do', [
    z.object({ do: z.literal('set'), var: z.string().min(1), value: expr, on: nexpr }),
    z.object({ do: z.literal('if'), cond: expr, then: z.array(stmt).default([]), else: z.array(stmt).default([]) }),
    z.object({ do: z.literal('each'), tag: z.string().min(1), then: z.array(stmt) }),
    z.object({ do: z.literal('velocity'), x: nexpr, y: nexpr, on: nexpr }),
    z.object({ do: z.literal('push'), x: expr.default('0'), y: expr.default('0'), on: nexpr }),
    z.object({ do: z.literal('move_toward'), target: expr, speed: expr }),
    z.object({ do: z.literal('chase'), target: expr, speed: expr }),
    z.object({ do: z.literal('heading'), x: expr, y: expr }),
    z.object({ do: z.literal('carry'), x: expr, y: expr }),
    z.object({ do: z.literal('climbing'), value: expr }),
    z.object({ do: z.literal('stand_on_ladder') }),
    z.object({ do: z.literal('grab_ledge'), dir: expr }),
    z.object({ do: z.literal('climb_ledge') }),
    z.object({ do: z.literal('let_go') }),
    z.object({ do: z.literal('glide_to'), x: expr, y: expr, speed: expr.default('60'), on: nexpr }),
    z.object({ do: z.literal('position'), x: expr, y: expr, on: nexpr }),
    z.object({ do: z.literal('jump'), force: expr, on: nexpr }),
    z.object({ do: z.literal('face'), dir: expr, on: nexpr }),
    z.object({ do: z.literal('climb'), dir: expr, speed: nexpr, on: nexpr }),
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
    z.object({ do: z.literal('spawn'), object: z.string().min(1), x: expr, y: expr, tag: z.string().min(1).nullable().default(null) }),
    z.object({ do: z.literal('move_group'), tag: z.string().min(1), dx: expr.default('0'), dy: expr.default('0') }),
    z.object({ do: z.literal('turn_group'), tag: z.string().min(1), x: expr, y: expr, dir: expr.default('1') }),
    z.object({ do: z.literal('remove'), target: nexpr }),
    z.object({ do: z.literal('damage'), target: expr, amount: expr.default('1') }),
    z.object({ do: z.literal('kill'), target: expr.default('self') }),
    z.object({ do: z.literal('heal'), target: expr, amount: expr.default('1') }),
    z.object({ do: z.literal('give_item'), target: expr, item: z.string().min(1), count: expr.default('1') }),
    z.object({ do: z.literal('take_item'), target: expr, item: z.string().min(1), count: expr.default('1') }),
    z.object({ do: z.literal('set_open'), target: expr, open: expr, by: nexpr.optional() }),
    z.object({ do: z.literal('set_switch'), target: expr, value: expr }),
    z.object({ do: z.literal('set_health'), target: expr, value: expr }),
    z.object({ do: z.literal('invincible'), seconds: expr, on: nexpr }),
    z.object({ do: z.literal('knock_back'), from: expr, strength: expr }),
    z.object({ do: z.literal('respawn_after'), seconds: expr }),
    z.object({ do: z.literal('defeated'), target: expr }),
    z.object({ do: z.literal('state'), name: z.string().min(1) }),
    z.object({ do: z.literal('signal'), name: z.string().min(1) }),
    z.object({ do: z.literal('emit'), event: z.string().min(1), other: nexpr, subject: nexpr.optional(), detail: z.record(z.string().regex(/^[A-Za-z_]\w*$/), expr).optional() }),
    z.object({ do: z.literal('bounce'), speed: expr.default('320'), on: nexpr }),
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
    z.object({ do: z.literal('play_music'), music: z.string().min(1) }),
    z.object({ do: z.literal('stop_music') }),
    z.object({ do: z.literal('respawn'), target: nexpr }),
    z.object({ do: z.literal('restart_level') }),
    z.object({ do: z.literal('restart_game') }),
    z.object({ do: z.literal('pause') }),
    z.object({ do: z.literal('resume') }),
    z.object({ do: z.literal('set_sound'), enabled: expr }),
    z.object({ do: z.literal('set_music'), enabled: expr }),
    z.object({ do: z.literal('complete_level'), by: nexpr.optional() }),
    z.object({ do: z.literal('camera_shake'), strength: expr.default('6'), seconds: expr.default('0.4') }),
    z.object({ do: z.literal('camera_flash'), color: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'must be "#rrggbb"').default('#ffffff'), seconds: expr.default('0.3') }),
    z.object({ do: z.literal('camera_zoom'), zoom: expr, seconds: expr.default('0.5') }),
    z.object({ do: z.literal('camera_focus'), target: expr, seconds: expr.default('2') }),
    z.object({ do: z.literal('camera_follow'), target: nexpr }),
  ]);
  return z.preprocess(nullMeansDefault(union.options as readonly z.ZodObject[]), union);
}) as z.ZodType<Stmt>;

const trigger = z.discriminatedUnion('on', [
  z.object({ on: z.literal('start') }),
  z.object({ on: z.literal('tick') }),
  z.object({ on: z.literal('paused') }),
  z.object({ on: z.literal('every'), seconds: z.number().min(0.05).max(3600) }),
  z.object({ on: z.literal('enter_state') }),
  z.object({ on: z.literal('event'), event: z.string().min(1), with: z.string().min(1).nullable().default(null) }),
  z.object({ on: z.literal('key'), key: z.enum(KEYS as [KeyName, ...KeyName[]]), edge: z.enum(['pressed', 'held', 'released']).default('pressed') }),
  z.object({ on: z.literal('signal'), name: z.string().min(1) }),
  z.object({ on: z.literal('landed_on') }),
  z.object({ on: z.literal('contact') }),
  z.object({ on: z.literal('hurt') }),
]);

const handler = z.object({
  when: trigger,
  state: z.string().min(1).nullable().default(null),
  if: z.string().min(1).nullable().default(null),
  do: z.array(stmt).min(1),
});

/**
 * Parts of the engine's own code a script can take over for one object (the engine then leaves that part to the
 * script, as long as the script is there and switched on).
 */
export const ENGINE_PARTS = ['being_hurt', 'dying', 'running', 'jumping', 'climbing', 'ledge_grab', 'switching', 'unlocking', 'goal', 'picking_up', 'patrolling', 'wandering', 'shooting', 'moving', 'hopping', 'timer'] as const;
export type EnginePart = (typeof ENGINE_PARTS)[number];

export const scriptSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(60),
  description: z.string().max(400).default(''),
  enabled: z.boolean().default(true),
  /** The part of the engine's code this script does instead of the engine (see ENGINE_PARTS). */
  takesOver: z.enum(ENGINE_PARTS).optional(),
  vars: z
    .array(z.object({ name: z.string().min(1), value: z.union([z.number().finite(), z.boolean(), z.string().max(200)]), setting: z.boolean().optional() }))
    .default([]),
  // A list, but a slip the AI makes is read as the list it means: one name ("falling"), names in one string
  // ("idle, falling"), the list as JSON text ("[\"idle\",\"falling\"]"), or null (no states).
  states: z.preprocess(statesList, z.array(z.string().min(1))).default([]),
  handlers: z.array(handler).min(1),
});

function statesList(value: unknown): unknown {
  if (value === null) return [];
  if (typeof value !== 'string') return value;
  const t = value.trim();
  if (t.startsWith('[')) {
    try {
      return JSON.parse(t);
    } catch {
      // Not JSON after all: names in it, read below.
    }
  }
  return t.replace(/[[\]"']/g, ' ').split(/[\s,]+/).filter(Boolean);
}

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
    case 'restart_game':
    case 'pause':
    case 'resume':
      return [];
    case 'complete_level':
      return s.by ? [s.by] : [];
    case 'set_sound':
    case 'set_music':
      return [s.enabled];
    case 'velocity':
      return [s.x, s.y, s.on].filter((x): x is string => x !== null);
    case 'push':
    case 'position':
      return [s.x, s.y, ...(s.on ? [s.on] : [])];
    case 'move_toward':
    case 'chase':
      return [s.target, s.speed];
    case 'heading':
    case 'carry':
      return [s.x, s.y];
    case 'climbing':
      return [s.value];
    case 'grab_ledge':
      return [s.dir];
    case 'stand_on_ladder':
    case 'climb_ledge':
    case 'let_go':
      return [];
    case 'glide_to':
      return [s.x, s.y, s.speed, ...(s.on ? [s.on] : [])];
    case 'jump':
      return [s.force, ...(s.on ? [s.on] : [])];
    case 'face':
      return [s.dir, ...(s.on ? [s.on] : [])];
    case 'climb':
      return [s.dir, ...(s.speed ? [s.speed] : []), ...(s.on ? [s.on] : [])];
    case 'gravity':
      return [s.scale, ...(s.on ? [s.on] : [])];
    case 'speed_factor':
      return [s.value, ...(s.on ? [s.on] : [])];
    case 'shoot':
      return [s.dx, s.dy, s.speed, s.damage, s.range];
    case 'spawn':
      return [s.x, s.y];
    case 'move_group':
      return [s.dx, s.dy];
    case 'turn_group':
      return [s.x, s.y, s.dir];
    case 'remove':
    case 'respawn':
      return s.target ? [s.target] : [];
    case 'damage':
    case 'heal':
      return [s.target, s.amount];
    case 'emit':
      return [...(s.other ? [s.other] : []), ...(s.subject ? [s.subject] : []), ...Object.values(s.detail ?? {})];
    case 'bounce':
      return [s.speed, ...(s.on ? [s.on] : [])];
    case 'kill':
      return [s.target];
    case 'give_item':
    case 'take_item':
      return [s.target, s.count];
    case 'set_open':
      return [s.target, s.open, ...(s.by ? [s.by] : [])];
    case 'set_switch':
    case 'set_health':
      return [s.target, s.value];
    case 'invincible':
      return [s.seconds, ...(s.on ? [s.on] : [])];
    case 'knock_back':
      return [s.from, s.strength];
    case 'respawn_after':
      return [s.seconds];
    case 'defeated':
      return [s.target];
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
    case 'play_music':
    case 'stop_music':
      return [];
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
/** The game reads the menu key (Escape / P / a controller's Start) somewhere: then Escape is the game's, not the editor's. */
export function usesMenuKey(project: Project): boolean {
  const scripts = [...project.definitions.flatMap((d) => d.scripts ?? []), ...project.scenes.flatMap((s) => s.entities.flatMap((e) => e.scripts ?? []))];
  if (!scripts.length) return false;
  const text = JSON.stringify(scripts);
  return text.includes('"key":"menu"') || /\b(key|pressed)\(\s*\\?["']menu\\?["']\s*\)/.test(text);
}

/** A song by id, or by name (any case). */
export function findSong(project: Project, idOrName: string): Project['assets'][number] | undefined {
  const songs = project.assets.filter((a) => a.kind === 'music' && a.song);
  return songs.find((a) => a.id === idOrName) ?? songs.find((a) => a.name.toLowerCase() === idOrName.trim().toLowerCase());
}

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
    if (h.when.on === 'event' || h.when.on === 'signal' || h.when.on === 'landed_on' || h.when.on === 'contact' || h.when.on === 'hurt') base.add('other');
    if (h.when.on === 'hurt') base.add('damage_taken');
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
        if (s.do === 'play_music' && !findSong(project, s.music)) {
          const names = project.assets.filter((a) => a.kind === 'music' && a.song).map((a) => a.name);
          return `${at}: there is no song "${s.music}"${names.length ? ` (songs: ${names.join(', ')})` : ' (write one in the music machine, or with make_song)'}`;
        }
        if (s.do === 'emit' && !eventRegistry.has(s.event)) return `${at}: unknown event "${s.event}"${suggest(s.event, eventRegistry.list().map((e) => e.type))}`;
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
Movement and look statements (velocity, push, glide_to, position, jump, face, climb, gravity, speed_factor, alpha) act on this entity, or on another one given by "on" (an expression: "other", "it", "player", nearest("enemy")). A zone that affects what enters it (water, wind, a trampoline, a conveyor belt) does it with "on": "other" in its touch handlers, or "on": "it" inside "each" with overlaps(it).
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
