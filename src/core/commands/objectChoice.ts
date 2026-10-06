/**
 * Changing what an object is (its behavior or look) is always a change to a
 * library object, never to one placed copy. When the AI proposes such a
 * change, the user chooses:
 *
 * - change the object: every copy in the game gets it;
 * - create a new object: a copy of the object, with the change, appears in
 *   the library, and the selected copies become that new kind; the old
 *   object and its other copies stay as they were.
 *
 * So each kind of thing keeps one behavior, saved in the Objects panel.
 */
import type { ComponentRegistry } from '../components/registry';
import { generateId } from '../ids';
import * as m from '../model/mutations';
import type { Id, Project } from '../types';
import { applyOperations, type ApplyResult, type Operation } from './operations';

/** Operations that change what an object is (components, scripts, sprites, tags). */
const OBJECT_OPS = new Set<Operation['op']>(['set_component_field', 'add_component', 'remove_component', 'set_tags', 'draw_sprite', 'set_script', 'remove_script', 'set_script_enabled']);

export interface ObjectChoice {
  /** The library object the change is about. */
  definitionId: Id;
  objectName: string;
  /** Copies of it in the whole game. */
  copies: number;
  /** The selected copies: they become the new kind on "Create new". */
  switchIds: Id[];
}

function entityById(project: Project, id: Id) {
  for (const s of project.scenes) {
    const e = s.entities.find((x) => x.id === id);
    if (e) return e;
  }
  return undefined;
}

/** The object a change is about, when it changes exactly one library object's behavior or look; else null. */
export function objectChoiceFor(project: Project, ops: Operation[], selectedIds: readonly Id[]): ObjectChoice | null {
  const defs = new Set<Id>();
  for (const op of ops) {
    if (!OBJECT_OPS.has(op.op) || !('target' in op)) continue;
    const { target, id } = op as { target: 'instance' | 'definition'; id: Id };
    if (target === 'definition') {
      if (!project.definitions.some((d) => d.id === id)) return null; // a new object made in the same reply
      defs.add(id);
    } else {
      const e = entityById(project, id);
      if (!e || !e.definitionId) return null; // standalone things have no object to choose about
      defs.add(e.definitionId);
    }
  }
  if (defs.size !== 1) return null;
  const definitionId = [...defs][0];
  const def = project.definitions.find((d) => d.id === definitionId)!;
  const copies = project.scenes.reduce((n, s) => n + s.entities.filter((e) => e.definitionId === definitionId).length, 0);
  const switchIds = selectedIds.filter((id) => entityById(project, id)?.definitionId === definitionId);
  return { definitionId, objectName: def.name, copies, switchIds };
}

/** The operations, with every change to the object (or one of its copies) aimed at `toDefinition`. */
function aimAt(project: Project, ops: Operation[], fromDefinition: Id, toDefinition: Id): Operation[] {
  return ops.map((op) => {
    if (!OBJECT_OPS.has(op.op) || !('target' in op)) return op;
    const o = op as Operation & { target: 'instance' | 'definition'; id: Id };
    const about = o.target === 'definition' ? o.id : entityById(project, o.id)?.definitionId;
    return about === fromDefinition ? ({ ...o, target: 'definition', id: toDefinition } as Operation) : op;
  });
}

/** "Change the object": every copy gets it. */
export function applyToObject(project: Project, ops: Operation[], choice: ObjectChoice, registry: ComponentRegistry): ApplyResult {
  return applyOperations(project, aimAt(project, ops, choice.definitionId, choice.definitionId), registry);
}

/** A name not used by another object: "Enemy 2", "Enemy 3"… */
export function newObjectName(project: Project, base: string): string {
  const stem = base.replace(/\s+\d+$/, '');
  for (let n = 2; ; n++) {
    const name = `${stem} ${n}`;
    if (!project.definitions.some((d) => d.name === name)) return name;
  }
}

/** "Create new": a copy of the object gets the change and the selected copies become it; the old object stays as it was. */
export function applyAsNewObject(project: Project, ops: Operation[], choice: ObjectChoice, registry: ComponentRegistry): ApplyResult & { newDefinitionId: Id } {
  const old = m.getDefinition(project, choice.definitionId);
  // A plain copy (the project may be an immer draft, which structuredClone can't copy).
  const copy = JSON.parse(JSON.stringify(old)) as typeof old;
  copy.id = generateId('def');
  copy.name = newObjectName(project, old.name);
  delete copy.metadata.starter; // it is not the starter object (Reset objects leaves it alone)
  m.addDefinition(project, copy, registry);
  const result = applyOperations(project, aimAt(project, ops, choice.definitionId, copy.id), registry);
  for (const id of choice.switchIds) {
    const e = entityById(project, id);
    if (!e || e.definitionId !== choice.definitionId) continue;
    e.definitionId = copy.id;
    // Named after the object (not a name of its own): follow the new object's name.
    if (e.name === old.name) e.name = copy.name;
  }
  return { ...result, createdDefinitionIds: [copy.id, ...result.createdDefinitionIds], newDefinitionId: copy.id };
}
