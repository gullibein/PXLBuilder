// Capacity in the real app (docs §30): for each saved world given, how long it takes to open, how long a frame
// takes in the editor while the view is dragged about, how long play takes to start, and how long a frame of play
// takes standing still and walking (the camera scrolling). Headless Chromium on this machine: numbers to compare
// before and after a change, not what a user's computer does.
//   npx vite build && node scripts/capacity-browser.mjs <dir of .pxlproj.json files> [report file]
import { spawn } from 'node:child_process';
import { appendFileSync, readdirSync, readFileSync } from 'node:fs';
import { chromium } from 'playwright';

const PORT = 4188;
const URL = `http://localhost:${PORT}/PXLBuilder/`;
const dir = process.argv[2];
const report = process.argv[3];
const say = (line) => {
  console.log(line);
  if (report) appendFileSync(report, `${line}\n`);
};
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 2500));
const browser = await chromium.launch();

/** Starts counting the page's frames; `stop` gives the middle and the worst frame time since. */
const startFrames = (page) =>
  page.evaluate(() => {
    const w = window;
    w.__frames = [];
    w.__counting = true;
    const tick = (t) => {
      w.__frames.push(t);
      if (w.__counting) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
const stopFrames = (page) =>
  page.evaluate(() => {
    const w = window;
    w.__counting = false;
    const d = w.__frames.slice(1).map((x, i) => x - w.__frames[i]).sort((a, b) => a - b);
    return { n: d.length, middle: d[Math.floor(d.length / 2)] ?? -1, worst: d.at(-1) ?? -1 };
  });
const show = (f) => (f.n < 2 ? `no frame in the time measured` : `${f.middle.toFixed(0)} ms (worst ${f.worst.toFixed(0)}, ${f.n} frames)`);

try {
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.pxlproj.json')).sort()) {
    const text = readFileSync(`${dir}/${f}`, 'utf8');
    const bundle = JSON.parse(text);
    const sc = bundle.files[Object.keys(bundle.files).find((k) => k.startsWith('scenes/'))];
    const things = (typeof sc === 'string' ? JSON.parse(sc) : sc).entities.length;
    const ctx = await browser.newContext({ viewport: { width: 1522, height: 696 }, deviceScaleFactor: 1.25 });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message.slice(0, 120)));
    try {
      await page.goto(URL);
      const canvas = page.getByTestId('viewport-canvas');
      await canvas.waitFor();
      if (await page.getByTestId('game-chooser').isVisible().catch(() => false)) await page.getByTestId('game-chooser-close').click();
      let t = Date.now();
      await page.getByTestId('open-file-input').setInputFiles({ name: f, mimeType: 'application/json', buffer: Buffer.from(text) });
      await page.waitForFunction((n) => Number(document.querySelector('[data-testid="viewport-canvas"]')?.getAttribute('data-entities')) === n, things, { timeout: 240000 });
      const opened = Date.now() - t;
      // (CAPACITY_SETTLE_MS: wait this long first. The level's check runs once, a moment after a level is opened or
      // changed, in one piece; without the wait it can fall inside the three seconds measured next.)
      if (process.env.CAPACITY_SETTLE_MS) await page.waitForTimeout(Number(process.env.CAPACITY_SETTLE_MS));
      // The editor's view dragged about (Space + drag), for three seconds.
      const box = await canvas.boundingBox();
      const view0 = await canvas.getAttribute('data-camera');
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.keyboard.down('Space');
      await page.mouse.down();
      await startFrames(page);
      const until = Date.now() + 3000;
      for (let i = 0; Date.now() < until; i++) await page.mouse.move(box.x + box.width / 2 + 200 * Math.sin(i / 5), box.y + box.height / 2 + 120 * Math.cos(i / 7));
      const dragged = await stopFrames(page);
      await page.mouse.up();
      await page.keyboard.up('Space');
      const view1 = await canvas.getAttribute('data-camera');
      // A tile drawn by hand (the first object of the library, the pen, one click; then a stroke across): how long
      // the editor takes to take it in and draw itself again.
      const settled = () => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
      const count = async () => Number(await canvas.getAttribute('data-entities'));
      let drawn = 'not measured';
      try {
        await page.getByTestId('dock-library').click();
        await page.locator('[data-testid^="definition-"]').first().click();
        const at = { x: box.x + box.width * 0.5, y: box.y + box.height * 0.5 };
        const n0 = await count();
        await page.mouse.move(at.x, at.y);
        let t1 = Date.now();
        await page.mouse.down();
        await page.mouse.up();
        await settled();
        const one = Date.now() - t1;
        const n1 = await count();
        await page.getByTestId('tool-pen').click().catch(() => {});
        await page.mouse.move(at.x + 40, at.y + 40);
        t1 = Date.now();
        await page.mouse.down();
        await page.mouse.move(at.x + 160, at.y + 40, { steps: 6 });
        await page.mouse.up();
        await settled();
        const stroke = Date.now() - t1;
        drawn = `one click ${one} ms (${n0} -> ${n1} things), a stroke ${stroke} ms (-> ${await count()})`;
        await page.getByTestId('tool-select').click().catch(() => {});
      } catch (e) {
        drawn = `failed: ${String(e).slice(0, 80)}`;
      }
      t = Date.now();
      await page.getByTestId('play').click();
      await page.getByTestId('play-canvas').waitFor({ timeout: 240000 });
      await page.waitForFunction(() => !!document.querySelector('[data-testid="play-canvas"]')?.getAttribute('data-camera'), null, { timeout: 240000 });
      const started = Date.now() - t;
      await startFrames(page);
      await page.waitForTimeout(3000);
      const still = await stopFrames(page);
      // Walking right: first until the camera has left the level's edge and scrolls (up to 10 s), then measured.
      const play = page.getByTestId('play-canvas');
      const camX = async () => Number(((await play.getAttribute('data-camera')) ?? '0').split(',')[0]);
      const who0 = await play.getAttribute('data-player');
      const cam0 = await camX();
      await page.keyboard.down('ArrowRight');
      const walkUntil = Date.now() + 10000;
      while (Date.now() < walkUntil && (await camX()) === cam0) await page.waitForTimeout(250);
      const camA = await camX();
      await startFrames(page);
      await page.waitForTimeout(3000);
      const walking = await stopFrames(page);
      await page.keyboard.up('ArrowRight');
      const camB = await camX();
      const who1 = await play.getAttribute('data-player');
      say(`${f.replace('.pxlproj.json', '')}: ${things} things | opens in ${opened} ms | editor, view dragged: a frame ${show(dragged)} (view ${view0} -> ${view1}) | drawn by hand: ${drawn} | play starts in ${started} ms | play, standing: a frame ${show(still)} | play, walking: a frame ${show(walking)}; the camera scrolled ${(camB - camA).toFixed(0)} px while measured (player ${who0?.split(',').slice(0, 2).join(',')} -> ${who1?.split(',').slice(0, 2).join(',')}) | errors: ${errors.length ? errors.join('; ') : 'none'}`);
    } catch (e) {
      say(`${f.replace('.pxlproj.json', '')}: ${things} things | FAILED: ${String(e).slice(0, 200)}`);
    }
    await ctx.close();
  }
} finally {
  await browser.close();
  server.kill();
}
