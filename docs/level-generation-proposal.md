# Engine-built platformer levels — Stage 0 architecture proposal

Status: approved with the changes in §11. Stage 1 done (see §12).
Written against branch `claude/trusting-carson-2kvonz` at commit `7e967ee`.

---

## 0. Short answer: will it work?

Yes, the core idea fits this codebase. Parts of it already exist here in small form:

- `build_path` builds a level from a route and checks every jump before placing anything.
- `generateDungeon` builds roguelike levels from a seed.
- `make_autotile` and the ready-made scripts let the engine write what the AI would otherwise spell out.

The plan's principles match how the app is already built: the game graph stays the only level representation, operations are validated, and a change is one undo step.

I recommend six changes to the plan:

1. **Be clear about where the savings come from.** In your two failed builds, the output was almost all drawings. At 234 s the answer had about a dozen sprites and no level yet. A level written with `draw_map` is about 500–1,500 characters, so a blueprint won't make the level part of an answer much shorter. The real savings are:
   - **Levels with no AI call at all.** "Two more levels", "another level like this" and "regenerate" become instant and free.
   - **No repair round trips.** Today every "the level doesn't work" or "puzzles missing" follow-up re-sends the whole prompt (about 175,000 characters, roughly 45,000 tokens) and takes 1–4 minutes. A level that is valid by construction removes those.
   - **A smaller prompt.** The level guidance alone is 20,782 characters (`LEVELS_GUIDE`), plus the design idea in the context. Most of it explains how to build levels, which the engine would then know.
   - **Less thinking time.** The AI picks a concept, not geometry.
2. **Start with two genres, not nine.** The classic and puzzle platformers can be built from objects the engine already has. Several of the others need mechanics the engine doesn't have (wall jump, dash, loops, ropes, momentum physics; see §9). Building generators for them now would produce levels that can't be played as their genre.
3. **Let the engine choose patterns by default.** The AI's blueprint can be as small as `{genre, difficulty, concept}`. Section-by-section control stays available but optional. That is cheaper and gives more variety: the engine remembers history exactly, while a model picks the same "safe" choices again and again (this is why `levelIdeas.ts` exists).
4. **One construction method first: a cell grid, written out with the existing `draw_map`.** `build_path` stays for routes the AI describes, and its jump limits are reused. Room graphs come later.
5. **Fix one bug before anything else.** `levelDesignIdea()` picks a platformer style at random on every request (`const gameStyle = pick(PLATFORMER_STYLES)`), so a game's "kind" can change from level to level. Storing the profile (§1.2) fixes that even before any generator exists.
6. **No registry of empty generator stubs.** Add a generator to the registry when it is real.

---

## 1. Existing systems to reuse

| Need | Existing piece | How it's used |
|---|---|---|
| Single source of truth | `Project` → `Scene.entities / relationships / rules` (`core/types.ts`) | The generator's output is ordinary entities, relationships and rules. Nothing parallel. |
| Writing a level | `draw_map` (`commands/operations.ts`): legend + rows, multi-cell objects, `clear`, row repair | The generator writes one `draw_map` per level. Its multi-cell handling (doors, two-wide pipes), clearing and settling are reused as they are. |
| Extra pieces | `place_instance`, `add_component` (MovingPlatform with `points`/`offset`/`loop`), `create_relationship` (teleports_to, controls/opens, requires), rules (collect-all → complete_level) | Movers, teleporter pairs, switch→door, key→door and win rules are emitted as these operations. |
| Jump limits | `characterReach` (`model/reach.ts`), `jumpDistance` and `jumpTable` (`model/reachability.ts`), `pathLimits` with `SAFE = 0.85` (`commands/buildPath.ts`) | Every gap, rise and spike run is sized from the player's real jump, double jump, spring and crate numbers. |
| Validation | `levelReachability`, `reachabilityProblems`, `layoutProblems` (riders, starts), `winProblems`, `startConflicts` | Run on the draft after it is built. Nothing is committed unless it passes. |
| Seeded randomness | `seededRandom(seed)` (`model/dungeon.ts`) | Moved to a shared module and reused unchanged, so dungeon seeds still give the same dungeons. |
| Variety signals | `levelShape`, `levelStats`, `statsLine` (`ai/levelIdeas.ts`) | Kept as the coarse fingerprint for levels not made by the generator (hand-built, older AI levels). |
| Ready-made behaviour | `READY_SCRIPTS` (Walker, Stomp, Spring, Question block, Brick block…), `makeAutotile`, `rampsLikeGround` | Patterns attach ready scripts by name. The look stays the theme's job. |
| One undo step | `applyAIOperations` → `edit(...)` with immer drafts | The generator runs inside one `applyOperations` call, so one transaction. A failed attempt is a thrown error in the draft, which leaves the project untouched. |
| AI follow-ups | `runPrompt.ts` (playability, missingPuzzles, patch) | Not needed for generated levels. The checks run inside the engine, so these round trips go away. |

**Not reused:** `Scene.generator` (the dungeon recipe). It means "build a new layout every time the level is *played*". A generated platformer level is built once, in the editor, and then edited like any other level. A "different level every play" mode could reuse that idea later, but it shouldn't share the field.

---

## 2. New modules

Everything new lives under `src/core/levelGen/`. It is pure functions with no editor or React imports, like the rest of `core/`.

```
src/core/levelGen/
  types.ts         Blueprint, Pattern, Section, Plan, Fingerprint, Roles
  random.ts        seededRandom moved here (dungeon.ts re-exports it), plus helpers: pick, weighted, shuffle, int(lo, hi)
  roles.ts         which library object plays which role (ground, ledge, one-way, hazard, enemy, coin, crate,
                   spring, ladder, door, key, switch, teleporter, goal, mover, block, pipe)
  grid.ts          the cell grid a level is built in (chars + side lists of movers, links, rules), stitching
                   sections, writing it out as draw_map / place_instance / relationship operations
  limits.ts        the player's numbers in cells (from jumpTable / pathLimits), with margins by difficulty
  compose.ts       a genre's section grammar → a sequence of (role, pattern, variant), weighted by history
  fingerprint.ts   fingerprint of a plan, and of an existing scene (via levelStats/levelShape); similarity
  validate.ts      reachability + win + layout + puzzle-order checks on a draft; which section failed
  generate.ts      blueprint → candidates → validated plan → operations (the entry point)
  genres/
    classic.ts     section grammar, pattern weights and difficulty curve for the classic platformer
    puzzle.ts      (stage 8)
  patterns/
    common.ts      flat run, start pad, goal pad, coin trail, checkpoint
    classic.ts     gap, wide gap, stairs up/down, floating sequence, enemy encounter (variants), pipe run,
                   block row (? / bricks), moving-platform crossing, spring ledge, bonus route above, gauntlet
    puzzle.ts      (stage 8) key and door, switch and door, crate step, crate stack, teleporter shortcut,
                   hidden ladder, multi-stage
```

About 1,500–2,500 lines for stages 1–7, plus tests.

---

## 3. Existing files that change

| File | Change |
|---|---|
| `core/types.ts` | `ProjectSettings.levelProfile?: { genre: string; theme: string; version: 1 }`. `Scene.madeBy?: { generator: string; seed: number; blueprint: Blueprint; fingerprint: Fingerprint }`, which records how a level was made. The entities stay the truth: edit a generated level by hand and it is simply a level. |
| `core/serialization/schema.ts` | Accept both new optional fields. |
| `core/serialization/version.ts`, `migrations.ts` | Probably no migration: both fields are optional and missing means "not chosen / not generated". I'd still bump `FORMAT_VERSION` to 14 with a no-op migration, so an older build opening a newer save warns. Add a round-trip test with and without the fields. |
| `core/commands/operations.ts` | New `generate_level` operation (schema below). Its `case` calls `levelGen/generate.ts` and applies the resulting operations through `applyOne`, inside the same draft. New `set_level_profile` operation. |
| `core/ai/levelIdeas.ts` | `PLATFORMER_STYLES` is split. Gameplay rules become genres (in `levelGen/genres`). Looks become themes (a short list of looks: forest, desert, snow, cave, castle, temple, factory, haunted house, space station). `levelDesignIdea()` reads the stored profile instead of picking at random. |
| `core/ai/context.ts` | Sends the profile, the genre's pattern names (one line each, only that genre's), and the compact history (fingerprint summaries). Drops the design idea for games that use the generator. |
| `core/ai/guideSections.ts`, `topics.ts` | A short "levels by blueprint" section replaces most of `LEVELS_GUIDE` for games with a profile. The full guide stays for hand-built requests ("add a pit here"). |
| `core/ai/prompt.ts` / `protocol.ts` | Nothing special: the new operation joins `operationSchema`, so it is validated like every other one. |
| `editor/ai/runPrompt.ts` | Skip `missingPuzzles` and `playability` for `generate_level` (already checked). Part 2 of a new game asks for blueprints instead of maps. "Two more levels" builds without the AI when the game has a profile (zero tokens), with the AI optional for a concept. |
| `editor/chrome/MoreLevels.tsx` + a level menu | "New level" / "Regenerate this level" / "Another variation" buttons that call the generator directly. No AI. |
| `core/commands/buildPath.ts` | `pathLimits` moves to `levelGen/limits.ts` (re-exported), so both use the same margins. |

---

## 4. Blueprint schema

The smallest useful form is three fields. Everything else is optional.

```ts
// generate_level operation (zod, in operationSchema)
{
  op: 'generate_level',
  sceneId: string,                 // the level to build into (cleared), or a create_level ref
  genre: 'classic' | 'puzzle' | null,   // null: the game's profile
  theme: string | null,            // null: the game's profile (looks only)
  difficulty: number,              // 1–5
  length: 'short' | 'medium' | 'long' | null,   // short ≈ 1 screen, medium ≈ 2, long ≈ 3–4
  seed: number | null,             // null: the engine picks one (stored in Scene.madeBy)
  concept: string | null,          // one line, kept as the level's description; not interpreted
  sections: {                      // optional: the AI's say over the order
    role: 'intro' | 'teach' | 'test' | 'twist' | 'rest' | 'bonus' | 'finale',
    pattern: string | null,        // a pattern id of this genre, or null for the engine's pick
    harder: boolean | null,        // one step up from the level's difficulty
    with: string[] | null          // mechanics to feature: "moving platform", "spring", "enemy"
  }[] | null,
  routes: 'one' | 'choice' | 'bonus_above' | 'bonus_below' | null,
  keep: string[] | null            // patterns not to use (the user: "no spikes")
}
```

A whole new game's level part then looks like this:

```json
{"op":"generate_level","sceneId":"scn_1","genre":null,"theme":null,"difficulty":2,"length":"medium","seed":null,
 "concept":"Forest that slowly introduces moving platforms","sections":null,"routes":"bonus_above","keep":null}
```

That is about 250 characters, against 1–3 KB for a map with its follow-ups.

`set_level_profile {genre, theme}` sets the game's profile. The AI sends it once, in part 1 of a new game.

---

## 5. How it connects to the operation system

```
AI answer ──zod──▶ generate_level ──▶ levelGen.generate(project draft, op, registry)
                                         │  roles ← library (no object? use the starter's, or drop the pattern)
                                         │  limits ← player's jump table
                                         │  plan ← compose(genre, difficulty, history, sections?)
                                         │  for k in 0..N: build grid → write ops → apply to a scratch draft
                                         │                 → validate → ok? stop : vary the failed section
                                         ▼
                              [draw_map, place_instance…, create_relationship…, add_rule…]
                                         │  applied by applyOne in the *same* draft
                                         ▼
                              one edit() transaction → one Undo step; Scene.madeBy written
```

- **No new pipeline.** It is one more operation. Other operations can run in the same answer: `create_level`, then `generate_level` on its ref, then `place_instance` for a sign.
- **Attempts are tried on a scratch copy** (`produce`), so a failed attempt never touches the project. Only the winning operations go into the real draft.
- **If nothing valid can be built** within N attempts, the operation throws a `ModelError` naming the reason (for example "the player's jump is too low for difficulty 5 gaps"). That goes through the existing "didn't check out" path.
- **No AI needed:** the editor buttons call the same function with the profile and an engine-chosen seed.

---

## 6. How patterns are built

A pattern is a function, not a description:

```ts
interface Pattern {
  id: string;                       // 'gap', 'enemy_encounter', 'moving_crossing'…
  genres: string[];
  needs: Role[];                    // ['ground', 'enemy']; patterns whose roles can't be filled are skipped
  difficulty: [number, number];
  variants: string[];               // structurally different builds: 'flat', 'guarded_gap', 'pincer', 'on_mover'…
  width: (lim: Limits, d: number) => [number, number];   // cells
  build(g: SectionGrid, ctx: BuildCtx): Joint;           // draws into its slice of the grid
}
interface BuildCtx { rnd: Random; lim: Limits; difficulty: number; variant: string; entry: Joint; roles: Roles }
interface Joint { row: number; side: 'floor' | 'air'; }  // where the route enters and leaves (floor height)
```

- **Building:** each section gets a slice of columns and an entry joint (floor height). It writes characters for ground, ledges, hazards, enemies and coins, and adds movers, links and rules to side lists. It returns its exit joint, and the next section starts there. Heights are relative, so a section can climb or descend.
- **Sizes come from the player's own numbers:**
  - a gap's width is `lim.gap(rise) − margin(difficulty)`;
  - a stair step is at most `lim.maxRise` rows;
  - a spring ledge sits at `springRows`;
  - spike runs are at most `spikeCells`.

  Change the player's jump and every pattern changes with it (test 4).
- **Structural variants are separate code paths in one pattern.** For example, `enemy_encounter` has `flat` (a walker on a long floor), `guarded_gap` (a walker on the landing), `pincer` (two from both sides), `above_mover` (enemy on a ledge over a moving-platform crossing) and `in_pit` (an enemy patrolling a dip).
- **Composition:** each genre has a small grammar. Classic is `intro → teach(m) → test(m) → rest? → twist(m, m2) → bonus? → finale`. Mechanics are introduced before they are combined. The grammar is weighted by history (§7). Within a role, patterns and variants are picked by weighted random from the seed.
- **The level is then written out as ordinary objects:**
  - one `draw_map` for ground, ledges, hazards, enemies, coins and blocks;
  - `place_instance` and `add_component` for movers;
  - `create_relationship` for teleporters, switches and keys;
  - the win rule.

  Ground gets autotiled because it is the game's ground object.

---

## 7. Uniqueness and history

**Fingerprint** (stored in `Scene.madeBy`, derived for other levels):

```ts
{
  genre, length, difficulty,
  sections: ['intro:flat', 'teach:gap/plain', 'test:enemy/guarded_gap', 'twist:mover/over_spikes', 'finale:gauntlet'],
  profile: number[8],      // floor height per eighth of the level (up/down shape)
  route: 'one' | 'choice' | 'bonus_above' | …,
  counts: { gaps, enemies, hazards, movers, springs, secrets, coins },
}
```

**Similarity** between two levels is a weighted sum. Proposed starting weights, to be tuned:
- 0.35 for the section sequence (edit distance on pattern ids, half credit for the same pattern with another variant);
- 0.20 for the set of pattern pairs that meet (the combinations);
- 0.20 for the height profile (correlation);
- 0.10 for the route kind;
- 0.15 for the counts (normalised).

**Use:** the generator builds a handful of candidate plans (cheap, plans only, no geometry), scores each against every level in the game, and builds the least similar one that respects the grammar. Repeating a pattern is fine; repeating its neighbours, its variant and its place in the level is what gets penalised. A different seed alone counts for nothing.

**Older levels** get a coarse fingerprint from `levelStats` and `levelShape`, so they count too.

**The ten-level test** (§10) asserts that no two of ten levels score above a similarity threshold, and that across the ten at least M patterns and K variants were used.

---

## 8. Validation

Validation happens in layers, cheapest first. Every check runs on the scratch draft.

1. **By construction.** Sizes come from the jump table with margins, so jumps are within reach. Every section leaves at least two free rows of headroom over its route (already a rule in the guide, enforced here).
2. **Static checks that already exist:**
   - `levelReachability` (everything needed reachable, with the jump arcs, ladders, springs, pools and ceilings this checker has learned);
   - `winProblems` (a goal or win rule, keys that open something);
   - `layoutProblems` (riders not crushed into hazards, start on safe ground);
   - `startConflicts`.
3. **A new puzzle-order check** (`validate.ts`). It walks the level's states (which keys are held, which switches are on) to make sure the goal can be reached in some order, and that a key is reachable before the door that needs it. The existing reachability runs once per state, with doors open or closed. This is small for the two or three gates a level has.
4. **Optional replay check (later).** A scripted run on the real runtime for the main route only: run and jump inputs from the plan. This catches what the static checker can't model (headroom mid-jump, moving-solid timing). It is slower, so it would be used only in tests at first.

**When "uncertain" counts as a failure.** The reachability checker returns `uncertain` for levels with moving solids or scripted movement. For generated levels, "uncertain" is treated as not proven. Patterns with movers are built so the static check still covers them: the route is validated with the mover replaced by a static ledge at each end of its path, and the ride is checked against the mover's path (as `layoutProblems` already does).

**Repair.** The validator says which section failed, mapped from the failing entity ids back to sections. The generator re-rolls that section's variant or parameters first, then its pattern, then (rarely) the whole plan. It stops after N attempts with a clear error.

---

## 9. Technical limits and engine work needed

| Genre | What the engine has | What's missing |
|---|---|---|
| Classic (Mario-like) | Everything: walkers, stomp, ? blocks, bricks, pipes, springs, movers, one-way platforms, coins, hearts | Pipes as warps (a teleporter with a pipe look works today). Power-ups that change size. |
| Puzzle | Crates, switches, doors, keys, teleporters, hidden ladders, relationships, rules, inventory | Pressure plates (a switch that stays on only while pressed; doable with a script, but no ready one yet). |
| Lode Runner | Ladders, gold (coins), enemies | Ropes/bars to hang along; digging holes that refill (a "dig" exists only as a test stub); chaser AI on ladders |
| Donkey Kong | Ladders, staggered platforms, ramps | Rolling barrels down slopes and ladders (a hazard with a path and gravity; a script could do it); a timer-driven spawner exists as scripts |
| Sonic | 45° ramps, springs | Momentum and speed physics, loops and curved slopes (the physics is AABB with 45° ramps only), spin |
| Mega Man | Shooting (Shooter), enemies, movers | Enemy formations exist as scripts; mini-boss rooms with locked screens need camera locking |
| Super Meat Boy / Celeste | Double jump | Wall slide and wall jump, dash and dash refill, moving saw blades on paths (a hazard on a MovingPlatform path works) |
| Hollow Knight | Levels, doors, teleporters | Rooms joined at their edges (screen-to-screen travel), ability gates (needs abilities that unlock), a map |

So stages 1–8 cover classic and puzzle. Each other genre starts with its engine work as a separate, testable step. For example, wall jump comes before Celeste.

**Other limits:**
- Levels are one or a few screens today (the guide keeps them about 30×17). Long scrolling levels work in the runtime, but the reachability checker's cost grows with size. That's fine for the 4-screen "long" length; worth measuring.
- Themes need objects that look the part. The generator places *roles*. The look comes from the library's objects (drawn by the AI or the starters). A theme without, say, a moving-platform look either uses the starter's or skips that pattern. It never invents objects.
- The reachability checker ignores walls in mid-jump. Construction margins cover the common cases, and the optional replay check covers the rest.

---

## 10. Implementation order and tests

| Stage | What | Done when |
|---|---|---|
| 0 | This document | You approve or adjust it |
| 1 | `levelProfile` and `Scene.madeBy` fields with schema, version and round-trip tests. `levelIdeas` reads the profile, which fixes the random style per request. `random.ts`, `roles.ts`, `limits.ts`, `grid.ts` with unit tests. No change to how levels are built. | Old saves load unchanged. A profile survives save and load. |
| 2 | Classic genre: about 12 patterns with 2–4 variants each, the grammar, `generate.ts` building from a blueprint, writing ops through `draw_map` | `generateLevel` on a starter project gives a level that passes every existing check, as one Undo step |
| 3 | `generate_level` / `set_level_profile` operations, context and guide changes, runPrompt skipping the follow-ups. Editor buttons: New level / Regenerate / Variation (no AI). | A new game's part 2 is a few blueprints. "Two more levels" makes no AI call. |
| 4 | Variation depth: more variants, routes (choice, bonus above or below), difficulty curve across a game | — |
| 5 | Fingerprints and similarity, candidate plans scored against history | Ten-level test passes |
| 6 | Puzzle-order check, section-level repair, mover handling in validation | Invalid-pattern test repairs without touching the project |
| 7 | Measurement: tokens, time, round trips, old vs new, recorded in this document | Numbers, not estimates |
| 8 | Puzzle genre (pressure-plate script first) | Puzzle solvability test |

**Tests:**
- **Determinism:** same blueprint and seed give identical operations; another seed gives a different but valid level.
- **Ten levels:** pairwise similarity below the threshold; minimum pattern and variant coverage; every level passes all checks.
- **Player capability:** jumpForce 250, 350 and 500 and speed 150 and 300, each giving valid levels whose gaps scale with the jump.
- **Invalid construction:** a pattern forced to make an impossible gap is caught, re-rolled, and the project is unchanged when it gives up.
- **Undo:** one `generate_level` is one Undo step, and redo brings it back exactly.
- **Compatibility:** every existing save fixture loads. The suites (`tsc`, vitest, e2e) stay green at every stage.
- **E2E:** a new game's part 2 is answered with a stubbed blueprint. "Two more levels" produces levels with zero `/api/ai` calls.
- **Measurement:** the AI log already records characters sent, time to first text and total time per request (`answerTiming`). Stage 7 compares a real new-game build before and after.

---

## Decisions for you

1. **Profile names:** genres `classic` and `puzzle` first. Themes as listed in §3, or your own list?
2. **Field names:** `ProjectSettings.levelProfile` and `Scene.madeBy`, or other names?
3. **Engine-only buttons:** should "New level / Regenerate / Variation" be on the level menu, or only on the "two more levels" card at first?
4. **Older games:** should games without a profile keep today's AI-drawn levels until the user picks a genre, or get one inferred (classic for platformers)? I recommend inferring it, with a way to change it.

---

## 11. Changes agreed after review

1. **Whole-level structures, not one grammar.** Before patterns are chosen, the builder picks a structure: a run, a climb, a descent, a loop out and back, a hub with branches, stacked floors. These are the side-view layouts `levelIdeas.ts` already names, made buildable. Patterns fill each structure's sections. Uniqueness compares what can be measured about how a level plays: its structure, its up-and-down shape, which mechanics it introduces and in what order, its difficulty per section, and its branches and secrets.
2. **The concept steers the build through structured fields that the AI fills in.** The engine doesn't parse free text. The blueprint gets `structure`, `focus` (mechanics to feature), `escalate` (a mechanic that gets harder section by section), `routes` (`one` | `choice` | `risky_shortcut` | `bonus_above` | `bonus_below`) and `secrets` (0–3). The AI translates "a level that introduces springs and makes them harder" into `focus: ["spring"], escalate: "spring"`. The concept text stays as the level's description.
3. **Patterns are modules in a registry**, each with an id and a version. Adding one changes nothing else. `Scene.madeBy.patterns` records the version of each pattern used, so "same seed, same level" can be honoured (or knowingly not) after a pattern improves.
4. **Three validation states: validated, invalid, uncertain.** An uncertain section is re-rolled into one that can be proven. If it stays uncertain, the level is applied with a visible warning, never silently. A scripted run of the route on the real runtime (§8, layer 4) is the extra test, planned for stage 6.
5. **Decisions:**
   - genres `classic` and `puzzle`;
   - themes as listed, added to by appending to `THEMES`;
   - fields `ProjectSettings.levelProfile` and `Scene.madeBy`;
   - New level / Regenerate / Variation on the level menu;
   - older games keep their levels and behaviour, get a genre inferred for suggestions only, and opt in.
6. **Engine-directed and AI-directed generation, plus custom sections.** Sections may be left to the engine, named pattern by pattern, or be a `custom` section: a small map the AI draws itself, which the engine joins into the level (its entry and exit floors matched to its neighbours) and validates with the rest.

## 12. Progress

### Stage 1 — done

- **Save format:**
  - `ProjectSettings.levelProfile {genre, theme, version}` and `Scene.madeBy {generator, version, seed, blueprint, patterns, fingerprint}` (`core/types.ts`).
  - Both saved by the schema (`serialization/schema.ts`).
  - Format 13 → 14 with a no-op migration, so an older editor refuses a newer game instead of silently dropping the fields.
- **`levelGen/profile.ts`:**
  - `GENRES` (classic, puzzle: rules and puzzles) and `THEMES` (nine looks, each with puzzles its look rules out), kept apart.
  - `levelProfileOf` returns the stored profile, or one inferred from the game without writing it: mostly switches, doors and crates means puzzle, otherwise classic. An empty game gets a stable look picked from its id; a game with levels keeps its look.
- **Bug fixed:** `levelDesignIdea()` no longer picks a platformer style at random on every request. The style comes from the profile, so a game keeps one kind of play and look. `PLATFORMER_STYLES` is replaced by genres plus themes.
- **`levelGen/random.ts`:** `seededRandom` (moved from `dungeon.ts`, which re-exports it unchanged, so dungeon seeds are unaffected), plus `makeRandom` (int, chance, pick, weighted, shuffle, fork) and `newLevelSeed`.
- **`levelGen/roles.ts`:** which library object plays each of 26 parts, found by what it is (components, collider, scripts), not by name. The most-placed object wins, then the starter. Parts the game has no object for are missing and never made up.
- **`levelGen/limits.ts`:** the player's reach in cells from the checker's own `jumpTable`, with a margin that shrinks from difficulty 1 to 5 (5 is exactly the checker's numbers).
- **`levelGen/grid.ts`:** the cell grid a level is built in, with multi-cell objects, refusal of overlaps and edges, placed things with refs, moving paths and links. It is written out as one `draw_map` plus `place_instance`, `add_component` / `set_component_field` and `create_relationship`, so it is an ordinary level.

Levels are not yet built any differently: nothing calls the grid outside tests.

### Stage 2 — done

- **`levelGen/blueprint.ts`:** the blueprint schema (zod). Everything but `difficulty` is optional:
  - `length`, `seed`, `structure` (run, climb, descent, loop, hub);
  - `focus`, `escalate`, `avoid` (mechanics);
  - `routes` (one, bonus_above), `secrets`, `concept`;
  - `sections` (named patterns and variants, or `custom` sections drawn as a small map with a legend of parts).
- **`levelGen/pattern.ts`:** the pattern interface (id, version, mechanics, kinds of section, needed parts, variants with their own needs and minimum difficulty, a width rule, `build`) and a `Section` helper that builds in the section's own columns whichever way the player walks.
- **`levelGen/patterns/classic.ts`:** 15 patterns with 34 variants:
  - start, flat, stairs, gap, floating platforms, enemy, pipes, blocks, spring, moving platform, spikes, bonus cache, goal;
  - key end and locked goal, for hubs.

  Every size comes from the player's reach and the seed.
- **`levelGen/patterns/index.ts`:** the registry. A new pattern is one entry.
- **`levelGen/genres.ts`:** the classic genre's choices: how often each structure comes up, pattern weights per kind of section, and five pacings.
- **`levelGen/generate.ts`:** blueprint → level.
  1. Pick the structure and length, then lay out floors and runs.
  2. Fill each run with sections until full. The blueprint's own sections come in its order, followed only by rests.
  3. Join floors: a ladder, jump-through ledges or a spring up; a hole down.
  4. Build on a copy and check it: win, layout, start, and reachability, with moving platforms checked as still bridges along their paths.
  5. A build that fails is retried from the next seed in the same series, up to 12 times, so results stay deterministic.

  It returns the operations, the record for `Scene.madeBy`, the state (`validated` | `uncertain`) and notes on anything it couldn't do as asked. It throws `LevelGenError` with the reason when nothing valid can be built.
- **Checker fix (`model/reachability.ts`):** a script that only changes its own look (a ? block's used picture), or takes itself away (a brick breaking), no longer makes a level "uncertain". This also means AI-built levels with blocks are judged now.
- **Measured:** 400 levels (5 structures × 2 lengths × 5 difficulties × 8 seeds) were all `validated`. On average they took 1.1–2.9 builds and 47–182 ms each.

Not yet connected to the AI or the editor (stage 3).

### Stage 3 — done

- **Operations** (`commands/operations.ts`):
  - `generate_level {sceneId, difficulty, structure, length, focus, escalate, avoid, secrets, concept, sections[{role, pattern, variant, harder, map, legend}]}` builds the level through `levelGen`, applies its operations inside the same draft, writes `Scene.madeBy`, and adds a note ("Level 2: built by the engine (climb, 12 sections, checked: playable)"). A bad blueprint or an impossible level becomes a `ModelError` naming the problem, so it goes through the usual "didn't check out" path.
  - `set_level_profile {genre, theme}`.
  - To fit the compact reply format (at most 24 optional fields), lists are required (empty = none) and `seed` is left to the engine. To stay inside the 120,000-character prompt budget, mechanics are plain text in the reply format (the blueprint schema still checks them) and a few long descriptions were shortened.
- **`levelGen/build.ts`:**
  - `builderFor` / `noBuilderReason`: classic yes, puzzle not yet, top-down never.
  - `blueprintFor`: new (a step harder than the hardest built level, another structure than the last two), regenerate (the same blueprint, a new seed), variation (the same structure, length and sections, a new seed).
  - `buildLevel`, `applyBuilt`, `newBuiltLevel` (a new level with the last one's gravity, background and camera).
  - `builderInfo`: what the AI is told.
- **AI:**
  - `context.level.builder` (genre, theme, structures, mechanics, and only the patterns and variants the game has parts for, about 2–3 KB) goes with level requests only.
  - The levels guide tells the AI to use `generate_level` for whole levels, and `draw_map` / `build_path` only for levels described cell by cell, partial edits, or games without a builder.
  - The new-game guide says to call `set_level_profile` once. Part 1 of a new game includes it; part 2 builds levels with `generate_level`.
  - The puzzles note stays, marked as being for hand-drawn maps. The missing-puzzles follow-up is skipped for answers that use `generate_level`.
- **Editor:**
  - The level menu has ✦ New level, built by the engine / ✦ Build this level again / ✦ A variation of this level. There's no AI call, each is one Undo step, and a note under the level button says what was built and how it checked out.
  - "Two more levels" after a new game is built by the engine at once, each a step harder; the AI is used only if the engine can't.
