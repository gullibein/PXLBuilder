# PXLBuilder

An AI-native 2D game builder: describe what your game should do, and the AI
changes a structured game model, which then drives the editor and the runtime.

**Current status:** the game world is the interface. Click an object and a
prompt appears next to it; describe the change; the AI turns it into validated,
undoable operations. Press **Play** to run the level. Objects can be connected
("this switch opens this door", "the blue key opens the blue door") and levels
can have rules ("when the player picks up the key, show a message"). Things can
behave on their own ("make the mushroom walk back and forth", "this turret
shoots at the player", "let the player double jump"): behaviors are components
(Patrol, Jumper, Shooter, MovingPlatform, Timer, DoubleJump, LedgeGrab). What
isn't built yet (jetpacks, wall jumps, ...) the AI says so.
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

**In the published app (claude.ai):** no key needed. The AI runs on your own
Claude account through claude.ai; you're asked once per visit to allow the
page to use Claude, and requests count toward your plan's usage. (Published
pages can't contact other services, so API keys don't work there.) **Save**
works there too: claude.ai asks you to confirm the download.

**Your own key instead (running locally):** ⋯ → **AI connection** takes your Anthropic API key
and calls Claude straight from the browser (no server needed). The key is
checked first, kept for the session (or remembered in this browser if you
tick the box), and sent only to Anthropic. Requests are billed to your
account. Don't remember a key on a shared computer.

## Check

```bash
npm test             # unit tests (core model)
npm run typecheck
npm run test:e2e     # builds, serves and drives the editor in headless Chromium
```

## Using it

- **Click something** in your game. A prompt appears next to it. Press Enter (or click the prompt) and describe what you want: "Give the player three hearts."
- **Two objects** (Shift+click the second): one prompt about how they relate ("make this switch open this door"). **More**: one prompt for the group (or drag a box around them).
- **Draw sprites**: select something and ask "make this look like spikes" or "draw a red mushroom". The AI draws simple pixel art at the object's proportions (a 64×16 hazard gets 32×8 pixels) and makes it the look of every copy; it's added to the object's Sprites, so you can switch back.
- **Wire a switch**: select a Switch; red circles appear left and right of its frame. Drag one onto another object (a door): the switch now opens it. Click the connection's line to select it and describe what it should do instead: "the switch makes the door disappear", "the switch moves the door three squares upwards". Delete removes a selected connection.
- **Logic** (left panel, the connected-dots button): the level's connections and rules as sentences. Switch rules off, remove things, or describe new logic ("when the player has 3 coins, open the exit"). Existing connections show as arrows on the level. An object's details also list its connections, with a small form to add one.
- **The level**: double-click empty space. "Make gravity 30% weaker."
- **Whole game**: the ✦ button in the top bar (Ctrl+K).
- **Show more while editing**: ask any prompt, e.g. on the Player: "show the jump height above the player" or "show how far it can jump" (a panel with values, or the jump arc). Only shown while editing; ⋯ → **Hide info on the level** removes them.
- **Changes land where they belong**: ask on the Player "the player kills mushroom enemies by jumping on them, but other enemies can't be killed that way" and the AI makes the *Mushroom* stompable (every mushroom) instead of changing the player. It says so, the prompt shows "Changed: Mushroom (every copy…)", and the changed objects glow. If what you describe doesn't exist yet, it tells you what to do first.
- **Generate or redraw levels**: double-click empty space and describe it: "Generate a hard level with spikes, enemies and teleporters". The AI uses your objects (or makes simple ones it needs), keeps jumps within the player's reach, and shows the result on the level before you Apply.
- **The editor itself**: the ✦ prompt's **Editor** tab. "Move the Play button to the bottom", "dock the details panel on the right", "make the editor green", "zoom slower with my mouse". Editor changes are saved in your browser (not in the game) and have their own Undo; ⋯ → **Reset editor layout** puts everything back.
- **Create**: the bottom dock's **+ Create** makes a new object from a description.
- **Tools** (left panel): the arrow selects and moves (`V`), the pen draws (`B`), and the picture button opens the level background.
- **Draw**: pick an object in **Objects** (e.g. *Platform* or *Ladder*), or press the pen to draw with the last one used. Click or drag on the level to draw it, one per grid cell. Shift keeps a stroke straight, right-drag erases; Esc or the arrow stops drawing. Each stroke is one undo step. You can also drag objects in directly.
- **Sprites**: right-click an object in **Objects** → **Sprites**. Import a single image, or a sprite sheet: the grid is detected and every cell is numbered; adjust the grid if needed and click a cell to use it. Sprites stretch to the object's size. Right-click → **Inspector** shows all its properties.
- **Size link**: in the Inspector, sprite and collider sizes are linked (changing one changes the other). Click **Linked** to size them separately.
- **Background**: choose a color, upload an image (Fill or Repeat, and how much it moves with the level), or describe what you want ("the background should move sideways along with the level").
- **Play**: the ▶ Play button (or `Ctrl+Enter`). Arrows/WASD run, Space jumps (one row up), Up/Down climb ladders (you ease to the ladder's middle unless you also press Left/Right; you stop on the top; a ladder above a gap needs a jump), `E` uses a switch, `R` restarts, `Esc` stops. The player picks up coins and keys, loses a heart touching hazards and enemies, and starts over when out of hearts; the top-left shows hearts and items. Playing never changes your level.
- **Details**: the sliders icon on the prompt (or `I`) opens the full property drawer for advanced editing.
- **Undo/Redo**: top bar, `Ctrl+Z` / `Ctrl+Shift+Z`. AI changes are single steps. **History** (bottom left) lists every change.
- **Move**: drag objects (tiles snap to whole tiles); arrows nudge; `Ctrl+D` duplicate; `Del` delete.
- **View**: trackpad two-finger scroll pans, pinch or Alt+scroll zooms. Mouse: wheel zooms, Shift+wheel scrolls sideways, middle-button drag pans. Space+drag pans with either. `F` frames everything.
- **Project** (click the project name in the top bar): **New project** (an empty level with the built-in objects as they ship), **Open…**, **Save** (downloads a `.pxlproj.json`; the project also autosaves in your browser), and **Reset objects to defaults** (built-in objects go back to how they ship; your level and your own objects stay; undoable). Right-click a built-in object in **Objects** → **Reset to default** for just that one.
