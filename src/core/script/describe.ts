/**
 * Behavior scripts as readable text for the editor ("when every step, in
 * state chase: move toward player at speed * 3").
 */
import { formatExpr, parseExpr } from './expr';
import type { BehaviorScript, Handler, Stmt, Trigger } from './language';

/** Expression text tidied (outer parentheses dropped); left as written if it doesn't parse. */
function x(text: string): string {
  try {
    return formatExpr(parseExpr(text)).replace(/^\((.*)\)$/, '$1');
  } catch {
    return text;
  }
}

export function describeTrigger(t: Trigger): string {
  switch (t.on) {
    case 'start':
      return 'when the level starts';
    case 'tick':
      return 'every step';
    case 'every':
      return `every ${t.seconds} s`;
    case 'enter_state':
      return 'on entering';
    case 'event':
      return `on ${t.event.replace(/_/g, ' ')}${t.with ? ` with ${t.with}` : ''}`;
    case 'key':
      return `when ${t.key} is ${t.edge}`;
    case 'signal':
      return `on signal "${t.name}"`;
  }
}

export function describeHandler(h: Handler): string {
  const parts = [describeTrigger(h.when)];
  if (h.state) parts.push(h.when.on === 'enter_state' ? `state ${h.state}` : `in state ${h.state}`);
  if (h.if) parts.push(`if ${x(h.if)}`);
  return `${parts.join(', ')}:`;
}

function stmtLines(s: Stmt, indent: string): string[] {
  const one = (text: string) => [`${indent}${text}`];
  switch (s.do) {
    case 'set':
      return one(`set ${s.on ? `${x(s.on)}'s ` : ''}${s.var} = ${x(s.value)}`);
    case 'if':
      return [`${indent}if ${x(s.cond)}:`, ...s.then.flatMap((t) => stmtLines(t, `${indent}  `)), ...(s.else.length ? [`${indent}else:`, ...s.else.flatMap((t) => stmtLines(t, `${indent}  `))] : [])];
    case 'each':
      return [`${indent}for each ${s.tag} (it):`, ...s.then.flatMap((t) => stmtLines(t, `${indent}  `))];
    case 'velocity':
      return one(`speed ${[s.x !== null ? `x = ${x(s.x)}` : '', s.y !== null ? `y = ${x(s.y)}` : ''].filter(Boolean).join(', ')}`);
    case 'push':
      return one(`push by ${x(s.x)}, ${x(s.y)}`);
    case 'move_toward':
      return one(`move toward ${x(s.target)} at ${x(s.speed)}`);
    case 'glide_to':
      return one(`glide to ${x(s.x)}, ${x(s.y)} at ${x(s.speed)}`);
    case 'position':
      return one(`put at ${x(s.x)}, ${x(s.y)}`);
    case 'jump':
      return one(`jump (${x(s.force)})`);
    case 'face':
      return one(`face ${x(s.dir)}`);
    case 'gravity':
      return one(`gravity × ${x(s.scale)}`);
    case 'shoot':
      return one(`shoot ${s.object ? 'object ' : ''}toward ${x(s.dx)}, ${x(s.dy)} at ${x(s.speed)} (damage ${x(s.damage)}, range ${x(s.range)})`);
    case 'spawn':
      return one(`spawn object at ${x(s.x)}, ${x(s.y)}`);
    case 'remove':
      return one(`remove ${s.target ? x(s.target) : 'self'}`);
    case 'damage':
      return one(`hurt ${x(s.target)} by ${x(s.amount)}`);
    case 'heal':
      return one(`heal ${x(s.target)} by ${x(s.amount)}`);
    case 'give_item':
      return one(`give ${x(s.target)} ${x(s.count)} × ${s.item}`);
    case 'take_item':
      return one(`take ${x(s.count)} × ${s.item} from ${x(s.target)}`);
    case 'set_open':
      return one(`${x(s.target)} open = ${x(s.open)}`);
    case 'state':
      return one(`→ state ${s.name}`);
    case 'signal':
      return one(`send signal "${s.name}"`);
    case 'message':
      return one(`show "${s.text}" for ${s.seconds} s`);
    case 'alpha':
      return one(`see-through ${x(s.value)}`);
    case 'respawn':
      return one(`respawn ${s.target ? x(s.target) : 'self'}`);
    case 'restart_level':
      return one('restart the level');
  }
}

/** The whole script as lines of readable pseudo-code. */
export function describeScript(script: BehaviorScript): string[] {
  const lines: string[] = [];
  if (script.vars.length) lines.push(`vars: ${script.vars.map((v) => `${v.name} = ${JSON.stringify(v.value)}`).join(', ')}`);
  if (script.states.length) lines.push(`states: ${script.states.join(', ')} (starts in ${script.states[0]})`);
  for (const h of script.handlers) {
    lines.push(describeHandler(h));
    for (const s of h.do) lines.push(...stmtLines(s, '  '));
  }
  return lines;
}
