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
let diagnostics = null;
function stubModel(body) {
  aiRequests.push(body);
  const req = body.request.toLowerCase();
  const t = body.context.targets;
  if (req.includes('locked door test room')) {
    const lib = (name) => body.context.library.find((d) => d.name === name).id;
    const sceneId = body.context.level.id;
    return {
      kind: 'apply',
      message: 'Built a room with a door that needs the key.',
      changes: ['Ground, a player and a locked door'],
      operations: [
        { op: 'draw_tiles', sceneId, definitionRef: lib('Platform'), rects: [{ col: -4, row: 1, width: 12, height: 1 }] },
        { op: 'place_instance', sceneId, definitionRef: lib('Player'), x: 0, y: 16, name: null, ref: null },
        { op: 'place_instance', sceneId, definitionRef: lib('Door'), x: 112, y: 0, name: null, ref: null },
        { op: 'create_relationship', sceneId, relationshipJson: JSON.stringify({ type: 'requires', source: { kind: 'object', id: lib('Door') }, target: { kind: 'object', id: lib('Key') }, params: {}, conditions: [] }) },
      ],
    };
  }
  if (req.includes('coin up high')) {
    // First a coin the player can't reach (no platform or ladder up there); asked again with the problem, a reachable one.
    const retry = req.includes('could not be applied');
    const coin = body.context.library.find((d) => d.name === 'Coin').id;
    return {
      kind: 'apply',
      message: 'Added a coin.',
      changes: ['Coin: up high'],
      operations: [{ op: 'place_instance', sceneId: body.context.level.id, definitionRef: coin, x: retry ? 48 : 48, y: retry ? -4 : -140, name: null, ref: null }],
    };
  }
  if (req.startsWith('why didn')) {
    // A diagnosis from what the editor sends: the problems it found and the last play.
    const locked = body.context.debug.lastPlay?.events.find((e) => e.includes(' locked '));
    const problem = body.context.debug.problems.find((p) => p.severity === 'error');
    return { kind: 'answer', message: `The door works, but ${locked ? 'the player touched it without the key' : 'it was never touched'}. ${problem ? problem.text : ''}`, changes: [], operations: [] };
  }
  if (req.startsWith('fix this problem:')) {
    return {
      kind: 'preview',
      message: 'Placed a key before the door.',
      changes: ['Key: placed before the door'],
      operations: [{ op: 'place_instance', sceneId: body.context.level.id, definitionRef: body.context.library.find((d) => d.name === 'Key').id, x: 48, y: 20, name: null, ref: null }],
    };
  }
  if (req.includes('five hearts')) {
    const set = (field) => ({ op: 'set_component_field', target: 'instance', id: t[0].id, component: 'Health', field, valueJson: '5' });
    return { kind: 'apply', message: 'Gave the player 5 hearts.', changes: [`${t[0].name}: 5 hearts`], operations: [set('maxHealth'), set('currentHealth')] };
  }
  if (req.includes('three hearts')) {
    return { kind: 'apply', message: 'Gave the player 3 hearts.', changes: [`${t[0].name}: 3 hearts`], operations: [{ op: 'add_component', target: 'instance', id: t[0].id, component: 'Health', propsJson: '{"maxHealth":3,"currentHealth":3}' }] };
  }
  if (req.includes('hop toward the player')) {
    // First answer has a typo ("sped"); the editor sends the exact problem back and gets a fixed one.
    const fixed = req.includes('could not be applied');
    const script = {
      name: 'Hopper',
      description: 'Says hello, then hops toward the player when it is close.',
      vars: [{ name: 'speed', value: 90 }],
      states: [],
      handlers: [
        { when: { on: 'start' }, state: null, if: null, do: [{ do: 'message', text: 'Hopper ready ({speed})', seconds: 30 }] },
        { when: { on: 'every', seconds: 1 }, state: null, if: 'self.grounded and dist(player) < 400', do: [{ do: 'jump', force: '250' }, { do: 'velocity', x: `sign(dx(player)) * ${fixed ? 'speed' : 'sped'}`, y: null }] },
      ],
    };
    return { kind: 'apply', message: 'The enemy now hops toward the player.', changes: [`${t[0].name}: hops toward the player when close`], operations: [{ op: 'set_script', target: 'instance', id: t[0].id, scriptJson: JSON.stringify(script) }] };
  }
  if (req.includes('zoom the camera in')) {
    return { kind: 'apply', message: 'The camera is zoomed in 2× in play.', changes: ['Camera: zoom 1 → 2'], operations: [{ op: 'set_camera', sceneId: body.context.level.id, cameraJson: '{"zoom":2}' }] };
  }
  if (req.includes('broken twice')) {
    // Both the first answer and the corrected one have a part that can't be applied.
    return {
      kind: 'apply',
      message: 'Lower gravity, and a tidy-up.',
      changes: ['Gravity: 600', 'Removed an old connection'],
      operations: [
        { op: 'set_world', sceneId: body.context.level.id, gravityX: null, gravityY: 600, backgroundColor: null },
        { op: 'remove_relationship', sceneId: body.context.level.id, id: 'rel_does_not_exist' },
      ],
    };
  }
  if (req.includes('take your time') && req.includes('bigger')) {
    return { kind: 'apply', message: 'Made it bigger.', changes: [`${t[0].name}: wider`], operations: [{ op: 'set_component_field', target: 'instance', id: t[0].id, component: 'Sprite', field: 'color', valueJson: '"#00ff88"' }] };
  }
  if (req.includes('take your time') && req.includes('propose')) {
    return { kind: 'preview', message: 'Here is an idea: make it green.', changes: [`${t[0].name}: green`], operations: [{ op: 'set_component_field', target: 'instance', id: t[0].id, component: 'Sprite', field: 'color', valueJson: '"#00aa00"' }] };
  }
  if (req.includes('jumping sprite')) {
    const g = t[0].spriteGrid;
    const base = t[0].look.sprite?.pixelArt;
    // A variation of the current drawing: same palette and grid, a different pose (here: just shifted up a row).
    const rows = base ? [...base.rows.slice(1), base.rows[0]] : Array.from({ length: g.height }, () => 'j'.repeat(g.width));
    const palette = base ? base.palette : [{ key: 'j', color: '#ff00ff' }];
    return { kind: 'apply', message: 'Drew a jumping sprite; it shows while the player is in the air.', changes: ['Player: jumping sprite'], operations: [{ op: 'draw_sprite', target: 'definition', id: t[0].object.id, name: 'Player jumping', palette, rows, situation: 'jump' }] };
  }
  if (req.includes('patrol')) {
    return { kind: 'apply', message: 'The enemy now walks back and forth, turning at walls and ledges.', changes: [`${t[0].name}: patrols`], operations: [{ op: 'add_component', target: 'instance', id: t[0].id, component: 'Patrol', propsJson: '{"speed":60,"distance":64}' }] };
  }
  if (req.includes('jetpack')) {
    return { kind: 'unsupported', message: "Enemies can't fly with a jetpack yet: jetpacks aren't in this version.", changes: [], operations: [] };
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
  if (req.includes('look like spikes')) {
    const { width, height } = t[0].spriteGrid;
    const rows = Array.from({ length: height }, (_, y) =>
      Array.from({ length: width }, (_, x) => (y === height - 1 ? 'd' : Math.abs((x % 8) - 3.5) <= ((y + 1) * 4) / height ? 'g' : '.')).join(''),
    );
    return {
      kind: 'apply',
      message: `Gave every ${t[0].object.name} a spikes sprite.`,
      changes: [`${t[0].object.name}: looks like spikes (${width}×${height} pixels)`],
      operations: [{ op: 'draw_sprite', target: 'definition', id: t[0].object.id, name: 'Spikes', palette: [{ key: 'g', color: '#d9dde6' }, { key: 'd', color: '#5b6070' }], rows, situation: null }],
    };
  }
  if (req.includes('mushroom-enemies by jumping')) {
    const mushroom = body.context.library.find((d) => d.name === 'Mushroom');
    if (!mushroom) return { kind: 'answer', message: "There's no mushroom enemy in your library yet. Create one with + Create, place a few, then ask again.", changes: [], operations: [] };
    return {
      kind: 'apply',
      message: "I'll add this to the Mushroom enemy (every mushroom), not the player: landing on a mushroom defeats it. Other enemies still hurt.",
      changes: ['Mushroom: can be stomped by the player'],
      operations: [{ op: 'add_component', target: 'definition', id: mushroom.id, component: 'Stompable', propsJson: '{"stompers":["player"]}' }],
    };
  }
  if (req.includes('mushroom enemy')) {
    return {
      kind: 'preview',
      message: 'A walking mushroom enemy.',
      changes: ['New object: Mushroom'],
      operations: [{ op: 'create_definition', ref: 'm', name: 'Mushroom', description: 'A mushroom enemy.', category: 'Enemies', tags: ['enemy', 'mushroom'], components: [{ component: 'Sprite', propsJson: '{"width":28,"height":24,"color":"#c0563f"}' }, { component: 'Collider', propsJson: '{"size":{"x":28,"y":24}}' }, { component: 'PhysicsBody', propsJson: '{}' }, { component: 'Damage', propsJson: '{"amount":1}' }] }],
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
  if (req.includes('open this door') && t[0]?.components.Switch) {
    const relationship = { type: 'controls', source: { kind: 'entity', id: t[0].id }, target: { kind: 'entity', id: t[1].id } };
    return { kind: 'apply', message: `${t[0].name} now opens ${t[1].name}.`, changes: [`${t[0].name} controls ${t[1].name}`], operations: [{ op: 'create_relationship', sceneId: body.context.level.id, relationshipJson: JSON.stringify(relationship) }] };
  }
  if (req.includes('only if the player has the key')) {
    const rel = body.context.logic.relationships[0];
    const patch = { conditions: [{ type: 'has_item', entity: { kind: 'other' }, item: 'key', count: 1, not: false }] };
    return { kind: 'apply', message: 'The switch only works once the player has the key.', changes: ['Switch needs the key'], operations: [{ op: 'update_relationship', sceneId: body.context.level.id, id: rel.id, patchJson: JSON.stringify(patch) }] };
  }
  if (req.includes('picks up the key')) {
    const lib = (name) => body.context.library.find((d) => d.name === name).id;
    const rule = { name: 'Key found', when: { event: 'collected', subject: { kind: 'object', id: lib('Player') }, other: { kind: 'object', id: lib('Key') } }, actions: [{ type: 'show_message', text: 'Got the key!', seconds: 3 }] };
    return { kind: 'apply', message: 'Added a rule.', changes: ['When the player picks up a key: show "Got the key!"'], operations: [{ op: 'create_rule', sceneId: body.context.level.id, ruleJson: JSON.stringify(rule) }] };
  }
  if (req.includes('jump height')) {
    const playerId = body.context.library.find((d) => d.name === 'Player').id;
    const target = { kind: 'object', id: playerId };
    return {
      kind: 'apply',
      message: 'The jump height now shows above the player while editing.',
      changes: ['Player: jump height and distance shown', 'Player: jump arc shown'],
      operations: [
        { op: 'add_editor_overlay', overlayJson: JSON.stringify({ kind: 'info', target, show: ['jumpHeight', 'jumpDistance'] }) },
        { op: 'add_editor_overlay', overlayJson: JSON.stringify({ kind: 'jump_reach', target, show: [] }) },
      ],
    };
  }
  if (req.includes('generate a hard level')) {
    const sceneId = body.context.level.id;
    const lib = (name) => body.context.library.find((d) => d.name === name)?.id;
    const ops = [{ op: 'erase_area', sceneId, col: -50, row: -50, width: 100, height: 100, definitionRef: null }];
    const spikes = lib('Spikes') ?? 'spikes';
    if (!lib('Spikes')) ops.push({ op: 'create_definition', ref: 'spikes', name: 'Spikes', description: 'Hurts on touch.', category: 'Environment', tags: ['hazard'], components: [{ component: 'Sprite', propsJson: '{"width":32,"height":12,"color":"#c9ced8"}' }, { component: 'Collider', propsJson: '{"size":{"x":32,"y":12},"isTrigger":true}' }, { component: 'Damage', propsJson: '{"amount":1}' }] });
    ops.push({ op: 'create_definition', ref: 'tp', name: 'Teleporter', description: 'Step on it to travel.', category: 'Environment', tags: ['teleporter'], components: [{ component: 'Sprite', propsJson: '{"width":28,"height":8,"color":"#36e2ff"}' }, { component: 'Collider', propsJson: '{"size":{"x":28,"y":8},"isTrigger":true}' }] });
    ops.push({ op: 'draw_tiles', sceneId, definitionRef: lib('Platform'), rects: [{ col: -8, row: 2, width: 10, height: 1 }, { col: 5, row: 2, width: 8, height: 1 }, { col: 16, row: 2, width: 10, height: 1 }] });
    ops.push({ op: 'draw_tiles', sceneId, definitionRef: lib('Stone'), rects: [{ col: 8, row: -2, width: 4, height: 1 }, { col: 20, row: 1, width: 1, height: 1 }] });
    ops.push({ op: 'draw_tiles', sceneId, definitionRef: spikes, rects: [{ col: 8, row: 1, width: 2, height: 1 }, { col: 22, row: 1, width: 2, height: 1 }] });
    ops.push({ op: 'place_instance', sceneId, definitionRef: lib('Player'), x: -200, y: 48, name: null, ref: null });
    for (const x of [300, 560, 760]) ops.push({ op: 'place_instance', sceneId, definitionRef: lib('Enemy'), x, y: 49, name: null, ref: null });
    ops.push({ op: 'place_instance', sceneId, definitionRef: 'tp', x: 30, y: 60, name: 'Teleporter A', ref: 'tpA' });
    ops.push({ op: 'place_instance', sceneId, definitionRef: 'tp', x: 320, y: -76, name: 'Teleporter B', ref: 'tpB' });
    ops.push({ op: 'create_relationship', sceneId, relationshipJson: JSON.stringify({ type: 'teleports_to', source: { kind: 'entity', id: 'tpA' }, target: { kind: 'entity', id: 'tpB' } }) });
    return { kind: 'preview', message: 'A hard level: three stretches of ground with pits, spikes, three enemies and a teleporter up to a high ledge.', changes: ['Cleared the level area', 'Ground: 3 stretches with 2 pits', 'Spikes: 4', 'Enemies: 3', 'Teleporter A → B (up to the ledge)', 'Ledge: high, reached by the teleporter', 'Player: on the ground at the start', 'Hardest part last'], operations: ops };
  }
  if (body.context.scope === 'connection') {
    const c = body.context.connection;
    const update = (params, msg, change) => ({ kind: 'apply', message: msg, changes: [change], operations: [{ op: 'update_relationship', sceneId: body.context.level.id, id: c.id, patchJson: JSON.stringify({ params }) }] });
    if (req.includes('three squares upwards')) return update({ action: 'move', offset: { x: 0, y: -96 } }, 'The switch now moves the door 3 tiles up.', 'Switch moves Door 3 tiles up');
    if (req.includes('disappear')) return update({ action: 'disappear' }, 'The switch now makes the door disappear.', 'Switch makes Door disappear');
  }
  if (body.context.scope === 'editor') {
    const keys = body.context.editor.settings.map((x) => x.key);
    const set = (key, value) => ({ op: 'set_editor_setting', key, valueJson: JSON.stringify(value) });
    if (req.includes('sideways')) return { kind: 'apply', message: 'Done.', changes: [], operations: [set('playButton', 'sideways')] };
    if (req.includes('play button')) return { kind: 'apply', message: 'The Play button is now at the bottom.', changes: ['Play button: bottom'], operations: [set('playButton', 'bottom')] };
    if (req.includes('dock')) return { kind: 'apply', message: 'The details panel is docked on the right.', changes: ['Details panel: docked, right'], operations: [set('inspector', 'docked'), set('inspectorSide', 'right')] };
    if (req.includes('green')) return { kind: 'apply', message: 'The editor is green now.', changes: ['Accent color: green'], operations: [set('accentColor', '#2ea043')] };
    return { kind: 'unsupported', message: `The editor can't do that yet. It can change: ${keys.join(', ')}.`, changes: [], operations: [] };
  }
  if (req.includes('open the door')) {
    return { kind: 'clarify', message: `${t[0]?.name} can't open things. Did you mean a switch or a key?`, changes: [], operations: [] };
  }
  return { kind: 'clarify', message: 'What would you like to change about it?', changes: [], operations: [] };
}

try {
  const context = await browser.newContext({ viewport: { width: 1400, height: 860 }, acceptDownloads: true });
  const page = await context.newPage();
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  // Ignored: the expected 401 from the keyless AI endpoint, and web-font hosts (unreachable in sandboxed CI; the UI falls back to system fonts).
  // The browser logs rejected requests itself: the deliberately wrong keys (Anthropic answers 401, Google 400) and the faked busy Gemini model (503).
  const ignorable = (m) => m.text().includes('401') || (/\b(400|503)\b/.test(m.text()) && /generativelanguage\.googleapis\.com/.test(m.location()?.url ?? '')) || /fonts\.(googleapis|gstatic)\.com/.test(m.location()?.url ?? '');
  page.on('console', (m) => m.type() === 'error' && !ignorable(m) && errors.push(`console: ${m.text()} (${m.location()?.url ?? ''})`));
  await page.route('**/api/ai', async (route) => {
    const body = JSON.parse(route.request().postData());
    // "Take your time" requests answer slowly, so the test can carry on editing meanwhile.
    await new Promise((r) => setTimeout(r, /take your time/i.test(body.request) ? 2500 : 150));
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(stubModel(body)) });
  });
  // Diagnostics, printed only if the test fails: input events and when the prompt comes and goes.
  await page.addInitScript(() => {
    window.__events = [];
    const rec = (e) => window.__events.push(`${Math.round(performance.now())} ${e.type} ${e.target?.dataset?.testid ?? e.target?.className ?? e.target?.tagName} ${e.button ?? ''}${e.key ?? ''}`);
    for (const t of ['pointerdown', 'pointerup', 'click', 'dblclick', 'keydown', 'pointercancel']) window.addEventListener(t, rec, true);
    new MutationObserver(() => {
      const has = !!document.querySelector('[data-testid="context-prompt"]');
      if (has !== window.__had) window.__events.push(`${Math.round(performance.now())} prompt ${has ? 'shown' : 'gone'}`);
      window.__had = has;
    }).observe(document, { subtree: true, childList: true });
  });
  diagnostics = async () => (await page.evaluate(() => window.__events.slice(-30))).join('\n');
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
  /** A change to what an object is offers "Change <object>" / "Create new": take "Change". */
  const changeObject = async (where = page.getByTestId('context-prompt')) => {
    await where.getByTestId('choice-object').click({ timeout: 10000 });
  };
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
  const player = toScreen(-256, 0);
  await check(async () => {
    const pBox = await prompts.boundingBox();
    return !!pBox && pBox.y + pBox.height < player.y && Math.abs(pBox.x + pBox.width / 2 - player.x) < 40;
  }, 'the prompt sits just above the Player, centered on it');
  await page.screenshot({ path: `${OUT}/2-player-selected.png` });
  await canvas.focus();
  await page.keyboard.press('Enter');
  await check(async () => (await page.evaluate(() => document.activeElement?.tagName)) === 'TEXTAREA', 'Enter moves focus into the prompt');
  await ask('Give the player five hearts.');
  await check(async () => (await result.getAttribute('data-status')) === 'choice', 'a change to what the Player is asks first');
  await check(async () => (await prompts.getByTestId('choice-object').innerText()) === 'Apply' && (await prompts.getByTestId('choice-new').innerText()) === 'Create new' && (await result.innerText()).includes('Apply changes the Player'), 'with two buttons: "Apply" (changes the Player) and "Create new"');
  await changeObject();
  await check(async () => (await result.getAttribute('data-status')) === 'applied', 'the AI change is applied');
  await check(async () => (await result.innerText()).includes('Player: 5 hearts'), 'a short confirmation lists what changed');
  const last = aiRequests.at(-1);
  await check(last.context.scope === 'entity' && last.context.targets[0].name === 'Player', 'the AI received the selected Player as context');
  await check(last.context.otherEntities.some((e) => e.name === 'Door'), 'other objects are available to the AI by name');
  await page.screenshot({ path: `${OUT}/3-applied.png` });
  await prompts.getByTestId('prompt-details').click();
  await check(async () => (await page.getByTestId('field-Health.maxHealth').inputValue()) === '5', 'the details drawer shows the new health (max 5)');
  await page.getByTestId('close-details').click();

  step = 'undo/redo';
  await page.getByTestId('undo').click();
  await prompts.getByTestId('prompt-details').click();
  await check(async () => (await page.getByTestId('field-Health.maxHealth').inputValue()) === '3' && (await page.getByTestId('field-Health.currentHealth').inputValue()) === '3', 'Undo reverts the whole AI change as one step');
  await page.getByTestId('redo').click();
  await check(async () => (await page.getByTestId('field-Health.maxHealth').inputValue()) === '5', 'Redo restores it');
  await page.getByTestId('close-details').click();

  step = 'golden test 2: enemy';
  await clickWorld(-32, 0);
  await check(async () => (await prompts.count()) === 1, 'selecting the Enemy replaces the Player prompt (still one prompt)');
  await check(async () => (await prompts.getByTestId('entity-header').innerText()).trim() === 'Enemy', "the object's card has its name as a header");
  await check(async () => (await prompts.locator('.prompt-header').evaluate((el) => parseFloat(getComputedStyle(el).fontSize))) <= 13, '(in the smaller header size, the same for every card)');
  await prompts.getByTestId('prompt-close').click();
  await check(async () => (await prompts.count()) === 0, 'the × on the prompt card closes it');
  await clickWorld(-32, 0);
  await check(async () => (await prompts.count()) === 1, 'selecting the Enemy again brings the prompt back');
  await check(async () => !(await result.count()), 'the new prompt starts fresh');
  await ask('Make the enemy patrol between these two points.');
  await check(async () => (await result.getAttribute('data-status')) === 'choice' && (await result.innerText()).includes('Apply changes every Enemy (2 placed)'), 'a behavior request offers "Apply" (all 2 enemies) or "Create new"');
  await page.screenshot({ path: `${OUT}/4b-object-choice.png` });
  await prompts.getByTestId('choice-new').click();
  await check(async () => (await result.getAttribute('data-status')) === 'applied', '"Create new" applies it');
  await check(aiRequests.at(-1).context.targets[0].name === 'Enemy', 'the AI received the Enemy as context');
  await check(async () => (await prompts.getByTestId('entity-header').innerText()).trim() === 'Enemy 2', 'the selected enemy is now the new kind, "Enemy 2"');
  await page.getByTestId('dock-library').click();
  await check(async () => (await page.getByTestId('definition-Enemy 2').count()) === 1 && (await page.getByTestId('definition-Enemy').count()) === 1, 'the new object is in the Objects panel, next to the old Enemy');
  await page.getByTestId('dock-library').click();
  await prompts.getByTestId('prompt-details').click();
  await check(async () => (await page.getByTestId('field-Patrol.distance').inputValue()) === '64', 'the new enemy has the Patrol behavior (shown in its details)');
  await page.getByTestId('close-details').click();
  await page.getByTestId('undo').click();
  await check(async () => (await prompts.getByTestId('entity-header').innerText()).trim() === 'Enemy', 'Undo turns it back into a plain Enemy (one step)');
  await ask('Give the enemy a jetpack.');
  await check(async () => (await result.getAttribute('data-status')) === 'message', 'an unsupported request gets a plain explanation');
  await check(async () => (await result.innerText()).includes("can't fly with a jetpack yet"), 'the AI says what is missing instead of faking it');

  step = 'AI writes a behavior script';
  const askedBefore = aiRequests.length;
  await ask('Make the enemy hop toward the player when it gets close.');
  await changeObject();
  await check(async () => (await result.getAttribute('data-status')) === 'applied', 'a custom behavior is written as a script and applied');
  await check(aiRequests.length === askedBefore + 2 && aiRequests.at(-1).request.includes('unknown name "sped" (did you mean "speed"?)'), 'a script that does not check out goes back to the AI once, with the exact problem');
  await prompts.getByTestId('prompt-details').click();
  const card = page.getByTestId('script-Hopper');
  await check(async () => (await card.count()) === 1 && (await card.innerText()).includes('hops toward the player when it is close'), 'the details panel lists the script with its description');
  await card.getByTestId('script-open').click();
  await check(async () => /every 1 s, if self\.grounded and \(dist\(player\) < 400\):[\s\S]*jump \(250\)/.test(await card.getByTestId('script-code').innerText()), 'the script is shown as readable steps');
  await card.getByTestId('script-edit').click();
  const json = card.getByTestId('script-json');
  await json.fill((await json.inputValue()).replace('sign(dx(player)) * speed', 'sign(dx(player)) * sped'));
  await card.getByTestId('script-save').click();
  await check(async () => (await card.getByTestId('script-error').innerText()).includes('unknown name "sped"'), 'a hand edit is checked the same way, with the same message');
  await json.fill((await json.inputValue()).replace('* sped', '* speed * 2'));
  await card.getByTestId('script-save').click();
  await check(async () => (await card.getByTestId('script-error').count()) === 0 && (await card.getByTestId('script-code').innerText()).includes('speed) * 2'), 'a valid hand edit is saved');
  await page.getByTestId('close-details').click();
  await page.getByTestId('play').click();
  await check(async () => (await page.getByTestId('hud-message').innerText()).includes('Hopper ready (90)'), 'in play, the script runs (its start message, with the variable filled in)');
  const enemyHopped = async () => (await page.getByTestId('play-canvas').getAttribute('data-events')) ?? '';
  await page.waitForTimeout(1500);
  await check(async () => !(await enemyHopped()).includes('script_error'), 'no script errors while playing');
  await page.keyboard.press('Escape');
  await check(async () => (await page.getByTestId('viewport-canvas').count()) === 1, 'back to editing');
  await page.getByTestId('undo').click();
  await page.getByTestId('undo').click();
  await clickWorld(-32, 0);
  await prompts.getByTestId('prompt-details').click();
  await check(async () => (await page.getByTestId('script-Hopper').count()) === 0, 'Undo removes the script again (edit, then the AI change)');
  await page.getByTestId('close-details').click();

  step = 'prompts keep running in the background';
  const jobsAttr = async () => (await canvas.getAttribute('data-ai-jobs')) ?? '0,0';
  await ask('Take your time: make this enemy bigger.');
  await check(async () => (await prompts.getByTestId('prompt-stop').isVisible()), 'while the AI works, the card is busy and offers Stop');
  await clickWorld(-256, 0);
  await check(async () => (await prompts.getByTestId('entity-header').innerText()).trim() === 'Player', 'another object can be selected while the AI works');
  await check(async () => (await jobsAttr()) === '1,0', 'the enemy shows the working dots');
  await page.screenshot({ path: `${OUT}/29-working-dots.png` });
  await ask('Give the player five hearts.');
  await changeObject();
  await check(async () => (await result.getAttribute('data-status')) === 'applied', 'meanwhile a prompt for the player runs and applies');
  await check(async () => (await jobsAttr()) === '0,1', "when the enemy's prompt finishes, it waits (a badge): it changes what the Enemy is, so it needs the user's choice");
  await clickWorld(-32, 0);
  await check(async () => (await result.getAttribute('data-status')) === 'choice' && (await jobsAttr()) === '0,0', 'clicking the enemy again shows its result, ready to choose');
  await changeObject();
  await check(async () => (await result.getAttribute('data-status')) === 'applied', 'the enemy prompt is applied');
  await check(async () => (await prompts.getByTestId('result-undo').count()) === 1, "its change is the latest, so its card offers Undo");
  await clickWorld(-256, 0);
  await check(async () => (await result.getAttribute('data-status')) === 'applied' && (await result.innerText()).includes('in history') && (await prompts.getByTestId('result-undo').count()) === 0, "the player's card still shows its result, but no Undo: the enemy's change came after it");
  await prompts.getByTestId('prompt-close').click();
  await clickWorld(-32, 0);
  await ask('Take your time: propose a new color for this enemy.');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await check(async () => (await prompts.count()) === 0, 'the card closed while the AI works');
  await check(async () => (await jobsAttr()) === '0,1', 'when it finishes, a badge waits above the enemy (a proposal to look at)');
  await page.screenshot({ path: `${OUT}/29b-waiting-badge.png` });
  await clickWorld(-32, 0);
  await check(async () => (await result.getAttribute('data-status')) === 'choice' && (await jobsAttr()) === '0,0', 'opening the enemy shows the proposal, and the badge goes away');
  await prompts.getByTestId('proposal-cancel').click();
  await ask('Take your time: make this enemy bigger.');
  await prompts.getByTestId('prompt-stop').click();
  await check(async () => (await prompts.getByTestId('prompt-stop').count()) === 0 && (await jobsAttr()) === '0,0', 'Stop ends a running prompt');
  await page.waitForTimeout(2700);
  await check(async () => (await result.count()) === 0, '(and its answer is ignored when it arrives)');
  // Put the enemy's color back (the player already had five hearts, so that prompt changed nothing).
  await page.getByTestId('undo').click();

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
  await changeObject();
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
  await check(async () => (await page.getByTestId('history-list').innerText()).includes('✨ Give the player five hearts.'), 'AI changes appear in History');
  await page.screenshot({ path: `${OUT}/7-history.png` });

  step = 'background';
  await page.getByTestId('tray').getByRole('button', { name: 'Close' }).click();
  await page.getByTestId('tool-background').click();
  const bgPanel = page.getByTestId('background-panel');
  await check(async () => (await bgPanel.isVisible()) && (await prompts.count()) === 0, 'the background card opens (and is the only card)');
  await check(async () => (await bgPanel.getByRole('radio', { name: 'Dark (default)' }).getAttribute('aria-checked')) === 'true', 'a new project starts with the dark background');
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

  step = 'sprite for a situation';
  await page.keyboard.press('Escape');
  await clickWorld(-256, 0);
  await check(async () => (await prompts.getByTestId('entity-header').innerText()).trim() === 'Player', 'the player is selected');
  await ask('Draw a jumping sprite for the player.');
  await changeObject();
  await check(async () => (await result.getAttribute('data-status')) === 'applied', 'a jumping sprite is drawn');
  await check(aiRequests.at(-1).context.targets[0].look.sprite.pixelArt.rows.length === 32, "the AI got the player's current drawing (its pixels) to start from");
  await prompts.getByTestId('prompt-close').click();
  await page.getByTestId('play').click();
  const lookNow = async () => (await page.getByTestId('play-canvas').getAttribute('data-look')) ?? '';
  await check(async () => (await lookNow()) === 'idle', 'standing still, the player has its normal look');
  await page.keyboard.down('Space');
  await check(async () => (await lookNow()) === 'jump:image', 'jumping, the player shows the jumping sprite');
  await page.keyboard.up('Space');
  await check(async () => (await lookNow()) === 'idle', 'back on the ground, the normal look again');
  await page.keyboard.press('Escape');
  await page.getByTestId('undo').click();

  step = 'play';
  await clickWorld(-256, 0);
  await check(async () => (await prompts.count()) === 1, 'clicking the Player selects it');
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
  await clickWorld(-256, 0);
  await check(async () => (await prompts.count()) === 1, 'clicking an object right after stopping selects it (the view is measured at once)');
  await check(async () => (await page.getByTestId('undo').getAttribute('title')) === undoTitle, 'playing made no edits (undo history unchanged)');
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

  step = 'camera';
  await page.keyboard.press('Escape');
  const frameOf = async () => ((await canvas.getAttribute('data-camera-frame')) ?? '').split(',').filter(Boolean).map(Number);
  await check(async () => (await frameOf()).length === 0, 'no camera frame on the level by default');
  await page.getByTestId('main-menu').click();
  await page.getByTestId('menu-camera-frame').click();
  await page.keyboard.press('Escape');
  const f1 = await frameOf();
  await check(async () => f1.length === 4 && f1[2] - f1[0] > 200, 'the menu shows the camera frame: what Play shows at the start');
  await page.getByTestId('global-prompt-toggle').click();
  const camPrompt = page.getByTestId('global-prompt');
  {
    // It must not appear off to the side and then jump to the middle.
    const vw = (await page.viewportSize()).width;
    const centerNow = async () => {
      const b = await camPrompt.boundingBox();
      return b.x + b.width / 2;
    };
    const first = await centerNow();
    await page.waitForTimeout(250);
    const later = await centerNow();
    await check(Math.abs(first - later) < 2 && Math.abs(later - vw / 2) < 40, `the ✦ card opens in place, centered (center ${first.toFixed(0)} → ${later.toFixed(0)})`);
  }
  await camPrompt.locator('.scope-toggle button').first().click();
  await camPrompt.getByTestId('prompt-input').fill('Zoom the camera in 2x during play.');
  await camPrompt.getByTestId('prompt-input').press('Enter');
  await check(async () => (await camPrompt.getByTestId('prompt-result').getAttribute('data-status')) === 'applied', 'the AI changes the camera settings');
  await check(aiRequests.at(-1).context.level.camera.zoom === 1 && aiRequests.at(-1).context.level.camera.follows === 'Player', 'the AI gets the camera settings and what it follows');
  await check(async () => {
    const f2 = await frameOf();
    return f2.length === 4 && Math.abs((f2[2] - f2[0]) * 2 - (f1[2] - f1[0])) <= 2;
  }, 'the camera frame shrinks to half: zoomed in 2×');
  await page.screenshot({ path: `${OUT}/26-camera-frame.png` });
  const askedBefore2 = aiRequests.length;
  await camPrompt.getByTestId('prompt-input').fill('Lower the gravity (broken twice).');
  await camPrompt.getByTestId('prompt-input').press('Enter');
  await check(async () => (await camPrompt.getByTestId('prompt-result').getAttribute('data-status')) === 'proposal' && (await camPrompt.getByTestId('prompt-result').innerText()).includes('Left out one part'), 'an answer still broken after its retry keeps the parts that work, shows what was left out, and asks first');
  await check(aiRequests.length === askedBefore2 + 2, '(the AI was asked once more, not again and again)');
  await camPrompt.getByTestId('proposal-cancel').click();
  await camPrompt.getByTestId('prompt-close').click();
  await page.getByTestId('play').click();
  await check(async () => ((await page.getByTestId('play-canvas').getAttribute('data-camera')) ?? '').endsWith(',2.00'), 'Play uses the level camera zoom');
  await page.keyboard.press('Escape');
  await check(async () => (await page.getByTestId('viewport-canvas').count()) === 1, 'back to editing');
  await page.getByTestId('undo').click();
  await check(async () => {
    const f3 = await frameOf();
    return f3.length === 4 && Math.abs(f3[2] - f3[0] - (f1[2] - f1[0])) <= 2;
  }, 'Undo restores the zoom');
  await page.getByTestId('main-menu').click();
  await page.getByTestId('menu-camera-frame').click();
  await page.keyboard.press('Escape');
  await check(async () => (await frameOf()).length === 0, 'the camera frame can be hidden again');

  step = 'wireframe view';
  await page.keyboard.press('Escape');
  await page.mouse.click(emptySpot.x, emptySpot.y);
  await page.keyboard.press('KeyF');
  const wireOn = async () => ((await canvas.getAttribute('data-wireframe')) ?? '') === '1';
  await check(async () => !(await wireOn()), 'the level shows the real sprites by default');
  await page.keyboard.press('KeyW');
  await check(wireOn, 'W switches to the wireframe view');
  await check(async () => (await page.getByTestId('tool-wireframe').getAttribute('aria-pressed')) === 'true', 'the tool panel button shows it is on');
  for (const st of ['classic', 'blueprint', 'arcade', 'paper', 'amber']) {
    await page.getByTestId('main-menu').click();
    await page.getByTestId('menu-style').click();
    await page.getByTestId(`style-${st}`).click();
    await page.keyboard.press('Escape');
    await page.waitForTimeout(100);
    await page.screenshot({ path: `${OUT}/28-wireframe-${st}.png` });
  }
  await page.getByTestId('play').click();
  await check(async () => (await page.getByTestId('play-canvas').isVisible()), 'Play still shows the real game');
  await page.keyboard.press('Escape');
  await page.getByTestId('tool-wireframe').click();
  await check(async () => !(await wireOn()), 'the tool panel button switches it off again');
  await page.getByTestId('main-menu').click();
  await page.getByTestId('menu-style').click();
  await page.getByTestId('style-classic').click();
  await page.keyboard.press('Escape');

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
  await check(async () => (await page.getByTestId('field-CharacterController.jumpForce').inputValue()) === '350', 'Reset objects to defaults puts the Player back (jumpForce 350)');
  await check(async () => (await canvas.getAttribute('data-entities')) === levelSize, 'and keeps the level as it is');
  await check(async () => (await page.getByTestId('definition-name').count()) === 1, 'the inspector stays on the reset object');
  await page.getByTestId('undo').click();
  await check(async () => (await page.getByTestId('field-CharacterController.jumpForce').inputValue()) === '900', 'Undo brings the edited version back');
  await page.getByTestId('close-details').click();
  await openLibrary();
  await page.getByTestId('definition-Player').click({ button: 'right' });
  await page.getByTestId('menu-reset').click();
  await openPlayerDetails();
  await check(async () => (await page.getByTestId('field-CharacterController.jumpForce').inputValue()) === '350', 'right-click → Reset to default resets one object');
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

  step = 'logic: connections, rules and play';
  const lc = await browser.newContext({ viewport: { width: 1400, height: 860 } });
  const lp = await lc.newPage();
  lp.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  lp.on('console', (m) => m.type() === 'error' && !ignorable(m) && errors.push(`console: ${m.text()} (${m.location()?.url ?? ''})`));
  await lp.route('**/api/ai', async (route) => {
    const body = JSON.parse(route.request().postData());
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(stubModel(body)) });
  });
  await lp.goto(URL);
  const lCanvas = lp.getByTestId('viewport-canvas');
  const lBox = await lCanvas.boundingBox();
  const lAt = (wx, wy) => ({ x: lBox.x + lBox.width / 2 + wx, y: lBox.y + lBox.height / 2 + wy });
  const lDrop = async (name, wx, wy) => {
    if ((await lp.getByTestId('library-panel').count()) === 0) await lp.getByTestId('dock-library').click();
    await lp.dragAndDrop(`[data-testid="definition-${name}"]`, '[data-testid="viewport-canvas"]', { targetPosition: { x: lBox.width / 2 + wx, y: lBox.height / 2 + wy } });
  };
  const lClick = async (wx, wy, shift = false) => {
    const q = lAt(wx, wy);
    if (shift) await lp.keyboard.down('Shift');
    await lp.mouse.click(q.x, q.y);
    if (shift) await lp.keyboard.up('Shift');
  };
  const lPrompt = lp.getByTestId('context-prompt');
  const lAsk = async (text, where = lPrompt) => {
    const input = where.getByTestId('prompt-input');
    await input.click();
    await input.fill(text);
    await input.press('Enter');
  };
  // Ground from x=-208 to 208, then Player, Key, Switch and Door standing on it.
  await lp.getByTestId('dock-library').click();
  await lp.getByTestId('definition-Platform').click();
  const g0 = lAt(-208, 48);
  const g1 = lAt(208, 48);
  await lp.mouse.move(g0.x, g0.y);
  await lp.mouse.down();
  await lp.mouse.move(g1.x, g1.y, { steps: 6 });
  await lp.mouse.up();
  await lp.getByTestId('tool-select').click();
  await lDrop('Player', -176, 0);
  await lDrop('Key', -128, 16);
  await lDrop('Switch', -64, 16);
  await lDrop('Door', 64, 0);
  await check(async () => (await lp.getByTestId('tool-logic').innerText()) === '', 'a new level has no connections (no count on the Logic button)');

  await lClick(-64, 16);
  await lClick(64, 0, true);
  await check(async () => (await lPrompt.getAttribute('data-context')) === 'pair', 'switch + door gives one relationship prompt');
  await lAsk('Make this switch open this door.');
  await check(async () => (await lPrompt.getByTestId('prompt-result').getAttribute('data-status')) === 'applied', '"make this switch open this door" creates a connection');
  await check(async () => (await lp.getByTestId('tool-logic').innerText()) === '1', 'the Logic button counts it');
  await lAsk('Only if the player has the key.');
  await check(async () => (await lPrompt.getByTestId('prompt-result').getAttribute('data-status')) === 'applied', 'a follow-up adds a condition to the same connection');
  await lp.screenshot({ path: `${OUT}/13-connection.png` });

  await lp.getByTestId('tool-logic').click();
  const logicPanel = lp.getByTestId('logic-panel');
  await check(async () => (await logicPanel.getByTestId('relationship-item').innerText()).includes('Switch opens and closes Door, only if whoever uses it has key'), 'the Logic card lists the connection as a sentence');
  await lAsk('When the player picks up the key, say Got the key!', logicPanel);
  await check(async () => (await logicPanel.getByTestId('rule-item').innerText()).includes('When every Player picks up every Key: show "Got the key!"'), 'a rule described in the Logic card appears as a sentence');
  await check(async () => (await lp.getByTestId('tool-logic').innerText()) === '2', 'the count includes rules');
  await lp.screenshot({ path: `${OUT}/14-logic-panel.png` });
  await lp.keyboard.press('Escape');
  await check(async () => (await logicPanel.count()) === 0, 'Esc closes the Logic card');

  await lClick(64, 0);
  await lPrompt.getByTestId('prompt-details').click();
  await check(async () => (await lp.getByTestId('connections').innerText()).includes('Switch opens and closes Door'), "the door's details show what controls it");
  await lp.getByTestId('close-details').click();

  await lp.getByTestId('play').click();
  const lPlay = lp.getByTestId('play-canvas');
  const lps = async () => ((await lPlay.getAttribute('data-player')) ?? '').split(',').map(Number);
  const evs = async () => (await lPlay.getAttribute('data-events')) ?? '';
  await check(async () => (await lps())[2] === 1, 'play: the player lands');
  await check(async () => (await lp.getByTestId('hud-health').getAttribute('aria-label')) === 'Health 3 of 3', 'the HUD shows the player\'s hearts');
  const walkUntil = async (x) => {
    await lp.keyboard.down('ArrowRight');
    for (let i = 0; i < 150 && (await lps())[0] < x; i++) await lp.waitForTimeout(20);
    await lp.keyboard.up('ArrowRight');
  };
  await walkUntil(-80);
  await check(async () => (await lp.getByTestId('hud-item').innerText()) === 'key', 'walking over the key picks it up (HUD shows it)');
  await check(async () => (await lp.getByTestId('hud-message').innerText()) === 'Got the key!', 'the rule shows its message');
  await lp.waitForTimeout(150);
  await lp.keyboard.press('KeyE');
  await check(async () => (await evs()).includes('opened:Door>Switch'), 'pressing E at the switch opens the door (the key condition holds)');
  await walkUntil(120);
  await check(async () => (await lps())[0] >= 120, 'the player walks through the open door');
  await lp.screenshot({ path: `${OUT}/15-play-logic.png` });
  await lp.keyboard.press('Escape');

  await lp.getByTestId('tool-logic').click();
  await logicPanel.getByTestId('relationship-item').getByRole('button', { name: 'Remove connection' }).click();
  await check(async () => (await logicPanel.getByTestId('relationship-item').count()) === 0 && (await lp.getByTestId('tool-logic').innerText()) === '1', 'a connection can be removed');
  await lp.getByTestId('undo').click();
  await check(async () => (await logicPanel.getByTestId('relationship-item').count()) === 1, 'and Undo brings it back');
  await logicPanel.getByTestId('rule-enabled').click();
  await check(async () => (await logicPanel.getByTestId('rule-item').getAttribute('class')).includes('off'), 'a rule can be switched off');
  await lp.keyboard.press('Escape');
  await lClick(64, 0);
  await lp.keyboard.press('Delete');
  await lp.getByTestId('tool-logic').click();
  await check(async () => (await logicPanel.getByTestId('relationship-item').count()) === 0 && (await logicPanel.getByTestId('rule-item').count()) === 1, 'deleting the door removes its connection (the rule stays)');
  await lc.close();

  step = 'published app: AI through the claude.ai account';
  const cc = await browser.newContext({ viewport: { width: 1400, height: 860 } });
  const cp2 = await cc.newPage();
  cp2.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  let cServer = 0;
  await cp2.route('**/api/ai', (route) => {
    cServer++;
    return route.fulfill({ status: 404, body: '' });
  });
  const sampleCalls = [];
  await cp2.exposeFunction('__stubSample', (input, cache) => {
    sampleCalls.push({ input, cache });
    const ctxStart = input.lastIndexOf('CONTEXT\n') + 8;
    const context = JSON.parse(input.slice(ctxStart, input.indexOf('\n', ctxStart)));
    const request = input.slice(input.lastIndexOf('REQUEST\n') + 8);
    return stubModel({ context, request, history: [] });
  });
  const saves = [];
  await cp2.exposeFunction('__stubSave', (filename, text) => {
    saves.push({ filename, text });
  });
  // Stand-in for the claude.ai artifact viewer: window.claude.use("sample" | "downloads") like the real runtime.
  await cp2.addInitScript(() => {
    const sample = Object.freeze({ json: (input, options) => window.__stubSample(input, options?.cache) });
    const downloads = Object.freeze({
      save: async ({ filename, data }) => {
        await window.__stubSave(filename, typeof data === 'string' ? data : await data.text());
        return { status: 'saved' };
      },
    });
    window.claude = Object.freeze({ use: async (name) => (name === 'sample' ? sample : name === 'downloads' ? downloads : null) });
  });
  await cp2.goto(URL);
  await cp2.getByTestId('main-menu').click();
  await cp2.getByTestId('menu-ai-connection').click();
  await check(async () => (await cp2.getByTestId('ai-connection-status').innerText()).includes('your Claude account') && (await cp2.getByTestId('ai-key-input').count()) === 0, 'in the published app the AI uses your Claude account; no API key field');
  await cp2.keyboard.press('Escape');
  const cBox = await cp2.getByTestId('viewport-canvas').boundingBox();
  await cp2.getByTestId('dock-library').click();
  await cp2.dragAndDrop('[data-testid="definition-Player"]', '[data-testid="viewport-canvas"]', { targetPosition: { x: cBox.width / 2, y: cBox.height / 2 - 150 } });
  await cp2.mouse.click(cBox.x + cBox.width / 2, cBox.y + cBox.height / 2 - 150);
  const cPrompt = cp2.getByTestId('context-prompt');
  await cPrompt.getByTestId('prompt-input').fill('Give the player five hearts.');
  await cPrompt.getByTestId('prompt-input').press('Enter');
  await changeObject(cPrompt);
  await check(async () => (await cPrompt.getByTestId('prompt-result').getAttribute('data-status')) === 'applied', 'a prompt works through the Claude account');
  await check(sampleCalls.length === 1 && sampleCalls[0].input.includes('REPLY FORMAT') && sampleCalls[0].cache === false && cServer === 0, 'it asked Claude via claude.ai with the reply format, never a server, never a cached answer');
  await cp2.getByTestId('project-menu').click();
  await cp2.getByTestId('menu-save').click();
  await check(async () => saves.length === 1 && saves[0].filename === 'untitled-game.pxlproj.json' && JSON.parse(saves[0].text).kind === 'pxlbuilder.bundle', 'Save hands the project file to claude.ai to offer for download');
  await check(async () => (await cp2.locator('.dirty-dot').count()) === 0, 'and the project counts as saved');
  await cc.close();

  step = 'switch connectors';
  const swc = await browser.newContext({ viewport: { width: 1400, height: 860 } });
  const swp = await swc.newPage();
  swp.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  swp.on('console', (m) => m.type() === 'error' && !ignorable(m) && errors.push(`console: ${m.text()} (${m.location()?.url ?? ''})`));
  await swp.route('**/api/ai', async (route) => {
    const body = JSON.parse(route.request().postData());
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(stubModel(body)) });
  });
  await swp.goto(URL);
  const sw_sCanvas = swp.getByTestId('viewport-canvas');
  const sw_sBox = await sw_sCanvas.boundingBox();
  const sw_sAt = (wx, wy) => ({ x: sw_sBox.x + sw_sBox.width / 2 + wx, y: sw_sBox.y + sw_sBox.height / 2 + wy });
  const sw_sDrop = async (name, wx, wy) => {
    if ((await swp.getByTestId('library-panel').count()) === 0) await swp.getByTestId('dock-library').click();
    await swp.dragAndDrop(`[data-testid="definition-${name}"]`, '[data-testid="viewport-canvas"]', { targetPosition: { x: sw_sBox.width / 2 + wx, y: sw_sBox.height / 2 + wy } });
  };
  const sw_sPrompt = swp.getByTestId('context-prompt');
  const sw_sAsk = async (text) => {
    const input = sw_sPrompt.getByTestId('prompt-input');
    await input.click();
    await input.fill(text);
    await input.press('Enter');
  };
  await swp.getByTestId('dock-library').click();
  await swp.getByTestId('definition-Platform').click();
  await swp.mouse.move(sw_sAt(-208, 48).x, sw_sAt(-208, 48).y);
  await swp.mouse.down();
  await swp.mouse.move(sw_sAt(208, 48).x, sw_sAt(208, 48).y, { steps: 6 });
  await swp.mouse.up();
  await swp.getByTestId('tool-select').click();
  await sw_sDrop('Player', -176, 0);
  await sw_sDrop('Switch', -64, 16);
  await sw_sDrop('Door', 64, 0);
  await swp.mouse.click(sw_sAt(-64, 16).x, sw_sAt(-64, 16).y);
  // The switch (32x32 at -64,16) gets red connectors 4px outside its frame, left and right.
  const sw_handle = sw_sAt(-64 + 16 + 4, 16);
  await swp.mouse.move(sw_handle.x, sw_handle.y);
  await swp.mouse.down();
  await swp.mouse.move(sw_sAt(0, 10).x, sw_sAt(0, 10).y, { steps: 4 });
  await swp.screenshot({ path: `${OUT}/22-connector-drag.png` });
  await swp.mouse.move(sw_sAt(64, 0).x, sw_sAt(64, 0).y, { steps: 4 });
  await swp.mouse.up();
  await check(async () => (await sw_sCanvas.getAttribute('data-connection')) !== '' && (await sw_sCanvas.getAttribute('data-links')) === '1', "dragging the switch's red connector onto the door connects them");
  await check(async () => (await sw_sPrompt.getAttribute('data-context')) === 'connection' && (await sw_sPrompt.getByTestId('connection-header').innerText()).replace(/\s+/g, ' ').includes('Switch → Door opens'), 'the new connection is selected, with its prompt: "Switch → Door", it opens');
  await swp.screenshot({ path: `${OUT}/23-connection-selected.png` });
  await swp.mouse.click(sw_sAt(300, -250).x, sw_sAt(300, -250).y);
  await check(async () => (await sw_sPrompt.count()) === 0 && (await sw_sCanvas.getAttribute('data-links')) === '1', 'clicking away deselects; the connection line stays on the level');
  // Click the line itself (the middle of the curve from the switch to the door).
  const sw_pa = { x: -64, y: 16 };
  const sw_pb = { x: 64, y: 0 };
  const sw_dist = Math.hypot(sw_pb.x - sw_pa.x, sw_pb.y - sw_pa.y);
  const sw_nx = (sw_pb.y - sw_pa.y) / sw_dist;
  const sw_ny = -(sw_pb.x - sw_pa.x) / sw_dist;
  const sw_bow = Math.min(80, sw_dist * 0.25) * (sw_ny <= 0 ? 1 : -1);
  const sw_ctrlPt = { x: (sw_pa.x + sw_pb.x) / 2 + sw_nx * sw_bow, y: (sw_pa.y + sw_pb.y) / 2 + sw_ny * sw_bow };
  const sw_mid = { x: 0.25 * sw_pa.x + 0.5 * sw_ctrlPt.x + 0.25 * sw_pb.x, y: 0.25 * sw_pa.y + 0.5 * sw_ctrlPt.y + 0.25 * sw_pb.y };
  // 9 screen pixels beside the line still counts (easier to hit than before).
  const sw_near = { x: sw_sAt(sw_mid.x, sw_mid.y).x, y: sw_sAt(sw_mid.x, sw_mid.y).y + 9 };
  await check(async () => ((await sw_sCanvas.getAttribute('data-hover-link')) ?? '') === '', 'no arrow is lit before hovering');
  await swp.mouse.move(sw_near.x, sw_near.y, { steps: 3 });
  await check(async () => ((await sw_sCanvas.getAttribute('data-hover-link')) ?? '') !== '', 'hovering near the arrow lights it up a little');
  await swp.screenshot({ path: `${OUT}/23b-connection-hover.png` });
  await swp.mouse.click(sw_near.x, sw_near.y);
  await check(async () => (await sw_sPrompt.getAttribute('data-context')) === 'connection', 'clicking the line selects the connection');
  await swp.screenshot({ path: `${OUT}/23c-connection-clicked.png` });
  await sw_sAsk('The switch moves the door three squares upwards.');
  await check(async () => (await sw_sPrompt.getByTestId('prompt-result').getAttribute('data-status')) === 'applied' && (await sw_sPrompt.getByTestId('connection-header').innerText()).includes('moves'), 'describing it changes what the connection does (now it moves the door)');
  await check(aiRequests.at(-1).context.scope === 'connection' && aiRequests.at(-1).context.targets.map((t) => t.name).join('>') === 'Switch>Door', 'the AI gets the connection and both of its ends');
  await swp.getByTestId('tool-logic').click();
  await check(async () => (await swp.getByTestId('logic-panel').getByTestId('relationship-item').innerText()).includes('Switch moves Door 3 tiles up'), 'the Logic card reads "Switch moves Door 3 tiles up"');
  await swp.keyboard.press('Escape');
  await swp.getByTestId('play').click();
  const sw_sPlay = swp.getByTestId('play-canvas');
  const sw_sps = async () => ((await sw_sPlay.getAttribute('data-player')) ?? '').split(',').map(Number);
  await check(async () => (await sw_sps())[2] === 1, 'play: the player lands');
  const sw_walkTo = async (x) => {
    await swp.keyboard.down('ArrowRight');
    for (let i = 0; i < 150 && (await sw_sps())[0] < x; i++) await swp.waitForTimeout(20);
    await swp.keyboard.up('ArrowRight');
  };
  await sw_walkTo(-80);
  await swp.waitForTimeout(150);
  await swp.keyboard.press('KeyE');
  await swp.waitForTimeout(1300);
  await sw_walkTo(120);
  await check(async () => (await sw_sps())[0] >= 120, 'in play, the switch moves the door up and the player walks under it');
  await swp.screenshot({ path: `${OUT}/24-door-moved.png` });
  await swp.keyboard.press('Escape');
  await swp.mouse.click(sw_sAt(sw_mid.x, sw_mid.y).x, sw_sAt(sw_mid.x, sw_mid.y).y);
  await sw_sAsk('The switch makes the door disappear.');
  await check(async () => (await sw_sPrompt.getByTestId('connection-header').innerText()).includes('hides'), '"makes the door disappear" changes it again');
  await swp.mouse.click(sw_sAt(sw_mid.x, sw_mid.y).x, sw_sAt(sw_mid.x, sw_mid.y).y);
  await swp.keyboard.press('Delete');
  await check(async () => (await sw_sCanvas.getAttribute('data-links')) === '0' && (await sw_sPrompt.count()) === 0, 'Delete removes a selected connection');
  await swp.getByTestId('undo').click();
  await check(async () => (await sw_sCanvas.getAttribute('data-links')) === '1', 'and Undo brings it back');
  await swp.keyboard.press('Escape');
  await sw_sDrop('Hazard', -150, -150);
  await swp.mouse.click(sw_sAt(-150, -150).x, sw_sAt(-150, -150).y);
  await sw_sAsk('Make this look like spikes.');
  await changeObject(sw_sPrompt);
  await check(async () => (await sw_sPrompt.getByTestId('prompt-result').getAttribute('data-status')) === 'applied', '"make this look like spikes" draws a sprite');
  await check(JSON.stringify(aiRequests.at(-1).context.targets[0].spriteGrid) === '{"width":32,"height":8}', 'the AI is told to draw 32×8 pixels for the 64×16 hazard (its proportions)');
  await sw_sPrompt.getByTestId('prompt-details').click();
  await check(async () => (await swp.getByTestId('component-Sprite').innerText()).includes('Spikes'), 'the hazard now uses the drawn "Spikes" image (its size is unchanged)');
  await swp.getByTestId('close-details').click();
  await swp.screenshot({ path: `${OUT}/25-spikes-sprite.png`, clip: { x: sw_sAt(-260, -260).x, y: sw_sAt(-260, -260).y, width: 520, height: 320 } });
  await swc.close();

  step = 'own API key, and changes placed on the right object';
  const kc = await browser.newContext({ viewport: { width: 1400, height: 860 } });
  const kp = await kc.newPage();
  kp.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  kp.on('console', (m) => m.type() === 'error' && !ignorable(m) && !/api\.anthropic\.com|401/.test(m.text()) && errors.push(`console: ${m.text()} (${m.location()?.url ?? ''})`));
  let serverCalls = 0;
  await kp.route('**/api/ai', async (route) => {
    serverCalls++;
    await route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ error: 'no key on this server' }) });
  });
  // A stand-in for api.anthropic.com: same endpoints and shapes the SDK uses, answers from the stub model.
  const VALID = 'sk-ant-test-valid-key-1234';
  const anthropicCalls = [];
  await kp.route('https://api.anthropic.com/**', async (route) => {
    const r = route.request();
    const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET,POST,OPTIONS' };
    if (r.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    const headers = await r.allHeaders();
    anthropicCalls.push({ url: r.url(), key: headers['x-api-key'], browser: headers['anthropic-dangerous-direct-browser-access'] });
    const json = (status, body) => route.fulfill({ status, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify(body) });
    if (headers['x-api-key'] !== VALID) return json(401, { type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } });
    if (r.url().includes('/v1/models/')) return json(200, { type: 'model', id: 'claude-opus-5-5', display_name: 'Claude Opus 5.5', created_at: '2026-01-01T00:00:00Z' });
    const sent = JSON.parse(r.postData());
    anthropicCalls.at(-1).effort = sent.output_config?.effort;
    const text = sent.messages[0].content;
    const context = JSON.parse(text.split('\n')[1]);
    const request = text.slice(text.lastIndexOf('REQUEST\n') + 8);
    const out = stubModel({ context, request, history: [] });
    return json(200, { id: 'msg_test', type: 'message', role: 'assistant', model: sent.model, content: [{ type: 'text', text: JSON.stringify(out) }], stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 10, output_tokens: 10 } });
  });
  await kp.goto(URL);
  const kCanvas = kp.getByTestId('viewport-canvas');
  const kBox = await kCanvas.boundingBox();
  const kAt = (wx, wy) => ({ x: kBox.x + kBox.width / 2 + wx, y: kBox.y + kBox.height / 2 + wy });
  const kPrompt = kp.getByTestId('context-prompt');
  const kAsk = async (text) => {
    const input = kPrompt.getByTestId('prompt-input');
    await input.click();
    await input.fill(text);
    await input.press('Enter');
  };
  const kDrop = async (name, wx, wy) => {
    if ((await kp.getByTestId('library-panel').count()) === 0) await kp.getByTestId('dock-library').click();
    await kp.dragAndDrop(`[data-testid="definition-${name}"]`, '[data-testid="viewport-canvas"]', { targetPosition: { x: kBox.width / 2 + wx, y: kBox.height / 2 + wy } });
  };
  await kDrop('Player', -200, -150);
  await kp.mouse.click(kAt(-200, -150).x, kAt(-200, -150).y);
  await kAsk('Make the player faster.');
  await check(async () => (await kPrompt.getByTestId('prompt-result').innerText()).includes('AI connection'), 'without a server key, the prompt says how to connect (⋯ → AI connection)');
  await kp.keyboard.press('Escape');
  await kp.getByTestId('main-menu').click();
  await kp.getByTestId('menu-ai-connection').click();
  const dialog = kp.getByTestId('ai-connection');
  await check(async () => (await dialog.getByTestId('ai-connection-status').innerText()).includes("this computer's PXLBuilder server"), 'the AI connection dialog shows where the AI comes from');
  await dialog.getByTestId('ai-key-input').fill('sk-ant-wrong-key-0000');
  await dialog.getByTestId('ai-key-save').click();
  await check(async () => (await dialog.getByTestId('ai-key-result').innerText()).includes('not accepted'), 'a wrong key is checked and not saved');
  await dialog.getByTestId('ai-key-input').fill(VALID);
  await dialog.getByTestId('ai-key-save').click();
  await check(async () => (await dialog.getByTestId('ai-key-result').innerText()).includes('Connected'), 'a valid key connects');
  await check(async () => (await dialog.getByTestId('ai-connection-status').innerText()).includes('sk-ant-…1234') && (await dialog.getByTestId('ai-connection-status').innerText()).includes('this session only'), 'the key is shown masked, kept for this session only (not remembered by default)');
  await check(async () => (await dialog.getByTestId('ai-key-input').inputValue()) === '' && (await dialog.getByTestId('ai-key-input').getAttribute('type')) === 'password', 'the key field is a password field and is cleared after connecting');
  await check(anthropicCalls.every((c) => c.browser === 'true'), 'calls go straight from the browser to the Anthropic API');
  await kp.keyboard.press('Escape');

  await kp.mouse.click(kAt(-200, -150).x, kAt(-200, -150).y);
  const serverBefore = serverCalls;
  await kAsk('The player kills mushroom-enemies by jumping on top of them, but other enemies cannot be killed that way.');
  await check(async () => (await kPrompt.getByTestId('prompt-result').getAttribute('data-status')) === 'message' && (await kPrompt.getByTestId('prompt-result').innerText()).includes("There's no mushroom enemy"), 'the AI instructs the user when what they describe does not exist yet');
  await check(serverCalls === serverBefore && anthropicCalls.at(-1).key === VALID && anthropicCalls.at(-1).url.includes('/v1/messages'), 'prompts use the user key, not the server');
  await kp.keyboard.press('Escape');
  await kp.getByTestId('dock-create').click();
  const kCreate = kp.getByTestId('create-prompt');
  await kCreate.getByTestId('prompt-input').fill('Create a mushroom enemy.');
  await kCreate.getByTestId('prompt-input').press('Enter');
  await kCreate.getByTestId('proposal-apply').click();
  await kp.keyboard.press('Escape');
  await kDrop('Mushroom', 0, -150);
  await kDrop('Mushroom', 100, -150);
  await kDrop('Enemy', 200, -150);
  await kp.mouse.click(kAt(-200, -150).x, kAt(-200, -150).y);
  await kAsk('The player kills mushroom-enemies by jumping on top of them, but other enemies cannot be killed that way.');
  await check(async () => (await kPrompt.getByTestId('prompt-result').innerText()).includes('Apply changes every Mushroom (2 placed)'), 'asked on the player, the choice is about the Mushroom');
  await changeObject(kPrompt);
  await check(async () => (await kPrompt.getByTestId('prompt-result').getAttribute('data-status')) === 'applied', 'asked on the player, the change is applied');
  await check(async () => (await kPrompt.getByTestId('result-message').innerText()).startsWith("I'll add this to the Mushroom enemy"), 'the AI says it put it on the mushroom, not the player');
  await check(async () => (await kPrompt.getByTestId('result-where').innerText()) === 'Changed: Mushroom (every copy, 2 in this level)', 'the prompt shows which object changed');
  await check(async () => (await kCanvas.getAttribute('data-flash')) === '2', 'the two mushrooms glow on the level');
  await kp.screenshot({ path: `${OUT}/21-change-elsewhere.png` });
  await kp.keyboard.press('Escape');

  step = 'AI speed and Gemini';
  await check(anthropicCalls.at(-1).effort === 'medium', 'by default Claude answers at its best-quality setting');
  await kp.getByTestId('main-menu').click();
  await kp.getByTestId('menu-ai-connection').click();
  await dialog.getByTestId('ai-speed-fast').click();
  await check(async () => (await dialog.getByTestId('ai-speed-fast').getAttribute('aria-checked')) === 'true', 'Speed can be set to Fast');
  await kp.keyboard.press('Escape');
  await kp.mouse.click(kAt(-200, -150).x, kAt(-200, -150).y);
  await kAsk('Make the gravity a bit weaker.');
  await check(async () => (await kPrompt.getByTestId('prompt-result').getAttribute('data-status')) === 'applied', '(a prompt in Fast mode)');
  await check(anthropicCalls.at(-1).effort === 'low', 'Fast: Claude is asked to think less');
  await kp.keyboard.press('Escape');

  // A stand-in for Google's Gemini API: the model list, and answers from the stub model.
  const GKEY = 'AIza-test-gemini-key-5678';
  const googleCalls = [];
  let geminiBusy = false;
  await kp.route('https://generativelanguage.googleapis.com/**', async (route) => {
    const r = route.request();
    const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET,POST,OPTIONS' };
    if (r.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    const headers = await r.allHeaders();
    const json = (status, body) => route.fulfill({ status, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const call = { url: r.url(), key: headers['x-goog-api-key'] };
    googleCalls.push(call);
    if (headers['x-goog-api-key'] !== GKEY) return json(400, { error: { code: 400, message: 'API key not valid. Please pass a valid API key.', status: 'INVALID_ARGUMENT' } });
    if (r.method() === 'GET') {
      const m = (name, methods = ['generateContent']) => ({ name: `models/${name}`, supportedGenerationMethods: methods });
      return json(200, { models: [m('gemini-3.5-pro'), m('gemini-3.8-flash-lite'), m('gemini-3.8-flash'), m('gemini-3.5-flash'), m('text-embedding-9', ['embedContent'])] });
    }
    const sent = JSON.parse(r.postData());
    call.body = sent;
    if (geminiBusy && r.url().includes('gemini-3.8-flash:')) return json(503, { error: { code: 503, message: 'The model is overloaded. Please try again later.', status: 'UNAVAILABLE' } });
    const text = sent.contents[0].parts[0].text;
    const context = JSON.parse(text.split('\n')[1]);
    const request = text.slice(text.lastIndexOf('REQUEST\n') + 8);
    const out = stubModel({ context, request, history: [] });
    return json(200, { candidates: [{ content: { role: 'model', parts: [{ text: 'thinking it over', thought: true }, { text: JSON.stringify(out) }] }, finishReason: 'STOP' }] });
  });
  await kp.getByTestId('main-menu').click();
  await kp.getByTestId('menu-ai-connection').click();
  await dialog.getByTestId('ai-vendor-gemini').click();
  await check(async () => (await dialog.getByTestId('gemini-status').innerText()).includes('Add your Gemini API key'), 'choosing Gemini asks for a Gemini key');
  await kp.keyboard.press('Escape');
  await kp.mouse.click(kAt(-200, -150).x, kAt(-200, -150).y);
  await kAsk('Make the gravity a bit weaker.');
  await check(async () => (await kPrompt.getByTestId('prompt-result').innerText()).includes('no Gemini API key'), 'without a Gemini key, a prompt says what is missing (and does not quietly use Claude)');
  await kp.keyboard.press('Escape');
  await kp.getByTestId('main-menu').click();
  await kp.getByTestId('menu-ai-connection').click();
  await dialog.getByTestId('gemini-key-input').fill('AIza-wrong');
  await dialog.getByTestId('gemini-key-save').click();
  await check(async () => (await dialog.getByTestId('gemini-key-result').innerText()).includes('not accepted'), 'a wrong Gemini key is checked and not saved');
  await dialog.getByTestId('gemini-key-input').fill(GKEY);
  await dialog.getByTestId('gemini-key-save').click();
  await check(async () => (await dialog.getByTestId('gemini-key-result').innerText()).includes('Connected'), 'a valid Gemini key connects');
  await check(async () => (await dialog.getByTestId('gemini-model').locator('option').allInnerTexts()).join() === 'gemini-3.8-flash,gemini-3.5-flash,gemini-3.8-flash-lite,gemini-3.5-pro', 'the models the key can use are listed, Flash first (no embedding models)');
  await check(async () => (await dialog.getByTestId('gemini-model').inputValue()) === 'gemini-3.8-flash', 'Gemini Flash is chosen');
  await check(async () => (await dialog.getByTestId('gemini-backup').inputValue()) === 'gemini-3.5-flash', 'with Gemini 3.5 Flash as the backup when it is busy');
  await check(async () => (await dialog.getByTestId('gemini-status').innerText()).includes('AIza-te…5678'), 'the Gemini key is shown masked');
  await kp.screenshot({ path: `${OUT}/31-ai-connection-gemini.png` });
  await kp.keyboard.press('Escape');
  await kp.mouse.click(kAt(-200, -150).x, kAt(-200, -150).y);
  const claudeBefore = anthropicCalls.length;
  await kAsk('Make the gravity a bit weaker.');
  await check(async () => (await kPrompt.getByTestId('prompt-result').getAttribute('data-status')) === 'applied', 'Gemini answers the prompt and its change applies (its thinking is left out, the JSON answer is checked)');
  const gCall = googleCalls.at(-1);
  await check(gCall.url.endsWith('/models/gemini-3.8-flash:generateContent') && gCall.key === GKEY && !gCall.url.includes(GKEY), 'the request goes to the chosen Gemini model with the key in a header (not in the URL)');
  await check(gCall.body.generationConfig.responseMimeType === 'application/json' && gCall.body.generationConfig.thinkingConfig?.thinkingLevel === 'low' && gCall.body.systemInstruction.parts[0].text.includes('REPLY FORMAT'), 'JSON mode with the reply format; Fast asks Gemini to think less');
  await check(anthropicCalls.length === claudeBefore, 'Claude was not asked');
  geminiBusy = true;
  await kAsk('Make the gravity a bit weaker.');
  await check(async () => (await kPrompt.getByTestId('prompt-result').getAttribute('data-status')) === 'applied', 'when Gemini 3.8 Flash is busy, the prompt still gets an answer');
  await check(googleCalls.at(-2).url.includes('/gemini-3.8-flash:') && googleCalls.at(-1).url.includes('/gemini-3.5-flash:'), '…from the backup, Gemini 3.5 Flash');
  await kp.getByTestId('console-toggle').click();
  await check(async () => (await kp.getByTestId('console').innerText()).includes('gemini-3.8-flash is busy, so gemini-3.5-flash answers instead'), 'the console says the backup answered');
  await kp.keyboard.press('Escape');
  await kp.mouse.click(kAt(-200, -150).x, kAt(-200, -150).y);
  const callsBefore = googleCalls.length;
  await kAsk('Make the gravity a bit weaker.');
  await check(async () => (await kPrompt.getByTestId('prompt-result').getAttribute('data-status')) === 'applied' && googleCalls.length === callsBefore + 1 && googleCalls.at(-1).url.includes('/gemini-3.5-flash:'), 'the next prompt goes straight to the backup for a while (no waiting on the busy model)');
  geminiBusy = false;
  await kc.close();

  step = 'AI draws: overlays and a generated level';
  const gc = await browser.newContext({ viewport: { width: 1400, height: 860 } });
  const gp = await gc.newPage();
  gp.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  gp.on('console', (m) => m.type() === 'error' && !ignorable(m) && errors.push(`console: ${m.text()} (${m.location()?.url ?? ''})`));
  await gp.route('**/api/ai', async (route) => {
    const body = JSON.parse(route.request().postData());
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(stubModel(body)) });
  });
  await gp.goto(URL);
  const gCanvas = gp.getByTestId('viewport-canvas');
  const gBox = await gCanvas.boundingBox();
  const gAt = (wx, wy) => ({ x: gBox.x + gBox.width / 2 + wx, y: gBox.y + gBox.height / 2 + wy });
  const gPrompt = gp.getByTestId('context-prompt');
  const gAsk = async (text) => {
    const input = gPrompt.getByTestId('prompt-input');
    await input.click();
    await input.fill(text);
    await input.press('Enter');
  };
  await gp.getByTestId('dock-library').click();
  await gp.dragAndDrop('[data-testid="definition-Player"]', '[data-testid="viewport-canvas"]', { targetPosition: { x: gBox.width / 2, y: gBox.height / 2 } });
  await gp.mouse.click(gAt(0, 0).x, gAt(0, 0).y);
  await gAsk('I want to see the jump height in a panel above the player when editing.');
  await check(async () => (await gPrompt.getByTestId('prompt-result').getAttribute('data-status')) === 'applied', 'asking the Player prompt for its jump height adds an editor overlay');
  await check(async () => (await gCanvas.getAttribute('data-overlays')) === '1', 'a panel with the jump height is drawn above the player');
  await check(async () => {
    const pb = await gPrompt.boundingBox();
    return pb.y + pb.height < gAt(0, -16).y - 40;
  }, 'the prompt moves up to make room for the panel');
  await check(aiRequests.at(-1).context.editor?.metrics.some((x) => x.key === 'jumpHeight'), 'the AI knows which values can be shown');
  await gp.screenshot({ path: `${OUT}/18-jump-overlay.png` });
  await gPrompt.getByTestId('result-undo').click();
  await check(async () => (await gCanvas.getAttribute('data-overlays')) === '0', 'Undo removes the overlay (editor undo)');
  await gAsk('Show the jump height above the player.');
  await check(async () => (await gCanvas.getAttribute('data-overlays')) === '1', '(shown again)');
  await gp.keyboard.press('Escape');

  const empty = gAt(300, -200);
  await gp.mouse.dblclick(empty.x, empty.y);
  await check(async () => (await gPrompt.getAttribute('data-context')) === 'level', 'double-clicking empty space gives the level prompt');
  const before = Number(await gCanvas.getAttribute('data-entities'));
  await gAsk('Generate a hard level with spikes, enemies and teleporters.');
  await check(async () => (await gPrompt.getByTestId('prompt-result').getAttribute('data-status')) === 'proposal', 'level generation is a preview');
  await check(async () => {
    const [created, removed] = ((await gCanvas.getAttribute('data-preview')) ?? '').split(',').map(Number);
    return created > 30 && removed === before;
  }, 'the proposed level is drawn on the canvas (new things outlined, removed things in red) before applying');
  await check(async () => Number(await gCanvas.getAttribute('data-entities')) === before, 'nothing is changed yet');
  await gp.waitForTimeout(300);
  await gp.screenshot({ path: `${OUT}/19-level-preview.png` });
  await check(async () => (await gPrompt.getByTestId('prompt-result').locator('.changes li').count()) === 6 && (await gPrompt.getByTestId('result-more').innerText()) === '+3 more', 'a long list shows the first five changes and "+3 more"');
  await gPrompt.getByTestId('result-more').click();
  const resultDialog = gp.getByTestId('result-dialog');
  await check(async () => (await resultDialog.isVisible()) && (await resultDialog.locator('.changes li').count()) === 8 && (await resultDialog.innerText()).includes('You asked:'), '"+3 more" opens a dialog with every change');
  await gp.waitForTimeout(300);
  await gp.screenshot({ path: `${OUT}/19b-result-dialog.png` });
  await gp.keyboard.press('Escape');
  await check(async () => (await resultDialog.count()) === 0 && (await gPrompt.getByTestId('prompt-result').getAttribute('data-status')) === 'proposal', 'Esc closes the dialog; the proposal is still waiting on the card');
  await gPrompt.getByTestId('proposal-apply').click();
  await check(async () => Number(await gCanvas.getAttribute('data-entities')) > 30 && (await gCanvas.getAttribute('data-preview')) === '', 'Apply draws it for real');
  await gp.getByTestId('play').click();
  const gPlay = gp.getByTestId('play-canvas');
  await check(async () => ((await gPlay.getAttribute('data-player')) ?? '').split(',')[2] === '1', 'the generated level is playable: the player starts on solid ground');
  await gp.keyboard.press('Escape');
  await check(async () => (await gCanvas.getAttribute('data-overlays')) === '1', 'overlays are only drawn while editing');
  await gc.close();

  step = 'debugging';
  {
    const dc = await browser.newContext({ viewport: { width: 1400, height: 860 } });
    const dp = await dc.newPage();
    dp.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
    dp.on('console', (m) => m.type() === 'error' && !ignorable(m) && errors.push(`console: ${m.text()} (${m.location()?.url ?? ''})`));
    await dp.route('**/api/ai', async (route) => {
      const body = JSON.parse(route.request().postData());
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(stubModel(body)) });
    });
    await dp.goto(URL);
    await dp.getByTestId('global-prompt-toggle').click();
    const lp = dp.getByTestId('global-prompt');
    const lAsk = async (text) => {
      const input = lp.getByTestId('prompt-input');
      await input.fill(text);
      await input.press('Enter');
    };
    await lAsk('Build a locked door test room');
    await check(async () => (await lp.getByTestId('prompt-result').getAttribute('data-status')) === 'applied', 'a level with a locked door (and no key) is built');
    await check(aiRequests.at(-1).context.debug.lastPlay === null && aiRequests.at(-1).context.debug.problems.length === 0, 'the AI gets the debug section (no play yet, no problems in an empty level)');
    await lp.getByTestId('prompt-close').click();
    await check(async () => (await dp.getByTestId('problem-count').innerText()) === '1', 'the Debug chip counts one problem');
    await dp.getByTestId('debug-toggle').click();
    const panel = dp.getByTestId('debug-panel');
    await check(async () => (await panel.getByTestId('problem').first().innerText()).includes('nothing in this level gives "key"'), 'Debug lists it: the door needs a key nothing gives');
    await check(async () => (await panel.innerText()).includes('Play the level'), 'without a play yet, it says to play first');

    await dp.getByTestId('play').click();
    await dp.getByTestId('play-canvas').click();
    await dp.keyboard.down('ArrowRight');
    await dp.waitForTimeout(1200);
    await dp.keyboard.up('ArrowRight');
    await dp.keyboard.press('Escape');
    await dp.getByTestId('debug-toggle').click().catch(() => {});
    await dp.getByTestId('tab-debug').click();
    const log = dp.getByTestId('play-log');
    await check(async () => /Player touches Door, which stays locked \(needs key\)/.test(await log.innerText()), 'the last play log shows the player touching the locked door');
    await check(async () => (await panel.getByTestId('ask-why').allInnerTexts()).some((x) => x.includes("Why didn't Door open?")), 'and offers "Why didn\'t Door open?"');
    await dp.screenshot({ path: `${OUT}/30-debug.png` });
    await panel.getByTestId('ask-why').filter({ hasText: "Why didn't Door open?" }).click();
    await check(async () => (await lp.getByTestId('prompt-result').getAttribute('data-status')) === 'message', 'asking opens the level card with the answer');
    const why = aiRequests.at(-1);
    await check(why.context.debug.lastPlay?.counts.locked >= 1 && why.context.debug.lastPlay.traces[0].name === 'Player' && why.context.debug.lastPlay.note.includes('Nothing was changed'), 'the AI got the last play: the locked touch, the player\'s movement, and that it is current');
    await check(async () => (await lp.innerText()).includes('the player touched it without the key'), 'the answer explains from the recorded play');
    await lp.getByTestId('prompt-close').click();

    await dp.getByTestId('tab-debug').click().catch(async () => dp.getByTestId('debug-toggle').click());
    await panel.getByTestId('fix-with-ai').first().click();
    await check(async () => (await lp.getByTestId('prompt-result').getAttribute('data-status')) === 'proposal', '✦ Fix asks the AI and shows its fix to confirm');
    await check(aiRequests.at(-1).request.startsWith('Fix this problem: Door only opens'), 'the AI is told exactly which problem to fix');
    await lp.getByTestId('proposal-apply').click();
    await check(async () => (await dp.getByTestId('problem-count').count()) === 0, 'after applying the fix the problem is gone');
    await check(async () => (await panel.innerText()).includes('the game changed since'), 'the last play is marked as older than the game now');

    if ((await lp.count()) === 0) await dp.getByTestId('global-prompt-toggle').click();
    await lAsk('Put a coin up high');
    await check(async () => (await lp.getByTestId('prompt-result').getAttribute('data-status')) === 'applied', 'a level change the player could not finish is sent back and comes back fixed');
    await check(aiRequests.at(-1).request.includes("could not be applied: The player can't get to Coin from where it starts"), "the AI is told exactly what can't be reached, with the player's jump limits");
    await lp.getByTestId('prompt-close').click();
    await dc.close();
  }

  step = 'editor prompt';
  const ec = await browser.newContext({ viewport: { width: 1400, height: 860 } });
  const ep = await ec.newPage();
  ep.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  ep.on('console', (m) => m.type() === 'error' && !ignorable(m) && errors.push(`console: ${m.text()} (${m.location()?.url ?? ''})`));
  await ep.route('**/api/ai', async (route) => {
    const body = JSON.parse(route.request().postData());
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(stubModel(body)) });
  });
  await ep.goto(URL);
  await ep.setViewportSize({ width: 900, height: 860 });
  await check(async () => {
    const play = await ep.getByTestId('play').boundingBox();
    const others = [await ep.getByTestId('scene-selector').boundingBox(), await ep.getByTestId('undo').boundingBox(), await ep.getByTestId('redo').boundingBox(), await ep.getByTestId('global-prompt-toggle').boundingBox()];
    return others.every((o) => play.x >= o.x + o.width || play.x + play.width <= o.x);
  }, 'in a narrower window the Play button never covers the level menu or undo/redo');
  await ep.screenshot({ path: `${OUT}/20-narrow-topbar.png` });
  const bottomClear = async () => {
    const dock = await ep.locator('.dock').first().boundingBox();
    const chips = await ep.locator('.tray-chips').boundingBox();
    const apart = dock.x + dock.width <= chips.x || chips.x + chips.width <= dock.x || dock.y + dock.height <= chips.y || chips.y + chips.height <= dock.y;
    const menu = await ep.getByTestId('main-menu').boundingBox();
    const vw = (await ep.viewportSize()).width;
    return apart && chips.x + chips.width <= vw && menu.x + menu.width <= vw;
  };
  for (const w of [1400, 1000, 900, 760, 640, 520, 420]) {
    await ep.setViewportSize({ width: w, height: 860 });
    await check(bottomClear, `at ${w}px wide the bottom bar and the History/Console buttons don't overlap, and everything stays on screen`);
  }
  await ep.setViewportSize({ width: 520, height: 860 });
  await ep.screenshot({ path: `${OUT}/20b-narrow-bottom.png` });
  await ep.setViewportSize({ width: 900, height: 860 });
  await ep.setViewportSize({ width: 1400, height: 860 });
  const eCanvas = ep.getByTestId('viewport-canvas');
  const canvasWidth = (await eCanvas.boundingBox()).width;
  await ep.getByTestId('global-prompt-toggle').click();
  await ep.getByTestId('scope-editor').click();
  const editorPrompt = ep.getByTestId('editor-prompt');
  const eAsk = async (text) => {
    const input = editorPrompt.getByTestId('prompt-input');
    await input.click();
    await input.fill(text);
    await input.press('Enter');
  };
  const eResult = editorPrompt.getByTestId('prompt-result');
  await eAsk('Move the Play button to the bottom of the screen.');
  await check(async () => (await eResult.getAttribute('data-status')) === 'applied', 'the Editor tab of the ✦ prompt changes the editor');
  await check(async () => (await ep.locator('.dock [data-testid="play"]').count()) === 1 && (await ep.locator('.topbar [data-testid="play"]').count()) === 0, 'the Play button moved to the bottom bar');
  const editorReq = aiRequests.at(-1);
  await check(editorReq.context.scope === 'editor' && editorReq.context.editor.settings.some((x) => x.key === 'playButton' && x.value === 'top'), 'the AI gets the editor settings, with their current values');
  await editorPrompt.getByTestId('prompt-close').click();
  await check(async () => (await ep.getByTestId('global-prompt').count()) === 0, 'the × closes the ✦ prompt card too');
  await ep.screenshot({ path: `${OUT}/16-play-bottom.png` });
  await ep.locator('.dock [data-testid="play"]').click();
  await check(async () => (await ep.locator('.play-float [data-testid="play"]').innerText()).includes('Stop'), 'while playing, Stop is at the bottom too');
  await ep.keyboard.press('Escape');
  await ep.getByTestId('global-prompt-toggle').click();
  await ep.getByTestId('scope-editor').click();
  await eAsk('Move the play button to the bottom.');
  await editorPrompt.getByTestId('result-undo').click();
  await check(async () => (await ep.locator('.topbar [data-testid="play"]').count()) === 1, 'Undo puts the editor back (the editor has its own undo)');
  await eAsk('Move the play button to the bottom.');
  await check(async () => (await ep.locator('.dock [data-testid="play"]').count()) === 1, '(again at the bottom)');

  await eAsk('I want the detail inspector docked at the right side of the screen.');
  await check(async () => (await ep.getByTestId('inspector').getAttribute('data-docked')) === 'true', 'the details panel is docked');
  await check(async () => {
    const ib = await ep.getByTestId('inspector').boundingBox();
    const cb = await eCanvas.boundingBox();
    return ib.x >= cb.x + cb.width - 1 && cb.width < canvasWidth - 200;
  }, 'on the right, and the level view makes room for it');
  await eAsk('Make the editor green.');
  await check(async () => (await ep.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--accent').trim())) === '#2ea043', 'the accent color changes');
  await eAsk('Put the play button sideways.');
  await check(async () => (await eResult.getAttribute('data-status')) === 'error' && (await eResult.innerText()).includes('must be one of'), 'an invalid editor value is rejected, nothing changes');
  await eAsk('Add a timeline panel.');
  await check(async () => (await eResult.getAttribute('data-status')) === 'message' && (await eResult.innerText()).includes("can't do that yet"), 'what the editor cannot do gets a plain answer');
  await ep.screenshot({ path: `${OUT}/17-editor-docked.png` });
  for (const w of [1400, 1100, 900, 700]) {
    await ep.setViewportSize({ width: w, height: 860 });
    await check(bottomClear, `with the details docked and Play at the bottom, at ${w}px the bottom controls don't overlap`);
  }
  await ep.setViewportSize({ width: 1400, height: 860 });
  await ep.reload();
  await check(async () => (await ep.getByTestId('inspector').getAttribute('data-docked')) === 'true' && (await ep.locator('.dock [data-testid="play"]').count()) === 1, 'editor settings are remembered after a reload');
  step = 'editor styles';
  const htmlStyle = () => ep.evaluate(() => document.documentElement.dataset.style);
  await check(async () => (await htmlStyle()) === 'classic', 'the editor starts in the Classic style');
  await ep.getByTestId('main-menu').click();
  await ep.getByTestId('menu-style').click();
  const picker = ep.getByTestId('style-picker');
  await check(async () => (await picker.isVisible()) && (await picker.getByRole('radio').count()) === 5 && (await picker.getByTestId('style-classic').getAttribute('aria-checked')) === 'true', 'the style picker shows five styles, Classic chosen');
  for (const st of ['blueprint', 'arcade', 'paper', 'amber']) {
    await picker.getByTestId(`style-${st}`).click();
    await check(async () => (await htmlStyle()) === st && (await picker.getByTestId(`style-${st}`).getAttribute('aria-checked')) === 'true', `choosing ${st} restyles the editor at once`);
    await ep.keyboard.press('Escape');
    await ep.mouse.click(700, 420);
    await ep.screenshot({ path: `${OUT}/27-style-${st}.png` });
    await ep.keyboard.press('Escape');
    await ep.getByTestId('main-menu').click();
    await ep.getByTestId('menu-style').click();
  }
  const bg = () => ep.evaluate(() => getComputedStyle(document.querySelector('.topbar')).backgroundColor);
  await check(async () => (await bg()) === 'rgb(17, 12, 4)', 'the amber style really changes the top bar');
  await ep.keyboard.press('Escape');
  await check(async () => (await picker.count()) === 0, 'Esc closes the picker');
  await ep.reload();
  await check(async () => (await htmlStyle()) === 'amber', 'the chosen style is remembered after a reload');
  await ep.getByTestId('main-menu').click();
  await ep.getByTestId('menu-reset-layout').click();
  await check(async () => (await ep.getByTestId('inspector').count()) === 0 && (await ep.locator('.topbar [data-testid="play"]').count()) === 1, 'Reset editor layout restores the defaults');
  await check(async () => (await htmlStyle()) === 'classic', '(including the Classic style)');
  await ec.close();

  step = 'console errors';
  await check(errors.length === 0, `no page/console errors${errors.length ? ': ' + errors.join(' | ') : ''}`);
  console.log(`\nE2E passed (${passed} checks).`);
} catch (e) {
  console.error(`\nE2E FAILED: ${e.message}`);
  console.error(`step: ${step}`);
  if (diagnostics) console.error(`recent events on the main page:\n${await diagnostics().catch((x) => x.message)}`);
  await browser.contexts()[0]?.pages()[0]?.screenshot({ path: `${OUT}/failure.png` }).catch(() => {});
  if (errors.length) console.error(errors.join('\n'));
  process.exitCode = 1;
} finally {
  await browser.close();
  server.kill();
}
