/**
 * The game rules the built-in objects come with, as ordinary behavior scripts (seen and changed in the Code editor
 * or by the AI like any other): stomping and hurting on touch. The engine only does what they ask (bounce, hurt,
 * die) and tells them when something lands on top or touches. Also used to turn the old Stompable and Damage
 * components of games made before into these scripts.
 */
import { generateId } from '../ids';
import { scriptSchema, type BehaviorScript } from '../script/language';

/** "other carries one of these tags" (null when any will do). */
function tagged(tags: readonly string[]): string | null {
  const list = [...new Set(tags.filter((t) => /^[\w -]+$/.test(t)))];
  return list.length ? list.map((t) => `has_tag(other, '${t}')`).join(' or ') : null;
}

export const STOMP_SCRIPT_NAME = 'Stomp';
export const HURTS_SCRIPT_NAME = 'Hurts on touch';

/**
 * Jumping on it from above defeats it (or, with `hits` above 0 and Health, takes that much health): the stomper
 * bounces off unhurt and "stomped" is announced.
 */
export function stompScript(opts: { by: readonly string[]; bounce: number; hits: number }): BehaviorScript {
  return scriptSchema.parse({
    id: generateId('scr'),
    name: STOMP_SCRIPT_NAME,
    description: `Jumping on it from above ${opts.hits > 0 ? `takes ${opts.hits} health` : 'defeats it'}; whoever jumped bounces off unhurt.`,
    vars: [
      { name: 'bounce', value: opts.bounce },
      { name: 'hits', value: opts.hits },
    ],
    handlers: [
      {
        when: { on: 'landed_on' },
        if: tagged(opts.by),
        do: [
          { do: 'bounce', speed: 'bounce', on: 'other' },
          { do: 'emit', event: 'stomped', other: 'other' },
          { do: 'if', cond: 'hits > 0 and self.max_health > 0', then: [{ do: 'damage', target: 'self', amount: 'hits' }], else: [{ do: 'kill', target: 'self' }] },
        ],
      },
    ],
  }) as BehaviorScript;
}

/** Touching it hurts: things carrying one of `who`'s tags (none: anything with health), `amount` at a time. */
export function hurtsScript(opts: { amount: number; who: readonly string[] }): BehaviorScript {
  const cond = tagged(opts.who);
  return scriptSchema.parse({
    id: generateId('scr'),
    name: HURTS_SCRIPT_NAME,
    description: `Touching it hurts ${cond ? opts.who.join(' or ') : 'anything with health'} (${opts.amount} health a hit).`,
    vars: [{ name: 'amount', value: opts.amount }],
    handlers: [{ when: { on: 'contact' }, if: cond ?? 'other.max_health > 0', do: [{ do: 'damage', target: 'other', amount: 'amount' }] }],
  }) as BehaviorScript;
}

type Stmt = BehaviorScript['handlers'][number]['do'][number];

function stmtsOf(list: readonly Stmt[]): Stmt[] {
  return list.flatMap((s) => [s, ...(s.do === 'if' ? [...stmtsOf(s.then), ...stmtsOf(s.else)] : s.do === 'repeat' || s.do === 'each' ? stmtsOf(s.then) : [])]);
}

/**
 * What its scripts do to what touches it (for checking levels without playing them): how much a touch hurts and
 * whom (the tags its condition names; empty: anything with health), or null when nothing it does on touch hurts.
 */
export function touchHarm(scripts: readonly BehaviorScript[] | undefined): { amount: number; who: string[] } | null {
  let most = 0;
  const tags = new Set<string>();
  let anything = false;
  for (const script of scripts ?? []) {
    if (!script.enabled) continue;
    for (const h of script.handlers) {
      if (h.when.on !== 'contact' && !(h.when.on === 'event' && h.when.event === 'touch_started')) continue;
      for (const s of stmtsOf(h.do)) {
        if ((s.do !== 'damage' && s.do !== 'kill') || s.target.trim() !== 'other') continue;
        const raw = s.do === 'kill' ? '99' : s.amount.trim();
        const v = script.vars.find((x) => x.name === raw)?.value;
        const amount = Number.isFinite(Number(raw)) ? Number(raw) : typeof v === 'number' ? v : 1;
        const who = [...(h.if ?? '').matchAll(/has_tag\(\s*other\s*,\s*['"]([^'"]+)['"]\s*\)/g)].map((m) => m[1]);
        if (h.when.on === 'event' && h.when.with) who.push(h.when.with);
        if (amount <= 0) continue;
        most = Math.max(most, amount);
        if (!who.length) anything = true;
        for (const t of who) tags.add(t);
      }
    }
  }
  return most > 0 ? { amount: most, who: anything ? [] : [...tags] } : null;
}

/** Whether touching it hurts a thing with these tags (and health). */
export function hurtsOnTouch(scripts: readonly BehaviorScript[] | undefined, victimTags: readonly string[]): boolean {
  const harm = touchHarm(scripts);
  return !!harm && (harm.who.length === 0 || harm.who.some((t) => victimTags.includes(t)));
}

/** A script that only reacts to being touched or landed on (it doesn't move anything by itself). */
export function onlyOnTouch(script: BehaviorScript): boolean {
  return script.handlers.every((h) => h.when.on === 'contact' || h.when.on === 'landed_on');
}
