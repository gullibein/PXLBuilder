/**
 * Game logic during play: the event system, the built-in gameplay systems
 * (touching, collecting, damage and death, switches, doors), the relationships
 * that have a meaning in play, and the level's rules.
 *
 * Everything that happens is an event. Systems emit events; relationship
 * handlers and rules react to them, and their actions may emit more events.
 * Events are processed in order, once per step, with a cap so a rule that
 * keeps triggering itself cannot freeze the game. Every event is logged.
 */
import { itemNameOf } from '../core/graph/graph';
import { refMatches, type EventEntities } from '../core/logic/refs';
import { relationshipRegistry } from '../core/logic/vocabulary';
import { findSound } from '../core/script/language';
import type { Condition, EntityRef, Project, Relationship, RuleAction, Scene } from '../core/types';
import type { InputState } from './input';
import { overlaps, type Box } from './physics';
import type { Runtime, RuntimeEntity } from './runtime';

export interface GameEvent {
  type: string;
  subject: RuntimeEntity | null;
  other: RuntimeEntity | null;
  detail?: Record<string, unknown>;
}

/** An event as recorded in the log (names, not live entities). */
export interface LoggedEvent {
  time: number;
  type: string;
  subject: string | null;
  other: string | null;
  /** Ids of the subject and other (names can repeat: "Enemy", "Enemy"). */
  subjectId?: string;
  otherId?: string;
  detail?: Record<string, unknown>;
}

export interface Message {
  text: string;
  until: number;
}

const MAX_EVENTS_PER_STEP = 200;
const MAX_LOG = 2000;
const KNOCKBACK = { x: 160, y: 220 };
/** How long a knock back shoves (seconds); with gravity it lasts until landing. */
const KNOCK_TIME = 0.15;
/** Touching includes standing on something or pressing against it. */
const TOUCH_SLOP = 0.5;
/** How far below a stompable's top the feet may have been and still count as landing on it. */
const STOMP_SLOP = 6;

export class Gameplay {
  readonly log: LoggedEvent[] = [];
  messages: Message[] = [];
  private queue: GameEvent[] = [];
  private restarting = false;

  constructor(
    private readonly rt: Runtime,
    private readonly project: Project,
    private readonly scene: Scene,
  ) {}

  emit(type: string, subject: RuntimeEntity | null, other: RuntimeEntity | null = null, detail?: Record<string, unknown>): void {
    this.queue.push({ type, subject, other, detail });
  }

  /** Called once per step, after everything has moved. */
  update(dt: number, input: InputState): void {
    for (const e of this.rt.entities) {
      if (e.invincible > 0) e.invincible = Math.max(0, e.invincible - dt);
      if (e.stompGrace > 0) e.stompGrace = Math.max(0, e.stompGrace - dt);
    }
    this.updateTouches();
    this.useSwitches(input);
    this.collectAndHurt();
    this.process();
    this.messages = this.messages.filter((m) => m.until > this.rt.time);
  }

  /**
   * "Enemy follows Player": before things move, each follower heads for the
   * nearest of its targets that is within range. Walkers only steer
   * sideways (gravity and the ground do the rest); flyers (no gravity) go
   * straight at it.
   */
  steer(): void {
    for (const r of this.relationships('follows')) {
      const speed = typeof r.params.speed === 'number' ? r.params.speed : 80;
      const range = typeof r.params.range === 'number' ? r.params.range : 320;
      const targets = this.resolve(r.target, {});
      for (const f of this.resolve(r.source, {})) {
        if (f.body !== 'dynamic' || f.controller || f.invincible > 0) continue;
        f.chasing = false;
        let best: RuntimeEntity | null = null;
        let bestD = Infinity;
        for (const t of targets) {
          if (t === f) continue;
          const d = Math.hypot(t.x - f.x, t.y - f.y);
          if (d < bestD) {
            best = t;
            bestD = d;
          }
        }
        const flying = this.rt.floats(f);
        if (!best || (range > 0 && bestD > range) || !this.check(r.conditions, { subject: f, other: best })) {
          f.vx = 0;
          if (flying) f.vy = 0;
          continue;
        }
        const dx = best.x - f.x;
        const dy = best.y - f.y;
        if (flying) {
          const d = Math.hypot(dx, dy);
          f.vx = d > 2 ? (dx / d) * speed : 0;
          f.vy = d > 2 ? (dy / d) * speed : 0;
          if (d > 2) f.heading = Math.abs(dy) > Math.abs(dx) ? { x: 0, y: Math.sign(dy) } : { x: Math.sign(dx), y: 0 };
        } else {
          f.vx = Math.abs(dx) > 2 ? Math.sign(dx) * speed : 0;
        }
        f.chasing = true;
        if (Math.abs(dx) > 2) f.facing = dx < 0 ? -1 : 1;
      }
    }
  }

  /** Drops pending events (the level restarted) and announces the start. */
  reset(): void {
    this.queue = [];
    this.restarting = true;
    this.emit('level_started', null);
  }

  // ---------------------------------------------------------------- systems

  private updateTouches(): void {
    const alive = this.rt.entities.filter((e) => e.alive && e.collider);
    for (const e of alive) {
      if (e.body !== 'dynamic') continue;
      const box = this.rt.boxOf(e)!;
      const grown: Box = { ...box, hw: box.hw + TOUCH_SLOP, hh: box.hh + TOUCH_SLOP };
      const now = new Set<string>();
      for (const o of alive) {
        if (o === e) continue;
        if (overlaps(grown, this.rt.boxOf(o)!)) now.add(o.id);
      }
      for (const id of now) if (!e.touching.has(id)) this.emit('touch_started', e, this.rt.byId(id));
      for (const id of e.touching) if (!now.has(id)) this.emit('touch_ended', e, this.rt.byId(id));
      e.touching = now;
    }
  }

  private useSwitches(input: InputState): void {
    if (!input.wasPressed('interact')) return;
    for (const e of this.rt.entities) {
      if (!e.alive || !e.controller) continue;
      for (const id of e.touching) {
        const s = this.rt.byId(id);
        if (s?.alive && s.switch?.activation === 'interact') this.activate(s, e);
      }
    }
  }

  private activate(s: RuntimeEntity, user: RuntimeEntity): void {
    const sw = s.switch!;
    if (sw.once && sw.used) return;
    sw.used = true;
    sw.on = !sw.on;
    this.emit('switch_activated', s, user, { on: sw.on });
  }

  /** Continuous contact effects: stomping first (so a stomp is never also a hit), then picking up and getting hurt. */
  private collectAndHurt(): void {
    for (const e of this.rt.entities) {
      if (!e.alive || e.body !== 'dynamic') continue;
      for (const id of e.touching) {
        const o = this.rt.byId(id);
        if (o?.alive && o.stompable && this.landedOn(e, o)) this.stomp(e, o);
      }
    }
    for (const e of this.rt.entities) {
      if (!e.alive || e.body !== 'dynamic') continue;
      for (const id of e.touching) {
        const o = this.rt.byId(id);
        if (!o?.alive || !e.alive) continue;
        // Shots hit in the behavior system (once, then they're gone).
        if (o.projectile || e.projectile) continue;
        if (o.collectible && this.canCollect(e, o)) this.collect(e, o);
        else {
          this.tryHurt(o, e);
          this.tryHurt(e, o);
        }
      }
    }
  }

  /** `e` came down onto the top of `o` and may stomp it. */
  private landedOn(e: RuntimeEntity, o: RuntimeEntity): boolean {
    // Without gravity there is no landing on top (walking into it from above is just touching it).
    if (!e.alive || e.vy < 0 || this.rt.floats(e) || !e.tags.some((t) => o.stompable!.stompers.includes(t))) return false;
    const eb = this.rt.boxOf(e);
    const ob = this.rt.boxOf(o);
    if (!eb || !ob) return false;
    const prevFeet = e.prevY + (eb.y - e.y) + eb.hh;
    return prevFeet <= ob.y - ob.hh + STOMP_SLOP;
  }

  private stomp(stomper: RuntimeEntity, o: RuntimeEntity): void {
    const s = o.stompable!;
    stomper.vy = -s.bounce;
    stomper.grounded = false;
    // Landing on it is never also a hit from it.
    stomper.stompGrace = 0.2;
    this.emit('stomped', o, stomper);
    if (s.damage > 0 && o.health) {
      if (o.invincible <= 0) this.hurt(o, s.damage, null);
    } else {
      this.emit('died', o, stomper);
      o.alive = false;
      this.rt.markSolidsDirty();
    }
  }

  private relationships(type: string): Relationship[] {
    return this.scene.relationships.filter((r) => r.type === type);
  }

  private canCollect(collector: RuntimeEntity, item: RuntimeEntity): boolean {
    if (collector.inventory) return true;
    return this.relationships('collects').some((r) => refMatches(r.source, collector) && refMatches(r.target, item) && this.check(r.conditions, { subject: collector, other: item }));
  }

  private collect(collector: RuntimeEntity, item: RuntimeEntity): void {
    item.alive = false;
    this.rt.markSolidsDirty();
    if (item.collectible!.keep) this.addItem(collector, item.collectible!.item, 1);
    this.emit('collected', collector, item, { item: item.collectible!.item });
  }

  /** `attacker` hurts `victim` if the victim accepts its damage (by tag) or a "damages" relationship says so. */
  tryHurt(attacker: RuntimeEntity, victim: RuntimeEntity): boolean {
    if (!victim.health || victim.invincible > 0 || victim.stompGrace > 0 || !attacker.alive) return false;
    if (attacker.projectile?.owner === victim.id) return false;
    let amount = 0;
    const rel = this.relationships('damages').find((r) => refMatches(r.source, attacker) && refMatches(r.target, victim) && this.check(r.conditions, { subject: victim, other: attacker }));
    if (rel) amount = Number(rel.params.amount ?? 1);
    else if (attacker.damage !== null && victim.receiver && attacker.tags.some((t) => victim.receiver!.sources.includes(t))) amount = attacker.damage;
    if (amount <= 0) return false;
    this.hurt(victim, amount, attacker);
    return true;
  }

  hurt(victim: RuntimeEntity, amount: number, source: RuntimeEntity | null): void {
    if (!victim.health || !victim.alive) return;
    victim.health.current = Math.max(0, victim.health.current - amount);
    victim.hurtAt = this.rt.time;
    victim.invincible = victim.receiver?.invincibility ?? 1;
    // Heavier things are shoved less.
    const strength = (victim.receiver?.knockback ?? KNOCKBACK.x) / victim.mass;
    if (victim.body === 'dynamic' && source && strength > 0) {
      // A small knock back, away from what hurt it (seen from above: straight away from it), for a moment.
      const restore = victim.knock?.restore ?? { vx: victim.vx, vy: victim.vy };
      if (this.rt.floats(victim)) {
        const dx = victim.x - source.x;
        const dy = victim.y - source.y;
        const d = Math.hypot(dx, dy) || 1;
        victim.vx = (d > 0.5 ? dx / d : victim.facing === 1 ? -1 : 1) * strength;
        victim.vy = d > 0.5 ? (dy / d) * strength : 0;
      } else {
        victim.vx = (victim.x >= source.x ? 1 : -1) * strength;
        victim.vy = -KNOCKBACK.y * (strength / KNOCKBACK.x);
      }
      victim.knock = { t: KNOCK_TIME, restore };
      victim.climbing = false;
    }
    this.emit('damaged', victim, source, { amount, health: victim.health.current });
    if (victim.health.current <= 0) {
      this.emit('died', victim, source);
      // Characters come back at their start; anything else is gone.
      if (victim.controller) this.rt.respawn(victim, 'died');
      else {
        victim.alive = false;
        this.rt.markSolidsDirty();
      }
    }
  }

  /**
   * Moves `e` onto `to`: centered on it, with its feet where `to`'s bottom is.
   * Whatever it overlaps on arrival counts as already touched, so arriving on
   * a teleporter doesn't send it straight back.
   */
  private teleport(e: RuntimeEntity, to: RuntimeEntity): void {
    if (!e.alive) return;
    const eb = this.rt.boxOf(e);
    const tb = this.rt.boxOf(to);
    e.x = to.x;
    e.y = tb && eb ? tb.y + tb.hh - eb.hh - (eb.y - e.y) : to.y;
    e.vx = 0;
    e.vy = 0;
    e.climbing = false;
    e.touching = this.overlapping(e);
    this.emit('teleported', e, to);
  }

  private overlapping(e: RuntimeEntity): Set<string> {
    const box = this.rt.boxOf(e);
    const out = new Set<string>();
    if (!box) return out;
    const grown: Box = { ...box, hw: box.hw + TOUCH_SLOP, hh: box.hh + TOUCH_SLOP };
    for (const o of this.rt.entities) if (o !== e && o.alive && o.collider && overlaps(grown, this.rt.boxOf(o)!)) out.add(o.id);
    return out;
  }

  addItem(e: RuntimeEntity, item: string, count: number): void {
    e.inventory ??= new Map();
    e.inventory.set(item, (e.inventory.get(item) ?? 0) + count);
  }

  takeItem(e: RuntimeEntity, item: string, count: number): void {
    if (!e.inventory) return;
    const left = (e.inventory.get(item) ?? 0) - count;
    if (left > 0) e.inventory.set(item, left);
    else e.inventory.delete(item);
  }

  /** Taken out of play by a switch or a rule (and brought back by them); things removed any other way stay gone. */
  setHidden(e: RuntimeEntity, hidden: boolean): void {
    if (hidden && e.alive) {
      e.alive = false;
      e.hiddenBySwitch = true;
    } else if (!hidden && e.hiddenBySwitch) {
      e.alive = true;
      e.hiddenBySwitch = false;
    } else return;
    this.rt.markSolidsDirty();
  }

  setOpen(e: RuntimeEntity, open: boolean, by: RuntimeEntity | null): void {
    if (e.open === open || !e.alive) return;
    e.open = open;
    this.rt.markSolidsDirty();
    this.emit(open ? 'opened' : 'closed', e, by);
  }

  // ---------------------------------------------------------------- events

  private process(): void {
    let handled = 0;
    while (this.queue.length) {
      if (++handled > MAX_EVENTS_PER_STEP) {
        this.queue = [];
        this.record({ type: 'stopped_runaway_rules', subject: null, other: null, detail: { limit: MAX_EVENTS_PER_STEP } });
        break;
      }
      const ev = this.queue.shift()!;
      this.record(ev);
      this.restarting = false;
      this.react(ev);
      this.runRules(ev);
      if (!this.restarting) this.rt.scripts.onEvent(ev);
      if (this.restarting) {
        // The level restarted: what was pending belonged to the old run.
        this.queue = this.queue.filter((q) => q.type === 'level_started');
      }
    }
  }

  private record(ev: GameEvent): void {
    const logged: LoggedEvent = {
      time: Math.round(this.rt.time * 1000) / 1000,
      type: ev.type,
      subject: ev.subject?.name ?? null,
      other: ev.other?.name ?? null,
      ...(ev.subject ? { subjectId: ev.subject.id } : {}),
      ...(ev.other ? { otherId: ev.other.id } : {}),
      ...(ev.detail ? { detail: ev.detail } : {}),
    };
    this.log.push(logged);
    if (this.log.length > MAX_LOG) this.log.splice(0, this.log.length - MAX_LOG);
    this.rt.onLog?.(logged);
  }

  /** Built-in reactions: what relationships mean during play. */
  private react(ev: GameEvent): void {
    if (ev.type === 'touch_started' && ev.subject && ev.other) {
      const [toucher, touched] = [ev.subject, ev.other];
      if (touched.switch?.activation === 'touch' && toucher.controller) this.activate(touched, toucher);
      // A Goal wins the level for the player who reaches it.
      if (touched.base.components.Goal && toucher.controller) this.rt.completeLevel(toucher);
      // "Door requires Key": opens for whoever touches it carrying the item.
      for (const r of this.relationships('requires')) {
        if (!refMatches(r.source, touched) || touched.open) continue;
        const item = this.itemOfRef(r.target);
        if (!item) continue;
        if ((toucher.inventory?.get(item) ?? 0) < 1) {
          // Worth knowing when something doesn't open ("why won't this door open?").
          if (toucher.controller) this.emit('locked', touched, toucher, { needs: item });
          continue;
        }
        if (!this.check(r.conditions, { subject: toucher, other: touched })) continue;
        if (r.params.consume === true) this.takeItem(toucher, item, 1);
        this.setOpen(touched, true, toucher);
      }
    }
    if (ev.type === 'touch_started' && ev.subject && ev.other) {
      // "Teleporter A teleports to Teleporter B".
      for (const r of this.relationships('teleports_to')) {
        if (!refMatches(r.source, ev.other) || !this.check(r.conditions, { subject: ev.subject, other: ev.other })) continue;
        const to = this.resolve(r.target, ev).find((t) => t !== ev.other);
        if (to) {
          this.teleport(ev.subject, to);
          break;
        }
      }
    }
    if (ev.type === 'switch_activated' && ev.subject) {
      // "Switch controls Door".
      for (const r of this.relationships('controls')) {
        if (!refMatches(r.source, ev.subject)) continue;
        if (!this.check(r.conditions, { subject: ev.subject, other: ev.other })) continue;
        const on = ev.subject.switch?.on ?? true;
        const action = r.params.action ?? 'toggle';
        // Disappeared targets are still found, so switching off can bring them back.
        for (const t of this.resolve(r.target, ev, action === 'disappear')) {
          if (action === 'disappear') this.setHidden(t, on);
          else if (action === 'move') {
            const offset = (r.params.offset as { x: number; y: number } | undefined) ?? { x: 0, y: -96 };
            this.rt.moveTo(t, on ? { x: t.spawn.x + offset.x, y: t.spawn.y + offset.y } : { ...t.spawn }, typeof r.params.speed === 'number' ? r.params.speed : 96);
          } else this.setOpen(t, action === 'open' ? true : action === 'close' ? false : !t.open, ev.subject);
        }
      }
    }
  }

  private runRules(ev: GameEvent): void {
    const ctx: EventEntities = { subject: ev.subject, other: ev.other };
    for (const rule of this.scene.rules) {
      if (!rule.enabled || rule.when.event !== ev.type) continue;
      if (rule.when.subject.kind !== 'any' && !(ev.subject && refMatches(rule.when.subject, ev.subject, ctx))) continue;
      if (rule.when.other.kind !== 'any' && !(ev.other && refMatches(rule.when.other, ev.other, ctx))) continue;
      if (!this.check(rule.conditions, ctx)) continue;
      for (const a of rule.actions) {
        this.act(a, ev);
        if (this.restarting) return;
      }
    }
  }

  /** The live entities a reference points at, in the context of an event. */
  private resolve(ref: EntityRef, ev: EventEntities, includeRemoved = false): RuntimeEntity[] {
    if (ref.kind === 'subject') return ev.subject ? [ev.subject as RuntimeEntity] : [];
    if (ref.kind === 'other') return ev.other ? [ev.other as RuntimeEntity] : [];
    return this.rt.entities.filter((e) => (includeRemoved || e.alive) && refMatches(ref, e, ev));
  }

  check(conditions: Condition[], ev: EventEntities): boolean {
    return conditions.every((c) => {
      const who = this.resolve(c.entity, ev);
      let ok: boolean;
      switch (c.type) {
        case 'has_item':
          ok = who.some((e) => (e.inventory?.get(c.item) ?? 0) >= c.count);
          break;
        case 'health':
          ok = who.some((e) => e.health !== null && compare(e.health.current, c.compare, c.value));
          break;
        case 'is_open':
          ok = who.some((e) => e.open);
          break;
        case 'switch_on':
          ok = who.some((e) => e.switch?.on === true);
          break;
        case 'none_left':
          // (resolve finds only what is in play; hidden things don't count as left.)
          ok = who.length === 0;
          break;
      }
      return c.not ? !ok : ok;
    });
  }

  private act(a: RuleAction, ev: GameEvent): void {
    const targets = () => ('target' in a && a.target ? this.resolve(a.target, ev, a.type === 'respawn') : []);
    switch (a.type) {
      case 'open':
      case 'close':
      case 'toggle':
        for (const t of targets()) this.setOpen(t, a.type === 'open' ? true : a.type === 'close' ? false : !t.open, ev.subject);
        break;
      case 'remove':
        for (const t of targets()) {
          t.alive = false;
          this.rt.markSolidsDirty();
        }
        break;
      case 'spawn': {
        const at = a.at ? this.resolve(a.at, ev)[0] : null;
        if (a.at && !at) break;
        const e = this.rt.spawn(a.object, at ? { x: at.x, y: at.y } : { x: a.x, y: a.y });
        if (e) this.emit('spawned', e, ev.subject);
        break;
      }
      case 'damage':
        for (const t of targets()) this.hurt(t, a.amount, null);
        break;
      case 'heal':
        for (const t of targets()) if (t.health) t.health.current = Math.min(t.health.max, t.health.current + a.amount);
        break;
      case 'give_item':
        for (const t of targets()) this.addItem(t, a.item, a.count);
        break;
      case 'take_item':
        for (const t of targets()) this.takeItem(t, a.item, a.count);
        break;
      case 'respawn':
        for (const t of targets()) this.rt.respawn(t, 'rule');
        break;
      case 'teleport': {
        const to = this.resolve(a.to, ev)[0];
        if (to) for (const t of targets()) this.teleport(t, to);
        break;
      }
      case 'restart_level':
        this.rt.restart();
        break;
      case 'complete_level':
        this.rt.completeLevel(ev.subject);
        break;
      case 'show':
        for (const t of this.resolve(a.target, ev, true)) this.setHidden(t, false);
        break;
      case 'hide':
        for (const t of targets()) this.setHidden(t, true);
        break;
      case 'show_message':
        this.messages.push({ text: a.text, until: this.rt.time + a.seconds });
        break;
      case 'play_sound': {
        const sound = findSound(this.project, a.sound);
        if (sound && this.rt.soundQueue.length < 16) {
          this.rt.soundQueue.push({ assetId: sound.id, volume: a.volume, pitch: 1 });
          this.rt.soundsPlayed++;
        }
        break;
      }
      case 'camera_shake':
        this.rt.cam.startShake(a.strength, a.seconds);
        break;
      case 'camera_flash':
        this.rt.cam.startFlash(a.color, a.seconds);
        break;
      case 'camera_zoom':
        this.rt.cam.zoomTo(a.zoom, a.seconds);
        break;
      case 'camera_focus': {
        const t = this.resolve(a.target, ev)[0];
        if (t) this.rt.cam.focusOn(t, a.seconds);
        break;
      }
      case 'camera_follow':
        this.rt.cam.follow(a.target ? (this.resolve(a.target, ev)[0] ?? null) : null);
        break;
    }
  }

  /** The item a "requires" target stands for: what that object gives when collected (or the tag itself). */
  private itemOfRef(ref: EntityRef): string | null {
    if (ref.kind === 'tag') return ref.tag;
    if (ref.kind === 'object') {
      const def = this.project.definitions.find((d) => d.id === ref.id);
      return def ? (itemNameOf(def.components, def.name) ?? def.name.toLowerCase()) : null;
    }
    if (ref.kind === 'entity') {
      const e = this.rt.entities.find((x) => x.id === ref.id);
      if (!e) return null;
      const objectName = this.project.definitions.find((d) => d.id === e.definitionId)?.name ?? e.name;
      return itemNameOf(e.base.components, objectName) ?? objectName.toLowerCase();
    }
    return null;
  }
}

function compare(a: number, op: Condition extends infer C ? (C extends { compare: infer O } ? O : never) : never, b: number): boolean {
  switch (op) {
    case '<':
      return a < b;
    case '<=':
      return a <= b;
    case '==':
      return a === b;
    case '>=':
      return a >= b;
    case '>':
      return a > b;
  }
}

/** Whether a relationship type does anything during play (others only describe the design). */
export function isSimulated(type: string): boolean {
  return relationshipRegistry.get(type)?.simulated === true;
}
