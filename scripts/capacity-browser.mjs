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
      // The editor's view dragged about (Space + drag), for three seconds.
      const box = await canvas.boundingBox();
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.keyboard.down('Space');
      await page.mouse.down();
      await startFrames(page);
      const until = Date.now() + 3000;
      for (let i = 0; Date.now() < until; i++) await page.mouse.move(box.x + box.width / 2 + 200 * Math.sin(i / 5), box.y + box.height / 2 + 120 * Math.cos(i / 7));
      const dragged = await stopFrames(page);
      await page.mouse.up();
      await page.keyboard.up('Space');
      t = Date.now();
      await page.getByTestId('play').click();
      await page.getByTestId('play-canvas').waitFor({ timeout: 240000 });
      await page.waitForFunction(() => !!document.querySelector('[data-testid="play-canvas"]')?.getAttribute('data-camera'), null, { timeout: 240000 });
      const started = Date.now() - t;
      await startFrames(page);
      await page.waitForTimeout(3000);
      const still = await stopFrames(page);
      const cam0 = await page.getByTestId('play-canvas').getAttribute('data-camera');
      await page.keyboard.down('ArrowRight');
      await startFrames(page);
      await page.waitForTimeout(3000);
      const walking = await stopFrames(page);
      await page.keyboard.up('ArrowRight');
      const cam1 = await page.getByTestId('play-canvas').getAttribute('data-camera');
      say(`${f.replace('.pxlproj.json', '')}: ${things} things | opens in ${opened} ms | editor, view dragged: a frame ${show(dragged)} | play starts in ${started} ms | play, standing: a frame ${show(still)} | play, walking: a frame ${show(walking)} (camera ${cam0} -> ${cam1}) | errors: ${errors.length ? errors.join('; ') : 'none'}`);
    } catch (e) {
      say(`${f.replace('.pxlproj.json', '')}: ${things} things | FAILED: ${String(e).slice(0, 200)}`);
    }
    await ctx.close();
  }
} finally {
  await browser.close();
  server.kill();
}
