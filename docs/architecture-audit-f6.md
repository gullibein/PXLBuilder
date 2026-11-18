# Architecture audit after F6

An audit of everything built in F1–F6, at commit `98cc3b1`. Nothing was changed for it: findings and recommendations only.

**Afterwards:** A1, A2 and A3 were addressed before V1. What changed is in `engine-architecture-proposal.md` §23. The findings below are as they were found.

**How it was done.** By reading the code and by running probes on the real engine: each representative game was built and asked for its profile, its compatibility report, its level builder and its reach; profiles and objects were then made to disagree, to see what the engine does and says. Findings marked **verified** were observed that way or read directly in the code. Findings marked **risk** are inferred and not demonstrated.

---

## Short answers

1. **Has F1–F6 achieved the goal?** Partly. Five systems are now genuinely controlled by the profile, with honest reports, and every game family is protected by tests that play it. But view, movement and abilities are only *written through* by the profile, not controlled by it, and they drift apart silently. And the variety the *modules* offer is still two movement models and two generators: the non-platformer games get their gameplay from scripts, not from the module architecture.
2. **Is it modular enough for substantially different games?** For adding a camera behaviour, a turn system, a progression model or a play-time generator: yes, each was proven with a plug-in in a test. For a new ability: it works, but touches about ten files. For a new movement model: it runs, but cannot describe its reach. For a second edit-time generator: the dispatch is ready, the request around it is not.
3. **Must anything be fixed before V1?** Yes, three small things: the profile/object drift for view, movement and abilities (A1), two bugs found in the audit (A2), and browser coverage of the progression move (A3).
4. **What should V1 focus on?** One registration per ability, done properly (T1), then ability patterns in breadth on top of it.
5. **What to avoid for now?** New movement models, a general generator request, one big registry for everything, a stepped time model, validators for board games, presets for every genre.
6. **Biggest long-term risks?** The roadmap is five platformer slices to one non-platformer slice; scripted gameplay is invisible to generation and validation; and the AI path that actually makes these games is only ever tested against a mock.

---

## 1. Profile-controlled systems

"Controls" below means: the runtime reads the profile and behaves differently because of it.

| System | Registered | Selectable | Controls the runtime? | Unsupported handled honestly? | Report agrees with runtime? |
|---|---|---|---|---|---|
| Geometry (box, one_way, ramp, cells) | Yes | Yes | **Yes** (`runtime.ts:667`) | Yes: ramps become walls, `dig` is refused | Yes, tested in play |
| Camera (follow, velocity_look_ahead, rooms) | Yes | Yes | **Yes** (`runtime.ts:668`) | Yes | Yes, tested in play |
| Generators at play (dungeon) | Yes | Yes | **Yes** (`runtime.ts:669`) | Yes: the recipe isn't built, said | Yes |
| Generators while editing (sections) | Yes | Yes | **Yes** (`levelGen/build.ts`) | Yes: no other builder steps in | Yes |
| Turn-taking (team_turns) | Yes | Yes | **Yes** (`runtime.ts:670`) | Yes: statements refused, objects named | Yes |
| Progression (stages) | Yes | Yes | **Yes** (`session.ts:75`) | Yes: a won level is followed by nothing | Yes |
| **View** (side, top, iso) | Yes | Yes | **No.** Changing it writes the levels' gravity; the runtime reads the level | **No** | **No** (A1) |
| **Movement model** (arcade, topdown) | Yes | Yes | **No.** Changing it writes the player's Character Controller; the runtime reads that | **No**: an unknown value silently runs as arcade | **No** (A1) |
| **Abilities** | Yes | Yes | **No.** Changing them adds or removes components; the runtime reads components | **No** | **No** (A1) |
| Time (realtime) | Yes | One value | Nothing reads it | n/a | A field with one value |
| Kits | Yes | Yes | Authoring only (a new game's objects, roles) | Yes (requirements checked) | Yes; correct that it isn't runtime |
| Theme, genre | Data | Yes | Authoring only (the sections builder) | Yes | Yes |
| Validators | Yes | Not by the profile: the generator names them, coverage adds the route bot | Used by the sections generator only | Yes (uncertain, never passed off) | Yes |
| Checkpoints | A component, not a profile system | n/a | Yes | n/a | n/a (right: it needs nothing from the profile) |

**Registered / selected / supported / active.** The four states are computed by one function (`engine/geometry.ts` `statusOf`) for geometry, camera, generators and turns. Two observations:

- **"Supported" means "its declared requirements are met by the rest of the profile". It does not mean "an implementation exists".** That an implementation exists is ensured by tests per system ("every camera behaviour declared is implemented"), not by the structure. Where one is missing the runtime skips it without a word: `cameraBehaviors.ts:179` ("ids with no behaviour are left out"), `turnSystem.ts:63`. Only progression says so in the report. Today nothing is in that state, so this is a risk, not a bug.
- **View, movement and abilities have no four states at all.** They are checked for compatibility as declarations (`checkProfile`) but never compared with the game.

---

## 2. Interfaces and modularity

| Interface | Real, or a wrapper? | Notes |
|---|---|---|
| Movement models and abilities (`runtime/movement`) | **Real.** A test's "glide" model and "boost" ability plug in | Selected by component values, not the profile (A1). The model sets velocity; integration and collision stay in `runtime.ts` (see C: V3) |
| Geometry (`runtime/geometry/world.ts`, `GeometryQuery`) | **Real owner** of the shape lists and queries | Bypassed in five places (B6). The physics step in `runtime.ts` composes the lists itself |
| Reach descriptions (`core/reach`) | **Real for abilities** (`registerReachAbility`), **closed for models** | `reachOf` hard-codes "platformer, else nothing" (`reach.ts:106–113`); double jump and ledge grab are hard-coded beside the registry (`reach.ts:21`, `:116`) |
| Validators (`core/validation`) | **Real**, with honest coverage | Used only by the sections generator. Hand-made levels go to the old checker directly (B3) |
| Camera behaviours | **Real** pipeline; a test's behaviour plugs in | Clean |
| Generators | **Real at the dispatch point** | The edit-time request is the sections generator's own (B9) |
| Turn-taking (`TurnSystem`) | **A thin adapter, honestly.** `team_turns` forwards ten calls to the turn kit (606 lines), which still owns turn state together with menus and the cursor | Enough for what exists. One bypass: the play screen reads `kit.turns` directly (`PlayView.tsx:312`) |
| Progression (`ProgressionModel`, `GameSession`) | **Real**; the screen only follows | One method (`next`). Right-sized |
| Checkpoints | No interface, and none needed | A component, a statement, an event |

**Is "no module points to old code" accurate?** Yes, as stated: no module carries `pointsTo` (asserted in `profile.test.ts`). But it is a narrower claim than it sounds. Logic that is still effectively outside the architecture:

| Where | What it is |
|---|---|
| `core/model/reachability.ts` (850 lines) | The original level checker. It has its own top-down branch, chosen by a heuristic. Wrapped as the `checker` validator, and also called directly |
| `core/model/topDown.ts` `isTopDownScene` (27 call sites) | A second answer to "which view is this level?", from gravity and the controller, used by the AI context, operations, the path builder and the checker. It never asks the profile |
| `runtime/behaviors.ts`, `crawl.ts` | Enemy movement (patrol, wander, follow, crawl): outside the movement interface, partly outside the geometry interface |
| `runtime/gameplay.ts` | Built-in reactions (goal, doors, switches, stomps, checkpoints), keyed on "has a controller" |
| `runtime.ts` (2,159 lines) | The physics step for every body |
| `settings.gameType` | The pre-profile "platformer or topdown" flag, still read in six files |

None of this is wrong to have. It is where the old shape of the engine still decides things.

**One registration, or several?** Each system has two or three parallel registries joined only by an id string: the module (for the profile check), a data table (for the runtime's light lookups) and the implementation. Plugging in a turn system takes three calls (`turnCapability.test.ts:271–273`); a camera behaviour likewise. And "what the profile provides" is computed twice: by naming convention for the runtime (`geometry.ts:58` `profileTags`) and from the modules for the report. They agree today because tests say so. See B1.

---

## 3. Do the systems work together?

| Combination | State | Evidence |
|---|---|---|
| Abilities with geometry | **Works.** Wall jump and ledge grab ask the geometry interface; abilities declare that they need the arcade model | `movement.test`, the Celeste-inspired room, "ramps, a wall shaft and a dash in one level" |
| Abilities with reach-aware generation | **Works**, and agrees with the runtime: both read the character's components | `reachAware.test` (15) |
| Reach validation with real movement | **Works**: estimated moves count only when the route bot wins on the real runtime | `validation.test`, the needs check |
| …but with the *profile* | **Disconnected.** The generator and runtime follow components; `profile.movement.abilities` can say something else | A1, verified |
| Camera with views and generated levels | **Works** side and top; refused honestly at an angle | `cameraBehaviors.test`, `zones.test` |
| Generated zones with rooms | **Works** | `zones.test` (6) |
| Turns with real time and scripts | **Works** | `turnCapability.test` |
| Checkpoints with death, restart, visits, progression | **Works**, except after `flip_level` | `checkpoints.test`; A2 |
| Geometry "supported" with levels of another view | **Inconsistent.** Support is computed for the whole game from `profile.view`; a level can have its own gravity | A1, verified (H5 below) |
| Different generators with different gameplay | **Thin.** There are two generators, one per family. The dungeon generator declares no requirements (`generators.ts:36`), so a side-view game may select it | Risk, not demonstrated in play |

---

## 4. General-purpose game support

What each representative game actually is, from the probe:

| Game | Built on | Its profile says | Player movement | Gameplay comes from | Engine can generate levels? | Validation | Regression test plays it? |
|---|---|---|---|---|---|---|---|
| Traditional platformer | `classic-platformer` preset | side, arcade, sections | Arcade model | Engine + objects | **Yes** | Checker, route solver, route bot | Yes: a generated level won by the bot; stomp; ? block |
| Puzzle platformer | `puzzle-platformer` preset | side, arcade, sections (puzzle) | Arcade model | Engine + objects | **Yes** | As above, plus "is the puzzle needed" | Yes: sweeps, solved routes |
| Tetris | Top-down preset | **top, topdown, follow camera** | **None: no controller at all** | One script (`fits`, `move_group`, `turn_group`, `count_in`) | No | None applies, none is chosen | Yes: moves, walls, lock, a row clears, the rest drops |
| Dr. Mario | Top-down preset | as Tetris | None | One script | No | None | Yes: steering, four in a column clear |
| Space shooter | Top-down preset | top, topdown | Top-down model | Shooter component, scripts | No | Top-down flood fill | Yes: firing, hits, enemies fire back |
| Mining | **Platformer preset** | side, arcade, **sections builder active** | Arcade model | `dig`, scripts (cargo, fuel) | **Offered, but it would build a platformer level** | Jump checker | Yes: digging, ore, fuel, rock |
| Boulder Dash | Top-down preset | top, topdown | Top-down model, stepped by scripts | Scripts (boulders fall by script) | No | Top-down flood fill | Yes: dig, boulder falls, diamond |
| RPG | `rpg` preset | top, topdown, team_turns | Top-down model | Ready-made scripts, the turn kit | No (the dungeon generator can be added) | Top-down flood fill | Yes: map, battle, visit and back |
| Tactics | Top-down preset or RPG kit | top, topdown, team_turns | **None** | Ready-made scripts, the turn kit | No | None | Yes: a full round, both profiles |
| Roguelike | `roguelike` preset | top, topdown, dungeon | Top-down model, stepped by scripts | Scripts, the dungeon generator | **Yes, at play** | The generator's own connectivity | Yes |
| Momentum platformer | — | — | — | — | — | — | **No. A to-do (V3). Not implemented, not passing** |

**The honest reading:**

- **All of these can be edited and played, and the tests play them for real.** That part of the goal holds, and F1–F6 did not regress any of it.
- **The engine generates levels for two families:** sectioned platformers, and top-down dungeons at play. For everything else "generated" means the AI writes objects and scripts.
- **What makes Tetris, Dr. Mario, mining, Boulder Dash and the shooter different games is the script language, a few components and the `cells` geometry.** The module architecture neither helps nor hinders them much. They are "a top-down (or platformer) profile, plus scripts".
- **The profile cannot describe them.** It has no way to say "no avatar" or "movement is scripted": Tetris is recorded as a top-down walker with a follow camera. Harmless at runtime (unused modules do nothing), but it is not a description of the game, and the AI is shown it.
- **A game built on the platformer preset keeps the platformer level builder.** In the mining game, New level would build a classic platformer level (B5).
- **Validation is appropriate where it exists and absent elsewhere.** Nothing is falsely validated. But nothing judges a board, a shooter or a mining field at all.

---

## 5. Generation and validation

| Can a generator… | Sections (platformer) | Dungeon (top-down) |
|---|---|---|
| Understand the gameplay model? | Only its own: it requires side view, a jump table and platformer roles | Only its own; declares no requirements |
| Understand the player's abilities? | **Yes**: capabilities with numbers, from the reach description | No (nothing to ask: top-down has no reach) |
| Build levels that need an ability? | **Yes**, and proves it: no route without the ability | n/a |
| Account for geometry and mechanics? | Yes for its own (ramps, one-way, ladders, water, crates, plates, keys) | Rooms, corridors, a locked door and key |
| Be validated by the right validator? | Yes: chosen from what the level's mechanics need and what the reach covers | Its own flood fill; no validators |
| Report uncertainty honestly? | **Yes.** Unconfirmed is "uncertain", never "validated"; tested with a stuck bot, no bot, and an ability the bot can't play | It reports what didn't fit |

**Is it ready for more ability types?** Mostly. The reach registry, capability-gated patterns and the needs check will take more abilities without redesign. The cost is the number of places an ability lives. For `dash` (verified by search): the runtime ability, its component, the engine module, the inference table, the reach registration, the move rule, the route-bot step, its pattern, the mechanics list, and the closed `Move` type in the solver and the bot. Double jump and ledge grab predate the registry and are hard-coded beside it. So T1 is wider than "the bot step": it is the main thing V1 should fix.

**Is it ready for more generator types?** At play: yes (a test's generator plugs in). While editing: the profile dispatch is ready, but the request is the sections generator's own: `levelGen/build.ts` computes a platformer blueprint (structure, difficulty, mechanics), and `GeneratorModule.build` takes and returns the level builder's types. A second edit-time generator would need that generalised. That should wait until one exists.

**What is missing for generality, by design:** top-down and grid games have no reach description and no solver (the route solver assumes gravity). That is V2.

---

## 6. Regression protection

**Strong:**
- 9 game goldens, 17 movement traces, 18 camera goldens, 9 dungeon goldens, 14 validation snapshots and 2 sweeps, 6 turn goldens, 3 session goldens. All are frame-by-frame traces of the real runtime.
- The game tests assert mechanics before fingerprints (a row clears, a boulder falls), so they fail meaningfully.
- Profile gating is tested in play, not just in the report.

**Gaps:**

| Gap | Why it matters | Verified? |
|---|---|---|
| The AI is always a mock in the browser tests | The path that actually makes a Tetris or a shooter (guidance → operations → a playable game) is never run. The board and action games in the suite are hand-written "as the guide makes them" | Verified |
| Boards, mining, Boulder Dash and tactics are never played in a browser | Keyboard events → script key handlers, and drawing spawned groups, are only covered headless | Verified |
| Progression in the browser covers a won level, a visit, the way back and R | Not `go_to_level`, not `restart_game`, not "You finished the game!", not music across levels | Verified |
| An exported game is played, but never across a level change | The F6c move had no pre-change golden; the export is the product users ship | Verified |
| Profile/object drift has no test at all | A1 went unnoticed for six stages | Verified |
| Consistency tests stand in for structure | "Every X declared is implemented" passes as long as the tables agree; it does not show the selected implementation changes play. (The per-system play tests do; these don't add to them) | Verified |

**Could the suite pass while a game type is unplayable?** For the headless mechanics: no, the goldens would move. In the browser: yes for boards, mining, Boulder Dash and tactics, since none is played there. Through the AI: yes for every scripted game type.

---

## 7. Findings

### A. Fix before V1

**A1. View, movement and abilities are not controlled by the profile, and drift from it silently.** *Verified.*

- **What.** For these three the profile is applied once, by writing into the game (`profile.ts:165` `applyMovement`; `:262` sets the levels' gravity). After that the runtime reads the character's components and the level's settings (`movement/index.ts:36–48`), never the profile. Any later edit, by hand or by the AI's ordinary operations, leaves the stored profile wrong, and the compatibility report still says "ok".
- **Probes** (platformer preset, then one change each):

  | Change | Stored profile still says | What runs | Report |
  |---|---|---|---|
  | H1: `set_component_field` movement → topdown, `set_world` gravity 0 | side, arcade, sections builder "classic" | A top-down walker | ok |
  | H2: `add_component` Dash | abilities: none | The player dashes | ok |
  | H2c: profile has dash, `remove_component` Dash | abilities: dash | No dash | ok |
  | H3: movement set to an unknown value | arcade | Arcade, silently (`movement/index.ts:36`) | ok |
  | H5: one level's gravity set to 0 | side | That level is top-down; ramps there still count as "supported" | ok |
  | H6: profile view set to `iso` | iso | **Not isometric**: only gravity is written, `world.view` is not | ok |

- **Why it matters.** This is exactly "configurable in the profile but not controlling". It breaks the rule held everywhere else that the report and the runtime agree. V1 is about abilities, so it would build on the weakest part of the profile.
- **Affects.** Every game with a stored profile; the AI (it is shown the profile); the level builder's availability (H1).
- **Seriousness.** High for the architecture's honesty; low for today's players (the game itself plays as its objects say).
- **Recommendation.** Do not gate movement by the profile at runtime: per-character components are the right source of truth (two characters may move differently, and the components carry the settings). Instead make the profile true:
  1. **Abilities and the movement model: derive, or keep in step.** Either compute `movement` from the player objects when the profile is read, or update the stored profile whenever those components change, as F6c does for turn scripts (`selectTurnsFor`). Deriving is simpler and cannot drift.
  2. **View: say per level.** Keep `profile.view` as the game's default, and have the report name any level whose gravity or view differs. Compute geometry and camera support per level where the level differs.
  3. **Report what remains.** An unknown movement value, and a player whose model the profile doesn't list, become notes, like `cells`.
  4. A format migration for stored profiles that already drifted.
- **Size.** Small. About the size of the F3 follow-up.

**A2. Two bugs found by the audit.** *Verified.*

| Bug | Where | Fix |
|---|---|---|
| Setting the profile's view to `iso` does not make levels isometric (H6) | `profile.ts:262` | Set `world.view` with the gravity, or refuse the change |
| A checkpoint with `keepOnRestart`, reached after `flip_level`, restarts the player at the mirrored place (player at −256, flag at +256 in the probe) | `runtime.ts:648`, `:726`: the kept place is a position | Keep the checkpoint's id and take its place after the level is rebuilt; script-set places stay positions |

Both are small. The second is mine, from F6c.

**A3. Close the progression coverage gap.** *Verified gap.*

- **What.** F6c moved level changes out of the play screen without a pre-change golden. Browser coverage is partial, and an exported game is never played across a level change.
- **Recommendation.** One browser scenario: export a two-level game, open it, win level 1, see level 2, finish it ("You finished the game!"). In the editor's play add `go_to_level` and `restart_game`. Tests only.
- **Size.** Small.

### B. Recommended during V1 (not blocking)

| # | Finding | Where | Why it matters | Recommendation |
|---|---|---|---|---|
| B1 | **Two or three registries per system, joined by id.** Missing implementations are skipped silently; "provided" tags are computed twice | `engine/modules.ts`, the tables in `engine/*.ts`, `cameraBehaviors.ts:170–181`, `turnSystem.ts:54–66`, `geometry.ts:58` | Each new system multiplies the places to keep in step; today only tests hold them together | One `register…({declaration, implementation})` per system that fills all of them. **Do it for abilities in V1** (that is T1) and adopt the pattern when another system is next touched. No big-bang unification |
| B2 | **An ability lives in about ten places**; double jump and ledge grab bypass the reach registry; the `Move` type is a closed list | `reach.ts:21`, `:116`; `solver.ts:35`; `routeBot.ts:30` | V1 adds abilities | V1's first task (T1) |
| B3 | **Hand-made levels are judged by the old checker directly**; the validator registry serves only the sections generator | `validation/levelProblems.ts:24`, `model/reachability.ts:170`, `:496` | Two validation paths with different rules | T4, when hand-drawn levels get a cell grid |
| B4 | **"Which view is this level?" has five answers**: `profile.view`, the level's gravity, `world.view`, the controller's movement, `isTopDownScene` (27 sites), plus `gameType` | `model/topDown.ts` and its callers | The root of A1's view half | With A1: one function that answers it, used everywhere |
| B5 | **The profile cannot describe a game without an avatar**, and a non-platformer built on the platformer preset keeps the sections builder | `profileSchema.ts` (`movement.model` required), `presets.ts` | The AI is shown a wrong description; New level would build a platformer in a mining game | Falls out of A1 if movement is derived (no controller → none). For the builder: clear it when the AI builds a non-platformer on that preset, or say in the menu what it builds. No new presets needed |
| B6 | **Five direct reads of the solid list** | `behaviors.ts:96`, `:113`, `:315`; `scripts.ts:139`, `:1188` | Harmless now; wrong once ground can curve | With V3 |
| B7 | **The play screen reads the kit's turn state directly** | `PlayView.tsx:312` | A second turn system would not switch the key hints | One line, when a second turn system exists |
| B8 | **Geometry and camera notes look at objects' definitions only**, and find script use by text search | `geometry.ts` `geometryUsed`, `camera.ts` `cameraUsed` | A placed copy with its own override or script is missed (turn notes do look at copies) | Look at placed copies too, when next in that file |
| B9 | **The edit-time generator request is the sections generator's**; the dungeon generator declares no view requirement | `levelGen/build.ts`, `modules.ts` `GeneratorRequest`, `generators.ts:36` | A second edit-time generator can't reuse it; a side-view game may select dungeons | Give `dungeon` its real requirement now (one line). Generalise the request only when a second edit-time generator is built |
| B10 | **No browser play for boards, mining, Boulder Dash, tactics; the AI is never live** | `scripts/e2e-smoke.mjs` | See §6 | One short browser play per family (the mocked AI can return the regression fixtures). A live-AI check is a separate, manual or scheduled thing, not for every run |

### C. Correctly deferred

| Item | Slice | Note from the audit |
|---|---|---|
| T1: one registration per ability | **V1** | Wider than recorded (B2) |
| T2: checker and bot on shared interfaces | V1 / with T4 | Unchanged |
| T4: a cell grid for hand-drawn levels | After V1 | B3 depends on it |
| Grid movement model; reach and a solver for top-down; a stepped time model if needed | V2 | `reachOf` must then open to models by registration (today: "platformer, else nothing") |
| Momentum, curved ground, the momentum platformer | V3 | The model interface sets velocity only: a momentum model needs to own integration along a surface, and `MovementHost` doesn't expose `probe`. B6 goes with it. **Still a to-do, never counted as passing** |
| Fixed-arc jumps, spawners | V4 | — |
| Bosses, arenas with doors, stage select | V5 | A second progression model |
| Worlds, ability gates, state across rooms | V6 | Checkpoints are per level today |
| Geometry items | §18.4 | Unchanged |

### D. Working well: keep

- **The four-state rule where it is applied.** Geometry, camera, generators and turns: selected-but-unsupported is said, and the runtime does exactly what the report says. This is the best idea in the architecture; A1 is about extending it, not replacing it.
- **Honest validation.** Coverage decides what judges a level; estimates count only when the bot wins on the real runtime; unconfirmed is "uncertain". The bot's budget is in seconds of play, so results are reproducible.
- **The needs check.** A level "needing" an ability is proven by finding no route without it.
- **Goldens before every refactor, across genres,** and game tests that assert mechanics first. They caught a real regression in F6c.
- **Scripts, components and `cells` as the engine's generality.** This is what makes Tetris and Boulder Dash possible. It should not be replaced by per-genre engine modes.
- **The headless game session.** Whole games are now testable without a screen.
- **The camera pipeline.** Small, ordered, and view-neutral.
- **Light data tables** for what the runtime and the exported player must look up.
- **Right-sized interfaces:** progression is one method; checkpoints are a component. Neither should grow until something needs it.
- **Topics for AI guidance,** which kept the per-request instructions inside their budget through six stages.

---

## 8. Recommendation

**Before V1 (small, one short stage):** A1, A2, A3, plus the one-line requirement for the dungeon generator (B9).

**V1:** start with T1 as a real single registration for an ability (runtime behaviour, component, module, reach move, bot step, required patterns), moving the four existing abilities onto it, double jump and ledge grab included. Then ability patterns in breadth. B10's browser plays can ride along.

**Deliberately not yet:**
- New movement models (V2, V3).
- A general generator request (wait for a second edit-time generator).
- Merging all registries at once (do it system by system, as each is touched).
- A stepped time model.
- Validators for boards and shooters.
- A preset per genre.
- Gating movement by the profile at runtime.

**The three risks to generality:**
1. **The roadmap leans platformer.** V1, V3, V4, V5 and V6 are platformer slices; only V2 is not. The other families are protected from regression but are not being advanced. Each slice should name what it gives a non-platformer family, or say plainly that it gives nothing.
2. **Scripted gameplay is invisible to the engine.** A Tetris board or a mining field cannot be generated, validated or even described by the profile, because the engine sees only "a script". That is acceptable while the AI writes those games, but then the AI path is the product, and it is the one path with no automated test.
3. **Agreement by test instead of by structure.** The registries, the two "provided" computations and the five answers to "which view" all agree because tests say so. Each new system adds more of that unless B1 and B4 are followed as systems are touched.
