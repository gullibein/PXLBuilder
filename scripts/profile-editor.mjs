/**
 * Measures how the editor keeps up with the mouse on a slow machine: opens a saved game in the built app
 * (run `npx vite build` first), slows the CPU down (default 6×, about a weak laptop on battery), moves the mouse
 * 60 times over the level and prints how long that took, the frame times, and where the time went.
 *
 *   node scripts/profile-editor.mjs <game.pxlproj.json> [slowdown]
 */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
const PORT = 4188;
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--port', String(PORT), '--strictPort'], { stdio: ['ignore', 'pipe', 'pipe'] });
await new Promise((r) => server.stdout.on('data', (d) => d.toString().includes(String(PORT)) && r()));
const browser = await chromium.launch({ executablePath: existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined });
const page = await browser.newPage({ viewport: { width: 1400, height: 860 } });
await page.goto(`http://localhost:${PORT}/`);
await page.getByTestId('viewport-canvas').waitFor();
if (await page.getByTestId('game-chooser').count()) await page.getByTestId('game-platformer').click();
await page.getByTestId('open-file-input').setInputFiles(process.argv[2]);
await page.waitForTimeout(1500);
const cdp = await page.context().newCDPSession(page);
await cdp.send('Emulation.setCPUThrottlingRate', { rate: Number(process.argv[3] ?? 6) });
// Frame times while moving the mouse.
await page.evaluate(() => {
  window.__frames = [];
  let last = performance.now();
  const tick = (t) => { window.__frames.push(t - last); last = t; requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
});
await cdp.send('Profiler.enable');
await cdp.send('Profiler.start');
const box = await page.getByTestId('viewport-canvas').boundingBox();
const t0 = Date.now();
for (let i = 0; i < 60; i++) await page.mouse.move(box.x + 300 + i * 8, box.y + 300 + (i % 10) * 5);
const moveMs = Date.now() - t0;
const { profile } = await cdp.send('Profiler.stop');
const frames = await page.evaluate(() => window.__frames.slice(5));
frames.sort((a, b) => a - b);
console.log('60 mouse moves took', moveMs, 'ms; frames', frames.length, 'median', frames[frames.length >> 1].toFixed(1), 'p90', frames[Math.floor(frames.length * 0.9)].toFixed(1));
// Self time per function.
const self = new Map();
const byId = new Map(profile.nodes.map((n) => [n.id, n]));
const dt = profile.timeDeltas; const samples = profile.samples;
for (let i = 0; i < samples.length; i++) {
  const n = byId.get(samples[i]); const k = `${n.callFrame.functionName || '(anon)'} ${n.callFrame.url.split('/').pop()}:${n.callFrame.lineNumber}`;
  self.set(k, (self.get(k) ?? 0) + (dt[i] ?? 0) / 1000);
}
console.log([...self].sort((a, b) => b[1] - a[1]).slice(0, 25).map(([k, v]) => `${v.toFixed(0).padStart(6)}ms ${k}`).join('\n'));
await browser.close();
server.kill();
