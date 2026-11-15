# PXLBuilder engine architecture: systems, profiles and roadmap

Status: proposal, revision 3 (replaces the "speed platformer" proposal, and the platformer-only revision 2). Nothing here is implemented yet.

**The goal:** an open game engine that can make all sorts of games. Each game is a combination of separate, extensible systems:

- view
- time
- movement
- geometry
- camera
- objects
- level and world generation
- progression
- rules and interface

A game profile chooses a module for each. Adding the next kind of game should mean adding a module or two and a profile, not redesigning the engine.

**Platformers come first, as the first family of design references and test cases** (not as a list of supported modes):

- Super Mario
- Puzzle platformers
- Lode Runner
- Donkey Kong
- Sonic
- Mega Man
- Super Meat Boy
- Celeste
- Hollow Knight

The engine already makes games beyond platformers: top-down adventures, RPGs with turn-based encounters, roguelikes, tactics, isometric games and shooters. These are the second family of references. They must keep working, and they should end up as profiles over the same systems, not as special cases. Section 4b says how.

---

## 1. Can the current proposal and architecture support this?

**The previous proposal:** no. It grouped the references into six "kinds", each a fixed bundle of movement, pieces, camera and builder. That is the special-mode design you warned against, in another form:

- Celeste and Super Meat Boy would share a "precision" bundle, though their movement and level design differ.
- Lode Runner and Donkey Kong had no real place.
- Each new game would need a new hardcoded bundle.

**The current engine:** partly. Some of it is already built to be extended:

| Already modular | How |
|---|---|
| Components | A registry: any object is a set of components with fields (Character Controller, Health, Shooter, MovingPlatform, DoubleJump, LedgeGrab…) |
| Behaviour | Scripts, in a language the AI and the user both write; ready-made scripts (Spring, Walker, Pressure plate…) |
| Engine parts | Jumping, climbing, patrolling, picking up and more can be handed to a script (`takesOver`) that does what the engine did and can then be changed |
| Connections | Relationships: controls, requires, teleports_to, damages |
| Starters | Separate starter object sets for platformer, top-down, RPG, roguelike and isometric games |
| Levels and links | Several levels, go_to_level (branches, secret exits), visit_level (a level visited and returned from) |
| Level building | A pattern registry and genre weightings (classic, puzzle); roles found by what objects are; a route solver with keys, switches, crates and plates in its state |
| Camera | Smoothing, a fixed look-ahead, a dead zone, bounds, shake, zoom, focus |

Other parts are single implementations with platformer assumptions built in. These are what block the variety:

| Built as one piece | The assumption | What it blocks |
|---|---|---|
| Movement (`Runtime.control`) | Two hardcoded branches: `platformer` (accelerate to a fixed speed, jump, ladders) and `topdown` | Momentum, grid-locked movement, a committed jump with no air control, wall jumps, dashes, rolling |
| Physics (`physics.ts` + ramps in `runtime.ts`) | Boxes that don't turn, plus 45° ramps | Curves, loops, shallow girders, any surface at an angle |
| Terrain | Every tile is an object, and solid ground stays solid | Digging that refills (Lode Runner); collapsing or crumbling ground |
| Camera | One follow behaviour for the whole level | Locked rooms and room transitions (Mega Man, Celeste, Hollow Knight), a look-ahead that grows with speed (Sonic), forced scrolling |
| Reach (`limits.ts`, `jumpTable`) | The player's reach is a jump arc from a table | Judging levels for dashes, wall jumps, digging, momentum |
| Route solver | The moves are walk, fall, jump, climb, swim, spring, teleport, push | The same |
| Level generator layout | Floors of sections, left to right, 1–4 floors | Single-screen arcade stages, grid stages, challenge rooms, a world of rooms |
| Roles (`roles.ts` FITS) | A fixed list of 27 parts | A new kind of piece (a rope, a dash crystal, a breakable wall) needs a code change |
| Profile | Genre (classic, puzzle) + theme | It can't say which movement, camera, generator or progression a game uses |
| Progression | Levels in order, or by script | A connected world, ability-gated areas, persistent world state, bosses as a structure |
| AI guidance | Fixed guide text that assumes a Mario-style platformer | A game whose systems differ |

**Verdict:** components, scripts, engine-part takeover, relationships, starter sets and the pattern registry are the right foundation. The movement code, physics, camera, reach, generator layout, roles and profile have to become extension points before the references can be built properly.

---

## 2. Which systems need to become modular, and how

Each system gets a **registry of modules** of the same shape: an id, a version, settings (ordinary fields, so editable by hand and by prompt), what it needs, and a short description for the AI. A module is a plain object registered in one place, as patterns are today. Nothing else needs to know about it.

### 2.0 View and time (the frame every other system sits in)

- **View:** how the world is seen.
  - `side`: platformers, side-on shooters.
  - `top`: adventures, roguelikes, top-down shooters.
  - `iso`: isometric.

  Today the view comes from the game type and gravity, and the isometric starter. It becomes a module of its own that the others declare against. Side view has gravity and "up" means jumping; top view has neither; iso adds height.
- **Time:**
  - `realtime`: most games.
  - `turns`: roguelikes, RPG battles, tactics. The turn kit (`TurnKit`) already exists; it becomes this module.
  - `steps`: grid puzzles that move only when the player moves (Sokoban-like).

  Movement, AI and validation all ask the time module whether things move now or on a turn.

### 2.1 Movement and physics

A character moves under **one locomotion model**, plus any number of **abilities**.

**Locomotion models** say how the character moves through the world:

| Model | What it is | Design references |
|---|---|---|
| `arcade` | Today's platformer movement: accelerate to a top speed, gravity, air control | Mario, Mega Man, Meat Boy, Celeste, Hollow Knight (each tuned differently) |
| `committed` | Arcade, but a jump's arc is fixed once it starts (no air control) | Donkey Kong |
| `grid` | Moves cell to cell, lined up on the grid, falls a cell at a time | Lode Runner |
| `surface` | Follows the ground at any angle, round curves, up walls and over ceilings, with momentum, slope forces and rolling | Sonic |
| `topdown` | Today's, kept | Top-down games |

**Abilities** are added on top: components that each add one thing to whatever model the character has.

- Already exist: DoubleJump, LedgeGrab.
- To add: WallSlide/WallJump, Dash (with directions, charges and refill), Roll, SpinDash, Climb (walls, with stamina), HangRope, Dig, Crouch, Pogo, MeleeAttack.

Each ability declares which models it works with, and can be taken over by a script as engine parts are today.

**Tuning numbers** stay fields:

| Field | Meaning |
|---|---|
| speed | Top speed |
| acceleration | How fast it speeds up |
| deceleration | How fast it brakes |
| friction | How fast speed falls off with no key held |
| gravity scale | How strongly it is pulled down |
| fall cap | Its fastest fall |
| air control | Control while in the air |
| coyote time | How long after leaving a ledge a jump still works |
| jump buffer | How long before landing a press of Jump still counts |
| variable jump height | Letting go of Jump early makes a shorter jump |

Meat Boy and Celeste are both `arcade`, with different numbers and different abilities:

- **Meat Boy:** very fast acceleration, momentum kept in the air, wall jump.
- **Celeste:** a precise top speed, dash, climbing with stamina, and assists.

In the code, `Runtime.control` becomes a lookup: `locomotion[e.model].step(e, input, world, dt)`, then each ability's `step`. Today's two branches become the `arcade` and `topdown` models, unchanged.

### 2.2 World geometry

The world is a set of **collision shapes** behind one query interface: sweep a box, find the ground under a point and its angle, ask what a cell holds. The shape kinds are modules:

| Shape kind | What it is | Status |
|---|---|---|
| Box | Square tiles and solid objects | Exists |
| One-way | Jump-through platforms | Exists |
| Ramp | 45° slopes | Exists |
| Height-profile tiles | A height for each pixel column, and an angle: shallow slopes, girders, hills, quarter-pipes | New |
| Loop | A loop object, with the pass-through that lets the way in and the way out cross | New |
| Stateful cells | Tiles with states and timers: dug out, refilling, crumbling, broken | New. Bricks and ? blocks are a scripted version today |
| Moving solids | Moving platforms | Exist |

Each locomotion model declares the shape kinds it understands. Others fall back sensibly: an `arcade` character treats a height-profile tile as solid ground along its profile, and a `grid` character treats it as a full cell.

### 2.3 Camera

The camera becomes a short pipeline of **behaviours**:

| Behaviour | What it does |
|---|---|
| follow | Exists |
| velocity look-ahead | Looks further ahead the faster the player moves |
| dead zone | Exists |
| vertical lag | The view follows up and down only when needed |
| room lock | The view is held inside a room |
| room transition | Slides or cuts to the next room |
| auto-scroll | The view moves by itself |
| arena lock | The view is held on a boss arena |
| focus / shake | Exist |

**Camera zones** are rectangles in a level with their own behaviours. A single zone is the general tool for:

- Mega Man rooms and boss arenas,
- Celeste screens,
- Hollow Knight rooms,
- a Donkey Kong single screen.

### 2.4 Gameplay objects and mechanics

**Object kits** replace the one starter set per game type. A kit is a named set of objects with their components and scripts, and a game is made from one or more:

| Kit | What it has |
|---|---|
| core platformer | Player, ground, enemy, coin, goal |
| blocks | ? block, brick, pipe |
| puzzle | Lever, plate, door, key, crate, teleporter |
| speed | Dash pad, rings, directional springs, checkpoint |
| arcade | Barrel spawner, oil drum, hammer |
| dig | Diggable brick, rope bar, gold, chaser |
| precision | Saw blade, dash crystal, crumbling block, spring |
| combat | Shooter weapons, melee hit, boss, health bar |
| world | Bench/checkpoint, ability pickup, breakable wall, map |

**Roles** come from the kits, not from a fixed list. Each object in a kit declares the level-builder role it plays (`role: 'ropeBar'`). Recognising roles by components stays as the fallback for objects drawn by the user or the AI.

### 2.5 Level generation

A **generator** is a module with the same outer shape as today's:

- a blueprint in (its own schema),
- a level or a world out (operations),
- validation before anything is applied.

Generators share the infrastructure:

- grid, roles, random, patterns, fingerprints and uniqueness,
- the validation pipeline,
- the editor's New level / Regenerate / Variation,
- `generate_level` for the AI.

| Generator | Structure | Design references |
|---|---|---|
| `sections` | Today's: floors of sections, left to right | Mario, puzzle |
| `track` | Long, wide levels with high and low roads, curves, loops and launches | Sonic |
| `arcade_stage` | One screen, built upward: girders, ladders, hazards coming down | Donkey Kong |
| `grid_stage` | One screen of cells: ladders, bars, diggable bricks, gold, chasers | Lode Runner |
| `challenge_rooms` | A chain of short rooms, each one precise challenge | Meat Boy, Celeste |
| `room_stage` | A stage of rooms (corridors, ladders, a boss room at the end) | Mega Man |
| `world` | A graph of rooms joined at their edges, gated by abilities, with backtracking | Hollow Knight |

**Patterns** belong to generators (a loop is a `track` pattern) but can be shared when they fit more than one.

### 2.6 Progression and world structure

A **progression model** says how the game's levels hang together:

| Model | How levels hang together | Status |
|---|---|---|
| `stages` | Levels in order | Today |
| `branching` | Exits to different levels | go_to_level exists |
| `stage_select` | Pick from a set, any order, with rewards | Mega Man |
| `world` | Rooms joined at edges and doors; world state that persists (opened, broken, collected); abilities that open new ways; save points; a map | Hollow Knight |

Under them, some pieces are shared by every model:

- checkpoints and respawn,
- abilities (gained, kept, and checked by doors and generators),
- bosses (an arena, a camera lock, a health bar, phases as a script),
- lives or instant retry,
- what persists between levels (game variables exist).

### 2.7 Validation

Validation becomes pluggable in two ways.

**A reach model, published by each movement setup.** A locomotion model and its abilities together publish:

- **Moves for the cell solver,** each with its conditions and cost:
  - jump arcs (from a table, as now),
  - wall jump,
  - dash vectors,
  - digging a cell (with its refill time),
  - hanging along a bar,
  - a committed jump.

  The solver already searches states (where the player is, keys, switches, crates). Adding moves is adding cases; a module supplies them.
- **A simulator:** a route bot for that model, which plays the route on the real runtime. Some physics can't be judged cell by cell: momentum, curves and loops, timings. For those, the bot is the check: what it finishes is what counts.

**A progression solver.** For worlds: rooms as nodes, gates as edges that need an ability or a key. It checks that every ability can be got before the gate that needs it. This generalises today's key-before-door check from one level to a whole world.

---

## 3. How the systems interact, and how a profile configures them

### 3.1 The contracts between systems

```
            ┌──────────────── game profile (data) ────────────────┐
            │ movement  geometry  camera  kits  generator  progression │
            └───┬─────────┬────────┬──────┬───────┬────────────┬──┘
                │         │        │      │       │            │
  locomotion+abilities ──►│ queries│      │       │            │
                │◄── shapes (sweep, ground+angle, cell state)  │
                │         │        │      │       │            │
     reach model ─────────┼────────┼──────┼──► generator ◄── roles from kits
     (moves + simulator)  │        │      │       │  ▲          │
                │         │        │      │       │  └── gates, rooms ── progression
                │         │   camera zones ◄──────┤  (generator places zones)
                └── validation: cell solver with the reach model's moves,
                    simulator (route bot), progression solver
```

| Between | The contract |
|---|---|
| Movement ↔ geometry | Locomotion models move only through the geometry query interface. They declare the shape kinds they understand; others fall back to the shape's box or profile |
| Movement → generation | The reach model is the one thing generators know about movement. Patterns are sized from it, as they are from `Limits` today. A pattern can need a move ("needs dash") just as it needs a role today |
| Movement → validation | The reach model's moves drive the cell solver; its simulator plays routes on the real runtime |
| Kits → generation | Generators place roles; kits say which objects play them. A pattern whose roles or moves the game lacks is left out (as now) |
| Generation → camera | Generators place camera zones (a room, a boss arena), so the camera matches the layout |
| Generation ↔ progression | A world generator outputs a room graph with gates; the progression solver checks it. Stage generators make one level of a progression model |
| Everything → AI | Every module describes itself in a line or two. The AI is told the modules the profile selects (as `builderInfo` does for patterns today), never every module there is |

### 3.2 The game profile

The profile replaces `levelProfile`, migrated: a stored classic profile becomes the Mario-inspired preset with the same theme. It selects a module for each system, each with its settings:

```jsonc
// A Sonic-inspired game
{
  "preset": "speed",
  "movement": { "model": "surface", "abilities": ["roll", "spin_dash"], "tuning": { "speed": 600, "acceleration": 170, "friction": 46 } },
  "geometry": ["box", "one_way", "height_profile", "loop"],
  "camera": [{ "behavior": "follow" }, { "behavior": "velocity_look_ahead", "max": 160 }, { "behavior": "vertical_lag" }],
  "kits": ["core", "speed"],
  "generator": { "id": "track", "settings": { "roads": 2 } },
  "progression": { "model": "stages", "checkpoints": true, "health": "rings" },
  "theme": "checkered_hills"
}

// A Lode Runner-inspired game
{
  "preset": "dig",
  "movement": { "model": "grid", "abilities": ["dig", "hang_rope"] },
  "geometry": ["box", "stateful_cells"],
  "camera": [{ "behavior": "room_lock" }],
  "kits": ["core", "dig"],
  "generator": { "id": "grid_stage" },
  "progression": { "model": "stages", "health": "lives" },
  "theme": "cave"
}
```

**Presets** are named profiles stored as data (a file of JSON), not code. A preset fills in the profile when a game is made. After that, every part can be changed on its own, by hand or by prompt, and combined freely:

- Sonic movement in a `world` (a speed metroidvania).
- Lode Runner digging in a puzzle stage.
- Celeste dashes in Mega Man rooms.

A combination that doesn't make sense is caught by declarations. For example, `grid` locomotion with height-profile geometry falls back to cells, and that is said.

**What the profile drives:**
- **New game:** the kits it lists, the player's movement, the camera on each new level.
- **Builders:** the generator for New level / Regenerate / Variation and "more levels".
- **The AI:** what it is told: the modules, their settings, their patterns.
- **Validation:** which validators run.

---

## 4. Which references need fundamentally new engine capabilities

Some of the references are new configurations of what exists. Others need things the engine can't do at all.

| Reference | Configuration of what exists, or a small module | Fundamentally new engine capability |
|---|---|---|
| Super Mario | All of it (today's engine) | — |
| Puzzle platformer | All of it (Stage 8) | — |
| Super Meat Boy | Arcade tuning (fast, momentum kept in the air); instant retry; saw blades on paths (a mover that hurts) | **Wall slide and wall jump** (a new ability). **Challenge-room generation**, with validation by simulation, because precise jumps are beyond a cell table |
| Celeste | Arcade tuning; coyote time and jump buffer (exist); springs | **Dash** (8 directions, refills), **wall climb with stamina**, and **room-by-room camera with transitions**; **challenge rooms** (as Meat Boy) |
| Mega Man | Shooter (exists); ladders; enemies | **Room-locked camera with transitions** (shared with Celeste); **weapons that switch**; **bosses** as a structure (arena, locked doors, health bar, phases); **stage select** |
| Donkey Kong | Ladders; hazards; spawning by script | **Committed jump** (a small locomotion variant). **Shallow slopes** for girders (height-profile tiles, shared with Sonic). **Things that roll down slopes and sometimes take ladders** (a behaviour). An **arcade-stage generator** |
| Lode Runner | Ladders, gold, enemies, chasing | **Grid locomotion** (moving cell to cell, lined up). **Stateful, diggable terrain** that refills on a timer, trapping enemies. **Hanging along bars.** **Enemies that path-find over ladders and bars and climb out of holes.** A **grid-stage generator**, and a solver move for digging |
| Sonic | Springs; rings as collectibles | **Surface-following physics:** angles, curves, walls, ceilings, loops with pass-through, momentum along slopes. The biggest single physics change. **Velocity look-ahead camera.** A **track generator** validated by simulation |
| Hollow Knight | Levels, doors, go_to_level, game variables | **A connected world:** rooms joined at their edges, persistent world state, a map. **Abilities that gate the way**, with a progression solver. **Melee combat** (attack hitboxes, knockback, pogo). **Bosses.** A **world generator** (a room graph with lock-and-key gating and backtracking) |

**Shared new capabilities** (built once, used by several references):

| Capability | Used by |
|---|---|
| Room camera and transitions | Mega Man, Celeste, Hollow Knight, Donkey Kong (one screen) |
| Height-profile terrain | Sonic, Donkey Kong |
| Validation by simulation | Sonic, Meat Boy, Celeste |
| Bosses | Mega Man, Hollow Knight |
| Abilities kept across levels | Hollow Knight, Mega Man |

---

## 4b. Beyond platformers: the same systems for other games

| Kind of game (references) | View · time | Movement | Geometry | Camera | Generator | Progression | Today |
|---|---|---|---|---|---|---|---|
| Top-down adventure (Zelda-like) | top · realtime | `topdown` + abilities (sword, push, dash) | boxes, stateful cells (bombable walls) | room lock + transitions | `world` (dungeon of rooms, keys) | `world` | Top-down starter; rooms and dungeons as levels |
| Roguelike | top · turns | grid steps | cells | follow | `dungeon` (exists in model/dungeon.ts) | `stages` (floors), permadeath | Roguelike starter, turn kit |
| RPG | top · realtime + turn-based battles | `topdown` | boxes | follow | towns, routes | `world` + party, inventory, shops | RPG starter (encounters, shops) |
| Tactics | iso or top · turns | grid steps by unit | cells with height | free / fixed | battle maps | `stage_select` | Tactics scripts |
| Shooter (shmup) | top or side · realtime | free 8-way, stays on screen | none or boxes | auto-scroll | waves | `stages` | Shooter, StayOnScreen |
| Sokoban-like puzzle | top · steps | grid steps, pushing | cells | fixed | grid puzzles (a solver checks every level) | `stages` | Pushable with step 32 |
| Racing / vehicles (later) | top or side · realtime | vehicle (momentum, steering) | track | chase | tracks | laps | — (shares `surface`'s momentum ideas) |

Most of the rows already exist in pieces. The work is to:
- register them as modules (views, time models, kits, generators),
- make their starters presets,
- let the AI choose and combine them through the profile.

The new capabilities for games outside platformers are of the same sort:

| Capability | Used by |
|---|---|
| Room cameras | Zelda-like |
| Grid steps with a step solver | Sokoban, roguelike |
| Wave generation | Shooters |
| Vehicles | Racing (later) |

So the platformer foundation (F1–F6) is the general foundation; nothing in it is platformer-only.

---

## 5. Implementation roadmap

Foundation first, then vertical slices. Each slice is one design reference built end to end, adding only the modules it is missing. Each slice is also an acceptance test of the architecture: if it needs a change outside its modules, the foundation was wrong, and that is fixed there.

### Foundation (no change to what games do)

**F1 starts the modularization; it doesn't finish it.** F1 registers today's implementations as modules that describe and point to the existing code. F2–F6 then **move** that code behind the interfaces:
- **F2:** `Runtime.control` becomes the `arcade` and `topdown` locomotion models.
- **F3:** the runtime's box lists become `GeometryQuery`.
- **F4:** `Limits` and the solver's hardcoded moves become reach descriptions and move rules.
- **F5:** the camera becomes a behaviour pipeline.
- **F6:** `generate.ts` and its layouts become the `sections` generator.

**When each is done:** the old path is gone (not kept beside the new one), and behaviour is identical (golden tests). A registry entry that only points to old hardcoded code is temporary: each one is marked as such in the code and in this document's checklist until its stage moves it.


| Stage | What | Done when |
|---|---|---|
| F1 | **Game profile and module registries.** Profile v2 with migration from `levelProfile` and the game type. Registries for views, time models, locomotion, abilities, geometry kinds, camera behaviours, kits, generators and progression models. Today's code registered as the first modules: the views, `realtime` and `turns` (the turn kit), `arcade` and `topdown`, box/one-way/ramp, follow, every existing starter set as kits, `sections` with classic and puzzle, `dungeon`, `stages`. Every starter (platformer, top-down, RPG, roguelike, isometric) becomes a preset stored as data. The AI is told the selected modules | Every existing test unchanged; old games of every type load as their preset; a profile survives save and load |
| F2 | **Movement as models and abilities.** `Runtime.control` split into the `arcade` and `topdown` models behind the interface. DoubleJump and LedgeGrab as abilities. First new abilities: **WallSlide/WallJump** and **Dash**, small and used by four references, to prove the interface | Physics tests for every existing movement unchanged; wall jump and dash tested in play; scripts can take them over |
| F3 | **Geometry behind a query interface.** Physics asks shapes, not the box list. **Height-profile tiles** (shallow slopes) and **stateful cells** (dig / crumble / refill) as the first new kinds | Existing physics tests unchanged; walking up a 22.5° slope; a dug cell refills and traps a walker |
| F4 | **Reach model and pluggable validation.** `Limits` becomes the reach model the movement setup publishes; solver moves come from it; the route bot takes moves from it; wall jump and dash as solver moves | Classic and puzzle sweeps unchanged; a level needing a wall jump is solvable only with WallJump |
| F5 | **Camera pipeline and zones.** Behaviours as modules; camera zones (rooms) with lock and transition; velocity look-ahead | Camera tests: a room locks; walking out slides to the next; existing camera tests unchanged |
| F6 | **Generator and progression interfaces.** `sections` behind the generator interface; generator chosen by the profile; checkpoints and abilities as shared progression pieces | Classic and puzzle unchanged through the interface; New level uses the profile's generator |

### Vertical slices (each a design reference; any order once F1–F6 are done)

| Slice | Builds | Reuses |
|---|---|---|
| V1 Celeste / Meat Boy-inspired | Tuning presets, climbing with stamina, dash crystals, crumbling blocks, the `challenge_rooms` generator, validation by simulation | F2 abilities, F5 rooms, F3 crumbling cells |
| V2 Lode Runner-inspired | `grid` locomotion, hanging along bars, digging with refill, chasers that path-find and climb out, the `grid_stage` generator, a dig solver move | F3 stateful cells, F4 moves |
| V3 Sonic-inspired | `surface` locomotion, loops, rolling and spin dash, speed pieces, the `track` generator validated by simulation | F3 height profiles, F5 look-ahead, V1 simulation |
| V4 Donkey Kong-inspired | The `committed` model, rolling barrels that take ladders, a spawner, the `arcade_stage` generator | F3 height profiles (girders), F5 a one-screen zone |
| V5 Mega Man-inspired | Switching weapons, bosses (arena, doors, health bar, phases), `room_stage`, `stage_select` | F5 rooms, F2 abilities |
| V6 Hollow Knight-inspired | The `world` generator and progression (room graph, edge transitions, persistent state, map), ability gates with the progression solver, melee and pogo | F5, V5 bosses, F2 abilities |

**Suggested order:** V1 → V2 → V3 → V4 → V5 → V6. Slices for the second family (a Zelda-like dungeon world, a Sokoban-like with a step solver, a shooter with waves) fit in anywhere after the foundation, since they reuse F5 rooms, F3 cells and F6 generators.
- **V1 first:** it exercises abilities, rooms, a new generator and simulation, with little physics risk.
- **V2:** proves a locomotion model that isn't arcade.
- **V3:** builds the hardest physics on a proven foundation.

If you'd rather see Sonic sooner, V3 can come right after F1–F4 (it needs F5's look-ahead only at the end).

**Each slice ends with its reference test:** a preset makes a new game whose levels its generator builds, its validators pass, and its route bot plays. The AI is tested with the stub model to pick that preset from a request.

### What stays true throughout

- **Old games:** they keep working (migrations; today's code becomes the first modules, unchanged).
- **Editable:** everything stays editable by hand and by prompt (modules are fields, kits are ordinary objects with scripts, levels are ordinary levels).
- **AI cost:** the AI is told only what the game's profile selects, so a richer engine doesn't make every request bigger.
- **Original work:** design references are about how games play. Heroes and art are the game's own, never copies of a company's characters.

---

# Part II: interfaces, validation, test cases, hybrids, and the scope of F1

## 7. The interfaces between systems

**Principle:** systems share **data**, not each other's code. Each system publishes a small snapshot or query interface that the others read; nothing reaches into another module's internals. Interfaces are deliberately *rich* in what they expose (surface normals, curvature, velocity, motion states) so that new modules can use them, and *narrow* in what they let others change.

### 7.1 Geometry → movement, enemies, camera, generators

Movement asks the world questions; it never walks the entity list or the tile map itself.

```ts
interface Surface {
  point: Vec2;                       // where the probe met it
  normal: Vec2;                      // unit normal: (0,-1) flat floor, (1,0) a wall facing right
  angle: number;                     // radians from flat, from the normal
  curvature: number;                 // 1/radius (0 on flat ground and straight slopes; a loop's tiles: 1/r)
  kind: 'solid' | 'oneWay' | 'loopPath';
  friction: number;
  owner: Id;                         // the object or tile it belongs to (for scripts: "landed on")
  layer?: number;                    // loops: which of the crossing paths it belongs to
}

interface CellInfo { solid: boolean; role: Role | null; state: string | null; until: number | null }

interface GeometryQuery {
  /** Moves a box by delta against what blocks it (today's moveAndCollide, behind the interface). */
  sweep(box: Box, delta: Vec2, opts?: { oneWays?: boolean; layer?: number }): { box: Box; hit: Surface | null };
  /** A ray from a point: the first surface along it (sensors for running along curves, ledge checks, enemies). */
  probe(from: Vec2, dir: Vec2, maxDist: number, opts?: { layer?: number }): Surface | null;
  /** Things overlapping a box (triggers, hazards, liquids). */
  overlaps(box: Box): Id[];
  /** Cell view, for grid models, digging, generators and solvers. */
  cell(col: number, row: number): CellInfo;
  setCell(col: number, row: number, state: string | null, until?: number): void; // dig, crumble, refill
  /** Changes whenever geometry changes (caches, the camera's bounds, path-finding). */
  readonly version: number;
}
```

- **A momentum (`surface`) model:** uses `probe` with two sensors under its feet (normal and curvature from them) and `sweep` along the surface tangent.
- **`arcade` (today):** uses `sweep` and `probe` only for ramps and ledges.
- **`grid`:** uses `cell`.
- **Digging:** an ability calls `setCell(.., 'dug', now + refill)`.
- **Enemies:** path-finding reads `cell`, or `probe` for edges.
- **Each geometry kind implements its part of these:**
  - boxes: `sweep`, `overlaps` and `cell`;
  - height-profile tiles: `probe` with a real normal and curvature;
  - loops: `layer`.

### 7.2 Movement → camera, animation, scripts, enemies, validation

Every locomotion model publishes the same **motion snapshot** each step, whatever its internals:

```ts
interface MotionSnapshot {
  position: Vec2;
  velocity: Vec2;                    // world velocity
  groundSpeed: number | null;        // along the ground (momentum models), else null
  facing: 1 | -1 | Vec2;             // side view: ±1; top view: a direction
  ground: Surface | null;            // what it stands or runs on (angle: on a wall, upside down in a loop)
  states: ReadonlySet<string>;       // 'grounded' | 'airborne' | 'rolling' | 'dashing' | 'onWall' | 'climbing' |
                                     // 'swimming' | 'hanging' | 'digging' | … (models and abilities add their own)
  intent: { moveX: number; moveY: number; jump: boolean };  // what the input asked (camera look-ahead, bots)
}
```

- **The camera** reads `velocity` and `facing` (look-ahead grows with speed) and `ground` (vertical lag only when airborne).
- **Animation** reads `states`, which pick `SpriteStates` looks. A new state (`rolling`) needs only a look named for it.
- **Scripts** read `self.speed`, `self.state("dashing")`, `self.ground_angle`: new expressions over the snapshot. A spin attack is a Hurts/Stomp script condition on `rolling`, not engine code.
- **Validation's simulator** reads the snapshot to see what happened.

The model interface itself:

```ts
interface LocomotionModel extends Module {
  views: View[];                                  // where it makes sense ('side', 'top', 'iso')
  understands: GeometryKind[];                    // the rest falls back (§7.6)
  settings: FieldSchema;                          // its tuning, shown as component fields
  step(ctx: { body: Body; intent: Intent; geo: GeometryQuery; abilities: AbilityState[]; dt: number; time: TimeModel }): void;
  snapshot(body: Body): MotionSnapshot;
  reach(settings: Settings, abilities: AbilityRef[], world: WorldParams): ReachDescription;   // §8
  simulator?: SimPolicyFactory;                   // how a bot drives it (§8.3)
}

interface Ability extends Module {
  worksWith: string[];                            // locomotion ids
  phase: 'beforeMove' | 'afterMove';              // when it runs in the step
  step(ctx): void;                                // may set states, change velocity, take over (dash)
  takeOverScript?(): BehaviorScript;              // the "engine parts" mechanism, as today
  reachMoves?(settings): MoveRule[];              // its moves for solvers (§8)
}
```

### 7.3 Camera ← movement, zones

```ts
interface CameraBehavior extends Module {
  apply(cam: CameraState, ctx: { target: MotionSnapshot | null; zone: Zone | null; bounds: Rect | null; view: Size; dt: number }): CameraState;
}
interface Zone { rect: Rect; camera: CameraBehaviorRef[]; transition?: 'slide' | 'cut' | 'none'; lockDoors?: boolean }
```

The pipeline is the profile's list of behaviours, applied in order. A zone the target is in replaces or extends the list while it's inside (a boss arena, a Celeste screen). Generators place zones (§7.5); the editor shows them as rectangles to drag, like moving-platform paths.

### 7.4 Objects and kits → everything

```ts
interface Kit extends Module {
  objects: KitObject[];              // ordinary definitions (components + scripts), as starters are today
}
interface KitObject { definition: DefinitionTemplate; role?: Role; provides?: string[] }   // provides: 'moves:spring', 'state:key'
```

- **Roles:** kits declare them. For objects drawn by the user or the AI, recognising roles by components (today's `FITS`) stays as the fallback.
- **Objects contribute moves and state to solvers.** A spring adds a launch move, a teleporter a jump across, a crate a push, a key or plate state bits. This is how today's solver already works: it only becomes declared instead of hardcoded (§8.2).

### 7.5 Generators ← reach, kits, progression → validators, camera

```ts
interface Generator extends Module {
  blueprint: ZodSchema;                           // its own (sections, track, rooms…)
  needs: { views: View[]; roles?: Role[]; reach?: ReachRepresentation[] };   // §8.1
  generate(req: { project: Project; target: SceneRef | WorldRef; blueprint: unknown; seed: number;
                  reach: ReachDescription; roles: RoleMap; progression: ProgressionContext }): Draft;
  describeForAI(project: Project): Record<string, unknown>;                  // as builderInfo is today
}

interface Draft {
  ops: Operation[];                               // what makes it (applied only after validation)
  grids: LevelGrid[];                             // the cell view of each level or room
  intent: {
    routes: { from: Point; to: Point; via: Point[]; needs: string[] }[];     // the routes it meant
    mechanics: string[];                          // what it used: 'gap', 'loop', 'dash', 'dig', 'key'…
    zones: Zone[];
    gates: { at: Point; needs: string }[];        // doors, ability gates
  };
  madeBy: LevelMadeBy;
}
```

The **draft's intent** is what validators check against (§8): the routes the generator meant, and the mechanics it used. A generator says "this needs a dash here", and validation proves it.

### 7.6 Progression ← generators, abilities

```ts
interface ProgressionModel extends Module {
  structure(project: Project): ProgressGraph;     // nodes: levels or rooms; edges: exits, doors, edges of rooms
  persists: string[];                             // what is kept between nodes: 'abilities', 'opened', 'collected'…
}
interface ProgressGraph { nodes: { id: Id; scene: Id }[]; edges: { from: Id; to: Id; needs: string[] }[] }
```

A world generator writes the graph, and the progression solver (§8.2) checks it. `stages` is the trivial graph, levels in a line, which is what games have today.

### 7.7 What a module declares (the same for every system)

```ts
interface Module {
  kind: 'view' | 'time' | 'locomotion' | 'ability' | 'geometry' | 'camera' | 'kit' | 'generator' | 'progression' | 'validator';
  id: string; version: number;
  describe: string;                               // one line for the AI and the profile panel
  requires: string[];                             // capability tags: 'view:side', 'geometry:cells', 'reach:moves'…
  provides: string[];                             // 'moves:dash', 'camera:rooms', 'reach:simulator'…
  fallback?: Record<string, string>;              // 'geometry:height_profile' → 'as boxes'
}
```

One `Registry<Module>` helper serves every kind: register, list by kind, look up by id. There is no class hierarchy and no framework. Tags are plain strings, so a new capability is a new tag, not a code change elsewhere.

---

## 8. Extensible validation

**The rule:** the profile's modules and the draft's mechanics decide *how* a level is validated. No validator is assumed. A level is **validated** when every required check passes, **uncertain** when something couldn't be judged (said, never passed off as validated), and **invalid** when a check fails. These are today's three states, kept.

### 8.1 Reach descriptions: what movement offers to validation

A movement setup (its locomotion model, abilities and the objects in the game) publishes a **reach description**. It holds one or more *representations*, each optional:

```ts
interface ReachDescription {
  /** Analytical: closed-form numbers (today's jump table: rises, gaps, spring rows). Cheap; for sizing and static checks. */
  table?: ReachTable;
  /** Mechanics-specific: move rules for a graph search over cells and states. */
  moves?: MoveRule[];
  /** Simulation: drives the real runtime (a bot policy, or an input search). Slow; covers anything the runtime does. */
  simulator?: SimPolicyFactory;
  /** Which mechanics each representation covers soundly (§8.4). */
  covers: { table: string[]; moves: string[]; simulator: string[] };
}

interface MoveRule {
  id: string;                                     // 'jump', 'wall_jump', 'dash', 'dig', 'push', 'spring', 'teleport'
  stateSlots?: StateSlot[];                       // extra search state it needs: dashes left, stamina, dug cells+time
  successors(s: SearchState, world: CellWorld): { to: SearchState; cost: number }[];
}
```

**What each setup can offer:**

| Setup | Table | Moves | Simulator |
|---|---|---|---|
| `arcade` (Mario, puzzle) | yes (today's `jumpTable`) | walk, fall, jump (from the table) | route bot (today's) |
| + WallJump | (no closed form) | wall_slide, wall_jump | route bot + wall policy |
| + Dash | — | dash in 8 directions, with a "dashes left" slot refilled on landing or by crystals | input search |
| `grid` + Dig | — | step, climb, hang, fall, dig (a "dug cells with refill time" slot) | grid bot |
| `surface` (momentum) | — (momentum has no table) | — | track bot (hold the run, jump at marks), input search |
| `committed` (Donkey Kong) | a fixed arc table | jump (fixed arcs), climb | route bot |
| Objects | — | spring, teleport, push crate, key/switch/plate state | (simulated by the runtime) |

### 8.2 Validators: a registry like the rest

```ts
interface Validator extends Module {
  strategy: 'static' | 'analytical' | 'solver' | 'simulation' | 'progression';
  cost: 'cheap' | 'moderate' | 'expensive';
  needs: ('table' | 'moves' | 'simulator')[];     // what of the reach description it uses
  validate(draft: Draft, ctx: { reach: ReachDescription; project: Project; budgetMs: number }): Verdict;
}
interface Verdict {
  state: 'pass' | 'fail' | 'unknown';
  covered: string[];                              // the mechanics it judged
  problems: string[];                             // where and why, mapped back to sections or rooms
  evidence?: { route?: Point[]; replay?: InputLog };   // a route or a replay the editor can show
}
```

The first validators are today's checks, registered as they are:

| Validator | Strategy | What it is today |
|---|---|---|
| `layout` | static | winProblems, layoutProblems, startConflicts |
| `checker` | analytical | levelReachability (jump arcs, ladders, springs, ceilings). Also judges hand-drawn and AI-drawn levels |
| `cell_solver` | solver | `solveLevel`, its moves and state slots now taken from the reach description and the objects |
| `puzzle_needed` | solver | `unneededPuzzles` (each puzzle piece removed in turn) |
| `route_bot` | simulation | `playRoute`, today a test only, becomes a validator |

Later validators are added the same way:
- `input_search`: a bounded search over input sequences on the deterministic runtime, for precision rooms.
- `track_bot`: momentum.
- `grid_bot`: digging.
- `progression`: a graph search over abilities and keys across rooms; it generalises today's key-before-door check.

### 8.3 Reproducible simulation (practical, not a big prerequisite)

What is required: **the same initial state, inputs and seeds give the same result.** A simulation test records:
- the level (its project state),
- the input log,
- the seeds it used.

Replaying them must reproduce the verdict.

This is not a "fully deterministic engine" project that blocks other work:
- The runtime already steps at a fixed `dt`.
- Randomness the runtime uses is seeded per run as it is met; the camera shake already has a hook.
- Each part that can't yet guarantee reproduction is **listed as a known limitation** (in this document and in the validator's notes) rather than fixed up front. Examples: wall-clock time read by a script, or physics that depends on frame rate.
- A validator whose replay doesn't reproduce says so, and its verdict counts as **uncertain**.

A simulator policy is per locomotion model:
- **Route following:** today's bot for `arcade`.
- **Mark following:** for tracks, the generator's `intent.routes` say where to jump.
- **Input search:** a beam search over a few inputs per frame window, for precision rooms where the route is a puzzle in itself.

### 8.4 Choosing the validators for a draft

1. Collect the draft's mechanics (`intent.mechanics`, from the patterns, kits and abilities it used).
2. **Static** validators always run (`layout`).
3. For each mechanic, use the **cheapest** representation whose `covers` includes it: table, then moves, then simulator.
4. A mechanic no representation covers makes the level **uncertain**, with a note ("momentum on curves isn't checked: no simulator for this movement").
5. Run the chosen validators, cheapest first; stop at the first **fail**. A generator then repairs the failing section, or rebuilds it, as today.
6. **Combinations, not only single mechanics.** Coverage is checked for the *set* of mechanics that meet in a level, and where they meet. A representation covers a combination only if it declares so: `covers` lists combinations too, such as `['spring', 'mover']` or `['momentum', 'curve', 'spring']`. A combination nobody declares goes to the next stronger method, even when each part alone is covered. Interactions are found where they occur: the draft's intent records the mechanics of each section, and two mechanics within reach of each other (a spring launching onto a moving platform, momentum carried off a curve into a spring) count as a combination. By default, an undeclared combination of two or more physical mechanics means simulation. With no simulator, the level is **uncertain**, and the note names the combination.
7. Simulation costs time, so it has a budget per level: the profile's `validation.budgetMs`, by default about 2 s in the editor. Within the budget its verdict counts; past it, the level is **uncertain**.

**What this gives for each reference:**

| Reference | What validates its levels |
|---|---|
| Mario | `layout` + `checker` + `cell_solver` (today) |
| Puzzle | + `puzzle_needed` (today) |
| Celeste | `cell_solver` with dash and wall-jump moves where the moves cover the room, otherwise `input_search` |
| Lode Runner | `cell_solver` with dig moves and refill timing (enemy timing makes some levels uncertain), plus `grid_bot` |
| Sonic | `layout` + `track_bot` (no table or moves for momentum) |
| Hollow Knight | `progression` across rooms + each room by its own movement's validators |

---

## 9. The design references as architectural test cases

**The rule:** no module, file or setting is named after a game. Each reference is a **preset** (data) plus **acceptance tests**, and every capability it needed is a reusable module that other presets can select. A slice that needs a change outside its own new modules has found a flaw in the foundation, and the flaw is fixed there.

| Reference | Demonstrates (reusable modules) | Its acceptance test |
|---|---|---|
| Mario | `arcade` locomotion; boxes, one-ways and ramps; follow camera; core + blocks kits; `sections` generator; `stages` progression; `checker` + `cell_solver` validation | Today's classic sweep, run through the interfaces, gives identical levels (golden hashes) |
| Puzzle | Object-contributed moves and state (crates, plates, keys); `puzzle_needed` | Today's puzzle sweep, identical, through the interfaces |
| Celeste | Dash and WallJump/Climb abilities; room zones with transitions; `challenge_rooms`; `input_search` | Generated rooms solvable only with the dash (removing it fails validation); the bot clears them |
| Super Meat Boy | Arcade tuning (momentum in the air); instant retry; hazards on paths; the same `challenge_rooms` with other settings | The same generator with Meat Boy's preset gives different rooms (different reach), all validated |
| Lode Runner | `grid` locomotion; Dig + HangRope; stateful cells; path-finding chasers; `grid_stage`; dig moves | Stages winnable only by digging; chasers trapped in holes in play |
| Sonic | `surface` locomotion; height-profile geometry and loops; velocity look-ahead; `track`; `track_bot` | A loop is gone round at speed and falls off when slow; tracks validated by the bot on both roads |
| Donkey Kong | `committed` locomotion; girders as height profiles; a rolling hazard that takes ladders; a spawner; `arcade_stage` | Stages validated with fixed arcs; barrels roll down the girders in play |
| Mega Man | Room zones (reused from Celeste); weapons; bosses (an arena zone, locked doors, phases); `room_stage`; `stage_select` | A stage of rooms ends in a boss arena that locks; a weapon from a boss carries to the next stage |
| Hollow Knight | `world` generator and progression; persistent state; ability gates; melee and pogo abilities; a map | Every generated world passes the progression solver; the world can't be finished without each gating ability |

**Hybrid acceptance tests (architectural criteria, not F1):** at least these, with genuinely different systems working together, each built from modules the references introduced, with no code for the combination itself:

| Hybrid | Movement | Camera | Generator | Progression |
|---|---|---|---|---|
| Momentum Metroidvania | `surface` | look-ahead + room zones | `world` | ability gates |
| Precision movement in rooms with bosses | `arcade` + Dash + WallJump | room zones | `room_stage` | `stage_select` + bosses |
| Digging puzzles | `grid` + Dig | room lock | `grid_stage` with puzzle objects | `stages` |

Each must pass `checkProfile`, generate validated content (with the combination-aware validation of §8.4), and be played through by its simulator. These are added to the roadmap after the slices they depend on, and the architecture isn't considered done without them.

**Second family** (the engine's other starters, kept working through the same interfaces): top-down adventure, RPG, roguelike, tactics, isometric, shooter. Their acceptance tests are the existing tests, unchanged, with each starter becoming a preset.

---

## 10. Hybrids and compatibility

**Presets are starting points.** After a game is made, its profile is its own: each system's module and settings can be changed on its own (by hand in a profile panel, or by prompt with a `set_game_profile` operation).

**Compatibility is checked from the declarations** (`requires`, `provides`, `fallback`), not from a list of allowed combinations:

```ts
type Compatibility = { state: 'ok' } | { state: 'degraded'; notes: string[] } | { state: 'incompatible'; reasons: string[] };
function checkProfile(p: GameProfile): Compatibility;
```

1. Every `requires` tag of every selected module must be `provided` by another selected module, or by the engine core.
2. An unmet tag that has a `fallback` is **degraded**: it works, and the fallback is said ("height-profile ground will be treated as square cells by grid movement").
3. An unmet tag with no fallback is **incompatible**: the change is refused, with the reason and what would fix it.

**Examples:**

| Hybrid | Result |
|---|---|
| Sonic movement in a Metroidvania world: `surface` + `world` + room camera | **ok, at a cost**: `world` needs each room validated, and `surface` provides only `reach:simulator`, so rooms are validated by the track bot. Slower generation, but sound |
| Celeste movement in Mega Man rooms: `arcade` + Dash + WallJump + `room_stage` + room zones | **ok** |
| Lode Runner digging in a puzzle stage: `grid` + Dig + puzzle kit + `grid_stage` | **ok**: crates and plates contribute their moves to the dig solver |
| Grid movement over curved ground: `grid` + height-profile geometry | **degraded**: curves count as full cells |
| Momentum movement with turn-based time: `surface` + `turns` | **incompatible**: `surface` requires `time:realtime` |
| A top-view game with the `track` generator | **incompatible**: `track` requires `view:side` |

---

## 11. Mario and puzzle through the interfaces: verified, and the work they need

They work today, but not through interfaces. I checked the code paths they use:

| Today | Where | Through which interface | Stage |
|---|---|---|---|
| Starter chosen by `settings.gameType`, only `platformer` or `topdown`. RPG, roguelike and isometric games are saved as `topdown`, with no record of which starter they came from | `factory.ts`, `rpgStarter.ts`, `roguelikeStarter.ts`, `isometricStarter.ts`, `persistence.ts` | Kits + presets; migration infers the preset from the starter objects' `metadata.starter` names | F1 |
| Genre and theme in `levelProfile`; builder by genre | `levelGen/profile.ts`, `build.ts` | Profile → generator `sections` with its genre setting | F1 |
| Generator internals: floors, sections, `GENRE_BUILDS` | `generate.ts`, `genres.ts` | `Generator` interface (F1 registers it; F6 moves the rest behind it) | F1 / F6 |
| Movement: `Runtime.control` with `platformer` and `topdown` branches; ramps, ladders, ledges, swimming, climbing inside it | `runtime.ts` | `arcade` and `topdown` locomotion; DoubleJump and LedgeGrab as abilities | F2 |
| Collision: box lists built inside the runtime (`staticSolids`, `slopes`, `oneWays`, `ladderTops`); `moveAndCollide` | `runtime.ts`, `physics.ts` | `GeometryQuery` over box, one-way and ramp kinds | F3 |
| Reach: `jumpTable` → `Limits` | `reachability.ts`, `limits.ts` | `ReachDescription.table` from the `arcade` model | F4 |
| Solver moves hardcoded (walk/fall/jump/climb/swim/spring/teleport/push), state as fixed bit fields | `solver.ts` | `MoveRule`s from the locomotion model and from objects (springs, teleporters, crates, keys, plates) | F4 |
| Roles: a fixed `FITS` list | `roles.ts` | Kit role declarations; `FITS` stays as the fallback | F1 (declarations) |
| Camera: one follow with fixed look-ahead and dead zone, per level | `camera.ts`, `model/camera.ts` | The `follow` behaviour in the pipeline | F5 |
| AI: fixed guide text; `set_level_profile` | `guideSections.ts`, `operations.ts` | Module descriptions from the profile; `set_game_profile` (with `set_level_profile` kept as a shorthand) | F1 |

**Each move is proven by identical behaviour:**
- golden hashes of generated levels and new projects, recorded before the change;
- every existing unit and browser test unchanged.

That is the "no new features, real work" part of the foundation: Mario and puzzle are the first users of every interface.

---

## 12. F1, precisely, and its tests

**F1 does:**
1. **`GameProfile`** in `settings.profile` (schema, format version 15, migration), with a section for each system: view, time, movement, geometry, camera, kits, generator, progression, validation, theme. `levelProfile` and `gameType` are migrated into it; `gameType` stays readable for old code until F2 and F3 move it.
2. **`Registry<Module>` and `Module`** (§7.7). The existing implementations are registered as modules that *describe and point to* today's code, without moving it yet:
   - views: side, top, iso;
   - time: realtime, turns;
   - locomotion: arcade, topdown;
   - geometry: box, one_way, ramp;
   - camera: follow;
   - kits: one per existing starter set, with role declarations;
   - generators: `sections` (genre setting classic/puzzle), `dungeon`;
   - progression: `stages`;
   - validators: layout, checker, cell_solver, puzzle_needed.
3. **Presets as data:** platformer-classic, platformer-puzzle, top-down, RPG, roguelike, isometric.
4. **New game from a preset:** the starter chooser makes games through presets (kits → objects, locomotion → the player's controller settings), so starters, and with them the presets, are the way games are made.
5. **Dispatch through the profile:** New level / Regenerate / Variation, "more levels" and `generate_level` find the generator via the profile; the level ideas read the profile.
6. **`checkProfile`** compatibility (§10).
7. **Editing:** `set_game_profile` (AI and command), undoable; a small profile panel in the Game card (each system: its module, with compatible choices only).

**F1 doesn't:** move movement, physics, camera or solver code (F2–F5), or add new gameplay. Its value is that every later stage plugs in instead of special-casing, and that the profile shows and edits what a game is made of.

**Tests, one or more for each of your points:**

| Requirement | Test |
|---|---|
| Existing games can use the profile system | Saved projects of every starter (fixtures written by today's code, before the change) load with the right preset inferred (classic, puzzle, top-down, RPG, roguelike, isometric); their levels play as before (runtime test on the fixtures) |
| Starter sets and generation unchanged | Golden snapshots: a new game from each preset has exactly the definitions, components and scripts of today's `createProject` / `createRpgProject` / …; the classic and puzzle sweeps through the profile give byte-identical operations to today's direct calls (hashes recorded before the change) |
| Different profiles select different implementations | Classic vs puzzle profile → different generators (`madeBy.generator`); a test-only generator module registered and selected by a profile is the one New level uses; the locomotion section selects `arcade` vs `topdown` and the new game's player gets that controller |
| Profiles can be saved, loaded and edited | Round trip through save/load (schema); `set_game_profile` changes one system, keeps the rest, undoes in one step; an incompatible edit is refused with its reason; the AI's operation goes through the same check |
| Backward compatibility | All existing migration tests; a game from every format version up to 14 loads; a game without a profile gets one inferred and nothing written until changed (as `levelProfile` today); every existing unit and browser test passes unchanged |
| Combining compatible modules | `checkProfile` table tests (§10: ok / degraded / incompatible); a hybrid preset (side view + `arcade` + platformer and puzzle kits + RPG kit) makes a game with all three kits' objects, no duplicate roles, and builds validated levels |

**Size:** about one stage of the size of the level-builder stages. It ends with the profile panel visible in the editor, so the foundation is something you can see and use, not only code.

---

## 13. Progress

### F1 — done (awaiting review before F2)

**What exists now:**

| Piece | Where | What it does |
|---|---|---|
| Profile | `engine/profileSchema.ts`, `settings.profile` (format 15) | View, time, movement (model + abilities), geometry, camera, kits, generator (+ settings), progression, theme; module ids are plain strings, so a game naming an unknown module still loads |
| Module registry | `engine/module.ts` | One `Module` shape for every system (requires / provides / fallback tags, `pointsTo` while the code hasn't moved) and one `ModuleRegistry` |
| Today's modules | `engine/modules.ts` | Views `side` / `top` / `iso`; time `realtime` / `turns`; locomotion `arcade` / `topdown`; abilities `double_jump` / `ledge_grab`; geometry `box` / `one_way` / `ramp`; camera `follow`; kits `platformer` / `topdown` / `rpg` / `roguelike` / `isometric`; generators `sections` / `dungeon`; progression `stages`; validators `layout` / `checker` / `cell_solver` / `puzzle_needed` / `route_bot` |
| Presets (data) | `engine/presets.ts` | `platformer`, `classic-platformer`, `puzzle-platformer`, `topdown`, `rpg`, `roguelike`, `isometric` |
| Profile logic | `engine/profile.ts` | Profile inferred for games without one (from their objects, never written); compatibility check; new game from a profile or preset (kits merged without repeating a part); `setGameProfile` (checked; applies movement, gravity for a view, kits added) |
| Kit recognition | `engine/infer.ts` | Which kit (preset) a game was made from, by its objects' names: data only, so loading a game (and the exported player) doesn't need the starter sets; a test checks it against every kit |
| Kit roles | `engine/kitRoles.ts` | The level-builder part each kit object plays, declared; `findRoles` counts a declaration as well as what the object is |

**What goes through the profile now:**
- New games (the starter chooser and the AI's switch_starter make games from presets).
- The level builder (New level / Regenerate / Variation, "more levels", generate_level find the generator from the profile).
- `set_level_profile` (it writes the profile).
- The AI's context (`game.profile`; with whole-game requests, also the choices and presets).
- The new `set_game_profile` operation.
- The **Game profile** dialog (project menu).

**Still pointing to old code**, to be moved by the stages named (this is the checklist §5 asks for; the test "modules that only point to old code…" fails if one loses its stage):

| Module | Old code | Moves in |
|---|---|---|
| locomotion `arcade`, `topdown`; abilities `double_jump`, `ledge_grab`; time `turns` | `Runtime.control`, `walkTopDown`, ledge code; `TurnKit` | F2 |
| geometry `box`, `one_way`, `ramp` | `physics.ts`, the runtime's box lists | F3 |
| validators `layout`, `checker`, `cell_solver`, `puzzle_needed`, `route_bot` | `reachability.ts`, `solver.ts`, `generate.ts`, `routeBot.ts` | F4 |
| camera `follow` | `runtime/camera.ts` | F5 |
| generators `sections`, `dungeon`; progression `stages` | `generate.ts` and its layouts, `dungeon.ts`, next_level / go_to_level | F6 |

**Known limitations of F1:**
- **Not every system acts yet.** View, movement, kits and generator act on the game. Time, geometry, camera and progression are recorded and checked, but their code doesn't yet read the profile: camera settings stay per level, and the turn kit runs by scripts, as before. That is F2–F6.
- **The generator's genre without a look:** a profile can now name a genre with no theme chosen (presets do). It counts as chosen, while the theme is still worked out from the game, as before.
- **`gameType` stays** in settings, read where the old code reads it, until F2/F3 move that code.
- **Kits added to an existing game:** objects that repeat a name or a part already in the game are left out. A kit taken away doesn't remove objects.
- **Size:** the editor page grows by about 27 KB (3.571 → 3.598 MB). The exported player is unchanged in what it carries. A first build pulled every starter set into the player through the migration; recognising kits by name fixed it.
- **AI cost:** the profile line adds about 230 characters to each request's context. The instructions sent with every request stay under their 120,000-character budget: the new operation's description was paid for by trimming wordy examples elsewhere.
