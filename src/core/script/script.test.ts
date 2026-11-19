import { TOPICS } from '../ai/topics';
import { describe, expect, it } from 'vitest';
import { createBuiltinRegistry } from '../components/builtin';
import { createProject } from '../model/factory';
import { checkExpr, formatExpr, parseExpr } from './expr';
import { checkScript, describeScriptLanguage, SCRIPT_LIMITS, SCRIPT_TOPICS, scriptDocsFor, FUNCTIONS, MEMBERS, STATEMENTS, usesMenuKey } from './language';
import { produce } from 'immer';

const project = createProject(createBuiltinRegistry());
const scope = { names: new Set(['self', 'player', 'speed']), functions: { dist: { min: 1, max: 2 }, abs: { min: 1, max: 1 } }, members: new Set(['x', 'grounded']) };

describe('expressions', () => {
  it('parses with the usual precedence, word operators and conditionals', () => {
    expect(formatExpr(parseExpr('1 + 2 * 3'))).toBe('(1 + (2 * 3))');
    expect(formatExpr(parseExpr('dist(player) < 160 and self.grounded'))).toBe('((dist(player) < 160) and self.grounded)');
    expect(formatExpr(parseExpr('not a or b'))).toBe('(not a or b)');
    expect(formatExpr(parseExpr('x > 0 ? 1 : -1'))).toBe('((x > 0) ? 1 : -1)');
    expect(formatExpr(parseExpr("'hi' + 2.5"))).toBe('("hi" + 2.5)');
  });

  it('rejects broken text with a readable message', () => {
    expect(() => parseExpr('1 +')).toThrow(/expected a value but it ends there/);
    expect(() => parseExpr('(1 + 2')).toThrow(/expected "\)"/);
    expect(() => parseExpr('a = 1')).toThrow(/unexpected character "="/);
    expect(() => parseExpr('')).toThrow(/empty/);
  });

  it('the checker knows names, properties and functions, and suggests near misses', () => {
    expect(checkExpr(parseExpr('dist(player) + speed'), scope)).toBeNull();
    expect(checkExpr(parseExpr('sped * 2'), scope)).toBe('unknown name "sped" (did you mean "speed"?)');
    expect(checkExpr(parseExpr('self.xx'), scope)).toBe('unknown property ".xx" (did you mean ".x"?)'.replace('".x"', '"x"'));
    expect(checkExpr(parseExpr('abs(1, 2)'), scope)).toBe('abs() takes 1 argument, not 2');
    expect(checkExpr(parseExpr('eval("x")'), scope)).toMatch(/unknown function "eval"/);
  });
});

const charger = {
  id: 'scr_1',
  name: 'Charge',
  description: 'Walks; charges when the player is near.',
  vars: [{ name: 'speed', value: 60 }],
  states: ['walk', 'charge'],
  handlers: [
    { when: { on: 'tick' }, state: 'walk', if: 'dist(player) < 160', do: [{ do: 'state', name: 'charge' }] },
    { when: { on: 'tick' }, state: 'charge', do: [{ do: 'move_toward', target: 'player', speed: 'speed * 3' }] },
    { when: { on: 'event', event: 'stomped' }, do: [{ do: 'message', text: 'Ouch from {self.name}!' }] },
  ],
};

describe('scripts', () => {
  it('a valid script is accepted and gets its defaults filled in', () => {
    const r = checkScript(charger, project);
    expect('script' in r).toBe(true);
    if ('script' in r) {
      expect(r.script.enabled).toBe(true);
      expect(r.script.handlers[0].when).toEqual({ on: 'tick' });
      expect(r.script.handlers[2].when).toEqual({ on: 'event', event: 'stomped', with: null });
      expect(r.script.handlers[2].do[0]).toEqual({ do: 'message', text: 'Ouch from {self.name}!', seconds: 2 });
    }
  });

  it('states given as one string (a slip) are read as the list they mean', () => {
    for (const states of ['walk, charge', '["walk","charge"]', 'walk charge']) {
      const r = checkScript({ ...charger, states }, project);
      expect('script' in r && r.script.states).toEqual(['walk', 'charge']);
    }
    const none = checkScript({ ...charger, states: null, handlers: [charger.handlers[2]] }, project);
    expect('script' in none && none.script.states).toEqual([]);
  });

  const broken = (patch: (s: typeof charger) => unknown) => {
    const r = checkScript(patch(structuredClone(charger)), project);
    return 'error' in r ? r.error : null;
  };

  it('every problem is reported with where it is', () => {
    expect(broken((s) => ((s.handlers[1].do[0] as { speed: string }).speed = 'sped * 3', s))).toBe(
      'Script "Charge", handler 2 (tick): step 1 (move_toward): expression "sped * 3": unknown name "sped" (did you mean "speed"?)',
    );
    expect(broken((s) => ((s.handlers[0].do[0] as { name: string }).name = 'chase', s))).toMatch(/unknown state "chase".*declare it in "states"/);
    expect(broken((s) => ((s.handlers[0].state = 'run'), s))).toMatch(/handler 1 \(tick\): unknown state "run"/);
    expect(broken((s) => ((s.handlers[2].when as { event: string }).event = 'stomp', s))).toMatch(/unknown event "stomp" \(did you mean "stomped"\?\)/);
    expect(broken((s) => (s.handlers[0].do.push({ do: 'set', var: 'x', value: '1' } as never), s))).toMatch(/unknown variable "x"/);
    expect(broken((s) => (s.vars.push({ name: 'player', value: 1 }), s))).toMatch(/built-in name/);
    expect(broken((s) => ((s.handlers[0].do[0] as unknown as { do: string }).do = 'teleport_everyone', s))).toMatch(/handlers\.0\.do\.0/);
    expect(broken((s) => (s.handlers[0].do.push({ do: 'spawn', object: 'def_nope', x: '0', y: '0' } as never), s))).toMatch(/no library object "def_nope"/);
    const push = (stmt: unknown) => broken((s) => (s.handlers[0].do.push(stmt as never), s));
    expect(push({ do: 'set_field', component: 'Sprit', field: 'width', value: '1' })).toMatch(/there is no component "Sprit"/);
    expect(push({ do: 'set_field', component: 'Sprite', field: 'widht', value: '1' })).toMatch(/Sprite has no field "widht" \(it has .*width/);
    expect(push({ do: 'set_field', component: 'Collider', field: 'size', value: '1' })).toMatch(/use "size.x" or "size.y"/);
    expect(push({ do: 'set_field', component: 'Transform', field: 'angle', value: '1' })).toMatch(/Transform has no field "angle"/);
    expect(push({ do: 'add_component', component: 'Ladder' })).toMatch(/there is no component "Ladder"/);
    expect(push({ do: 'draw', id: 'a', shape: 'sprite', x: '0', y: '0' })).toMatch(/needs "object"/);
    expect(push({ do: 'repeat', times: '3', then: [{ do: 'set', var: 'speed', value: 'i' }] })).toBeNull();
    expect(push({ do: 'set', var: 'speed', value: 'i' })).toMatch(/unknown name "i"/);
    expect(push({ do: 'set_field', component: 'Collider', field: 'size.x', value: 'field(self, "Collider.size.x") + 8' })).toBeNull();
    expect(broken((s) => (s.handlers[0].do.push({ do: 'message', text: 'HP {healt}' } as never), s))).toMatch(/unknown name "healt"/);
  });

  it('"other" exists only in event and signal handlers, "it" only inside each', () => {
    expect(broken((s) => ((s.handlers[0].if = 'exists(other)'), s))).toMatch(/unknown name "other"/);
    expect(broken((s) => ((s.handlers[2].do = [{ do: 'damage', target: 'other', amount: '1' } as never]), s))).toBeNull();
    expect(broken((s) => ((s.handlers[1].do = [{ do: 'damage', target: 'it', amount: '1' } as never]), s))).toMatch(/unknown name "it"/);
    expect(broken((s) => ((s.handlers[1].do = [{ do: 'each', tag: 'enemy', then: [{ do: 'damage', target: 'it', amount: '1' }] } as never]), s))).toBeNull();
  });

  it('size limits keep scripts bounded', () => {
    const deep = (n: number): unknown => (n === 0 ? { do: 'jump', force: '1' } : { do: 'if', cond: 'true', then: [deep(n - 1)] });
    expect(broken((s) => ((s.handlers[0].do = [deep(SCRIPT_LIMITS.depth - 1) as never]), s))).toBeNull();
    expect(broken((s) => ((s.handlers[0].do = [deep(SCRIPT_LIMITS.depth) as never]), s))).toMatch(/nested too deeply \(max 12\)/);
    const many = (n: number) => Array.from({ length: n }, (_, i) => ({ name: `v${i}`, value: 0 }));
    expect(broken((s) => ((s.vars = [...s.vars, ...many(SCRIPT_LIMITS.vars - 1)]), s))).toBeNull();
    expect(broken((s) => ((s.vars = [...s.vars, ...many(SCRIPT_LIMITS.vars + 4)]), s))).toBe('Script "Charge" has too many variables (125; max 120)');
    const steps = (n: number) => Array.from({ length: n }, () => ({ do: 'jump', force: '1' }));
    expect(broken((s) => ((s.handlers[0].do = steps(SCRIPT_LIMITS.statements - 5) as never), s))).toBeNull();
    expect(broken((s) => ((s.handlers[0].do = steps(SCRIPT_LIMITS.statements + 5) as never), s))).toBe('Script "Charge" is too long (2007 steps; max 2000)');
  });

  it("a board game's rules fit: a hundred variables, a condition of a thousand characters (chess was refused for 41 variables, then for a 501-character formula)", () => {
    const vars = Array.from({ length: 100 }, (_, i) => ({ name: `sq${i}`, value: 0 }));
    const long = Array.from({ length: 40 }, (_, i) => `(sq${i} == ${i} and sq${i + 1} != 0)`).join(' or ');
    expect(long.length).toBeGreaterThan(1000);
    expect(broken((s) => ((s.vars = [...s.vars, ...vars]), (s.handlers[0].if = long), s))).toBeNull();
    // (Still bounded: by length, and by how deep it nests, each said by name.)
    const tooLong = Array.from({ length: 90 }, (_, i) => `(sq${i} == ${i} and sq${i + 1} != 0)`).join(' or ');
    const said = broken((s) => ((s.vars = [...s.vars, ...vars]), (s.handlers[0].if = tooLong), s))!;
    expect(said).toMatch(/is too long \(max 2000 characters\)/);
    // (A long formula is named by its start, not printed whole into the message that goes back to the AI.)
    expect(said.length).toBeLessThan(260);
    expect(said).toContain(`${tooLong.slice(0, 80)}… (${tooLong.length} characters)`);
    expect(() => parseExpr(`${'('.repeat(61)}1${')'.repeat(61)}`)).toThrow(/nested too deeply \(max 60 brackets inside each other\)/);
    expect(formatExpr(parseExpr(`${'('.repeat(50)}1${')'.repeat(50)}`))).toBe('1');
    expect(() => parseExpr(`${'-'.repeat(900)}1`)).toThrow(/nested too deeply/);
  });

  it('every problem of a script is reported at once, each with its place (one sent back alone cost a whole new answer each)', () => {
    const said = broken((s) => {
      s.vars = Array.from({ length: SCRIPT_LIMITS.vars + 1 }, (_, i) => ({ name: `v${i}`, value: 0 }));
      s.handlers[0].if = 'dist(playr) < 160';
      (s.handlers[1].do[0] as { speed: string }).speed = 'sped * 3';
      s.handlers[2].do.push({ do: 'state', name: 'flee' } as never);
      return s;
    })!;
    expect(said).toBe(
      'Script "Charge" has 4 problems, all to fix in one go: (1) has too many variables (121; max 120); (2) handler 1 (tick): condition "dist(playr) < 160": unknown name "playr" (did you mean "player"?); ' +
        '(3) handler 2 (tick): step 1 (move_toward): expression "sped * 3": unknown name "sped"; (4) handler 3 (event): step 2 (state): unknown state "flee"; declare it in "states"',
    );
    // The same slip in many places is one problem, counted; and a long list ends by saying how many more.
    const same = broken((s) => ((s.handlers[1].do = Array.from({ length: 5 }, () => ({ do: 'set', var: 'sped', value: '1' })) as never), s))!;
    expect(same).toBe('Script "Charge", handler 2 (tick): step 1 (set): unknown variable "sped" (did you mean "speed"?); declare it in "vars" (and the same in 4 more places)');
    const lots = broken((s) => ((s.handlers[1].do = Array.from({ length: 14 }, (_, i) => ({ do: 'set', var: `u${i}`, value: '1' })) as never), s))!;
    expect(lots).toMatch(/^Script "Charge" has 14 problems, all to fix in one go: \(1\) handler 2/);
    expect(lots).toMatch(/\(10\) handler 2 \(tick\): step 10 \(set\): unknown variable "u9"[^;]*; declare it in "vars"; and 4 more$/);
    // (Nested places keep their whole path.)
    expect(broken((s) => ((s.handlers[1].do = [{ do: 'if', cond: 'true', then: [], else: [{ do: 'repeat', times: '2', then: [{ do: 'state', name: 'nope' }] }] }] as never), s))).toBe(
      'Script "Charge", handler 2 (tick): step 1 (if) else > step 1 (repeat) > step 1 (state): unknown state "nope"; declare it in "states"',
    );
  });

  it('the AI reference documents every statement, function and property: in the instructions, or in its topic (named there)', () => {
    const text = describeScriptLanguage();
    const topics = Object.keys(SCRIPT_TOPICS).map((t) => scriptDocsFor(t)).join('\n');
    for (const k of Object.keys(STATEMENTS)) expect(text.includes(`  ${k}:`) || (topics.includes(`  ${k}:`) && text.includes(k)), k).toBe(true);
    for (const k of Object.keys(FUNCTIONS)) expect(text.includes(`  ${k}(`) || topics.includes(`  ${k}(`), k).toBe(true);
    // (A property an ability gives is described with that ability, in its guidance topic.)
    for (const k of Object.keys(MEMBERS)) expect(text.includes(`  ${k}:`) || Object.values(TOPICS).some((t) => t.text.includes(`scripts read self.${k}:`)), k).toBe(true);
  });
});

describe('menu key', () => {
  const withScript = (handlers: unknown[]) =>
    produce(project, (d) => {
      d.definitions[0].scripts = [{ name: 'M', description: '', vars: [], states: [], handlers } as never];
    });

  it('a game uses the menu key (Esc) when a script reads it; otherwise Esc stops play as before', () => {
    expect(usesMenuKey(project)).toBe(false);
    expect(usesMenuKey(withScript([{ when: { on: 'key', key: 'menu', edge: 'pressed' }, state: null, if: null, do: [{ do: 'pause' }] }]))).toBe(true);
    expect(usesMenuKey(withScript([{ when: { on: 'tick' }, state: null, if: "pressed('menu')", do: [{ do: 'pause' }] }]))).toBe(true);
    expect(usesMenuKey(withScript([{ when: { on: 'key', key: 'jump', edge: 'pressed' }, state: null, if: null, do: [{ do: 'message', text: 'menu', seconds: 1 }] }]))).toBe(false);
  });
});
