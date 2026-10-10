# PXLBuilder

An AI-native 2D game builder: describe what your game should do, and the AI
changes a structured game model, which then drives the editor and the runtime.

**Current status:** the game world is the interface. Click an object and a
prompt appears next to it; describe the change; the AI turns it into validated,
undoable operations. Press **Play** to run the level. Objects can be connected
("this switch opens this door", "the blue key opens the blue door") and levels
can have rules ("when the player picks up the key, show a message"). Things can
behave on their own. A few common behaviors are ready-made components
(Patrol, Jumper, Shooter, MovingPlatform, Timer, DoubleJump, LedgeGrab), and
for anything else the AI **programs the behavior**: it writes a behavior
script for the object ("charges at the player when it gets close, then rests",
"a jetpack with fuel", "a platform that crumbles", "water the player swims in").
A script can act on other things too, so an area (water, mud, a trampoline)
changes whatever enters it. Scripts are data in a small
event-based language (variables, states, expressions, game actions), checked
before they are applied and readable in the details panel. The camera has
per-level settings (zoom, look-ahead, dead zone, limits, a still camera aimed
at a spot) and effects for rules and scripts (shake, flash, zoom, focus on
something, follow something else).
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

**GitHub Pages:** `npm run build` builds for `/PXLBuilder/` (set as `base` in
`vite.config.ts`), so `dist/` can be served at `https://<user>.github.io/PXLBuilder/`;
`npm run preview` serves it at http://localhost:4173/PXLBuilder/. The dev server
stays at the root. Pages has no server, so the AI there works only with a key
entered in ⋯ → AI connection (kept in the browser).

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
- **Sprite editor**: select an object and ask "open the sprite editor" (or "I want to edit its running animation myself"), or in its Sprites panel use ✎ to edit a sprite (every object using it updates) and **Draw new sprite** to draw one, as its look or for a situation (while running, jumping…). A tool panel of icons: pencil (P), eraser (E, or the right button), fill (F), color picker (I; or hold **Alt** with any tool, it comes back when you let go) and select (S: drag to select, drag inside to move, arrows nudge, flip, Delete, Ctrl+C/X/V also between frames, Ctrl+A, Esc); a palette you can add to and recolor; frames you can duplicate, add, reorder and delete, with the frame before shown faintly and a playing preview; its own Undo for strokes. Saving is one undoable step. Imported pictures up to 64×64 with up to 62 colors can be edited too.
- **Animated sprites**: a sprite with several frames plays them at its speed, in the game and in the editor. Ask the AI ("give the player a walk cycle while running", "make the coin spin"), draw the frames in the sprite editor, or, in a sprite sheet, type which cells play ("1-4") and how fast. The top-down hero walks with a two-frame cycle each way.
- **Draw sprites**: select something and ask "make this look like spikes" or "draw a red mushroom". The AI draws simple pixel art at the object's proportions (a 64×16 hazard gets 32×8 pixels) and makes it the look of every copy; it's added to the object's Sprites, so you can switch back.
- **Wire a switch**: select a Switch; red circles appear left and right of its frame. Drag one onto another object (a door): the switch now opens it. Click the connection's line to select it and describe what it should do instead: "the switch makes the door disappear", "the switch moves the door three squares upwards". Delete removes a selected connection.
- **Logic** (left panel, the connected-dots button): the level's connections and rules as sentences. Switch rules off, remove things, or describe new logic ("when the player has 3 coins, open the exit"). Existing connections show as arrows on the level. An object's details also list its connections, with a small form to add one.
- **The level**: double-click empty space. "Make gravity 30% weaker."
- **Whole game**: the ✦ button in the top bar (Ctrl+K).
- **Start by choosing the kind of game**: the first visit (and ⋯ → New project) asks *Platformer* or *Top-down*. Top-down games start with objects drawn from above: a hero who looks up, down and sideways as he walks, stone walls, floor tiles that always sit under everything, a wandering slime, a door, floor spikes, a teleporter pad and stairs as the goal (plus coins, keys and a lever). Nothing is locked: mix objects or ask the AI to change the kind of game later.
- **Pushing things**: crates, barrels and boulders get the Pushable component (the starter Crate in platformers, the Barrel in top-down games). Walk into one to shove it; walls and other things stop it. A Pushable can slide freely or move exactly one tile per push (Sokoban puzzles). Ask "a puzzle with barrels to push onto the switches".
- **Mass**: heavier things (Physics Body mass; the player is 1) are knocked back less, pushed more slowly, and at 10 times the pusher's weight not at all. A strength power-up can simply raise the player's mass. The starter Crate weighs 2.
- **Friction**: things slow down while sliding on the ground (or, seen from above, on the floor) by their Physics Body friction: 0 is ice (keeps sliding), 1 stops at once. Things in the air keep their speed, and whatever sets its own speed (the player, patrols, wanderers) isn't slowed. Ask "make the crates slide on ice".
- **Grid and turn-based games**: ask for them ("make it turn-based: one square per key press"). Hits can knock things back or not (Damage Receiver → knockback; 0 keeps everything on its square), and scripts can see what is on a square (thing_at), so moves, attacks and barrel pushes stay on the grid.
- **Top-down games** (Zelda, Rogue): ask "make it a top-down game". The player then walks in every direction with the arrows or WASD (no jumping) and the level has no gravity, so nothing falls and walls block from every side. Enemies chase in every direction, patrol up and down (Patrol start direction up/down) and shoot the way they face; a top-down player shoots the way it last walked. Sprites can have *up* and *down* looks. The AI builds rooms and corridors instead of jumps, and levels are checked by walking. By hand: Character Controller → movement, and the level's gravity.
- **Show more while editing**: ask any prompt, e.g. on the Player: "show the jump height above the player" or "show how far it can jump" (a panel with values, or the jump arc). Only shown while editing; ⋯ → **Hide info on the level** removes them.
- **Changes land where they belong**: ask on the Player "the player kills mushroom enemies by jumping on them, but other enemies can't be killed that way" and the AI makes the *Mushroom* stompable (every mushroom) instead of changing the player. It says so, the prompt shows "Changed: Mushroom (every copy…)", and the changed objects glow. If what you describe doesn't exist yet, it tells you what to do first.
- **Touch screens**: two fingers pan the level and pinch to zoom (whatever one finger had started is cancelled, so nothing is drawn between your fingers); one finger taps to select (a placed object is selected even while drawing with an object), drags to move or draw; double-tap empty space for the level prompt.
- **Level variety**: each time you ask for a level, the app picks a layout at random (a tower built in layers, a descent from the top, a hub in the middle with branches, a valley, a mountain, a zig-zag climb, two paths, out-and-back, islands, a shaft, a basement, a long run; for top-down games dungeon rooms, a maze, a ring…), where the player starts and where the goal goes, and tells the AI the shapes of your other levels so it builds something different. Ask for a specific layout and it builds that instead. Routes can turn around and climb back over the floor below, so levels can be built upward in layers.
- **Generate or redraw levels**: double-click empty space and describe it: "Generate a hard level with spikes, enemies and teleporters". The AI uses your objects (or makes simple ones it needs), keeps jumps within the player's reach, and builds it right away: look around, play it, and Undo if you don't like it. Every AI change works this way (no Apply button); a change to an object (every Enemy) can be turned into a new object with one click on the card.
- **Prompt cards are chats**: each thing you talk to (an object, a pair, the level, the background…) has its own conversation with the AI, shown on its card with the field below it, so you can answer the AI's questions or follow up. Closing the card, selecting something else or reloading the page keeps it, and the AI remembers it; **New chat** on the card starts a fresh one (AI History keeps the old one).
- **Camera outlines**: the level shows what Play shows when it starts (white) and where the camera may not look past (red). Hover one to highlight it; click it to select it and ask about the camera ("zoom out a bit", "let it show below the level"). ⋯ → Camera outlines hides them.
- **Low-resolution play** (on by default): Play draws the game about 400 pixels tall and scales it up with hard edges, which is much lighter work for weak graphics chips and suits pixel art. ⋯ → Low-resolution play (faster) switches to full sharpness; the Editor prompt can set any height ("play resolution 300").
- **Levels stay in view**: switching to a level shows it as you left it, or frames it whole the first time; what the AI builds off screen is brought into view.
- **Sounds**: ask for any sound and when it plays: "the duck quacks when the player touches it", "a springy boing when the player jumps on the spring", "an explosion when the bomb goes off". The AI designs the sound (layers of tones and noise with pitch slides, wobble and filters, played by the browser's own synthesizer, so nothing is downloaded) and makes the game play it. The card has a ▶ button to hear a new sound; **Objects → Sounds** lists them all. "Make the quack deeper" remakes it. Short effects and jingles, up to 4 seconds; no background music yet.
- **Everything can change while playing**: scripts the AI writes can read and change any property of anything during play (size, scale, rotation, colors, sprite, jump force, speed, health, collisions…), add or remove abilities (climbable, stompable, harmful…), and draw their own display on the screen (big hearts, a score, a timer, a health bar over a boss), hiding the built-in hearts or items. Ask in plain words: "the player grows when it eats a mushroom", "make the hearts bigger", "show a timer". Turned walls and platforms collide as the upright box around them; characters keep an upright box while drawn turned.
- **Hidden or invisible**: an object that *starts hidden* is out of play (it can't be touched, climbed or collected) until a rule or switch shows it, e.g. a ladder that appears after the last coin. An object whose sprite is set to *not visible* is still there and works (a secret ladder or platform), it just isn't drawn in play; the editor shows it faintly so you can find it. Things that start hidden are shown half see-through in the editor. Ask for either in words.
- **Ways to win**: drop a *Goal* (flag) in a level: touching it finishes the level, and Play moves on to the next level. Or describe it: "the level is won when all coins are collected", "after the last coin a ladder appears that climbs out of the screen". The AI varies where levels start, which way they go and how they're won. *Teleporter* pads ship as built-in objects: wire two together ("this teleporter sends the player to that one").
- **The editor itself**: the ✦ prompt's **Editor** tab. "Move the Play button to the bottom", "dock the details panel on the right", "make the editor green", "zoom slower with my mouse". Editor changes are saved in your browser (not in the game) and have their own Undo; ⋯ → **Reset editor layout** puts everything back.
- **Create**: the bottom dock's **+ Create** makes a new object from a description.
- **Tools** (left panel): the arrow selects and moves (`V`), the pen draws (`B`), and the picture button opens the level background.
- **Draw**: pick an object in **Objects** (e.g. *Platform* or *Ladder*), or press the pen to draw with the last one used. Click or drag on the level to draw it, one per grid cell. Shift keeps a stroke straight, right-drag erases; Esc or the arrow stops drawing. Each stroke is one undo step. You can also drag objects in directly.
- **Sprites**: right-click an object in **Objects** → **Sprites**. Import a single image, or a sprite sheet: the grid is detected and every cell is numbered; adjust the grid if needed and click a cell to use it. Sprites stretch to the object's size. **Plain box** draws the object as a box of one color instead of a picture (pick the color with **Box color**); the picture stays in the list to choose again. Right-click → **Inspector** shows all its properties.
- **Size link**: in the Inspector, sprite and collider sizes are linked (changing one changes the other). Click **Linked** to size them separately.
- **Background**: choose a color, upload an image (Fill or Repeat, and how much it moves with the level), or describe what you want ("the background should move sideways along with the level").
- **Play**: the ▶ Play button (or `Ctrl+Enter`). Arrows/WASD run, Space jumps (one row up), Up/Down climb ladders (you ease to the ladder's middle unless you also press Left/Right; you stop on the top; a ladder above a gap needs a jump), `E` uses a switch, `R` restarts, `Esc` stops. The player picks up coins and keys, loses a heart touching hazards and enemies, and starts over when out of hearts; the top-left shows hearts and items. Playing never changes your level.
- **AI connection** (⋯ → AI connection): choose **Speed**, *Best quality* or *Fast* (Claude thinks less; on claude.ai its quicker model): much quicker, a bit more likely to get hard requests wrong. Outside claude.ai (on your computer, or the GitHub Pages site) you can also choose **Google Gemini** (e.g. Gemini Flash) with your own Gemini API key from aistudio.google.com: the key stays in your browser and is sent only to Google; pick the model (Gemini 3.8, 3.7, 3.6 and 3.5 Flash and 3.5 Flash-Lite are always offered, plus whatever else your key can use) and a backup for when it's busy (default 3.5 Flash): a busy model's request goes to the backup automatically, and the backup keeps answering for a couple of minutes; the console says when. Gemini can't be used in the published claude.ai app (pages there can't contact other services).
- **Debug**: the bottom-right **Debug** button lists what can't work in the level as it is set up (a door that needs a key nothing gives, damage nothing takes, a "switch" that isn't one, a script line that changes nothing); **✦ Fix** asks the AI to fix one (you see the fix before applying it). After you play, it also shows what happened (deaths, falls, locked doors, script problems) with questions to ask: "Why did the player die?", "Why didn't Door open?". You can ask any prompt "why…?": the AI gets the last play and the problems with every request.
- **Details**: the sliders icon on the prompt (or `I`) opens the full property drawer for advanced editing.
- **Undo/Redo**: top bar, `Ctrl+Z` / `Ctrl+Shift+Z`. AI changes are single steps. **AI History** (bottom right) shows your conversation with the AI in full: each request, what it was about, the AI's whole answer, its changes and how it ended (applied, undone, an answer, a failure), kept in this browser; tick **My edits too** to see your own changes alongside, and use the corner button to make the panel bigger. **Details (under the hood)** on an exchange shows what happened: which AI answered, how much was sent, the AI's raw answer, the app's checks and retries; **Download** saves the recent exchanges with these details as a file (no API keys in it) to share when something goes wrong.
- **Move**: drag objects (tiles snap to whole tiles); arrows nudge; `Ctrl+D` duplicate; `Del` delete.
- **View**: trackpad two-finger scroll pans, pinch or Alt+scroll zooms. Mouse: wheel zooms, Shift+wheel scrolls sideways, middle-button drag pans. Space+drag pans with either. `F` frames everything.
- **Project** (click the project name in the top bar): **New project** (an empty level with the built-in objects as they ship), **Open…**, **Save** (downloads a `.pxlproj.json`; the project also autosaves in your browser), and **Reset objects to defaults** (built-in objects go back to how they ship; your level and your own objects stay; undoable). Right-click a built-in object in **Objects** → **Reset to default** for just that one.
