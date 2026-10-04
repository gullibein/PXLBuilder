// End-to-end test: builds the app, serves it, and drives the real editor in
// headless Chromium. Usage: npm run test:e2e
//
// The language model is the only stubbed part: /api/ai is intercepted with a
// deterministic stub that returns structured operations computed from the
// context the editor actually sends. Everything else (selection context,
// prompt placement, validation, transactions, undo, rendering) is real.
// A final pass runs against the real server endpoint with no API key.
import { execSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const PORT = 4179;
const URL = `http://localhost:${PORT}/`;
const OUT = 'test-results';
mkdirSync(OUT, { recursive: true });

execSync('npx vite build', { stdio: ['ignore', 'ignore', 'inherit'] });
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--port', String(PORT), '--strictPort'], {
  stdio: 'pipe',
  env: { ...process.env, ANTHROPIC_API_KEY: '' },
});
await new Promise((resolve, reject) => {
  server.stdout.on('data', (d) => d.toString().includes(String(PORT)) && resolve());
  server.on('exit', (code) => reject(new Error(`preview exited ${code}`)));
});

const executablePath = existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined;
const browser = await chromium.launch({ executablePath });
const errors = [];
let step = '';
let passed = 0;
const check = async (cond, msg) => {
  const deadline = Date.now() + 3000;
  for (;;) {
    if (typeof cond === 'function' ? await cond() : cond) break;
    if (Date.now() > deadline) throw new Error(`[${step}] ${msg}`);
    await new Promise((r) => setTimeout(r, 50));
  }
  passed++;
  console.log(`  ✓ ${msg}`);
};

/** Stand-in for the language model: same protocol, deterministic answers. */
const aiRequests = [];
function stubModel(body) {
  aiRequests.push(body);
  const req = body.request.toLowerCase();
  const t = body.context.targets;
  if (req.includes('three hearts')) {
    return { kind: 'apply', message: 'Gave the player 3 hearts.', changes: [`${t[0].name}: 3 hearts`], operations: [{ op: 'add_component', target: 'instance', id: t[0].id, component: 'Health', propsJson: '{"maxHealth":3,"currentHealth":3}' }] };
  }
  if (req.includes('patrol')) {
    return { kind: 'unsupported', message: "Enemies can't patrol yet: movement behaviors aren't in this version.", changes: [], operations: [] };
  }
  if (req.includes('gravity')) {
    const y = Math.round(body.context.level.gravity.y * 0.7);
    return { kind: 'apply', message: 'Gravity is 30% weaker.', changes: [`Gravity: ${body.context.level.gravity.y} → ${y}`], operations: [{ op: 'set_world', sceneId: body.context.level.id, gravityX: null, gravityY: y, backgroundColor: null }] };
  }
  if (req.includes('faster')) {
    return {
      kind: 'preview',
      message: 'Speeds up these enemies.',
      changes: t.map((e) => `${e.name}: faster`),
      operations: t.map((e) => ({ op: 'set_component_field', target: 'instance', id: e.id, component: 'Sprite', field: 'color', valueJson: '"#ff2d55"' })),
    };
  }
  if (req.includes('flying robot')) {
    return {
      kind: 'preview',
      message: 'A floating robot enemy. Shooting needs behaviors, which are not available yet.',
      changes: ['New object: Flying Robot', 'Floats (no gravity)', 'Hurts on contact'],
      operations: [
        {
          op: 'create_definition', ref: 'robot', name: 'Flying Robot', description: 'A hovering robot enemy.', category: 'Enemies', tags: ['enemy', 'flying'],
          components: [
            { component: 'Sprite', propsJson: '{"width":26,"height":22,"color":"#9aa7ff"}' },
            { component: 'Collider', propsJson: '{"size":{"x":26,"y":22}}' },
            { component: 'PhysicsBody', propsJson: '{"gravityScale":0}' },
            { component: 'Damage', propsJson: '{"amount":1}' },
          ],
        },
      ],
    };
  }
  if (req.includes('move sideways') || req.includes('background')) {
    return { kind: 'apply', message: 'The background now scrolls slowly with the level.', changes: ['Background moves 50% with the level'], operations: [{ op: 'set_background', sceneId: body.context.level.id, color: null, fit: null, parallax: 0.5, removeImage: false }] };
  }
  if (req.includes('open the door')) {
    return { kind: 'unsupported', message: `Linking ${t[0]?.name} to ${t[1]?.name} needs relationships, which aren't in this version yet.`, changes: [], operations: [] };
  }
  return { kind: 'clarify', message: 'What would you like to change about it?', changes: [], operations: [] };
}

try {
  const context = await browser.newContext({ viewport: { width: 1400, height: 860 }, acceptDownloads: true });
  const page = await context.newPage();
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  // Ignored: the expected 401 from the keyless AI endpoint, and web-font hosts (unreachable in sandboxed CI; the UI falls back to system fonts).
  const ignorable = (m) => m.text().includes('401') || /fonts\.(googleapis|gstatic)\.com/.test(m.location()?.url ?? '');
  page.on('console', (m) => m.type() === 'error' && !ignorable(m) && errors.push(`console: ${m.text()} (${m.location()?.url ?? ''})`));
  await page.route('**/api/ai', async (route) => {
    const body = JSON.parse(route.request().postData());
    await new Promise((r) => setTimeout(r, 150));
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(stubModel(body)) });
  });
  await page.goto(URL);

  const canvas = page.getByTestId('viewport-canvas');
  const box = await canvas.boundingBox();
  const center = { x: box.width / 2, y: box.height / 2 };
  const toScreen = (wx, wy) => ({ x: box.x + center.x + wx, y: box.y + center.y + wy });
  const prompts = page.getByTestId('context-prompt');
  const promptInput = prompts.getByTestId('prompt-input');
  const ask = async (text) => {
    await promptInput.click();
    await promptInput.fill(text);
    await promptInput.press('Enter');
  };
  const result = page.locator('[data-testid="context-prompt"] [data-testid="prompt-result"]');
  const clickWorld = async (wx, wy, opts = {}) => {
    const p = toScreen(wx, wy);
    // page.mouse.click ignores `modifiers`, so hold them on the keyboard.
    for (const k of opts.modifiers ?? []) await page.keyboard.down(k);
    await page.mouse.click(p.x, p.y);
    for (const k of opts.modifiers ?? []) await page.keyboard.up(k);
  };
  const emptySpot = toScreen(420, 260);

  step = 'canvas first';
  await check(async () => (await canvas.isVisible()) && (await page.getByTestId('inspector').count()) === 0, 'the game canvas fills the window; no inspector panel by default');
  await check(async () => (await prompts.count()) === 0, 'no prompt is visible when nothing is selected');
  await check(async () => (await page.getByTestId('library-panel').count()) === 0, 'library is closed until asked for');

  step = 'build a level from the library';
  const drop = async (name, wx, wy) => {
    if ((await page.getByTestId('library-panel').count()) === 0) await page.getByTestId('dock-library').click();
    await page.dragAndDrop(`[data-testid="definition-${name}"]`, '[data-testid="viewport-canvas"]', { targetPosition: { x: center.x + wx, y: center.y + wy } });
  };
  await drop('Player', -256, 0);
  await check(async () => (await page.getByTestId('library-panel').count()) === 0, 'library closes after placing, giving the canvas back');
  const entityCount = async () => Number(await canvas.getAttribute('data-entities'));

  step = 'draw tiles with the brush';
  await page.getByTestId('dock-library').click();
  await page.screenshot({ path: `${OUT}/0-objects-panel.png` });
  await page.getByTestId('definition-Platform').click();
  await check(async () => (await page.getByTestId('tool-pen').getAttribute('aria-pressed')) === 'true' && (await page.getByTestId('library-panel').count()) === 0, 'clicking a library object picks up the pen with it and gives the canvas back');
  await check(async () => (await page.locator('.brush-chip').count()) === 0, 'no instructions panel while drawing');
  await check(async () => (await prompts.count()) === 0, 'drawing clears the selection, so no prompt is in the way');
  let p0 = toScreen(-250, 40);
  let p1 = toScreen(-90, 40);
  await page.mouse.move(p0.x, p0.y);
  await page.mouse.down();
  await page.mouse.move(p1.x, p1.y, { steps: 3 });
  await page.mouse.up();
  await check(async () => (await entityCount()) === 1 + 6, 'one drag draws a continuous row of 6 tiles (no gaps even with a fast stroke)');
  await page.mouse.move(p0.x, p0.y);
  await page.mouse.down();
  await page.mouse.move(p1.x, p1.y, { steps: 8 });
  await page.mouse.up();
  await check(async () => (await entityCount()) === 7, 'drawing over existing tiles does not stack duplicates');
  const single = toScreen(40, 136);
  await page.mouse.click(single.x, single.y);
  await check(async () => (await entityCount()) === 8, 'a single click draws one tile');
  await page.mouse.click(single.x, single.y, { button: 'right' });
  await check(async () => (await entityCount()) === 7, 'right-click erases a tile');
  await page.getByTestId('undo').click();
  await check(async () => (await entityCount()) === 8, 'each stroke is one undo step');
  await page.getByTestId('redo').click();
  await page.getByTestId('tool-select').click();
  await check(async () => (await page.getByTestId('tool-select').getAttribute('aria-pressed')) === 'true', 'the arrow tool puts the pen away');
  await page.getByTestId('tool-pen').click();
  await check(async () => (await page.getByTestId('tool-brush-pick').getAttribute('title')).includes('Platform'), 'the pen picks up the last object drawn with');
  await page.keyboard.press('Escape');
  await check(async () => (await page.getByTestId('tool-select').getAttribute('aria-pressed')) === 'true', 'Esc returns to the arrow');

  step = 'ladder';
  await page.getByTestId('dock-library').click();
  await page.getByTestId('definition-Ladder').click();
  const l0 = toScreen(-80, -48);
  const l1 = toScreen(-80, 16);
  await page.mouse.move(l0.x, l0.y);
  await page.mouse.down();
  await page.mouse.move(l1.x, l1.y, { steps: 4 });
  await page.mouse.up();
  await check(async () => (await entityCount()) === 7 + 3, 'dragging down with the pen draws a 3-segment ladder');
  await page.screenshot({ path: `${OUT}/0-drawn-tiles.png` });
  await page.getByTestId('undo').click();
  await page.getByTestId('tool-select').click();

  step = 'move one tile';
  const tile = toScreen(-112, 48);
  await page.mouse.click(tile.x, tile.y);
  await check(async () => (await prompts.count()) === 1, 'clicking a drawn tile selects just that tile');
  await page.mouse.move(tile.x, tile.y);
  await page.mouse.down();
  await page.mouse.move(tile.x + 20, tile.y - 50, { steps: 5 });
  await page.mouse.up();
  await prompts.getByTestId('prompt-details').click();
  await check(async () => (await page.getByTestId('transform-position.x').inputValue()) === '-80' && (await page.getByTestId('transform-position.y').inputValue()) === '-16', 'dragging a tile moves it by whole cells (snaps to the tile grid)');
  await page.getByTestId('close-details').click();
  await page.getByTestId('undo').click();
  await page.keyboard.press('Escape');

  step = 'place characters';
  await drop('Enemy', -32, 0);
  await drop('Enemy', 96, 0);
  await drop('Door', 224, -16);
  await page.mouse.click(emptySpot.x, emptySpot.y);
  await check(async () => (await prompts.count()) === 0, 'clicking empty space deselects and removes the prompt');
  await page.screenshot({ path: `${OUT}/1-clean-canvas.png` });

  step = 'golden test 1: player';
  await clickWorld(-256, 0);
  await check(async () => (await prompts.count()) === 1, 'clicking the Player shows exactly one prompt');
  await check(async () => (await prompts.getAttribute('data-context')) === 'entity', 'the prompt is bound to the selected entity');
  await check(async () => (await page.evaluate(() => document.activeElement?.tagName)) !== 'TEXTAREA', 'the first click selects without stealing focus');
  await check(async () => (await promptInput.getAttribute('placeholder')) === 'Type a command…', 'the prompt is a plain input with a minimal placeholder');
  const pBox = await prompts.boundingBox();
  const player = toScreen(-256, 0);
  await check(pBox.y + pBox.height < player.y && Math.abs(pBox.x + pBox.width / 2 - player.x) < 40, 'the prompt sits just above the Player, centered on it');
  await page.screenshot({ path: `${OUT}/2-player-selected.png` });
  await canvas.focus();
  await page.keyboard.press('Enter');
  await check(async () => (await page.evaluate(() => document.activeElement?.tagName)) === 'TEXTAREA', 'Enter moves focus into the prompt');
  await ask('Give the player three hearts.');
  await check(async () => (await result.getAttribute('data-status')) === 'applied', 'the AI change is applied');
  await check(async () => (await result.innerText()).includes('Player: 3 hearts'), 'a short confirmation lists what changed');
  const last = aiRequests.at(-1);
  await check(last.context.scope === 'entity' && last.context.targets[0].name === 'Player', 'the AI received the selected Player as context');
  await check(last.context.otherEntities.some((e) => e.name === 'Door'), 'other objects are available to the AI by name');
  await page.screenshot({ path: `${OUT}/3-applied.png` });
  await prompts.getByTestId('prompt-details').click();
  await check(async () => (await page.getByTestId('field-Health.maxHealth').inputValue()) === '3', 'the details drawer shows the new Health component (max 3)');
  await page.getByTestId('close-details').click();

  step = 'undo/redo';
  await page.getByTestId('undo').click();
  await prompts.getByTestId('prompt-details').click();
  await check(async () => (await page.getByTestId('component-Health').count()) === 0, 'Undo removes the AI change as one step');
  await page.getByTestId('redo').click();
  await check(async () => (await page.getByTestId('component-Health').count()) === 1, 'Redo restores it');
  await page.getByTestId('close-details').click();

  step = 'golden test 2: enemy';
  await clickWorld(-32, 0);
  await check(async () => (await prompts.count()) === 1, 'selecting the Enemy replaces the Player prompt (still one prompt)');
  await check(async () => !(await result.count()), 'the new prompt starts fresh');
  await ask('Make the enemy patrol between these two points.');
  await check(async () => (await result.getAttribute('data-status')) === 'message', 'an unsupported request gets a plain explanation');
  await check(async () => (await result.innerText()).includes("can't patrol yet"), 'the AI says what is missing instead of faking it');
  await check(aiRequests.at(-1).context.targets[0].name === 'Enemy', 'the AI received the Enemy as context');

  step = 'relationship context';
  await clickWorld(224, -16, { modifiers: ['Shift'] });
  await check(async () => (await prompts.getAttribute('data-context')) === 'pair', 'two selected objects give one relationship prompt');
  await ask('Make the key open the door.');
  await check(async () => (await result.count()) === 1, 'the relationship request gets an answer');
  const pairReq = aiRequests.at(-1);
  await check(pairReq.context.scope === 'pair' && pairReq.context.targets.map((t) => t.name).join('>') === 'Enemy>Door', 'both objects are sent, in selection order');
  await page.screenshot({ path: `${OUT}/4-relationship.png` });

  step = 'golden test 6: group';
  const a = toScreen(-70, -60);
  const b = toScreen(140, 20);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 6 });
  await page.mouse.up();
  await check(async () => (await prompts.getAttribute('data-context')) === 'pair', 'box-selecting the two enemies gives one shared prompt');
  await clickWorld(-256, 0, { modifiers: ['Shift'] });
  await check(async () => (await prompts.getAttribute('data-context')) === 'group' && (await prompts.count()) === 1, 'three selected objects still give one shared prompt');
  await ask('Make these enemies move faster.');
  await check(async () => (await result.getAttribute('data-status')) === 'proposal', 'a multi-object change is shown as a preview first');
  await check(async () => (await result.locator('.changes li').count()) === 3, 'the preview lists one line per affected object');
  await page.screenshot({ path: `${OUT}/5-preview.png` });
  await prompts.getByTestId('proposal-cancel').click();
  await check(async () => (await result.count()) === 0, 'Cancel discards the preview without changing anything');

  step = 'golden test 5: world';
  await page.mouse.dblclick(emptySpot.x, emptySpot.y);
  await check(async () => (await prompts.getAttribute('data-context')) === 'level', 'double-clicking empty space makes the level the context');
  await page.screenshot({ path: `${OUT}/5b-world-context.png` });
  await ask('Make gravity 30% weaker.');
  await check(async () => (await result.getAttribute('data-status')) === 'applied', 'world change applied');
  await check(async () => (await result.innerText()).includes('980 → 686'), 'confirmation shows the gravity change');
  await prompts.getByTestId('prompt-details').click();
  await check(async () => (await page.getByTestId('world-gravity.y').inputValue()) === '686', 'level gravity is now 686');
  await page.getByTestId('close-details').click();
  await page.keyboard.press('Escape');
  await check(async () => (await prompts.count()) === 0, 'Escape clears the context');

  step = 'golden test 7: create with AI';
  await page.getByTestId('dock-create').click();
  const create = page.getByTestId('create-prompt');
  await check(async () => (await page.evaluate(() => document.activeElement?.tagName)) === 'TEXTAREA', 'Create opens a focused prompt');
  await create.getByTestId('prompt-input').fill('Create a flying robot enemy that shoots lasers.');
  await create.getByTestId('prompt-input').press('Enter');
  await check(async () => (await create.getByTestId('prompt-result').getAttribute('data-status')) === 'proposal', 'creation is previewed before it happens');
  await page.screenshot({ path: `${OUT}/6-create-preview.png` });
  await create.getByTestId('proposal-apply').click();
  await check(async () => (await create.locator('[data-testid="definition-Flying Robot"]').count()) === 1, 'the new object is offered right away, ready to drag');
  await page.dragAndDrop('[data-testid="create-prompt"] [data-testid="definition-Flying Robot"]', '[data-testid="viewport-canvas"]', { targetPosition: { x: center.x + 96, y: center.y - 160 } });
  await page.mouse.click(emptySpot.x, emptySpot.y);
  await clickWorld(96, -160);
  await check(async () => (await prompts.count()) === 1, 'clicking the new robot gives it the same contextual prompt');
  await ask('Give the robot three hearts.');
  await check(async () => (await result.getAttribute('data-status')) === 'applied', 'the new object can be changed like any other');
  await page.getByTestId('dock-library').click();
  await page.locator('.category', { hasText: 'Enemies' }).click();
  await check(async () => (await page.locator('[data-testid="object-library"] .tile').count()) === 2, 'the library files the robot under Enemies');
  await page.keyboard.press('Escape');

  step = 'sprites';
  await page.keyboard.press('Escape');
  await page.getByTestId('dock-library').click();
  await page.getByTestId('definition-Enemy').click({ button: 'right' });
  await check(async () => (await page.getByTestId('object-menu').innerText()).replace(/\s+/g, ' ').trim() === 'Inspector Sprites Reset to default', 'right-clicking a built-in object offers Inspector, Sprites and Reset to default');
  await page.getByTestId('menu-sprites').click();
  const sp = page.getByTestId('sprites-panel');
  await check(async () => (await sp.isVisible()) && (await page.getByTestId('library-panel').count()) === 0, 'Sprites opens a panel for the object');
  // A 4x2 sheet of 16px cells: transparent background, sprites of two sizes centered in their cells.
  const sheetPng = await page.evaluate(() => {
    const c = document.createElement('canvas');
    c.width = 64;
    c.height = 32;
    const g = c.getContext('2d');
    const colors = ['#e74c3c', '#e67e22', '#f1c40f', '#2ecc71', '#1abc9c', '#3498db', '#9b59b6', '#ecf0f1'];
    for (let i = 0; i < 8; i++) {
      const size = i % 2 ? 8 : 12;
      g.fillStyle = colors[i];
      g.fillRect((i % 4) * 16 + (16 - size) / 2, Math.floor(i / 4) * 16 + (16 - size) / 2, size, size);
    }
    return c.toDataURL('image/png').split(',')[1];
  });
  await sp.getByTestId('sprite-sheet-file').setInputFiles({ name: 'robots.png', mimeType: 'image/png', buffer: Buffer.from(sheetPng, 'base64') });
  const cells = sp.locator('.sheet-cell');
  await check(async () => (await cells.count()) === 8, 'importing a sprite sheet detects its 4×2 grid of numbered cells');
  await check(async () => (await sp.getByTestId('grid-cellWidth').inputValue()) === '16' && (await sp.getByTestId('grid-columns').inputValue()) === '4', 'the detected cells are 16px, 4 columns');
  await page.screenshot({ path: `${OUT}/10-sprite-sheet.png` });
  await sp.getByTestId('cell-6').click();
  await check(async () => (await sp.getByTestId('cell-6').getAttribute('class')).includes('on'), 'clicking cell 6 makes it the object\'s sprite');
  await check(async () => (await sp.getByTestId('sprite-list').innerText()).includes('robots #6'), 'the chosen cell is added to the object\'s sprites');
  await sp.getByTestId('grid-columns').fill('2');
  await check(async () => (await cells.count()) === 4, 'the grid can be placed by hand (2 columns → 4 cells)');
  await sp.getByTestId('detect-grid').click();
  await check(async () => (await cells.count()) === 8, 'Detect grid restores the detected layout');
  await sp.getByTestId('sprite-image-file').setInputFiles({ name: 'robot-single.png', mimeType: 'image/png', buffer: Buffer.from(sheetPng, 'base64') });
  await check(async () => (await sp.getByTestId('sprite-list').innerText()).includes('robot-single'), 'a single image can be imported as a sprite');
  await sp.locator('.sprite-use', { hasText: 'robots #6' }).click();
  await page.keyboard.press('Escape');
  await check(async () => (await sp.count()) === 0, 'Esc closes the Sprites panel');

  step = 'sprite and collider size link';
  await clickWorld(-32, 0);
  await prompts.getByTestId('prompt-details').click();
  await check(async () => (await page.getByTestId('size-link').first().getAttribute('aria-pressed')) === 'true', 'sprite and collider sizes start linked');
  await page.getByTestId('field-Sprite.width').fill('48');
  await page.getByTestId('field-Sprite.width').press('Enter');
  await check(async () => (await page.getByTestId('field-Collider.size.x').inputValue()) === '48', 'changing the sprite width changes the collider width');
  await page.getByTestId('field-Collider.size.y').fill('20');
  await page.getByTestId('field-Collider.size.y').press('Enter');
  await check(async () => (await page.getByTestId('field-Sprite.height').inputValue()) === '20', 'changing the collider height changes the sprite height');
  await page.screenshot({ path: `${OUT}/11-linked-inspector.png` });
  await page.getByTestId('size-link').first().click();
  await check(async () => (await page.getByTestId('size-link').first().getAttribute('aria-pressed')) === 'false', 'the link can be broken');
  await page.getByTestId('field-Sprite.width').fill('64');
  await page.getByTestId('field-Sprite.width').press('Enter');
  await check(async () => (await page.getByTestId('field-Collider.size.x').inputValue()) === '48', 'unlinked, the collider keeps its own size');
  await check(async () => (await page.getByTestId('field-Sprite.frame').inputValue()) === '6', 'the placed enemy uses sprite #6 from its object');
  await page.getByTestId('close-details').click();
  await page.keyboard.press('Escape');
  await page.getByTestId('dock-library').click();
  await page.getByTestId('definition-Enemy').click({ button: 'right' });
  await page.getByTestId('menu-inspector').click();
  await check(async () => (await page.getByTestId('definition-inspector').isVisible()) && (await page.getByTestId('definition-name').inputValue()) === 'Enemy', 'Inspector opens the object\'s details');
  await page.getByTestId('close-details').click();

  step = 'history';
  await page.getByTestId('tray-toggle').click();
  await check(async () => (await page.getByTestId('history-list').innerText()).includes('✨ Give the player three hearts.'), 'AI changes appear in History');
  await page.screenshot({ path: `${OUT}/7-history.png` });

  step = 'background';
  await page.getByTestId('tray').getByRole('button', { name: 'Close' }).click();
  await page.getByTestId('tool-background').click();
  const bgPanel = page.getByTestId('background-panel');
  await check(async () => (await bgPanel.isVisible()) && (await prompts.count()) === 0, 'the background card opens (and is the only card)');
  await bgPanel.getByRole('radio', { name: 'Sunset' }).click();
  await check(async () => (await bgPanel.getByRole('radio', { name: 'Sunset' }).getAttribute('aria-checked')) === 'true', 'choosing a swatch sets the background color');
  // A small generated image stands in for a user's picture.
  const bgPng = await page.evaluate(() => {
    const c = document.createElement('canvas');
    c.width = 64;
    c.height = 32;
    const g = c.getContext('2d');
    g.fillStyle = '#334488';
    g.fillRect(0, 0, 64, 32);
    g.fillStyle = '#ffffff';
    g.fillRect(8, 8, 12, 6);
    return c.toDataURL('image/png').split(',')[1];
  });
  await bgPanel.getByTestId('bg-file').setInputFiles({ name: 'mountains.png', mimeType: 'image/png', buffer: Buffer.from(bgPng, 'base64') });
  await check(async () => (await bgPanel.locator('.bg-image img').count()) === 1 && (await bgPanel.innerText()).includes('64×32'), 'an uploaded image becomes the background');
  await check(async () => (await bgPanel.getByTestId('bg-parallax').count()) === 1, 'fit and movement controls appear for the image');
  await bgPanel.getByTestId('background-prompt').getByTestId('prompt-input').fill('The background should move sideways along with the level.');
  await bgPanel.getByTestId('background-prompt').getByTestId('prompt-input').press('Enter');
  await check(async () => (await bgPanel.getByTestId('bg-parallax').inputValue()) === '50', 'a background prompt changes how it moves (50%)');
  await check(aiRequests.at(-1).context.scope === 'background' && aiRequests.at(-1).context.level.background.image?.name === 'mountains', 'the AI is told it is editing the background, including the image');
  await page.screenshot({ path: `${OUT}/8-background.png` });
  await page.getByTestId('tool-background').click();
  await check(async () => (await bgPanel.count()) === 0, 'the background card closes again');

  step = 'console tray';
  const stageBox = await canvas.boundingBox();
  await page.getByTestId('console-toggle').click();
  await page.getByRole('tab', { name: /AI History/ }).click();
  await page.getByRole('tab', { name: /Console/ }).click();
  await page.getByTestId('tray').getByRole('button', { name: 'Close' }).click();
  await check(async () => {
    const b = await canvas.boundingBox();
    const scrolled = await page.evaluate(() => [document.scrollingElement.scrollTop, document.querySelector('.stage').scrollTop, document.querySelector('.editor').scrollTop].some((v) => v !== 0));
    return !scrolled && b.y === stageBox.y && b.height === stageBox.height;
  }, 'switching console tabs and minimising leaves the editor in place');

  step = 'play';
  await clickWorld(-256, 0);
  await prompts.getByTestId('prompt-details').click();
  const posBefore = [await page.getByTestId('transform-position.x').inputValue(), await page.getByTestId('transform-position.y').inputValue()];
  await page.getByTestId('close-details').click();
  const undoTitle = await page.getByTestId('undo').getAttribute('title');
  await page.getByTestId('play').click();
  const play = page.getByTestId('play-canvas');
  await check(async () => (await play.isVisible()) && (await page.getByTestId('viewport-canvas').count()) === 0, 'Play replaces the editor with the running game');
  await check(async () => (await page.getByTestId('dock-create').count()) === 0 && (await page.getByTestId('tool-panel').count()) === 0 && (await prompts.count()) === 0, 'editor tools and prompts disappear while playing');
  const ps = async () => ((await play.getAttribute('data-player')) ?? '').split(',').map(Number);
  await check(async () => {
    const [, y, grounded] = await ps();
    return grounded === 1 && Math.abs(y - 16) < 0.5;
  }, 'the player (one tile tall) falls and lands on the drawn platform (y = 16)');
  await page.keyboard.down('ArrowUp');
  await page.waitForTimeout(300);
  await page.keyboard.up('ArrowUp');
  await check(async () => {
    const [, y, grounded] = await ps();
    return grounded === 1 && Math.abs(y - 16) < 0.5;
  }, 'Up does not jump');
  const [startX] = await ps();
  await page.keyboard.down('ArrowRight');
  await page.waitForTimeout(500);
  await page.keyboard.up('ArrowRight');
  await check(async () => (await ps())[0] > startX + 40, 'holding → runs right');
  await page.waitForTimeout(400);
  await page.keyboard.down('Space');
  let jumped = false;
  for (let i = 0; i < 30 && !jumped; i++) {
    await page.waitForTimeout(20);
    jumped = (await ps())[1] < 16 - 32;
  }
  await page.keyboard.up('Space');
  await check(jumped, 'Space jumps higher than one tile');
  await check(async () => (await ps())[2] === 1, 'and lands again');
  await page.screenshot({ path: `${OUT}/12-play.png` });
  await page.keyboard.press('Escape');
  await check(async () => (await page.getByTestId('viewport-canvas').isVisible()) && (await play.count()) === 0, 'Esc stops the game and returns to the editor');
  await check(async () => (await page.getByTestId('undo').getAttribute('title')) === undoTitle, 'playing made no edits (undo history unchanged)');
  await clickWorld(-256, 0);
  await prompts.getByTestId('prompt-details').click();
  await check(async () => [await page.getByTestId('transform-position.x').inputValue(), await page.getByTestId('transform-position.y').inputValue()].join() === posBefore.join(), 'the player is back at its editor position (runtime state was thrown away)');
  await page.getByTestId('close-details').click();
  await page.keyboard.press('Control+Enter');
  await check(async () => await play.isVisible(), 'Ctrl+Enter starts playing too');
  await page.getByTestId('play').click();
  await check(async () => await page.getByTestId('viewport-canvas').isVisible(), 'the Stop button stops');
  await page.keyboard.press('Escape');

  step = 'navigation';
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  const cam = async () => (await canvas.getAttribute('data-camera')).split(',').map(Number);
  const mid = toScreen(150, -220); // open sky, away from the tray and dock
  await page.mouse.move(mid.x, mid.y);
  let [x0, y0, z0] = await cam();
  for (let i = 0; i < 5; i++) await page.mouse.wheel(4, 6);
  await check(async () => {
    const [x, y, z] = await cam();
    return z === z0 && Math.abs(x - x0 - 20) < 0.2 && Math.abs(y - y0 - 30) < 0.2;
  }, 'two-finger trackpad scroll pans (x and y), without zooming');
  await page.waitForTimeout(500);
  [x0, y0, z0] = await cam();
  await page.keyboard.down('Alt');
  await page.mouse.wheel(0, -8);
  await page.keyboard.up('Alt');
  await check(async () => (await cam())[2] > z0, 'Alt + scroll zooms in');
  [, , z0] = await cam();
  await page.keyboard.down('Control');
  await page.mouse.wheel(0, 12);
  await page.keyboard.up('Control');
  await check(async () => (await cam())[2] < z0, 'pinch (reported as Ctrl + wheel) zooms out');
  await page.waitForTimeout(500);
  [, , z0] = await cam();
  await page.mouse.wheel(0, -100);
  await check(async () => (await cam())[2] > z0, 'a regular mouse wheel notch still zooms');
  [x0, y0] = await cam();
  await page.keyboard.down('Space');
  await page.mouse.move(mid.x, mid.y);
  await page.mouse.down();
  await page.mouse.move(mid.x - 80, mid.y - 40, { steps: 4 });
  await page.mouse.up();
  await page.keyboard.up('Space');
  await check(async () => {
    const [x, y] = await cam();
    return x > x0 && y > y0;
  }, 'Space + drag pans the view');
  [x0, y0] = await cam();
  await page.mouse.move(mid.x, mid.y);
  await page.mouse.down({ button: 'middle' });
  await page.mouse.move(mid.x + 60, mid.y + 60, { steps: 4 });
  await page.mouse.up({ button: 'middle' });
  await check(async () => {
    const [x, y] = await cam();
    return x < x0 && y < y0;
  }, 'middle-button drag pans the view');
  await check(async () => (await prompts.count()) === 0, 'panning does not select anything');

  step = 'save and reload';
  await page.waitForTimeout(500);
  await page.reload();
  await page.getByTestId('dock-library').click();
  await check(async () => (await page.locator('[data-testid="definition-Flying Robot"]').count()) === 1, 'AI-created objects survive a reload (autosave)');

  step = 'no AI connection';
  await page.unroute('**/api/ai');
  await page.keyboard.press('Escape');
  await clickWorld(-256, 0);
  await ask('Give the player a jetpack.');
  await check(async () => (await result.getAttribute('data-status')) === 'error', 'without an API key the real endpoint answers with an error');
  await check(async () => /not connected/i.test(await result.innerText()), 'the prompt says plainly that AI is not connected');

  step = 'reset objects / new project';
  await page.keyboard.press('Escape');
  const openLibrary = async () => {
    if ((await page.getByTestId('library-panel').count()) === 0) await page.getByTestId('dock-library').click();
  };
  const openPlayerDetails = async () => {
    await openLibrary();
    await page.getByTestId('definition-Player').click({ button: 'right' });
    await page.getByTestId('menu-inspector').click();
  };
  const setJump = async (v) => {
    await page.getByTestId('field-CharacterController.jumpForce').fill(String(v));
    await page.getByTestId('field-CharacterController.jumpForce').press('Enter');
  };
  await openPlayerDetails();
  await setJump(900);
  await check(async () => (await page.getByTestId('field-CharacterController.jumpForce').inputValue()) === '900', 'the Player object was edited (jumpForce 900)');
  const levelSize = await canvas.getAttribute('data-entities');
  await page.getByTestId('project-menu').click();
  await check(async () => (await page.getByTestId('project-menu-pop').innerText()).includes('Reset objects to defaults'), 'the project menu (on the project name) offers New, Open, Save and Reset objects');
  await page.getByTestId('menu-reset-objects').click();
  await check(async () => (await page.getByTestId('field-CharacterController.jumpForce').inputValue()) === '295', 'Reset objects to defaults puts the Player back (jumpForce 295)');
  await check(async () => (await canvas.getAttribute('data-entities')) === levelSize, 'and keeps the level as it is');
  await check(async () => (await page.getByTestId('definition-name').count()) === 1, 'the inspector stays on the reset object');
  await page.getByTestId('undo').click();
  await check(async () => (await page.getByTestId('field-CharacterController.jumpForce').inputValue()) === '900', 'Undo brings the edited version back');
  await page.getByTestId('close-details').click();
  await openLibrary();
  await page.getByTestId('definition-Player').click({ button: 'right' });
  await page.getByTestId('menu-reset').click();
  await openPlayerDetails();
  await check(async () => (await page.getByTestId('field-CharacterController.jumpForce').inputValue()) === '295', 'right-click → Reset to default resets one object');
  await page.getByTestId('close-details').click();
  await page.getByTestId('project-menu').click();
  await page.getByTestId('menu-new').click();
  await check(async () => (await canvas.getAttribute('data-entities')) === '0', 'New project starts an empty level');
  await openLibrary();
  await check(async () => (await page.getByTestId('definition-Flying Robot').count()) === 0 && (await page.getByTestId('definition-Ladder').count()) === 1, 'with only the built-in objects, as they ship');
  await page.keyboard.press('Escape');

  step = 'old autosave upgrade';
  const old = await browser.newContext({ viewport: { width: 1400, height: 860 } });
  const oldPage = await old.newPage();
  oldPage.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  await oldPage.addInitScript(() => {
    const platform = {
      id: 'def_platform', name: 'Platform', description: 'Solid, static ground.', tags: ['platform'], metadata: {},
      components: {
        Sprite: { assetId: null, width: 160, height: 24, color: '#6b7a8f', visible: true },
        Collider: { shape: 'box', size: { x: 160, y: 24 }, offset: { x: 0, y: 0 }, isTrigger: false },
        PhysicsBody: { bodyType: 'static', mass: 1, velocity: { x: 0, y: 0 }, gravityScale: 1, friction: 0.2 },
      },
    };
    const scene = {
      id: 'scn_1', name: 'Level 1', world: { gravity: { x: 0, y: 980 }, backgroundColor: '#1d2330' },
      entities: [{ id: 'ent_a', name: 'Platform', definitionId: 'def_platform', transform: { position: { x: 0, y: 64 }, rotation: 0, scale: { x: 1, y: 1 } }, components: {}, removedComponents: [], tags: [], metadata: {} }],
    };
    const bundle = { kind: 'pxlbuilder.bundle', bundleVersion: 1, files: {
      'project.json': { formatVersion: 1, id: 'prj_1', name: 'Old Game', settings: { gridSize: 16 }, startSceneId: 'scn_1', scenes: [{ id: 'scn_1', name: 'Level 1', file: 'scenes/scn_1.json' }], objects: [{ id: 'def_platform', name: 'Platform', file: 'objects/def_platform.json' }], assets: [] },
      'scenes/scn_1.json': scene,
      'objects/def_platform.json': platform,
    } };
    if (!sessionStorage.getItem('seeded')) {
      localStorage.setItem('pxlbuilder.autosave', JSON.stringify(bundle));
      sessionStorage.setItem('seeded', '1');
    }
  });
  await oldPage.goto(URL);
  const oldCanvas = oldPage.getByTestId('viewport-canvas');
  await check(async () => (await oldCanvas.getAttribute('data-entities')) === '5', 'an old autosave with a wide platform opens as a row of 5 square tiles');
  await oldPage.getByTestId('dock-library').click();
  await check(async () => (await oldPage.getByTestId('definition-Ladder').count()) === 1 && (await oldPage.getByTestId('definition-Stone').count()) === 1, 'the upgraded project gets the new Ladder and Stone objects');
  await oldPage.screenshot({ path: `${OUT}/9-upgraded-autosave.png` });
  await old.close();

  step = 'console errors';
  await check(errors.length === 0, `no page/console errors${errors.length ? ': ' + errors.join(' | ') : ''}`);
  console.log(`\nE2E passed (${passed} checks).`);
} catch (e) {
  console.error(`\nE2E FAILED: ${e.message}`);
  console.error(`step: ${step}`);
  await browser.contexts()[0]?.pages()[0]?.screenshot({ path: `${OUT}/failure.png` }).catch(() => {});
  if (errors.length) console.error(errors.join('\n'));
  process.exitCode = 1;
} finally {
  await browser.close();
  server.kill();
}
