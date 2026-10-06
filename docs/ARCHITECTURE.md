# PXLBuilder architecture

PXLBuilder is an AI-native 2D game builder. The **project model** (a structured,
queryable description of the game) is the single source of truth. The editor,
the renderer, the future play-mode runtime and the future AI layer all read
it, and all of them change it through the same validated mutation functions.
The LLM will *propose* operations; the application validates and applies them.

Status: **Phase 1 (foundation)**, **Phase 2 (runtime / Play)**, **Phase 3
(graph: relationships, events, rules, graph queries, entity references)**, the
**command/transaction system** (Phase 4 core), the **AI foundation** (Phase 5),
and the **contextual-AI interaction redesign** are implemented. Behaviors
(enemies moving on their own, timers) are not built yet. See "Roadmap" at the end.

## Stack

| Choice | Why |
| --- | --- |
| TypeScript + React + Vite (browser app) | Fast iteration, one language from model to UI, trivial to call AI APIs through a backend proxy later, can be wrapped in Tauri/Electron for desktop and real folders. |
| Canvas 2D renderer | Enough for a 2D pixel-art builder; shared by editor and runtime. WebGL (e.g. PixiJS) can replace it behind `src/render` if needed. |
| zustand | Minimal editor store; no boilerplate. |
| immer | Mutations are written as plain in-place code but produce new immutable project versions, which gives cheap change detection now and snapshot/undo support later. |
| zod | Validates the project file structure on load (and later, AI operation payloads). |
| vitest + Playwright | Unit tests for the core; an end-to-end smoke test drives the real UI in headless Chromium. |
| Anthropic TypeScript SDK (server side only) | Model calls run in the Vite dev/preview server (`server/`), so the API key never reaches the browser. Structured output (a zod schema) guarantees the reply is a parseable operation list. |

Physics (Phase 2) should use an existing library (planck.js or Rapier 2D) rather than a custom engine.

## Layers

```
src/core/            pure TypeScript, no React/DOM — the game model
  types.ts           Project, Scene, EntityInstance, ObjectDefinition, ...
  commands/
    operations.ts    structured, serializable operations (the AI's vocabulary)
    history.ts       transactions + undo/redo
  ai/
    context.ts       AIContext (from selection) + compact payload builder
    capabilities.ts  the AI "toolbox": generated from the component registry
    protocol.ts      request/response schema shared by client and server
    provider.ts      AIProvider interface + HTTP provider
  ids.ts             stable ids ("ent_3f9a1c2b7d4e")
  logic/
    vocabulary.ts    event + relationship-type registries, condition/action/rule schemas
    refs.ts          entity references: match, resolve, check, describe, prune
    mutations.ts     validated relationship and rule edits
    describe.ts      relationships and rules as plain sentences
  graph/graph.ts     the game graph (nodes + typed edges) and graph queries
  components/        component schemas + registry (extensible)
  model/
    factory.ts       constructors + starter definitions
    resolve.ts       definition + instance overrides -> effective entity
    mutations.ts     ALL validated model changes (future command executors)
    geometry.ts      bounds / hit testing
  serialization/     file layout, zod schemas, versioning, migrations
src/render/          scene renderer shared by editor and runtime
src/runtime/         Play: physics, movement, and gameplay.ts (events, rules, systems)
src/editor/          React UI
  store.ts           editor state; edit() = one validated transaction
  viewport/          the canvas: selection, relation arrow, level marker
  prompt/            contextual prompt, placement, per-frame anchor channel
  ai/runPrompt.ts    prompt -> context -> provider -> operations -> transaction
  chrome/            top bar, dock (create + library), tray, global prompt
  logic/             Logic card + connections section of the details drawer
  panels/            details drawer (the former inspector)
server/              dev/preview server endpoint POST /api/ai (Anthropic SDK)
scripts/e2e-smoke.mjs   browser end-to-end test
```

Dependencies only point downward: `editor -> render -> core`. Nothing in
`core` knows about the UI, so the command system, the runtime and the AI
layer can use it directly (including from a backend later).

## Key decisions

### Entities are compositions, not classes
There is no `Player` or `Enemy` class. An entity is an id, a name, a
transform, a map of components (`type -> props`), tags and metadata. The
starter "Player", "Platform", etc. are ordinary data in the object library
(`createStarterDefinitions`) and can be edited or deleted like anything else.

### Transform is a field, not a component
Every entity has a position, so `transform` is a required field of
`EntityInstance` rather than an optional component. It is per-instance;
object definitions don't carry a transform.

### Component registry = machine-readable capability description
`ComponentRegistry` holds a `ComponentDefinition` per type: label,
description, category, and a typed schema per field (`number` with
min/max/integer, `enum`, `color`, `vec2`, `assetRef`, `stringList`, ...).
The same schema drives:
- the inspector (fields are rendered generically, there is no per-component UI code),
- validation of every edit and of loaded files,
- default values,
- later, the AI "toolbox" description of what the engine can do.

New component types are added by registering a definition; nothing else
hard-codes the list.

### Object definitions and instances
`ObjectDefinition`s are reusable templates in the object library. A scene
`EntityInstance` with a `definitionId` inherits the definition's components
and tags. Its own `components` map then stores **only overrides** (partial
props, field-level), and `removedComponents` lists inherited components it
opts out of. `resolveEntity()` merges these into the effective state.

- Editing a definition changes every instance that doesn't override that field.
- Editing an instance stores an override (shown in yellow in the inspector,
  with a revert button). Setting it back to the inherited value drops the override.
- Deleting a definition *unlinks* (bakes) its instances so scenes keep working.

This is what lets "make **all** robot enemies faster" (edit the definition)
differ from "make **this** robot faster" (override on the instance).

### One mutation layer, one edit entry point
Every change to the project goes through a function in
`core/model/mutations.ts`. Each one validates its input (against the
component registry where relevant) and throws `ModelError` instead of
writing bad data. The editor calls them only through `useEditor().edit(label, recipe)`,
which runs the recipe in an immer `produce`, logs rejections to the console
panel and keeps selection consistent.

`edit()` is the seam for Phase 4: it becomes "execute a command inside a
transaction", recording inverse operations for undo/redo, and AI operations
will map to the same mutation functions. A viewport drag commits **one**
edit on mouse-up, not one per frame, so it will be one undo step.

### Interaction architecture: the game is the interface
The canvas fills the window. Everything else floats over it and is either
contextual or opened on demand:

- **Selection is the AI context.** Nothing selected: no prompt, clean canvas.
  One object: one prompt next to it. Two objects: a dashed arrow (first ->
  second) and one *relationship* prompt. Three or more: one *group* prompt.
  Double-clicking empty space makes the *level* the context (with a marker
  where you clicked, so "here" means something). `getSelectionContext()`
  derives an explicit `AIContext` from this state; there is exactly one.
- **The prompt follows its context.** The viewport publishes the selection's
  screen bounds every frame through `prompt/anchor.ts` (outside React, so it
  tracks drags and zooms smoothly). `placePrompt()` (pure, unit-tested) puts
  the prompt above the object by default, below it near the top edge, beside
  it near the left/right edges, and never clips it.
- **Selecting doesn't steal focus.** Enter moves into the prompt.
- **Advanced tools are progressive disclosure:** the details drawer (the
  former inspector), the library and Create (bottom dock), history/console
  (bottom-left tray), and a secondary global prompt (top bar, level or whole
  game scope).

### Drawing and tiles
- **Brush tool.** Clicking a library object arms it as a brush (`tool` in the
  store). Click places one copy, drag paints: every grid cell the pointer
  crosses gets one copy (Bresenham between pointer samples, so fast strokes
  leave no gaps; existing copies are not duplicated). Right-drag erases. A
  stroke is previewed as ghosts and committed on release as **one**
  transaction. Drawing clears the selection, so no prompt is in the way.
- **Placement cells** (`core/model/placement.ts`): an object's cell is its
  size rounded up to whole grid steps. Objects drawn with the brush sit at
  cell centers.
- **Tiles** are ordinary entities whose definition has
  `metadata.placement = "tile"` (starter *Platform*, *Stone* and *Ladder*, 32×32). They
  snap to whole cells when dropped or dragged, and the renderer joins
  neighbouring tiles of the same kind into one surface (lighter top edge only
  where nothing sits above). Keeping tiles as entities means each one can be
  selected, moved, and used as AI context like any other object. A dedicated
  tilemap layer can replace this later if levels get very large; no format
  change was needed (`metadata` is already part of the format).

### Assets and backgrounds (format v2)
- `AssetRecord` carries its file contents as a data URL (`data`) plus pixel
  size. On disk each asset is its own file (`assets/<id>.<ext>`); project.json
  lists metadata only. Uploaded images over 2048 px are scaled down.
- Each scene's `world.background` = `{ imageAssetId, fit: cover|tile,
  parallax 0..1 }` on top of `backgroundColor`. The shared renderer draws it
  (cover = fill view height and repeat sideways; tile = repeat at image size;
  parallax 0 = fixed on screen, 1 = moves with the level), so play mode will
  look the same. The AI edits it with the `set_background` operation and has
  a `background` context; it cannot create pictures.
- Sprites with `assetId` draw their image (pixel-crisp); the starter Ladder
  uses a built-in SVG asset.
- Autosave moved to IndexedDB (projects with images outgrow localStorage);
  an older localStorage autosave is still read once.
- **Migration v1 -> v2** adds background settings and asset data, turns the
  old wide starter Platform (160x24) into a 32x32 tile and replaces each
  placed wide platform with a row of tiles over the same span, and adds the
  new starter objects (Stone, Ladder). Tested with a real v1 file and an old
  autosave in the browser.

### Sprites and sprite sheets
- An object is drawn with `Sprite.assetId` (an image or a sprite sheet),
  stretched to `Sprite.width × height`. For sheets, `Sprite.frame` is a cell
  number (1 = top-left, across then down), the same number the user sees.
- A sheet is an asset with `kind: "spritesheet"` and a `grid` (columns, rows,
  cell size, offset, spacing). `core/model/spriteGrid.ts` (pure, unit-tested)
  detects it: empty columns/rows (transparent, or the corner pixel's color)
  separate sprites; their center-to-center pitch gives the cells; evenly
  divided sheets keep each cell's padding; otherwise it falls back to square
  cells. The user can adjust every value; invalid grids are rejected.
- Each object keeps the sprites collected for it in `metadata.sprites`
  (`{assetId, frame}[]`), so they can be switched later (and by the AI).
- Opened from the Objects panel's right-click menu (Inspector / Sprites).

### Sprite and collider size link
`Collider.matchSprite` (default true) ties the two sizes together. The rule
lives in the mutation layer (`linkedWrites`), so the inspector, AI operations
and any future tool behave the same: changing Sprite width/height resizes the
collider, changing the collider resizes the sprite, and turning the link back
on snaps the collider to the sprite. Existing objects keep their sizes until
edited. The starter Ladder ships unlinked (its collider is narrower than its art).

### Built-in (starter) objects
Starter definitions carry `metadata.starter` (their original name; older
projects match by name). `resetStarterDefinition` / `resetAllStarterDefinitions`
put them back to how they ship, keeping their ids (so placed copies stay
linked and in place; their per-copy tweaks are cleared), re-adding deleted
starters, reusing identical image assets, and never touching user-made
objects. Exposed in the project menu and in the Objects right-click menu.

### Top bar
Three grid columns: Play stays centred while there is room and is pushed
aside, never overlapping, when the window narrows (the wordmark text hides
and names truncate below 1100 px).

### Tools
A left tool panel switches between **Select** (arrow, `V`) and **Draw** (pen,
`B`; draws with the last used object, shown under the pen), and opens the
**Background** and **Logic** cards. Only one card is ever open: opening a card
clears the selection, and selecting something closes it.

### Runtime (Play mode)
`src/runtime/` is pure TypeScript (no React), unit-tested in Node:

- `Runtime` is built from a snapshot of the project when Play starts and
  discarded on Stop. It keeps its own positions/velocities; the project is
  never written (tested: the serialized project is byte-identical after a
  run, and the editor's undo history is unchanged after playing).
- Fixed 1/120 s simulation steps with an accumulator, so physics doesn't
  depend on the display's frame rate.
- `physics.ts`: arcade physics for a platformer (axis-aligned boxes, no
  rotation; move x then y and stop at the first solid). Bodies land exactly
  on tile tops and never snag on seams between neighbouring tiles. A
  rigid-body library (Box2D/Matter/Rapier) was considered and rejected for
  characters: rotation, friction on walls and seam-snagging make platformer
  controls feel wrong. One can still be added later for crates and ropes.
- Everything is driven by components: `PhysicsBody` (dynamic falls with
  world gravity × gravityScale; static and collider-only entities are
  solid; kinematic moves by velocity), `Collider` (box/circle as a box,
  offset, triggers aren't solid), `CharacterController` (input-driven run
  with acceleration and air control, jump with jumpForce, coyote time, jump
  buffering, shorter hop on early release), `Climbable` (Up/Down climbs at
  the character's running speed once at least half of the character is
  inside the ladder tile; sideways moves slide along it and you let go when
  less than half remains; reaching the floor ends the climb; the top of a
  ladder is a one-way platform you can stand on and climb down from; Up
  never jumps), `CameraTarget` (smoothed follow).
- Climbing straight up or down eases the character to the ladder's middle
  (exponential, about 10/s); holding Left/Right while climbing overrides it.
  With ladders side by side, the one the character overlaps most is used.
- Pieces stacked directly on each other form one ladder; a gap starts a new
  one. You hold a ladder while your feet are no higher than its top and your
  middle no lower than its bottom, so a ladder above a gap is reached only by
  jumping. Climbing up stops dead at the top (standing on it, no leftover
  speed); letting go any way but jumping drops the climbing speed.
- Tuning: the starter Player is one tile (32px) tall, and jumpForce 295 at
  gravity 980 gives a ~44px (1.4 tile) jump: one row up, never two. Format
  v3 applies this to older saves unless the user changed those values.
- Falling far below the level puts an entity back at its start.
- Camera (`runtime/camera.ts`, settings and math in `core/model/camera.ts`):
  - It follows the entity with a `CameraTarget` (its `followStrength` is the
    smoothing). With none, it stays still on `fixedAt`, or the middle of the
    level; there is deliberately no fallback to the player, so what the
    project (and the AI) says is what happens.
  - Per-level settings (`scene.camera`, format v6): `zoom` (0.25–4; Play no
    longer uses the editor's zoom), `lookAhead` (px ahead of where the target
    faces), `deadZone` (px the target moves before the camera does),
    `bounds` (`none` / `level`: never past the box around everything placed /
    `custom`: `customBounds`), `fixedAt`. New levels keep the camera inside
    the level; levels from older files get no limits (as they played before).
    A level smaller than the screen is centered.
  - Effects, from rule actions and script statements of the same names:
    `camera_shake`, `camera_flash` (drawn over the screen by Play),
    `camera_zoom` (over time), `camera_focus` (look at something, then back),
    `camera_follow` (another target, or null: stay still). Restart resets them.
  - `startCamera`/`clampCamera` are shared with the editor's **camera frame**
    (menu → Camera frame, or the level's details): a dashed outline of what
    Play shows at the start on this window size, and the limits.
  - The AI changes settings with `set_camera` (only the settings that
    change, checked as a whole) and gets `level.camera` (settings, what it
    follows, the level box).
- `input.ts` maps keys to actions (arrows/WASD, Space/Z jump, E use, X fire); the runtime
  only sees actions.
- `PlayView` draws the runtime with the same renderer as the editor
  (background, parallax, tiles, sprites). Play hides all editor tools; Esc,
  Stop or Ctrl+Enter returns to editing; R restarts.
- Gameplay (health, damage, collecting, doors, switches) and the level's
  relationships and rules run in `gameplay.ts`; see "Game logic" below.
- **Behaviors** are components (category "Behavior"), read into
  `RuntimeEntity.beh` when Play starts, run by `behaviors.ts` (`before`
  physics sets velocities, `after` handles shots):
  - `Patrol`: back and forth at a speed; turns on bumping a wall, on a wall
    probe just ahead, at a ledge (floor probe ahead, walkers only) and after
    `distance` from the start. A static thing that patrols becomes kinematic
    (flies). A `follows` relationship takes over while chasing (`chasing`).
  - `Jumper`: jumps every `interval` when grounded.
  - `Shooter`: `auto` fires every `interval` while something tagged
    `targetTag` is within `range` (no target, no shot); `key` fires on X
    (cooldown = `interval`, ready at once). Shots are runtime-only kinematic
    triggers (a library object, or a built-in 8px shot) carrying the
    shooter's tags plus `projectile`; they hurt through the normal damage
    rules (receiver tags or `damages`), never their owner, then vanish; also
    on walls and after `range`. Spent shots are dropped from the list; at
    most 100 fly at once.
  - `MovingPlatform`: kinematic, glides to start + `offset` and back with a
    `pause`, carrying dynamic things standing on it (sideways moves stop at
    walls).
  - `Timer`: emits `timer` every `interval` (or once).
  - `DoubleJump` and `LedgeGrab` are part of character control
    (`runtime.ts`): extra jumps in the air reset on landing; a ledge is
    grabbed when falling (or at the top of a jump) flush against a static
    solid while pressing toward it, with its top within hand reach and room
    to stand above it. Hanging: no gravity; Up/Space climbs onto it,
    Down/away lets go (short cooldown).
  - Entities face the way they move (`facing`); the renderer mirrors them.
  - New events: `timer`, `shot`, `ledge_grabbed`.

### Change the object, or create a new one
Behavior and looks belong to library objects, never to one placed copy.
When an AI change alters what one library object is (components, scripts,
sprites, tags; whether the AI aimed at a copy or at the object), the card
does not apply it: it shows the change with **Change <Object>** (every copy
gets it; ops aimed at a copy are re-aimed at the object) and **Create new**
(a copy of the object, "Enemy 2", gets the change and the selected copies
become it; the old object and its other copies are unchanged). One undo
step either way (`core/commands/objectChoice.ts`). Moving or renaming a
copy, connections, rules and level changes apply as before. The AI is told
to always target the object.

### AI prompts run in the background
Prompt runs live in a job list (`editor/ai/jobs.ts`), one per context key
(an object, a pair, the level…), not in the prompt card, so closing a card
never cancels its prompt (it used to). The user keeps editing and can give
other objects prompts meanwhile; one prompt per context at a time. The level
draws three bouncing dots over objects whose prompt is running, and a badge
over ones whose finished prompt waits to be looked at (a proposal, an
answer, or an error in red); applied changes just glow as before. Opening
the object's card shows the run (busy, with Stop) or its result. A card's
Undo is offered only while its change is still the latest in the history
(`transactionId`), so it never undoes someone else's change.

### Sprites by situation
`SpriteStates` (component, "Sprites by situation") holds an image per
situation: run, jump, fall, climb, hang, hurt, shoot. `Runtime.lookOf`
works out what an entity is doing each frame (hurt for 0.4 s after a hit,
shoot for 0.25 s after firing, then hanging, climbing, in the air going up
or down, moving) and `renderList` swaps the Sprite's image for that
situation's (falling uses the jumping image when there is no falling one);
empty slots keep the normal image. The AI's `draw_sprite` takes a
`situation` (null = the normal look). Images drawn as pixel art keep their
pixels (`AssetRecord.pixelArt`, the starter Player and Enemy too), and the
AI gets them as `targets[].look`, so "a jumping sprite" is a variation of the
same drawing. One image per situation; frame animations are not built yet.

### Editor styles
The editor's look is an editor setting (`editorStyle`: classic, the default;
blueprint; arcade; paper; amber), chosen in ⋯ → Editor style… or by asking
the Editor prompt. It only restyles the editor, never the game: the level
keeps its own background and art. `applyStyle` (theme.ts) sets
`data-style` on the page, which `styles.css` keys its overrides on (tokens
plus a few component rules: outlines, shadows, fonts), and swaps the canvas
colors (grid dots, drafting lines, labels). The amber style uses amber
instead of the accent color; the others keep the user's accent.

**Wireframe view** (editor setting `wireframe`; W, the tool panel's cube
button, or the ⋯ menu): while editing, every object is drawn as the outline
of its collider shape with a faint fill and a center mark, colored by kind
(player, dangerous, item, see-through and dashed, solid) in the current
style's colors (`theme.wire`) on the style's ground. Play always shows the
real game.

### Behavior scripts (programmable behavior)
Ready-made components cover common cases; everything else is programmed.
The AI writes **behavior scripts**: programs stored as data on a library
object (`ObjectDefinition.scripts`, every copy runs them) or on one entity
(`EntityInstance.scripts`); format v5. Never JavaScript: nothing is `eval`'d,
so a shared game can't run arbitrary code, and scripts are validated, undone,
saved and shown like any other edit.

- **Language** (`core/script/language.ts`, one table drives the schema, the
  checker, the AI reference and the interpreter):
  - a script = `vars` (per entity), optional `states` (a state machine;
    `states[0]` starts), and `handlers`: *when* trigger, *in state*, *if*
    expression, *do* statements;
  - triggers: `start`, `tick` (every step), `every` N s, `enter_state`,
    `event` (any game event the entity takes part in, `with` a tag of the
    other party; `other` is that party), `key` (pressed/held/released),
    `signal` (sent by another script);
  - statements: `set` (own or another entity's variable), `if`, `each` (over
    a tag, as `it`), `velocity`, `push`, `move_toward`, `glide_to`,
    `position`, `jump`, `face`, `gravity`, `shoot`, `spawn`, `remove`,
    `damage`, `heal`, `give_item`, `take_item`, `set_open`, `state`, `signal`,
    `message` (with `{expression}` parts), `alpha`, `speed_factor`,
    `respawn`, `restart_level`;
  - movement and look statements (`velocity`, `push`, `glide_to`,
    `position`, `jump`, `face`, `gravity`, `speed_factor`, `alpha`) act on
    the script's own entity, or on another given by `on` (an expression:
    `other`, `it`, `player`…). That is how an area acts on what enters it:
    water slows and lightens the player from the water's own script;
    `speed_factor` scales the walking speed of the player's controller and
    of patrols (respawning resets it and the gravity);
  - expressions (`expr.ts`, a hand-written parser): numbers, text, booleans,
    arithmetic, comparisons, and/or/not, `?:`, names (`self`, `player`,
    `other`, `it`, `time`, `dt`, `state`, `state_time`, variables), entity
    properties (`x`, `vy`, `grounded`, `health`, `facing`, `spawn_x`…) and
    functions (`dist`, `dx`, `nearest`, `count`, `solid_at`, `can_see`,
    `key`, `pressed`, `touching(tag[, e])`, `overlaps(e)`, `rand`, `chance`, `sin`, `clamp`, `get`…).
- **Checking** (`checkScript`): structure, every expression parsed, every
  name/property/function/state/event/object known (with "did you mean"),
  `other` only where it exists, size limits (40 handlers, 400 steps, depth
  8). Errors name the exact place: `Script "Charge", handler 2 (tick): step
  1 (move_toward): expression "sped * 3": unknown name "sped" (did you mean
  "speed"?)`.
- **Running** (`runtime/scripts.ts`): each entity runs its own copy.
  start/tick/every/key handlers run before physics; event and signal
  handlers run from the gameplay event queue (so the runaway cap covers
  them). No open loops; a budget per handler run (2000 operations) and per
  step stops runaway scripts. Problems while running are reported once per
  script (`runtime.scripts.errors`, event `script_error`) and the game goes
  on; a stored script that no longer checks out is reported and not run.
  Static things a script moves become kinematic; `glide_to` suspends gravity.
- **AI**: operations `set_script` (whole script; same id replaces),
  `remove_script`, `set_script_enabled`. Targets carry their scripts in
  full; the system prompt carries the generated language reference and
  the example scripts (`script/examples.ts`: Charger, Jetpack, Crumble,
  Water, Swim; tests run each one in the
  engine). If the AI's answer doesn't apply (any operation, not only
  scripts), the editor sends the exact problem back once and uses the
  corrected answer.
- **Editor**: the details panel lists scripts (the object's and the
  entity's own) with their description, a readable step-by-step view
  (`script/describe.ts`), on/off, remove, and "Edit as code" (JSON, checked
  the same way before saving).

### Debugging (Phase 9): play recording, problem checker, AI diagnosis
- **Event log** (`runtime/gameplay.ts`): every game event, with names and
  ids of who took part. `respawned` says why (`fell`, `died`, `rule`,
  `script`); `locked` is logged (and usable in rules) when a player touches
  something that requires an item without carrying it, so "nothing happened"
  is visible too.
- **Play recorder** (`runtime/recorder.ts`): listens to the log
  (`runtime.onLog`, survives restarts), samples the player and things that
  move or can be hurt every 0.25 s (last 30 s), and at the end snapshots
  every entity (health, items, open, script state and variables, speed and
  gravity changes, what it touches). It only reads the runtime. PlayView
  hands the `PlayReport` (`core/debug/playReport.ts`) to the editor store as
  `lastPlay` (with the project it played, to tell whether the game changed
  since); it is not saved. A console line sums up notable sessions.
- **Problem checker** (`core/debug/diagnose.ts`): static checks that mirror
  what the runtime does: a "requires" item nothing gives (no collectible, no
  starting inventory, no rule or script give_item), a requires/controls
  target that isn't Openable, controls from something without a Switch,
  damages onto something without Health, Damage no receiver accepts,
  collectibles nobody can pick up, no player, connections to things not in
  the level, design-only connection types, stored scripts that no longer
  check out, and script statements without "on" that change nothing
  (speed_factor on something that doesn't walk, gravity on something that
  doesn't fall). Copies of one object are one problem. Checks that could be
  wrong are left out.
- **AI**: every payload has `debug.problems` and `debug.lastPlay` (a summary
  from `summarizePlay`: counts per event, the last 160 events with repeated
  touches merged, traces of the player and the selection, end states,
  script errors, messages, and whether the game changed since). The system
  prompt's Debugging section says to explain from this data, distinguish
  "works as set up, but…" from a setup problem, and return fixes as a
  preview.
- **Editor**: the tray's Debug tab lists problems (Show selects the
  entities; ✦ Fix starts a level prompt "Fix this problem: …") and the last
  play's notable events (all events on request; a row selects what it is
  about), with suggested questions that start a level prompt.

### Game logic (Phase 3): relationships, events, rules, graph
The design principle: logic is **data in the project**, built from a small
vocabulary, never generated code. Everything lives per level
(`scene.relationships`, `scene.rules`, format v4) and goes through validated
mutations (`core/logic/mutations.ts`), so the inspector, the AI and tests use
the same checks.

- **Entity references** (`EntityRef`): one entity (`entity`), every copy of a
  library object (`object`, so copies placed later are included), a `tag`,
  the event's `subject` / `other`, or `any` (only as a rule filter). They are
  checked on every edit (the entity must be in that level, the object must
  exist). Deleting an entity or an object removes the relationships and
  rules that name it, in the same undoable step (`pruneLogic`).
- **Relationships** (`{ type, source, target, params, conditions }`) are typed
  edges from a registry (`RelationshipRegistry`, extensible: register a type
  with its verb, description and parameter schema). Built in, with meaning
  in play: `controls` (a switch opens/closes its target), `requires` (a door
  opens for whoever touches it carrying the target's item; `consume`),
  `damages` (touching the source hurts the target), `collects`, `follows`
  (the source steers toward the nearest target within range at a speed:
  walkers sideways, gravity-free things straight at it). Recorded in the
  design only (marked so in the UI and for the AI): `targets`, `protects`,
  `contains`. A relationship's `conditions` gate it ("the switch
  only works if the player has the key").
- **Events** come from a registry too (`level_started`, `touch_started/ended`,
  `collected`, `damaged`, `died`, `respawned`, `switch_activated`, `opened`,
  `closed`, `spawned`), each with a defined `subject` and `other`.
- **Rules**: `WHEN event (subject/other filters) AND conditions DO actions`.
  Conditions: `has_item`, `health`, `is_open`, `switch_on` (each can be
  negated). Actions: open/close/toggle, remove, spawn, damage, heal,
  give/take item, respawn, restart_level, show_message. Rules can be
  switched off.
- **During play** (`runtime/gameplay.ts`) systems turn physics into events:
  touches (overlap, standing on, bumping; moving entities only), picking up
  Collectibles (needs an Inventory or a `collects` relationship), damage
  (Damage + a matching DamageReceiver tag, or `damages`; invincibility and
  knock-back after a hit; at 0 health a player-controlled entity respawns,
  anything else is removed), switches (E, or by touch). Events are processed
  in order once per step: built-in relationship reactions first, then rules,
  whose actions may emit more events; a step handles at most 200 events, so
  a rule that triggers itself is stopped (and logged) instead of freezing the
  game. Every event is logged (`runtime.eventLog`; the newest 300). Open
  things stop blocking and draw faded, a switch that is on draws mirrored.
  The HUD shows hearts, items and rule messages.
- **The game graph** (`core/graph/graph.ts`) is built on demand from the
  model (the model stays the source of truth): nodes for the project, levels,
  entities, objects, components, assets, tags, items, rules and events;
  structure edges (`contains`, `instance_of`, `has_component`, `has_tag`,
  `uses_asset`, `gives_item`, `carries`), relationship edges named by type,
  and rule edges (`listens_to`, `triggered_by`, `checks`, `acts_on`,
  `spawns`). Queries answer design questions without reading JSON:
  `findRelationships` ("all doors requiring the red key", "everything
  Switch 1 controls"), `findEntities` (by name, tag, component, object, level),
  `relationshipsOf` / `rulesAbout` (an entity's connections, including through
  its object or tags), `sourcesOfItem` ("where does the player get the key?").
- **Editor**: the Logic card lists the level's connections and rules as
  sentences (`describe.ts`), with remove and on/off, plus a prompt; the
  details drawer shows an entity's connections and a small form to add one;
  the canvas draws existing connections as labelled arrows (for the
  selection, or all while the Logic card is open).
- **AI**: the payload includes the level's logic (sentences + data, ids for
  editing); operations `create_relationship`, `update_relationship`,
  `remove_relationship`, `create_rule`, `remove_rule`, `set_rule_enabled`
  (JSON payloads validated by the same schemas); `place_instance.ref` and
  `create_definition.ref` let one reply create things and wire them up. The
  system prompt lists relationship types, events, conditions and actions from
  the registries, so it can't drift from the engine.

### Editor settings and the Editor prompt
The editor's own interface can be changed by talking to it ("move the Play
button to the bottom", "dock the details panel on the right"), with the same
principle as the game: the AI never edits UI code. `editor/layout/settings.ts`
declares each adjustable part as a typed setting (reusing the component field
schemas): Play button position, details panel floating/docked and side, tool
panel side, history/console corner, accent color, mouse-wheel zoom speed,
grid and snap. The ✦ prompt's **Editor** tab sends these settings with their
allowed and current values (`AIContext` kind `editor`; core only carries them,
it knows nothing about the UI); the AI answers with `set_editor_setting`
operations, which are validated against the schema and applied all-or-nothing.
Anything outside the settings is answered as not possible yet.
- Settings are the user's preferences, not the game: saved in this browser
  (localStorage), not in the project, with their own undo (the prompt's Undo,
  `undoLayout`), and "Reset editor layout" in the ⋯ menu.
- The layout is applied with classes on the editor root; a docked details
  panel is a column beside the stage, so the level view (and every overlay
  placed in it) makes room. The accent color drives the CSS variables (other
  purples are `color-mix` of it) and the canvas selection colors.
- New adjustable parts are added by declaring a setting and reading it in the
  UI; the AI picks it up automatically.
- **Overlays** (`editor/overlays/`): information drawn over the level while
  editing, never in play. Declared data `{ kind, target: EntityRef, show }`:
  `info` (a panel above each matching entity listing metrics such as jump
  height/distance, speed, health, or any `Component.field`) and `jump_reach`
  (the arc of a running jump). The AI adds/removes them with
  `add_editor_overlay` / `remove_editor_overlay` from any prompt ("show the
  jump height above the player"); a reply is all editor operations or all game
  operations. The prompt is placed clear of a selected entity's panel. Jump
  figures come from `core/model/reach.ts` (height jumpForce²/2g, running
  distance speed·2·jumpForce/g), shared with the AI context.

### Where the AI runs, and whose key
`core/ai/claude.ts` is the single Claude request (model, cached system prompt,
structured output, fallbacks, error meanings). Two providers use it: the dev
server (`server/`, key from the environment, never sent to the browser) and
`BrowserClaudeProvider` (the user's own key, entered in ⋯ → AI connection,
calling the API directly with `dangerouslyAllowBrowser`). The key is checked
with a free model lookup before it is kept; it lives in memory for the
session, or in localStorage only if the user ticks "remember". A third provider, `SampleAIProvider`, is used when the app runs as a
published claude.ai page: it asks Claude through the viewer's `sample`
capability (the viewer's own Claude account, consent once per visit; the page
itself may not contact other hosts, so keys cannot work there). It has no
structured-output mode, so the reply format is the zod schema rendered as
JSON Schema in the prompt, and the answer is validated with the same schema
before anything is applied. A fourth, `GeminiProvider`
(`editor/ai/geminiProvider.ts`), calls Google's Gemini REST API from the
browser with the user's own Gemini key (`x-goog-api-key` header, never in
the URL; same key handling as the Anthropic key, `editor/ai/apiKey.ts`), in
JSON mode with the same rendered schema in the prompt and the same
validation; the dialog lists the models the key can use (Flash first).
Order: claude.ai account, else Gemini when chosen, else the user's
Anthropic key, else the server. The prompt text is shared
(`core/ai/prompt.ts`).

**Speed** (`editor/ai/aiSettings.ts`, saved in this browser with the chosen
AI and Gemini model): `best` or `fast`, sent as `speed` in the request.
Fast means the same Claude model at effort `low` instead of `medium`
(`askClaude`), claude.ai's `quick` model tier for `sample`, and Gemini's
`thinkingLevel: low` (dropped and retried once if a model rejects it).
`editor/claudeViewer.ts` reaches the viewer's capabilities; Save uses its
`downloads` capability in a published page (pages cannot download by
themselves), and a normal browser download elsewhere. The single-page build
(`vite build --mode single-file`) inlines everything for hosting as one page.

### AI-drawn sprites
`draw_sprite` carries pixel art as data: a palette of one-character keys
(`.` transparent) and equal-length rows. `core/model/pixelArt.ts` checks it
(rows, palette, at most 64×64, and the same proportions as the object it is
for, within one pixel) and turns it into an SVG image asset (one rect per run
of equal pixels, crisp edges), which becomes the object's sprite through the
same path as the Sprites panel (`useDefinitionSprite`, size unchanged). The
AI context gives each target a `spriteGrid` (the object's proportions, long
side at most 32).

### Wiring switches on the canvas
- A selected entity with a Switch component shows two red connectors (left
  and right of its frame, the size of the corner boxes). Dragging one onto
  another entity adds a `controls` relationship with `action: "open"` (or
  selects the existing one) and selects it.
- Connections are always drawn (faint unless they concern the selection or
  the Logic card is open) and are clickable: a click near a line selects
  that relationship (`selectedConnectionId`, exclusive with selected
  entities). Its prompt has the AI context kind `connection` (the
  relationship plus both ends as targets), anchored on the line; the AI
  changes it with `update_relationship`. Delete removes it; Esc deselects.
- `controls` actions: open, close, toggle, disappear (switch on removes the
  target, off brings it back), move (on: glide by `offset` at `speed`, off:
  back; solids move with it). Sentences read "Switch moves Door 3 tiles up";
  the line label says what it does ("opens", "moves", "hides").

### Changes go where they belong
The system prompt tells the AI to put a behavior on the object it is about,
whatever is selected (a mushroom's "can be stomped" goes on the Mushroom
object, not the player), to say so first in its message, to ask when the
target is ambiguous, and to answer with instructions when the user must do
something first. The editor computes which objects/entities a change touched
(`touchedBy`): when that isn't the selection, the result shows the message and
"Changed: Mushroom (every copy, N in this level)", and the touched entities
glow on the level for two seconds.

Stomping is a component on the stomped thing (`Stompable`: stomper tags,
bounce, damage): landing on its top defeats it (or costs it health), the
stomper bounces off unhurt; side contact works as before. Event `stomped`.

### AI level drawing
- Operations `draw_tiles` (fill rectangles of the 32 px level grid with an
  object, one copy per cell, resting on the cell bottom, no duplicates; at most
  3000 cells per operation) and `erase_area` (clear a rectangle, optionally
  one object only; connections to removed things go with them), next to
  `place_instance` for single things. `LEVEL_CELL` in `placement.ts`.
- The level payload carries the grid, the occupied area in cells, and the
  player's reach (jump height and running-jump distance, in px and tiles), and
  the system prompt has level-design rules (playable: gaps and steps within
  reach, headroom, the hardest part last) and says to use or create the
  library objects the request names.
- Teleporters: relationship `teleports_to` (touching the source moves the
  toucher onto the target) and rule action `teleport`; on arrival, whatever
  the entity overlaps counts as already touched, so it doesn't bounce back.
  Event `teleported`.
- **Preview on the level**: a pending AI proposal is applied to a copy of the
  project (`store.aiPreview`) and the viewport draws that copy: new things
  with a pulsing outline, removed things as red ghosts; a large change is
  framed. Apply commits the same operations as one transaction; Cancel
  discards the copy.

### Viewport size
The viewport is measured synchronously when it mounts (and then by a
ResizeObserver). Before, the size was only known a frame later, so a click
right after returning from Play was mapped with a 1×1 view and missed (29 of
40 times in a reproduction); this was also the long-standing intermittent
end-to-end failure.

### Navigation input
`viewport/wheel.ts` (pure, unit-tested) tells trackpads from mice: fine-grained
or horizontal deltas are a trackpad and pan; a pinch arrives as Ctrl+wheel and
zooms (Safari's gesture events are handled too); Alt/Cmd+scroll zooms; coarse
whole-number steps are a mouse wheel and zoom by a moderate fixed step per notch
(the same with or without Alt, capped per event, scaled by the mouse-zoom-speed
setting); once a trackpad
gesture is seen, the next 400 ms keep panning so fast flicks don't turn into
zooms. Space+drag and middle-button drag pan.

### AI pipeline
```
prompt -> AIContext -> buildAIPayload (targets in full, others briefly, library)
       -> AIProvider (HTTP) -> server: system prompt (capabilities) + Claude, structured output
       -> AIResponse { kind, message, changes[], operations[] }
       -> apply (small/explicit) | preview -> Apply/Cancel | clarify | answer | unsupported
       -> applyOperations() inside one edit() = one transaction (all-or-nothing, undoable)
```
- The model never sees raw project JSON and never mutates state; it returns
  operations that go through the same validated mutation layer as the
  inspector. An invalid operation rejects the whole list.
- The capability description is generated from the component, relationship
  and event registries, and explicitly lists what is **not available yet**
  (behaviors, timers, level transitions, ...). The model is instructed to say so ("unsupported") or
  to preview only the possible part, rather than invent features.
- Instance vs definition is explicit in every operation (`target`), so "this
  robot" and "all robots" map to different changes.
- Conversational memory (last few exchanges per context) is sent for
  resolving "them"/"actually"; the project data is always the source of truth.
- The provider is an interface; the HTTP provider targets `/api/ai`, which the
  dev/preview server implements with Claude. Without credentials the endpoint
  answers with a clear "not connected" error, shown in the prompt.

### Transactions and undo/redo
Every accepted change is one `Transaction { label, source: user|ai, before,
after, changes[], operations[] }`. Projects are immutable values, so undo and
redo swap whole project versions: exact for every kind of change, cheap
(structural sharing), and independent of how the change was made. This is a
deliberate simplification of the "inverse operations" idea in the original
spec; the operation list is still stored for display and the AI history.
Rapid edits with the same coalesce key (dragging a color picker) merge into
one step. New/Open are undoable too, so no confirmation dialogs are needed.

### Editor state vs project state
The store holds the `project` (authoritative, saved) and separately the
editor-only state: active scene, selection, camera, grid/snap toggles,
console log. Editor-only state is never saved into the project. Play mode
(Phase 2) will create a separate runtime instance from the project and
discard it on stop.

### Project format
The logical format is a set of files, one per scene and per definition,
named by stable id so renames don't move files (diff-friendly):

```
project.json                 { formatVersion, id, name, settings, startSceneId,
                               scenes: [{id, name, file}], objects: [{id, name, file}], assets }
scenes/<sceneId>.json        Scene
objects/<definitionId>.json  ObjectDefinition
```

`projectToFiles` / `projectFromFiles` convert between the model and that
file map. In the browser the map is wrapped in one JSON bundle
(`*.pxlproj.json`) for download/open, and also autosaved to `localStorage`
on every change. A desktop shell or backend can write the same map to a
real folder without changes to the core.

Loading runs: index check (zod) -> assemble -> **migrate** -> structural
validation (zod) -> integrity check (unique ids, references resolve) ->
component check against the registry. Unknown component types and invalid
props are reported as **warnings** and kept, so data from newer or extended
versions is never silently destroyed.

### Versioning
`FORMAT_VERSION` (currently 4) is written to `project.json`. v2: assets and
backgrounds, tiles. v3: play tuning. v4: scenes get `relationships` and
`rules`; the starter Player gets Health, a Damage Receiver and an Inventory,
the Door becomes Openable, the Coin is kept as an item, and the Key and Switch
starters are added.
`migrateProject` applies registered `Migration { from, to, migrate }` steps
one version at a time, and refuses files from a newer editor.

## Testing

- `npm test`: unit tests for the registry, definition/instance resolution, every
  mutation, serialization round trips, error handling and migrations.
- `npm run test:e2e`: builds and serves the app and drives headless Chromium.
  It places objects by drag and drop, selects and drags in the viewport,
  edits fields (including a rejected value), checks that definition edits
  reach instances, marquee multi-selects, duplicates and deletes, edits world
  settings, saves to a file, reloads (autosave), creates a new project, and
  reopens the saved file. It fails on any page or console error.
- `npm run typecheck`, `npm run build`.

## Roadmap (from the product spec)

1. **Foundation**: done.
2. Runtime: **done** (game loop, arcade physics, collisions, running, jumping, ladders, camera follow, Play/Stop with runtime state separate from the project).
3. Graph: **done** (relationship model, event system with a log, rule system, graph queries, entity references; shown in the editor and available to the AI).
4. Commands: **done** (operations, transactions, undo/redo).
5. AI foundation: **done** (provider interface, context builder, capabilities, structured operations, preview/apply).
6–7. Contextual AI, world AI, multi-selection, AI object creation: **done** at the interaction level; limited by what the engine can express.
- Behaviors: **done** (ready-made components, plus behavior scripts the AI programs).
9. AI debugging: **done** (event log with reasons, play recording, problem checker, AI diagnosis with fixes to confirm, Debug tab).
8, 10. Design planning, asset generation (simple pixel-art sprites are done).
