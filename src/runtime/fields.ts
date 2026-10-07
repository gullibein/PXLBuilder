/**
 * Reading and changing object data while playing (scripts' field(),
 * set_field, add_component, remove_component). The entity's resolved data
 * (`base`) is replaced copy-on-write, so the project is never touched, and
 * whatever the engine keeps worked out from that component (collision box,
 * health, controller, behaviors…) is read again, keeping what is going on
 * (current health, a patrol's direction, timers).
 */
import { TRANSFORM, resolveField, type FieldTarget } from '../core/script/fields';
import type { FieldSchema } from '../core/components/schema';
import type { Value } from './scripts';
import { entityFrom, readBehaviors, type Runtime, type RuntimeEntity } from './runtime';

const BEHAVIOR_COMPONENTS = new Set(['Patrol', 'Jumper', 'Shooter', 'MovingPlatform', 'Timer', 'DoubleJump', 'LedgeGrab']);

/** The value of "Component.field" (or "Transform.x"); null when it doesn't have that component. */
export function readField(rt: Runtime, e: RuntimeEntity, component: string, path: string): Value | { error: string } {
  const target = resolveField(rt.registry, component, path);
  if ('error' in target) return target;
  if (component === TRANSFORM) {
    const t = e.base.transform;
    switch (path) {
      case 'x':
        return e.x;
      case 'y':
        return e.y;
      case 'rotation':
        return t.rotation + e.angle;
      case 'scale.x':
        return t.scale.x;
      default:
        return t.scale.y;
    }
  }
  const props = e.base.components[component];
  if (!props) return null;
  const v = props[target.field];
  if (target.axis) return (v as { x: number; y: number })[target.axis];
  if (Array.isArray(v)) return v.join(',');
  return typeof v === 'number' || typeof v === 'boolean' || typeof v === 'string' ? v : null;
}

/** Turns a script value into what the field takes, or says why it can't. */
function coerce(schema: FieldSchema | null, axis: 'x' | 'y' | null, value: Value): { ok: unknown } | { error: string } {
  const asNumber = (): { ok: number } | { error: string } => {
    const n = typeof value === 'number' ? value : typeof value === 'boolean' ? (value ? 1 : 0) : typeof value === 'string' && value.trim() !== '' ? Number(value) : NaN;
    return Number.isFinite(n) ? { ok: n } : { error: `needs a number, got ${show(value)}` };
  };
  if (!schema || axis) return asNumber();
  switch (schema.kind) {
    case 'number': {
      const r = asNumber();
      if ('error' in r) return r;
      let n = r.ok;
      if (schema.min !== undefined) n = Math.max(schema.min, n);
      if (schema.max !== undefined) n = Math.min(schema.max, n);
      if (schema.integer) n = Math.round(n);
      return { ok: n };
    }
    case 'boolean':
      return { ok: value !== null && value !== false && value !== 0 && value !== '' };
    case 'string':
      return { ok: value === null ? '' : typeof value === 'object' ? value.name : String(value) };
    case 'enum':
      return typeof value === 'string' && schema.options.includes(value) ? { ok: value } : { error: `must be one of ${schema.options.join(', ')}, got ${show(value)}` };
    case 'color':
      return typeof value === 'string' && /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(value) ? { ok: value } : { error: `needs a color like "#ff8800", got ${show(value)}` };
    case 'assetRef':
      return { ok: typeof value === 'string' && value !== '' ? value : null };
    case 'stringList':
      return {
        ok: typeof value === 'string'
          ? value
              .split(',')
              .map((s) => s.trim())
              .filter(Boolean)
          : [],
      };
    case 'vec2':
      return { error: 'has two numbers: set ".x" and ".y" separately' };
  }
}

function show(v: Value): string {
  return v === null ? 'nothing' : typeof v === 'object' ? `the entity ${v.name}` : JSON.stringify(v);
}

/** Changes one field; returns an error message, or null when done. A thing without the component gets it first. */
export function writeField(rt: Runtime, e: RuntimeEntity, component: string, path: string, value: Value): string | null {
  const target = resolveField(rt.registry, component, path);
  if ('error' in target) return target.error;
  const v = coerce(target.schema, target.axis, value);
  if ('error' in v) return `${component}.${path} ${v.error}`;
  if (component === TRANSFORM) return writeTransform(rt, e, target, v.ok as number);

  const components = { ...e.base.components };
  const props = { ...(components[component] ?? rt.registry.createDefault(component)) };
  props[target.field] = target.axis ? { ...(props[target.field] as { x: number; y: number }), [target.axis]: v.ok } : v.ok;
  components[component] = props;
  e.base = { ...e.base, components };
  rederive(rt, e, component, target.field);
  return null;
}

function writeTransform(rt: Runtime, e: RuntimeEntity, target: FieldTarget, n: number): null {
  if (target.field === 'x' || target.field === 'y') {
    if (target.field === 'x') e.x = n;
    else e.y = n;
    if (e.collider && e.body !== 'dynamic') rt.markSolidsDirty();
    return null;
  }
  const t = e.base.transform;
  const transform = target.field === 'rotation' ? { ...t, rotation: n - e.angle } : { ...t, scale: { ...t.scale, [target.axis!]: n } };
  e.base = { ...e.base, transform };
  rt.refreshCollider(e);
  return null;
}

/** Gives it a component (with default values); nothing happens when it has it already. */
export function addComponent(rt: Runtime, e: RuntimeEntity, component: string): string | null {
  if (!rt.registry.has(component)) return `there is no component "${component}"`;
  if (e.base.components[component]) return null;
  e.base = { ...e.base, components: { ...e.base.components, [component]: rt.registry.createDefault(component) } };
  rederive(rt, e, component, null);
  return null;
}

export function removeComponent(rt: Runtime, e: RuntimeEntity, component: string): string | null {
  if (!rt.registry.has(component)) return `there is no component "${component}"`;
  if (!e.base.components[component]) return null;
  const components = { ...e.base.components };
  delete components[component];
  e.base = { ...e.base, components };
  rederive(rt, e, component, null);
  return null;
}

/** Adds or removes a tag (what damages what, what a door needs, what "player" is…). */
export function setTag(e: RuntimeEntity, tag: string, on: boolean): void {
  const has = e.tags.includes(tag);
  if (has === on) return;
  e.tags = on ? [...e.tags, tag] : e.tags.filter((t) => t !== tag);
  e.base = { ...e.base, tags: e.tags };
}

/**
 * Reads again what the engine works out from one component, keeping what is
 * going on. `field` is the field that changed (null: the whole component was
 * added or removed).
 */
function rederive(rt: Runtime, e: RuntimeEntity, component: string, field: string | null): void {
  const fresh = entityFrom(rt.project, e.base);
  switch (component) {
    case 'Collider':
      rt.refreshCollider(e);
      rt.markSolidsDirty();
      break;
    case 'PhysicsBody':
      e.body = fresh.body;
      if (field === null || field === 'gravityScale') {
        e.baseGravity = fresh.baseGravity;
        e.gravityScale = fresh.gravityScale;
      }
      if (field === 'velocity') {
        e.vx = fresh.vx;
        e.vy = fresh.vy;
      }
      // Whether it moves by physics decides how a turn collides.
      rt.refreshCollider(e);
      rt.markSolidsDirty();
      break;
    case 'CharacterController':
      e.controller = fresh.controller;
      break;
    case 'Climbable':
      e.climbable = fresh.climbable;
      rt.markSolidsDirty();
      break;
    case 'Openable':
      if (field === null) e.open = fresh.open;
      rt.markSolidsDirty();
      break;
    case 'Switch':
      e.switch = fresh.switch && { ...fresh.switch, on: e.switch?.on ?? fresh.switch.on, used: e.switch?.used ?? false };
      break;
    case 'Health':
      if (!fresh.health) e.health = null;
      else if (!e.health || field === null) e.health = fresh.health;
      else {
        e.health.max = fresh.health.max;
        if (field === 'currentHealth') e.health.current = fresh.health.current;
        e.health.current = Math.min(e.health.current, e.health.max);
      }
      break;
    case 'DamageReceiver':
      e.receiver = fresh.receiver;
      break;
    case 'Damage':
      e.damage = fresh.damage;
      break;
    case 'Inventory':
      if (!fresh.inventory) e.inventory = null;
      else if (!e.inventory || field === 'items') e.inventory = fresh.inventory;
      break;
    case 'Collectible':
      e.collectible = fresh.collectible;
      break;
    case 'Stompable':
      e.stompable = fresh.stompable;
      break;
    default:
      if (BEHAVIOR_COMPONENTS.has(component)) rederiveBehaviors(e);
      // Everything else (Sprite, SpriteStates, Goal, …) is read from `base` as it is used.
      break;
  }
}

function rederiveBehaviors(e: RuntimeEntity): void {
  const now = readBehaviors(e.base.components, { x: e.x, y: e.y });
  const old = e.beh;
  e.beh = {
    patrol: now.patrol && (old.patrol ? { ...now.patrol, originX: old.patrol.originX, originY: old.patrol.originY, dir: old.patrol.dir } : now.patrol),
    jumper: now.jumper && (old.jumper ? { ...now.jumper, t: old.jumper.t } : now.jumper),
    shooter: now.shooter && (old.shooter ? { ...now.shooter, t: old.shooter.t } : now.shooter),
    mover: now.mover && (old.mover ? { ...now.mover, originX: old.mover.originX, originY: old.mover.originY, toEnd: old.mover.toEnd, wait: old.mover.wait } : now.mover),
    timer: now.timer && (old.timer ? { ...now.timer, t: old.timer.t, done: old.timer.done } : now.timer),
    doubleJump: now.doubleJump && (old.doubleJump ? { ...now.doubleJump, left: Math.min(old.doubleJump.left, now.doubleJump.extra) } : now.doubleJump),
    ledgeGrab: now.ledgeGrab,
  };
}
