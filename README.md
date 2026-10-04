# PXLBuilder

An AI-native 2D game builder: describe what your game should do, and the AI
changes a structured game model, which then drives the editor and the runtime.

**Current status: Phase 1 (foundation).** The editor, project model, component
system, object library and save/load work. There is no play mode and no AI
yet. See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Run

```bash
npm install
npm run dev          # http://localhost:5173
```

## Check

```bash
npm test             # unit tests (core model)
npm run typecheck
npm run test:e2e     # builds, serves and drives the editor in headless Chromium
```

## Editor basics

- **Place**: drag an object from the Object Library into the viewport (or double-click it).
- **Select**: click; Shift/Ctrl+click to add to the selection; drag on empty space for a box selection.
- **Move**: drag the selection (snaps to the grid; toggle under View). Arrow keys nudge.
- **Pan / zoom**: middle mouse or Space+drag to pan, mouse wheel to zoom, `F` to frame the selection.
- **Edit**: the Inspector edits the selected entity, the selected library object (which changes all instances), or the scene/world when nothing is selected.
- **Keys**: `Ctrl+D` duplicate, `Del` delete, `Ctrl+A` select all, `Esc` deselect, `Ctrl+S` save, `Ctrl+O` open.
- **Files**: `File > Save` downloads a `.pxlproj.json` project bundle. The project also autosaves to the browser's local storage.
