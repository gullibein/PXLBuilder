# PXLBuilder

An AI-native 2D game builder: describe what your game should do, and the AI
changes a structured game model, which then drives the editor and the runtime.

**Current status:** the game world is the interface. Click an object and a
prompt appears next to it; describe the change; the AI turns it into validated,
undoable operations. Press **Play** to run the level. Behaviors (patrol,
shoot, ...), relationships, damage and collecting are not built yet, and the AI
says so when a request needs them.
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
- **Tools** (left panel): the arrow selects and moves (`V`), the pen draws (`B`), and the picture button opens the level background.
- **Draw**: pick an object in **Objects** (e.g. *Platform* or *Ladder*), or press the pen to draw with the last one used. Click or drag on the level to draw it, one per grid cell. Shift keeps a stroke straight, right-drag erases; Esc or the arrow stops drawing. Each stroke is one undo step. You can also drag objects in directly.
- **Sprites**: right-click an object in **Objects** → **Sprites**. Import a single image, or a sprite sheet: the grid is detected and every cell is numbered; adjust the grid if needed and click a cell to use it. Sprites stretch to the object's size. Right-click → **Inspector** shows all its properties.
- **Size link**: in the Inspector, sprite and collider sizes are linked (changing one changes the other). Click **Linked** to size them separately.
- **Background**: choose a color, upload an image (Fill or Repeat, and how much it moves with the level), or describe what you want ("the background should move sideways along with the level").
- **Play**: the ▶ Play button (or `Ctrl+Enter`). Arrows/WASD run, Space jumps, Up/Down climb ladders, `R` restarts, `Esc` stops. Playing never changes your level.
- **Details**: the sliders icon on the prompt (or `I`) opens the full property drawer for advanced editing.
- **Undo/Redo**: top bar, `Ctrl+Z` / `Ctrl+Shift+Z`. AI changes are single steps. **History** (bottom left) lists every change.
- **Move**: drag objects (tiles snap to whole tiles); arrows nudge; `Ctrl+D` duplicate; `Del` delete.
- **View**: trackpad two-finger scroll pans, pinch or Alt+scroll zooms. Mouse: wheel zooms, Shift+wheel scrolls sideways, middle-button drag pans. Space+drag pans with either. `F` frames everything.
- **Files**: menu (⋯) > Save downloads a `.pxlproj.json`; the project also autosaves in your browser.
