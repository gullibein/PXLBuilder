// End-to-end smoke test: builds the app, serves it, and drives the real editor
// in headless Chromium. Usage: npm run test:e2e
import { spawn, execSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const PORT = 4179;
const URL = `http://localhost:${PORT}/`;
const OUT = 'test-results';
mkdirSync(OUT, { recursive: true });

execSync('npx vite build', { stdio: 'inherit' });
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'pipe' });
await new Promise((resolve, reject) => {
  server.stdout.on('data', (d) => d.toString().includes(String(PORT)) && resolve());
  server.on('exit', (code) => reject(new Error(`preview exited ${code}`)));
});

const executablePath = existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined;
const browser = await chromium.launch({ executablePath });
const errors = [];
let step = '';
// Polls an async condition (UI updates render asynchronously) for up to 3s.
const check = async (cond, msg) => {
  const deadline = Date.now() + 3000;
  for (;;) {
    if (typeof cond === 'function' ? await cond() : cond) break;
    if (Date.now() > deadline) throw new Error(`[${step}] ${msg}`);
    await new Promise((r) => setTimeout(r, 50));
  }
  console.log(`  ✓ ${msg}`);
};

try {
  const context = await browser.newContext({ viewport: { width: 1400, height: 860 }, acceptDownloads: true });
  const page = await context.newPage();
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && errors.push(`console: ${m.text()}`));
  await page.goto(URL);

  const canvas = page.getByTestId('viewport-canvas');
  const box = await canvas.boundingBox();
  const center = { x: box.width / 2, y: box.height / 2 };
  // Camera starts at world (0,0), zoom 1: world = canvas-local point - center.
  const toScreen = (wx, wy) => ({ x: box.x + center.x + wx, y: box.y + center.y + wy });
  const outlineCount = () => page.locator('[data-testid="outline"] li:not(.static)').count();

  step = 'startup';
  await check(async () => (await page.locator('[data-testid="object-library"] li').count()) === 6, 'object library lists 6 starter definitions');
  await check(async () => await page.getByTestId('scene-inspector').isVisible(), 'inspector shows scene settings with nothing selected');

  step = 'place objects';
  const drop = async (name, wx, wy) =>
    page.dragAndDrop(`[data-testid="definition-${name}"]`, '[data-testid="viewport-canvas"]', { targetPosition: { x: center.x + wx, y: center.y + wy } });
  await drop('Player', -96, -64);
  await drop('Platform', -96, 32);
  await drop('Platform', 160, 0);
  await check(async () => (await outlineCount()) === 3, 'three entities placed via drag and drop');
  await check(async () => (await page.getByTestId('entity-name').inputValue()) === 'Platform 2', 'last placed entity is selected and auto-named');
  await check(async () => (await page.getByTestId('transform-position.x').inputValue()) === '160', 'drop position is grid-snapped into the transform');

  step = 'select + move';
  let p = toScreen(-96, -64);
  await page.mouse.click(p.x, p.y);
  await check(async () => (await page.getByTestId('entity-name').inputValue()) === 'Player', 'clicking in the viewport selects the Player');
  await page.mouse.move(p.x, p.y);
  await page.mouse.down();
  await page.mouse.move(p.x + 40, p.y - 10, { steps: 5 });
  await page.mouse.move(p.x + 64, p.y - 16, { steps: 5 });
  await page.mouse.up();
  await check(async () => (await page.getByTestId('transform-position.x').inputValue()) === '-32', 'dragging moves the entity (x snapped to -32)');
  await check(async () => (await page.getByTestId('transform-position.y').inputValue()) === '-80', 'dragging moves the entity (y snapped to -80)');

  step = 'inspector edits';
  const speed = page.getByTestId('field-CharacterController.speed');
  await speed.fill('320');
  await speed.press('Enter');
  await check(async () => (await speed.inputValue()) === '320', 'component field edit is applied');
  await check(async () => (await page.locator('[data-testid="component-CharacterController"] .row.overridden').count()) === 1, 'edited field is marked as instance override');
  await page.getByTestId('add-component').selectOption('Health');
  await check(async () => await page.getByTestId('component-Health').isVisible(), 'Health component added from the registry');
  const maxHealth = page.getByTestId('field-Health.maxHealth');
  await maxHealth.fill('2.5');
  await maxHealth.press('Enter');
  await check(async () => (await maxHealth.inputValue()) === '3', 'invalid value (non-integer health) is rejected');
  await check(async () => (await page.getByTestId('console').innerText()).includes('must be an integer'), 'rejection is reported in the console');
  await page.getByTestId('entity-tags').fill('hero, Tutorial');
  await page.getByTestId('entity-tags').press('Enter');
  await check(async () => (await page.getByTestId('entity-tags').inputValue()) === 'hero, tutorial', 'tags are saved normalized');

  await page.screenshot({ path: `${OUT}/entity-inspector.png` });

  step = 'definition editing';
  await page.getByTestId('definition-Platform').click();
  await check(async () => await page.getByTestId('definition-inspector').isVisible(), 'selecting a library item opens the definition inspector');
  await check(async () => (await page.getByTestId('definition-inspector').innerText()).includes('2 instances'), 'definition reports its instance count');
  await page.getByTestId('field-Sprite.color').fill('#22aa55');
  await page.locator('[data-testid="outline"] li', { hasText: 'Platform 2' }).click();
  await check(async () => (await page.getByTestId('field-Sprite.color').inputValue()) === '#22aa55', 'definition change propagates to instances');

  step = 'multi-select';
  await page.mouse.move(box.x + 10, box.y + 10);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width - 10, box.y + box.height - 10, { steps: 8 });
  await page.mouse.up();
  await check(async () => (await page.getByTestId('multi-inspector').innerText()).includes('3 entities selected'), 'marquee selects all three entities');
  await canvas.focus();
  await page.keyboard.press('Control+d');
  await check(async () => (await outlineCount()) === 6, 'Ctrl+D duplicates the selection');
  await page.keyboard.press('Delete');
  await check(async () => (await outlineCount()) === 3, 'Delete removes the selection');

  step = 'world settings';
  await page.keyboard.press('Escape');
  await page.getByTestId('world-gravity.y').fill('490');
  await page.getByTestId('world-gravity.y').press('Enter');
  await check(async () => (await page.getByTestId('world-gravity.y').inputValue()) === '490', 'world gravity edited');
  await page.screenshot({ path: `${OUT}/editor.png` });

  step = 'save to file';
  await page.getByTestId('menu-File').click();
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByTestId('menu-save').click()]);
  const savedPath = `${OUT}/${download.suggestedFilename()}`;
  await download.saveAs(savedPath);
  await check(savedPath.endsWith('.pxlproj.json'), `project downloaded as ${download.suggestedFilename()}`);

  step = 'autosave restore';
  await page.waitForTimeout(500);
  await page.reload();
  await check(async () => (await outlineCount()) === 3, 'reload restores the project from autosave');

  step = 'open from file';
  page.on('dialog', (d) => d.accept());
  await page.getByTestId('menu-File').click();
  await page.getByTestId('menu-new').click();
  await check(async () => (await outlineCount()) === 0, 'File > New gives an empty scene');
  await page.getByTestId('open-file-input').setInputFiles(savedPath);
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="outline"] li:not(.static)').length === 3);
  await check(true, 'opening the saved file restores 3 entities');
  await page.locator('[data-testid="outline"] li', { hasText: 'Player' }).click();
  await check(async () => (await page.getByTestId('field-CharacterController.speed').inputValue()) === '320', 'instance override survived save/load');
  await check(async () => (await page.getByTestId('field-Health.maxHealth').inputValue()) === '3', 'added component survived save/load');
  await check(async () => (await page.getByTestId('transform-position.x').inputValue()) === '-32', 'transform survived save/load');
  await page.keyboard.press('Escape');
  await check(async () => (await page.getByTestId('world-gravity.y').inputValue()) === '490', 'world settings survived save/load');

  step = 'console errors';
  await check(errors.length === 0, `no page/console errors${errors.length ? ': ' + errors.join(' | ') : ''}`);
  console.log('\nE2E smoke test passed.');
} catch (e) {
  console.error(`\nE2E FAILED: ${e.message}`);
  if (errors.length) console.error(errors.join('\n'));
  process.exitCode = 1;
} finally {
  await browser.close();
  server.kill();
}
