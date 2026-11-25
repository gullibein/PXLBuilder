// Records the "same answers" fingerprints (src/regression/sameAnswers.ts, docs §30 W0): the whole test suite is
// run three times with every runtime's play fingerprinted step by step; a test whose fingerprint is the same each time
// goes into src/regression/sameAnswers.golden.json, one that differs (it uses randomness with no seed) is left
// out and counted. Run before a change to the engine; afterwards `npm test` compares.
//   node scripts/same-answers.mjs            record
//   node scripts/same-answers.mjs --check    record again and compare with the file (nothing written)
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const GOLDEN = 'src/regression/sameAnswers.golden.json';
const check = process.argv.includes('--check');
const dir = mkdtempSync(join(tmpdir(), 'same-answers-'));
const run = (n) => {
  const file = join(dir, `run${n}.txt`);
  const r = spawnSync(process.execPath, ['node_modules/vitest/vitest.mjs', 'run'], { env: { ...process.env, SAME_ANSWERS_RECORD: file }, encoding: 'utf8', maxBuffer: 1 << 28 });
  const tests = /Tests\s+(.*)/.exec(r.stdout ?? '')?.[1] ?? '?';
  console.log(`run ${n}: ${tests.trim()}`);
  const out = new Map();
  if (existsSync(file)) for (const line of readFileSync(file, 'utf8').split('\n').filter(Boolean)) {
    const [key, print] = JSON.parse(line);
    // (A test name used twice in a file: both must agree, in order.)
    out.set(key, out.has(key) ? `${out.get(key)} + ${print}` : print);
  }
  return out;
};
// (Three times: a test with two outcomes by chance can come out the same twice.)
const a = run(1);
const others = [run(2), run(3)];
const stable = {};
const unstable = [];
for (const [key, print] of [...a.entries()].sort((x, y) => (x[0] < y[0] ? -1 : 1))) {
  if (others.every((b) => b.get(key) === print) && !print.includes(' + ')) stable[key] = print;
  else unstable.push(key);
}
const steps = Object.values(stable).reduce((n, p) => n + Number(/, (\d+) steps/.exec(p)?.[1] ?? 0), 0);
console.log(`${a.size} tests step a game; ${Object.keys(stable).length} gave the same fingerprint three times (${steps} steps of play in all); ${unstable.length} did not and are not compared`);
for (const k of unstable.slice(0, 40)) console.log(`  not compared: ${k}`);
if (check) {
  const was = JSON.parse(readFileSync(GOLDEN, 'utf8'));
  const changed = Object.keys(was).filter((k) => k in stable && stable[k] !== was[k]);
  const gone = Object.keys(was).filter((k) => !(k in stable));
  console.log(changed.length ? `CHANGED (${changed.length}):\n  ${changed.join('\n  ')}` : 'every fingerprint recorded before is the same now');
  if (gone.length) console.log(`no longer the same twice, or gone (${gone.length}):\n  ${gone.slice(0, 20).join('\n  ')}`);
  process.exit(changed.length ? 1 : 0);
}
writeFileSync(GOLDEN, `${JSON.stringify(stable, null, 1)}\n`);
console.log(`wrote ${GOLDEN}`);
