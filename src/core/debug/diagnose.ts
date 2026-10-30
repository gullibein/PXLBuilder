/**
 * Finds things in a level that are set up but cannot work in play: a door
 * that needs a key nothing gives, damage nothing accepts, a "switch" that is
 * not a switch, a script statement that changes nothing. Each problem says
 * what is wrong in plain words; the editor lists them and the AI gets them
 * with every request, so it can explain and fix them.
 *
 * Every check mirrors what the runtime actually does (runtime/gameplay.ts,
 * runtime/scripts.ts); a check that could be wrong is left out rather than
 * reported as a guess.
 */
import { touchHarm } from '../model/ruleScripts';
import type { ComponentRegistry } from '../components/registry';
import { itemNameOf } from '../graph/graph';
import { resolveRef } from '../logic/refs';
import { relationshipRegistry } from '../logic/vocabulary';
import { getWorldBounds } from '../model/geometry';
import { reachabilityProblems } from '../model/reachability';
import { resolveEntity, type ResolvedEntity } from '../model/resolve';
import { checkScript, type Stmt } from '../script/language';
import type { BehaviorScript, EntityRef, Id, Project, Scene } from '../types';

export interface Problem {
  /** Stable for the same problem (for lists and tests). */
  key: string;
  severity: 'error' | 'warning' | 'note';
  text: string;
  /** The placed entities it is about (to select them). */
  entityIds: Id[];
}

interface Placed {
  id: Id;
  name: string;
  definitionId: Id | null;
  r: ResolvedEntity;
}


/** A script that reacts to the keys (a key handler, or key()/pressed() in an expression). */
function readsKeys(script: BehaviorScript): boolean {
  const text = JSON.stringify(script.handlers);
  return text.includes('"on":"key"') || /\b(key|pressed)\(/.test(text);
}

export function diagnoseLevel(project: Project, sceneId: Id, registry: ComponentRegistry): Problem[] {
  const scene = project.scenes.find((s) => s.id === sceneId);
  if (!scene) return [];
  const placed: Placed[] = scene.entities.map((e) => ({ id: e.id, name: e.name, definitionId: e.definitionId, r: resolveEntity(project, e, registry) }));
  const has = (p: Placed, c: string) => !!p.r.components[c];
  const out: Problem[] = [];
  const add = (key: string, severity: Problem['severity'], text: string, entityIds: Id[]) => {
    if (!out.some((p) => p.key === key)) out.push({ key, severity, text, entityIds });
  };
  /** "Spikes" or "Spikes (3 copies)". */
  const label = (group: Placed[]) => (group.length > 1 && group.every((g) => g.name === group[0].name) ? `${group[0].name} (${group.length} copies)` : group.map((g) => g.name).join(', '));
  /** Groups entities by object, so a problem shared by every copy is reported once. */
  const byObject = (list: Placed[]) => {
    const groups = new Map<string, Placed[]>();
    for (const p of list) {
      const k = p.definitionId ?? p.id;
      groups.set(k, [...(groups.get(k) ?? []), p]);
    }
    return [...groups.entries()];
  };
  const matching = (ref: EntityRef) => {
    const ids = new Set(resolveRef(project, scene, ref).map((e) => e.id));
    return placed.filter((p) => ids.has(p.id));
  };
  const refName = (ref: EntityRef) => {
    if (ref.kind === 'tag') return `anything tagged "${ref.tag}"`;
    if (ref.kind === 'object') return project.definitions.find((d) => d.id === ref.id)?.name ?? 'a missing object';
    if (ref.kind === 'entity') return placed.find((p) => p.id === ref.id)?.name ?? 'a deleted entity';
    return ref.kind;
  };

  // ---- the player
  const players = placed.filter((p) => has(p, 'CharacterController'));
  // A game played through its scripts (a falling-block puzzle, a board game: keys read by a script) needs no player.
  const scriptControlled = placed.some((p) => p.r.scripts.some(readsKeys));
  if (placed.length && !players.length && !scriptControlled) add('no-player', 'warning', 'There is no player in this level (nothing has a Character Controller), so nothing can be controlled in play. Each level needs its own copy: place the Player object here, on solid ground at the start.', []);

  // ---- what gives which items
  const itemsGiven = new Set<string>();
  for (const p of placed) {
    const c = p.r.components.Collectible;
    if (c && c.collectionBehavior !== 'consume') itemsGiven.add(itemNameOf(p.r.components, objectName(project, p))!);
    const start = p.r.components.Inventory?.items;
    if (Array.isArray(start)) for (const i of start) if (typeof i === 'string') itemsGiven.add(i);
  }
  for (const rule of scene.rules) for (const a of rule.actions) if (a.type === 'give_item') itemsGiven.add(a.item);
  for (const s of allScripts(project, scene)) walk(s.handlers.flatMap((h) => h.do), (st) => st.do === 'give_item' && itemsGiven.add(st.item));

  const canCollect = (item: Placed) => players.some((p) => has(p, 'Inventory')) || placed.some((p) => has(p, 'Inventory') && p.id !== item.id) || scene.relationships.some((r) => r.type === 'collects' && matching(r.target).some((t) => t.id === item.id));
  for (const [defId, group] of byObject(placed.filter((p) => has(p, 'Collectible')))) {
    if (!canCollect(group[0])) add(`uncollectable:${defId}`, 'warning', `${label(group)} can't be picked up: nothing in the level has an Inventory, and no "collects" connection points at it.`, group.map((g) => g.id));
  }

  // ---- connections
  for (const r of scene.relationships) {
    const type = relationshipRegistry.get(r.type);
    const sources = matching(r.source);
    const targets = matching(r.target);
    const ids = [...sources, ...targets].map((p) => p.id);
    if (type && !type.simulated) {
      add(`unsimulated:${r.id}`, 'note', `"${refName(r.source)} ${type.verb} ${refName(r.target)}" is only recorded in the design; it does nothing in play yet.`, ids);
      continue;
    }
    if (r.type === 'requires') {
      const item = itemOfRef(project, scene, r.target);
      if (item && !itemsGiven.has(item)) {
        add(`requires-nothing-gives:${r.id}`, 'error', `${refName(r.source)} only opens for someone carrying "${item}", but nothing in this level gives "${item}" (no ${refName(r.target)} to pick up, no rule or script that gives it), so it can never open.`, ids);
      }
      const notOpenable = sources.filter((p) => !has(p, 'Openable'));
      if (notOpenable.length) add(`requires-not-openable:${r.id}`, 'warning', `${label(notOpenable)} needs an item to open but has no Openable component, so it keeps blocking even when it "opens".`, notOpenable.map((p) => p.id));
    }
    if (r.type === 'controls') {
      const notSwitch = sources.filter((p) => !has(p, 'Switch'));
      if (sources.length && notSwitch.length === sources.length) add(`controls-no-switch:${r.id}`, 'error', `${label(notSwitch)} controls ${refName(r.target)}, but has no Switch component, so it can never be used and the connection never does anything.`, ids);
      const action = r.params.action ?? 'toggle';
      if (action === 'open' || action === 'close' || action === 'toggle') {
        const notOpenable = targets.filter((p) => !has(p, 'Openable'));
        if (notOpenable.length) add(`controls-not-openable:${r.id}`, 'warning', `The switch is set to ${action} ${label(notOpenable)}, which has no Openable component, so it keeps blocking.`, notOpenable.map((p) => p.id));
      }
    }
    if (r.type === 'damages') {
      const noHealth = targets.filter((p) => !has(p, 'Health'));
      if (noHealth.length) add(`damages-no-health:${r.id}`, 'error', `${refName(r.source)} is set to hurt ${label(noHealth)}, which has no Health, so it can't be hurt.`, noHealth.map((p) => p.id));
    }
    // (A "requires" item need not be placed: a rule or script may give it; checked above.)
    if (sources.length === 0 || (targets.length === 0 && r.type !== 'requires')) {
      const missing = sources.length === 0 ? r.source : r.target;
      add(`dangling:${r.id}`, 'warning', `A "${type?.verb ?? r.type}" connection points at ${refName(missing)}, which isn't in this level, so it does nothing here.`, ids);
    }
  }

  // ---- damage that can't land
  const receivers = placed.filter((p) => has(p, 'DamageReceiver'));
  for (const [defId, group] of byObject(placed.filter((p) => touchHarm(p.r.scripts)))) {
    const who = touchHarm(group[0].r.scripts)!.who;
    const canBeHurt = placed.some((v) => v.id !== group[0].id && has(v, 'Health') && (who.length === 0 || who.some((t) => v.r.tags.includes(t))));
    if (!canBeHurt) {
      add(`damage-unaccepted:${defId}`, 'warning', `${label(group)} hurts what touches it, but nothing in this level that it hurts (${who.length ? `things tagged ${who.map((t) => `"${t}"`).join(' or ')}` : 'anything'}) has Health.`, group.map((g) => g.id));
    }
  }
  for (const [defId, group] of byObject(receivers.filter((p) => !has(p, 'Health')))) {
    add(`receiver-no-health:${defId}`, 'warning', `${label(group)} has a Damage Receiver but no Health, so it can't be hurt.`, group.map((g) => g.id));
  }

  // ---- scripts
  for (const p of placed) {
    for (const script of p.r.scripts) {
      const checked = checkScript(script, project);
      if ('error' in checked) {
        add(`script-invalid:${p.definitionId ?? p.id}:${script.id}`, 'error', `${p.name}'s script "${script.name}" no longer checks out and is not run: ${checked.error}`, [p.id]);
        continue;
      }
      // A script that steps the player itself while its Character Controller still walks it with the same keys:
      // both move it (between steps the controller nudges it off its square, and a glide from there can cut through a wall).
      const ctrlSpeed = Number(p.r.components.CharacterController?.speed ?? 0);
      if (ctrlSpeed > 0) {
        const text = JSON.stringify(script.handlers);
        const readsMoveKeys = /key\((['"])(left|right|up|down)\1\)/.test(text);
        let movesSelf = false;
        walk(script.handlers.flatMap((h) => h.do), (st) => {
          if ((st.do === 'glide_to' || st.do === 'position') && st.on === null) movesSelf = true;
        });
        if (readsMoveKeys && movesSelf) {
          add(
            `script-and-controller-move:${p.definitionId ?? p.id}:${script.id}`,
            'warning',
            `${p.name}'s script "${script.name}" moves it with the arrow keys itself, but its Character Controller also walks it with them (speed ${ctrlSpeed}): both move it, so it gets nudged off its square, and a glide from there can go straight through a wall. Set the Character Controller's speed to 0 (keep the controller: it is what makes ${p.name} the player).`,
            [p.id],
          );
        }
      }
      const dynamic = p.r.components.PhysicsBody?.bodyType === 'dynamic';
      const walks = has(p, 'CharacterController') || has(p, 'Patrol');
      walk(
        script.handlers.flatMap((h) => h.do),
        (st) => {
          if (!('on' in st) || st.on !== null) return;
          if (st.do === 'speed_factor' && !walks) add(`script-speed-self:${p.definitionId ?? p.id}:${script.id}`, 'warning', `${p.name}'s script "${script.name}" changes its own walking speed, but ${p.name} doesn't walk (no Character Controller or Patrol). To slow down whatever touches it, the statement needs "on": "other".`, [p.id]);
          if (st.do === 'gravity' && !dynamic) add(`script-gravity-self:${p.definitionId ?? p.id}:${script.id}`, 'warning', `${p.name}'s script "${script.name}" changes its own gravity, but ${p.name} doesn't fall (its body isn't dynamic). To change the gravity of whatever touches it, the statement needs "on": "other".`, [p.id]);
        },
        true,
      );
    }
  }

  // ---- solid things on top of each other (a block hidden under a wall): what is underneath can't be seen, but
  // scripts still find it there (thing_at), so a player that digs or collects it walks into the wall.
  const solids = placed.filter((p) => {
    const c = p.r.components.Collider;
    return c && !c.isTrigger && Number(p.r.components.Sprite?.layer ?? 0) >= 0;
  });
  const stacked = new Map<string, { names: [string, string]; ids: Id[] }>();
  for (let i = 0; i < solids.length; i++) {
    const a = getWorldBounds(solids[i].r);
    for (let j = i + 1; j < solids.length; j++) {
      const b = getWorldBounds(solids[j].r);
      const w = Math.min(a.maxX, b.maxX) - Math.max(a.minX, b.minX);
      const h = Math.min(a.maxY, b.maxY) - Math.max(a.minY, b.minY);
      if (w <= 0 || h <= 0) continue;
      const smaller = Math.max(1, Math.min((a.maxX - a.minX) * (a.maxY - a.minY), (b.maxX - b.minX) * (b.maxY - b.minY)));
      if ((w * h) / smaller < 0.5) continue;
      const names = [objectName(project, solids[i]), objectName(project, solids[j])].sort() as [string, string];
      const k = names.join('|');
      const entry = stacked.get(k) ?? { names, ids: [] };
      entry.ids.push(solids[i].id, solids[j].id);
      stacked.set(k, entry);
    }
  }
  for (const [k, { names, ids }] of stacked) {
    const places = ids.length / 2;
    const what = names[0] === names[1] ? `Two ${names[0]}s are` : `${names[0]} and ${names[1]} are`;
    add(
      `stacked:${k}`,
      'warning',
      `${what} on the same square${places > 1 ? ` (${places} places)` : ''}: the one underneath can't be seen, but it is still there in play (it blocks, and scripts find it with thing_at), so e.g. a player that digs or collects it walks into the other one. Delete the extra one (select them to see where).`,
      [...new Set(ids)],
    );
  }

  // ---- things nobody can see (no Sprite at all; a Sprite with visible off is deliberate)
  for (const [defId, group] of byObject(placed.filter((p) => !has(p, 'Sprite')))) {
    add(`no-look:${defId}`, 'warning', `${label(group)} has no look (no Sprite), so it can't be seen while playing${touchHarm(group[0].r.scripts) ? ', though it still hurts' : ''}. Give it a sprite or a color.`, group.map((g) => g.id));
  }

  // ---- a way to finish
  const finishes =
    placed.some((p) => has(p, 'Goal')) ||
    scene.rules.some((r) => r.actions.some((a) => a.type === 'complete_level')) ||
    allScripts(project, scene).some((s) => JSON.stringify(s.handlers).includes('"complete_level"'));
  if (players.length && !finishes) add('no-goal', 'note', "This level can't be won yet: there is no Goal and nothing completes the level (a rule or script with complete level). Place a Goal, or add a rule (e.g. when no coin is left, complete the level).", []);

  // ---- can the player get to everything?
  for (const r of reachabilityProblems(project, sceneId, registry)) add(r.key, 'warning', r.text, r.entityIds);

  const order = { error: 0, warning: 1, note: 2 };
  return out.sort((a, b) => order[a.severity] - order[b.severity]);
}

function objectName(project: Project, p: Placed): string {
  return project.definitions.find((d) => d.id === p.definitionId)?.name ?? p.name;
}

/** The item a "requires" target stands for (as the runtime decides it). */
function itemOfRef(project: Project, scene: Scene, ref: EntityRef): string | null {
  if (ref.kind === 'tag') return ref.tag;
  if (ref.kind === 'object') {
    const def = project.definitions.find((d) => d.id === ref.id);
    return def ? (itemNameOf(def.components, def.name) ?? def.name.toLowerCase()) : null;
  }
  if (ref.kind === 'entity') {
    const e = scene.entities.find((x) => x.id === ref.id);
    if (!e) return null;
    const def = project.definitions.find((d) => d.id === e.definitionId);
    const name = def?.name ?? e.name;
    return itemNameOf({ ...(def?.components ?? {}), ...e.components }, name) ?? name.toLowerCase();
  }
  return null;
}

function allScripts(project: Project, scene: Scene): BehaviorScript[] {
  const used = new Set(scene.entities.map((e) => e.definitionId));
  return [...project.definitions.filter((d) => used.has(d.id)).flatMap((d) => d.scripts ?? []), ...scene.entities.flatMap((e) => e.scripts ?? [])];
}

/** Visits every statement, inside "if" too. `skipEach`: not inside "each" (statements there are usually about "it"). */
function walk(list: Stmt[], visit: (s: Stmt) => unknown, skipEach = false): void {
  for (const s of list) {
    visit(s);
    if (s.do === 'if') {
      walk(s.then, visit, skipEach);
      walk(s.else, visit, skipEach);
    } else if (s.do === 'each' && !skipEach) walk(s.then, visit, skipEach);
  }
}

