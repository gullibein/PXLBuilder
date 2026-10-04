# PXLBuilder architecture

PXLBuilder is an AI-native 2D game builder. The **project model** (a structured,
queryable description of the game) is the single source of truth. The editor,
the renderer, the future play-mode runtime and the future AI layer all read
it, and all of them change it through the same validated mutation functions.
The LLM will *propose* operations; the application validates and applies them.

Status: **Phase 1 (foundation)**, the **command/transaction system** (Phase 4
core), the **AI foundation** (Phase 5), and the **contextual-AI interaction
redesign** are implemented. Behaviors, relationships, rules and play mode are
not built yet. See "Roadmap" at the end.

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
  components/        component schemas + registry (extensible)
  model/
    factory.ts       constructors + starter definitions
    resolve.ts       definition + instance overrides -> effective entity
    mutations.ts     ALL validated model changes (future command executors)
    geometry.ts      bounds / hit testing
  serialization/     file layout, zod schemas, versioning, migrations
src/render/          scene renderer shared by editor and (future) runtime
src/editor/          React UI
  store.ts           editor state; edit() = one validated transaction
  viewport/          the canvas: selection, relation arrow, level marker
  prompt/            contextual prompt, placement, per-frame anchor channel
  ai/runPrompt.ts    prompt -> context -> provider -> operations -> transaction
  chrome/            top bar, dock (create + library), tray, global prompt
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
- The capability description is generated from the component registry, and
  explicitly lists what is **not available yet** (behaviors, relationships,
  rules, play mode, ...). The model is instructed to say so ("unsupported") or
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
`FORMAT_VERSION` (currently 1) is written to `project.json`.
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
2. Runtime: game loop, physics library, collisions, movement/jumping, Play/Stop (runtime state separate from the project). The Play button is in place but disabled until this exists.
3. Graph: relationships, events, rules, graph queries. Once relationships exist, the details drawer should show them ("requires -> Blue Key") and the AI gets relationship operations.
4. Commands: **done** (operations, transactions, undo/redo).
5. AI foundation: **done** (provider interface, context builder, capabilities, structured operations, preview/apply).
6–7. Contextual AI, world AI, multi-selection, AI object creation: **done** at the interaction level; limited by what the engine can express.
8–10. Design planning, debugging, asset generation.
