/** Plain-language sentences for relationships and rules (editor lists, AI context, history labels). */
import type { Condition, EntityRef, Project, Relationship, Rule, RuleAction, Scene } from '../types';
import { describeRef } from './refs';
import { eventRegistry, relationshipRegistry } from './vocabulary';

type Roles = { subject?: string | null; other?: string | null };

function itemPhrase(item: string, count: number): string {
  return count === 1 ? item : `${count} × ${item}`;
}

export function describeCondition(project: Project, scene: Scene | null, c: Condition, roles: Roles = {}): string {
  const who = describeRef(project, scene, c.entity, roles);
  let text: string;
  switch (c.type) {
    case 'has_item':
      text = `${who} ${c.not ? "doesn't have" : 'has'} ${itemPhrase(c.item, c.count)}`;
      return text;
    case 'health':
      text = `${who}'s health ${c.compare} ${c.value}`;
      break;
    case 'is_open':
      text = `${who} is open`;
      break;
    case 'switch_on':
      text = `${who} is on`;
      break;
  }
  return c.not ? `not (${text})` : text;
}

export function describeAction(project: Project, scene: Scene | null, a: RuleAction, roles: Roles = {}): string {
  const ref = (r: EntityRef) => describeRef(project, scene, r, roles);
  switch (a.type) {
    case 'open':
    case 'close':
    case 'toggle':
    case 'remove':
    case 'respawn':
      return `${a.type} ${ref(a.target)}`;
    case 'teleport':
      return `teleport ${ref(a.target)} to ${ref(a.to)}`;
    case 'spawn': {
      const name = project.definitions.find((d) => d.id === a.object)?.name ?? '(missing object)';
      return `spawn a ${name} ${a.at ? `at ${ref(a.at)}` : `at ${Math.round(a.x)}, ${Math.round(a.y)}`}`;
    }
    case 'damage':
      return `take ${a.amount} health from ${ref(a.target)}`;
    case 'heal':
      return `give ${a.amount} health to ${ref(a.target)}`;
    case 'give_item':
      return `give ${itemPhrase(a.item, a.count)} to ${ref(a.target)}`;
    case 'take_item':
      return `take ${itemPhrase(a.item, a.count)} from ${ref(a.target)}`;
    case 'restart_level':
      return 'restart the level';
    case 'show_message':
      return `show "${a.text}"`;
  }
}

function joinAnd(parts: string[]): string {
  return parts.length <= 1 ? (parts[0] ?? '') : `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}`;
}

/** "When Player touches every Coin, if Player has key: open Door and show "Hi"." */
export function describeRule(project: Project, scene: Scene | null, rule: Rule): string {
  const ev = eventRegistry.get(rule.when.event);
  const subject = describeRef(project, scene, rule.when.subject, { subject: 'something', other: 'something' });
  const other = describeRef(project, scene, rule.when.other, { subject: 'something', other: 'something' });
  const when = (ev?.phrase ?? rule.when.event).replace('{subject}', subject === 'anything' ? 'something' : subject).replace('{other}', other === 'anything' ? 'something' : other);
  // Inside conditions/actions, "subject"/"other" read as what the event filters name.
  const roles: Roles = {
    subject: rule.when.subject.kind === 'any' ? ev?.subject ?? 'the subject' : subject,
    other: rule.when.other.kind === 'any' ? ev?.other ?? 'the other one' : other,
  };
  const cond = rule.conditions.length ? `, if ${joinAnd(rule.conditions.map((c) => describeCondition(project, scene, c, roles)))}` : '';
  return `When ${when}${cond}: ${joinAnd(rule.actions.map((a) => describeAction(project, scene, a, roles)))}.`;
}

function tiles(px: number): string {
  const n = Math.round((Math.abs(px) / 32) * 10) / 10;
  return `${n} tile${n === 1 ? '' : 's'}`;
}

/** "3 tiles up", "2 tiles right and 1 tile down". */
export function describeOffset(o: { x: number; y: number }): string {
  const parts = [];
  if (o.y) parts.push(`${tiles(o.y)} ${o.y < 0 ? 'up' : 'down'}`);
  if (o.x) parts.push(`${tiles(o.x)} ${o.x < 0 ? 'left' : 'right'}`);
  return parts.join(' and ') || 'nowhere';
}

/** The short label drawn on a connection's line: "opens", "moves", "requires". */
export function relationshipLabel(rel: Relationship): string {
  if (rel.type === 'controls') {
    const action = rel.params.action ?? 'toggle';
    return action === 'toggle' ? 'opens/closes' : action === 'disappear' ? 'hides' : action === 'move' ? 'moves' : action === 'close' ? 'closes' : 'opens';
  }
  return relationshipRegistry.get(rel.type)?.verb ?? rel.type;
}

/** "Switch opens Door", "Switch moves Door 3 tiles up", plus parameters and conditions. */
export function describeRelationship(project: Project, scene: Scene | null, rel: Relationship): string {
  const t = relationshipRegistry.get(rel.type);
  const roles: Roles = rel.type === 'controls' ? { other: 'whoever uses it' } : rel.type === 'requires' ? { subject: 'whoever touches it' } : {};
  const source = describeRef(project, scene, rel.source);
  const target = describeRef(project, scene, rel.target);
  let text: string;
  if (rel.type === 'controls') {
    const action = rel.params.action ?? 'toggle';
    const offset = (rel.params.offset as { x: number; y: number } | undefined) ?? { x: 0, y: -96 };
    const speed = typeof rel.params.speed === 'number' ? rel.params.speed : 96;
    text =
      action === 'open'
        ? `${source} opens ${target}`
        : action === 'close'
          ? `${source} closes ${target}`
          : action === 'disappear'
            ? `${source} makes ${target} disappear (and come back when switched off)`
            : action === 'move'
              ? `${source} moves ${target} ${describeOffset(offset)}${speed === 0 ? ' at once' : speed !== 96 ? ` at ${speed} px/s` : ''} (and back when switched off)`
              : `${source} opens and closes ${target}`;
  } else {
    text = `${source} ${t?.verb ?? rel.type} ${target}`;
    const params = Object.entries(rel.params).filter(([k, v]) => JSON.stringify(v) !== JSON.stringify(t?.params[k]?.default));
    if (params.length) text += ` (${params.map(([k, v]) => `${k}: ${String(v)}`).join(', ')})`;
  }
  if (rel.conditions.length) text += `, only if ${joinAnd(rel.conditions.map((c) => describeCondition(project, scene, c, roles)))}`;
  return text;
}
