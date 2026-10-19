// End-to-end test: builds the app, serves it, and drives the real editor in
// headless Chromium. Usage: npm run test:e2e
//
// The language model is the only stubbed part: /api/ai is intercepted with a
// deterministic stub that returns structured operations computed from the
// context the editor actually sends. Everything else (selection context,
// prompt placement, validation, transactions, undo, rendering) is real.
// A final pass runs against the real server endpoint with no API key.
import { readFileSync } from 'node:fs';
import { execSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const PORT = 4179;
// Built for GitHub Pages, so the app lives under /PXLBuilder/ (vite.config.ts).
const URL = `http://localhost:${PORT}/PXLBuilder/`;
const OUT = 'test-results';
mkdirSync(OUT, { recursive: true });

execSync('node scripts/build-player.mjs && node scripts/build-runners.mjs && npx vite build', { stdio: ['ignore', 'ignore', 'inherit'] });
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

/** A first visit (nothing saved) asks what kind of game to make; pages that don't test that pick a platformer. */
const startPlatformer = async (p) => {
  await p.getByTestId('viewport-canvas').waitFor();
  if (await p.getByTestId('game-chooser').count()) await p.getByTestId('game-platformer').click();
};

/** Stand-in for the language model: same protocol, deterministic answers. */
const aiRequests = [];
let diagnostics = null;
/** Where a change to what a thing is goes: its library object (the AI is told so), or the thing itself when it has none. */
const own = (target) => (target.object?.id ? { target: 'definition', id: target.object.id } : { target: 'instance', id: target.id });

/**
 * The prompt card opens on a double-click (or Enter on the selection): if it isn't open yet for what is selected,
 * open it the keyboard way before typing into it.
 */
async function openCard(pg, card) {
  if ((await card.count()) > 0) return;
  await pg.getByTestId('viewport-canvas').focus();
  await pg.keyboard.press('Enter');
  await card.waitFor({ timeout: 5000 });
}

/** Opens Details the way a user does on this page: right-click the selected object (or empty level) → Details…. */
async function openDetailsOn(pg) {
  const canvas = pg.getByTestId('viewport-canvas');
  const b = await canvas.boundingBox();
  // The selection's middle is written when the level is next drawn: wait until it has settled.
  let sel = await canvas.getAttribute('data-selection');
  for (let i = 0; i < 10; i++) {
    await pg.waitForTimeout(60);
    const now = await canvas.getAttribute('data-selection');
    if (now === sel) break;
    sel = now;
  }
  const [cx, cy, zoom] = ((await canvas.getAttribute('data-camera')) ?? '0,0,1').split(',').map(Number);
  const at = sel ? sel.split(',').map(Number) : [cx + 420 / zoom, cy + 260 / zoom];
  await pg.mouse.click(b.x + b.width / 2 + (at[0] - cx) * zoom, b.y + b.height / 2 + (at[1] - cy) * zoom, { button: 'right' });
  await pg.getByTestId('ctx-details').click();
}

function stubModel(body) {
  aiRequests.push(body);
  const req = body.request.toLowerCase();
  const t = body.context.targets;
  if (req.includes('what does the coin do')) {
    // Other objects' code isn't sent up front: ask for the Coin's, then answer from it.
    const coin = body.context.library.find((d) => d.name === 'Coin');
    if (!body.code?.some((c) => c.id === coin.id)) return { kind: 'need_code', message: "I need to read the Coin's code.", changes: [], operations: [], needCode: [coin.id] };
    const got = body.code.find((c) => c.id === coin.id);
    return { kind: 'answer', message: `I read the Coin's code: ${got.scripts.length} script(s), ${coin.codeInTargets ? 'sent up front' : 'sent when I asked'}.`, changes: [], operations: [] };
  }
  if (req.includes('dig for diamonds')) {
    // A new game told in words: the platformer starter doesn't fit, so the top-down one, then built on it.
    if (body.context.newGame?.current === 'platformer') return { kind: 'switch_starter', message: 'Seen from above suits this better.', changes: [], operations: [], needCode: null, starter: 'topdown' };
    const lib = (name) => body.context.library.find((d) => d.name === name).id;
    const sceneId = body.context.level.id;
    return {
      kind: 'preview',
      message: `Built it on the ${body.context.newGame?.current} starter.`,
      changes: ['A player and a wall'],
      operations: [
        { op: 'place_instance', sceneId, definitionRef: lib('Player'), x: 16, y: 16, name: null, ref: null },
        { op: 'place_instance', sceneId, definitionRef: lib('Wall'), x: 48, y: 16, name: null, ref: null },
      ],
    };
  }
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
  if (req.includes('with three levels')) {
    // Two new levels, each with its own player, a route and a goal.
    const lib = (name) => body.context.library.find((d) => d.name === name).id;
    const level = (ref, name, steps) => [
      { op: 'create_level', ref, name },
      { op: 'place_instance', sceneId: ref, definitionRef: lib('Player'), x: 16, y: -16, name: null, ref: null },
      { op: 'build_path', sceneId: ref, start: null, direction: 'right', floor: 'Platform', ladder: null, steps: [...steps, { do: 'put', object: 'Goal', name: null, ref: null }] },
    ];
    return {
      kind: 'apply',
      message: 'Made two more levels.',
      changes: ['The Mines: a long run', 'The Tower: up a ladder'],
      operations: [
        ...level('L2', 'The Mines', [{ do: 'run', cells: 6 }]),
        ...level('L3', 'The Tower', [{ do: 'run', cells: 2 }, { do: 'climb', rows: 3 }, { do: 'run', cells: 3 }]),
      ],
    };
  }
  if (req.includes('route with a ladder')) {
    return {
      kind: 'preview',
      message: 'Built a route with a ladder up to a coin.',
      changes: ['Route: run, jump, climb a ladder, a coin at the top'],
      operations: [
        {
          op: 'build_path',
          sceneId: body.context.level.id,
          start: null,
          direction: 'right',
          floor: 'Stone',
          ladder: null,
          steps: [
            { do: 'run', cells: 2 },
            { do: 'jump', gap: 2, rise: 1 },
            { do: 'run', cells: 2 },
            { do: 'climb', rows: 3 },
            { do: 'run', cells: 2 },
            { do: 'put', object: 'Coin', name: null, ref: null },
          ],
        },
      ],
    };
  }
  if (req.includes('far away')) {
    const stone = body.context.library.find((d) => d.name === 'Stone').id;
    return { kind: 'apply', message: 'Built a stone far to the right.', changes: ['Stone at x 3000'], operations: [{ op: 'place_instance', sceneId: body.context.level.id, definitionRef: stone, x: 3008, y: 16, name: null, ref: null }] };
  }
  if (req.includes('quack twice')) {
    // A small change to an existing script: only that part (edit_script), not the whole script again.
    const player = body.context.library.find((d) => d.name === 'Player');
    const quack = body.context.targets.flatMap((t) => t.scripts?.object ?? []).find((sc) => sc.name === 'Quack');
    const scriptId = quack?.id;
    return {
      kind: 'apply',
      message: 'The player quacks twice now.',
      changes: ['Player: a second quack'],
      operations: [{ op: 'edit_script', target: 'definition', id: player.id, scriptId, editsJson: JSON.stringify([{ at: 'handlers.0.do.1', action: 'insert', value: { do: 'play_sound', sound: 'Quack' }, was: '' }]) }],
    };
  }
  if (req.includes('quacks like a duck')) {
    const player = body.context.library.find((d) => d.name === 'Player').id;
    const quack = { type: 'steps', speed: 6, notes: [[22, 2, 6, 0], [20, 2, 5, 1], [18, 2, 3, 5], [0, 0, 0, 0], [21, 2, 5, 0], [17, 2, 3, 5]] };
    const script = { name: 'Quack', description: 'Quacks when the level starts.', handlers: [{ when: { on: 'start' }, do: [{ do: 'play_sound', sound: 'Quack' }] }] };
    return {
      kind: 'apply',
      message: 'Made a quack and the player plays it when the level starts.',
      changes: ['Sound: Quack', 'Player: quacks at the start'],
      operations: [
        { op: 'make_sound', name: 'Quack', description: 'a duck quack', soundJson: JSON.stringify(quack), replaceId: null },
        { op: 'set_script', target: 'definition', id: player, scriptJson: JSON.stringify(script) },
      ],
    };
  }
  if (req.includes('hearts bigger')) {
    // Not a setting: a script on the player that draws its own, bigger hearts and hides the built-in ones.
    const player = body.context.library.find((d) => d.name === 'Player').id;
    const script = {
      name: 'Big hearts',
      description: 'Draws the health as big hearts in the top left corner.',
      handlers: [
        {
          when: { on: 'tick' },
          do: [
            { do: 'builtin_display', what: 'hearts', show: false },
            { do: 'erase', id: null },
            { do: 'repeat', times: 'self.max_health', then: [{ do: 'draw', id: 'heart{i}', shape: 'circle', anchor: 'top_left', x: '16 + i * 52', y: '16', w: '44', h: '44', color: '#ff4d6d', alpha: 'i < self.health ? 1 : 0.25' }] },
          ],
        },
      ],
    };
    return { kind: 'apply', message: 'The player now draws its own hearts, twice as big.', changes: ['Player: draws big hearts (the built-in ones are hidden)'], operations: [{ op: 'set_script', target: 'definition', id: player, scriptJson: JSON.stringify(script) }] };
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
    const set = (field) => ({ op: 'set_component_field', ...own(t[0]), component: 'Health', field, valueJson: '5' });
    return { kind: 'apply', message: 'Gave the player 5 hearts.', changes: [`${t[0].name}: 5 hearts`], operations: [set('maxHealth'), set('currentHealth')] };
  }
  if (req.includes('three hearts')) {
    return { kind: 'apply', message: 'Gave the player 3 hearts.', changes: [`${t[0].name}: 3 hearts`], operations: [{ op: 'add_component', ...own(t[0]), component: 'Health', propsJson: '{"maxHealth":3,"currentHealth":3}' }] };
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
    return { kind: 'apply', message: 'The enemy now hops toward the player.', changes: [`${t[0].name}: hops toward the player when close`], operations: [{ op: 'set_script', ...own(t[0]), scriptJson: JSON.stringify(script) }] };
  }
  if (req.includes('open the sprite editor')) {
    return { kind: 'apply', message: 'The sprite editor is open: draw away.', changes: [], operations: [{ op: 'open_sprite_editor', id: t[0].id, situation: null }] };
  }
  if (req.includes('top-down game')) {
    const player = body.context.library.find((d) => d.name === 'Player');
    return {
      kind: 'apply',
      message: 'The game is now seen from above: the player walks in every direction and nothing falls.',
      changes: ['Player: walks top-down', 'Gravity: 980 → 0'],
      operations: [
        { op: 'set_component_field', target: 'definition', id: player.id, component: 'CharacterController', field: 'movement', valueJson: '"topdown"' },
        { op: 'set_world', sceneId: body.context.level.id, gravityX: 0, gravityY: 0, backgroundColor: null },
      ],
    };
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
    return { kind: 'apply', message: 'Made it bigger.', changes: [`${t[0].name}: wider`], operations: [{ op: 'set_component_field', ...own(t[0]), component: 'Sprite', field: 'color', valueJson: '"#00ff88"' }] };
  }
  if (req.includes('take your time') && req.includes('propose')) {
    return { kind: 'preview', message: 'Here is an idea: make it green.', changes: [`${t[0].name}: green`], operations: [{ op: 'set_component_field', ...own(t[0]), component: 'Sprite', field: 'color', valueJson: '"#00aa00"' }] };
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
    // (Like the AI: an enemy that already patrols gets its distance changed.)
    const ops = t[0].components?.Patrol
      ? [{ op: 'set_component_field', ...own(t[0]), component: 'Patrol', field: 'distance', valueJson: '64' }]
      : [{ op: 'add_component', ...own(t[0]), component: 'Patrol', propsJson: '{"speed":60,"distance":64}' }];
    return { kind: 'apply', message: 'The enemy now walks back and forth, turning at walls and ledges.', changes: [`${t[0].name}: patrols`], operations: ops };
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
      operations: t.map((e) => ({ op: 'set_component_field', ...own(e), component: 'Sprite', field: 'color', valueJson: '"#ff2d55"' })),
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
  if (req.includes('tinted red brick')) {
    const { width, height } = t[0].spriteGrid;
    // White face, gray rim, a see-through dark shadow along the bottom row.
    const rows = Array.from({ length: height }, (_, y) => Array.from({ length: width }, (_, x) => (y === height - 1 ? 's' : x === 0 || y === 0 || x === width - 1 ? 'g' : 'w')).join(''));
    const id = t[0].object.id;
    return {
      kind: 'apply',
      message: `${t[0].object.name}: one shaded brick picture, tinted red.`,
      changes: [`${t[0].object.name}: shaded brick, tinted red`],
      operations: [
        { op: 'draw_sprite', target: 'definition', id, name: 'Brick', palette: [{ key: 'w', color: '#ffffff' }, { key: 'g', color: '#9a9a9a' }, { key: 's', color: '#00000060' }], rows, situation: null },
        { op: 'set_component_field', target: 'definition', id, component: 'Sprite', field: 'color', valueJson: '"#ff0000"' },
        { op: 'set_component_field', target: 'definition', id, component: 'Sprite', field: 'tint', valueJson: 'true' },
      ],
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
    const keys = Object.keys(body.context.editor.values);
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
  await check(async () => await page.getByTestId('game-chooser').isVisible(), 'the first visit asks what kind of game to make');
  await page.screenshot({ path: `${OUT}/00-game-chooser.png` });
  await page.getByTestId('game-platformer').click();
  await check(async () => (await page.getByTestId('game-chooser').count()) === 0, 'picking Platformer goes straight to the editor');

  const canvas = page.getByTestId('viewport-canvas');
  const box = await canvas.boundingBox();
  const center = { x: box.width / 2, y: box.height / 2 };
  const toScreen = (wx, wy) => ({ x: box.x + center.x + wx, y: box.y + center.y + wy });
  const prompts = page.getByTestId('context-prompt');
  const promptInput = prompts.getByTestId('prompt-input');
  const ask = async (text) => {
    await openCard(page, prompts);
    await promptInput.click();
    await promptInput.fill(text);
    await promptInput.press('Enter');
  };
  const result = page.locator('[data-testid="context-prompt"] [data-testid="prompt-result"]');
  /** A change to what an object is goes to the object right away; wait for it. */
  const changeObject = async (where = page.getByTestId('context-prompt')) => {
    await where.locator('[data-testid="prompt-result"][data-status="applied"]').waitFor({ timeout: 10000 });
  };
  const clickWorld = async (wx, wy, opts = {}) => {
    // Where that level point is with the view as it is now (the editor frames a level when it opens it).
    const [cx, cy, zoom] = ((await page.getByTestId('viewport-canvas').getAttribute('data-camera')) ?? '0,0,1').split(',').map(Number);
    const p = { x: box.x + center.x + (wx - cx) * zoom, y: box.y + center.y + (wy - cy) * zoom };
    // page.mouse.click ignores `modifiers`, so hold them on the keyboard.
    for (const k of opts.modifiers ?? []) await page.keyboard.down(k);
    // On an object, a double-click: it selects it and opens its prompt card (a single click only selects). Empty
    // space gets a single click (a double-click there opens the level's card).
    // (Hovering it first: the pointer becomes a hand over an object, a connection or a camera outline.)
    let onObject = false;
    if (!opts.single && !(opts.modifiers ?? []).length) {
      await page.mouse.move(p.x, p.y);
      onObject = (await page.getByTestId('viewport-canvas').evaluate((c) => c.style.cursor)) === 'pointer';
    }
    if (onObject) await page.mouse.dblclick(p.x, p.y);
    else await page.mouse.click(p.x, p.y);
    for (const k of opts.modifiers ?? []) await page.keyboard.up(k);
  };
  const emptySpot = toScreen(420, 260);
  /** Opens the Details panel the way a user does: right-click the selected object (or empty level) → Details…. */
  const openDetails = () => openDetailsOn(page);

  step = 'canvas first';
  await check(async () => (await canvas.isVisible()) && (await page.getByTestId('inspector').count()) === 0, 'the game canvas fills the window; no inspector panel by default');
  await check(async () => (await prompts.count()) === 0, 'no prompt is visible when nothing is selected');
  {
    // The zoom bar: + and − step, the slider sets it, the percentage goes back to 100%.
    const pct = async () => Number((await page.getByTestId('zoom-reset').innerText()).replace('%', ''));
    await page.getByTestId('zoom-in').click();
    await check(async () => (await pct()) === 125, 'the zoom bar: + zooms in one step (125%)');
    await page.getByTestId('zoom-slider').focus();
    await page.keyboard.press('Home');
    await check(async () => (await pct()) === 10, 'the zoom slider sets the zoom (all the way out: 10%)');
    await page.getByTestId('zoom-reset').click();
    await check(async () => (await pct()) === 100, 'a click on the percentage goes back to 100%');
  }
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
  await check(
    async () => (await page.getByTestId('tool-select').getAttribute('aria-pressed')) === 'true' && (await prompts.count()) === 0 && Number((await page.getByTestId('viewport-canvas').getAttribute('data-handles')).match(/s1,0@(-?[\d.]+)/)[1]) > -110,
    'picked from the Objects panel: after the line is drawn it is back to the Select tool, with the last tile drawn (the right end) selected (no prompt card: that opens on a double-click)',
  );
  // With the Draw tool on, drawing goes on after a stroke.
  await page.getByTestId('tool-pen').click();
  await page.mouse.move(p0.x, p0.y);
  await page.mouse.down();
  await page.mouse.move(p1.x, p1.y, { steps: 8 });
  await page.mouse.up();
  await check(async () => (await entityCount()) === 7, 'drawing over existing tiles does not stack duplicates');
  await check(async () => (await page.getByTestId('tool-pen').getAttribute('aria-pressed')) === 'true', 'with the Draw tool chosen first, the pen stays after a stroke');
  const single = toScreen(40, 136);
  await page.mouse.click(single.x, single.y);
  await check(async () => (await entityCount()) === 8, 'a single click draws one tile');
  await page.mouse.click(single.x, single.y, { button: 'right' });
  await check(async () => (await entityCount()) === 7, 'right-click erases a tile');
  await page.getByTestId('undo').click();
  await check(async () => (await entityCount()) === 8, 'each stroke is one undo step');
  await page.getByTestId('redo').click();
  await check(async () => (await entityCount()) === 7, '(Redo erases it again)');
  // Drawing with something else (a coin), the right button still erases the platform tile under it.
  const n7 = await entityCount();
  await page.getByTestId('tool-pen').click();
  await page.mouse.click(single.x, single.y);
  await check(async () => (await entityCount()) === n7 + 1, `(a platform tile there again: ${n7} -> ${await entityCount()}, pen ${await page.getByTestId('tool-pen').getAttribute('aria-pressed')}, brush ${await page.getByTestId('tool-brush-pick').getAttribute('title').catch(() => '-')}, undo ${await page.getByTestId('undo').getAttribute('title')})`);
  await page.getByTestId('dock-library').click();
  await page.getByTestId('definition-Coin').click();
  await page.mouse.click(single.x, single.y, { button: 'right' });
  await check(async () => (await entityCount()) === n7 && (await page.getByTestId('undo').getAttribute('title')).includes('Erase 1 object'), 'drawing with a coin, right-click erases the platform tile there (any object, whatever is drawn with)');
  await page.keyboard.press('Escape');
  await page.getByTestId('tool-pen').click();
  await page.getByTestId('dock-library').click();
  await page.getByTestId('definition-Platform').click();
  await page.keyboard.press('Escape');
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
  await check(async () => (await entityCount()) === 7 + 3, `dragging down with the pen draws a 3-segment ladder`);
  await page.screenshot({ path: `${OUT}/0-drawn-tiles.png` });
  await page.getByTestId('undo').click();
  await page.getByTestId('tool-select').click();

  step = 'move one tile';
  const tile = toScreen(-112, 48);
  await page.mouse.click(tile.x, tile.y);
  await check(async () => (await canvas.getAttribute('data-context')) === 'entity' && (await prompts.count()) === 0, 'clicking a drawn tile selects just that tile (no prompt card: a single click only selects)');
  await page.mouse.dblclick(tile.x, tile.y);
  await check(async () => (await prompts.count()) === 1 && (await prompts.isVisible()), `double-clicking it opens its AI prompt card (${await prompts.count()} card, visible ${await prompts.isVisible().catch(() => '?')}, context ${await canvas.getAttribute('data-context')}, events ${(await diagnostics()).split('\n').slice(-6).join(' / ')})`);
  await page.mouse.click(emptySpot.x, emptySpot.y);
  await check(async () => (await prompts.count()) === 0, '(a click on empty space closes it)');
  await page.mouse.click(tile.x, tile.y);
  await page.mouse.move(tile.x, tile.y);
  await page.mouse.down();
  await page.mouse.move(tile.x + 20, tile.y - 50, { steps: 5 });
  await page.mouse.up();
  await openDetails();
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
  await check(async () => (await canvas.getAttribute('data-context')) === 'entity', 'the prompt is bound to the selected entity');
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
  await check(async () => (await result.getAttribute('data-status')) === 'applied', 'the AI change is applied at once (no Apply step)');
  await check(async () => (await result.innerText()).includes('Changed the Player object.') && (await prompts.getByTestId('result-as-new').innerText()) === 'Make it a new object instead', 'it went to the Player object; "Make it a new object instead" is offered');
  await check(async () => (await result.innerText()).includes('Player: 5 hearts'), 'a short confirmation lists what changed');
  const last = aiRequests.at(-1);
  await check(last.context.scope === 'entity' && last.context.targets[0].name === 'Player', 'the AI received the selected Player as context');
  await check(last.context.otherEntities.some((e) => e.name === 'Door'), 'other objects are available to the AI by name');
  await page.screenshot({ path: `${OUT}/3-applied.png` });
  await openDetails();
  await check(async () => (await page.getByTestId('field-Health.maxHealth').inputValue()) === '5', 'the details drawer shows the new health (max 5)');
  await page.getByTestId('close-details').click();

  step = 'undo/redo';
  await page.getByTestId('undo').click();
  await openDetails();
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
  await check(async () => (await result.getAttribute('data-status')) === 'applied' && (await result.innerText()).includes('Changed every Enemy (2 placed).'), 'a behavior request changes every Enemy at once (2 placed)');
  await page.screenshot({ path: `${OUT}/4b-object-choice.png` });
  await prompts.getByTestId('result-as-new').click();
  await check(async () => (await result.getAttribute('data-status')) === 'applied' && (await result.innerText()).includes('Created Enemy 2'), '"Make it a new object instead" swaps it for a new object');
  await check(aiRequests.at(-1).context.targets[0].name === 'Enemy', 'the AI received the Enemy as context');
  await check(async () => (await prompts.getByTestId('entity-header').innerText()).trim() === 'Enemy 2', 'the selected enemy is now the new kind, "Enemy 2"');
  await page.getByTestId('dock-library').click();
  await check(async () => (await page.getByTestId('definition-Enemy 2').count()) === 1 && (await page.getByTestId('definition-Enemy').count()) === 1, 'the new object is in the Objects panel, next to the old Enemy');
  await page.getByTestId('dock-library').click();
  await openDetails();
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
  await openDetails();
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
  await openDetails();
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
  await check(async () => (await jobsAttr()) === '0,0', "when the enemy's prompt finishes it is applied too, with nothing left waiting (no badge)");
  await clickWorld(-32, 0);
  await check(async () => (await result.getAttribute('data-status')) === 'applied', 'clicking the enemy again shows its applied result');
  await check(async () => (await prompts.getByTestId('result-undo').count()) === 1, "its change is the latest, so its card offers Undo");
  await page.getByTestId('undo').click();
  await check(async () => (await prompts.getByTestId('result-undone').count()) === 1, 'undone with the toolbar Undo: its card says so (↶ Undone)');
  await page.getByTestId('redo').click();
  await check(async () => (await prompts.getByTestId('result-undone').count()) === 0 && (await prompts.getByTestId('result-undo').count()) === 1, 'and Redo applies it again');
  await clickWorld(-256, 0);
  await check(async () => (await result.getAttribute('data-status')) === 'applied' && (await result.innerText()).includes('in history') && (await prompts.getByTestId('result-undo').count()) === 0, "the player's card still shows its result, but no Undo: the enemy's change came after it");
  await prompts.getByTestId('prompt-close').click();
  await clickWorld(-32, 0);
  await ask('Take your time: propose a new color for this enemy.');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await check(async () => (await prompts.count()) === 0, 'the card closed while the AI works');
  await check(async () => (await jobsAttr()) === '0,0', 'when it finishes with the card closed, the change is applied anyway: closing the card loses nothing');
  await clickWorld(-32, 0);
  await check(async () => (await result.getAttribute('data-status')) === 'applied' && (await prompts.getByTestId('result-undo').count()) === 1, 'opening the enemy shows the applied change, with Undo');
  await prompts.getByTestId('result-undo').click();
  await ask('Take your time: make this enemy bigger.');
  await prompts.getByTestId('prompt-stop').click();
  await check(async () => (await prompts.getByTestId('prompt-stop').count()) === 0 && (await jobsAttr()) === '0,0', 'Stop ends a running prompt');
  await page.waitForTimeout(2700);
  await check(async () => (await prompts.getByTestId('chat-request').innerText()) === '' && (await prompts.getByTestId('chat-past').count()) >= 2, '(the card goes back to the conversation before it, and the stopped answer is ignored when it arrives)');
  // Put the enemy's color back (the player already had five hearts, so that prompt changed nothing).
  await page.getByTestId('undo').click();

  step = 'relationship context';
  await clickWorld(224, -16, { modifiers: ['Shift'] });
  await check(async () => (await canvas.getAttribute('data-context')) === 'pair', 'two selected objects give one relationship prompt');
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
  await check(async () => (await canvas.getAttribute('data-context')) === 'pair', 'box-selecting the two enemies gives one shared prompt');
  await clickWorld(-256, 0, { modifiers: ['Shift'] });
  await check(async () => (await canvas.getAttribute('data-context')) === 'group' && (await prompts.count()) === 0, 'three selected objects are one group (its prompt card opens on a double-click, not by selecting)');
  await ask('Make these enemies move faster.');
  await check(async () => (await result.getAttribute('data-status')) === 'applied', 'a multi-object change is applied at once too');
  await check(async () => (await result.locator('.changes li').count()) === 3, 'the result lists one line per affected object');
  await page.screenshot({ path: `${OUT}/5-preview.png` });
  await prompts.getByTestId('result-undo').click();
  await check(async () => (await prompts.getByTestId('result-undone').count()) === 1, 'Undo on the card takes the whole change back (the card says so)');

  step = 'golden test 5: world';
  await page.mouse.dblclick(emptySpot.x, emptySpot.y);
  await check(async () => (await canvas.getAttribute('data-context')) === 'level', 'double-clicking empty space makes the level the context');
  await page.screenshot({ path: `${OUT}/5b-world-context.png` });
  await ask('Make gravity 30% weaker.');
  await check(async () => (await result.getAttribute('data-status')) === 'applied', 'world change applied');
  await check(async () => (await result.innerText()).includes('980 → 686'), 'confirmation shows the gravity change');
  await openDetails();
  await check(async () => (await page.getByTestId('world-gravity.y').inputValue()) === '686', 'level gravity is now 686');
  await page.getByTestId('close-details').click();
  await ask('Make gravity 30% weaker.');
  await check(async () => (await prompts.getByTestId('chat-past').count()) === 1 && (await prompts.getByTestId('chat-past').innerText()).includes('Make gravity 30% weaker.') && (await result.getAttribute('data-status')) === 'applied', 'a second prompt adds to the card like a chat: the first request and answer stay above it');
  {
    const chatBox = await prompts.getByTestId('prompt-chat').boundingBox();
    const inputBox = await prompts.getByTestId('prompt-input').boundingBox();
    await check(chatBox && inputBox && inputBox.y >= chatBox.y + chatBox.height - 1, 'the prompt field is below the chat');
  }
  await page.screenshot({ path: `${OUT}/5c-chat.png` });
  await page.getByTestId('undo').click();
  await page.keyboard.press('Escape');
  await check(async () => (await prompts.count()) === 0, 'Escape clears the context');
  await page.mouse.dblclick(emptySpot.x, emptySpot.y);
  await check(async () => (await prompts.getByTestId('chat-past').count()) >= 1 && (await prompts.getByTestId('prompt-chat').innerText()).includes('Make gravity 30% weaker.'), 'closing the card keeps the conversation: it opens with it');
  await check(aiRequests.length > 0, '(requests so far)');
  await prompts.getByTestId('prompt-new-chat').click();
  await check(async () => (await prompts.getByTestId('chat-past').count()) === 0, 'New chat starts the conversation again');
  await ask('Make the hearts bigger.');
  await check(async () => (await result.getAttribute('data-status')) === 'applied', 'asking for bigger hearts is applied, as a script on the player');
  await page.keyboard.press('Escape');
  await page.getByTestId('play').click();
  await check(async () => /heart0\|heart1\|heart2/.test((await page.getByTestId('play-canvas').getAttribute('data-drawings')) ?? '') && (await page.getByTestId('hud-health').count()) === 0, "in play, the script draws its own hearts on the screen and the built-in ones are hidden");
  await page.screenshot({ path: `${OUT}/5d-script-hearts.png` });
  await page.keyboard.press('Escape');
  await check(async () => (await page.getByTestId('viewport-canvas').count()) === 1, 'back to editing');
  await page.getByTestId('undo').click();

  step = 'sounds';
  await page.mouse.dblclick(emptySpot.x, emptySpot.y);
  await ask('The player quacks like a duck when the level starts.');
  await check(async () => (await result.getAttribute('data-status')) === 'applied' && (await prompts.getByTestId('play-sound').innerText()).includes('Quack'), 'the AI makes a sound: the card has a ▶ button to hear it');
  await prompts.getByTestId('play-sound').click();
  await page.keyboard.press('Escape');
  await clickWorld(-256, 0);
  await ask('Make the player quack twice at the start.');
  await check(async () => (await result.getAttribute('data-status')) === 'applied' && aiRequests.at(-1).context.targets.some((t) => t.scripts?.object?.some((sc) => sc.name === 'Quack')), 'a small change to a script is made with edit_script (just that part)');
  await page.keyboard.press('Escape');
  await page.getByTestId('dock-sounds').click();
  await check(async () => (await page.getByTestId('sound-list').innerText()).includes('Quack'), 'the Sounds tab (next to Objects) lists the sounds, to play them again');
  await check(async () => {
    const play = await page.getByTestId('sound-play').first().boundingBox();
    const edit = await page.getByTestId('sound-edit').first().boundingBox();
    const trash = await page.getByTestId('sound-list-delete').first().boundingBox();
    const mid = (b) => b.y + b.height / 2;
    return Math.abs(mid(trash) - mid(play)) < 4 && Math.abs(mid(edit) - mid(play)) < 4 && trash.x > edit.x;
  }, 'each sound is one line: ▶ name, what it is, ✎ and a trash can');
  await page.getByTestId('sound-list-delete').first().click();
  await check(async () => (await page.getByTestId('sound-delete-confirm').innerText()).includes('Delete sound?'), 'its trash asks "Delete sound?" in a dialog');
  await page.getByTestId('sound-delete-cancel').click();
  await check(async () => (await page.getByTestId('sound-list').innerText()).includes('Quack'), '(Cancel keeps it)');
  {
    // The AI's sound opens in the sound editor, note by note.
    await page.getByTestId('sound-edit').first().click();
    const editor = page.getByTestId('sound-editor');
    const notesNow = async () => JSON.parse((await page.getByTestId('sound-canvas').getAttribute('data-notes')) ?? '[]');
    await check(async () => (await editor.isVisible()) && JSON.stringify(await notesNow()) === JSON.stringify([[22, 2, 6, 0], [20, 2, 5, 1], [18, 2, 3, 5], [0, 0, 0, 0], [21, 2, 5, 0], [17, 2, 3, 5]]), "✎ opens the AI's sound in the sound editor, its notes as bars");
    await page.screenshot({ path: `${OUT}/5e-sound-editor.png` });
    await page.getByTestId('sound-editor-close').click();
  }
  await page.getByTestId('dock-sounds').click();
  await page.getByTestId('play').click();
  await check(async () => Number((await page.getByTestId('play-canvas').getAttribute('data-sounds')) ?? '0') >= 2, 'in play, the script plays the sound (twice, as edited)');
  await page.keyboard.press('Escape');
  await check(async () => (await page.getByTestId('viewport-canvas').count()) === 1, 'back to editing');
  await page.getByTestId('undo').click();
  await page.getByTestId('undo').click();

  step = 'copy the console';
  {
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.getByTestId('console-toggle').click();
    await page.getByTestId('console-copy').click();
    await check(async () => (await page.getByTestId('console-copy').innerText()).includes('Copied'), 'Console → Copy copies it');
    const text = await page.evaluate(() => navigator.clipboard.readText());
    await check(text.startsWith('PXLBuilder ') && text.split('\n').length > 2, 'as text: the app version, then a line per message');
    await page.getByTestId('tray-close').click();
  }

  step = 'tabs close from the bars';
  for (const [tab, panel] of [
    ['dock-library', 'library-panel'],
    ['dock-sounds', 'sounds-panel'],
  ]) {
    for (const [where, testId] of [
      ['the top bar', 'project-menu'],
      ['the tool bar', 'tool-select'],
      ['the Console button', 'tray-toggle'],
    ]) {
      await page.getByTestId(tab).click();
      await page.getByTestId(testId).click();
      await check(async () => (await page.getByTestId(panel).count()) === 0, `${tab === 'dock-library' ? 'Objects' : 'Sounds'} closes when ${where} is used`);
      await page.keyboard.press('Escape');
      if (await page.getByTestId('tray-close').count()) await page.getByTestId('tray-close').click();
    }
    // And the × at its top right closes it.
    await page.getByTestId(tab).click();
    await page.getByTestId(panel).getByTestId('dock-panel-close').click();
    await check(async () => (await page.getByTestId(panel).count()) === 0, `${tab === 'dock-library' ? 'Objects' : 'Sounds'} has a × at its top right that closes it`);
  }

  step = 'sound editor';
  {
    // (The Sounds tab closes when the top bar is used, e.g. Undo: opened again to read it.)
    const listText = async () => {
      if (!(await page.getByTestId('sounds-panel').count())) await page.getByTestId('dock-sounds').click();
      return page.getByTestId('sound-list').innerText();
    };
    // The note at the top opens the sound editor on a new sound; nothing is added to the game until a note is drawn.
    const soundCount = async () => (await page.getByTestId('dock-sounds').click(), (await page.getByTestId('sound-list').getByTestId('sound-play').count()) + (await page.getByTestId('dock-sounds').click(), 0));
    const before = await soundCount();
    await page.getByTestId('sound-editor-toggle').click();
    const editor = page.getByTestId('sound-editor');
    const cv = page.getByTestId('sound-canvas');
    const notesNow = async () => JSON.parse((await cv.getAttribute('data-notes')) ?? '[]');
    await check(async () => (await editor.isVisible()) && (await page.getByTestId('sound-editor-body').getAttribute('data-off')) === 'true' && (await page.getByTestId('sound-editor-play').isDisabled()) && (await page.getByTestId('sound-delete').isDisabled()) && !(await page.getByTestId('sound-editor-new').isDisabled()), 'the ♪ at the top opens the sound editor; with no sound open everything is greyed out but + New');
    await page.getByTestId('sound-editor-close').click();
    await check(async () => (await soundCount()) === before, 'opening it makes no sound by itself');
    await page.getByTestId('sound-editor-toggle').click();
    await page.getByTestId('sound-editor-new').click();
    await check(async () => (await page.getByTestId('sound-name').inputValue()) === 'Sound 1' && (await notesNow()).length === 0 && (await page.getByTestId('sound-delete').isVisible()), '+ New sound makes a new, silent sound (its trash right next to its name)');
    // Draw: the square wave at volume 5; a sweep over notes 1–4 rising from C4 to C5 (measured once the dialog's opening zoom is over).
    await page.waitForTimeout(300);
    const box = await cv.boundingBox();
    const H = 64 * 4 + 10 + 8 * 7 + 10 + 18;
    const pt = (col, pitch) => ({ x: box.x + ((col + 0.5) / 32) * box.width, y: box.y + ((64 * 4 - (pitch + 0.5) * 4) / H) * box.height });
    await page.getByTestId('sound-wave-3').click();
    const p0 = pt(0, 24);
    await page.mouse.move(p0.x, p0.y);
    await page.mouse.down();
    for (const [c, p] of [[1, 28], [2, 31], [3, 36]]) {
      const q = pt(c, p);
      await page.mouse.move(q.x, q.y);
    }
    await page.mouse.up();
    await check(async () => JSON.stringify(await notesNow()) === JSON.stringify([[24, 3, 5, 0], [28, 3, 5, 0], [31, 3, 5, 0], [36, 3, 5, 0]]), 'dragging over the notes draws them: pitch where the pointer is, with the chosen wave and volume');
    // Volume strip: note 4 down to 2; effect row: fade out on note 4.
    const volY = box.y + ((64 * 4 + 10 + 8 * 7 - 2 * 7) / H) * box.height;
    await page.mouse.click(pt(3, 0).x, volY);
    await page.getByTestId('sound-effect-5').click();
    const fxY = box.y + ((64 * 4 + 10 + 8 * 7 + 10 + 9) / H) * box.height;
    await page.mouse.click(pt(3, 0).x, fxY);
    await check(async () => JSON.stringify((await notesNow())[3]) === JSON.stringify([36, 3, 2, 5]), 'the middle strip sets a note\'s volume and the bottom row its effect');
    // Right-click in the volume strip turns a note off but keeps it; right-click in the note area deletes it outright.
    await page.mouse.click(pt(2, 0).x, volY, { button: 'right' });
    await check(async () => JSON.stringify((await notesNow())[2]) === JSON.stringify([31, 3, 0, 0]), 'right-click in the volume strip turns a note off (it keeps its pitch and wave)');
    await page.mouse.click(pt(2, 0).x, volY);
    await page.mouse.click(pt(1, 28).x, pt(1, 28).y, { button: 'right' });
    await check(async () => JSON.stringify((await notesNow())[1]) === JSON.stringify([24, 0, 0, 0]), 'right-click in the note area deletes a note outright (back to an empty C4 note)');
    await page.getByTestId('sound-slower').click();
    await check(async () => (await page.getByTestId('sound-speed').innerText()) === '13', 'speed can be changed');
    // A wave on every note at once: double-click it. A volume: right-click → All notes. (Silent notes stay silent.)
    await page.getByTestId('sound-wave-0').dblclick();
    await check(async () => (await notesNow()).filter((n) => n[2] > 0).every((n) => n[1] === 0) && (await notesNow())[1][2] === 0, 'double-clicking a wave puts it on every note that sounds');
    await page.getByTestId('sound-volume-7').click({ button: 'right' });
    await page.getByTestId('pen-all').click();
    await check(async () => JSON.stringify((await notesNow()).map((n) => n[2])) === JSON.stringify([7, 0, 7, 7]), 'right-click a volume → All notes sets it on every note that sounds');
    await page.getByTestId('sound-smoother').click();
    await page.getByTestId('sound-smoother').click();
    await check(async () => (await page.getByTestId('sound-smooth').innerText()) === '2', 'Smooth softens the sound (0–7)');
    // Space plays wherever the focus is (here on the Speed + button, which it must not press), and stops again.
    await page.getByTestId('sound-slower').focus();
    await page.keyboard.press(' ');
    await check(async () => (await page.getByTestId('sound-editor-play').innerText()).includes('Stop') && (await page.getByTestId('sound-speed').innerText()) === '13', 'Space plays the sound wherever the focus is (without pressing the focused button)');
    await page.keyboard.press(' ');
    await check(async () => (await page.getByTestId('sound-editor-play').innerText()).includes('Play'), 'and Space again stops it');
    // In the name field a space is just a space.
    await page.getByTestId('sound-name').fill('');
    await page.getByTestId('sound-name').pressSequentially('Big Rise');
    await check(async () => (await page.getByTestId('sound-name').inputValue()) === 'Big Rise' && (await page.getByTestId('sound-editor-play').innerText()).includes('Play'), 'typing a space in the name field types a space (it does not play)');
    await page.getByTestId('sound-name').fill('Rise');
    await page.getByTestId('sound-name').press('Enter');
    await page.getByTestId('sound-editor-play').click();
    await check(async () => (await page.getByTestId('sound-editor-play').innerText()).includes('Stop'), 'Play plays the sound (the button turns into Stop)');
    // The picker switches to another sound (and keeps the chosen pens).
    await check(async () => (await page.getByTestId('sound-pick').locator('option').allInnerTexts()).some((t) => t.includes('Rise')), 'the picker at the top lists the game\'s sounds');
    await page.getByTestId('sound-editor-close').click();
    await page.getByTestId('dock-sounds').click();
    await check(async () => (await listText()).includes('Rise'), 'the edited, renamed sound is in the Sounds tab');
    // Every change is one undo step: rename, smooth ×2, all-notes volume, all-notes wave, speed, delete, volume on, volume off, effect, volume, the first notes, and New sound.
    await page.getByTestId('undo').click();
    await check(async () => (await listText()).includes('Sound 1'), 'Undo takes the editor\'s changes back one by one');
    for (let i = 0; i < 12; i++) await page.getByTestId('undo').click();
    await check(async () => !(await listText()).includes('Sound 1'), '(and the new sound itself)');
    // The trash at the top deletes the sound, after asking.
    await page.getByTestId('redo').click();
    await listText();
    await page.getByTestId('sound-edit').first().click();
    await page.getByTestId('sound-delete').click();
    await check(async () => (await page.getByRole('alertdialog', { name: 'Delete sound?' }).isVisible()) && (await page.getByTestId('sound-delete-confirm').innerText()).includes('Delete sound?'), 'the trash next to the name asks "Delete sound?" first, in a dialog');
    await page.getByTestId('sound-delete-cancel').click();
    await check(async () => (await page.getByTestId('sound-delete-confirm').count()) === 0 && (await page.getByTestId('sound-editor').isVisible()), 'Cancel keeps it');
    await page.getByTestId('sound-delete').click();
    await page.getByTestId('sound-delete-yes').click();
    await check(async () => (await page.getByTestId('sound-editor').isVisible()) && (await page.getByTestId('sound-editor-body').getAttribute('data-off')) === 'true' && !(await listText()).includes('Sound 1'), 'Delete removes the sound; the editor stays open, greyed out until + New');
    await page.getByTestId('sound-editor-close').click();
    await page.getByTestId('undo').click();
    await check(async () => (await listText()).includes('Sound 1'), 'Undo brings a deleted sound back');
    await page.getByTestId('undo').click();
    // + New sound in the Sounds tab makes one and opens it too; the ♪ then opens the sound last edited.
    await listText();
    await page.getByTestId('sound-new').click();
    await check(async () => (await page.getByTestId('sound-name').inputValue()) === 'Sound 1' && (await page.getByTestId('sound-delete').isVisible()), '+ New sound in the Sounds tab makes a new sound and opens it');
    await page.getByTestId('sound-editor-close').click();
    await page.getByTestId('sound-editor-toggle').click();
    await check(async () => (await page.getByTestId('sound-name').inputValue()) === 'Sound 1', 'the ♪ opens the sound last edited');
    // + New next to the name (left of the trash) makes another one.
    await check(async () => {
      const n = await page.getByTestId('sound-editor-new').boundingBox();
      const name = await page.getByTestId('sound-name').boundingBox();
      const trash = await page.getByTestId('sound-delete').boundingBox();
      return n.x > name.x + name.width - 1 && trash.x > n.x + n.width - 1;
    }, '+ New sits right of the name, the trash right of it');
    await page.getByTestId('sound-editor-new').click();
    await check(async () => (await page.getByTestId('sound-name').inputValue()) === 'Sound 2', '+ New in the editor makes another sound and opens it');
    await page.getByTestId('sound-editor-close').click();
    await page.getByTestId('undo').click();
    await page.getByTestId('undo').click();
    if (await page.getByTestId('sounds-panel').count()) await page.getByTestId('dock-sounds').click();
  }

  step = 'golden test 7: create with AI';
  await page.getByTestId('dock-create').click();
  const create = page.getByTestId('create-prompt');
  await check(async () => (await page.evaluate(() => document.activeElement?.tagName)) === 'TEXTAREA', 'Create opens a focused prompt');
  await create.getByTestId('prompt-input').fill('Create a flying robot enemy that shoots lasers.');
  await create.getByTestId('prompt-input').press('Enter');
  await check(async () => (await create.getByTestId('prompt-result').getAttribute('data-status')) === 'applied', 'the new object is created at once');
  await page.screenshot({ path: `${OUT}/6-create-preview.png` });
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
  // Asking the AI on an object to open the sprite editor opens it for that object's sprite.
  await clickWorld(-256, 0);
  await check(async () => (await prompts.count()) === 1, '(the Player is selected)');
  await ask('I want to edit the sprite: open the sprite editor');
  await check(async () => (await page.getByTestId('sprite-editor').isVisible()) && (await page.getByTestId('sprite-editor').locator('.bg-head').innerText()).includes('Edit sprite') && (await page.getByTestId('sprite-editor').locator('.bg-head').innerText()).includes('Player'), 'asking the AI to open the sprite editor opens it on the selected object\'s sprite');
  await check(async () => (await page.getByTestId('se-canvas').getAttribute('data-pixels')).replace(/[./]/g, '').length > 50, "with the Player's drawing in it");
  await page.getByTestId('se-close').click();
  await page.keyboard.press('Escape');
  await page.getByTestId('dock-library').click();
  await page.getByTestId('definition-Enemy').click({ button: 'right' });
  await check(async () => (await page.getByTestId('object-menu').innerText()).replace(/\s+/g, ' ').trim() === 'Details… Edit sprite Code Sprites Reset to default', 'right-clicking a built-in object offers Details…, Edit sprite, Code, Sprites and Reset to default');
  await page.getByTestId('menu-sprites').click();
  const sp = page.getByTestId('sprites-panel');
  await check(async () => (await sp.isVisible()) && (await page.getByTestId('library-panel').count()) === 0, 'Sprites opens a panel for the object');
  await check(async () => (await sp.locator('.sprite-choice.on .sprite-use').count()) === 1, "the object's own drawing is listed (and marked as in use), not only the plain box");
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
  await check(async () => (await sp.getByTestId('sprite-plain-box').innerText()).includes('Plain box'), 'the plain-color choice says what it is: a plain box');
  await sp.getByTestId('sprite-box-color').fill('#3366ff');
  await check(async () => (await sp.getByTestId('sprite-plain-box').locator('.color-chip').evaluate((el) => getComputedStyle(el).backgroundColor)) === 'rgb(51, 102, 255)' && !(await sp.getByTestId('sprite-plain-box').getAttribute('class')).includes(' on'), 'Box color picks the box color without switching away from the image');
  await sp.getByTestId('sprite-plain-box').click();
  await check(async () => (await sp.getByTestId('sprite-plain-box').getAttribute('class')).includes(' on'), 'choosing Plain box draws the object as that box');
  await check(async () => (await sp.getByTestId('sprite-list').innerText()).includes('robots #6'), 'the picture it had stays in the list, to choose again');
  await sp.locator('.sprite-use', { hasText: 'robots #6' }).click();
  await check(async () => !(await sp.getByTestId('sprite-plain-box').getAttribute('class')).includes(' on'), 'and choosing an image switches back');
  // Cells of the sheet as an animation.
  await sp.locator('.sprite-choice', { hasText: 'robots #6' }).locator('.sprite-sheet-link').click();
  await sp.getByTestId('anim-cells').fill('1-4');
  await sp.getByTestId('anim-fps').fill('6');
  await sp.getByTestId('anim-make').click();
  await check(async () => (await sp.locator('.sprite-choice.on').innerText()).includes('▶ robots 1-4'), 'cells 1-4 of the sheet become an animation, used as the look');

  // The sprite editor: draw a new two-frame sprite.
  await sp.getByTestId('draw-sprite').click();
  const se = page.getByTestId('sprite-editor');
  await check(async () => await se.isVisible(), 'Draw new sprite opens the sprite editor');
  const seCanvas = se.getByTestId('se-canvas');
  const px = async () => (await seCanvas.getAttribute('data-pixels')) ?? '';
  const clickPixel = async (x, y, button = 'left') => {
    const b = await seCanvas.boundingBox();
    const [w, h] = [await se.getByTestId('se-width').inputValue(), await se.getByTestId('se-height').inputValue()].map(Number);
    await page.mouse.click(b.x + ((x + 0.5) * b.width) / w, b.y + ((y + 0.5) * b.height) / h, { button });
  };
  await check(async () => !(await px()).replace(/[./]/g, ''), 'a new sprite starts empty, at the object\'s proportions');
  await clickPixel(2, 3);
  await check(async () => (await px()).split('/')[3][2] === 'a', 'clicking draws a pixel in the chosen color');
  await clickPixel(5, 3);
  await page.keyboard.press('Control+z');
  await check(async () => (await px()).split('/')[3][5] === '.' && (await px()).split('/')[3][2] === 'a', "Ctrl+Z in the editor undoes the last stroke (not the game's undo)");
  await se.getByTestId('se-duplicate-frame').click();
  await check(async () => (await se.locator('.se-frame').count()) === 2 && (await se.getByTestId('se-frame-2').getAttribute('class')).includes('on'), 'Duplicate frame adds a copy after it and selects it');
  await clickPixel(2, 3, 'right');
  await clickPixel(3, 3);
  await check(async () => (await px()).split('/')[3].slice(2, 4) === '.a', 'in frame 2 the right button erases and the left draws');
  await se.getByTestId('se-fps').fill('4');
  await check(async () => await se.getByTestId('se-preview').isVisible(), 'with two frames there is a playing preview');
  await page.screenshot({ path: `${OUT}/10b-sprite-editor.png` });
  await se.getByTestId('se-name').fill('Blinky');
  await se.getByTestId('se-save').click();
  await check(async () => (await se.count()) === 0 && (await sp.locator('.sprite-choice.on').innerText()).includes('▶ Blinky'), 'Save and use: the animation is the look now');
  // Edit it again: back to one frame.
  await sp.locator('.sprite-choice.on').getByTestId('sprite-edit').click();
  await check(async () => (await se.locator('.se-frame').count()) === 2, 'editing it opens its two frames');
  await se.getByTestId('se-frame-2').click();
  await se.getByTestId('se-delete-frame').click();
  await se.getByTestId('se-save').click();
  await check(async () => (await sp.locator('.sprite-choice.on').innerText()).includes('Blinky') && !(await sp.locator('.sprite-choice.on').innerText()).includes('▶'), 'saving one frame makes it a still picture again');
  await page.getByTestId('undo').click();
  await check(async () => (await sp.locator('.sprite-choice.on').innerText()).includes('▶ Blinky'), 'Undo brings the animation back');
  // A new sprite from inside the editor: a walk cycle started from the drawing being edited.
  await sp.locator('.sprite-choice.on').getByTestId('sprite-edit').click();
  await se.getByTestId('se-new').click();
  await se.getByTestId('se-new-copy').click();
  await check(
    async () => (await se.getByTestId('se-name').inputValue()) === 'Blinky 2' && (await se.locator('.bg-head').first().innerText()).includes('New sprite') && (await se.locator('.se-frame').count()) === 2 && (await se.getByTestId('se-use').count()) === 1,
    '+ New sprite → Start from this drawing: a new sprite with the same frames, a new name, and where to use it',
  );
  await se.getByTestId('se-name').fill('Blinky-walk');
  await se.getByTestId('se-use').selectOption('run');
  await se.getByTestId('se-save').click();
  await check(
    async () => (await se.count()) === 0 && (await sp.getByTestId('sprite-list').innerText()).includes('Blinky-walk') && (await sp.locator('.sprite-choice.on .sprite-cap').innerText()).trim() === '▶ Blinky',
    'saved as its own sprite, used while running; the original stays the normal look',
  );
  // All of the object's sprites are in the editor: switch between them; changes are kept.
  await sp.locator('.sprite-choice.on').getByTestId('sprite-edit').click();
  const strip = se.getByTestId('se-sprites');
  await check(async () => (await strip.innerText()).includes('Blinky-walk') && (await strip.innerText()).includes('Its look') && (await strip.locator('.se-sprite').count()) >= 3, "the sprite editor lists all the object's sprites (its look, its running look, the others)");
  await strip.locator('.se-sprite', { hasText: 'Blinky-walk' }).click();
  await check(async () => (await se.getByTestId('se-name').inputValue()) === 'Blinky-walk' && (await se.locator('.se-frame').count()) === 2, 'clicking one edits that sprite');
  await clickPixel(1, 1);
  await se.screenshot({ path: `${OUT}/10c-sprite-editor-sprites.png` });
  const walkPixels = await px();
  await strip.locator('.se-sprite', { hasText: 'Its look' }).click();
  await check(async () => (await se.getByTestId('se-name').inputValue()) === 'Blinky', '(back to its look)');
  await strip.locator('.se-sprite', { hasText: 'Blinky-walk' }).click();
  await check(async () => (await px()) === walkPixels, 'what was drawn on a sprite is kept when switching to another (saved)');
  await se.getByTestId('se-close').click();
  await page.getByTestId('undo').click();
  await sp.locator('.sprite-choice.on').getByTestId('sprite-edit').click();
  await clickPixel(0, 0);
  await se.getByTestId('se-new').click();
  await check(async () => (await se.getByTestId('se-new-menu').innerText()).includes('Your changes to Blinky are saved first'), 'with unsaved changes it says they are saved first');
  await se.getByTestId('se-new-blank').click();
  await check(async () => !(await px()).replace(/[./]/g, '') && (await se.locator('.se-frame').count()) === 1, 'Blank starts an empty one-frame sprite');
  await se.getByTestId('se-close').click();
  await page.getByTestId('undo').click();
  await page.getByTestId('undo').click();
  await check(async () => !(await sp.getByTestId('sprite-list').innerText()).includes('Blinky-walk'), '(Undo takes both back)');
  await check(async () => (await sp.locator('.sprite-choice', { hasText: 'Enemy' }).getByTestId('sprite-edit').count()) === 1, "the object's own pixel-art drawing can be edited too");
  // The tool panel, Alt to pick a color, and the selection tool.
  await sp.getByTestId('draw-sprite').click();
  await check(async () => (await se.getByTestId('se-tool-pencil').getAttribute('aria-pressed')) === 'true' && (await se.locator('.se-tool').count()) === 5, 'the tools are icons on a tool panel (pencil, eraser, fill, pick, select), pencil first');
  await clickPixel(1, 1);
  await se.getByTestId('se-color-d').click();
  await clickPixel(4, 1);
  await check(async () => (await px()).split('/')[1].slice(0, 6) === '.a..d.', '(two pixels in two colors)');
  await page.keyboard.down('Alt');
  await check(async () => (await seCanvas.getAttribute('data-tool')) === 'pick' && (await se.getByTestId('se-tool-pick').getAttribute('aria-pressed')) === 'true', 'holding Alt switches to the color picker');
  await clickPixel(1, 1);
  await page.keyboard.up('Alt');
  await check(async () => (await seCanvas.getAttribute('data-tool')) === 'pencil' && (await se.getByTestId('se-color-a').getAttribute('class')).includes('on'), 'Alt-clicking a pixel picks its color, and letting go of Alt brings the pencil back');
  await clickPixel(2, 2);
  await check(async () => (await px()).split('/')[2][2] === 'a', 'the pencil now draws in the picked color');
  {
    // The eraser can clear an area (like a fill), and the fill has a tolerance.
    await se.getByTestId('se-tool-eraser').click();
    await check(async () => (await se.getByTestId('se-erase-pixels').getAttribute('aria-checked')) === 'true' && (await se.getByTestId('se-erase-tolerance').count()) === 0, 'the eraser erases pixels, or an area: chosen under the tools');
    await se.getByTestId('se-erase-area').click();
    await se.getByTestId('se-erase-tolerance').fill('0');
    await se.screenshot({ path: `${OUT}/10e-eraser-area.png` });
    await clickPixel(1, 1);
    await check(async () => (await px()).split('/')[1].slice(0, 6) === '....d.' && (await px()).split('/')[2][2] === 'a', 'Area: a click clears the area of that color it touches (here one pixel; the others stay)');
    await se.getByTestId('se-undo').click();
    await se.getByTestId('se-erase-pixels').click();
    await se.getByTestId('se-tool-fill').click();
    await se.getByTestId('se-fill-tolerance').fill('100');
    await check(async () => (await se.getByTestId('se-fill-tolerance').inputValue()) === '100', 'the fill has a tolerance slider');
    await clickPixel(0, 0);
    await check(async () => !(await px()).includes('.'), 'at 100% it fills everything that touches, whatever its color');
    await se.getByTestId('se-undo').click();
    await se.getByTestId('se-fill-tolerance').fill('0');
    await check(async () => (await px()).split('/')[1].slice(0, 6) === '.a..d.', '(Undo brings the drawing back)');
    await se.getByTestId('se-tool-pencil').click();
  }
  await se.getByTestId('se-opacity').fill('50');
  await check(async () => /^#[0-9a-f]{6}80$/.test(await se.getByTestId('se-color-a').getAttribute('title')), "a color's Opacity makes it see-through (#rrggbb80 at 50%)");
  await se.getByTestId('se-opacity').fill('100');
  await check(async () => /^#[0-9a-f]{6}$/.test(await se.getByTestId('se-color-a').getAttribute('title')), '(and solid again at 100%)');
  {
    // The color picker (PXLBuilder's own: OK and Cancel).
    const before = await se.getByTestId('se-color-a').getAttribute('title');
    await se.getByTestId('se-recolor').click();
    const cp = page.getByTestId('color-picker');
    await cp.getByTestId('cp-hex').fill('#22aa55');
    await check(async () => (await cp.getByTestId('cp-r').inputValue()) === '34' && (await cp.getByTestId('cp-g').inputValue()) === '170' && (await cp.getByTestId('cp-b').inputValue()) === '85', 'the color picker shows the color as hex and as R, G, B');
    await cp.getByTestId('cp-cancel').click();
    await check(async () => (await cp.count()) === 0 && (await se.getByTestId('se-color-a').getAttribute('title')) === before, 'Cancel closes it and keeps the color as it was');
    await se.getByTestId('se-recolor').click();
    await cp.getByTestId('cp-g').fill('200');
    await cp.getByTestId('cp-ok').click();
    await check(async () => (await cp.count()) === 0 && (await se.getByTestId('se-color-a').getAttribute('title')) !== before && /^#[0-9a-f]{2}c8[0-9a-f]{2}$/.test(await se.getByTestId('se-color-a').getAttribute('title')), 'OK changes the color (green 200)');
    await se.getByTestId('se-undo').click();
    const colors = await se.locator('.se-swatch').count();
    await se.getByTestId('se-add-color').click();
    await cp.getByTestId('cp-hex').fill('#ff8800');
    await cp.getByTestId('cp-ok').click();
    await check(async () => (await se.locator('.se-swatch').count()) === colors + 1, '+ adds the color picked (with OK)');
    await se.getByTestId('se-undo').click();
  }
  await se.focus(); // (keys go to the editor, as after a click on it)
  await page.keyboard.press('s');
  const sel = async () => (await seCanvas.getAttribute('data-selection')) ?? '';
  const dragPixels = async (a, b) => {
    const bb = await seCanvas.boundingBox();
    const [w, h] = [await se.getByTestId('se-width').inputValue(), await se.getByTestId('se-height').inputValue()].map(Number);
    const at = (p) => [bb.x + ((p[0] + 0.5) * bb.width) / w, bb.y + ((p[1] + 0.5) * bb.height) / h];
    await page.mouse.move(...at(a));
    await page.mouse.down();
    await page.mouse.move(...at([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]));
    await page.mouse.move(...at(b));
    await page.mouse.up();
  };
  await dragPixels([1, 1], [4, 2]);
  await check(async () => (await sel()) === '1,1,4,2', 'S picks the select tool; dragging selects a rectangle');
  await dragPixels([2, 2], [2, 6]);
  await check(async () => (await px()).split('/')[5].slice(0, 6) === '.a..d.' && (await px()).split('/')[1].slice(0, 6) === '......' && (await sel()) === '1,5,4,2', 'dragging inside the selection moves its pixels (and the selection)');
  await page.keyboard.press('Control+z');
  await check(async () => (await px()).split('/')[1].slice(0, 6) === '.a..d.', 'the move is one undo step');
  await page.keyboard.press('Control+y');
  await page.keyboard.press('ArrowRight');
  await check(async () => (await px()).split('/')[5].slice(0, 6) === '..a..d' && (await sel()) === '2,5,4,2', 'arrow keys nudge the selection a pixel');
  await se.getByTestId('se-flip-x').click();
  await check(async () => (await px()).split('/')[5].slice(0, 6) === '..d..a', 'Flip ↔ mirrors the selected pixels');
  await page.keyboard.press('Control+c');
  await se.getByTestId('se-duplicate-frame').click();
  await se.getByTestId('se-empty-frame').click();
  await page.keyboard.press('Control+v');
  await check(async () => (await px()).split('/')[5].slice(0, 6) === '..d..a' && (await se.locator('.se-frame').count()) === 3, 'copy in one frame, paste into another (an empty one here)');
  await page.keyboard.press('Delete');
  await check(async () => !(await px()).replace(/[./]/g, ''), 'Delete clears the selection');
  await page.keyboard.press('Escape');
  await check(async () => (await sel()) === '' && (await se.isVisible()), 'Esc deselects (and keeps the editor open)');
  await se.getByTestId('se-close').click();
  // Back to cell 6 for the steps after this.
  await sp.locator('.sprite-use', { hasText: 'robots #6' }).click();
  await check(async () => (await sp.locator('.sprite-choice.on').innerText()).includes('robots #6'), '(cell 6 in use again)');
  await page.keyboard.press('Escape');
  await check(async () => (await sp.count()) === 0, 'Esc closes the Sprites panel');

  step = 'sprite and collider size link';
  await clickWorld(-32, 0);
  await openDetails();
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
  {
    const hist = page.getByTestId('history-list');
    const hearts = hist.getByTestId('history-exchange').filter({ hasText: 'Give the player five hearts.' });
    await check(async () => (await hearts.count()) >= 1 && (await hearts.first().innerText()).includes('Player'), 'AI History shows the whole request, and what it was about');
    await check(async () => (await hist.getByTestId('history-exchange').count()) >= 3 && (await hist.innerText()).includes('Applied'), 'every exchange is listed with how it ended, also answers that changed nothing');
    await check(async () => (await hist.getByTestId('history-edit').count()) === 0, 'your own edits are not mixed in…');
    await hearts.first().getByTestId('history-details').click();
    await check(async () => {
      const tr = await hearts.first().getByTestId('history-trace').innerText();
      return tr.includes('Sent') && tr.includes('Raw answer') && tr.includes('"kind":') && tr.includes('Request: Give the player five hearts.');
    }, 'Details shows what happened under the hood: what was sent, and the raw answer');
    const [dl] = await Promise.all([page.waitForEvent('download'), hist.getByTestId('history-download').click()]);
    const dlText = await (await import('node:fs/promises')).readFile(await dl.path(), 'utf8');
    await check(dl.suggestedFilename().startsWith('pxlbuilder-ai-trace-') && JSON.parse(dlText).exchanges.some((e) => e.trace?.some((s) => s.kind === 'reply')), 'Download saves the recent exchanges with their details as a file');
    await hist.getByTestId('history-mine').check();
    await check(async () => (await hist.getByTestId('history-edit').count()) > 0, '…until "My edits too" is ticked');
    await page.getByTestId('tray-size').click();
    await check(async () => ((await page.getByTestId('tray').boundingBox())?.width ?? 0) > 600, 'the panel can be made bigger to read long conversations');
    await page.screenshot({ path: `${OUT}/7-history.png` });
    await page.getByTestId('tray-size').click();
  }

  step = 'background';
  await page.getByTestId('tray').getByRole('button', { name: 'Close' }).click();
  await page.getByTestId('tool-background').click();
  const bgPanel = page.getByTestId('background-panel');
  await check(async () => (await bgPanel.isVisible()) && (await prompts.count()) === 0, 'the background card opens (and is the only card)');
  await check(async () => (await bgPanel.getByRole('radio', { name: 'Dark (default)' }).getAttribute('aria-checked')) === 'true', 'a new project starts with the dark background');
  await bgPanel.getByRole('radio', { name: 'Sunset' }).click();
  await check(async () => (await bgPanel.getByRole('radio', { name: 'Sunset' }).getAttribute('aria-checked')) === 'true', 'choosing a swatch sets the background color');
  {
    const undoTitle = async () => (await page.getByTestId('undo').getAttribute('title')) ?? '';
    const t0 = await undoTitle();
    await bgPanel.getByTestId('bg-color').click();
    const cp = page.getByTestId('color-picker');
    await cp.getByTestId('cp-hex').fill('#335577');
    await page.keyboard.press('Escape');
    await check(async () => (await cp.count()) === 0 && (await bgPanel.getByRole('radio', { name: 'Sunset' }).getAttribute('aria-checked')) === 'true' && (await undoTitle()) === t0, 'the custom color opens a color picker; Esc (or Cancel) changes nothing');
    await bgPanel.getByTestId('bg-color').click();
    await cp.getByTestId('cp-hex').fill('#335577');
    await cp.getByTestId('cp-ok').click();
    await check(async () => (await bgPanel.getByRole('radio', { name: 'Sunset' }).getAttribute('aria-checked')) === 'false' && (await undoTitle()).includes('Set background color'), 'OK sets the background color (one Undo step)');
    await page.getByTestId('undo').click();
  }
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
  {
    const [dl] = await Promise.all([page.waitForEvent('download'), bgPanel.getByTestId('bg-download').click()]);
    const path = await dl.path();
    const head = readFileSync(path).subarray(0, 24);
    // A PNG's size is in its header: width and height, big-endian, at bytes 16 and 20.
    await check(dl.suggestedFilename() === 'mountains.png' && head.readUInt32BE(16) === 64 && head.readUInt32BE(20) === 32, 'Download saves the background picture as a file (mountains.png, 64×32, as the game shows it)');
  }
  await check(async () => (await bgPanel.getByTestId('bg-fit').count()) === 1 && (await bgPanel.getByTestId('bg-movement').count()) === 1, 'fit and movement controls appear for the image');
  await bgPanel.getByTestId('bg-movement').selectOption('level');
  await check(async () => (await bgPanel.getByTestId('bg-parallax').count()) === 0, '"Moves with the level": no slider');
  await bgPanel.getByTestId('bg-movement').selectOption('depth');
  await check(async () => (await bgPanel.getByTestId('bg-parallax').count()) === 1, '"Moves slower": the slider for how much');
  // (Back to moving with the level: the AI is asked for the change below.)
  await bgPanel.getByTestId('bg-movement').selectOption('level');
  await bgPanel.getByTestId('background-prompt').getByTestId('prompt-input').fill('The background should move sideways along with the level.');
  await bgPanel.getByTestId('background-prompt').getByTestId('prompt-input').press('Enter');
  await check(async () => (await bgPanel.getByTestId('bg-parallax').inputValue()) === '50', 'a background prompt changes how it moves (50%)');
  await check(aiRequests.at(-1).context.scope === 'background' && aiRequests.at(-1).context.level.background.image?.name === 'mountains', 'the AI is told it is editing the background, including the image');
  await page.screenshot({ path: `${OUT}/8-background.png` });
  {
    // Generate: the user's own image generator (a stand-in here) makes a big, smooth picture; it comes in at the game's pixels.
    const genBodies = [];
    const bigPng = await page.evaluate(() => {
      const c = document.createElement('canvas');
      c.width = 1024;
      c.height = 1024;
      const g = c.getContext('2d');
      const grad = g.createLinearGradient(0, 0, 1024, 1024);
      grad.addColorStop(0, '#1b2a6b');
      grad.addColorStop(0.5, '#e8826a');
      grad.addColorStop(1, '#2f5d3a');
      g.fillStyle = grad;
      g.fillRect(0, 0, 1024, 1024);
      return c.toDataURL('image/png').split(',')[1];
    });
    await page.route('https://pxl-test-image.example.workers.dev/**', (route) => {
      genBodies.push(route.request().postData());
      return route.fulfill({ status: 200, contentType: 'image/png', headers: { 'Access-Control-Allow-Origin': '*' }, body: Buffer.from(bigPng, 'base64') });
    });
    // (PXLBuilder's own generator is never called from the tests.)
    let realCalls = 0;
    await page.route('https://pxlbuilder-image.gundur.workers.dev/**', (route) => (realCalls++, route.abort()));
    const gen = bgPanel.getByTestId('bg-generate');
    await gen.getByTestId('bg-gen-prompt').fill('x');
    await check(async () => (await gen.getByTestId('bg-gen-url').count()) === 0 && !(await gen.getByTestId('bg-gen-go').isDisabled()), "Generate works out of the box (PXLBuilder's own image generator; no address to set)");
    await gen.getByTestId('bg-gen-settings').click();
    await check(async () => (await gen.getByTestId('bg-gen-url').inputValue()) === 'https://pxlbuilder-image.gundur.workers.dev', '(settings show its address, and another can be set)');
    await gen.getByTestId('bg-gen-url').fill('https://pxl-test-image.example.workers.dev/');
    await gen.getByTestId('bg-gen-url-save').click();
    const targetOf = async () => ((await canvas.getAttribute('data-background-target')) ?? '').split(',').map(Number);
    const levelText = await gen.getByTestId('bg-gen-size').innerText();
    const levelBox = await targetOf();
    await check(levelBox.length === 4 && /^\d+ × \d+ pixels/.test(levelText) && (await gen.getByTestId('bg-gen-size-level').getAttribute('aria-checked')) === 'true', `the picture's size starts as the level (the camera limits box: ${levelText}), and a box in the level shows it`);
    await gen.getByTestId('bg-gen-size-screen').click();
    const frame = ((await canvas.getAttribute('data-camera-frame')) ?? '').split(',').map(Number);
    await check(async () => {
      const t = await targetOf();
      return t.length === 4 && t.every((v, i) => Math.abs(v - frame[i]) <= 1) && t.join() !== levelBox.join();
    }, 'Screen: the box is what the camera shows (its start outline)');
    await gen.getByTestId('bg-gen-size-custom').click();
    await gen.getByTestId('bg-gen-w').fill('320');
    await gen.getByTestId('bg-gen-h').fill('180');
    await check(async () => {
      const t = await targetOf();
      return t[2] - t[0] === 320 && t[3] - t[1] === 180;
    }, 'User defined: the box takes the size typed (320 × 180 game pixels)');
    await gen.getByTestId('bg-gen-prompt').fill('a starry night over mountains');
    await gen.getByTestId('bg-gen-go').click();
    await check(async () => (await bgPanel.innerText()).includes('320×180') && (await gen.getByTestId('bg-gen-status').innerText()).startsWith('Done'), 'the picture is made at the size asked for (320×180 game pixels) and becomes the background');
    const boxOf = async () => ((await canvas.getAttribute('data-background-box')) ?? '').split(',').map(Number);
    const b0 = await boxOf();
    await check(b0.length === 4 && b0[2] - b0[0] === 320 && b0[3] - b0[1] === 180 && (await bgPanel.getByTestId('bg-movement').inputValue()) === 'level', 'placed in the level in a box (each picture pixel one game pixel), moving with the level');
    {
      // Dragged inside the box: it moves; dragged by its corner: it gets bigger, redrawn at the new size.
      const [cx, cy, zoom] = ((await canvas.getAttribute('data-camera')) ?? '0,0,1').split(',').map(Number);
      const cbox = await canvas.boundingBox();
      const toScreen = (wx, wy) => ({ x: cbox.x + cbox.width / 2 + (wx - cx) * zoom, y: cbox.y + cbox.height / 2 + (wy - cy) * zoom });
      // A spot inside the box with no object on it (there the pointer shows it can be moved).
      let inside = null;
      for (let fy = 0.15; fy < 0.9 && !inside; fy += 0.1)
        for (let fx = 0.1; fx < 0.9 && !inside; fx += 0.1) {
          const pt = toScreen(b0[0] + (b0[2] - b0[0]) * fx, b0[1] + (b0[3] - b0[1]) * fy);
          if (pt.x < cbox.x + 80 || pt.y < cbox.y + 20 || pt.x > cbox.x + cbox.width - 20 || pt.y > cbox.y + cbox.height - 90) continue;
          await page.mouse.move(pt.x, pt.y);
          if ((await canvas.evaluate((el) => el.style.cursor)) === 'move') inside = pt;
        }
      await check(!!inside, '(over the box where no object is, the pointer shows it can be moved)');
      await page.mouse.down();
      await page.mouse.move(inside.x + 40, inside.y + 20, { steps: 4 });
      await page.mouse.up();
      const b1 = await boxOf();
      await check(Math.round((b1[0] - b0[0]) * zoom) === 40 && Math.round((b1[1] - b0[1]) * zoom) === 20 && b1[2] - b1[0] === 320, 'dragging inside the box moves the picture');
      const corner = toScreen(b1[2], b1[3]);
      await page.mouse.move(corner.x, corner.y);
      await page.mouse.down();
      await page.mouse.move(corner.x + 80, corner.y + 10, { steps: 4 });
      await page.mouse.up();
      await check(async () => {
        const b2 = await boxOf();
        const w = b2[2] - b2[0];
        const h = b2[3] - b2[1];
        return w > 320 && Math.abs(w / h - 320 / 180) < 0.02 && (await bgPanel.innerText()).includes(`${w}×${h}`);
      }, 'dragging a corner resizes it keeping its shape (16:9), drawn again at the new size (each pixel still one game pixel)');
      await page.getByTestId('undo').click();
      await check(async () => (await boxOf()).join() === b1.join(), '(a resize is one Undo step)');
      await page.mouse.move(corner.x, corner.y);
      await page.keyboard.down('Shift');
      await page.mouse.down();
      await page.mouse.move(corner.x + 80, corner.y + 40, { steps: 4 });
      await page.mouse.up();
      await page.keyboard.up('Shift');
      await check(async () => {
        const b2 = await boxOf();
        return b2[2] - b2[0] === Math.round(320 + 80 / zoom) && b2[3] - b2[1] === Math.round(180 + 40 / zoom) && (await bgPanel.innerText()).includes(`${Math.round(320 + 80 / zoom)}×${Math.round(180 + 40 / zoom)}`);
      }, 'with Shift, a corner resizes it to any shape');
      await page.getByTestId('undo').click();
      await check(async () => (await boxOf()).join() === b1.join(), '(also one Undo step)');
    }
    await check(genBodies.length === 1 && JSON.parse(genBodies[0]).prompt.startsWith('a starry night over mountains'), '(the description went to the generator)');
    await check(!/pixel art/i.test(JSON.parse(genBodies[0]).prompt) && /detail/i.test(JSON.parse(genBodies[0]).prompt), "(asking for a finely detailed picture, not \"pixel art\": generators draw that as big fake pixels; the app makes the pixels itself)");
    const colors = await bgPanel.locator('.bg-image img').evaluate(async (img) => {
      await img.decode();
      const c = document.createElement('canvas');
      c.width = img.naturalWidth;
      c.height = img.naturalHeight;
      const g = c.getContext('2d');
      g.drawImage(img, 0, 0);
      const d = g.getImageData(0, 0, c.width, c.height).data;
      const set = new Set();
      for (let i = 0; i < d.length; i += 4) set.add((d[i] << 16) | (d[i + 1] << 8) | d[i + 2]);
      return set.size;
    });
    await check(colors <= 32, `(in a small palette, like pixel art: ${colors} colors)`);
    await page.getByTestId('undo').click();
    await page.getByTestId('undo').click();
    await check(async () => (await bgPanel.innerText()).includes('64×32'), 'Undo takes it back');
    await gen.getByTestId('bg-gen-settings').click();
    await gen.getByTestId('bg-gen-url-default').click();
    await gen.getByTestId('bg-gen-settings').click();
    await check(async () => (await gen.getByTestId('bg-gen-url').inputValue()) === 'https://pxlbuilder-image.gundur.workers.dev' && realCalls === 0, 'Default goes back to PXLBuilder\'s own generator');
    await gen.getByTestId('bg-gen-settings').click();
  }
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
  await openDetails();
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
  {
    // A game controller (simulated: the browser's Gamepad API answering with one standard pad).
    const padState = (buttons = [], x = 0) =>
      page.evaluate(
        ([down, ax]) => {
          const pad = { connected: true, mapping: 'standard', axes: [ax, 0, 0, 0], buttons: Array.from({ length: 17 }, (_, i) => ({ pressed: down.includes(i), value: down.includes(i) ? 1 : 0 })) };
          navigator.getGamepads = () => [pad, null, null, null];
        },
        [buttons, x],
      );
    await padState();
    await check(async () => (await play.getAttribute('data-pads')) === '1', 'a game controller is picked up while playing');
    await page.waitForTimeout(300);
    const [padX] = await ps();
    await padState([], 1);
    await page.waitForTimeout(500);
    await padState();
    await check(async () => (await ps())[0] > padX + 40, "the controller's left stick runs right");
    await page.waitForTimeout(400);
    await padState([0]);
    let padJumped = false;
    for (let i = 0; i < 30 && !padJumped; i++) {
      await page.waitForTimeout(20);
      padJumped = (await ps())[1] < 16 - 32;
    }
    await padState();
    await check(padJumped, 'and its A (bottom) button jumps');
    await check(async () => (await ps())[2] === 1, '(lands again)');
    await page.evaluate(() => {
      navigator.getGamepads = () => [null, null, null, null];
    });
  }
  // Low-resolution play never draws the pictures with fewer pixels than they have (32×32 pictures at zoom 1: full size).
  const pixels = async () => {
    const [w, h] = ((await play.getAttribute('data-pixels')) ?? '0x0').split('x').map(Number);
    const full = await play.evaluate((c) => [Math.round(c.getBoundingClientRect().width * devicePixelRatio), Math.round(c.getBoundingClientRect().height * devicePixelRatio)]);
    return { w, h, full };
  };
  await check(async () => {
    const { w, h, full } = await pixels();
    return h === full[1] && w === full[0];
  }, 'Play never draws 32×32 pictures with fewer pixels than they have (at zoom 1: one canvas pixel per picture pixel, even with low-resolution play on)');
  await page.keyboard.press('Escape');
  await page.getByTestId('main-menu').click();
  await page.getByTestId('menu-low-res').click();
  await page.getByTestId('play').click();
  await check(async () => {
    const { w, h, full } = await pixels();
    return w === full[0] && h === full[1];
  }, 'with low-resolution play turned off (⋯ menu), Play draws at full sharpness');
  await page.keyboard.press('Escape');
  await page.getByTestId('main-menu').click();
  await page.getByTestId('menu-low-res').click();
  await page.getByTestId('play').click();
  await check(async () => (await pixels()).h === (await pixels()).full[1], 'and turned back on, the pictures still keep all their pixels');
  await check(async () => (await ps())[2] === 1, 'the game runs');
  await page.keyboard.press('Escape');
  await check(async () => (await page.getByTestId('viewport-canvas').isVisible()) && (await play.count()) === 0, 'Esc stops the game and returns to the editor');
  await clickWorld(-256, 0);
  await check(async () => (await prompts.count()) === 1, 'clicking an object right after stopping selects it (the view is measured at once)');
  await check(async () => (await page.getByTestId('undo').getAttribute('title')) === undoTitle, 'playing made no edits (undo history unchanged)');
  await openDetails();
  await check(async () => [await page.getByTestId('transform-position.x').inputValue(), await page.getByTestId('transform-position.y').inputValue()].join() === posBefore.join(), 'the player is back at its editor position (runtime state was thrown away)');
  await page.getByTestId('close-details').click();
  await page.keyboard.press('Control+Enter');
  await check(async () => await play.isVisible(), 'Ctrl+Enter starts playing too');
  await page.getByTestId('play').click();
  await check(async () => await page.getByTestId('viewport-canvas').isVisible(), 'the Stop button stops');
  await page.keyboard.press('Escape');

  step = 'top-down';
  await page.mouse.dblclick(emptySpot.x, emptySpot.y);
  await check(async () => (await canvas.getAttribute('data-context')) === 'level', 'the level is the context');
  await ask('Make it a top-down game, like Zelda.');
  await check(async () => (await result.getAttribute('data-status')) === 'applied', 'making the game top-down is applied');
  await check(aiRequests.at(-1).context.level.view === 'side' && aiRequests.at(-1).context.level.playerReach !== null, 'the AI was told the level was seen from the side (with the jump limits)');
  await check(!!aiRequests.at(-1).context.level.design?.layout?.how && Array.isArray(aiRequests.at(-1).context.level.design.otherLevels), 'a level request comes with a randomly chosen layout to build (for variety)');
  await page.keyboard.press('Escape');
  await page.getByTestId('play').click();
  await check(async () => (await play.isVisible()) && !(await page.getByTestId('play-canvas').locator('..').getByText('Space jumps').count()), 'Play starts, and the key hint no longer says Space jumps');
  {
    const [, y0] = await ps();
    await page.waitForTimeout(400);
    await check(async () => Math.abs((await ps())[1] - y0) < 0.5, 'standing still, the player does not fall (no gravity)');
    await page.keyboard.down('ArrowUp');
    await page.waitForTimeout(400);
    await page.keyboard.up('ArrowUp');
    const [, yUp] = await ps();
    await check(yUp < y0 - 40, 'holding ↑ walks up the screen');
    // It slows to a stop (by its acceleration), then stays: nothing pulls it back down.
    await page.waitForTimeout(300);
    const [, yStop] = await ps();
    await check(yStop < y0 - 40, '(still up there once stopped)');
    await page.waitForTimeout(400);
    await check(async () => Math.abs((await ps())[1] - yStop) < 0.5, 'and it stays there when the key is let go');
    const [x1] = await ps();
    await page.keyboard.down('ArrowRight');
    await page.keyboard.down('ArrowDown');
    await page.waitForTimeout(150);
    await page.keyboard.up('ArrowRight');
    await page.keyboard.up('ArrowDown');
    const [x2, y2] = await ps();
    await check(x2 > x1 + 5 && y2 > yStop + 5, '→ and ↓ together walk diagonally');
  }
  await page.screenshot({ path: `${OUT}/12b-top-down.png` });
  await page.keyboard.press('Escape');
  await page.getByTestId('undo').click();
  await page.getByTestId('play').click();
  {
    await check(async () => (await ps())[2] === 1, 'after Undo, the player stands on the platform again (gravity is back)');
    const [, y0] = await ps();
    await page.keyboard.down('ArrowUp');
    await page.waitForTimeout(300);
    await page.keyboard.up('ArrowUp');
    await check(async () => Math.abs((await ps())[1] - y0) < 0.5, 'and ↑ no longer walks up (a platformer again)');
  }
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

  step = 'touch screen';
  {
    // Fingers, as a touch screen sends them (pointer events of type "touch").
    const touch = (type, id, p) =>
      page.evaluate(([type, id, x, y]) => {
        const c = document.querySelector('[data-testid="viewport-canvas"]');
        c.dispatchEvent(new PointerEvent(type, { pointerId: id, pointerType: 'touch', isPrimary: id === 1, clientX: x, clientY: y, bubbles: true, cancelable: true, button: type === 'pointermove' ? -1 : 0, buttons: type === 'pointerup' ? 0 : 1 }));
      }, [type, id, p.x, p.y]);
    const both = async (a, b, steps, from = [{ x: 0, y: 0 }, { x: 0, y: 0 }]) => {
      for (let i = 1; i <= steps; i++) {
        await touch('pointermove', 1, { x: a.x + (from[0].x * i) / steps, y: a.y + (from[0].y * i) / steps });
        await touch('pointermove', 2, { x: b.x + (from[1].x * i) / steps, y: b.y + (from[1].y * i) / steps });
      }
    };
    const entities = async () => Number(await canvas.getAttribute('data-entities'));
    await page.getByTestId('dock-library').click();
    await page.getByTestId('definition-Platform').click();
    await page.keyboard.press('Escape');
    const n0 = await entities();
    const [, , z0] = await cam();
    const A = { x: mid.x - 40, y: mid.y };
    const B = { x: mid.x + 40, y: mid.y };
    // Pinch out (86 → 200 px apart) with the Platform brush chosen: the first finger touches down and moves a little before the second.
    await touch('pointerdown', 1, A);
    await touch('pointermove', 1, { x: A.x - 6, y: A.y });
    await touch('pointerdown', 2, B);
    await both({ x: A.x - 6, y: A.y }, B, 6, [{ x: -54, y: 0 }, { x: 60, y: 0 }]);
    await touch('pointerup', 1, { x: A.x - 60, y: A.y });
    await touch('pointerup', 2, { x: B.x + 60, y: B.y });
    await check(async () => (await entities()) === n0 && Math.abs((await cam())[2] / z0 - 200 / 86) < 0.01, 'pinching out with two fingers zooms in, and with a brush chosen it draws nothing between the fingers');
    // Two fingers moving together pan the view.
    const [x1, y1, z1] = await cam();
    await touch('pointerdown', 1, A);
    await touch('pointerdown', 2, B);
    await both(A, B, 5, [{ x: 100, y: 50 }, { x: 100, y: 50 }]);
    await touch('pointerup', 1, { x: A.x + 100, y: A.y + 50 });
    await touch('pointerup', 2, { x: B.x + 100, y: B.y + 50 });
    await check(async () => {
      const [x, y, z] = await cam();
      return z === z1 && Math.abs(x - (x1 - 100 / z1)) < 0.5 && Math.abs(y - (y1 - 50 / z1)) < 0.5 && (await entities()) === n0;
    }, 'two fingers moving together pan the view (nothing drawn)');
    // Back as it was: the same pan and pinch the other way.
    await touch('pointerdown', 1, { x: A.x + 100, y: A.y + 50 });
    await touch('pointerdown', 2, { x: B.x + 100, y: B.y + 50 });
    await both({ x: A.x + 100, y: A.y + 50 }, { x: B.x + 100, y: B.y + 50 }, 5, [{ x: -100, y: -50 }, { x: -100, y: -50 }]);
    await touch('pointerup', 1, A);
    await touch('pointerup', 2, B);
    await touch('pointerdown', 1, { x: A.x - 60, y: A.y });
    await touch('pointerdown', 2, { x: B.x + 60, y: B.y });
    // (The pinch began with the fingers 86 px apart, when the second one touched down.)
    await both({ x: A.x - 60, y: A.y }, { x: B.x + 60, y: B.y }, 6, [{ x: 54, y: 0 }, { x: -60, y: 0 }]);
    await touch('pointerup', 1, { x: A.x - 6, y: A.y });
    await touch('pointerup', 2, B);
    await check(async () => Math.abs((await cam())[2] - z0) < 0.001, '(pinched back to the zoom it had)');
    // With the brush still chosen, tapping a placed object selects it.
    const [cx, cy, cz] = await cam();
    const playerAt = { x: box.x + center.x + (-256 - cx) * cz, y: box.y + center.y + (0 - cy) * cz };
    await touch('pointerdown', 1, playerAt);
    await touch('pointerup', 1, playerAt);
    await check(async () => (await canvas.getAttribute('data-context')) === 'entity' && (await prompts.count()) === 0 && (await entities()) === n0, 'with a brush chosen, tapping a placed object selects it (instead of drawing; no card: a double tap opens it)');
    // A double tap on empty space opens the level's prompt.
    await page.keyboard.press('Escape');
    await touch('pointerdown', 1, emptySpot);
    await touch('pointerup', 1, emptySpot);
    await touch('pointerdown', 1, emptySpot);
    await touch('pointerup', 1, emptySpot);
    await check(async () => (await canvas.getAttribute('data-context')) === 'level' && (await prompts.isVisible()), 'a double tap on empty space opens the level prompt');
    await page.keyboard.press('Escape');
    // A long press (half a second, finger still) opens the menu, as the right button does.
    await touch('pointerdown', 1, playerAt);
    await page.waitForTimeout(700);
    await check(async () => (await page.getByTestId('object-menu').isVisible()) && (await page.getByTestId('object-menu').innerText()).includes('Ask AI…') && (await canvas.getAttribute('data-context')) === 'entity', 'a long press on an object opens its menu (Ask AI…, Details…) and selects it');
    await touch('pointerup', 1, playerAt);
    await page.getByTestId('ctx-ask-ai').click();
    await check(async () => await prompts.isVisible(), '…and Ask AI… there opens its prompt card');
    await page.keyboard.press('Escape');
  }

  step = 'trash can';
  {
    const trash = page.getByTestId('trash');
    const entities = async () => Number(await canvas.getAttribute('data-entities'));
    const n0 = await entities();
    await check(async () => (await trash.getAttribute('aria-disabled')) === 'true', 'the trash can in the bottom bar is faint while nothing is selected');
    await clickWorld(-256, 0);
    await check(async () => (await trash.getAttribute('aria-disabled')) === 'false' && (await trash.getAttribute('aria-label')).includes('the selected object'), 'with an object selected it can delete it');
    await trash.click();
    await check(async () => (await entities()) === n0 - 1 && (await prompts.count()) === 0, 'tapping the trash can deletes the selected object');
    await page.getByTestId('undo').click();
    await check(async () => (await entities()) === n0, 'Undo brings it back');
    // Dragging an object onto the trash can (with the mouse, then with a finger).
    const [cx, cy, cz] = await cam();
    const playerAt = { x: box.x + center.x + (-256 - cx) * cz, y: box.y + center.y + (0 - cy) * cz };
    const t = await trash.boundingBox();
    const trashAt = { x: t.x + t.width / 2, y: t.y + t.height / 2 };
    // (Its prompt card open first: a double-click.)
    await page.mouse.dblclick(playerAt.x, playerAt.y);
    await prompts.waitFor();
    await page.mouse.move(playerAt.x, playerAt.y);
    await page.mouse.down();
    await page.mouse.move(trashAt.x, trashAt.y, { steps: 8 });
    await check(async () => (await trash.getAttribute('class')).includes('hot'), 'dragging an object over the trash can lights it up');
    await check(async () => (await prompts.count()) === 1 && !(await prompts.isVisible()), "while an object is being moved, its prompt card is out of the way");
    await page.screenshot({ path: `${OUT}/12c-trash-drag.png` });
    await page.mouse.up();
    await check(async () => (await entities()) === n0 - 1 && !(await trash.getAttribute('class')).includes('hot'), 'dropping it on the trash can deletes it');
    await page.getByTestId('undo').click();
    await check(async () => (await entities()) === n0, '(Undo brings it back)');
    const touch = (type, p) =>
      page.evaluate(([type, x, y]) => {
        const c = document.querySelector('[data-testid="viewport-canvas"]');
        c.dispatchEvent(new PointerEvent(type, { pointerId: 7, pointerType: 'touch', isPrimary: true, clientX: x, clientY: y, bubbles: true, cancelable: true, button: type === 'pointermove' ? -1 : 0, buttons: type === 'pointerup' ? 0 : 1 }));
      }, [type, p.x, p.y]);
    const camBefore = await canvas.getAttribute('data-camera');
    const frameBefore = await canvas.getAttribute('data-camera-frame');
    await touch('pointerdown', playerAt);
    for (let i = 1; i <= 8; i++) await touch('pointermove', { x: playerAt.x + ((trashAt.x - playerAt.x) * i) / 8, y: playerAt.y + ((trashAt.y - playerAt.y) * i) / 8 });
    await page.waitForTimeout(100);
    await check(
      async () => (await canvas.getAttribute('data-camera')) === camBefore && (await canvas.getAttribute('data-camera-frame')) === frameBefore,
      'while the player is held, neither the view nor the camera outline moves with it',
    );
    await touch('pointerup', trashAt);
    await check(async () => (await entities()) === n0 - 1, 'with a finger too: dragging an object onto the trash can deletes it');
    await page.getByTestId('undo').click();
    await check(async () => (await entities()) === n0, '(and Undo brings it back)');
    // If the browser takes the touch over at the end (pointercancel), the drop on the trash still counts.
    await touch('pointerdown', playerAt);
    for (let i = 1; i <= 8; i++) await touch('pointermove', { x: playerAt.x + ((trashAt.x - playerAt.x) * i) / 8, y: playerAt.y + ((trashAt.y - playerAt.y) * i) / 8 });
    await touch('pointercancel', { x: 0, y: 0 });
    await check(async () => (await entities()) === n0 - 1, 'a touch the browser cancels over the trash can still deletes the object');
    await page.getByTestId('undo').click();
    await check(async () => (await entities()) === n0, '(Undo again)');
    await page.keyboard.press('Escape');
  }

  step = 'selection box handles';
  {
    const entities = async () => Number(await canvas.getAttribute('data-entities'));
    const n0 = await entities();
    // data-handles: "s1,0@x,y" a side point, "c1,1@x,y" a corner, in level coordinates.
    const handles = async () =>
      Object.fromEntries(
        ((await canvas.getAttribute('data-handles')) ?? '').split(' ').filter(Boolean).map((h) => {
          const [k, at] = h.split('@');
          return [k, at.split(',').map(Number)];
        }),
      );
    const w2s = async (wx, wy) => {
      const [cx, cy, z] = (await canvas.getAttribute('data-camera')).split(',').map(Number);
      const b = await canvas.boundingBox();
      return { x: b.x + b.width / 2 + (wx - cx) * z, y: b.y + b.height / 2 + (wy - cy) * z };
    };
    const dragWorld = async (from, to) => {
      const a = await w2s(...from);
      const b = await w2s(...to);
      await page.mouse.move(a.x, a.y);
      await page.mouse.down();
      await page.mouse.move((a.x + b.x) / 2, (a.y + b.y) / 2, { steps: 4 });
      await page.mouse.move(b.x, b.y, { steps: 4 });
      await page.mouse.up();
    };
    // A 32×32 platform tile placed by hand.
    await page.getByTestId('dock-library').click();
    await page.dragAndDrop('[data-testid="definition-Platform"]', '[data-testid="viewport-canvas"]', { targetPosition: { x: (await canvas.boundingBox()).width / 2 + 200, y: 140 } });
    await check(async () => (await entities()) === n0 + 1 && (await canvas.getAttribute('data-handles'))?.includes('c1,1'), '(a platform tile placed and selected)');
    const h = await handles();
    const [left, right, top, bottom] = [h['s-1,0'][0], h['s1,0'][0], h['s0,-1'][1], h['s0,1'][1]];
    await check(right - left === 32 && bottom - top === 32 && h['c1,1'][0] === right && h['c1,1'][1] === bottom && h['s1,0'][1] === (top + bottom) / 2, 'the selection box fits a 32×32 tile exactly: 32×32, corner points at its corners, side points in the middle of its sides');
    // Drag the right side point three tiles out: three copies in a line, all selected.
    await dragWorld([right, (top + bottom) / 2], [right + 3 * 32 + 6, (top + bottom) / 2]);
    await check(async () => (await entities()) === n0 + 4 && (await canvas.getAttribute('data-context')) === 'group', "dragging the box's right side point out 3 tiles makes 3 copies in a line (all selected)");
    const h2 = await handles();
    await page.screenshot({ path: `${OUT}/12d-selection-handles.png`, clip: await (async () => { const a = await w2s(h2['s-1,0'][0] - 60, h2['s0,-1'][1] - 60); return { x: a.x, y: a.y, width: 300, height: 160 }; })() });
    await check(h2['s1,0'][0] - h2['s-1,0'][0] === 128 && h2['s0,1'][1] - h2['s0,-1'][1] === 32, 'the line is 4 tiles long with no gaps (the box around it is 128×32)');
    // And down from the line: a block.
    await dragWorld([(h2['s-1,0'][0] + h2['s1,0'][0]) / 2, h2['s0,1'][1]], [(h2['s-1,0'][0] + h2['s1,0'][0]) / 2, h2['s0,1'][1] + 2 * 32 + 4]);
    await check(async () => (await entities()) === n0 + 12, 'dragging the bottom point of the line down 2 rows makes a 4×3 block');
    // With several selected, a side still adds one object's worth at a time: the top up one row adds one row.
    const h4 = await handles();
    await dragWorld([h4['s0,-1'][0], h4['s0,-1'][1]], [h4['s0,-1'][0], h4['s0,-1'][1] - 32 - 6]);
    await check(async () => (await entities()) === n0 + 16, 'pulling the top point of the 4×3 block up one row adds one row of 4 (not a copy of the whole block)');
    const h5 = await handles();
    await dragWorld([h5['s1,0'][0], h5['s1,0'][1]], [h5['s1,0'][0] + 32 + 6, h5['s1,0'][1]]);
    await check(async () => (await entities()) === n0 + 20, 'pulling its right point out one tile adds one column of 4');
    // Pushing the top point down one row takes the top row away (5 tiles); the prompt card is out of the way meanwhile.
    // Selected (by the drags), the card closed: the ✦ above the selection opens it.
    if ((await prompts.count()) === 0) {
      await check(async () => await page.getByTestId('ai-star').isVisible(), 'with objects selected and no card open, an AI ✦ shows above the selection');
      await page.getByTestId('ai-star').click();
      await check(async () => (await prompts.isVisible()) && (await page.getByTestId('ai-star').count()) === 0, 'clicking the ✦ opens the AI prompt card for the selection');
    }
    const h6 = await handles();
    {
      const a = await w2s(h6['s0,-1'][0], h6['s0,-1'][1]);
      const b = await w2s(h6['s0,-1'][0], h6['s0,-1'][1] + 32 + 6);
      await page.mouse.move(a.x, a.y);
      await page.mouse.down();
      await page.mouse.move(a.x, (a.y + b.y) / 2, { steps: 3 });
      await page.mouse.move(b.x, b.y, { steps: 3 });
      await check(async () => !(await prompts.isVisible()), 'while a point of the box is dragged, the prompt card is out of the way');
      await page.mouse.up();
    }
    await check(async () => (await entities()) === n0 + 15 && (await prompts.isVisible()), 'pushing the top point down one row removes the top row (and the card is back after letting go)');
    const h7 = await handles();
    await check(h7['s0,1'][1] - h7['s0,-1'][1] === 96, '(the block is 3 rows tall now)');
    await page.getByTestId('undo').click();
    await check(async () => (await entities()) === n0 + 20, '(Undo brings the row back)');
    await page.getByTestId('undo').click();
    await page.getByTestId('undo').click();
    await page.getByTestId('undo').click();
    await page.getByTestId('undo').click();
    await check(async () => (await entities()) === n0 + 1, 'each drag is one Undo');
    // The eyedropper: a click on the tile picks up its kind; the next click places one, then back to selecting.
    {
      const pressed = async (id) => (await page.getByTestId(id).getAttribute('aria-pressed')) === 'true';
      const cy = (top + bottom) / 2;
      await page.getByTestId('tool-eyedropper').click();
      await check(async () => await pressed('tool-eyedropper'), 'the tool bar has an eyedropper');
      await clickWorld((left + right) / 2, cy);
      await check(async () => (await pressed('tool-pen')) && (await page.getByTestId('tool-brush-pick').count()) === 1 && (await entities()) === n0 + 1, 'clicking the platform with it picks up Platform to draw with (nothing placed yet)');
      await clickWorld(right + 96 + 16, cy);
      await check(async () => (await entities()) === n0 + 2 && (await pressed('tool-select')), 'the next click places a platform there, and the editor is back to selecting (as when picked in the Objects panel)');
      await page.getByTestId('undo').click();
      // Holding Alt: the eyedropper, whatever the tool.
      await page.keyboard.down('Alt');
      await check(async () => await pressed('tool-eyedropper'), 'holding Alt switches to the eyedropper');
      await page.mouse.click(...Object.values(await w2s((left + right) / 2, cy)));
      await page.keyboard.up('Alt');
      await check(async () => (await pressed('tool-pen')) && !(await pressed('tool-eyedropper')), 'Alt+click picks up the platform; letting go of Alt, it is ready to draw');
      await dragWorld([right + 96 + 16, cy], [right + 96 + 16 + 64, cy]);
      await check(async () => (await entities()) === n0 + 4 && (await pressed('tool-select')), 'and a drag draws a line of 3 with it');
      await page.getByTestId('undo').click();
      await check(async () => (await entities()) === n0 + 1, '(Undo)');
    }
    // The marquee tool: a box from on top of an object selects (it doesn't move anything).
    {
      await clickWorld((left + right) / 2, (top + bottom) / 2);
      await dragWorld([right, (top + bottom) / 2], [right + 2 * 32 + 6, (top + bottom) / 2]);
      await check(async () => (await entities()) === n0 + 3, '(a row of 3 platforms)');
      await page.keyboard.press('Escape');
      await page.getByTestId('tool-marquee').click();
      await dragWorld([(left + right) / 2, (top + bottom) / 2], [right + 32 + 16, bottom - 4]);
      const hm = await handles();
      await check(hm['s-1,0']?.[0] === left && hm['s1,0']?.[0] === right + 64 && (await entities()) === n0 + 3 && (await canvas.getAttribute('data-context')) === 'group', 'the marquee tool: a box dragged from on top of a platform selects all 3 (nothing moves)');
      await page.keyboard.press('Escape');
      await page.getByTestId('tool-select').click();
      await dragWorld([left - 20, top - 20], [right + 32 + 16, bottom - 4]);
      const hs = await handles();
      await check(hs['s-1,0']?.[0] === left && hs['s1,0']?.[0] === right + 64 && (await canvas.getAttribute('data-context')) === 'group', 'the arrow still box-selects when the drag starts on empty space');
      await page.keyboard.press('Escape');
      await page.getByTestId('undo').click();
      await check(async () => (await entities()) === n0 + 1, '(Undo)');
    }
    // Placing over objects already there replaces them; with "Add on top" checked, both stay. A ladder above a column
    // of platforms, stretched down over 3 of them.
    {
      const cx = (left + right) / 2;
      const undoTitle = async () => (await page.getByTestId('undo').getAttribute('title')) ?? '';
      const addOnTop = page.getByTestId('tool-add-on-top');
      await check(async () => (await addOnTop.getAttribute('aria-checked')) === 'false', 'the tool bar has an "Add on top" box, off by default');
      await clickWorld(cx, (top + bottom) / 2);
      await dragWorld([cx, bottom], [cx, bottom + 3 * 32 + 6]);
      await check(async () => (await entities()) === n0 + 4, '(a column of 4 platforms)');
      await page.keyboard.press('Escape');
      await page.getByTestId('dock-library').click();
      const cb = await canvas.boundingBox();
      const above = await w2s(cx, top - 16);
      await page.dragAndDrop('[data-testid="definition-Ladder"]', '[data-testid="viewport-canvas"]', { targetPosition: { x: above.x - cb.x, y: above.y - cb.y } });
      await check(async () => (await entities()) === n0 + 5 && !(await undoTitle()).includes('replacing'), '(a ladder on the empty square above it)');
      const hl = await handles();
      const stretchLadder = () => dragWorld([hl['s0,1'][0], hl['s0,1'][1]], [hl['s0,1'][0], hl['s0,1'][1] + 3 * 32 + 6]);
      await stretchLadder();
      await check(async () => (await entities()) === n0 + 5 && (await undoTitle()).includes('replacing 3'), 'stretching the ladder down over 3 platforms replaces them (4 ladders, 1 platform left), in one Undo step');
      await page.getByTestId('undo').click();
      await check(async () => (await entities()) === n0 + 5, '(Undo: the platforms are back)');
      await addOnTop.click();
      await check(async () => (await addOnTop.getAttribute('aria-checked')) === 'true', 'checking "Add on top"');
      await clickWorld(cx, top - 16);
      await stretchLadder();
      await check(async () => (await entities()) === n0 + 8 && !(await undoTitle()).includes('replacing'), 'the ladder goes over the platforms and they stay (3 more objects)');
      await page.getByTestId('undo').click();
      await addOnTop.click();
      // Dropping onto a platform replaces it too.
      await page.getByTestId('dock-library').click();
      const onPlatform = await w2s(cx, bottom + 2 * 32 + 16);
      await page.dragAndDrop('[data-testid="definition-Ladder"]', '[data-testid="viewport-canvas"]', { targetPosition: { x: onPlatform.x - cb.x, y: onPlatform.y - cb.y } });
      await check(async () => (await entities()) === n0 + 5 && (await undoTitle()).includes('Place Ladder, replacing 1'), 'dropping a ladder onto a platform replaces it');
      await page.getByTestId('undo').click();
      await page.getByTestId('undo').click();
      await page.getByTestId('undo').click();
      await check(async () => (await entities()) === n0 + 1, '(Undo)');
      await page.keyboard.press('Escape');
    }
    // A corner resizes one object (the opposite corner stays).
    await clickWorld((left + right) / 2, (top + bottom) / 2);
    await dragWorld([right, bottom], [right + 64, bottom + 1]);
    const h3 = await handles();
    await check(h3['c-1,-1'][0] === left && h3['c-1,-1'][1] === top && h3['c1,1'][0] === right + 64 && h3['c1,1'][1] === bottom && (await entities()) === n0 + 1, 'dragging the bottom-right corner 64 to the right makes the tile 96×32, its top-left corner where it was');
    await page.getByTestId('undo').click();
    await page.getByTestId('undo').click();
    await check(async () => (await entities()) === n0, '(back as it was)');
    await page.keyboard.press('Escape');
  }

  step = "other objects' code on request";
  {
    await page.getByTestId('global-prompt-toggle').click();
    const gp = page.getByTestId('global-prompt');
    const before = aiRequests.length;
    await gp.getByTestId('prompt-input').fill('What does the coin do?');
    await gp.getByTestId('prompt-input').press('Enter');
    await check(async () => (await gp.getByTestId('prompt-result').innerText()).includes("I read the Coin's code: 0 script(s), sent when I asked"), "the AI asks for an object's code it needs, gets it, and answers (one prompt, two requests)");
    await check(aiRequests.length === before + 2 && !aiRequests[before].code?.some((c) => c.name === 'Coin') && aiRequests[before + 1].code?.some((c) => c.name === 'Coin'), '(the first request without the code, the second with it)');
    await page.keyboard.press('Escape');
  }

  step = 'more levels';
  {
    const levelsBefore = await page.evaluate(() => 0);
    await page.getByTestId('global-prompt-toggle').click();
    const gp = page.getByTestId('global-prompt');
    await gp.getByTestId('prompt-input').fill('Make me a Lode Runner clone with three levels');
    await gp.getByTestId('prompt-input').press('Enter');
    await gp.locator('[data-testid="prompt-result"][data-status="applied"]').waitFor({ timeout: 10000 });
    await check(aiRequests.at(-1).context.level.design.forNewLevels.length >= 2 && new Set(aiRequests.at(-1).context.level.design.forNewLevels.map((i) => i.layout.name)).size >= 2, 'the AI gets a different layout idea for each new level');
    await page.keyboard.press('Escape');
    await page.getByTestId('scene-selector').click();
    const menu = page.getByTestId('scene-menu');
    await check(async () => (await menu.innerText()).includes('The Mines') && (await menu.innerText()).includes('The Tower'), '"… with three levels": the AI makes the new levels (create_level), after the existing one');
    await menu.getByRole('menuitem', { name: 'The Tower' }).click();
    await check(async () => Number(await canvas.getAttribute('data-entities')) >= 10, 'the new level is built: a player, a route with a ladder, a goal');
    // Win "The Mines" (run right to its goal): everything stands still under "Level complete!".
    await page.getByTestId('scene-selector').click();
    await menu.getByRole('menuitem', { name: 'The Mines' }).click();
    await page.getByTestId('play').click();
    const playCanvas = page.getByTestId('play-canvas');
    await page.keyboard.down('ArrowRight');
    await page.getByTestId('hud-banner').waitFor({ timeout: 10000 });
    // Where the banner is at once and a moment later: in the middle both times (it doesn't slide in from the side).
    const mid = async () => {
      const b = await page.getByTestId('hud-banner').boundingBox();
      const v = await page.locator('.play-view').boundingBox();
      return Math.round(b.x + b.width / 2 - (v.x + v.width / 2));
    };
    const off1 = await mid();
    const at1 = await playCanvas.getAttribute('data-player');
    await page.waitForTimeout(400);
    const at2 = await playCanvas.getAttribute('data-player');
    await page.keyboard.up('ArrowRight');
    const off2 = await mid();
    const bannerFont = await page.getByTestId('hud-banner').evaluate((el) => getComputedStyle(el).fontFamily + '|' + document.fonts.check("22px 'Press Start 2P'"));
    await page.screenshot({ path: `${OUT}/12i-level-complete.png` });
    await check(Math.abs(off1) <= 1 && Math.abs(off2) <= 1, `"Level complete!" is in the middle from the start (${off1}, then ${off2} px off the middle)`);
    await check(bannerFont.startsWith('"Press Start 2P"') && bannerFont.endsWith('|true'), `and in a console font, built in (${bannerFont})`);
    await check(async () => (await page.getByTestId('hud-banner').innerText()).includes('Level complete!') && at1 === at2, 'reaching the goal: "Level complete!" shows and the game stands still (the player can\'t be moved on)');
    await check(async () => (await playCanvas.getAttribute('data-level')) === 'The Tower', 'then the next level starts');
    await page.getByTestId('play').click();
    await page.getByTestId('undo').click();
    await page.getByTestId('scene-selector').click();
    await check(async () => !(await menu.innerText()).includes('The Mines') && !(await menu.innerText()).includes('The Tower'), 'one Undo takes all the new levels away');
    await page.keyboard.press('Escape');
    void levelsBefore;
  }

  step = 'export sprites';
  {
    await page.getByTestId('project-menu').click();
    await page.getByTestId('menu-export-sprites').click();
    const ex = page.getByTestId('sprite-export');
    await check(async () => (await ex.isVisible()) && (await ex.getByTestId('export-preview').count()) === 1, 'Export sprites shows the sprite sheet of all the pictures');
    const usedCount = await ex.getByTestId('export-count').innerText();
    await ex.getByTestId('export-only-used').uncheck();
    const num = (t) => Number(t.replace(/\D+/g, ''));
    await check(async () => num(await ex.getByTestId('export-count').innerText()) >= num(usedCount) && num(usedCount) > 0, 'by default the pictures the game uses; unticked, all of them');
    await ex.getByTestId('export-only-used').check();
    await ex.getByTestId('export-scale-4').click();
    await ex.screenshot({ path: `${OUT}/12e-export-sprites.png` });
    const [w, h] = (await ex.getByTestId('export-size').innerText()).split(' ')[0].split('×').map(Number);
    const [png] = await Promise.all([page.waitForEvent('download'), ex.getByTestId('export-png').click()]);
    const pngBytes = readFileSync(await png.path());
    const pngW = pngBytes.readUInt32BE(16);
    const pngH = pngBytes.readUInt32BE(20);
    await check(png.suggestedFilename().endsWith('@4x.png') && pngBytes.subarray(1, 4).toString() === 'PNG' && pngW === w && pngH === h, `Save PNG saves the sheet as a PNG at the chosen scale (${pngW}×${pngH})`);
    const [json] = await Promise.all([page.waitForEvent('download'), ex.getByTestId('export-json').click()]);
    const atlas = JSON.parse(readFileSync(await json.path(), 'utf8'));
    await check(json.suggestedFilename().endsWith('.json') && atlas.frames.Player && atlas.meta.size.w === w && atlas.meta.image === png.suggestedFilename() && atlas.pixelArt.Player.frames.length === 1, 'Save JSON saves the atlas: where each picture is on that PNG, with pixel art as data');
    // A pixel picture's frame is exactly where it was drawn on the sheet: check one pixel of the Player.
    const f = atlas.frames.Player.frame;
    const drawn = await page.evaluate(async ([data, x, y]) => {
      const img = new Image();
      img.src = data;
      await img.decode();
      const c = document.createElement('canvas');
      c.width = img.width;
      c.height = img.height;
      const g = c.getContext('2d');
      g.drawImage(img, 0, 0);
      return Array.from(g.getImageData(x, y, 1, 1).data);
    }, [`data:image/png;base64,${pngBytes.toString('base64')}`, f.x + Math.floor(f.w / 2), f.y + Math.floor(f.h / 2)]);
    await check(drawn[3] === 255, 'the Player is drawn where the JSON says it is');
    await page.keyboard.press('Escape');
    await check(async () => (await ex.count()) === 0, 'Esc closes it');
  }

  step = 'right-click menu and code editor';
  {
    const entities = async () => Number(await canvas.getAttribute('data-entities'));
    const n0 = await entities();
    const rightClick = async (wx, wy) => {
      const [cx, cy, z] = (await canvas.getAttribute('data-camera')).split(',').map(Number);
      const b = await canvas.boundingBox();
      await page.mouse.click(b.x + b.width / 2 + (wx - cx) * z, b.y + b.height / 2 + (wy - cy) * z, { button: 'right' });
    };
    await rightClick(-256, 0);
    const menu = page.getByTestId('object-menu');
    await check(async () => (await menu.innerText()).replace(/\s+/g, ' ').trim() === 'Ask AI… Details… Edit sprite Code Copy Cut Delete', 'right-clicking a placed object: Ask AI…, Details…, Edit sprite, Code, Copy, Cut, Delete');
    await check(async () => (await canvas.getAttribute('data-context')) === 'entity' && (await prompts.count()) === 0, '(and it is selected; no card yet)');
    await page.getByTestId('ctx-ask-ai').click();
    await check(async () => (await prompts.isVisible()) && (await prompts.getByTestId('entity-header').innerText()).trim() === 'Player', 'Ask AI… opens its AI prompt card');
    await rightClick(-256, 0);
    await page.getByTestId('menu-edit-sprite').click();
    await check(async () => (await page.getByTestId('sprite-editor').isVisible()) && (await page.getByTestId('se-canvas').getAttribute('data-pixels')).replace(/[./]/g, '').length > 20, 'Edit sprite opens the sprite editor on its picture');
    await page.getByTestId('se-close').click();
    // Code: its behavior code.
    await rightClick(-256, 0);
    await page.getByTestId('menu-code').click();
    const ce = page.getByTestId('code-editor');
    await check(async () => (await ce.isVisible()) && (await ce.getByTestId('code-components').innerText()).includes('"CharacterController"'), 'Code opens the code editor; without scripts it shows its built-in behaviors (components) as code');
    await ce.getByTestId('code-new-definition').click();
    await ce.getByTestId('code-text').fill('{ "name": "Hello", "description": "Says hello.", "handlers": [ { "when": { "on": "start" }, "do": [ { "do": "message", "text": "Hello!" } ] } ] ');
    await ce.getByTestId('code-save').click();
    await check(async () => (await ce.getByTestId('code-error').innerText()).includes('line'), "broken code isn't saved: it says so, with the line");
    await ce.getByTestId('code-text').fill('{ "name": "Hello", "description": "Says hello.", "handlers": [ { "when": { "on": "start" }, "do": [ { "do": "mesage", "text": "Hello!" } ] } ] }');
    await ce.getByTestId('code-save').click();
    await check(async () => (await ce.getByTestId('code-error').count()) === 1, 'code the game can\'t run is checked like the AI\'s and refused, saying why');
    await ce.getByTestId('code-text').fill('{ "name": "Hello", "description": "Says hello.", "handlers": [ { "when": { "on": "start" }, "do": [ { "do": "message", "text": "Hello!" } ] } ] }');
    await ce.getByTestId('code-save').click();
    await check(async () => (await ce.getByTestId('code-file-Hello').count()) === 1 && (await ce.getByTestId('code-error').count()) === 0, 'a valid script is saved and listed under every Player');
    await ce.screenshot({ path: `${OUT}/12f-code-editor.png` });
    await ce.getByTestId('code-tab-readable').click();
    await check(async () => (await ce.getByTestId('code-readable').innerText()).toLowerCase().includes('hello'), 'Readable shows it in words');
    await ce.getByTestId('code-file-reference').click();
    await check(async () => (await ce.getByTestId('code-reference').innerText()).includes('Triggers'), 'the language reference is one click away');
    await page.keyboard.press('Escape');
    await check(async () => (await ce.count()) === 0, 'Esc closes the code editor');
    await page.getByTestId('undo').click();
    // Copy / Cut / Delete / Paste here.
    await rightClick(-256, 0);
    await page.getByTestId('menu-copy').click();
    await rightClick(150, -220);
    await check(async () => (await menu.innerText()).replace(/\s+/g, ' ').trim() === 'Ask AI… Details… Paste here', 'right-clicking empty space after copying offers Ask AI…, Details… (the level’s) and Paste here');
    await page.getByTestId('menu-paste').click();
    await check(async () => (await entities()) === n0 + 1, 'Paste here places the copy');
    await page.getByTestId('undo').click();
    await rightClick(-256, 0);
    await page.getByTestId('menu-delete').click();
    await check(async () => (await entities()) === n0 - 1, 'Delete deletes it');
    await page.getByTestId('undo').click();
    await rightClick(-256, 0);
    await page.getByTestId('menu-cut').click();
    await check(async () => (await entities()) === n0 - 1, 'Cut takes it away (to paste)');
    await page.getByTestId('undo').click();
    await check(async () => (await entities()) === n0, '(Undo brings it back)');
    await page.keyboard.press('Escape');
  }

  step = 'game name, one prompt card';
  {
    await page.getByTestId('project-menu').click();
    const nameField = page.getByTestId('game-name');
    const before = await nameField.inputValue();
    await nameField.fill('Boulder Run');
    await nameField.press('Enter');
    await check(async () => (await page.getByTestId('project-menu').innerText()).includes('Boulder Run'), 'clicking the game\'s name: it can be renamed right there');
    await page.keyboard.press('Escape');
    await page.getByTestId('undo').click();
    await check(async () => (await page.getByTestId('project-menu').innerText()).includes(before), '(Undo puts the old name back)');
    // An object's card is open; the ✦ (level/game) card replaces it.
    await clickWorld(-256, 0);
    await check(async () => (await prompts.count()) === 1, '(an object\'s prompt card is open)');
    await page.getByTestId('global-prompt-toggle').click();
    await check(async () => (await prompts.count()) === 0 && (await page.getByTestId('global-prompt').count()) === 1, 'opening the level/game card closes the open prompt card');
    await page.keyboard.press('Escape');
  }

  step = 'export game as Windows and macOS apps';
  if (existsSync('src/core/export/runners.generated.ts')) {
    const listZip = (path) =>
      JSON.parse(execSync(`python3 -c "import zipfile,json,sys; z=zipfile.ZipFile(sys.argv[1]); assert z.testzip() is None; print(json.dumps([[i.filename, i.file_size, (i.external_attr>>16)&0o777] for i in z.infolist()]))" "${path}"`, { encoding: 'utf8' }));
    for (const [target, label] of [
      ['windows', 'Windows'],
      ['macos', 'macOS'],
    ]) {
      await page.getByTestId('project-menu').click();
      await page.getByTestId('menu-export-game').click();
      await page.getByTestId(`export-target-${target}`).check();
      const [dl] = await Promise.all([page.waitForEvent('download'), page.getByTestId('export-game-confirm').click()]);
      const file = `${process.cwd()}/${OUT}/exported-${target}.zip`;
      await dl.saveAs(file);
      const names = listZip(file);
      const has = (end) => names.find(([n]) => n.endsWith(end));
      const ok =
        target === 'windows'
          ? dl.suggestedFilename().endsWith('-windows.zip') && has('.exe') && has('/game.html') && has('How to play.txt')
          : dl.suggestedFilename().endsWith('-macos.zip') && has('.app/Contents/MacOS/Game')?.[2] === 0o755 && has('.app/Contents/Resources/game.html') && has('_CodeSignature/CodeResources') && has('Contents/Info.plist');
      await check(!!ok, `Export game → ${label} app saves a zip with the game in a ${label} program`);
    }
  }

  step = 'export game for itch.io';
  {
    await page.getByTestId('project-menu').click();
    await page.getByTestId('menu-export-game').click();
    await page.getByTestId('export-target-itch').check();
    await check(async () => (await page.getByTestId('itch-guide').isVisible()) && /Kind of project/.test(await page.getByTestId('itch-guide').innerText()), 'Export game → itch.io shows how to put it on itch.io, step by step');
    await page.getByTestId('export-game-dialog').screenshot({ path: `${OUT}/export-itch.png` });
    const [dl] = await Promise.all([page.waitForEvent('download'), page.getByTestId('export-game-confirm').click()]);
    const file = `${process.cwd()}/${OUT}/exported-itch.zip`;
    await dl.saveAs(file);
    const inside = execSync(`python3 -c "import zipfile,sys; z=zipfile.ZipFile(sys.argv[1]); print(z.namelist()); print('pxl-game' in z.read('index.html').decode())" "${file}"`, { encoding: 'utf8' });
    await check(dl.suggestedFilename().endsWith('-itch.zip') && inside.includes("['index.html']") && inside.includes('True'), 'it saves a zip with the game as index.html (the form itch.io takes)');
  }

  step = 'export game as a web page';
  {
    await page.getByTestId('project-menu').click();
    await page.getByTestId('menu-export-game').click();
    await check(async () => (await page.getByTestId('export-touch').isChecked()), 'Export game asks about touch controls for phones (on by default)');
    if (await page.getByTestId('export-target-web').count()) await page.getByTestId('export-target-web').check();
    const [dl] = await Promise.all([page.waitForEvent('download'), page.getByTestId('export-game-confirm').click()]);
    const file = `${process.cwd()}/${OUT}/exported-game.html`;
    await dl.saveAs(file);
    const html = readFileSync(file, 'utf8');
    await check(dl.suggestedFilename().endsWith('.html') && html.includes('id="pxl-game"') && !html.includes('<script type="module" src='), 'Export game saves one HTML file with the game and the player inside (nothing else to load)');
    const gp = await page.context().newPage();
    const gameErrors = [];
    gp.on('pageerror', (e) => gameErrors.push(e.message));
    await gp.goto(`file://${file}`);
    await gp.getByTestId('play-canvas').waitFor();
    await check(async () => (await gp.locator('.hud-keys, .player-start').count()) === 0, 'opened in a browser, the game plays at once: no start screen, no key hints, only the game');
    // On a phone: on-screen buttons that play it.
    {
      const phone = await browser.newContext({ viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true });
      const ph = await phone.newPage();
      await ph.goto(`file://${file}`);
      const pcv = ph.getByTestId('play-canvas');
      await pcv.waitFor();
      await ph.waitForTimeout(500);
      await check(async () => (await ph.getByTestId('touch-controls').isVisible()) && (await ph.getByTestId('touch-jump').count()) === 1, 'on a phone the game shows touch controls (arrows, jump)');
      const x0 = Number(((await pcv.getAttribute('data-player')) ?? '0').split(',')[0]);
      const btn = await ph.getByTestId('touch-right').boundingBox();
      const touchOn = (type) =>
        ph.evaluate(
          ([type, x, y]) => document.querySelector('[data-testid="touch-right"]').dispatchEvent(new PointerEvent(type, { pointerId: 3, pointerType: 'touch', isPrimary: true, clientX: x, clientY: y, bubbles: true, cancelable: true })),
          [type, btn.x + btn.width / 2, btn.y + btn.height / 2],
        );
      await touchOn('pointerdown');
      await ph.waitForTimeout(600);
      await touchOn('pointerup');
      const x1 = Number(((await pcv.getAttribute('data-player')) ?? '0').split(',')[0]);
      await check(x1 > x0 + 20, `holding the ▶ button runs right (${x0} → ${x1})`);
      await ph.screenshot({ path: `${OUT}/12h-phone-controls.png` });
      await phone.close();
    }
    const pc = gp.getByTestId('play-canvas');
    await pc.waitFor();
    await gp.waitForTimeout(500);
    const startAt = (await pc.getAttribute('data-player')) ?? '';
    await gp.keyboard.down('ArrowRight');
    await gp.waitForTimeout(600);
    await gp.keyboard.up('ArrowRight');
    const movedAt = (await pc.getAttribute('data-player')) ?? '';
    await check(startAt !== '' && Number(movedAt.split(',')[0]) > Number(startAt.split(',')[0]) + 20 && gameErrors.length === 0, `and the game plays: the player runs right (${startAt.split(',')[0]} → ${movedAt.split(',')[0]})`);
    await gp.screenshot({ path: `${OUT}/12g-exported-game.png` });
    // Dropping a file: a helper that drops text as a file on an element.
    const dropFile = (pg, selector, name, text) =>
      pg.evaluate(
        ([selector, name, text]) => {
          const dt = new DataTransfer();
          dt.items.add(new File([text], name, { type: 'application/json' }));
          const target = document.querySelector(selector);
          target.dispatchEvent(new DragEvent('dragover', { dataTransfer: dt, bubbles: true, cancelable: true }));
          target.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
        },
        [selector, name, text],
      );
    const bundle = JSON.parse(html.match(/<script type="application\/json" id="pxl-game"[^>]*>([\s\S]*?)<\/script>/)[1]);
    const projectFile = Object.keys(bundle.files).find((k) => k === 'project.json');
    bundle.files[projectFile].name = 'Dropped Game';
    const droppedText = JSON.stringify(bundle);
    await gp.close();
    // The empty player: games are dropped onto it.
    await page.getByTestId('project-menu').click();
    const [pl] = await Promise.all([page.waitForEvent('download'), page.getByTestId('menu-export-player').click()]);
    const playerFile = `${process.cwd()}/${OUT}/pxlbuilder-player.html`;
    await pl.saveAs(playerFile);
    const pp = await page.context().newPage();
    await pp.goto(`file://${playerFile}`);
    await check(async () => (await pp.getByTestId('player-empty').innerText()).includes('Drop a game here'), 'Download game player: a page that asks for a game to be dropped onto it');
    await dropFile(pp, 'body', 'dropped.pxlproj.json', droppedText);
    await check(async () => (await pp.getByTestId('play-canvas').count()) === 1, 'and plays the game dropped onto it');
    await pp.close();
    // The editor: a saved game dropped on the level opens it (Undo goes back).
    await dropFile(page, '.viewport', 'dropped.pxlproj.json', droppedText);
    await check(async () => (await page.getByTestId('project-menu').innerText()).includes('Dropped Game'), 'dropping a saved game file on the editor opens it');
    await page.getByTestId('undo').click();
    await check(async () => !(await page.getByTestId('project-menu').innerText()).includes('Dropped Game'), '(Undo brings back the game from before)');
  }

  step = 'typed commands';
  {
    // Plain editing words in the prompt card are done by the app itself, at once (no AI needed).
    const entities = async () => Number(await canvas.getAttribute('data-entities'));
    const n0 = await entities();
    const said = async () => (await result.last().innerText()).replace(/\s+/g, ' ');
    // Typed but not sent, then a click elsewhere closes the card: the text is still there when it opens again.
    await clickWorld(-256, 0);
    await promptInput.click();
    await promptInput.fill('make the player glow and');
    await clickWorld(150, -220);
    await check(async () => (await prompts.count()) === 0, '(clicking empty level closes the card)');
    await clickWorld(-256, 0);
    await check(async () => (await promptInput.inputValue()) === 'make the player glow and', "a prompt typed but not sent isn't lost when the card closes: it's back when the object is selected again");
    // (The card sits over the next object here: close it first by clicking empty level.)
    await clickWorld(150, -220);
    await clickWorld(-32, 0);
    await check(async () => (await promptInput.inputValue()) === '', `(another object's card has its own, empty, text: ${await prompts.count()} card(s), "${await promptInput.inputValue().catch(() => '?')}", about ${await prompts.getAttribute('data-context').catch(() => '?')} ${(await prompts.innerText().catch(() => '')).slice(0, 60).replace(/\s+/g, ' ')}, selection ${await canvas.getAttribute('data-selection')})`);
    await clickWorld(-256, 0);
    await promptInput.fill('');
    await clickWorld(-256, 0);
    await ask('duplicate it 2 times to the right');
    await check(async () => (await entities()) === n0 + 2, '"duplicate it 2 times to the right" makes two copies side by side');
    await check(async () => (await canvas.getAttribute('data-context')) === 'pair', 'the copies are selected');
    await ask('move them up 2');
    await check(async () => (await said()).includes('Moved 2 objects 2 squares up'), '"move them up 2" moves the selection two squares');
    await ask('copy');
    await check(async () => (await said()).includes('Copied 2 objects'), '"copy" copies the selection');
    await ask('delete');
    await check(async () => (await entities()) === n0, '"delete" deletes the selected objects');
    await clickWorld(-256, 0);
    await ask('paste');
    await check(async () => (await entities()) === n0 + 2 && (await canvas.getAttribute('data-context')) === 'pair', '"paste" places the copied objects again (selected)');
    await ask('rename to Twin');
    await check(async () => (await said()).includes('Renamed 2 objects Twin'), '"rename to Twin" renames them');
    await ask('undo');
    await check(async () => (await said()).includes('Undid: Rename to Twin'), '"undo" undoes the last step');
    await ask('erase them');
    await check(async () => (await entities()) === n0, '"erase them" deletes them too');
    await page.keyboard.press('Escape');
    // Ctrl+C / Ctrl+V on placed objects.
    await clickWorld(-256, 0);
    await page.keyboard.press('Control+c');
    await page.keyboard.press('Control+v');
    await check(async () => (await entities()) === n0 + 1, 'Ctrl+C then Ctrl+V pastes a copy of a placed object');
    await page.keyboard.press('Delete');
    await check(async () => (await entities()) === n0, '(the pasted copy deleted again)');
    // Anything more goes to the AI as before.
    await clickWorld(-256, 0);
    await ask('help');
    await check(async () => (await said()).includes('without the AI') && (await said()).includes('duplicate'), '"help" lists what works without the AI');
    await page.keyboard.press('Escape');
  }

  step = 'camera';
  await page.keyboard.press('Escape');
  const frameOf = async () => ((await canvas.getAttribute('data-camera-frame')) ?? '').split(',').filter(Boolean).map(Number);
  const f1 = await frameOf();
  await check(async () => f1.length === 4 && f1[2] - f1[0] > 200, 'the camera outline (what Play shows at the start) is on the level by default');
  {
    // Hover its left edge: it glows a little; click it: selected (glows), and the level card asks about the camera.
    const box = await canvas.boundingBox();
    // Zoom out so the whole outline is on screen.
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    for (let i = 0; i < 3; i++) {
      await page.keyboard.down('Control');
      await page.mouse.wheel(0, 12);
      await page.keyboard.up('Control');
    }
    await page.waitForTimeout(200);
    const [cx, cy, zoom] = await cam();
    const edge = { x: box.x + box.width / 2 + (f1[0] - cx) * zoom, y: box.y + box.height / 2 + ((f1[1] + f1[3]) / 2 - cy) * zoom };
    await page.mouse.move(edge.x, edge.y);
    await check(async () => (await canvas.getAttribute('data-camera-outline')) === 'start|', 'hovering the camera outline highlights it');
    await page.mouse.click(edge.x, edge.y);
    await check(
      async () =>
        (await canvas.getAttribute('data-camera-outline')).endsWith('|start') &&
        (await prompts.count()) === 1 &&
        (await prompts.getByTestId('camera-settings-btn').count()) === 1 &&
        (await page.getByTestId('camera-panel').count()) === 0 &&
        !(await canvas.getAttribute('data-marker')),
      'clicking it selects it (it glows, no spot marker) and opens its AI card, with a Settings button',
    );
    await check(async () => (await prompts.getByTestId('prompt-input').getAttribute('placeholder')).length < 30, '(its hint is short)');
    await check(async () => (await prompts.getByTestId('chat-past').count()) === 0, "it is the camera's own conversation (the level's earlier requests are not in it)");
    await page.screenshot({ path: `${OUT}/26b-camera-outline.png` });
    await prompts.getByTestId('camera-settings-btn').click();
    {
      const panel = page.getByTestId('camera-panel');
      await check(async () => (await panel.count()) === 1 && (await panel.getByTestId('camera-follow').locator('option:checked').innerText()) === 'Player', 'Settings opens the Camera card: it follows the Player');
      const zoomInput = panel.getByTestId('camera-panel-zoom');
      await zoomInput.fill('2');
      await zoomInput.press('Enter');
      await check(async () => {
        const f = await frameOf();
        return Math.abs(f[2] - f[0] - (f1[2] - f1[0]) / 2) < 2;
      }, 'zoom 2 in the card: the outline shows half as much');
      await panel.getByTestId('camera-follow').selectOption('');
      await check(async () => (await panel.getByTestId('camera-ease').count()) === 0 && (await panel.getByTestId('camera-panel-fixed-set').count()) === 1, 'Follows: nothing makes it a still camera (no ease; where it looks instead)');
      await panel.getByTestId('camera-resolution').selectOption('180');
      await check(async () => (await panel.getByTestId('camera-resolution').inputValue()) === '180', 'the play resolution is set for the game');
      {
        await page.getByTestId('play').click();
        const playCanvas = page.getByTestId('play-canvas');
        await check(async () => {
          const [w, h] = ((await playCanvas.getAttribute('data-pixels')) ?? '0x0').split('x').map(Number);
          const full = await playCanvas.evaluate((c) => Math.round(c.getBoundingClientRect().height * devicePixelRatio));
          return h >= 150 && h <= 260 && w > h && Math.abs(full / h - Math.round(full / h)) < 0.05;
        }, 'Play at resolution 180: the screen shows about 180 picture pixels top to bottom (each a whole number of screen pixels)');
        await page.keyboard.press('Escape');
        await check(async () => (await page.getByTestId('viewport-canvas').isVisible()) && (await page.getByTestId('camera-panel').count()) === 1, '(back in the editor, the camera settings still open)');
      }
      for (let i = 0; i < 3; i++) await page.getByTestId('undo').click();
      await check(async () => (await panel.getByTestId('camera-follow').locator('option:checked').innerText()) === 'Player' && (await frameOf()).join() === f1.join() && (await panel.getByTestId('camera-resolution').inputValue()) === 'editor', 'each change is one Undo step');
      await page.screenshot({ path: `${OUT}/26c-camera-card.png` });
      await panel.getByTestId('camera-panel-close').click();
      await check(async () => (await panel.count()) === 0 && (await canvas.getAttribute('data-camera-outline')).endsWith('|start'), "the settings card's × closes it (the camera stays selected)");
    }
    await page.keyboard.press('Escape');
    await check(async () => (await canvas.getAttribute('data-camera-outline')).endsWith('|'), 'Esc lets go of it');
    {
      const label = { x: box.x + box.width / 2 + (f1[0] - cx) * zoom + 24, y: box.y + box.height / 2 + (f1[1] - cy) * zoom - 7 };
      await page.mouse.click(label.x, label.y);
      await check(async () => (await canvas.getAttribute('data-camera-outline')).endsWith('|start') && (await prompts.count()) === 1, 'clicking its label opens its card too');
      await page.keyboard.press('Escape');
      await check(async () => (await canvas.getAttribute('data-camera-outline')).endsWith('|') && (await prompts.count()) === 0, '(Esc closes it)');
    }
    // Zoom back in where it zoomed out (the later steps click at fixed places).
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    for (let i = 0; i < 3; i++) {
      await page.keyboard.down('Control');
      await page.mouse.wheel(0, -12);
      await page.keyboard.up('Control');
    }
    await page.waitForTimeout(200);
  }
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
  await check(async () => (await camPrompt.getByTestId('prompt-result').getAttribute('data-status')) === 'applied' && (await camPrompt.getByTestId('prompt-result').innerText()).includes('Left out one part'), 'an answer still broken after its retry applies the parts that work and shows what was left out');
  await check(aiRequests.length === askedBefore2 + 2, '(the AI was asked once more, not again and again)');
  await camPrompt.getByTestId('result-undo').click();
  // Working on the level closes the card; dots on ✦ show the AI is still at it.
  await camPrompt.getByTestId('prompt-input').fill('Take your time: think about the level.');
  await camPrompt.getByTestId('prompt-input').press('Enter');
  await page.mouse.click(emptySpot.x, emptySpot.y);
  await check(async () => (await camPrompt.count()) === 0 && (await page.getByTestId('global-prompt-toggle').getByTestId('job-dots').count()) === 1, 'clicking the level closes the ✦ card, and dots on ✦ show the AI is still working');
  await check(async () => (await page.getByTestId('global-prompt-toggle').getByTestId('job-dots').count()) === 0, '(the dots go when it is done)');
  await page.getByTestId('global-prompt-toggle').click();
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
  await check(async () => (await frameOf()).length === 0, 'the camera outlines can be hidden (⋯ menu)');
  await page.getByTestId('main-menu').click();
  await page.getByTestId('menu-camera-frame').click();
  await page.keyboard.press('Escape');

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

  step = 'levels are never off view';
  {
    const camNow = async () => ((await canvas.getAttribute('data-camera')) ?? '').split(',').map(Number);
    await page.getByTestId('scene-selector').click();
    await page.getByTestId('new-scene').click();
    await page.mouse.dblclick(emptySpot.x, emptySpot.y);
    await ask('Build something far away.');
    await check(async () => Math.abs((await camNow())[0] - 3008) < 40, 'what the AI built far off screen is brought into view');
    await page.keyboard.press('Escape');
    await page.getByTestId('scene-selector').click();
    await page.getByRole('menuitem', { name: 'Level 1' }).click();
    await check(async () => Math.abs((await camNow())[0] - 3008) > 500, 'switching back to Level 1 shows Level 1');
    await page.getByTestId('scene-selector').click();
    await page.getByRole('menuitem', { name: 'Level 2' }).click();
    await check(async () => Math.abs((await camNow())[0] - 3008) < 40, 'and coming back to Level 2 shows it as it was left, not an empty spot');
    await page.getByTestId('scene-selector').click();
    await page.getByRole('menuitem', { name: 'Level 1' }).click();
    // The view shows Level 1 again (drawn on the next frame) before clicking things in it.
    await check(async () => Math.abs((await camNow())[0] - 3008) > 500, '(back on Level 1)');
  }

  step = 'no AI connection';
  await page.unroute('**/api/ai');
  await page.keyboard.press('Escape');
  await clickWorld(-256, 0);
  await ask('Give the player a jetpack.');
  await check(async () => (await result.getAttribute('data-status')) === 'error', 'without an API key the real endpoint answers with an error');
  await check(async () => /not connected/i.test(await result.innerText()), 'the prompt says plainly that AI is not connected');
  {
    // Sent again with one click once the AI answers (here: the stand-in back on).
    const before = aiRequests.length;
    await page.route('**/api/ai', async (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(stubModel(JSON.parse(route.request().postData()))) }));
    await result.getByTestId('result-retry').click();
    await check(async () => aiRequests.length === before + 1 && aiRequests.at(-1).request === 'Give the player a jetpack.' && (await result.getAttribute('data-status')) !== 'error', 'a failed request has Try again: one click sends the same request again');
    await page.unroute('**/api/ai');
  }

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
  // A "Whole game" conversation in this game (it must not show up in the next one).
  const wholeGame = async () => {
    if ((await page.getByTestId('global-prompt').count()) === 0) await page.getByTestId('global-prompt-toggle').click();
    await page.getByTestId('global-prompt').getByRole('radio', { name: 'Whole game' }).click();
    return page.getByTestId('global-prompt');
  };
  let wg = await wholeGame();
  await wg.getByTestId('prompt-input').fill('What is this game about?');
  await wg.getByTestId('prompt-input').press('Enter');
  await wg.getByTestId('prompt-result').waitFor({ timeout: 10000 });
  await page.keyboard.press('Escape');
  wg = await wholeGame();
  await check(async () => (await wg.getByTestId('chat-past').count()) + (await wg.getByTestId('prompt-result').count()) >= 1, '(a Whole game conversation in this game)');
  await page.keyboard.press('Escape');
  await page.getByTestId('project-menu').click();
  await page.getByTestId('menu-new').click();
  await check(async () => await page.getByTestId('game-chooser').isVisible(), 'New project asks what kind of game');
  const entitiesBefore = await canvas.getAttribute('data-entities');
  await page.getByTestId('game-topdown').click();
  await check(async () => (await canvas.getAttribute('data-entities')) === '0', 'a new top-down game starts with an empty level');
  await openLibrary();
  await check(async () => (await page.getByTestId('definition-Wall').count()) === 1 && (await page.getByTestId('definition-Floor').count()) === 1 && (await page.getByTestId('definition-Ladder').count()) === 0, 'with the top-down objects (walls, floor, a slime…) and no ladders');
  await page.screenshot({ path: `${OUT}/00b-top-down-library.png` });
  await page.keyboard.press('Escape');
  await page.getByTestId('undo').click();
  await check(async () => (await canvas.getAttribute('data-entities')) === entitiesBefore, 'Undo brings back the game from before');
  // (The AI is answered by the stand-in again for this.)
  await page.route('**/api/ai', async (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(stubModel(JSON.parse(route.request().postData()))) }));
  await page.getByTestId('project-menu').click();
  await page.getByTestId('menu-new').click();
  await check(async () => (await page.getByTestId('game-idea-go').isDisabled()) === true, 'New game has a field to tell the AI what game you want (Make it waits for words)');
  {
    const picker = page.getByTestId('game-chooser').getByTestId('ai-picker');
    await picker.click();
    await check(async () => (await page.getByTestId('ai-picker-menu').isVisible()) && (await page.getByTestId('game-chooser').isVisible()), 'New game lets you choose the AI that builds it (the AI menu opens over the dialog)');
    await picker.click();
    await check(async () => (await page.getByTestId('ai-picker-menu').count()) === 0 && (await page.getByTestId('game-chooser').isVisible()), '(and closes again, the dialog still open)');
  }
  await page.getByTestId('game-idea').fill('A cave game where you dig for diamonds');
  await page.getByTestId('game-idea').press('Enter');
  await check(async () => (await page.getByTestId('game-chooser').count()) === 0, 'telling it goes straight to the editor, the Whole game card working on it');
  await page.getByTestId('global-prompt').getByTestId('prompt-result').waitFor({ timeout: 10000 });
  await check(async () => /built it on the topdown starter/i.test(await page.getByTestId('global-prompt').innerText()), 'the AI chose the top-down starter for it and built the game on it');
  await check(async () => (await canvas.getAttribute('data-entities')) === '2', '(what it built is on the level)');
  await openLibrary();
  await check(async () => (await page.getByTestId('definition-Wall').count()) === 1 && (await page.getByTestId('definition-Ladder').count()) === 0, 'the game has the top-down objects');
  await page.keyboard.press('Escape');
  {
    const asks = aiRequests.filter((b) => b.request.includes('dig for diamonds'));
    await check(async () => asks.length === 2 && asks[0].context.newGame.starters.length === 2, 'the starters were described with the first request (one more only because it switched)');
  }
  await page.unroute('**/api/ai');
  await page.getByTestId('project-menu').click();
  await page.getByTestId('menu-new').click();
  await page.getByTestId('new-sprite-size-8').click();
  await page.getByTestId('game-platformer').click();
  await check(async () => (await canvas.getAttribute('data-entities')) === '0', 'New project → Platformer starts an empty level');
  await check(async () => (await canvas.getAttribute('data-camera-frame')) === '', 'no camera outline on an empty level');
  await page.getByTestId('project-menu').click();
  await check(async () => (await page.getByTestId('sprite-size-8').getAttribute('aria-pressed')) === 'true', 'the sprite size picked when starting (8×8) is the game\'s sprite size (project menu)');
  await page.getByTestId('sprite-size-16').click();
  await page.getByTestId('project-menu').click();
  await check(async () => (await page.getByTestId('sprite-size-16').getAttribute('aria-pressed')) === 'true', 'and it can be changed there (16×16)');
  await page.keyboard.press('Escape');
  await page.getByTestId('dock-library').click();
  await page.dragAndDrop('[data-testid="definition-Player"]', '[data-testid="viewport-canvas"]', { targetPosition: { x: (await canvas.boundingBox()).width / 2, y: (await canvas.boundingBox()).height / 2 } });
  await check(async () => ((await canvas.getAttribute('data-camera-frame')) ?? '') !== '', 'the camera outline appears once something is placed');
  await page.getByTestId('undo').click();
  wg = await wholeGame();
  await check(async () => (await wg.getByTestId('chat-past').count()) === 0 && (await wg.getByTestId('prompt-chat').count()) === 0, "a new game's Whole game card starts empty: another game's conversation isn't in it");
  await page.keyboard.press('Escape');
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
  await startPlatformer(lp);
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
    if (where === lPrompt) await openCard(lp, lPrompt);
    const input = where.getByTestId('prompt-input');
    await input.click();
    await input.fill(text);
    await input.press('Enter');
  };
  // Ground from x=-208 to 208, then Player, Key, Switch and Door standing on it.
  await lp.getByTestId('dock-library').click();
  await lp.getByTestId('definition-Platform').click();
  // (The Objects panel stays open; close it so it doesn't cover where the ground is drawn.)
  if ((await lp.getByTestId('library-panel').count()) > 0) await lp.getByTestId('dock-library').click();
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
  await check(async () => (await lp.getByTestId('viewport-canvas').getAttribute('data-context')) === 'pair', 'switch + door gives one relationship prompt');
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
  await openDetailsOn(lp);
  await check(async () => (await lp.getByTestId('connections').innerText()).includes('Switch opens and closes Door'), "the door's details show what controls it");
  await lp.getByTestId('close-details').click();

  await lp.getByTestId('play').click();
  const lPlay = lp.getByTestId('play-canvas');
  const lps = async () => ((await lPlay.getAttribute('data-player')) ?? '').split(',').map(Number);
  const evs = async () => (await lPlay.getAttribute('data-events')) ?? '';
  await check(async () => (await lps())[2] === 1, 'play: the player lands');
  await check(async () => (await lp.getByTestId('hud-health').getAttribute('aria-label')) === 'Health 3 of 3', 'the HUD shows the player\'s hearts');
  await check(async () => (await lp.getByTestId('hud-heart').count()) === 3 && ((await lp.getByTestId('hud-heart').first().getAttribute('src')) ?? '').startsWith('data:image/svg'), "(drawn with the Heart object's picture)");
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
  // The artifact's own storage (assets: files served at /_blob/<id>; db: documents).
  const blobs = new Map();
  let blobCount = 0;
  await cp2.exposeFunction('__stubUpload', (text) => {
    const id = `${++blobCount}`.padStart(32, '0');
    blobs.set(id, text);
    return id;
  });
  await cp2.exposeFunction('__stubDeleteBlob', (id) => blobs.delete(id));
  await cp2.route('**/_blob/*', (r) => {
    const id = r.request().url().split('/_blob/')[1];
    return blobs.has(id) ? r.fulfill({ status: 200, contentType: 'application/json', body: blobs.get(id) }) : r.fulfill({ status: 404, body: '' });
  });
  // Stand-in for the claude.ai artifact viewer: window.claude.use("sample" | "downloads") like the real runtime.
  // Inside claude.ai the page is in another site's frame, where the browser doesn't let it show file pickers.
  await cp2.addInitScript(() => {
    const blocked = () => Promise.reject(new DOMException("Cross origin sub frames aren't allowed to show a file picker.", 'SecurityError'));
    window.showSaveFilePicker = blocked;
    window.showOpenFilePicker = blocked;
  });
  await cp2.addInitScript(() => {
    const sample = Object.freeze(Object.assign(async (input, options) => ({ text: JSON.stringify(await window.__stubSample(input, options?.cache)), truncated: false }), { json: (input, options) => window.__stubSample(input, options?.cache) }));
    const downloads = Object.freeze({
      save: async ({ filename, data }) => {
        await window.__stubSave(filename, typeof data === 'string' ? data : await data.text());
        return { status: 'saved' };
      },
    });
    const assets = Object.freeze({
      upload: async (blob) => {
        const text = await blob.text();
        const id = await window.__stubUpload(text);
        return { id, url: `/_blob/${id}`, sizeBytes: text.length, contentType: 'application/json' };
      },
      delete: async (id) => window.__stubDeleteBlob(id),
    });
    const docs = new Map();
    window.__docs = docs;
    const snap = (path) => ({ id: path.split('/').pop(), exists: docs.has(path), data: () => (docs.has(path) ? structuredClone(docs.get(path)) : undefined) });
    const db = Object.freeze({
      doc: (path) => ({ get: async () => snap(path), set: async (data) => void docs.set(path, structuredClone(data)), delete: async () => void docs.delete(path) }),
      collection: (path) => ({ get: async () => ({ docs: [...docs.keys()].filter((k) => k.startsWith(`${path}/`) && k.split('/').length === path.split('/').length + 1).map(snap) }) }),
    });
    // Who is signed in (PXLGameSite keeps each person's games under their id).
    const user = Object.freeze({ id: async () => 'user_a', profiles: async (ids) => Object.fromEntries(ids.map((id) => [id, { name: id === 'user_b' ? 'Sigga' : 'Me' }])) });
    const caps = { sample, downloads, assets, db, user };
    window.claude = Object.freeze({ use: async (name) => caps[name] ?? null });
  });
  await cp2.goto(URL);
  await startPlatformer(cp2);
  await cp2.getByTestId('main-menu').click();
  await cp2.getByTestId('menu-ai-connection').click();
  await check(async () => (await cp2.getByTestId('ai-connection-status').innerText()).includes('your Claude account') && (await cp2.getByTestId('ai-key-input').count()) === 0, 'in the published app the AI uses your Claude account; no API key field');
  await cp2.keyboard.press('Escape');
  const cBox = await cp2.getByTestId('viewport-canvas').boundingBox();
  await cp2.getByTestId('dock-library').click();
  await cp2.dragAndDrop('[data-testid="definition-Player"]', '[data-testid="viewport-canvas"]', { targetPosition: { x: cBox.width / 2, y: cBox.height / 2 - 150 } });
  await cp2.mouse.click(cBox.x + cBox.width / 2, cBox.y + cBox.height / 2 - 150);
  const cPrompt = cp2.getByTestId('context-prompt');
  await openCard(cp2, cPrompt);
  await cPrompt.getByTestId('prompt-input').fill('Give the player five hearts.');
  await cPrompt.getByTestId('prompt-input').press('Enter');
  await changeObject(cPrompt);
  await check(async () => (await cPrompt.getByTestId('prompt-result').getAttribute('data-status')) === 'applied', 'a prompt works through the Claude account');
  await check(sampleCalls.length === 1 && sampleCalls[0].input.includes('REPLY FORMAT') && sampleCalls[0].cache === false && cServer === 0, 'it asked Claude via claude.ai with the reply format, never a server, never a cached answer');
  await cp2.getByTestId('project-menu').click();
  await cp2.getByTestId('menu-save').click();
  await check(async () => (await cp2.getByTestId('save-name').inputValue()) === 'Untitled Game', 'Save asks for the name (the game\'s name now)');
  await cp2.getByTestId('save-name').fill('Mole Mine');
  await check(async () => (await cp2.getByTestId('save-filename').innerText()) === 'mole-mine.pxlproj.json', '(and shows the file name it gives)');
  await cp2.getByTestId('save-confirm').click();
  await check(async () => saves.length === 1 && saves[0].filename === 'mole-mine.pxlproj.json' && JSON.parse(saves[0].text).kind === 'pxlbuilder.bundle' && (await cp2.getByTestId('project-menu').innerText()).includes('Mole Mine'), 'Save renames the game and hands the project file to claude.ai to offer for download');
  await check(async () => (await cp2.locator('.dirty-dot').count()) === 0, 'and the project counts as saved');
  {
    await cp2.getByTestId('project-menu').click();
    await cp2.getByTestId('menu-save').click();
    await check(async () => /^\(\d+: /.test(await cp2.getByTestId('save-unused-count').innerText()), 'Save offers to leave out the objects no level uses (and names them)');
    await cp2.getByTestId('save-drop-unused').check();
    await cp2.getByTestId('save-confirm').click();
    await check(async () => {
      if (saves.length !== 2) return false;
      const defs = (t) => JSON.parse(t).files['project.json'].objects.map((o) => o.name);
      return defs(saves[1].text).join() === 'Player' && defs(saves[0].text).length > 5;
    }, 'and the file then has only the Player (the only object placed); the editor keeps the rest');
    await check(async () => (await cp2.getByTestId('dock-library').count()) === 1, '(the editor still works)');
  }
  {
    // Save in one click: the game's file (inside claude.ai the page can't write it itself, so claude.ai offers it as a
    // download, with no dialog of the app's own first).
    const before = saves.length;
    await cp2.getByTestId('save-button').click();
    await check(async () => (await cp2.getByTestId('save-button').getAttribute('data-state')) === 'saved' && saves.length === before + 1 && saves.at(-1).filename === 'mole-mine.pxlproj.json' && blobs.size === 0 && (await cp2.getByTestId('save-dialog').count()) === 0, "the Save button saves the game's file in one click (offered by claude.ai; no dialog of the app's own, nothing kept with the app instead)");
    await cp2.keyboard.press('Control+s');
    await check(async () => saves.length === before + 2, 'Ctrl+S saves the file again');
  }
  {
    // PXLGameSite: the game shop inside the app.
    await cp2.getByTestId('project-menu').click();
    await cp2.getByTestId('menu-gamesite-save').click();
    const gs = cp2.getByTestId('gamesite-save');
    await check(async () => (await gs.getByTestId('gamesite-save-name').inputValue()) === 'Mole Mine' && (await gs.getByTestId('gamesite-save-shot').count()) === 1, 'Save to PXLGameSite shows the game\'s picture with its name under it');
    const shotSize = await gs.getByTestId('gamesite-save-shot').evaluate((img) => `${img.naturalWidth}x${img.naturalHeight}`);
    await check(shotSize === '480x270', `(the picture is the game at its own pixels: ${shotSize})`);
    await cp2.waitForTimeout(400);
    await cp2.screenshot({ path: `${OUT}/40-gamesite-save.png` });
    await gs.getByTestId('gamesite-save-confirm').click();
    await check(async () => (await gs.getByTestId('gamesite-save-done').count()) === 1, 'it is put up');
    const keys = await cp2.evaluate(() => [...window.__docs.keys()].filter((k) => k.startsWith('gamesite/')).sort());
    await check(keys.includes('gamesite/user_a') && keys.some((k) => k.startsWith('gamesite/user_a/shots/')) && keys.some((k) => k.startsWith('gamesite/user_a/parts/')), "kept under the person's own id: the list, the picture and the game file");
    // Someone else's game, put up from another account.
    await cp2.evaluate(() => {
      const docs = window.__docs;
      for (const [k, v] of [...docs]) if (k.startsWith('gamesite/user_a')) docs.set(k.replace('user_a', 'user_b'), structuredClone(v));
      const list = docs.get('gamesite/user_b');
      const [gid] = Object.keys(list.games);
      list.games[gid] = { ...list.games[gid], name: 'Sigga Jumps', savedAt: Date.now() + 1000 };
    });
    await gs.getByRole('button', { name: 'Close' }).first().click();
    await cp2.getByTestId('project-menu').click();
    await cp2.getByTestId('menu-gamesite-view').click();
    const site = cp2.getByTestId('gamesite');
    await check(async () => (await site.getByTestId('gamesite-game').count()) === 2 && (await site.getByTestId('gamesite-game-name').allInnerTexts()).join() === 'Sigga Jumps,Mole Mine', "View PXLGameSite lists everyone's games, newest first, each with its name");
    await check(async () => (await site.locator('.gs-shot[src^="data:image/png"]').count()) === 2 && (await site.getByTestId('gamesite-game').first().innerText()).includes('Sigga') && (await site.getByTestId('gamesite-game').nth(1).innerText()).includes('yours'), "with each game's picture and who made it");
    await cp2.waitForTimeout(400);
    await cp2.screenshot({ path: `${OUT}/40-gamesite.png` });
    await check(async () => (await site.getByTestId('gamesite-game').first().getByTestId('gamesite-game-remove').count()) === 0 && (await site.getByTestId('gamesite-game').nth(1).getByTestId('gamesite-game-remove').count()) === 1, 'only your own games can be removed');
    await site.getByTestId('gamesite-game-play').first().click();
    await check(async () => (await cp2.getByTestId('gamesite-play').count()) === 1 && (await cp2.getByTestId('gamesite-play').getByTestId('play-canvas').count()) === 1, 'a click on a game plays it');
    await cp2.keyboard.press('ArrowRight');
    await check(async () => (await cp2.getByTestId('viewport-canvas').count()) === 1 && (await cp2.getByTestId('tool-pen').getAttribute('aria-pressed')) !== 'true', '(its keys go to the game, not the editor)');
    await cp2.keyboard.press('Escape');
    await check(async () => (await cp2.getByTestId('gamesite-play').count()) === 0 && (await site.count()) === 1, 'Esc goes back to PXLGameSite');
    await site.getByTestId('gamesite-game').first().getByTestId('gamesite-game-copy').click();
    await check(async () => (await site.count()) === 0 && (await cp2.getByTestId('project-menu').innerText()).includes('Mole Mine'), "Open a copy opens the game in the editor (to change it as your own)");
    await cp2.getByTestId('project-menu').click();
    await cp2.getByTestId('menu-gamesite-view').click();
    await site.getByTestId('gamesite-game').nth(1).getByTestId('gamesite-game-remove').click();
    await site.getByTestId('gamesite-game-remove-confirm').click();
    await check(async () => (await site.getByTestId('gamesite-game').count()) === 1 && !(await cp2.evaluate(() => [...window.__docs.keys()].some((k) => k.startsWith('gamesite/user_a/')))), 'your own game can be taken off (its picture and file go too)');
    await site.getByRole('button', { name: 'Close' }).first().click();
  }
  {
    const h = JSON.parse(saves[0].text).aiHistory;
    await check(h?.entries?.some((e) => e.request === 'Give the player five hearts.' && e.status === 'applied') && h.entries.every((e) => !('trace' in e)), "the game file keeps this game's AI History (requests and answers, not the under-the-hood traces)");
  }
  {
    // Opened in another browser: the AI History comes back with the game.
    const oc = await browser.newContext({ viewport: { width: 1400, height: 860 } });
    const op = await oc.newPage();
    op.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
    await op.goto(URL);
    await startPlatformer(op);
    await op.getByTestId('open-file-input').setInputFiles({ name: 'mole-mine.pxlproj.json', mimeType: 'application/json', buffer: Buffer.from(saves[0].text) });
    await check(async () => (await op.getByTestId('project-menu').innerText()).includes('Mole Mine'), '(the saved game opens elsewhere)');
    await op.getByTestId('tray-toggle').click();
    await op.getByRole('tab', { name: /AI History/ }).click();
    await check(async () => (await op.getByTestId('history-list').getByTestId('history-exchange').filter({ hasText: 'Give the player five hearts.' }).count()) === 1, 'opening the saved game brings its AI History back');
    await oc.close();
  }
  await cc.close();

  step = 'save straight into the file (own page, Chrome/Edge)';
  {
    const fc = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const fp = await fc.newPage();
    fp.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
    // The browser's file pickers, as Chrome gives them to a page of its own: a handle the page writes into itself.
    await fp.addInitScript(() => {
      window.__files = { picked: 0, asked: 0, writes: [] };
      // (A file chosen in the Save picker may be written at once; one opened only after the browser asks.)
      const handle = (name, text, writable) => {
        let allowed = writable;
        const h = {
          name,
          text,
          getFile: async () => new File([h.text], name),
          queryPermission: async () => (allowed ? 'granted' : 'prompt'),
          requestPermission: async () => {
            window.__files.asked++;
            allowed = true;
            return 'granted';
          },
          createWritable: async () => ({
            write: async (blob) => {
              h.text = await blob.text();
              window.__files.writes.push(name);
            },
            close: async () => {},
          }),
        };
        return h;
      };
      window.showSaveFilePicker = async (o) => {
        window.__files.picked++;
        const h = handle(o.suggestedName, '', true);
        window.__files.last = h;
        return h;
      };
      window.showOpenFilePicker = async () => {
        window.__files.picked++;
        // The file saved before, opened again (as if from File Explorer).
        const h = handle('boulderdash.pxlproj.json', window.__files.last.text, false);
        window.__files.opened = h;
        return [h];
      };
    });
    await fp.goto(URL);
    await startPlatformer(fp);
    await fp.getByTestId('project-menu').click();
    await fp.getByTestId('menu-gamesite-view').click();
    await check(async () => (await fp.getByTestId('gamesite-unavailable').innerText()).includes('claude.ai'), 'outside claude.ai, PXLGameSite says where it is');
    await fp.keyboard.press('Escape');
    const files = () => fp.evaluate(() => ({ picked: window.__files.picked, asked: window.__files.asked, writes: window.__files.writes.join() }));
    await fp.getByTestId('save-button').click();
    await check(async () => (await files()).picked === 1 && (await files()).writes === 'untitled-game.pxlproj.json', 'the first Save asks where once, and writes the file there');
    await fp.getByTestId('save-button').click();
    await fp.keyboard.press('Control+s');
    await check(async () => (await files()).picked === 1 && (await files()).writes.split(',').length === 3, 'the next Saves write straight into the same file: no dialog at all');
    await fp.keyboard.press('Control+o');
    await check(async () => (await files()).picked === 2 && (await fp.locator('.dirty-dot').count()) === 0, 'Open (Ctrl+O) picks a file from the computer');
    await fp.getByTestId('save-button').click();
    await check(async () => {
      const f = await files();
      return f.picked === 2 && f.asked === 1 && f.writes.endsWith('boulderdash.pxlproj.json');
    }, 'Save writes back into the opened file (the browser asks once to allow it), no Save As dialog');
    await fp.getByTestId('save-button').click();
    await check(async () => {
      const f = await files();
      return f.asked === 1 && f.writes.split(',').filter((w) => w === 'boulderdash.pxlproj.json').length === 2;
    }, 'and after that, Save just writes it');
    await check(JSON.parse(await fp.evaluate(() => window.__files.opened.text)).kind === 'pxlbuilder.bundle', '(the file written is a whole game file)');
    await fc.close();
  }

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
  await startPlatformer(swp);
  const sw_sCanvas = swp.getByTestId('viewport-canvas');
  const sw_sBox = await sw_sCanvas.boundingBox();
  const sw_sAt = (wx, wy) => ({ x: sw_sBox.x + sw_sBox.width / 2 + wx, y: sw_sBox.y + sw_sBox.height / 2 + wy });
  const sw_sDrop = async (name, wx, wy) => {
    if ((await swp.getByTestId('library-panel').count()) === 0) await swp.getByTestId('dock-library').click();
    await swp.dragAndDrop(`[data-testid="definition-${name}"]`, '[data-testid="viewport-canvas"]', { targetPosition: { x: sw_sBox.width / 2 + wx, y: sw_sBox.height / 2 + wy } });
  };
  const sw_sPrompt = swp.getByTestId('context-prompt');
  const sw_sAsk = async (text) => {
    await openCard(swp, sw_sPrompt);
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
  // The switch (32x32 at -64,16) gets red connectors 18px outside its frame, left and right (past the box's side points).
  const sw_handle = sw_sAt(-64 + 16 + 18, 16);
  await swp.mouse.move(sw_handle.x, sw_handle.y);
  await swp.mouse.down();
  await swp.mouse.move(sw_sAt(0, 10).x, sw_sAt(0, 10).y, { steps: 4 });
  await swp.screenshot({ path: `${OUT}/22-connector-drag.png` });
  await swp.mouse.move(sw_sAt(64, 0).x, sw_sAt(64, 0).y, { steps: 4 });
  await swp.mouse.up();
  await check(async () => (await sw_sCanvas.getAttribute('data-connection')) !== '' && (await sw_sCanvas.getAttribute('data-links')) === '1', "dragging the switch's red connector onto the door connects them");
  await check(async () => (await swp.getByTestId('viewport-canvas').getAttribute('data-context')) === 'connection' && (await swp.getByTestId('ai-star').isVisible()), 'the new connection is selected, with the AI ✦ by it');
  await swp.getByTestId('ai-star').click();
  await check(async () => (await sw_sPrompt.getByTestId('connection-header').innerText()).replace(/\s+/g, ' ').includes('Switch → Door opens'), 'the ✦ opens its prompt: "Switch → Door", it opens');
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
  await check(async () => (await swp.getByTestId('viewport-canvas').getAttribute('data-context')) === 'connection', 'clicking the line selects the connection');
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
  await check(JSON.stringify(aiRequests.at(-1).context.targets[0].spriteGrid) === '{"width":32,"height":16}', 'the AI is told to draw 32×16 pixels for the one-tile 32×16 hazard (its proportions)');
  await openDetailsOn(swp);
  await check(async () => (await swp.getByTestId('component-Sprite').innerText()).includes('Spikes'), 'the hazard now uses the drawn "Spikes" image (its size is unchanged)');
  await swp.getByTestId('close-details').click();
  await swp.screenshot({ path: `${OUT}/25-spikes-sprite.png`, clip: { x: sw_sAt(-260, -260).x, y: sw_sAt(-260, -260).y, width: 520, height: 320 } });
  {
    // A tinted picture: drawn in white and grays, shown in the Sprite color (one picture serves every color).
    await swp.mouse.click(sw_sAt(-150, -150).x, sw_sAt(-150, -150).y);
    await sw_sAsk('Make it a tinted red brick.');
    await changeObject(sw_sPrompt);
    await check(async () => (await sw_sPrompt.getByTestId('prompt-result').getAttribute('data-status')) === 'applied', '"a tinted red brick" draws a gray picture and turns tint on');
    await swp.keyboard.press('Escape');
    const pixel = async (wx, wy) =>
      swp.evaluate(({ x, y }) => {
        const c = document.querySelector('[data-testid="viewport-canvas"]');
        const r = c.getBoundingClientRect();
        const k = c.width / r.width;
        return [...c.getContext('2d').getImageData(Math.round((x - r.left) * k), Math.round((y - r.top) * k), 1, 1).data];
      }, sw_sAt(wx, wy));
    await swp.waitForTimeout(300);
    await swp.screenshot({ path: `${OUT}/25b-tinted-brick.png`, clip: { x: sw_sAt(-200, -190).x, y: sw_sAt(-200, -190).y, width: 100, height: 80 } });
    await check(async () => {
      const [r, g, b] = await pixel(-150, -150);
      return r > 200 && g < 60 && b < 60;
    }, 'on the level its white face shows in the Sprite color (red)');
  }
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
    anthropicCalls.at(-1).model = sent.model;
    anthropicCalls.at(-1).sent = sent;
    // The game data and the request come as two blocks (the first cached).
    const content = sent.messages[0].content;
    const text = typeof content === 'string' ? content : content.map((b) => b.text).join('');
    const context = JSON.parse(text.split('\n')[1]);
    const request = text.slice(text.lastIndexOf('REQUEST\n') + 8);
    // (The real API's strict format always has every field: needCode and starter are null unless used.)
    const out = { needCode: null, starter: null, ...stubModel({ context, request, history: [] }) };
    const usage = { input_tokens: 1000, output_tokens: 2000, cache_read_input_tokens: 25000, cache_creation_input_tokens: 0 };
    if (!sent.stream) return json(200, { id: 'msg_test', type: 'message', role: 'assistant', model: sent.model, content: [{ type: 'text', text: JSON.stringify(out) }], stop_reason: 'end_turn', stop_sequence: null, usage });
    // Streamed (as the app asks): the server-sent events the API sends.
    anthropicCalls.at(-1).streamed = true;
    const ev = (type, data) => `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`;
    const body = [
      ev('message_start', { message: { id: 'msg_test', type: 'message', role: 'assistant', model: sent.model, content: [], stop_reason: null, stop_sequence: null, usage: { ...usage, output_tokens: 1 } } }),
      ev('content_block_start', { index: 0, content_block: { type: 'text', text: '' } }),
      ev('content_block_delta', { index: 0, delta: { type: 'text_delta', text: JSON.stringify(out) } }),
      ev('content_block_stop', { index: 0 }),
      ev('message_delta', { delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: usage.output_tokens } }),
      ev('message_stop', {}),
    ].join('');
    return route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'text/event-stream' }, body });
  });
  await kp.goto(URL);
  await startPlatformer(kp);
  const kCanvas = kp.getByTestId('viewport-canvas');
  const kBox = await kCanvas.boundingBox();
  const kAt = (wx, wy) => ({ x: kBox.x + kBox.width / 2 + wx, y: kBox.y + kBox.height / 2 + wy });
  const kPrompt = kp.getByTestId('context-prompt');
  const kAsk = async (text) => {
    await openCard(kp, kPrompt);
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
  await check(async () => (await dialog.getByTestId('ai-model-claude-opus-5-5').getAttribute('aria-checked')) === 'true' && (await dialog.getByTestId('ai-model-hint').innerText()).includes('$4 per million tokens in, $20 out'), 'with a key, a model choice: Opus by default, with its price');
  await kp.keyboard.press('Escape');

  await kp.mouse.click(kAt(-200, -150).x, kAt(-200, -150).y);
  const serverBefore = serverCalls;
  await kAsk('The player kills mushroom-enemies by jumping on top of them, but other enemies cannot be killed that way.');
  await check(async () => (await kPrompt.getByTestId('prompt-result').getAttribute('data-status')) === 'message' && (await kPrompt.getByTestId('prompt-result').innerText()).includes("There's no mushroom enemy"), 'the AI instructs the user when what they describe does not exist yet');
  await check(serverCalls === serverBefore && anthropicCalls.at(-1).key === VALID && anthropicCalls.at(-1).url.includes('/v1/messages'), 'prompts use the user key, not the server');
  await check(anthropicCalls.at(-1).streamed === true && anthropicCalls.at(-1).sent.max_tokens === 64000, '(streamed, with room for long answers: 64,000 tokens)');
  {
    const sent = anthropicCalls.at(-1).sent;
    await check(anthropicCalls.at(-1).model === 'claude-opus-5-5' && sent.system.at(-1).cache_control?.ttl === '1h' && sent.system.at(-1).text.startsWith('EDITOR SETTINGS') && sent.messages[0].content[0].cache_control?.type === 'ephemeral', 'Opus by default; the system prompt is cached for an hour and the game data for the request');
    // Each request's cost, from the token counts the API reported: Opus, 1,000 in + 25,000 from cache + 2,000 out = $0.054.
    await kp.keyboard.press('Escape');
    await kp.getByTestId('console-toggle').click();
    await check(async () => (await kp.getByTestId('console').innerText()).includes('AI request: $0.054 (claude-opus-5-5: 26,000 tokens in (25,000 from cache) · 2,000 out)'), 'the console says what the request cost ($0.054), worked out from the reported tokens');
    await kp.getByTestId('tray').getByRole('button', { name: 'Close' }).click();
    // A cheaper model, chosen in AI connection, is the one asked.
    await kp.getByTestId('main-menu').click();
    await kp.getByTestId('menu-ai-connection').click();
    await dialog.getByTestId('ai-model-claude-haiku-5-5').click();
    await check(async () => (await dialog.getByTestId('ai-model-hint').innerText()).includes('$0.1 per million tokens in') && (await dialog.getByTestId('ai-spend').innerText()).includes('$0.054 this session (1 request)'), 'choosing Haiku shows its price, and what has been spent so far');
    await kp.keyboard.press('Escape');
    await kp.mouse.click(kAt(-200, -150).x, kAt(-200, -150).y);
    await kAsk('Make the player faster.');
    await kPrompt.getByTestId('prompt-result').waitFor();
    await check(async () => anthropicCalls.at(-1).model === 'claude-haiku-5-5', 'the next prompt asks Haiku');
    // The AI selector next to the prompt: says which AI answers, and switches it there.
    const picker = kPrompt.getByTestId('ai-picker');
    await check(async () => (await picker.innerText()).trim() === 'Haiku', 'the AI selector by the prompt shows the AI answering (Haiku)');
    await picker.click();
    const pm = kp.getByTestId('ai-picker-menu');
    await check(
      async () => (await pm.getByTestId('pick-claude-haiku-5-5').getAttribute('aria-checked')) === 'true' && (await pm.innerText()).includes('Claude Opus 5.5') && (await pm.innerText()).includes('Claude Sonnet 5.5') && (await pm.getByTestId('pick-add-gemini-key').count()) === 1,
      'it lists Opus, Sonnet and Haiku for the Anthropic key (Haiku ticked), and offers to add a Gemini key',
    );
    await pm.getByTestId('pick-claude-opus-5-5').click();
    await check(async () => (await picker.innerText()).trim() === 'Opus' && (await pm.count()) === 0, 'choosing Opus there switches to it (and closes the list)');
    await kp.keyboard.press('Escape');
  }
  await kp.keyboard.press('Escape');
  await kp.getByTestId('dock-create').click();
  const kCreate = kp.getByTestId('create-prompt');
  await kCreate.getByTestId('prompt-input').fill('Create a mushroom enemy.');
  await kCreate.getByTestId('prompt-input').press('Enter');
  await kCreate.locator('[data-testid="prompt-result"][data-status="applied"]').waitFor();
  await kp.keyboard.press('Escape');
  await kDrop('Mushroom', 0, -150);
  await kDrop('Mushroom', 100, -150);
  await kDrop('Enemy', 200, -150);
  await kp.mouse.click(kAt(-200, -150).x, kAt(-200, -150).y);
  await kAsk('The player kills mushroom-enemies by jumping on top of them, but other enemies cannot be killed that way.');
  await changeObject(kPrompt);
  await check(async () => (await kPrompt.getByTestId('result-as-new').count()) === 1, 'asked on the player, the change goes to the Mushroom object (which could become a new object instead)');
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
  await check(async () => (await dialog.getByTestId('gemini-model').locator('option').allInnerTexts()).join() === 'gemini-3.8-flash,gemini-3.7-flash,gemini-3.6-flash,gemini-3.5-flash,gemini-3.5-flash-lite,gemini-3.8-flash-lite,gemini-3.5-pro', 'the Flash models are always offered (3.8 to 3.5, and 3.5 Lite), then the others the key can use (no embedding models)');
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
  // The AI selector with a Gemini key: the models that key can use (Google's list), the chosen one ticked.
  {
    await kp.mouse.click(kAt(-200, -150).x, kAt(-200, -150).y);
    const picker = kPrompt.getByTestId('ai-picker');
    await check(async () => (await picker.innerText()).trim() === '3.8 Flash', 'the AI selector shows Gemini 3.8 Flash');
    await picker.click();
    const pm = kp.getByTestId('ai-picker-menu');
    await check(async () => (await pm.getByTestId('pick-gemini-3.8-flash').getAttribute('aria-checked')) === 'true' && (await pm.getByTestId('pick-gemini-3.5-pro').count()) === 1, "with a Gemini key it lists that key's Gemini models (3.5 Pro among them), 3.8 Flash ticked");
    await kp.screenshot({ path: `${OUT}/31b-ai-picker.png` });
    await pm.getByTestId('pick-gemini-3.5-pro').click();
    await check(async () => (await picker.innerText()).trim() === '3.5 Pro', 'picking Gemini 3.5 Pro there switches to it');
    await kAsk('Make the gravity a bit weaker.');
    await check(async () => googleCalls.at(-1).url.includes('/gemini-3.5-pro:'), 'and the next prompt asks it');
    await kp.keyboard.press('Escape');
  }
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
  await startPlatformer(gp);
  const gCanvas = gp.getByTestId('viewport-canvas');
  const gBox = await gCanvas.boundingBox();
  const gAt = (wx, wy) => ({ x: gBox.x + gBox.width / 2 + wx, y: gBox.y + gBox.height / 2 + wy });
  const gPrompt = gp.getByTestId('context-prompt');
  const gAsk = async (text) => {
    await openCard(gp, gPrompt);
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
  await check(aiRequests.at(-1).reference?.includes('- jumpHeight ('), 'the AI knows which values can be shown (in the fixed reference sent with its instructions)');
  await gp.screenshot({ path: `${OUT}/18-jump-overlay.png` });
  await gPrompt.getByTestId('result-undo').click();
  await check(async () => (await gCanvas.getAttribute('data-overlays')) === '0', 'Undo removes the overlay (editor undo)');
  await gAsk('Show the jump height above the player.');
  await check(async () => (await gCanvas.getAttribute('data-overlays')) === '1', '(shown again)');
  await gp.keyboard.press('Escape');

  const empty = gAt(300, -200);
  await gp.mouse.dblclick(empty.x, empty.y);
  await check(async () => (await gp.getByTestId('viewport-canvas').getAttribute('data-context')) === 'level', 'double-clicking empty space gives the level prompt');
  const before = Number(await gCanvas.getAttribute('data-entities'));
  await gAsk('Generate a hard level with spikes, enemies and teleporters.');
  await check(async () => (await gPrompt.getByTestId('prompt-result').getAttribute('data-status')) === 'applied', 'level generation is applied at once (Undo takes it back)');
  await check(async () => Number(await gCanvas.getAttribute('data-entities')) > 30, 'the generated level is drawn for real');
  await gp.waitForTimeout(300);
  await gp.screenshot({ path: `${OUT}/19-level-preview.png` });
  await check(async () => (await gPrompt.getByTestId('prompt-result').locator('.changes li').count()) === 6 && (await gPrompt.getByTestId('result-more').innerText()) === '+3 more', 'a long list shows the first five changes and "+3 more"');
  await gPrompt.getByTestId('result-more').click();
  const resultDialog = gp.getByTestId('result-dialog');
  await check(async () => (await resultDialog.isVisible()) && (await resultDialog.locator('.changes li').count()) === 8 && (await resultDialog.innerText()).includes('You asked:'), '"+3 more" opens a dialog with every change');
  await gp.waitForTimeout(300);
  await gp.screenshot({ path: `${OUT}/19b-result-dialog.png` });
  await gp.keyboard.press('Escape');
  await check(async () => (await resultDialog.count()) === 0 && (await gPrompt.getByTestId('prompt-result').getAttribute('data-status')) === 'applied', 'Esc closes the dialog; the result stays on the card');
  await gPrompt.getByTestId('prompt-close').click();
  await check(async () => Number(await gCanvas.getAttribute('data-entities')) > 30, 'closing the card keeps the level (nothing is lost)');
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
  await startPlatformer(dp);
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
    await check(async () => (await lp.getByTestId('prompt-result').getAttribute('data-status')) === 'applied', '✦ Fix asks the AI and applies its fix');
    await check(aiRequests.at(-1).request.startsWith('Fix this problem: Door only opens'), 'the AI is told exactly which problem to fix');
    await check(async () => (await dp.getByTestId('problem-count').count()) === 0, 'after the fix the problem is gone');
    await check(async () => (await panel.innerText()).includes('the game changed since'), 'the last play is marked as older than the game now');

    if ((await lp.count()) === 0) await dp.getByTestId('global-prompt-toggle').click();
    await lAsk('Put a coin up high');
    await check(async () => (await lp.getByTestId('prompt-result').getAttribute('data-status')) === 'applied', 'a level change the player could not finish is sent back and comes back fixed');
    await check(aiRequests.at(-1).request.includes("could not be applied: The player can't get to Coin from where it starts"), "the AI is told exactly what can't be reached, with the player's jump limits");
    await check(aiRequests.at(-1).request.includes('The level after your previous answer would look like this') && /\nr\s*-?\d+ [.#_xPkcDHSE=o^]+/.test(aiRequests.at(-1).request), '…and shown the map of the level as its answer would have left it');
    await check(aiRequests.at(-1).context.level.map.rows.some((r) => r.includes('P')) && aiRequests.at(-1).context.level.map.legend._ !== undefined, 'the AI always gets the level map, with the spots the player can reach');
    const problemsBefore = await panel.getByTestId('problem').count();
    const entitiesBefore = Number(await dp.getByTestId('viewport-canvas').getAttribute('data-entities'));
    await lAsk('Build a route with a ladder');
    await check(async () => (await lp.getByTestId('prompt-result').getAttribute('data-status')) === 'applied' && Number(await dp.getByTestId('viewport-canvas').getAttribute('data-entities')) > entitiesBefore + 8, 'a level described as a route (run, jump, climb, put) is built by the app');
    await check(async () => (await panel.getByTestId('problem').count()) === problemsBefore, '…and it adds no problems: everything on it is reachable by construction');
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
  await startPlatformer(ep);
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
  await check(editorReq.context.scope === 'editor' && editorReq.context.editor.values.playButton === 'top' && editorReq.reference.includes('- playButton ('), 'the AI gets the editor settings (what they are, with its instructions) and their current values');
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

  step = 'phone';
  {
    const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
    const pp = await phone.newPage();
    pp.on('pageerror', (e) => errors.push(`pageerror (phone): ${e.message}`));
    await pp.goto(URL);
    await startPlatformer(pp);
    await pp.getByTestId('dock-library').click();
    const panel = pp.getByTestId('library-panel');
    await check(async () => (await panel.isVisible()) && (await panel.boundingBox()).height <= 844 * 0.4, 'on a phone the Objects panel takes at most about a third of the screen');
    const tiles = panel.locator('.tile');
    await check(async () => {
      const ys = await tiles.evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().top)));
      return ys.filter((y) => y === ys[0]).length >= 5;
    }, 'objects are small tiles, at least five to a row');
    await check(async () => {
      const list = await panel.locator('.category-list').boundingBox();
      return list.height < 50 && list.width > 300;
    }, 'the groups are one row of chips above the objects, not a column');
    await check(async () => {
      const p = await panel.boundingBox();
      const chips = await pp.locator('.tray-chips').boundingBox();
      // Whatever overlaps, the panel is on top: the element at the panel's bottom right corner belongs to the panel.
      return await pp.evaluate(([x, y]) => !!document.elementFromPoint(x, y)?.closest('[data-testid="library-panel"]'), [p.x + p.width - 20, p.y + p.height - 12]) || !chips;
    }, 'the History/Console buttons do not cover the open panel');
    await pp.screenshot({ path: `${OUT}/30-phone-objects.png` });
    await pp.getByTestId('groups-toggle').click();
    await check(async () => (await panel.locator('.category-list').count()) === 0 || !(await panel.locator('.category-list').isVisible()), 'the Groups button hides the groups');
    await pp.screenshot({ path: `${OUT}/30b-phone-objects-no-groups.png` });
    await pp.reload();
    await pp.getByTestId('dock-library').click();
    await check(async () => (await pp.getByTestId('groups-toggle').getAttribute('aria-expanded')) === 'false', 'and that is remembered');
    await phone.close();
  }

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
