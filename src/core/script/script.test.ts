import { describe, expect, it } from 'vitest';
import { createBuiltinRegistry } from '../components/builtin';
import { createProject } from '../model/factory';
import { checkExpr, formatExpr, parseExpr } from './expr';
import { checkScript, describeScriptLanguage, FUNCTIONS, MEMBERS, STATEMENTS } from './language';

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
    expect(broken((s) => ((s.handlers[0].do = [deep(9) as never]), s))).toMatch(/nested too deeply/);
  });

  it('the AI reference lists every statement, function and property', () => {
    const text = describeScriptLanguage();
    for (const k of Object.keys(STATEMENTS)) expect(text).toContain(`  ${k}:`);
    for (const k of Object.keys(FUNCTIONS)) expect(text).toContain(`  ${k}(`);
    for (const k of Object.keys(MEMBERS)) expect(text).toContain(`  ${k}:`);
  });
});
