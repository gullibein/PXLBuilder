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

---

# Part III: a general-purpose engine — principles, the cross-genre regression suite, and F2

## 14. Principle: a general-purpose engine, with no regression in any genre

Platformers are a test family, not the shape of the engine. These principles apply to **every** later stage:

1. **No genre gets worse.** Games PXLBuilder already makes keep working as before:
   - platformers;
   - top-down adventures, RPGs, roguelikes, isometric games;
   - space shooters;
   - falling-block puzzles (Tetris, Columns, Dr. Mario);
   - mining games (Motherload-like);
   - grid physics puzzles (Boulder Dash-like).
2. **No abstraction assumes a platformer.** Nothing may assume there is a player, that it walks on platforms, that there is gravity, or that levels are made of floors. Each system must allow "nothing of this kind here":
   - **Movement:** many games have no engine-moved player at all. A Tetris board moves *groups* of blocks; a Boulder Dash hero steps a square at a time by script.
   - **Time:** realtime, turns, or fixed ticks (`every 0.1 s` handlers).
   - **Geometry:** boxes, or cells on a board.
   - **Camera:** following, or still.
   - **Level generation:** none (the AI or the user makes the board), or a random dungeon, or sections.
3. **Fundamentally different games get their own implementations** where they need them, rather than being forced into shared shapes for uniformity. A falling-block game's movement *is* its script statements (`spawn … tag`, `fits`, `move_group`, `turn_group`, `count_in`). The profile names that model; it doesn't pretend the board is a character.
4. **Refactoring a shared system means regression tests for every genre that depends on it.** In particular, the cross-genre regression suite (§15) runs unchanged before and after.
5. **Representative games of every genre are in the golden and acceptance tests,** not only platformers.
6. **The categories are kept under review.** Each stage asks whether the systems and interfaces still describe every game PXLBuilder makes.

**How the games outside platformers are actually made today** (and so what the architecture must keep supporting):

| Game | Made from | What "moves" it |
|---|---|---|
| Space shooter | Top-down starter; the ship's Shooter (key) and StayOnScreen; enemies with Health, Shooter (auto) and the ready-made Swooper script; moving stars | The top-down controls (the ship); scripts (enemy flights) |
| Tetris / Columns / Dr. Mario | Top-down starter (no gravity); a Board object whose script spawns groups of blocks, checks `fits`, `move_group`, `turn_group`, locks them, clears full rows (`count_in`) | Script statements on groups; ticks (`every`) |
| Boulder Dash | Top-down starter; the player's grid-move script (`key`, `glide_to`, `thing_at`; Character Controller speed 0); dirt dug by script; boulders that fall by script | Scripts, one square at a time |
| Motherload-like mining | A side view with gravity; the player's own digging script (`thing_at` below and beside, `remove`), fuel and cargo as script variables | The platformer controls plus a digging script |
| RPG, roguelike, tactics | Their starters; turn scripts (`start_turns`, `end_turn`); RPG battles in a level of their own | Turn scripts; the top-down controls between turns |

**Review of the system categories against these:**
- **Scripts and rules are a system in their own right.** For most non-platformer games, the gameplay *is* the scripts. The profile gets a `scripted` locomotion model: the engine doesn't move the player, its scripts do. The engine's ready-made scripts are part of the object kits.
- **"Board" games:** falling blocks, matching, Boulder Dash. They need a cell-based geometry kind (`cells`: a board of squares that scripts read and change), separate from platformer tiles. It is planned with F3's stateful cells, and serves Lode Runner too.
- **Time also has `ticks`:** fixed-rate updates driven by scripts. Today these games are realtime with `every` handlers, and that stays valid.
- **A rules / HUD system** (score, lives, game over) is shared by nearly every genre. Today it is scripts and the built-in display. It's noted here as a possible later module; there's no change in F2.

## 15. The cross-genre regression suite

A permanent set of representative games (`src/regression/`), run with every unit-test run and every stage. Each game is:
- built the way PXLBuilder builds it: the starter or preset, the guide's way of making it, the level builder where there is one;
- then **played**: inputs over time on the real runtime.

Each game checks its *defining mechanics*, not just that it loads. Each also records a **trace**: the positions of what moves, and the game's key variables, over the play. The trace's fingerprint is golden: a refactor must leave it identical, or the change must be explained and approved.

| Family | Game | Built as | Defining mechanics checked | Status |
|---|---|---|---|---|
| Traditional platformer | Mario-style | The platformer preset; a level from the classic level builder | Running, jumping a gap, stomping an enemy, ? block coin, reaching the goal (route bot) | Playable now |
| Momentum platformer | Sonic-inspired | (needs `surface` movement, V3) | Speed builds downhill, loop at speed | **Pending**: marked to-do, with the checks written out |
| Precision platformer | Celeste-inspired | The platformer preset + WallJump + Dash (F2) | A gap only a dash crosses; a shaft only wall jumps climb; the dash refills on landing | Playable after F2 |
| Grid puzzle | Tetris | Top-down starter; the falling-block Board script (guide recipe) | A piece moves as one, stops at walls, locks, a full row clears and what is above drops | Playable now |
| Matching puzzle | Dr. Mario | Top-down starter; a Board script: viruses, a two-colour pill, four in a line clears | The pill falls and is steered; four of a colour in a column clears (viruses too); the rest stays | Playable now |
| Shooter | Space shooter | Top-down starter as the shooters guide builds it | Holding fire keeps firing; a shot destroys a saucer; saucers fire back; the ship stays on screen | Playable now |
| Mining | Motherload-inspired | Platformer preset; a digging script; fuel and cargo variables | Digging down through dirt; rock can't be dug; ore collected adds cargo; fuel runs down | Playable now |
| Physics puzzle | Boulder Dash | Top-down starter; the grid-move script; boulders that fall by script; diamonds | Digging dirt; a boulder falls when the dirt under it goes; diamonds collected; walls stop the player | Playable now |
| (Existing starters) | Top-down, RPG, roguelike, isometric | Their presets (F1 fixtures) | Load, run, move; the RPG's and roguelike's own tests (battles, turns) | Covered by F1 fixtures and the existing runtime tests |

**Growing the suite:**
- The hybrid acceptance games (§9) join it as their slices land.
- Each reference game (Lode Runner, Donkey Kong, Mega Man, Hollow Knight) joins as soon as it is playable.
- A pending entry stays visible as a to-do test, never silently absent.

## 16. F2: movement models and abilities — design

**Goal:** the engine's movement code becomes **locomotion models** behind one interface, with **abilities** composed on top. The architecture must take later models without being rewritten:
- `surface` (momentum, ground-following),
- `committed` (fixed jump arcs),
- `grid` (cell-to-cell),
- `scripted` (scripts move it),
- models nobody has thought of yet.

### 16.1 The interfaces (as code)

```ts
/** What a model may ask of the world and the runtime: nothing else. (F3 replaces the collision questions with GeometryQuery.) */
interface MovementHost {
  ladderAt(e): Ladder | null;  isOnFloorBelowLadder(e): boolean;  standOn(e, ladder): void;
  onJumpThrough(e): boolean;
  tryGrabLedge(e, dir): void;  hang(e, input, dir): boolean;
  wallBeside(e, dir): boolean;                 // solid right beside it (wall slide / wall jump)
  isoView(): boolean;                          // keys follow the screen in an isometric view
  ownsPart(e, part): boolean;                  // a script took this part over (engine parts)
}

interface MovementContext { e: RuntimeEntity; input: InputView; dt: number; host: MovementHost }

interface LocomotionModel {
  id: string;                                  // the Character Controller's `movement` value it answers to
  step(ctx: MovementContext, abilities: AbilityHooks): void;
}

/** Abilities hook into a model at named points; a model calls the points it has. */
interface Ability {
  id: string;
  component: string;                           // the component that gives it (DoubleJump, LedgeGrab, WallJump, Dash)
  worksWith: string[];                         // locomotion ids
  /** Before the model's own movement: may take over this step entirely (a dash in progress). */
  override?(ctx): boolean;
  /** Jump pressed with no ground jump possible: may do its own (double jump, wall jump). */
  airJump?(ctx): boolean;
  /** After the step's movement and jumping (ledge grab, wall slide). */
  after?(ctx): void;
  /** On the ground: refill (dashes, air jumps). */
  grounded?(ctx): void;
  /** The states it adds to the motion snapshot ('dashing', 'wallSliding'…). */
  states?(e): string[];
}

/** What every model publishes, whatever its insides: for the camera, animation, scripts, enemies, validation. */
interface MotionSnapshot {
  velocity: Vec2; facing: 1 | -1; heading: Vec2 | null;
  states: string[];   // grounded | airborne | climbing | hanging | swimming | wallSliding | dashing | …
  intent: { x: number; y: number; jump: boolean };
}
```

- **The model registry:** the runtime looks the model up by the Character Controller's `movement` value (`platformer` → `arcade`, `topdown` → `topdown`). A new model is a registered object plus a new value for that field. Nothing in the runtime changes.
- **Abilities** are the existing components (DoubleJump, LedgeGrab) and new ones (WallJump, Dash). An object has an ability by having its component, the same way it is edited today. The profile's `movement.abilities` lists the game's abilities. Adding one in the profile gives the player its component; removing it takes the component away.
- **Script take-over** (`takesOver`: running, jumping, climbing, ledge_grab) works exactly as now: the models ask `host.ownsPart`.
- **The motion snapshot** is published by the runtime for every moving entity (`runtime.motion(e)`). F2 doesn't change how the camera or animation read it (F5 and later); it tests what it says.

### 16.2 New abilities in F2

- **WallJump** (arcade): sliding down a wall while pressing toward it, slower (`slideSpeed`); Jump pushes off the wall, up and away (`jumpX`, `jumpY`), with a short lock-out of steering back toward the wall (`lockTime`).
- **Dash** (arcade): press Dash (the `fire` action, or a key of its own via Controls) to shoot in the held direction (`directions`: 8, 4 or horizontal) at `speed` for `duration` seconds, gravity off meanwhile. It has `charges` in the air and refills on landing (`refillOnGround`). States: `dashing`.

Each declares in the module registry what it requires: `locomotion:arcade`. The profile's compatibility check therefore refuses a top-down game with WallJump, with the reason.

### 16.3 F2 tests (requirements for "done")

1. **Movement unchanged:** golden traces recorded **before** the refactor, for:
   - running and stopping;
   - jumps (full and short);
   - coyote time and jump buffer;
   - double jump;
   - ledge grab and climbing up;
   - ladders up, down and off the top;
   - swimming strokes and leaving the water;
   - drop-through platforms;
   - ramps up and down;
   - springs;
   - walking top-down, including isometric keys;
   - scripts that took over running or jumping.

   Each is replayed after the refactor and must match frame for frame.
2. **The cross-genre regression suite (§15):** every playable game's trace is identical before and after.
3. **All existing tests unchanged** (unit and browser).
4. **New abilities through the architecture:**
   - wall slide, wall jump and dash tested in play, including the dash refill and a script reading their states;
   - the Celeste-inspired regression game playable;
   - compatibility: WallJump with top-down movement is refused;
   - profile edits add and remove the ability's component.
5. **Extensibility:** a test-only locomotion model is registered and selected by an object's `movement` value, and a test-only ability hooks in. Neither needs a change to the runtime.
6. **The motion snapshot:** states and velocity are correct across models and abilities.

## 17. Progress

### F2 — done (awaiting review before F3)

**What moved, and what is new:**

| Piece | Where | What it is |
|---|---|---|
| Movement interfaces | `runtime/movement/types.ts` | `MovementHost`, `MovementContext`, `LocomotionModel` (`step`, `states`, `floats`, the `movement` values it answers to), `Ability` (hooks `override`, `grounded`, `steer`, `airJump`, `after`, `states`, `gravity`), `MotionSnapshot` |
| `arcade` model | `runtime/movement/arcade.ts` | The engine's platformer movement, moved out of `Runtime.control`: running, jumps (coyote time, buffer, short hops), ladders, swimming, drop-through, hanging; abilities called at its hook points |
| `topdown` model | `runtime/movement/topdown.ts` | Top-down and isometric walking, moved out of `Runtime.walkTopDown` |
| Abilities | `runtime/movement/abilities.ts` | **Double jump** and **ledge grab** (moved out of the movement code); **wall jump** (with wall slide) and **dash** (new components WallJump, Dash) |
| Registries | `runtime/movement/index.ts` | `registerLocomotion`, `registerAbility`; a model is chosen by the Character Controller's `movement` value, abilities by the components a character has |
| Runtime | `runtime.ts` | `control()` is now a lookup (model and abilities); the movement host; `motion(e)` (the snapshot); gravity and "floats" asked of the model and abilities, not of `movement === 'topdown'` |
| Scripts | `scripts.ts`, `language.ts` | `self.dashing`, `self.wall_sliding` (read from the motion states) |
| Profile | `engine/modules.ts`, `engine/profile.ts`, `engine/infer.ts` | Ability modules `double_jump`, `ledge_grab`, `wall_jump`, `dash`, each requiring `locomotion:arcade`; adding or removing one in the profile adds or removes the player's component; a game's worked-out profile lists the abilities its player has |
| Editor and AI | Game profile dialog; topic `precision_moves` | Abilities as checkboxes; the AI is told about WallJump and Dash when a request is about them (the instructions sent with every request carry only a pointer) |

**Decisions to review:**
1. **Ladders, swimming, drop-through and hanging stay part of `arcade`,** not separate abilities. They are what that model has always done, and they read the model's own state. They could become abilities later, when another model needs them (a `grid` model climbing ladders, for example).
2. **Abilities are components, as before.** DoubleJump and LedgeGrab already were; WallJump and Dash follow. The profile's ability list and the components are kept in step by `setGameProfile`. A component added by hand outside the profile shows in the worked-out profile only while the profile isn't stored.
3. **Time `turns` moved to F6** (it was listed for F2). The turn kit is time and progression, not movement.
4. **The Dash key defaults to X (`fire`),** the same key a player's Shooter uses. A game with both should set the dash to E (`key: "interact"`) or change its Controls. Nothing resolves the clash automatically yet.
5. **The new abilities can't yet be taken over by a script** (the engine-part mechanism has no ready-made "Wall jump" or "Dash" script). Scripts can read their states and change their settings.

**What still depends on old code** (for the coming stages):
- **F3:** the movement host still answers through the runtime's own collision code: `ladderAt`, `hang`, `tryGrabLedge`, `standOn`, `onJumpThrough`, `wallBeside`, the box lists. F3 puts these behind `GeometryQuery`.
- **F4:** the route solver and the route bot know nothing of wall jumps or dashes. Generated levels never use them yet, and the Celeste-inspired room is played by its own snapshot-reading bot.
- **F5:** the camera doesn't read the motion snapshot yet.
- **Animation:** `SpriteStates` situations don't yet include `dash` or `wallSlide` looks.
- **Profile systems:** time, geometry, camera and progression are still recorded but not yet acted on (as after F1).

### F3 — done (awaiting review before F4)

**What moved, and what is new:**

| Piece | Where | What it is |
|---|---|---|
| Geometry interface | `runtime/geometry/types.ts` | `GeometryQuery` (`solidAt`, `probe`, `wallBeside`, `cell`, `version`), `Surface` (point, normal, angle, curvature, kind, friction), `Slope` (a ramp of any rise: `lo`→`hi` of its square), `Ladder`, `CellInfo` |
| Collision world | `runtime/geometry/world.ts` | `CollisionWorld`: the shape lists (walls and floors, jump-through tops, slopes, ladders and their tops) moved out of the runtime with every question asked of them: the rebuild, `besideRamps`, `rampUnder` (was `onRamp`), `ladderAt`, `floorIn`, `onJumpThrough`, `wallBeside`, `solids`, `sweep` (`moveAndCollide` behind the interface). New: `probe`, cells |
| Runtime | `runtime.ts` | `this.world`; the runtime's collision methods are now one-line calls into it; the movement host answers through it |
| Ramp shapes | `core/model/ramps.ts` | `rampOf(shape)`: each ramp shape's direction and rise, read by the runtime, renderer, level map, level solver, roles and level ideas (no more `shape === 'slopeRight'` checks there) |
| Gentle slopes | Collider shapes `slopeRightLow`, `slopeRightHigh`, `slopeLeftLow`, `slopeLeftHigh` | Half a square up per square (26.6°); a Low and a High side by side make a slope two squares long. The solver walks ramps that carry on from each other as one slope |
| Cells | `world.cell(col, row)`, `world.hasIn` | A grid square: solid or not, dug or not (until when), and the tags of what is in it. Boards (falling blocks, matching) can ask a square instead of searching every object |
| Digging | `Runtime.dig`, statement `dig`, functions `dug_at`, `in_cell` (topics `digging`, `falling_blocks`) | A tile tagged `diggable` is dug out for some seconds (not solid, not drawn), then fills in; whatever is inside dies (a character comes back at its start) |
| Profile | `engine/modules.ts`, `engine/presets.ts` | Geometry modules `box`, `one_way`, `ramp` (v2: gentle slopes too) no longer point to old code; new module `cells` (any view), in every preset |
| Regression | `regression/games/digging.ts` | **Lode Runner-inspired**: the player digs as a guard walks at it, the guard falls in and dies when the brick fills in, the player walks over it to the goal (golden `49e7d607b8436a97`) |

**Unchanged:** every F1 and F2 golden (8 games, 17 movements, 5 starters, 3 levels), every existing unit and browser test.

**Decisions to review:**
1. **Gentle slopes are new ramp shapes, not a new Collider field.** Every Collider stores every field, so a new field would change every saved game and every starter. New enum values change nothing that exists. All ramp checks now go through `rampOf`, so adding a shape (a third of a square, say) is one table entry.
2. **The collision world keeps boxes and straight slopes.** Curved ground (loops, quarter pipes) is the height-profile geometry of slice V3 (Sonic). It goes behind the same `probe`, whose `Surface.curvature` is 0 until then.
3. **`probe` marches the ray in half-pixel steps.** That is exact enough for sensors (the hit point is put back on the face), simple, and fine for a few probes a frame. A real raycast replaces it if profiling ever asks.
4. **Digging lives in cells, not in the tile objects.** A dug tile is taken out of play (as a switch does) and the world remembers which square is dug and until when. A switch or rule that brings the same tile back early is not prevented.
5. **A hole that fills in kills what it traps through the ordinary `die`** ("died" event, death look, respawn delay), so games react as to any death.
6. **`cells` is in every preset's geometry.** It costs nothing until asked. The profile's geometry list is still a declaration: the world answers every shape whatever the list says (as after F1 and F2 for systems not yet driven by the profile).

**What still depends on old code** (for the coming stages):
- **F4:** the route solver and the route bot know nothing of digging, wall jumps or dashes. The level solver (`reachability.ts`) still reads the level's objects itself, not the collision world. Its ramp chains are new, but it doesn't use `probe`.
- **The level generator** places only 45° ramps. Gentle slopes are made by hand or by the AI.
- **Ramp looks:** the ground-matching ramp drawing (`rampBand`) is for 45° ramps only. A gentle ramp is drawn by its own sprite.
- **Scripts' own searches** (`fits`, `count_in`, `thing_at`) keep their spatial index. Boards may use `in_cell`; the regression boards still use the old functions, so their goldens stay identical.
- **Isometric heights** (`isoGround`) and the top-down crawler (`crawl.ts`) still compute their own squares rather than asking `world.cell`.

---

# Part IV: geometry for every kind of game, and F4

## 18. Geometry after F3 review

### 18.1 Registered, selected, supported, active

A game's geometry is decided in four steps. One small table answers all four (`core/engine/geometry.ts`, data only, so the runtime and the exported player read it too):

| Step | Meaning | Where |
|---|---|---|
| **Registered** | A geometry module exists | `GEOMETRY`, registered as modules in `engine/modules.ts` |
| **Selected** | The game's profile lists it | `profile.geometry` |
| **Supported** | Selected, and what it requires is given by the profile's other modules (ramps and jump-through platforms need a side view) | `geometryStatus(profile)` |
| **Active** | What the runtime and the level checker actually do: exactly the supported ones | `activeGeometry`, `gameGeometry(project)` |

**The rule:** no game silently uses geometry its profile doesn't make active.

**What a shape does when its geometry isn't active:** it works in its module's stated lesser way (`without`), in play and in the level checker alike.

| Geometry | When not active |
|---|---|
| `ramp` | A ramp is a box that blocks like a wall |
| `one_way` | A jump-through platform blocks like a wall, from below too |
| `cells` | `dig`, `dug_at` and `in_cell` are refused with a script error |
| `box` | Can't be left out: a profile without it is refused |

**The compatibility report says the same thing.** `checkGame(project)` is the profile check plus `geometryNotes`, which lists what the game's objects use that isn't active and what happens instead. It is shown in the Game profile dialog and given to the AI (`context.game.works`). Tests check that the runtime, the level checker and the report agree, for ramps, jump-through platforms and cells.

**Two answers that must match:**
- The light answer uses the convention that a module provides `kind:id`.
- The registry's answer uses the tags each module really provides.

A test compares the two for every preset and several variants.

**Old games:**
- Format v16 adds `cells` to profiles stored before cells existed.
- Games with no stored profile get it from their preset.
- So no existing game changes how it plays.

**One deliberate behaviour change:** before this, a ramp or jump-through platform in a top-down game blocked nothing. It now blocks like a wall, which is what the compatibility check had always said.

**Still a declaration only:** geometry is now enforced. The other systems are still only declared and checked: time, camera and progression, until F5 and F6.

### 18.2 Boards and other grid games

Falling-block and matching games (Tetris, Dr. Mario, Columns), Boulder Dash, Sokoban-like and tactics boards need from geometry:

- **The grid:** squares of 32 px on the level's grid, addressed by column and row.
- **What is in a square:** by tag (`cell(col, row).things`, `in_cell(x, y, tag)`), without searching every object.
- **What is solid in a square:** walls of the well (`cell().solid`).
- **Square states:** dug, until when (later: crumbling, filled, claimed).
- **No movement or physics assumed:** a board's pieces have no Collider or PhysicsBody and move by script, a square at a time. Nothing in the cell interface needs a side view, gravity, a locomotion model or a reach description.
  - `cells` requires nothing.
  - Presets for boards are top-down and select `box` and `cells`.
  - A board game's validation is the layout check only. Reach validators are never chosen for it (§19.4).

**How it relates to the scripts' own searches:**
- `fits`, `fits_turned` and `count_in` keep their own spatial index for now.
- They ask the same thing a board asks of cells: is a square free, and how many of a tag are in a row.
- **Planned:** answer them through `world.cell` (with the occupancy index the world already builds each step), once the regression boards' goldens can be compared before and after. This is listed under shared spatial queries below.
- The Tetris regression already checks that `in_cell` agrees with the pieces' squares.

### 18.3 Dug tiles: the refill rule

A dug tile comes back **only through its square**: its own time running out, or the level starting again.
- A switch or rule that shows or hides things never touches it (it isn't hidden by a switch).
- A `respawn` aimed at it is refused.

When the time is up, the `dig` statement's `fill` decides what happens. It is the same for every thing: the player, enemies, crates.

| `fill` | What happens |
|---|---|
| `trap` (the default, Lode Runner's rule) | Anything moving and solid with its middle inside the square dies, as a hit that ends its health does: the `died` event, the death look, a character back at its start, anything else gone. Pick-ups and things that don't block are left alone |
| `wait` | The square fills in only once nothing moving and solid is inside. No one is caught |

No other path kills something with a filling square.

### 18.4 Geometry work still open (tracked)

| Work | Where it belongs | State |
|---|---|---|
| Curved surfaces and loops (height profiles, `Surface.curvature`) | V3 (momentum) | Not started; behind `probe` |
| The level generator placing gentle slopes | F6 (generator interface) | Not started; patterns use 45° ramps only |
| Ramp rendering: ground-matching drawing for gentle ramps | Renderer, with V3 | Not started; gentle ramps use their own sprite |
| Shared spatial queries: `fits`, `count_in` and `thing_at` through `world.cell` and one index | After F4, with the board goldens | Planned (§18.2) |
| Isometric heights (`isoGround`) and the top-down crawler (`crawl.ts`) asking `world.cell` | F5–F6, or with a grid locomotion model (V2) | Not started |
| Crumbling and other stateful cells | V1 | Not started; `cells` holds the state |

## 19. F4: the reach model and pluggable validation

### 19.1 What F4 must not change

Before anything moved, `regression/validation.test.ts` pinned goldens of:
- **What validation says about every family:**
  - games: Mario-style generated, stomp and block, Tetris, Dr. Mario, space shooter, mining, Boulder Dash, Celeste-inspired (with and without abilities), Lode Runner-inspired;
  - starters: top-down, RPG, roguelike, isometric;
  - for each: the level checker's verdict, the win, layout and start checks, and the editor's reach problems.
- **The level builder's sweeps:**
  - classic: seeds 1–6 at difficulties 2 and 4;
  - puzzle: seeds 1–6 at difficulty 3;
  - for each level: what was built, whether it validated, its attempts and notes, and the route solver's full route.

These are identical after F4, with all earlier goldens. **The one deliberate change** is to the editor and AI path (§19.4), and only for players with abilities the jump checker doesn't model.

### 19.2 Reach descriptions (`core/reach/reach.ts`)

`reachOf(components, gravity)` is what a player's movement setup publishes:

| Part | `arcade` model | `+ WallJump` | `+ Dash` | `topdown` model |
|---|---|---|---|---|
| `table` | Today's `jumpTable` (double jump and ledge grab included) | Same | Same | None |
| `limits(d)` | The builder's `Limits` from the table (`playerLimits` now reads this) | Same | Same | None |
| `moves` | `ARCADE_MOVES`: walk (with ramps, springs, pushing crates), climb, swim, jump, teleport | + `wall_jump` (holding walls, sliding, kicking off) | + `dash` (a jump and a dash at its top: further across, or higher) | None |
| `simulator` | `route_bot` | `route_bot` | `route_bot` | None |
| `covers.table` | The arcade mechanics | Not `wall_jump` | Not `dash` | — |
| `approximate` | — | `wall_jump` | `dash` | — |

**Ability moves are worked out from the component's own settings,** kept under the estimate as the jump table is:
- wall jump: rise from `jumpY` (or the jump), distance from `jumpX`;
- dash: cells from `speed × duration`; up only with four or eight directions.

### 19.3 The route solver and its move rules (`levelGen/moves.ts`)

The solver (`levelGen/solver.ts`) is now only the search:
- its states: the cell, keys, levers, crates, and a **mode** (standing, or holding a wall on the left or right);
- the world those change: doors, plates.

**Moves come from rules.** Each `MoveRule` has an id, the mechanics it judges, and `successors(state, view)`.
- The arcade rules are the old loop body, moved unchanged and run in the order they always ran. That is why every route and state count is identical.
- A mode is written into a state's key only when it isn't zero, so a level without wall moves searches exactly as before.
- **New:** wall jumps and dashes may end in the goal's cell in mid-air, as touching it does in play. The arcade moves don't do this, so their results are unchanged.

**The route bot (`runtime/routeBot.ts`) plays the same move ids:**
- `BOT_MOVES` lists what it can play, and a route with any other move is skipped, said.
- New steps: `wall_slide`, `wall_jump` (press into the wall until sliding, jump, steer, press into the next wall) and `dash` (jump, dash near the top the way the target is, steer).
- When a take-off jump is held back by a ceiling's corner, the bot now lets go and presses again. This only happens when a jump fails, so the Mario-style golden is identical.

### 19.4 Validators (`core/validation/validators.ts`)

Each validator is a `Validator` with a strategy, a cost, what it needs of the reach description, and `validate(target, verdictsSoFar) → Verdict {pass | fail | unknown, covered, problems, evidence}`. They are registered as modules: requires `reach:<need>`, no `pointsTo`.

| Validator | Strategy | Needs | What it is |
|---|---|---|---|
| `layout` | static | — | winProblems, layoutProblems, startConflicts |
| `checker` | analytical | table | levelReachability. "Can't get to" with abilities the table doesn't cover is **unknown**, not fail |
| `cell_solver` | solver | moves | The route solver with the reach description's moves; gives the route as evidence |
| `puzzle_needed` | solver | moves | Each lever, key, crate and teleporter needed |
| `route_bot` | simulation | simulator | Plays the solver's route on the runtime. A bot that can't do a step proves nothing, so that is **unknown**, not fail |

**Choosing them (`chooseValidators`, §8.4):**
1. `layout` always runs, plus what the builder or the editor requires.
2. Mechanics the table doesn't cover go to `cell_solver` when the moves cover them and there is a grid.
3. Mechanics the moves only estimate also go to `route_bot`.
4. Mechanics nothing can judge here are noted.

**Running them (`runValidators`):** cheapest first.
- The static and analytical checks report together, and no search runs after a problem (exactly the old checkBuilt-then-solver order).
- A route through estimated moves that the route bot didn't confirm leaves the level **uncertain**.

**Through the validators now:**
- **The level builder:**
  - `generateLevel` runs the generator module's validators (`layout`, `checker`, `cell_solver`, and `puzzle_needed` for puzzles).
  - The solver's moves come from the player's reach description.
  - `checkBuilt` is the layout and checker validators.
- **The editor and the AI:** `levelReachProblems` (diagnose, the AI's playability check).
  - For a player with wall jumps or dashes, the checker's "can't get to" is replaced by one note: not checked, since the jump checker can't judge those.
  - Every other game's problems are exactly the old ones; a test compares them for boards, shooters, mining, Boulder Dash and the top-down starters.

**Board and grid games:**
- Their players (or no player) publish no table or moves, so no reach validator is ever chosen for them (tested).
- Their validation is the layout check and the checker's top-down walk, as before.

### 19.5 F4 tests

| Test | Where |
|---|---|
| Validation of every family, and the classic and puzzle sweeps, identical | `regression/validation.test.ts` |
| The arcade reach description equals the old jump table and moves; abilities add their moves and coverage; top-down has none | `core/validation/validation.test.ts` |
| A shaft only wall jumps climb: solvable only with WallJump; the route bot climbs it | same |
| A pit only a dash crosses: solvable only with Dash; the route bot dashes over it | same |
| The Celeste-inspired room: solvable only with both (as the regression bot found by playing); validated by solver and route bot | same |
| A route through estimated moves without the route bot: uncertain | same |
| Selection: classic levels get only their own validators; abilities with no grid are noted; boards and others get no reach validator | same |
| The editor: no false "can't get to the Goal" for a player with abilities; still said without them | same |
| Validators are modules with no `pointsTo`; the bot refuses moves it can't play; routes are reproducible | same |

### 19.6 Still on old code, and limitations

**Still on old code:**
- **The level checker (`levelReachability`)** still reads the level's objects and computes its own arcs from the same jump table. It doesn't ask the collision world or use the move rules.
- **The route bot's steps** are written in the bot, one per move id. A new move needs a bot step written beside the others. The step code itself is not plugged in from the move rule.

**Limitations:**
- **The cell solver needs a cell grid,** which exists for levels the builder makes and for maps (the tests' and the regression suite's). Hand-drawn levels have none yet, so for them, abilities beyond the table are noted as unjudged. **Planned:** a grid from any level (the level map already lists its cells by role; doors, keys and their links still need reading from the objects).
- **Wall jump and dash moves are estimates in cells:** one dash per jump, no dash from a wall, no dash crystals. The route bot confirms a route before it counts.
- **The builder still sizes sections from the table only.** It never uses wall jumps or dashes, so its levels never need them. Generating levels that need them is the generator stage (F6) with slice V1.
- **Seen from above there is no reach description.** The checker walks top-down levels its own way. A `grid` locomotion model (V2) would publish one.
- **Reproducibility:**
  - The solver is deterministic.
  - The route bot steps the runtime at a fixed 1/120 s with no randomness of its own.
  - A level whose scripts use `rand()` is reproducible only with the same seed. The bot doesn't seed it; the regression suite does.

**Modules still pointing to old code:**
- camera `follow` (F5);
- time `turns`, generators `sections` and `dungeon`, progression `stages` (F6).

---

# Part V: tracked acceptance criteria, and F5

## 20. Tracked for the remaining stages (from the F4 review)

These are acceptance criteria for the stages named. Each stage's report says where each stands.

| # | Requirement | Where it is met | State |
|---|---|---|---|
| T1 | **One place per movement ability.** A new ability must not need separate, unrelated code in several systems. Today it touches the runtime ability, its component, the engine module, the profile inference table, a solver move rule and a route-bot step. An ability should declare its move rule and its bot step beside its runtime code, found through one registration, with its capability tags and validation coverage declared there | V1, which adds several abilities at once | **Met** (V1.1, V1.2: §24.2, §24.3). Every ability is one definition, registered once; a test ability and a top-down one prove it |
| T2 | **The jump checker and the route bot consume shared interfaces.** The checker computes its own arcs; the bot has its own step per move. Unify where a concrete feature needs it, not for its own sake | V1 (bot steps with T1); the checker when hand-drawn grids arrive (T4) | Half met (V1.1): the bot's steps for abilities are their definitions'. The checker's own arcs: open, with T4 |
| T3 | **The generator uses the player's real abilities.** It sizes sections from the jump table only, so it never makes a level that needs a wall jump or a dash. It should build sections that use the abilities the player has, and those routes must be confirmed by the route bot. The bot costs real time for each level and the generator makes several attempts, so this needs a time budget; confirmation stays required only for routes through estimated moves | F6 (generator interface) with V1 (patterns) | Open |
| T4 | **Hand-drawn levels get a cell grid.** Converting what is seen into cells is not enough: doors, keys, levers, plates, teleporters and their links must be read from the objects. A level that doesn't fit cells (off the grid, scripted objects) is reported as unjudged, never guessed | After F6 | Open |
| T5 | **Every family in every stage.** Tetris, Dr. Mario, space shooters, mining and Boulder Dash are tested beside the platformers in every stage, with validation appropriate to each. No platformer assumption goes into a system other genres use | Every stage | Standing rule; met in F5 (§21.5) |
| T6 | **No rewrite for purity.** Systems move to shared interfaces when a concrete improvement needs it; existing behaviour is preserved | Every stage | Standing rule |
| T7 | **Goldens before a refactor.** Whatever a stage moves is pinned by goldens for every family first | Every stage | Met in F5 (camera goldens) |
| T8 | **The AI's per-request prompt stays inside its budget.** New guidance goes into topics | Every stage | Met in F5 (camera guidance is in the camera topic) |

Geometry work still open is tracked in §18.4.

## 21. F5: the camera as a pipeline of behaviours

### 21.1 What F5 must not change

`regression/camera.test.ts` pinned, before any camera code moved:
- **The camera's path in a game of every family,** played with the same keys: Mario-style generated, Tetris, Dr. Mario, space shooter, mining, Boulder Dash, Celeste-inspired, Lode Runner-inspired, and the platformer, top-down, RPG, roguelike and isometric starters.
- **Every camera setting:** look-ahead with a dead zone, custom bounds, no bounds zoomed out, fit to height.
- **Every effect in turn:** shake, flash, zoom over time, a look at something, following something else, following nothing, a new screen size, a restart.

Each trace samples the camera's position and zoom, what is drawn (shake included) and the flash. All are identical after F5, with every earlier golden.

### 21.2 The pipeline (`runtime/cameraBehaviors.ts`, `runtime/camera.ts`)

A camera behaviour changes a **plan** each step:
- `goal`: where the camera wants to look;
- `limits`: what it keeps inside;
- `transition`: eased as ever, slid over a moment, or cut.

Each behaviour may implement `start` (the snap at the start), `apply` (every step) and `retarget` (a script changed what is followed). It gets a context: the level's camera settings, the camera, the screen, the target, how the target moves, and the level's zones.

The controller runs the active behaviours in the profile's order, keeps the goal inside the limits, and moves. It keeps what isn't a behaviour:
- the effects (shake, flash, zoom, a look at something);
- the fit to the screen;
- the isometric view.

| Behaviour | State | What it does |
|---|---|---|
| `follow` | **Implemented** (the old camera, moved unchanged) | Follows the object with a Camera Target: smoothing, look-ahead the way it faces, a dead zone; holds still when the target is gone |
| `velocity_look_ahead` | **Implemented** (new) | An offset the way the target moves, growing with its speed up to the level's `speedLookAhead` (default 160 px at 480 px/s), eased. Sideways always; up and down only for a target that moves freely that way, so jumps don't bob the view |
| `rooms` | **Implemented** (new) | While the target is in a camera zone, the view is held inside it (a zone smaller than the screen is centred). Going into another zone slides there in half a second, or cuts, as the zone says. Outside every zone the camera is as without rooms |
| Vertical lag, auto-scroll, arena lock with doors, zone-specific behaviour lists | **Not registered, not implemented** | Listed in §2.3; they come with the slices that need them |

Nothing is registered without being implemented: a test checks that the declared behaviours and the runtime's are the same set.

**A new behaviour** is one `registerCameraBehavior` call plus one row in `core/engine/camera.ts`. A test plugs one in without touching the controller.

### 21.3 Camera zones

A zone is an ordinary object with the **Camera Zone** component. Its area is its Sprite's size and scale, where it is placed. With an invisible Sprite it shows faintly in the editor and not in play.

So zones are placed, moved and resized by hand with the existing tools, and by prompt with the existing operations. No new editor tool, operation or level format was needed.

- **`transition`:** `slide` or `cut`.
- **Overlapping zones:** the smallest one the target is in counts.
- **The target dies:** the view stays on its room.
- **Play goes on during a slide.** Freezing play, as some games do, is left to a script.

### 21.4 The profile controls the camera

The same four steps as geometry (`core/engine/camera.ts`): registered, selected (`profile.camera`), supported (requirements met), active (what play uses, in order).

| Case | In play | In the compatibility report |
|---|---|---|
| No `follow` in the profile | The camera stays still, though something has a Camera Target | Said, naming the object |
| Zones, but no `rooms` | Zones are not used | Said, naming the zone objects |
| `rooms` seen at an angle (isometric) | Not active | Said (isometric limits don't apply) |
| `velocity_look_ahead` without `follow` | Does nothing | Said |
| An unknown behaviour | — | The profile is refused |

Tests check that play and the report agree. The Game profile dialog has a Camera row (one checkbox per behaviour). The AI changes it with `set_game_profile` and is told about behaviours and rooms in the camera topic.

**Old games:** every preset selects `follow`, and games without a stored profile get their preset's, so every existing game's camera is unchanged. Format v17 changes nothing in a game; the version goes up so an older editor refuses a newer game instead of dropping its zones.

### 21.5 Not for platformers only

- **Rooms seen from above** (a dungeon's rooms, up and down) are tested.
- **Velocity look-ahead** looks ahead up and down for a target that moves freely that way.
- **Boards and shooters:** their camera goldens (Tetris, Dr. Mario, space shooter, mining, Boulder Dash) are unchanged.
- Nothing in a behaviour reads gravity, jumping or a locomotion model. "Moves freely" comes from the movement model's own `floats`.

### 21.6 Still on old code, and limitations

**Still on old code:**
- Time `turns`, generators `sections` and `dungeon`, progression `stages` still point to old code (F6).
- The level's camera settings (`model/camera.ts`) and the editor's camera frame are as they were. The frame shows the level's camera, not a zone's.

**Limitations and deferred work:**
- **The camera doesn't read the full motion snapshot** (§7.2). It reads the target's speed and whether it floats. Vertical lag would read the grounded state.
- **Behaviours have no settings of their own in the profile.** The one setting, `speedLookAhead`, is the level's. A profile-level settings block comes when a behaviour needs one.
- **A zone can't change the behaviour list** (a boss arena with its own camera), lock doors, or set its own zoom. A zone only limits the view and chooses its transition.
- **Generators don't place zones** (§7.5): F6.
- **Seen at an angle, rooms don't work:** the isometric view has no flat limits.
- **A look at something** (`camera_focus`) uses the level's limits, not the room's, as before.

## 22. F6: the plan (three stages, each reviewed on its own)

**What F6 is:** the remaining systems that are declared but not yet real behind an interface: level generators (`sections`, `dungeon`), time (`turns`) and progression (`stages`). F6 is architecture. Gameplay content stays in the slices: a broad set of ability patterns is V1, momentum is V3, worlds and gates are V5 and V6.

**Standing rules for every stage (T5–T8):**
- Goldens for whatever moves are recorded first.
- Every family is tested: Mario-style, Celeste-inspired, Lode Runner-inspired, Tetris, Dr. Mario, space shooter, mining, Boulder Dash, and the five starters.
- The momentum platformer is a future requirement (V3). Its placeholder in the suite is a to-do, never counted as a passing test.
- Working code is moved behind an interface and gated by the profile, not rewritten.
- Anything unsupported is reported, never silently replaced.

### 22.1 F6a: generators behind one interface

**Today:**
- `sections` is called through its module (`generatorOf(...).build`), but the module still points at `generate.ts`.
- `dungeon` isn't called through its module at all. The runtime, the editor's dungeon panel and preview, and the AI context each call `model/dungeon.ts` directly, and whether a level is random is decided by `scene.generator` alone, whatever the profile says.

| | |
|---|---|
| **Moved behind interfaces** | A `Generator` interface with two kinds of build: **at edit time** (operations that make a level: `sections`) and **at play time** (a level built anew from a recipe and seed each time: `dungeon`). Each generator declares what it requires of the profile (`sections`: side view, a reach table, player/ground/goal roles; `dungeon`: a view from above, cells) and the validators its levels go through. The runtime, the dungeon panel, the viewport preview and the AI context call the profile's generator through the interface. `pointsTo` removed from both |
| **Becomes profile-controlled** | Which generator builds levels, at edit time and at play time. A level with a dungeon recipe in a game whose profile doesn't select `dungeon` isn't built at play; the compatibility report says so and names the level. The same registered / selected / supported / active steps as geometry and camera |
| **Game types affected** | Roguelike starter (dungeon at play). Classic and puzzle platformers (sections). Every other family only through "no generator selected: nothing changes" |
| **Goldens first** | Dungeon goldens, which don't exist today: for fixed seeds and floors 1–3, each style (rooms, caves, maze), with a locked door and key, and with room templates: the full entity list and room list. The roguelike starter built at play with a fixed seed. The existing classic and puzzle sweeps stay |
| **New acceptance tests** | Both generators run only through the interface (no other caller of `generateDungeon` or `generateLevel` remains outside their modules). A test-only generator registers and is selected by a profile without changes elsewhere. Report and play agree when a recipe's generator isn't active. Tetris, Dr. Mario, shooter, mining and Boulder Dash: no generator runs, goldens unchanged |
| **Deferred** | New generators (`challenge_rooms` V1, `grid_stage` V2, `track` V3, `arena`/`room_stage` V4–V5, `world` V6). Gentle slopes in `sections` patterns (§18.4) |
| **Risks and how they're tested** | (1) An old roguelike saved without a stored profile must still get `dungeon`: its inferred preset selects it; tested with a saved fixture. (2) A hand-made game that added a dungeon recipe to a non-roguelike profile would stop being random: the migration to the next format adds `dungeon` to a stored profile when any level has a recipe, so no existing game changes; tested. (3) Editor preview and play must build the same dungeon for the same seed: one golden compares them |

### 22.2 F6b: generation that asks the player's reach; generated camera zones

**Today:** `sections` sizes every pattern from the jump table's limits. It never asks what else the player can do, so it never builds anything that needs a wall jump or a dash (the F4 limitation, T3). No generator places camera zones.

| | |
|---|---|
| **Moved behind interfaces** | Patterns get the **reach description**, not only the limits. A pattern declares the mechanics it needs (`needs: ['wall_jump']`) and sizes itself from the reach's own numbers for that mechanic (the wall kick's rise and distance, the dash's cells), published by the move rules that F4 added. The generator picks patterns whose needs the reach covers. Nothing in the generator names an ability |
| **Proof it is general, not two special cases** | Two patterns, `wall_shaft` and `dash_gap`, written only against the pattern interface. Tests: (a) with a player who lacks the ability, the pattern is never chosen; (b) changing the ability's settings (a longer dash, a weaker kick) changes the section's size; (c) a **test-only third mechanic** with its own move rule and pattern is picked up with no change to the generator, the solver or the validators |
| **Validation** | A level using estimated moves goes through `cell_solver` and then `route_bot`, as §8.4 already chooses. The solver must find the route; the bot must play it. New: a **time budget** per build for the bot. Past it, the level is reported uncertain, not validated. Classic and puzzle levels use no estimated moves, so they never run the bot and stay as fast as today |
| **Becomes profile-controlled** | The profile's abilities now change what levels are built, not only whether they are judged. **Generated camera zones:** a generator that knows its rooms places Camera Zone objects when the profile's camera has `rooms` active, and none otherwise. First user: `dungeon`, one zone for each room, seen from above. `sections` places none (its levels scroll) |
| **Game types affected** | Platformers with abilities (new sections become possible). Roguelike (zones, only when `rooms` is selected; the starter doesn't select it, so it is unchanged). Others: none |
| **New acceptance tests** | The classic and puzzle sweeps identical (a player without abilities gets exactly the levels it got). A sweep with wall jump and dash: every level solved and bot-confirmed, each ability needed in at least one section (removing the ability makes the level unsolvable). Dungeon with `rooms`: one zone per room, the camera locks to the start room and slides to the next in play; without `rooms`: byte-identical to the F6a dungeon goldens |
| **Deferred** | A broad pattern set for advanced movement, climbing with stamina, dash crystals, crumbling blocks: V1. T1 (one registration per ability, bot steps included): V1. Zones from `sections`, arenas with doors: V5 |
| **Risks and how they're tested** | (1) Bot time making generation slow: the budget, plus a measured test of seconds per generated level. (2) Patterns changing existing levels by shifting the random sequence: new patterns are only eligible when their mechanic is present, and the unchanged sweeps prove it. (3) Estimated moves producing sections the bot can't play: such builds are discarded and rebuilt, as failed builds are today; the rate is measured and reported |

### 22.3 F6c: time and progression

**Today:**
- **Time.** The turn kit (`runtime/turns.ts`) is a real implementation, started by scripts (`start_turns`). The profile's `time` is one value for the whole game: the roguelike says `turns`, the RPG and tactics games say `realtime` though their battles are turn-based. So the profile is wrong about them, and nothing reads it.
- **Progression.** What level comes next, `go_to_level`, visiting a level and coming back are decided inside the play screen (`editor/play/PlayView.tsx`), in interface code that can't be tested without a browser. `nextLevel` lives in `model/dungeon.ts`.

| | |
|---|---|
| **Time, represented correctly** | Two things, not one. The **time model** says how the world runs: `realtime` (everything moves all the time) or `turns` (the world answers each of the player's steps: the roguelike). **Turn-based actions** are a capability a game selects beside either: the turn kit (teams, turns, menus, the cursor). An RPG is `realtime` with the turn capability: its map runs in real time and its battles take turns. The turn kit stays as it is, behind a `TurnSystem` interface |
| **Becomes profile-controlled** | The turn capability. In a game whose profile doesn't select it, turn statements are refused with a script error, and the report names the objects using them (as `cells` does). Progression: which model decides what follows a level |
| **Profiles corrected without breaking games** | The RPG preset gains the turn capability; so do games inferred as RPG or roguelike. The format migration adds it to any stored profile whose game has turn scripts (found the way `cells` use is found). So no existing game or script changes; tested with saved fixtures of an RPG, a tactics game and a roguelike |
| **Mixed real-time and turns, tested explicitly** | (1) RPG: on the map things move in real time; touching a monster starts a battle that takes turns; back on the map, real time again, the map as it was. (2) A real-time level in which a turn-based battle starts and ends while something else keeps moving outside the turns. (3) Roguelike: nothing moves until the player steps. (4) A platformer without the capability: `start_turns` refused, said |
| **Progression behind an interface** | A `Progression` controller in the runtime (not the play screen): what follows a completed level, `go_to_level`, `visit_level` and `return_level`, a random level's next floor. `stages` is today's behaviour moved there; the play screen and the exported player only carry out what it says. New shared piece: **checkpoints** (a Checkpoint component: touching one moves where the player comes back to; the level again resets it). `pointsTo` removed from `turns` and `stages`: with F6a, **no module points to old code any more** |
| **Game types affected** | RPG and roguelike starters, tactics games (time). Every game with more than one level (progression). Platformers (checkpoints, only when placed) |
| **Goldens first** | Progression traces, recorded through the play screen's logic before it moves: level order, a branch by `go_to_level`, an RPG visit and return with state kept, roguelike floors, a won last level. Turn traces: an RPG battle and a tactics round, frame by frame. The existing roguelike golden stays |
| **Deferred** | Connected rooms and worlds, a map, persistent state across rooms: V6. Ability gates and the progression validator: V6. Stage select, bosses: V5. Board-game progression (rounds, levels of speed) stays in scripts as today |
| **Risks and how they're tested** | (1) Moving progression out of the play screen changes what a player sees between levels: the browser tests already play through level ends, visits and floors, and the new headless goldens pin the order. (2) The exported player uses the same code: one browser test exports a two-level game and plays it through. (3) Refusing turn statements could break a game the migration missed: the finder is tested against every ready-made script that uses turns, and a refused statement says exactly what to select |

### 22.4 After F6

**Every system is then behind an interface and chosen by the profile:** view, time, movement, geometry, camera, kits, generators, progression, validators.

**Still open after F6, by slice:**

| Slice | What it brings |
|---|---|
| V1 | Ability patterns in breadth; one registration per ability (T1, T2) |
| V2 | A grid movement model, with the cell-based reach for top-down levels; a stepped time model, if grid games need one in the engine (§22.7) |
| V3 | Momentum, curved ground, and the momentum platformer's regression game (today a to-do) |
| V4 | Fixed-arc jumps, spawners |
| V5 | Bosses, arenas with doors, stage select |
| V6 | Worlds, ability gates |
| Not tied to a slice | A cell grid for hand-drawn levels (T4); the geometry work in §18.4 |

### 22.5 F6a — done (awaiting review before F6b)

**Goldens recorded first** (`regression/generators.test.ts`), identical after:
- seven dungeons from fixed seeds: rooms on floors 1, 2 and 3 (with the locked door and its key), caves, a maze, a big one with loops and wide corridors, and one with a room template;
- the roguelike starter as play builds it, on floors 1 and 4;
- the editor's example and play building the same level for the same seed.

**What moved, and what is new:**

| Piece | Where | What it is |
|---|---|---|
| Generator declarations | `core/engine/generators.ts` | One table: each generator's id, when it builds (`edit` or `play`), what it requires, and what happens without it. Data only, so the runtime reads it. `selectedGenerators`, `generatorStatus` (registered, selected, supported, active), `generatorNotes`, `gamePlayGenerators` |
| Play-time interface | `core/generation/playGenerators.ts` | `PlayGenerator`: `applies(scene)`, `build` (the level as played: floor, the scripts' changes to the recipe, the seed), `example` (what the editor shows). `playGeneratorFor(project, scene)` gives a level's generator only when it is active in the game. The dungeon generator is the first, its code as it was |
| Generator modules | `engine/modules.ts` | Built from the declarations: `sections` (edit: `build`, `label`, `validators`) and `dungeon` (play: `atPlay`). Neither points to old code |
| Callers | `runtime.ts`, `DungeonPanel.tsx`, `Viewport.tsx`, `ai/context.ts`, `mutations.ts` (keep the example) | All through `playGeneratorFor`. A test scans the source: nothing outside the generators' own files and modules calls them |
| Profile | `engine/profileSchema.ts`, `profile.ts` | `generator.also`: generators the game uses beside its level builder (optional, so every stored profile stays valid). `set_game_profile` takes `alsoGenerators`. The Game profile dialog has a Random levels row |

**Controlled by the profile now:**
- **At play:** a level with a recipe is built only by a generator active in the game. Otherwise it plays as it is placed by hand; the editor shows no example, the dungeon panel says why, the AI is told, and the compatibility report names the level. A test checks that all of these agree.
- **While editing:** a profile with no level builder builds nothing and says why. The old fallback, which used the `sections` builder whatever the profile said, is gone.

**Existing games keep their random levels:**
- **No stored profile:** the generator is worked out from the game (a level with a recipe means `dungeon`). Tested: such a roguelike builds exactly what the one with a profile builds.
- **A stored profile:** format v18 adds `dungeon` beside the level builder when the game has a random level.
- **Making a level random** (the dungeon panel, `set_generator`) selects the generator in a stored profile at the same step.

**Decisions to review:**
1. **Two kinds of generator, and a game may use both.** The profile's `generator.id` stays "the level builder"; `also` lists the rest. The alternative, turning `generator` into a list, would have changed every stored profile and everything that reads the builder's genre.
2. **`dungeon` requires nothing of the profile** (it required a view from above). Whether a level is seen from above is the level's own (its gravity), not the game's: a platformer may have one top-down random level. Refusing it by the game's view would have stopped such a game's level from being built. Its description says what it is for.
3. **A level's recipe is the dungeon's recipe** (`scene.generator`, typed as such). A second play-time generator says which levels are its own with `applies` (the test one goes by the level's name). A general "which generator, with what recipe" field on a level comes with the first real second generator (V1's challenge rooms, V2's grid stages).
4. **What a play-time generator returns** is the dungeon's description (rooms, start, way on, problems), since scripts read it (`room_x`, `room_count`). Another generator fills what it has.
5. **The level-built signal and the scripts' recipe changes** (`set_generator` in play) stay in the runtime and are passed to the generator as a patch.

**Still on old code:**
- Time `turns` and progression `stages` (F6c).
- `nextLevel` and room templates' "not played on their own" rule live in `model/dungeon.ts` (progression: F6c).
- The dungeon panel edits the dungeon's recipe directly: it is that generator's own editor, not a general one.

**Limitations:**
- The `sections` builder still sizes from the jump table only, and no generator places camera zones (both F6b).
- A play-time generator's levels are not validated ahead (a new one each play); what didn't work out is in the example's problems, as before.

### 22.6 F6b — done (awaiting review before F6c)

**Unchanged:** every earlier golden, with the classic and puzzle sweeps (a player without abilities gets exactly the levels it got) and the dungeon goldens (a game without `rooms` gets exactly the dungeon it got).

**How the builder consumes the reach description:**

| Step | Where | What happens |
|---|---|---|
| Abilities register with the reach model | `core/reach/reach.ts` `registerReachAbility` | One registration for each ability: when a character has it, the move rule it adds, whether its moves are estimates, whether the route bot plays them. `reachOf` loops over the registrations. Wall jump and dash are two of them; the two hard-coded `if` blocks are gone |
| A move rule publishes a capability | `levelGen/moves.ts` `MoveRule.capability` | An id and numbers in cells and rows: a dash's `cells` and `up`, a wall kick's `rise` and `away`, worked out from the ability's own component settings |
| The reach description lists capabilities | `ReachDescription.capabilities` | By id, from the move rules. A player without abilities has none. Seen from above there is no reach, so none |
| The reach can be measured | `core/reach/probe.ts` `reachMeasure(reach, without)` | The route solver, run on small test floors with the reach's own moves, says the highest cliff and the widest gap the player gets over, with everything or without the capabilities named |
| Patterns say what they require | `levelGen/pattern.ts` `Pattern.requires`, `patternFits` | Capability ids. The builder builds a pattern only for a player whose reach has them all, asked for by name or not; the AI is told only of patterns that fit |
| Patterns size themselves | `SectionCtx.caps`, `SectionCtx.without(ids)` | From the capability's numbers, and beyond what the player does without it |
| The level's needs are checked | `generate.ts` | For each capability a built section requires, the level is solved without that capability's moves. If there is a way, the build is rejected ("can be won without…") |
| Validators are chosen by coverage | `chooseValidators` (F4) | The level's mechanics are the capabilities its sections require. Estimated ones go to the route solver and then the route bot |

**Is it general, or two special cases?** The builder, the solver, the validators and the probe name no ability. What names one:
- its registration in `reach.ts` (how its numbers follow from its component);
- its move rule in `moves.ts`;
- its pattern in `patterns/abilities.ts`, and that pattern's weights in the classic genre;
- its bot step in `routeBot.ts` (T1: still one hand-written step for each move).

**Proof:** a test registers a third ability (a glide), its move rule and a pattern, with no change anywhere else. The reach lists it, the builder builds its pattern only for a player that has it, the solver routes through it, and, since the bot can't play a glide, the level is reported **uncertain**, never validated.

**The two patterns** (`patterns/abilities.ts`):
- `dash_gap`: a gap wider than the player crosses without its dash, as wide as the dash carries (a cell less below the top difficulty); plain, or over a spiked trench.
- `wall_shaft`: a cliff higher than the player gets up without its wall jump, with a hanging wall facing it; as wide inside as a kick carries, two cells at most.

**What "without" caught.** A player with both abilities climbs three rows with an upward dash. The first version built the shaft three rows high for everyone, so that player dashed up it and the note "needs the player's wall jump" was false. Now the shaft is four rows for that player and two for one with wall jumps alone, and the needs check rejects any build whose claim is false.

**Validation of generated routes:**
- **Solved, then played.** The route solver must find the route; the route bot must play it on the real runtime. A level whose route uses an estimated move, required by a section or just taken by the solver, is validated only when the bot wins.
- **Not confirmed means not validated.** A bot that gets stuck, isn't loaded, can't play a move or is over budget leaves the level **uncertain**, with the reason in its notes. Tested for each.
- **Settling the checker's "don't know".** The jump checker says it can't judge these abilities. That is settled when the solver covers them and the route was played; otherwise the level stays uncertain.
- **The budget is in seconds of play:** at most 8 builds played in one call, each for at most 120 s of the game's own time. A wall-clock budget would give different levels on a slow and a fast machine for the same seed. Measured: a medium level with two ability sections, built, solved and played, takes about 0.3 s here; a short one with one section, 0.05 to 0.2 s.
- **Repeatable:** the same seed gives the same level, verdict and notes (tested).
- **The bot is loaded in the app** (`main.tsx`), so levels built there are played too.
- **Bot fix:** dashing up onto a wall, it now presses into the wall only once level with the cell it aims for. Before, it went over the wall's top.

**Generated camera zones** (`core/generation/playGenerators.ts`):
- **`roomZones`** makes one Camera Zone object for each room a generator built: the room's inside and the walls round it, invisible, not solid, sliding.
- **`buildForPlay`** adds them when the game's camera has `rooms` active, and returns exactly what the generator built when not. The runtime and "keep this dungeon" both use it.
- **Nothing new in the camera:** the zones are the same objects a user places, read by the same `rooms` behaviour.
- **Corridors are in no zone:** there the camera follows as usual, and slides into the next room.
- **Caves and mazes have no rooms,** so no zones.
- **Zones placed by hand** stay as they are, beside the generated ones (tested).

**Tests** (`levelGen/reachAware.test.ts`, 15; `generation/zones.test.ts`, 6):

| What | How it is tested |
|---|---|
| Capabilities and their numbers | Per ability; they follow the component's settings; none from above |
| The probe | A plain player's measure equals its jump table; a dash adds its cells; without a capability the measure drops to what the rest does |
| Never built without the ability | 12 free levels for a plain player; asked for by name (another section takes its place); a dash-only player never gets the shaft |
| Used with the abilities | 16 free levels for a player with both: all validated; some have a dash gap and some a wall shaft, each of those played by the bot |
| Sized from the numbers | A longer dash gives a wider gap; a weaker kick gives a shaft one cell wide |
| Solved, played, needed | Each pattern (the dash gap plain and over spikes, the shaft), four seeds: the route goes through the ability's move, the bot wins on the level as built, and a player without the ability has no route |
| Abilities with geometry | One level with a wall shaft, ramps and a dash over a spiked trench: validated; each ability alone isn't enough |
| Unconfirmed is never validated | A stuck bot, no bot, a move the bot can't play |
| Zones match rooms | One for each room, the room's rectangle plus its walls |
| From above; next door; one above the other | The view is centred on the hero's room; it slides to the room next door, and to a room above or below; in a corridor it follows |
| Without `rooms` | No zones; the other objects are exactly the plain dungeon's |
| By hand | A hand-placed zone keeps its id, place and transition, and works |

**Still on old code, and limitations:**
- **T1 is open:** a new ability's bot step is still written in the bot. An ability the bot can't play is built for and solved, but its levels stay uncertain.
- **Two ability patterns only,** in the classic genre. A broad set is V1. The puzzle genre lists none.
- **The moves are estimates in cells:** one dash for each jump, no dash from a wall. The bot's play is what counts.
- **The wall shaft needs a tall floor:** four free rows above the ground for a player with both abilities. On stacked floors (climb, descent) it often doesn't fit, and another section is built.
- **`sections` places no camera zones** (its levels scroll). Arenas with doors are V5.
- **Zones are for rooms only:** a generator says where its rooms are. Caves and mazes get none.
- **The probe's floors are simple** (a cliff on open ground, a level gap): what the player gets over in other shapes is the solver's to find on the level itself, which the needs check does.
- **Time `turns` and progression `stages`** still pointed to old code (moved in F6c, §22.7).

### 22.7 F6c — done (F6 complete; awaiting review before V1)

**What changed against the plan (§22.3), and why:**
- **There is one time model, `realtime`, not two.** The plan kept `turns` as a second time model for the roguelike. Reading the code, the engine never had one: the roguelike's "nothing moves until the hero steps" is its own scripts (the hero sends the signal `world_turn`; the monsters act on it), on the real-time clock. A time module named `turns` that nothing implemented would have been a pointer to nothing, so it is gone. The roguelike's profile says `realtime`, which is what runs. A time model that steps the whole world belongs with grid movement (V2), if the engine needs one then.
- **Roguelike floors are not the session's.** The stairs restart the level, and a random level is built anew for the floor it is on when it starts. That stays in the runtime (through the play generator, §22.5); the session only keeps playing.

**Turn-taking is a capability** (`core/engine/turns.ts`, `runtime/turnSystem.ts`):
- **`profile.turns`** lists the turn systems a game has, beside its clock. `team_turns` is the engine's: teams take turns, each unit has its go (tactics, RPG battles).
- **The same four states** as geometry, camera and generators: registered, selected, supported, active.
- **The runtime makes the active one** behind the `TurnSystem` interface (start, give, done, end turn, order; whose turn, the round, over). The kit's code is the implementation, unchanged. With none active, `rt.turns` is null.
- **Refused, and said.** In a game whose profile doesn't make turn-taking active, `start_turns`, `give_turn`, `done`, `end_turn` and `turn_order` are refused with a script error, and the compatibility report names the objects using them.
- **The rest of the kit is for any game:** menus, the cursor, highlights and walking paths need no turn-taking.
- **No game breaks:**
  - The RPG preset selects `team_turns`; a profile worked out from a game selects it when its scripts take turns.
  - A stored profile gets it when a script that takes turns is set on an object or comes with a new object.
  - Format 19 migrates saved games: time `turns` becomes `realtime`, and `team_turns` is added when the game's scripts take turns.

**Real time and turns in one game** (tested, `runtime/turnCapability.test.ts`):
- An RPG: the map runs in real time (the hero walks, an enemy wanders), the battle level takes turns, with one profile.
- One level: a battle in turns starts, goes on and ends while something else keeps moving in real time; then the player walks again.
- The roguelike: nothing moves until the hero steps (its golden).
- A platformer without the capability: turn statements refused, said in the report.

**Progression is behind an interface** (`core/progression/progression.ts`, `runtime/session.ts`):
- **`ProgressionModel`** says what follows a won level: `next(project, sceneId)`. The profile's `progression.model` selects it. `stages` is the engine's: the levels in their order.
- **Which levels are stages** is asked of the generators: a level a generator uses as a part (a room template) is not played on its own (`PlayGenerator.parts`). The dungeon file no longer knows what follows a level.
- **`GameSession`** is a game being played across its levels, with no screen: the level played, the game's variables, the levels left for a visit, whether the game is finished. It asks the progression model after a won level, and carries out what scripts ask, the same for every model: `go_to_level`, `visit_level` and `return_level`, `restart_game`.
- **The play screen only follows.** It is told when a level is left or entered and does the screen's part: music, the recording, the camera, the HUD. It starts no level and reads no script request (checked by a test on its source). The exported player uses the same screen.
- **A model that isn't there:** the compatibility check says so, and a won level is followed by nothing. What scripts ask still works.
- **Another model plugs in** by registration (a test's model plays the levels backwards).
- **No module points to old code any more.** `stages` was the last (`profile.test`).

**Checkpoints** (component `Checkpoint`, statement `set_checkpoint`, event `checkpoint_reached`):
- **A place to come back to, in any kind of game.** The player who touches a Checkpoint comes back there when it dies, falls out or is respawned. Where things fall it stands on the checkpoint's ground; where nothing falls (from above, a flying thing) it is on its middle. The last one touched counts.
- **Scripts make their own:** `set_checkpoint` for any target, where it is or at a place.
- **`heal`:** reaching it gives full health.
- **What comes back and what is reset:**

  | What happens | Where the player is | The world |
  |---|---|---|
  | Dies or falls out (a respawn) | The checkpoint | As it is (coins taken stay taken) |
  | The level starts again (R, `restart_level`), `keepOnRestart` off | The level's start | As at the start |
  | The level starts again, `keepOnRestart` on | The checkpoint | As at the start |
  | A level built anew when it starts (random levels) | Its start: nothing is kept, the places are other ones | Built anew |
  | The next level, `go_to_level` | That level's start | That level's |
  | Back from a visit (`return_level`) | Where it was; its checkpoint still holds | As it was left |
  | The game begun again (`restart_game`) | The first level's start | New, with new game variables |

- **It needs nothing from the profile** and assumes no view: the same component works in a side view and from above (tested in both, with a stored and a worked-out profile).
- **By hand and by prompt:** an ordinary component (the inspector lists it; `add_component` adds it). Its guidance is in the topic `checkpoints`.

**Non-regression:**

| Suite | Result |
|---|---|
| The 9 games' goldens and the 17 movement traces | Unchanged |
| Profile fingerprints (5 definitions, 3 levels) | Unchanged |
| 14 validation snapshots, both sweeps | Unchanged |
| 18 camera goldens, 9 dungeon goldens | Unchanged |
| 6 turn goldens (tactics with a stored and a worked-out profile, RPG battle, RPG map, the RPG starter's battle, roguelike), recorded before the change | Unchanged |
| 3 session goldens (stages, a branch, an RPG visit and back) | New, see below |

**How the port of progression was verified, honestly:**
- The play screen's logic could not be played without a browser, so no headless golden of it could be recorded before it moved.
- The session is a line-by-line port (same order, same rules), and its goldens are recorded with it: they pin it from here on.
- That it plays as the screen did rests on the browser tests: a won level, the banner, the next level (as before), and new ones for a visit, the way back with the level as it was, a checkpoint, and R.
- The exported game is opened and played in the browser tests (the player runs, no errors): it is the same screen and session. A level change inside an exported game is not tested on its own.

**Tests** (`runtime/turnCapability.test.ts`, 12; `runtime/session.test.ts`, 17; `runtime/checkpoints.test.ts`, 12; `regression/turns.test.ts`, 5):

| What | How it is tested |
|---|---|
| One clock | `realtime` is the only time model; no preset says otherwise |
| Real time and turns together | The RPG map and its battle; one level with a battle beside something moving |
| Profile control of turns | Selected: works. Not selected: refused, a script error, the report names the object. An unknown system: incompatible |
| No game breaks | Tactics with a stored and a worked-out profile; the migration; a script set on an object selects the capability |
| Another turn system | A test's system plugs in and is used |
| Stages | Three levels won one after another; the last ends the game; R goes on |
| Scripts | A branch by `go_to_level`; a level that isn't there is a script error; `restart_game` |
| Visits | The RPG: into the battle, won in turns, back where the hero stood; the level left stands still while away |
| The profile's model | `stages`; room templates are no stages; a missing model; a test's model |
| Where the code is | The play screen, the dungeon file and the session, by their source |
| Checkpoints | Side view and from above; the last one counts; heal; restart both ways; a script's; other levels; a visit; a random level |

**Limitations:**
- **T1 is open** (due in V1): a new ability still needs its route-bot step written in the bot.
- **`stages` is the only progression model.** Worlds of connected rooms and ability gates are V6; stage select and bosses V5.
- **A checkpoint is for one level.** Nothing is saved between plays of the game, and no state is kept across levels beyond the game's variables.
- **A Checkpoint is touched by the player.** For anything else, a script sets it.
- **The momentum platformer** is still a to-do (V3), never counted as passing.
- **No stepped time model.** The roguelike's world turns are its scripts'.
- **The turn system's interface covers taking turns.** Menus, the cursor and paths are the kit's, for any game.

## 23. Remediation after the F6 audit (before V1)

The audit (`docs/architecture-audit-f6.md`) found that view, movement and abilities could be configured in the profile without controlling what runs, and that the two drifted apart in silence (A1); two bugs (A2); and gaps in the browser coverage of progression (A3). This section is what was changed for them. No registry was added, no file format changed, and no game whose profile and objects already agreed plays differently.

### 23.1 Declared, actual, and the report that compares them

**One owner for each fact.**

| | Declared: the profile | Actual: read from the game (`core/engine/actual.ts`) | The report (`checkGame`) |
|---|---|---|---|
| **View** | `profile.view`: what the game is meant to be | Each level's own: drawn at an angle → `iso`; else it has gravity → `side`; else `top` | Names every level seen otherwise, and says what stays as the game's view has it |
| **Movement model** | `profile.movement.model`: the model meant for the game's characters | Each player-controlled object's Character Controller | Names every character that moves otherwise, or whose model isn't there |
| **Abilities** | **Not declared.** There is no list apart | The ability components on each character | Names an ability that does nothing on its character |
| Geometry, camera, generators, turns, progression | The profile, and the runtime reads it (as before) | — | What the game uses that the profile doesn't make active (as before) |

- **The runtime plays the actual facts,** as it always did: a character moves by its own Character Controller, a level by its own gravity and projection. Nothing is taken from the profile for these, and nothing is picked from "the first player".
- **Abilities are the characters' own.** An ability exists only as a component on a character, where its settings are. `profileOf` computes the game's abilities from the players each time it is asked; whatever a stored profile holds for them is not read. Changing abilities through the profile still gives and takes the components.
- **The view and the model stay declared.** They are intent for the whole game that other choices depend on (which geometry is supported, the level builder, the kit). A game that differs from them is not "corrected" to whichever value is found: the difference is reported, by name.
- **Nothing new to register.** `gameFacts` finds models and abilities through the modules there are.

**What the report now says** (each note says what runs):

| Situation | Note |
|---|---|
| A character whose model differs from the declared one | "*Drone* moves by "topdown" (its Character Controller), not by the profile's "arcade": it plays as its own setting says" |
| A movement value no model answers to | "*Player*: there is no movement model "hover", so it ignores the movement keys (nothing else moves it in its place)" |
| An ability on a character whose model doesn't have it | "*Drone*: its Dash (dash) needs arcade movement, so on this character it does nothing" |
| A level seen otherwise than the game | ""*Space*" is seen from above (no gravity), not as the game's view says (side): it plays as it is set, while what the game's view decides (ramps and jump-through platforms, camera zones, the level builder) stays as for "side"" |
| No player-controlled object | No note. Movement is described as "not in use" |

**Several players.** Each player-controlled object is listed by itself, with its own model and abilities. A placed copy that differs from its object (its own override) is listed too, with its level. The game's ability list is the union of abilities that *work* on someone. An ability chosen through the profile goes to the characters it works on; taken away, it leaves all of them.

**Levels that differ.** The declared view and each level's actual view are kept apart. A differing level is reported; its geometry and camera support are **not** recomputed for it (decision 2 of the review: existing per-level behaviour is preserved, and the note says so).

**No silent fallback for movement.**
- `locomotionFor` returns null for a value no model answers to. Before, it returned the arcade model; and `buildEntity` rewrote the value to `platformer` before that.
- Such a character ignores the movement keys. It is still in the level and still falls and collides.
- The level starts. One `script_error` is logged when it does, naming the character and the models there are.
- The report names it.

### 23.2 Isometric

- **The engine does support it:** a level's `world.view` makes the camera, the keys and the drawing isometric. The isometric starter and `set_world` use it.
- **The bug:** changing the profile's view only wrote the levels' gravity. **Fixed:** the view module now also says its projection (`flat` or `iso`), and a view change writes both to every level, in both directions. A new game from a profile does the same.
- **A second bug, found while planning and confirmed:** `createLevelFor` copied a level's gravity to a new level, but not its projection, so a new level in an isometric game was flat. **Fixed** (the editor's New level, the AI's `create_level`, the level builder).
- **Isometric with run-and-jump movement** is refused when asked for, as before: nothing is written.
- **One level set flat in an isometric game** is reported by name.

### 23.3 Checkpoints and level flips

- **The bug:** a kept checkpoint was a position in the level as it was when reached. A level started again is not flipped, so after `flip_level` the player started at the mirror image.
- **A Checkpoint object** is now remembered by its id. When the level is rebuilt, it is found again and gives the place itself.
- **A place set by a script** is kept as a place in the level as made: the flips done since the level started are recorded (which way, around which line), and the place is mapped back through them **in reverse order, the last first**.
- **Also fixed:** starting a level again did not end a flip under way, nor reset what scripts read of it (`level_flipped`). It does now.

### 23.4 Shown to the user and the AI

- **The profile dialog** lists every player-controlled character with how it really moves and a box for each ability, which adds or removes that character's component. An ability that would do nothing on a character can't be switched on there; one that is on and does nothing says so. With no player-controlled object it says movement is not in use.
- **The AI's context** has the same line: the declared model, then each player by itself.

### 23.5 Tests

| What | Where | Result |
|---|---|---|
| The audit's probes H1, H2, H2c, H3, H5, H6 | `core/engine/actual.test.ts` | Each now produces the note that says what runs, or (H2, H2c, H6) the profile is simply true |
| Every preset and every game of the regression suite | same | "ok": nothing to report |
| No player-controlled object (Tetris, Dr. Mario, tactics; a game with no controller at all) | same | "ok"; "not in use"; no runtime error |
| Two players with different models and abilities; a placed copy with its own override; a preset chosen over abilities | same | Each listed by itself; an ability given only where it works |
| Isometric: changed to and back, a new level, one level set flat, refused with run-and-jump | same | Played: the camera is isometric and "right" follows the screen |
| Checkpoints after one flip, two flips around different lines, three flips in two directions (script-set), a flip under way at restart | `runtime/checkpoints.test.ts` | The player starts where the checkpoint is in the level as made |
| Module and runtime agree on which model an ability works with | `runtime/movement/movement.test.ts` | — |
| `go_to_level`, `restart_game`, the levels in order, "You finished the game!" | Browser, the editor's play | — |
| The same game exported: levels in order to the end, `go_to_level`, `restart_game` | Browser, the exported file | — |
| A visit and the way back; a checkpoint; R | Browser (from F6c) | Kept |
| The profile dialog: each player's movement and abilities, an ability switched on for a character | Browser | — |

Every golden from F2–F6 is unchanged.

### 23.6 Limitations

- **Geometry and camera support follow the game's declared view,** not a differing level's. Reported, not changed (by decision).
- **A game saved without a stored profile** is still described from its starter kit. A top-down game built on the platformer starter now shows notes where it showed "ok". That is accurate; working such games out differently would change how they play.
- **A declared view or model that the game left behind can only be brought back into agreement by changing the game or the declaration:** nothing does it automatically.
- **The stored profile still has a field for abilities.** It is written and not read. It can go at the next format change.
- **A Checkpoint object that a script spawned in play** is not in the rebuilt level: its place is then kept as a script-set place.
- **A place set while a flip is still under way** is mapped back as if the flip were done.
- **Unchanged from the audit:** the items under B and C there (the registries, T1, the old checker for hand-made levels, and the rest).

## 24. V1: abilities in one place, then breadth; and attention for games that aren't platformers

### 24.1 The plan (approved)

Seven stages, each reviewed on its own. The order alternates, so work for games that aren't platformers is not left to the end.

| # | Stage | What it is for | Serves |
|---|---|---|---|
| V1.1 | One definition for each ability; dash and wall jump moved; a test ability by one call | T1, the smallest useful part | Platformers (architecture) |
| V1.2 | Double jump and ledge grab moved; a dodge roll for characters seen from above; T1 closed | The registration is shown not to be for platformers only | Platformers and top-down games |
| V1.3 | Play probe: does a level run, and does it react? | Scripted games become visible to validation | Every family, mostly scripted games |
| V1.4 | Ability patterns in breadth | The builder uses what the player can do | Platformers |
| V1.5 | Real-AI evaluation: live on demand, recorded replies replayed in the ordinary tests | The path that actually makes games is tested | Every family |
| V1.6 | A precision genre and preset | The Celeste- and Meat Boy-inspired slice as something to pick | Platformers |
| V1.7 | Game checks written with the game | Decided after V1.3 and V1.5, by what they catch | Scripted games |

**Rules for every stage:**
- The cross-genre regression suite keeps playing every family: platformers (traditional, precision), Tetris, Dr. Mario, the space shooter, mining, Boulder Dash, the RPG, tactics.
- The momentum platformer is V3: a to-do, never counted as implemented or passing.
- What nothing has proven stays uncertain. Running is not winning.
- No abstraction without a use.

**Requirements recorded from the review:**

| Stage | Requirement |
|---|---|
| V1.3 | The probe reports apart: it runs without runtime errors; relevant inputs give an observable response; things act by themselves where expected; obvious runtime failures. A game that rightly waits for input does not fail because nothing moves by itself. Never "winnable", "balanced" or "correct". Seeds, a bounded budget, clear reasons |
| V1.4 | Meaningful patterns, not a number of them. For a pattern needing several abilities, each is tested by itself: without any one of them the intended route is impossible, and the bot plays it with them. The builder's and the bot's budgets stay |
| V1.5 | Claude first, the harness independent of the provider (Gemini next without a redesign). Live runs only when a person starts one, with the expected cost shown first; never in ordinary tests. Each prompt is judged on mechanics and play, not only on valid operations. Recorded: provider and model, prompt, result, tokens, cost, time |

**Deliberately not in V1:** new movement models, momentum and curved ground (V3); grid movement, reach and a solver for levels seen from above (V2); a general generator request; a stepped time model; validators for one genre of board game; merging the other registries; a cell grid for hand-drawn levels (T4).

### 24.2 V1.1 — done (awaiting review before V1.2)

**What an ability was before.** Dash lived in ten places: its runtime behaviour, its component, its profile module, the table that told profiles which component is which ability, its part of the reach model, its move rule, its route-bot step, the builder's list of mechanics, the names scripts read, and the AI's topic table. Each had to be kept in step by hand.

**What it is now: one definition, registered once** (`src/abilities/`).

| Part of the definition | Who reads it |
|---|---|
| `id`, `describe`, `plural` | The profile's module (made from it), the report, sentences ("its wall jumps aren't judged…") |
| `component` (type, label, description, fields) | The component registries: the editor's inspector, `add_component`, the AI's component list |
| `worksWith` | The runtime (an ability is given only to a model it works with) and the module's requirement, from the same field |
| `order`, `runtime` (hooks, states) | The movement model's step |
| `scriptNames` | What scripts may read (`self.dashing`), and what the script language documents |
| `reach` (its move rule with its capability numbers; estimated or exact) | The reach description, so the route solver, the level builder (capabilities, the needs check) and the validators |
| `bot` (the moves it plays, one tick's keys, when it counts as arrived) | The route bot; and so whether the reach says the ability is simulated |
| `topic` | The AI guidance topic its component is described in |

- **Only the identity, the component and the runtime part are needed.** No reach part: levels are neither built nor judged by it. A reach part and no bot part: built for, solved, and its levels stay **uncertain** (nothing played them).
- **The registry holds definitions and nothing else** (`registry.ts`: no import of any system). Systems read it when they need it; the three that keep something of their own for each ability (the module registry, the editor's component registry, the script language's table of names) are told when the list changes.
- **Dash and wall jump are each one file** (`dash.ts`, `wallJump.ts`), moved as they were: the same hooks, the same move rules, the same bot steps.
- **Patterns are not the ability's.** A level pattern says which capabilities it requires and is found by that; one pattern may need two abilities. That was so before and stays.
- **The mechanics a level can be asked for by** are the builder's own plus the abilities that have a reach part. The blueprint checks against the list there is now, and says which there are when a word isn't one.
- **The solver's moves are no closed list** any more: an ability's rule names its own.

**The proof: Glide** (`src/abilities/glide.test.ts`). An ability only that test knows: holding Jump while falling, the character falls slowly, and is carried further. It is one definition and one `registerAbility` call. No engine file names it (a test reads the sources). From that one registration:

| System | What the test shows |
|---|---|
| The editor and the AI's operations | Its component is in the registries with its setting; `add_component` gives it; a wrong setting is refused |
| The AI's guidance | Its component is listed under the topic it names, and described there |
| The profile and the report | It is an ability a profile can give; the profile shows it for the character that has it; on a character seen from above it is refused when asked for, and reported as doing nothing when it is there |
| The runtime | With Jump held the character is much longer in the air; without the component it falls as ever |
| Scripts | `self.gliding` is a name scripts may read, true while gliding; unknown again once the ability is taken out |
| The reach | A capability with numbers from the component's own setting; estimated; not simulated |
| The level builder's vocabulary | `focus: ["glide"]` is accepted; a word that is no mechanic is refused with the list |
| The builder and the solver | Its pattern is built only for a player that has it; the route goes by a glide; without it there is no route |
| Validation, no bot part | Built, solved, and **uncertain**, never validated; said plainly |
| The checker for hand-made levels | "Its glides aren't judged by the jump checker…": unjudged, in the ability's own words |
| Validation, a bot part added to the same definition | The bot plays the glides on the real runtime; the same levels are **validated** |
| Taken out | Every system has forgotten it |

**Where abilities are in the code now** (checked by a test on the sources, comments left out):
- **Implementing or registering dash or wall jump:** `abilities/dash.ts` and `abilities/wallJump.ts`, and no other file.
- **Still naming them, each for its own reason:** the AI's guidance prose; the two patterns that require them; a worked example script for the AI; a regression game made with them. (And one unrelated word: "dash" as a line style in the editor.)

**Non-regression.** Every golden is unchanged: the 9 games, the 17 movement traces, the validation snapshots and sweeps, the reach-aware suite (the bot's play frame for frame), camera, dungeons, turns, sessions. The AI's instructions are inside their budget.

**Limitations:**
- **Double jump and ledge grab are not moved yet** (V1.2). They are still registered with the runtime by themselves, hard-coded in the reach model, and their modules are declared by hand. T1 closes when they move.
- **Holding a wall is shared vocabulary, not one ability's.** The route solver's "mode" for it lives in the move-rule helpers, and the bot's own jump presses into a wall when a step ends on one. Both dash and wall jump use it.
- **A component registry made before an ability is registered doesn't get its component** (only the editor's own follows). Tests that register an ability make their registry afterwards. *(Gone in V1.2: §24.3.)*
- **The topic text for an ability is its component's description.** Longer guidance prose is still written in the topic.
- **The exported player now carries the abilities' move rules and bot steps** with their runtime part: one file each, a few kilobytes.
- **The other registries are as they were** (camera, turns, generators: two or three registrations each). Whether this approach suits them is assessed in V1.2, on paper.

### 24.3 V1.2 — done (awaiting review before V1.3)

**T1 is closed.** The five abilities there are, each one definition in `src/abilities/`:

| Ability | Works with | Its part in the reach | Bot part |
|---|---|---|---|
| Double jump | Run and jump | In the jump table: more jumps in the air | None needed (judged as jumps are) |
| Ledge grab | Run and jump | In the jump table: a ledge caught above the jump's peak | None needed |
| Wall jump | Run and jump | A move rule, estimated | Yes |
| Dash | Run and jump | A move rule, estimated | Yes |
| **Dodge roll** (new) | **Walking from above** | None: levels from above have no jump table and no route solver | None |

- **There is no other way to register an ability.** The runtime's own ability list is gone (`runtime/movement/abilities.ts` is deleted), and so are the reach model's registration, the table that matched components to abilities, and the modules declared by hand.
- **A reach part can be "in the jump table".** The table knows two kinds of boost (more jumps in the air; a ledge caught above the peak); an ability says how much it gives of each. The level checker and the jump table read the sum; neither names an ability.
- **The words the AI uses** for an ability ("a double jump") and the words of a request that ask for it are in its definition too.
- **Script names of an ability with a guidance topic** are described in that topic, with its component, not in the instructions every request carries. That is how the instructions stayed inside their budget with a fifth ability.

**Changed from the plan:** capability numbers for double jump and ledge grab are not added here. Nothing reads them until patterns require those abilities (V1.4), so they come with that.

**The lifecycle of the registry, as a rule:**

| Rule | How it holds | Test |
|---|---|---|
| The engine's abilities are registered when `src/abilities` is loaded | Every part that reads abilities imports it, so they are there before anything can ask | Each entry point loaded alone, in a fresh module graph, has all five: components, the runtime, the profile's modules, the script language, the reach model, the builder's vocabulary, the route bot |
| The editor, the runtime and an exported game have the same abilities | The exported game's page loads the same play view, so the same runtime, which imports the abilities | The import chain is checked in the sources; an exported game is played in the browser tests |
| **There is no "registered too late"** | A component registry reads the abilities' components whenever it is asked (it keeps no copy). The runtime, the reach, the bot, the vocabulary and the guidance read the list when they need it. The two systems that keep something of their own (the profile's modules, the script language's names) are told of every change | A registry made before an ability is registered has its component from then on; a game already running uses it at the character's next step; taken out, it is gone everywhere |
| A wrong registration is refused at once | The same id or component twice; a setting whose default isn't valid | Yes |
| A game with the component of an ability that isn't registered is told so | Loading warns ("unknown component type"); the compatibility report says it does nothing | Yes |

So the limitation recorded in §24.2 (a component registry made before an ability is registered) is gone, not documented around.

**The dodge roll** (`abilities/dodgeRoll.ts`): the first ability for characters seen from above.
- **In play:** a press of its key rolls the character the way the keys point (the way it last headed, when none is held), fast, for a moment; it can't be steered meanwhile and (unless switched off) can't be hurt; then it walks on, and waits before the next roll. Walls stop it as they stop walking. Seen at an angle, it goes the way the keys point on the screen, as walking does.
- **It has a component and a runtime part, and nothing else.** No reach, no bot: nothing is built or judged by it, and nothing claims to be.
- **On a run-and-jump character** it is refused when asked for through the profile, reported as doing nothing when its component is there, and does nothing in play (Space is still its jump).
- **No engine code was written for it** beyond its definition: the top-down movement model already called an ability's hook, and no ability had used it.
- **Regression:** two new movement traces (from above, and at an angle). The shooter and Boulder Dash of the suite have no roll and play as they did.

**On paper only: would the same approach suit the other registries?**

What made it worth doing for abilities: five instances, about eight systems reading each, and more of them coming in V1.4. By the same three questions:

| Registry | Instances | Systems reading each | More coming soon? | Verdict |
|---|---|---|---|---|
| Camera behaviours | 3 | 2 (the camera pipeline; the profile's report) | One, perhaps, with arenas (V5) | **Yes, but then.** Three registrations for a plug-in, and a behaviour with no implementation is skipped without a word. Move them to one definition each when the fourth is written, not before |
| Turn systems | 1 | 2 (the script statements; the report) | None planned | **No.** One system, a thin adapter. The three registrations cost nobody anything. Only if a second turn system is really built |
| Generators | 2 (one while editing, one at play) | 3 (the builder; the runtime; the report) | A second edit-time one with V2 | **Not this way.** Their problem is the request, which is the sections builder's own (audit B9): that is designed with the second generator |
| Progression | 1 | 2 (the session; the report) | V5 or V6 | **No**, until then |

One thing found on the way that would be cheap whenever the camera is next touched: a selected camera behaviour that has no implementation should be reported, as progression already does.

**Limitations:**
- **The hanging and the climbing of a ledge grab are still the arcade model's** (its host has the geometry of it). The definition says when a ledge is caught.
- **A double jump's count now starts over with a respawn** *(looked into and made a rule in §24.4)***,** as a dash's charges do: its state is the ability's own, cleared with the rest. Before, a character that had used its air jump and was put back in mid-air had none until it landed. No golden or test saw the difference.
- **The roll's default key is Space,** which also fires a Shooter in a game seen from above: its component says so and offers two other keys. *(Changed in §24.4: a key of its own.)*
- **While it can't be hurt, the roll blinks,** as anything that can't be hurt does.
- **No starter has the roll,** and it is not played in the browser tests (only its place in the profile dialog is checked there). *(Played there since §24.4.)*
- **In the isometric starter the roll is tested where blocks stop one of its two axes:** it is shown to go the way walking goes there, further, not along a free diagonal.

### 24.4 V1.2 follow-ups (from its review)

**1. A respawn and a character's abilities: the rule.**

- **What the engine did before V1.2** (measured by running the commit before it): a respawn refilled a dash and did **not** refill a double jump. A character that had used its air jump and came back in mid-air had none until it landed; its dash was ready. The two abilities kept their counts in different places on the character, and only one of the places was cleared.
- **The rule now, on purpose:** a respawn is a fresh start for a character's abilities, every one alike. It has what it has when a level starts: its air jumps and dash charges full, no wait before a roll. Each ability's state is its own and all of it is cleared together (`runtime.ts` `respawn`).
- **Why this one and not the old one:** it is what a level's start already does, what a dash already did, and what a player expects of coming back. The old behaviour for a double jump was a side effect of where its count was kept.
- **What it changes in play:** one case only: a character with a double jump that comes back in mid-air (its start or its checkpoint is in the air) after using its air jump. It can jump again at once. Landing refilled it before and still does.
- **Tested directly** (`abilities/abilities.test.ts`): double jump (one and two extra jumps; a setting lowered in play), dash, both on one character, and the roll's wait.

**2. A key of its own for the roll.**

- **A new action, `special`:** Shift on the keyboard (both), the right shoulder button and the left trigger on a controller, a touch button on phones. No other action has its keys.
- **The roll listens to it by default.** Space, X and E are still offered in its component.
- **Nothing a game had stops working when the roll is added:** a shooter given the roll fires as often with Space and with X as before, and neither rolls; Shift rolls, and firing goes on meanwhile (tested).
- **It is an action like the others:** a game can give it other keys (the Controls dialog, `set_controls`), and scripts can listen to it (`key: "special"`).
- **An ability says which keys it listens to** (`keys` in its definition). The play screen's hints say so ("Shift rolls", or the game's own key) and a touch button is shown for a key that has none yet. A dash says its key the same way.

**3. The roll played in the browser.** A game seen from above made by the (stubbed) AI's operations: the hero with a roll, three hazards in a row, a wall beyond. In the real play screen:
- the profile lists the hero with its roll, and a dash can't be given to it;
- the hints say "Shift rolls";
- Right and Shift: it is past the hazards in well under the time walking takes, and nothing hurt it;
- it comes to the wall; a roll into the wall goes no further;
- walking back through the hazards without rolling, it is hurt.

**Limitations after these:**
- **A dash still shares X with a Shooter by default.** Its default is unchanged (existing games and their traces depend on it); `special` can be offered for it when dashes are next worked on.
- **The roll still blinks while it can't be hurt.**
- **No starter has the roll.**
