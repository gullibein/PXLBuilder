/**
 * V1.5a: recordings played again through the real request flow, with no network (docs/engine-architecture-proposal.md
 * §33). The answers come from "Save with history" files a person saved; no test here asks a model anything.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { createBuiltinRegistry } from '../core/components/builtin';
import { clearDiagnostics, type DiagnosticRequest } from '../editor/ai/diagnostics';
import { setAIProvider } from '../editor/ai/runPrompt';
import { caseById, gameWithABrokenBridge } from './cases';
import { holdsAKey, idsNow, readRecording, replay, spentOn, withIdsNow, type Recording } from './replay';
import { evaluate } from './report';

const registry = createBuiltinRegistry();
const BUILDS = 'docs/builds';
const recording = (name: string) => readRecording(name, readFileSync(`${BUILDS}/${name}.pxlproj.json`, 'utf8'));

afterEach(() => {
  setAIProvider(null);
  clearDiagnostics();
});

describe('recordings', () => {
  it('no saved build holds anything that looks like an API key', () => {
    const files = readdirSync(BUILDS).filter((f) => f.endsWith('.json'));
    expect(files.length).toBeGreaterThanOrEqual(6);
    for (const f of files) expect(holdsAKey(readFileSync(`${BUILDS}/${f}`, 'utf8')), f).toBe(false);
    expect(holdsAKey('x sk-ant-api03-AbCdEf123456_xyz')).toBe(true);
  });

  it('a file saved with its history is a recording; one saved after the page was loaded again holds no answers in full', () => {
    expect(recording('pinball.with-history').requests).toHaveLength(3);
    expect(recording('crime-city.with-history').requests).toHaveLength(4);
    // (These two were saved in a later visit: the short traces of the AI History only. They cannot be replayed.)
    expect(recording('card-game.with-history').requests).toHaveLength(0);
    expect(recording('dash-platformer.with-history').requests).toHaveLength(0);
    expect(() => readRecording('chess', readFileSync(`${BUILDS}/chess.pxlproj.json`, 'utf8'))).toThrow(/not saved with its history/);
  });

  it('what a build cost is read in one form from each request\'s own note: tokens in and out, the price, the time; unknown where the connection said none', () => {
    const pinball = recording('pinball.with-history');
    expect(spentOn(pinball.requests, pinball.model)).toEqual({ requests: 4, retries: 1, tokensIn: 313864, tokensOut: 69156, usd: 2.728, seconds: expect.closeTo(626.1, 0), model: 'claude-opus-5-5' });
    const silent = pinball.requests.map((r) => ({ ...r, steps: r.steps.filter((s) => !/This request:/.test(s.text)) }));
    expect(spentOn(silent, 'some-model')).toMatchObject({ requests: 4, tokensIn: null, tokensOut: null, usd: null });
  });

  it('an answer\'s ids are replaced by those the same things have now: by an object\'s name, a level\'s place', () => {
    const was = { level: { id: 'scn_aaaaaaaa1111' }, library: [{ id: 'def_aaaaaaaa0001', name: 'Player', scripts: [] }, { id: 'def_aaaaaaaa0002', name: 'Wall', scripts: [{ id: 'scr_aaaaaaaa0003', name: 'Glow' }] }] };
    const now = { level: { id: 'scn_bbbbbbbb1111' }, library: [{ id: 'def_bbbbbbbb0002', name: 'Wall', scripts: [{ id: 'scr_bbbbbbbb0003', name: 'Glow' }] }, { id: 'def_bbbbbbbb0001', name: 'Player', scripts: [] }, { id: 'def_bbbbbbbb0009', name: 'New' }] };
    const map = idsNow(was, now);
    expect(Object.fromEntries(map)).toEqual({ scn_aaaaaaaa1111: 'scn_bbbbbbbb1111', def_aaaaaaaa0001: 'def_bbbbbbbb0001', def_aaaaaaaa0002: 'def_bbbbbbbb0002', scr_aaaaaaaa0003: 'scr_bbbbbbbb0003' });
    const answer = { operations: [{ op: 'rename', id: 'def_aaaaaaaa0002', name: 'Table wall' }, { op: 'set_world', sceneId: 'scn_aaaaaaaa1111' }, { op: 'x', id: 'def_cccccccc0000' }], message: 'the wall (def_aaaaaaaa0002)' };
    expect(withIdsNow(answer, map)).toEqual({ operations: [{ op: 'rename', id: 'def_bbbbbbbb0002', name: 'Table wall' }, { op: 'set_world', sceneId: 'scn_bbbbbbbb1111' }, { op: 'x', id: 'def_cccccccc0000' }], message: 'the wall (def_bbbbbbbb0002)' });
  });
});

describe('a recording played again through the real request flow', () => {
  it('the pinball build: three requests as they went (one refused answer, two parts, one change), and the table that results judged', async () => {
    const rec = recording('pinball.with-history');
    const r = await replay(rec);
    expect(r.requests.map((q) => [q.now, q.then, q.answersUsed, q.answersRecorded])).toEqual([
      ['error', 'error', 1, 1],
      ['applied', 'applied', 2, 2],
      ['applied', 'applied', 1, 1],
    ]);
    expect(r.differs).toEqual([]);
    // The same table as the one saved: its level and its objects.
    expect(r.project.scenes.map((s) => s.entities.length)).toEqual([193]);
    expect(r.project.definitions.some((d) => /flipper/i.test(d.name))).toBe(true);
    // Built: applied in the end, but not at the first asking, and an answer was refused (kept by no one: recorded
    // before refused answers were kept).
    expect(r.built.map((c) => [c.what, c.verdict])).toEqual([
      ['The request ended with the game applied, whole', 'pass'],
      ['It was built at the first asking', 'fail'],
      ['No answer was refused, cut off or lost on the way', 'fail'],
      ['Nothing the answers held was left out', 'pass'],
      ['The replay went as the recording did', 'pass'],
    ]);
    expect(r.built[2].why).toMatch(/1 answer could not be used: The AI's answer was not in the expected form.*nothing of them was kept/);
    const report = evaluate(caseById('pinball'), r.project, registry, { source: 'a recording replayed', built: r.built, operations: r.operations, spent: r.spent });
    expect(report.layers).toEqual({ built: 'fail', shape: 'pass', runs: 'pass', plays: 'fail', load: 'pass' });
    expect(report.checks.find((c) => /turning arm/.test(c.what))!.verdict).toBe('fail');
    expect(report.outcome).toBe('failed');
    expect(report.spent).toMatchObject({ usd: 2.728, requests: 4, retries: 1 });
  }, 180_000);

  it('the crime city: four requests, seven answers (a starter chosen, a fix asked for, code asked for), each ending as it did', async () => {
    const r = await replay(recording('crime-city.with-history'));
    expect(r.requests.map((q) => [q.now, q.then, q.answersUsed, q.answersRecorded])).toEqual([
      ['applied', 'applied', 3, 3],
      ['applied', 'applied', 2, 2],
      ['applied', 'applied', 1, 1],
      ['applied', 'applied', 1, 1],
    ]);
    expect(r.differs).toEqual([]);
    expect(r.project.settings.gameType).toBe('topdown');
    expect(r.project.scenes.map((s) => s.entities.length)).toEqual([1672]);
    expect(r.spent).toMatchObject({ requests: 7, retries: 0, usd: 3.786 });
    // What the first build left out is still said (six parts of its second answer did not apply).
    expect(r.built.find((c) => /left out/.test(c.what))).toMatchObject({ verdict: 'fail', why: expect.stringMatching(/left out 6 part\(s\)/) });
  }, 180_000);
});

describe('failures no model can be ordered to make, as hand-made recordings: each is reported as not built, never as a game', () => {
  const sent = (request: string) => ({ request, speed: 'best', topics: [], context: {}, code: [], history: [], referenceChars: 0, pictures: [] });
  const made = (name: string, request: string, answers: DiagnosticRequest['exchanges'][number]['answer'][]): Recording => ({
    name,
    version: 'made by hand',
    model: null,
    requests: [{ time: 0, project: '', request, about: 'project', steps: [], exchanges: answers.map((answer) => ({ atMs: 0, tookMs: 0, sent: sent(request), answer })), outcome: null, tookMs: null }],
  });
  const judged = async (rec: Recording) => {
    const given = gameWithABrokenBridge(registry);
    const r = await replay(rec, given);
    const report = evaluate(caseById('edits'), r.project, registry, { source: rec.name, built: r.built, before: given, operations: r.operations });
    return { r, report };
  };

  it('an answer cut off at the length limit: an error, the game untouched, the cut-off text kept word for word', async () => {
    const raw = '{"kind":"preview","message":"The coin is now gold.","operations":[{"op":"draw_sprite","target":"definition","id":"def_';
    const { r, report } = await judged(made('cut off (made by hand)', 'make the coin gold', [{ error: 'The AI response was incomplete. Try a smaller request.', raw }]));
    expect(r.requests[0]).toMatchObject({ now: 'error', answersUsed: 1 });
    expect(r.project.definitions).toEqual(r.before.definitions);
    expect(r.diagnostics[0].exchanges[0].answer).toEqual({ error: 'The AI response was incomplete. Try a smaller request.', raw });
    expect(r.built[0]).toMatchObject({ verdict: 'fail', why: expect.stringMatching(/ended in an error: The AI response was incomplete/) });
    expect(r.built.find((c) => /refused, cut off or lost/.test(c.what))).toMatchObject({ verdict: 'fail', why: expect.stringMatching(/1 kept as the model sent it/) });
    expect(report.layers.built).toBe('fail');
    expect(report.outcome).toBe('failed');
  }, 120_000);

  it('a connection lost: an error, nothing arrived to keep', async () => {
    const { r, report } = await judged(made('lost connection (made by hand)', 'make the coin gold', [{ error: 'The connection to the AI was lost before the answer was complete.' }]));
    expect(r.requests[0].now).toBe('error');
    expect(r.built.find((c) => /refused, cut off or lost/.test(c.what))!.why).toMatch(/nothing of them was kept/);
    expect(report.outcome).toBe('failed');
  }, 120_000);

  it('a script past the limits, sent twice: left out and said first; what else the answer held is applied, and the case is still failed', async () => {
    const given = gameWithABrokenBridge(registry);
    const coin = given.definitions.find((d) => d.name === 'Coin')!;
    const handler = (n: number) => ({ when: { on: 'every', seconds: n + 1 }, do: [{ do: 'set', var: 'n', value: `n + ${n}` }] });
    const tooBig = { op: 'set_script', target: 'definition', id: coin.id, scriptJson: JSON.stringify({ name: 'Too much', vars: [{ name: 'n', value: 0 }], handlers: Array.from({ length: 400 }, (_, n) => handler(n)) }) };
    const gold = { op: 'set_component_field', target: 'definition', id: coin.id, component: 'Sprite', field: 'color', valueJson: '"#ffcc00"' };
    const answer = { kind: 'preview', message: 'Gold, and it counts.', changes: ['Coin: gold'], operations: [gold, tooBig], needCode: null, starter: null } as never;
    // (Sent back with the problem, the same comes again.)
    const rec = made('script past the limits (made by hand)', 'make the coin gold and count seconds on it', [answer, answer]);
    const r = await replay(rec, given);
    expect(r.requests[0].answersUsed).toBe(2);
    // The coin is gold; the script is not on it; and that is said.
    const now = r.project.definitions.find((d) => d.id === coin.id)!;
    expect((now.components.Sprite as { color: string }).color).toBe('#ffcc00');
    expect((now.scripts ?? []).some((s) => s.name === 'Too much')).toBe(false);
    expect(r.built.find((c) => /left out/.test(c.what))).toMatchObject({ verdict: 'fail', why: expect.stringMatching(/left out/) });
    const first = r.requests[0].message.split('\n')[0];
    expect(r.requests[0].now).toBe('applied');
    expect(first).toMatch(/Part of this could not be applied/);
    const report = evaluate(caseById('edits'), r.project, registry, { source: rec.name, built: r.built, before: given, operations: r.operations });
    expect(report.layers.built).toBe('fail');
    expect(report.outcome).toBe('failed');
  }, 120_000);

  it('a recording with fewer answers than the flow now asks for says so, and is not a built game', async () => {
    const given = gameWithABrokenBridge(registry);
    const coin = given.definitions.find((d) => d.name === 'Coin')!;
    // (An answer the flow sends back: a change to a thing that is not there. The recording holds no second answer.)
    const answer = { kind: 'preview', message: 'Done.', changes: ['x'], operations: [{ op: 'rename', target: 'definition', id: 'def_000000000000', name: 'Nothing' }, { op: 'rename', target: 'definition', id: coin.id, name: 'Gold coin' }], needCode: null, starter: null } as never;
    const r = await replay(made('too few answers (made by hand)', 'rename the coin', [answer]), given);
    expect(r.differs.join(' ')).toMatch(/asked for one more|ended "error" now/);
    expect(r.built.find((c) => /went as the recording did/.test(c.what))!.verdict).toBe('fail');
  }, 120_000);
});
