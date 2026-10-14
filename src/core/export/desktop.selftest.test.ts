/**
 * The desktop exports, for real: run by .github/workflows/desktop-runners.yml on a Windows and a macOS machine
 * (PXL_DESKTOP_TEST=windows|macos, PXL_RUNNERS=<the runners just built>). A game is exported the way the editor
 * does it, unzipped the way a player's computer does it, its macOS seal checked by codesign, and started in the
 * runner's self-test mode, which reports whether the game came up. Skipped anywhere else.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { produce } from 'immer';
import { describe, expect, it } from 'vitest';
import { createBuiltinRegistry } from '../components/builtin';
import { createProject, instantiateDefinition } from '../model/factory';
import * as m from '../model/mutations';
import { macZip, programName, windowsZip } from './desktop';
import { gamePageFrom } from './gamePage';

const target = process.env.PXL_DESKTOP_TEST;
const runners = process.env.PXL_RUNNERS ?? 'runner/dist';

function game(): { name: string; html: string } {
  const registry = createBuiltinRegistry();
  const name = 'Mole Mine: Ünïcode & "quotes"';
  const project = produce(createProject(registry, name), (d) => {
    const sceneId = d.scenes[0].id;
    m.addEntity(d, sceneId, instantiateDefinition(d.definitions.find((x) => x.name === 'Player')!, { x: 0, y: -16 }));
  });
  // The player page as scripts/build-player.mjs wrote it ("export const PLAYER_TEMPLATE = "…";").
  const module = readFileSync('src/player/template.generated.ts', 'utf8');
  const template = JSON.parse(module.slice(module.indexOf('= ') + 2, module.lastIndexOf(';')));
  return { name, html: gamePageFrom(template, project) };
}

function run(cmd: string, args: string[], env: Record<string, string> = {}) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', timeout: 120000, env: { ...process.env, ...env } });
  console.log(`$ ${cmd} ${args.join(' ')}\n${r.stdout ?? ''}${r.stderr ?? ''}`);
  return r;
}

describe.runIf(!!target)('desktop export on a real machine', () => {
  it(`a game exported for ${target} unzips, (macOS: keeps a valid signature,) starts and plays`, async () => {
    const { name, html } = game();
    const dir = mkdtempSync(join(tmpdir(), 'pxl-desktop-'));
    const zipPath = join(dir, 'game.zip');
    const out = join(dir, 'unzipped');
    const result = join(dir, 'selftest.txt');
    const n = programName(name);
    expect(n).toBe('Mole Mine Ünïcode & quotes');
    if (target === 'macos') {
      const app = `${runners}/macos/Game.app/Contents`;
      const zip = await macZip(name, html, {
        infoPlist: readFileSync(`${app}/Info.plist`, 'utf8'),
        codeResources: readFileSync(`${app}/_CodeSignature/CodeResources`, 'utf8'),
        placeholder: new Uint8Array(readFileSync(`${app}/Resources/game.html`)),
        executable: new Uint8Array(readFileSync(`${app}/MacOS/Game`)),
      });
      writeFileSync(zipPath, zip);
      // Opened as Finder's Archive Utility does it (ditto keeps the permissions in the zip).
      expect(run('ditto', ['-x', '-k', zipPath, out]).status).toBe(0);
      const bundle = join(out, n, `${n}.app`);
      expect(run('codesign', ['--verify', '--strict', '--deep', '--verbose=4', bundle]).status).toBe(0);
      run('codesign', ['-d', '--verbose=4', bundle]);
      // What Gatekeeper says (an ad-hoc signed app is expected to need "Open Anyway" once): for the log.
      run('spctl', ['--assess', '--type', 'execute', '--verbose=4', bundle]);
      const r = run(join(bundle, 'Contents/MacOS/Game'), [], { PXL_SELFTEST: result });
      expect(r.status).toBe(0);
    } else {
      const zip = windowsZip(name, html, new Uint8Array(readFileSync(`${runners}/windows/Game.exe`)));
      writeFileSync(zipPath, zip);
      // Opened with Windows' own tar.exe (it reads zips; not Git's tar, which a bash step finds first).
      mkdirSync(out);
      expect(run(join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe'), ['-xf', zipPath, '-C', out]).status).toBe(0);
      const r = run(join(out, n, `${n}.exe`), [], { PXL_SELFTEST: result });
      expect(r.status).toBe(0);
    }
    expect(existsSync(result)).toBe(true);
    // (On Windows the page's message arrives as its JSON arguments: ["…"].)
    const raw = readFileSync(result, 'utf8');
    const report = raw.startsWith('[') ? (JSON.parse(raw) as string[])[0] : raw;
    console.log(`Self-test: ${report}`);
    expect(report).toMatch(/ok title=Mole Mine: Ünïcode & "quotes" pixels=\d+x\d+/);
  }, 180000);
});
