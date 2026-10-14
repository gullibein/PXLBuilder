import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { macZip, programName, windowsZip, type MacRunner } from './desktop';
import { crc32, makeZip } from './zip';

const enc = new TextEncoder();
const sha256 = async (b: Uint8Array) => new Uint8Array(await crypto.subtle.digest('SHA-256', b as BufferSource));
const b64 = async (algo: 'SHA-1' | 'SHA-256', b: Uint8Array) => Buffer.from(await crypto.subtle.digest(algo, b as BufferSource)).toString('base64');

/** A one-architecture Mach-O whose ad-hoc signature has one SHA-256 code directory with 5 special slots. */
async function fakeRunner(): Promise<MacRunner & { slotsAt: number }> {
  const infoPlist = '<plist><dict><key>CFBundleName</key><string>PXLGAMENAME</string></dict></plist>';
  const placeholder = enc.encode('PXL placeholder game\n');
  const codeResources = `<plist><dict><key>files</key><dict><key>Resources/game.html</key><data>${await b64('SHA-1', placeholder)}</data></dict><key>files2</key><dict><key>Resources/game.html</key><dict><key>hash</key><data>${await b64('SHA-1', placeholder)}</data><key>hash2</key><data>${await b64('SHA-256', placeholder)}</data></dict></dict></dict></plist>`;
  const bin = new Uint8Array(64 + 20 + 44 + 5 * 32 + 16);
  const v = new DataView(bin.buffer);
  v.setUint32(0, 0xfeedfacf, true);
  v.setUint32(16, 1, true); // one load command
  v.setUint32(32, 0x1d, true); // LC_CODE_SIGNATURE
  v.setUint32(36, 16, true);
  v.setUint32(40, 64, true);
  v.setUint32(44, bin.length - 64, true);
  v.setUint32(64, 0xfade0cc0, false);
  v.setUint32(68, bin.length - 64, false);
  v.setUint32(72, 1, false);
  v.setUint32(76, 0, false); // the code directory
  v.setUint32(80, 20, false);
  const cd = 84;
  v.setUint32(cd, 0xfade0c02, false);
  v.setUint32(cd + 16, 44 + 5 * 32, false); // hashOffset
  v.setUint32(cd + 24, 5, false); // special slots
  v.setUint8(cd + 36, 32);
  v.setUint8(cd + 37, 2); // SHA-256
  const slotsAt = cd + 44 + 5 * 32;
  bin.set(await sha256(enc.encode(infoPlist)), slotsAt - 1 * 32);
  bin.set(await sha256(enc.encode(codeResources)), slotsAt - 3 * 32);
  bin.set(enc.encode('code'), bin.length - 4);
  return { infoPlist, codeResources, placeholder, executable: bin, slotsAt };
}

/** The zip's files as Python's zipfile reads them: name, size, Unix mode. */
function listZip(zip: Uint8Array): { name: string; size: number; mode: number; data: string }[] {
  const dir = mkdtempSync(join(tmpdir(), 'pxl-zip-'));
  writeFileSync(join(dir, 'a.zip'), zip);
  const py = `import zipfile,json,sys,base64\nz=zipfile.ZipFile(sys.argv[1])\nassert z.testzip() is None\nprint(json.dumps([{'name':i.filename,'size':i.file_size,'mode':i.external_attr>>16,'data':base64.b64encode(z.read(i)).decode()} for i in z.infolist()]))`;
  return JSON.parse(execFileSync('python3', ['-c', py, join(dir, 'a.zip')], { encoding: 'utf8' }));
}

describe('desktop exports', () => {
  it('names that work as Windows and macOS file names', () => {
    expect(programName('Mole Mine: Level 1?')).toBe('Mole Mine Level 1');
    expect(programName('  ...  ')).toBe('Game');
    expect(programName('CON')).toBe('Game');
    expect(programName('Ünïcode <3')).toBe('Ünïcode 3');
  });

  it('zips that standard tools read, with the CRC, UTF-8 names and a runnable program', () => {
    expect(crc32(enc.encode('123456789'))).toBe(0xcbf43926);
    const files = listZip(makeZip([{ path: 'Ünï/' }, { path: 'Ünï/run', data: enc.encode('#!/bin/sh'), executable: true }, { path: 'Ünï/a.txt', data: enc.encode('hi') }]));
    expect(files.map((f) => [f.name, f.size, (f.mode & 0o777).toString(8)])).toEqual([
      ['Ünï/', 0, '755'],
      ['Ünï/run', 9, '755'],
      ['Ünï/a.txt', 2, '644'],
    ]);
  });

  it('Windows: the program with the game beside it', () => {
    const files = listZip(windowsZip('Mole Mine', '<html>game</html>', enc.encode('MZ...')));
    expect(files.map((f) => f.name)).toEqual(['Mole Mine/', 'Mole Mine/Mole Mine.exe', 'Mole Mine/game.html', 'Mole Mine/How to play.txt']);
    expect(Buffer.from(files[2].data, 'base64').toString()).toBe('<html>game</html>');
  });

  it("macOS: the game in the app, its seal and the signature's hashes renewed for it (and nothing else changed)", async () => {
    const runner = await fakeRunner();
    const html = '<html>my game</html>';
    const files = listZip(await macZip('Mole & Mine', html, runner));
    const get = (end: string) => Buffer.from(files.find((f) => f.name.endsWith(end))!.data, 'base64');
    expect(files.map((f) => f.name)).toContain('Mole & Mine/Mole & Mine.app/Contents/MacOS/Game');
    expect((files.find((f) => f.name.endsWith('MacOS/Game'))!.mode & 0o777).toString(8)).toBe('755');
    expect(get('Resources/game.html').toString()).toBe(html);
    const info = new Uint8Array(get('Contents/Info.plist'));
    expect(Buffer.from(info).toString()).toContain('<string>Mole &amp; Mine</string>');
    const seal = new Uint8Array(get('_CodeSignature/CodeResources'));
    const sealText = Buffer.from(seal).toString();
    expect(sealText).toContain(await b64('SHA-256', enc.encode(html)));
    expect(sealText).toContain(await b64('SHA-1', enc.encode(html)));
    expect(sealText).not.toContain(await b64('SHA-256', runner.placeholder));
    const exe = new Uint8Array(get('MacOS/Game'));
    expect([...exe.subarray(runner.slotsAt - 32, runner.slotsAt)]).toEqual([...(await sha256(info))]);
    expect([...exe.subarray(runner.slotsAt - 96, runner.slotsAt - 64)]).toEqual([...(await sha256(seal))]);
    // Everything else in the program is as it was.
    const changed = [...exe].map((b, i) => (b !== runner.executable[i] ? i : -1)).filter((i) => i >= 0);
    expect(changed.every((i) => (i >= runner.slotsAt - 32 && i < runner.slotsAt) || (i >= runner.slotsAt - 96 && i < runner.slotsAt - 64))).toBe(true);
  });

  it('a runner whose signature does not match its files is refused rather than patched blindly', async () => {
    const runner = await fakeRunner();
    await expect(macZip('X', 'x', { ...runner, infoPlist: runner.infoPlist + ' ' })).rejects.toThrow(/does not match/);
  });
});
