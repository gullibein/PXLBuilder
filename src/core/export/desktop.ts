/**
 * Games as desktop programs: the exported game page put into a copy of a runner (runner/src: a window with the
 * system's web view, built on real Windows and macOS machines by .github/workflows/desktop-runners.yml), as a zip.
 *
 * Windows: a folder with "<Game>.exe" and game.html next to it.
 * macOS: "<Game>.app". Its program carries an ad-hoc code signature that seals the app's Info.plist and its
 * resources (here: game.html, listed in _CodeSignature/CodeResources). Putting in another game would break that
 * seal (macOS then calls the app "damaged"), so it is re-sealed here: the game's hashes go into CodeResources, and
 * the hashes of the new CodeResources and Info.plist into the signature's code directories. The program's code
 * itself is unchanged, so nothing else in the signature changes. (An ad-hoc signature has no certificate: macOS
 * still asks the player once to allow an app from an unidentified developer.)
 */
import { makeZip, type ZipEntry } from './zip';

export interface MacRunner {
  /** Contents/Info.plist, with PXLGAMENAME where the game's name goes. */
  infoPlist: string;
  /** Contents/MacOS/Game, signed. */
  executable: Uint8Array;
  /** Contents/_CodeSignature/CodeResources as signed (sealing the placeholder game.html). */
  codeResources: string;
  /** Contents/Resources/game.html as signed. */
  placeholder: Uint8Array;
}

const enc = new TextEncoder();

async function digest(algo: 'SHA-1' | 'SHA-256', data: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest(algo, data as BufferSource));
}

function base64(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

/** A name that works as a file and folder name on Windows and macOS. */
export function programName(name: string): string {
  const clean = name
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+|[. ]+$/g, '');
  const reserved = /^(con|prn|aux|nul|com\d|lpt\d)$/i;
  return !clean || reserved.test(clean) ? 'Game' : clean.slice(0, 80);
}

const xml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]!);

const README_WINDOWS = (name: string) => `${name}

To play: double-click "${name}.exe". Keep game.html in the same folder: it is the game.

The first time, Windows may say "Windows protected your PC" (the program is not signed with a paid
certificate). Click "More info", then "Run anyway".

Keyboard: arrows or WASD move, Space jumps, E uses, X fires, R restarts. A game controller works too.
The game needs the Microsoft Edge WebView2 Runtime, which comes with Windows 10 and 11.
(You can also open game.html in any web browser.)
`;

const README_MAC = (name: string) => `${name}

To play: double-click "${name}".

The first time, macOS says it can't check the app for malicious software (it isn't signed by a registered
Apple developer). Click Done, then open System Settings -> Privacy & Security, scroll down and click
"Open Anyway" next to "${name}", and confirm. After that it opens normally.
(On macOS 14 and earlier: right-click the app, choose Open, then Open.)

Keyboard: arrows or WASD move, Space jumps, E uses, X fires, R restarts. A game controller works too.
Full screen: View -> Enter Full Screen (Control-Command-F).
`;

export function windowsZip(name: string, gameHtml: string, exe: Uint8Array): Uint8Array {
  const n = programName(name);
  return makeZip([
    { path: `${n}/` },
    { path: `${n}/${n}.exe`, data: exe, executable: true },
    { path: `${n}/game.html`, data: enc.encode(gameHtml) },
    { path: `${n}/How to play.txt`, data: enc.encode(README_WINDOWS(n).replace(/\n/g, '\r\n')) },
  ]);
}

// ---------------------------------------------------------------- macOS: re-sealing the ad-hoc signature

const CSMAGIC_EMBEDDED_SIGNATURE = 0xfade0cc0;
const CSMAGIC_CODEDIRECTORY = 0xfade0c02;
const LC_CODE_SIGNATURE = 0x1d;
const INFO_SLOT = 1;
const RESOURCES_SLOT = 3;

/** Where each architecture's signature is in a (universal or single) Mach-O program. */
function signatures(bin: Uint8Array): { offset: number; size: number }[] {
  const v = new DataView(bin.buffer, bin.byteOffset, bin.byteLength);
  const slices: number[] = [];
  if (v.getUint32(0, false) === 0xcafebabe) {
    const n = v.getUint32(4, false);
    for (let i = 0; i < n; i++) slices.push(v.getUint32(8 + i * 20 + 8, false));
  } else slices.push(0);
  return slices.map((start) => {
    if (v.getUint32(start, true) !== 0xfeedfacf) throw new Error('The macOS runner is not a 64-bit program');
    const ncmds = v.getUint32(start + 16, true);
    let at = start + 32;
    for (let i = 0; i < ncmds; i++) {
      const cmd = v.getUint32(at, true);
      if (cmd === LC_CODE_SIGNATURE) return { offset: start + v.getUint32(at + 8, true), size: v.getUint32(at + 12, true) };
      at += v.getUint32(at + 4, true);
    }
    throw new Error('The macOS runner is not signed');
  });
}

/**
 * Puts new hashes for Info.plist and the resources into every code directory of every architecture, after
 * checking that the ones there are those of the files as signed (so nothing else is ever overwritten).
 */
async function reseal(bin: Uint8Array, files: { slot: number; old: Uint8Array; now: Uint8Array }[]): Promise<Uint8Array> {
  const out = bin.slice();
  const v = new DataView(out.buffer);
  let patched = 0;
  for (const sig of signatures(out)) {
    if (v.getUint32(sig.offset, false) !== CSMAGIC_EMBEDDED_SIGNATURE) throw new Error('Unexpected code signature format');
    const count = v.getUint32(sig.offset + 8, false);
    for (let i = 0; i < count; i++) {
      const cd = sig.offset + v.getUint32(sig.offset + 12 + i * 8 + 4, false);
      if (v.getUint32(cd, false) !== CSMAGIC_CODEDIRECTORY) continue;
      const hashOffset = v.getUint32(cd + 16, false);
      const nSpecial = v.getUint32(cd + 24, false);
      const hashSize = v.getUint8(cd + 36);
      const hashType = v.getUint8(cd + 37);
      const algo = hashType === 1 && hashSize === 20 ? 'SHA-1' : hashType === 2 && hashSize === 32 ? 'SHA-256' : null;
      if (!algo) throw new Error(`Unsupported code signature hash (type ${hashType})`);
      for (const f of files) {
        if (f.slot > nSpecial) throw new Error('The runner signature does not seal its resources');
        const at = cd + hashOffset - f.slot * hashSize;
        const was = await digest(algo, f.old);
        if (!out.subarray(at, at + hashSize).every((b, k) => b === was[k])) throw new Error('The runner signature does not match its files');
        out.set(await digest(algo, f.now), at);
      }
      patched++;
    }
  }
  if (!patched) throw new Error('The runner signature has no code directory');
  return out;
}

export async function macZip(name: string, gameHtml: string, runner: MacRunner): Promise<Uint8Array> {
  const n = programName(name);
  const game = enc.encode(gameHtml);
  const info = enc.encode(runner.infoPlist.replace(/PXLGAMENAME/g, () => xml(n)));
  // The game's hashes in place of the placeholder's.
  let resources = runner.codeResources;
  for (const algo of ['SHA-1', 'SHA-256'] as const) {
    const was = base64(await digest(algo, runner.placeholder));
    if (!resources.includes(was)) throw new Error('The runner seal does not list its game');
    resources = resources.split(was).join(base64(await digest(algo, game)));
  }
  const resourcesBytes = enc.encode(resources);
  const executable = await reseal(runner.executable, [
    { slot: INFO_SLOT, old: enc.encode(runner.infoPlist), now: info },
    { slot: RESOURCES_SLOT, old: enc.encode(runner.codeResources), now: resourcesBytes },
  ]);
  const app = `${n}/${n}.app/Contents`;
  const entries: ZipEntry[] = [
    { path: `${n}/` },
    { path: `${n}/${n}.app/` },
    { path: `${app}/` },
    { path: `${app}/MacOS/` },
    { path: `${app}/MacOS/Game`, data: executable, executable: true },
    { path: `${app}/Info.plist`, data: info },
    { path: `${app}/Resources/` },
    { path: `${app}/Resources/game.html`, data: game },
    { path: `${app}/_CodeSignature/` },
    { path: `${app}/_CodeSignature/CodeResources`, data: resourcesBytes },
    { path: `${n}/How to open.txt`, data: enc.encode(README_MAC(n)) },
  ];
  return makeZip(entries);
}
