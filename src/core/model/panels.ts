/**
 * An object's own editor panel: controls the user chose (with the AI) for settings of that object they tune often
 * ("Jump height", "Run speed"), shown beside it whenever a copy is selected in the editor (never in the game). Each
 * control changes one number of the object: a component field ("CharacterController.jumpForce",
 * "MovingPlatform.offset.x") or a script setting ("script:Stomp.bounce"). Kept with the object (its metadata), so it
 * is saved with the game.
 */
import { z } from 'zod';
import type { ComponentRegistry } from '../components/registry';
import { resolveField } from '../script/fields';
import { setScriptVar } from '../script/mutations';
import type { Id, ObjectDefinition, Project } from '../types';
import { getDefinition, ModelError, setDefinitionComponentField } from './mutations';

export const PANEL_CONTROLS = ['slider', 'knob', 'number'] as const;
export type PanelControlKind = (typeof PANEL_CONTROLS)[number];

const controlSchema = z.object({
  label: z.string().min(1).max(40),
  /** "Component.field" (or "Component.field.x" for one of two numbers), or "script:<script name>.<variable>". */
  target: z.string().min(1),
  control: z.enum(PANEL_CONTROLS).default('slider'),
  min: z.number().finite(),
  max: z.number().finite(),
  step: z.number().positive().finite().default(1),
});

export const panelSchema = z.object({
  title: z.string().min(1).max(40),
  controls: z.array(controlSchema).min(1).max(12),
});

export type PanelControl = z.infer<typeof controlSchema>;
export type ObjectPanel = z.infer<typeof panelSchema>;

/** The object's panel, if it has one (and it is readable). */
export function panelOf(def: ObjectDefinition | undefined): ObjectPanel | null {
  const raw = def?.metadata.panel;
  if (!raw) return null;
  const parsed = panelSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

type Where = { kind: 'field'; component: string; field: string; axis: 'x' | 'y' | null } | { kind: 'script'; script: string; name: string };

/** What a control changes on this object, or why it can't (no such field, not a number, no such script setting). */
function locate(def: ObjectDefinition, target: string, registry: ComponentRegistry): Where | { error: string } {
  const script = /^script:(.+)\.([A-Za-z_][\w]*)$/.exec(target.trim());
  if (script) {
    const s = (def.scripts ?? []).find((x) => x.name === script[1]);
    if (!s) return { error: `${def.name} has no script "${script[1]}"` };
    const v = s.vars.find((x) => x.name === script[2]);
    if (!v) return { error: `script "${s.name}" has no variable "${script[2]}"` };
    if (typeof v.value !== 'number') return { error: `script "${s.name}" variable "${v.name}" isn't a number` };
    return { kind: 'script', script: s.name, name: v.name };
  }
  const dot = target.indexOf('.');
  if (dot <= 0) return { error: `"${target}" should be "Component.field" or "script:<script>.<variable>"` };
  const component = target.slice(0, dot);
  const r = resolveField(registry, component, target.slice(dot + 1));
  if ('error' in r) return r;
  if (component === 'Transform') return { error: 'a panel changes the object, not where one copy is (no Transform)' };
  if (!def.components[component]) return { error: `${def.name} has no ${component}` };
  if (r.schema && r.schema.kind !== 'number' && r.schema.kind !== 'vec2') return { error: `${target} isn't a number` };
  return { kind: 'field', component, field: r.field, axis: r.axis };
}

/** Why this panel can't go on this object (the first control that doesn't work), or null. */
export function checkPanel(def: ObjectDefinition, panel: ObjectPanel, registry: ComponentRegistry): string | null {
  for (const c of panel.controls) {
    const w = locate(def, c.target, registry);
    if ('error' in w) return `control "${c.label}": ${w.error}`;
    if (c.max <= c.min) return `control "${c.label}": max must be more than min`;
  }
  return null;
}

/** What a control shows now (null when what it changes is gone). */
export function panelValue(def: ObjectDefinition, control: PanelControl, registry: ComponentRegistry): number | null {
  const w = locate(def, control.target, registry);
  if ('error' in w) return null;
  if (w.kind === 'script') {
    const v = (def.scripts ?? []).find((x) => x.name === w.script)?.vars.find((x) => x.name === w.name)?.value;
    return typeof v === 'number' ? v : null;
  }
  const props = def.components[w.component];
  const v = w.axis ? (props?.[w.field] as { x: number; y: number } | undefined)?.[w.axis] : props?.[w.field];
  const value = typeof v === 'number' ? v : registry.createDefault(w.component)[w.field];
  return typeof value === 'number' ? value : w.axis && value && typeof value === 'object' ? (value as Record<string, number>)[w.axis] : null;
}

/** Changes what a control changes (the object: every copy). */
export function setPanelValue(project: Project, definitionId: Id, control: PanelControl, value: number, registry: ComponentRegistry): void {
  const def = getDefinition(project, definitionId);
  const w = locate(def, control.target, registry);
  if ('error' in w) throw new ModelError(w.error);
  if (w.kind === 'script') {
    const s = (def.scripts ?? []).find((x) => x.name === w.script)!;
    setScriptVar(project, { target: 'definition', id: definitionId }, s.id, w.name, value);
    return;
  }
  if (w.axis) {
    const now = (def.components[w.component][w.field] as { x: number; y: number } | undefined) ?? { x: 0, y: 0 };
    setDefinitionComponentField(project, definitionId, w.component, w.field, { ...now, [w.axis]: value }, registry);
  } else setDefinitionComponentField(project, definitionId, w.component, w.field, value, registry);
}

/** Gives the object this panel (replacing one it had), after checking every control works on it. */
export function setPanel(project: Project, definitionId: Id, raw: unknown, registry: ComponentRegistry): void {
  const parsed = panelSchema.safeParse(raw);
  if (!parsed.success) throw new ModelError(`Panel: ${parsed.error.issues[0].path.join('.')} ${parsed.error.issues[0].message}`);
  const def = getDefinition(project, definitionId);
  const err = checkPanel(def, parsed.data, registry);
  if (err) throw new ModelError(`Panel: ${err}`);
  def.metadata.panel = parsed.data;
}

export function removePanel(project: Project, definitionId: Id): void {
  delete getDefinition(project, definitionId).metadata.panel;
}
