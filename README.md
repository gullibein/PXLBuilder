# PXLBuilder

An AI-native 2D game builder: describe what your game should do, and the AI
changes a structured game model, which then drives the editor and the runtime.

**Current status:** the game world is the interface. Click an object and a
prompt appears next to it; describe the change; the AI turns it into validated,
undoable operations. Behaviors (patrol, shoot, ...), relationships and play mode
are not built yet, and the AI says so when a request needs them.
See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Run

```bash
npm install
cp .env.example .env.local   # then put your Anthropic API key in it
npm run dev                  # http://localhost:5173
```

The key is read only by the dev server (`server/`); it is never sent to the
browser. Without a key everything works except the AI, which reports that it
isn't connected.

## Check

```bash
npm test             # unit tests (core model)
npm run typecheck
npm run test:e2e     # builds, serves and drives the editor in headless Chromium
```

## Using it

- **Click something** in your game. A prompt appears next to it. Press Enter (or click the prompt) and describe what you want: "Give the player three hearts."
- **Two objects** (Shift+click the second): one prompt about how they relate. **More**: one prompt for the group (or drag a box around them).
- **The level**: double-click empty space. "Make gravity 30% weaker."
- **Whole game**: the ✦ button in the top bar (Ctrl+K).
- **Create**: the bottom dock's **+ Create** makes a new object from a description.
- **Draw**: open **Objects**, click an object (e.g. *Ground*), then click or drag on the level to draw it, one per grid cell. Shift keeps a stroke straight, right-drag erases, Esc puts the brush away. Each stroke is one undo step. You can also drag objects in directly.
- **Details**: the sliders icon on the prompt (or `I`) opens the full property drawer for advanced editing.
- **Undo/Redo**: top bar, `Ctrl+Z` / `Ctrl+Shift+Z`. AI changes are single steps. **History** (bottom left) lists every change.
- **Move**: drag objects (tiles snap to whole tiles); arrows nudge; `Ctrl+D` duplicate; `Del` delete.
- **View**: trackpad two-finger scroll pans, pinch or Alt+scroll zooms. Mouse: wheel zooms, Shift+wheel scrolls sideways, middle-button drag pans. Space+drag pans with either. `F` frames everything.
- **Files**: menu (⋯) > Save downloads a `.pxlproj.json`; the project also autosaves in your browser.
