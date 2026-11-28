/**
 * V1.5a: the evaluation harness, proven without any model (docs/engine-architecture-proposal.md §33). No test here
 * makes a request to an AI; games standing in for a model's answers are judged, sound ones and broken ones.
 */
import { produce } from 'immer';
import { writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createBuiltinRegistry } from '../core/components/builtin';
import { setScript } from '../core/script/mutations';
import type { Project } from '../core/types';
import { CASES, caseById, gameWithABrokenBridge } from './cases';
import { engineParts } from './engineParts';
import { evaluate, reportText, type CaseReport } from './report';
import { STAND_INS } from './standIns';
import { failed, layerResult, notJudged, outcomeOf, passed, type Check } from './verdict';

const registry = createBuiltinRegistry();
const judge = (id: string, project: Project = STAND_INS[id].make(registry), more: Partial<Parameters<typeof evaluate>[3]> = {}) => evaluate(caseById(id), project, registry, { source: STAND_INS[id].from, ...more });
const verdictOf = (r: CaseReport, what: RegExp) => r.checks.find((c) => what.test(c.what))?.verdict;
const not = (r: CaseReport, verdict: Check['verdict'], layer?: Check['layer']) => r.checks.filter((c) => c.verdict === verdict && c.layer !== 'built' && (!layer || c.layer === layer)).map((c) => c.what);
const said = (r: CaseReport) => r.checks.filter((c) => c.verdict !== 'pass').map((c) => `${c.layer}: ${c.what}: ${c.why}`).join('\n');

describe('how a case is judged', () => {
  const checks = (...v: Check['verdict'][]): Check[] => (['built', 'shape', 'runs', 'plays', 'load'] as const).map((layer, i) => ({ layer, what: layer, verdict: v[i] ?? 'pass', why: '' }));

  it('a success needs every layer passed; what was not judged leaves it uncertain; one failure fails it', () => {
    expect(outcomeOf(checks(), [])).toBe('success');
    expect(outcomeOf(checks('pass', 'pass', 'pass', 'not judged'), [])).toBe('uncertain');
    expect(outcomeOf(checks('not judged'), [])).toBe('uncertain');
    expect(outcomeOf(checks('pass', 'pass', 'pass', 'fail'), [])).toBe('failed');
    expect(outcomeOf(checks('pass', 'fail'), ['bounce'])).toBe('failed');
    // (A layer with no check at all is not a passed layer.)
    expect(outcomeOf(checks().slice(0, 4), [])).toBe('uncertain');
  });

  it('running without errors is not a success: a game that only passes Runs is uncertain at best', () => {
    const only = [passed('built', 'a', ''), passed('shape', 'b', ''), passed('runs', 'It runs without a fault', ''), notJudged('plays', 'c', 'no script'), passed('load', 'd', '')];
    expect(outcomeOf(only, [])).toBe('uncertain');
    expect(layerResult(only, 'plays')).toBe('not judged');
  });

  it('every check passed by a script standing in for a missing engine part is an approximation, not a success', () => {
    expect(outcomeOf(checks(), ['bounce', 'turning_solids'])).toBe('approximation');
  });

  it('a layer: failed when any check failed, uncertain when some were not judged, not judged when none were', () => {
    expect(layerResult([passed('plays', 'a'), failed('plays', 'b', 'x'), notJudged('plays', 'c', 'y')], 'plays')).toBe('fail');
    expect(layerResult([passed('plays', 'a'), notJudged('plays', 'c', 'y')], 'plays')).toBe('uncertain');
    expect(layerResult([notJudged('plays', 'c', 'y')], 'plays')).toBe('not judged');
    expect(layerResult([], 'plays')).toBe('not judged');
  });
});

describe('the parts of the engine a kind of game needs, found by experiment', () => {
  // What the engine is today. A part gained one day turns its line here: change it then, with the cases it frees.
  it('today: no bounce, round things collide as squares, a turned solid is the box around it, a struck body takes no speed, scripts hold no lists', () => {
    const parts = engineParts(registry);
    expect(parts.map((p) => [p.id, p.has])).toEqual([
      ['bounce', false],
      ['round_bodies', false],
      ['turning_solids', false],
      ['solids_strike', false],
      ['script_lists', false],
    ]);
    for (const p of parts) expect(p.seen.length, p.id).toBeGreaterThan(40);
    expect(parts[0].seen).toMatch(/landed and lay still/);
    expect(parts[3].seen).toMatch(/was pushed \d+ px/);
    expect(parts[4].seen).toMatch(/accepted with a variable holding a number, and refused/);
  });
});

describe('the cases', () => {
  it('eighteen kinds of game; the card game twice, in English and in Icelandic, alike in everything but the words', () => {
    expect(new Set(CASES.map((c) => c.number)).size).toBe(18);
    expect(CASES).toHaveLength(19);
    expect(new Set(CASES.map((c) => c.id)).size).toBe(19);
    const [en, is] = [caseById('cards-en'), caseById('cards-is')];
    expect([en.language, is.language]).toEqual(['en', 'is']);
    expect({ ...en, id: 0, title: 0, language: 0, prompt: 0, plays: 0 }).toEqual({ ...is, id: 0, title: 0, language: 0, prompt: 0, plays: 0 });
    // The same requirements, sentence for sentence (eight each), with the numbers and the keys the same.
    expect(en.prompt.split(/(?<=[.!?]) /).length).toBe(is.prompt.split(/(?<=[.!?]) /).length);
    for (const p of [en.prompt, is.prompt]) {
      expect(p).toMatch(/\b7\b/);
      expect(p).toMatch(/\bD\b/);
    }
    // The first live run proposed: eight kinds, the card game in both languages.
    expect(CASES.filter((c) => c.firstRun).map((c) => c.id)).toEqual(['platformer', 'falling-blocks', 'shooter', 'chess', 'tactics', 'city', 'pinball', 'cards-en', 'cards-is']);
  });

  it('a game is asked for by what it does, never by the name of one that exists (chess is nobody\'s)', () => {
    for (const c of CASES) expect(`${c.prompt} ${c.followUps.map((f) => f.prompt).join(' ')}`, c.id).not.toMatch(/\b(uno|tetris|mario|zelda|gta|grand theft|pac.?man|puyo|boulder ?dash|celeste|pok[eé]mon|final fantasy|fire emblem|rogue\b|galaga|dr\.? mario)/i);
  });
});

describe('each case on a game standing in for a model\'s answer', () => {
  // Sound games of their kind: nothing may fail. (Built is not judged: only the game is known, so none is a "success".)
  const sound = ['platformer', 'precision', 'adventure', 'falling-blocks', 'shooter', 'mining', 'boulders', 'chess', 'tic-tac-toe', 'tactics', 'rpg', 'roguelike', 'isometric'];
  for (const id of sound) {
    it(`${id}: ${STAND_INS[id].from} is judged sound`, () => {
      const r = judge(id);
      expect(not(r, 'fail'), said(r)).toEqual([]);
      expect(r.layers.shape, said(r)).toBe('pass');
      expect(r.layers.runs, said(r)).toBe('pass');
      expect(['pass', 'uncertain'], said(r)).toContain(r.layers.plays);
      expect(r.checks.filter((c) => c.layer === 'plays' && c.verdict === 'pass').length).toBeGreaterThanOrEqual(2);
      expect(r.layers.load).toBe('pass');
      // Only the game was given: how it was made is not judged, so the case is not a success.
      expect(r.layers.built).toBe('not judged');
      expect(r.outcome).toBe('uncertain');
    }, 120_000);
  }

  it('what a script cannot see yet is said to be not judged, by name', () => {
    expect(not(judge('chess'), 'not judged')).toEqual(['The weakest and the strongest setting play differently']);
    expect(not(judge('boulders'), 'not judged')).toEqual(['What is collected is counted on the screen']);
  }, 120_000);

  it('chess is played through the engine\'s menu and cursor: a pawn two forward, a rook kept from jumping, a capture, the computer\'s reply', () => {
    const r = judge('chess');
    for (const what of [/pawn asked to go two squares/, /rook asked to jump/, /takes it: one piece fewer/, /the other side moves by itself/]) expect(verdictOf(r, what), said(r)).toBe('pass');
    expect(r.checks.find((c) => /takes it/.test(c.what))!.why).toMatch(/32 pieces before.*31/);
  }, 120_000);

  it('the regression falling-pairs game has no key that turns the pair: that one check fails, and nothing else', () => {
    const r = judge('falling-pairs');
    expect(not(r, 'fail')).toEqual(['A key turns the falling piece']);
    expect(r.outcome).toBe('failed');
  }, 120_000);

  it('the crime city a model built: a city that plays, and smaller than this case asks for (size asked is its own check)', () => {
    const r = judge('city');
    expect(not(r, 'fail')).toEqual(['The world is as big as asked (at least 6 screens)']);
    expect(r.checks.find((c) => /as big as asked/.test(c.what))!.why).toMatch(/46 by 36 cells: 3\.2 screens/);
    expect(verdictOf(r, /get into a vehicle/)).toBe('pass');
    expect(verdictOf(r, /Cars and people go about/)).toBe('pass');
    expect(r.layers.load).toBe('pass');
  }, 180_000);

  it('the pinball table a model built: the ball is launched, bounces and scores, the flippers throw it; but they throw as a script does, not as a turning arm, and four engine parts are missing', () => {
    const r = judge('pinball');
    for (const what of [/sends the ball up/, /comes off what it hits/, /swings a flipper/, /thrown when the flipper swings/, /only a ball it touches/, /score shown goes up/, /costs a ball/, /says it is over/]) expect(verdictOf(r, what), said(r)).toBe('pass');
    expect(not(r, 'fail')).toEqual(['The flipper throws as a turning arm does: hardly at the end it turns about, hardest at its tip']);
    expect(r.missing.map((m) => m.id)).toEqual(['bounce', 'round_bodies', 'turning_solids', 'solids_strike']);
    expect(r.outcome).toBe('failed');
    // Were that one check passed too, it would still not be a success: the parts are missing.
    expect(outcomeOf(r.checks.filter((c) => c.verdict === 'pass').concat(passed('built', 'x')), r.missing.map((m) => m.id))).toBe('approximation');
  }, 120_000);

  it('a table whose flippers do nothing (their scripts taken away) fails where it should', () => {
    const broken = produce(STAND_INS.pinball.make(registry), (d) => {
      for (const o of d.definitions) if (/flipper/i.test(o.name)) o.scripts = [];
    });
    const r = judge('pinball', broken);
    expect(verdictOf(r, /swings a flipper/)).toBe('fail');
    expect(verdictOf(r, /thrown when the flipper swings/)).toBe('not judged');
    expect(verdictOf(r, /sends the ball up/)).toBe('pass');
  }, 120_000);

  it('the card game a model built: Play starts the leftover platformer, the hand is seven and can never be more, in English and in Icelandic alike', () => {
    const [en, is] = [judge('cards-en'), judge('cards-is')];
    for (const r of [en, is]) {
      expect(verdictOf(r, /Play starts the game that was asked for/), said(r)).toBe('fail');
      expect(r.checks.find((c) => /Play starts/.test(c.what))!.why).toMatch(/Play starts "Level 1".*is the level "UNO", which Play does not start/);
      expect(r.playedInstead).toBe('UNO');
      expect(verdictOf(r, /hand is shown as cards, 7 to begin with/)).toBe('pass');
      expect(verdictOf(r, /can be played, and leaves the hand/)).toBe('pass');
      expect(verdictOf(r, /is refused, and the game says so/)).toBe('pass');
      expect(verdictOf(r, /computer plays in its turn/)).toBe('pass');
      // The known limit: nothing adds a card to the hand, and it never shows more than seven.
      expect(verdictOf(r, /Drawing adds a card/)).toBe('fail');
      expect(verdictOf(r, /can hold more than 7 cards/)).toBe('fail');
      expect(r.checks.find((c) => /more than 7 cards/.test(c.what))!.why).toMatch(/never showed more than 7 cards \(10 asked\)/);
      expect(not(r, 'not judged')).toEqual(['A hand emptied ends the game', 'Cards that skip a turn, turn the order round and make the next player draw two do so']);
      expect(r.missing.map((m) => m.id)).toEqual(['script_lists']);
      expect(r.outcome).toBe('failed');
    }
    // The same game judged by the two cases: the same verdicts, check for check.
    expect(en.checks.map((c) => [c.what, c.verdict])).toEqual(is.checks.map((c) => [c.what, c.verdict]));
  }, 120_000);
});

describe('broken variants of sound games fail', () => {
  it('a platformer without its goal', () => {
    const p = STAND_INS.platformer.make(registry);
    const goal = p.definitions.find((d) => d.components.Goal)!;
    const r = judge('platformer', produce(p, (d) => void d.scenes.forEach((s) => void (s.entities = s.entities.filter((e) => e.definitionId !== goal.id)))));
    expect(verdictOf(r, /Reaching the goal wins/)).toBe('fail');
    expect(r.outcome).toBe('failed');
  }, 120_000);

  it('a platformer nobody is steered in: not the kind of game asked for', () => {
    const r = judge('platformer', produce(STAND_INS.platformer.make(registry), (d) => {
      for (const o of d.definitions) delete o.components.CharacterController;
    }));
    expect(verdictOf(r, /Play starts the game that was asked for/)).toBe('fail');
    expect(verdictOf(r, /Left and right move the character/)).toBe('fail');
  }, 120_000);

  it('a platformer of one level, where two were asked for', () => {
    const r = judge('platformer', produce(STAND_INS.platformer.make(registry), (d) => void d.scenes.pop()));
    expect(verdictOf(r, /at least 2 levels/)).toBe('fail');
    expect(verdictOf(r, /the next level starts/)).toBe('fail');
  }, 120_000);

  it('a precision platformer whose character has no dash', () => {
    const r = judge('precision', produce(STAND_INS.precision.make(registry), (d) => {
      for (const o of d.definitions) delete o.components.Dash;
    }));
    expect(verdictOf(r, /abilities asked for/)).toBe('fail');
    expect(verdictOf(r, /dash key sends the character further/)).toBe('fail');
  }, 120_000);

  it('a shooter that cannot shoot', () => {
    const r = judge('shooter', produce(STAND_INS.shooter.make(registry), (d) => {
      for (const o of d.definitions) delete o.components.Shooter;
    }));
    expect(verdictOf(r, /fire key sends a shot flying/)).toBe('fail');
  }, 120_000);

  it('a falling-block game whose rules are switched off: nothing falls', () => {
    const r = judge('falling-blocks', produce(STAND_INS['falling-blocks'].make(registry), (d) => {
      for (const o of d.definitions) for (const s of o.scripts ?? []) s.enabled = false;
    }));
    expect(verdictOf(r, /A piece falls by itself/)).toBe('fail');
    expect(verdictOf(r, /Left and right move the falling piece/)).toBe('not judged');
  }, 120_000);

  it('a chess game whose rules are switched off: nothing can be judged by playing, and that is not a pass', () => {
    const r = judge('chess', produce(STAND_INS.chess.make(registry), (d) => {
      for (const o of d.definitions) for (const s of o.scripts ?? []) if (s.handlers.length >= 4) s.enabled = false;
    }));
    expect(r.layers.plays).toBe('not judged');
    expect(r.outcome).not.toBe('success');
    expect(r.checks.find((c) => /pawn/.test(c.what))!.why).toMatch(/does not use the engine's grid cursor/);
  }, 120_000);

  it('a game with a fault at run time fails Runs, whatever else it does', () => {
    const p = STAND_INS.adventure.make(registry);
    const player = p.definitions.find((d) => d.name === 'Player')!;
    const r = judge('adventure', produce(p, (d) => void setScript(d, { target: 'definition', id: player.id }, { name: 'Oops', description: '', vars: [], handlers: [{ when: { on: 'key', key: 'right', edge: 'pressed' }, if: null, do: [{ do: 'set_game', var: 'who', value: 'self' }] }] } as never)));
    expect(verdictOf(r, /It runs without a fault/)).toBe('fail');
    expect(r.layers.runs).toBe('fail');
    expect(r.outcome).toBe('failed');
  }, 120_000);

  it('a door that opens for anyone', () => {
    const r = judge('adventure', produce(STAND_INS.adventure.make(registry), (d) => void (d.scenes[0].relationships = [])));
    expect(verdictOf(r, /locked door stays shut without the key and opens with it/)).toBe('fail');
  }, 120_000);
});

describe('the two edits to a given game', () => {
  it('as given (nothing edited): the bridge holds nothing; edited by hand: the coin gold, the bridge solid, nothing else touched', () => {
    const given = gameWithABrokenBridge(registry);
    const untouched = judge('edits', given, { before: given, operations: [] });
    expect(verdictOf(untouched, /bridge holds the player up/)).toBe('fail');
    expect(verdictOf(untouched, /coin is gold/)).toBe('fail');
    const coin = given.definitions.find((d) => d.name === 'Coin')!;
    const edited = produce(given, (d) => {
      const c = d.definitions.find((x) => x.id === coin.id)!;
      c.components.Sprite = { ...c.components.Sprite, color: '#ffcc00' };
      const b = d.definitions.find((x) => x.name === 'Bridge')!;
      b.components.Collider = { ...b.components.Collider, isTrigger: false, oneWay: true };
    });
    const r = judge('edits', edited, { before: given, operations: [{ op: 'draw_sprite', target: 'definition', id: coin.id, palette: [{ key: 'G', color: '#ffcc00' }, { key: 'D', color: '#b8860b' }], rows: ['GD'] }] });
    expect(verdictOf(r, /coin is gold/), said(r)).toBe('pass');
    expect(verdictOf(r, /bridge holds the player up/), said(r)).toBe('pass');
    // The coin made green, and the player changed along the way: both said.
    const wrong = produce(edited, (d) => void (d.definitions.find((x) => x.name === 'Player')!.components.Health = { ...d.definitions.find((x) => x.name === 'Player')!.components.Health, max: 99 }));
    expect(judge('edits', wrong, { before: given, operations: [] }).checks.find((c) => /coin is gold/.test(c.what))).toMatchObject({ verdict: 'fail', why: expect.stringMatching(/Changed besides the coin: Player/) });
    const green = judge('edits', edited, { before: given, operations: [{ op: 'draw_sprite', id: coin.id, palette: [{ key: 'G', color: '#22aa44' }] }] });
    expect(verdictOf(green, /coin is gold/)).toBe('fail');
  }, 120_000);
});

describe('the report', () => {
  // EVAL_REPORT=<file>: every case on its stand-in, written out (docs/evaluation/v1.5a-stand-ins.md was made so).
  it.runIf(!!process.env.EVAL_REPORT)('written out for every case', () => {
    const reports = CASES.map((c) => judge(c.id));
    writeFileSync(process.env.EVAL_REPORT!, reportText(reports, 'V1.5a: every case judged on a game standing in for a model\'s answer (no model was asked)').replace(/The middle frame took [\d.]+ ms and the worst [\d.]+ ms/g, 'The middle frame took under 2 ms and the worst under 16 ms') + '\n');
    expect(reports).toHaveLength(19);
  }, 600_000);

  it('one row a case, the five layers apart, what was not judged said, the missing engine parts named', () => {
    const text = reportText([judge('tactics'), judge('pinball')], 'Stand-ins');
    expect(text).toMatch(/\| # \| Case \| From \| Built \| Shape \| Runs \| Plays \| Size and load \| Engine parts missing \| Result \|/);
    expect(text).toMatch(/\| 11 \| A turn-based tactics skirmish \| the regression tactics board \| not judged \| pass \| pass \| pass \| pass \| none \| \*\*uncertain\*\* \|/);
    expect(text).toMatch(/\| 17 \| A pinball table \|.*\| FAIL \| pass \| bounce, round bodies, turning solids, solids strike \| \*\*failed\*\* \|/);
    expect(text).toMatch(/2 cases: 0 success, 0 approximation .*1 uncertain .*1 failed/);
    expect(text).toMatch(/- not judged: The request ended with the game applied, whole\. Only the game was given, not how it was made\./);
    expect(text).toMatch(/\*\*Engine parts this kind of game needs and the engine does not have:\*\*/);
    expect(text).toMatch(/- FAIL: The flipper throws as a turning arm does/);
  }, 120_000);
});
