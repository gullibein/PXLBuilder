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
