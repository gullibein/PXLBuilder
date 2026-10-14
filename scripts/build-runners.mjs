/**
 * Puts the desktop runners (runner/dist, built on Windows and macOS by .github/workflows/desktop-runners.yml)
 * into the editor as src/core/export/runners.generated.ts, for "Export for Windows / macOS". Without
 * runner/dist (not built yet) it writes nothing and those exports are not offered.
 */
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';

const out = 'src/core/export/runners.generated.ts';
const mac = 'runner/dist/macos/Game.app/Contents';
const win = 'runner/dist/windows/Game.exe';
if (!existsSync(`${mac}/MacOS/Game`) || !existsSync(win)) {
  rmSync(out, { force: true });
  console.log('Desktop runners: not built yet (runner/dist), desktop exports left out');
} else {
  const b64 = (p) => readFileSync(p).toString('base64');
  const text = (p) => readFileSync(p, 'utf8');
  const runners = {
    source: existsSync('runner/dist/SOURCE') ? text('runner/dist/SOURCE').trim() : '',
    windowsExe: b64(win),
    mac: {
      infoPlist: text(`${mac}/Info.plist`),
      codeResources: text(`${mac}/_CodeSignature/CodeResources`),
      placeholder: b64(`${mac}/Resources/game.html`),
      executable: b64(`${mac}/MacOS/Game`),
    },
  };
  writeFileSync(out, `// Made by scripts/build-runners.mjs from runner/dist: the desktop game runners.\nexport const RUNNERS = ${JSON.stringify(runners)};\n`);
  console.log(`Desktop runners: Windows ${Math.round(readFileSync(win).length / 1024)} KB, macOS ${Math.round(readFileSync(`${mac}/MacOS/Game`).length / 1024)} KB`);
}
