/**
 * Runs the plain editing commands typed into a prompt card (see
 * core/commands/quickCommands): on the card's objects, or the selection.
 * Also the clipboard for placed objects (Ctrl+C / Ctrl+X / Ctrl+V use it too).
 */
import type { AIContext } from '../core/ai/context';
import { QUICK_COMMAND_HELP, stepOf, type QuickCommand } from '../core/commands/quickCommands';
import type { ApplyResult } from '../core/commands/operations';
import { generateId } from '../core/ids';
import { changeSpriteResolution } from '../core/model/mutations';
import { componentRegistry } from '../core/components/builtin';
import { addEntity, duplicateEntities, moveEntities, removeEntities, renameEntity } from '../core/model/mutations';
import { getWorldBounds } from '../core/model/geometry';
import type { EntityInstance, Id, Vec2 } from '../core/types';
import { resolveSceneEntities } from './selectors';
import type { PromptOutcome } from './ai/runPrompt';
import { useEditor } from './store';

const NONE: ApplyResult = { createdDefinitionIds: [], createdEntityIds: [], createdRelationshipIds: [], createdRuleIds: [], removedEntityIds: [], createdAssetIds: [], createdSceneIds: [] };

/** Copied placed objects (as they were when copied), and how many times they've been pasted since. */
let clipboard: { entities: EntityInstance[]; pasted: number } | null = null;

const plural = (n: number, one = 'object', many = 'objects') => `${n} ${n === 1 ? one : many}`;

function lastTransaction(): number | undefined {
  return useEditor.getState().history.past.at(-1)?.id;
}

/** The objects a command is about: the card's, else the selection (that still exist). */
function targets(ctx: AIContext | null): Id[] {
  const { project, activeSceneId, selectedEntityIds } = useEditor.getState();
  const ids = ctx && 'entityIds' in ctx ? ctx.entityIds : selectedEntityIds;
  const scene = project.scenes.find((s) => s.id === (ctx?.sceneId ?? activeSceneId));
  return ids.filter((id) => scene?.entities.some((e) => e.id === id));
}

export function copyObjects(ids: Id[]): number {
  const { project, activeSceneId } = useEditor.getState();
  const scene = project.scenes.find((s) => s.id === activeSceneId);
  const entities = ids.flatMap((id) => scene?.entities.filter((e) => e.id === id) ?? []);
  if (!entities.length) return 0;
  clipboard = { entities: structuredClone(entities), pasted: 0 };
  return entities.length;
}

/**
 * Pastes the copied objects into the level shown: at `at` (their middle there, on the grid), or one grid
 * step further down-right each time. The pasted ones are selected. Returns their ids (empty if nothing to paste).
 */
export function pasteObjects(at: Vec2 | null = null): Id[] {
  if (!clipboard) return [];
  const { project, activeSceneId, edit, selectEntities } = useEditor.getState();
  const g = project.settings.gridSize;
  const source = clipboard.entities;
  let offset: Vec2;
  if (at) {
    const xs = source.map((e) => e.transform.position.x);
    const ys = source.map((e) => e.transform.position.y);
    const mid = { x: (Math.min(...xs) + Math.max(...xs)) / 2, y: (Math.min(...ys) + Math.max(...ys)) / 2 };
    offset = { x: Math.round((at.x - mid.x) / g) * g, y: Math.round((at.y - mid.y) / g) * g };
  } else {
    const n = clipboard.pasted + 1;
    offset = { x: g * n, y: g * n };
  }
  const created: Id[] = [];
  const ok = edit(`Paste ${plural(source.length)}`, (p) => {
    for (const e of source) {
      const copy = structuredClone(e);
      copy.id = generateId('ent');
      copy.transform.position = { x: e.transform.position.x + offset.x, y: e.transform.position.y + offset.y };
      addEntity(p, activeSceneId, copy);
      created.push(copy.id);
    }
  });
  if (!ok) return [];
  if (!at) clipboard.pasted++;
  selectEntities(created);
  return created;
}

export function hasCopiedObjects(): boolean {
  return !!clipboard;
}

/** Does the command; the outcome is shown in the card like an AI answer. */
export function runQuickCommand(ctx: AIContext | null, cmd: QuickCommand): PromptOutcome {
  const state = useEditor.getState();
  const sceneId = state.activeSceneId;
  const ids = targets(ctx);
  const needSelection = (verb: string): PromptOutcome => ({ status: 'message', tone: 'warn', message: `Select what to ${verb} first (tap or drag over objects on the level).` });
  const applied = (message: string, result: ApplyResult = NONE): PromptOutcome => {
    state.logMessage('info', message);
    return { status: 'applied', message, changes: [], result, transactionId: lastTransaction() };
  };
  const failed = (): PromptOutcome => ({ status: 'error', message: useEditor.getState().log.at(-1)?.message ?? "That couldn't be done." });

  switch (cmd.kind) {
    case 'sprite_resolution':
      return applySpriteResolution(cmd.resolution);
    case 'help':
      return { status: 'message', tone: 'info', message: `These work right away, without the AI: ${QUICK_COMMAND_HELP}. Anything else goes to the AI.` };
    case 'undo': {
      const label = state.history.past.at(-1)?.label;
      if (!label) return { status: 'message', tone: 'info', message: 'There is nothing to undo.' };
      state.undo();
      return { status: 'message', tone: 'info', message: `Undid: ${label}` };
    }
    case 'redo': {
      const label = state.history.future[0]?.label;
      if (!label) return { status: 'message', tone: 'info', message: 'There is nothing to redo.' };
      state.redo();
      return { status: 'message', tone: 'info', message: `Redid: ${label}` };
    }
    case 'deselect':
      state.selectEntities([]);
      return { status: 'message', tone: 'info', message: 'Nothing is selected now.' };
    case 'select_all': {
      const scene = state.project.scenes.find((s) => s.id === sceneId);
      const all = scene?.entities ?? [];
      let chosen = all;
      if (cmd.name) {
        // "coins" finds Coin; the object's own name or its library object's name.
        const want = cmd.name.toLowerCase().replace(/(?:es|s)$/, '');
        const defName = (e: EntityInstance) => state.project.definitions.find((d) => d.id === e.definitionId)?.name ?? '';
        chosen = all.filter((e) => [e.name, defName(e)].some((n) => n.toLowerCase().replace(/(?:es|s)$/, '') === want || n.toLowerCase().startsWith(want)));
        if (!chosen.length) return { status: 'message', tone: 'warn', message: `There is nothing called "${cmd.name}" on this level.` };
      }
      state.selectEntities(chosen.map((e) => e.id));
      return { status: 'message', tone: 'info', message: `Selected ${plural(chosen.length)}.` };
    }
    case 'paste': {
      if (!clipboard) return { status: 'message', tone: 'warn', message: 'Nothing is copied yet: select objects and type "copy" (or press Ctrl+C) first.' };
      const at = ctx?.kind === 'level' ? ctx.point : null;
      const created = pasteObjects(at);
      return created.length ? applied(`Pasted ${plural(created.length)}.`, { ...NONE, createdEntityIds: created }) : failed();
    }
  }

  if (!ids.length) return needSelection(cmd.kind);
  switch (cmd.kind) {
    case 'delete': {
      const ok = state.edit(ids.length === 1 ? 'Delete entity' : `Delete ${ids.length} entities`, (p) => removeEntities(p, sceneId, ids));
      return ok ? applied(`Deleted ${plural(ids.length)}.`, { ...NONE, removedEntityIds: ids }) : failed();
    }
    case 'copy':
      copyObjects(ids);
      return { status: 'message', tone: 'info', message: `Copied ${plural(ids.length)}. Type "paste" (or press Ctrl+V) to place a copy.` };
    case 'cut': {
      copyObjects(ids);
      const ok = state.edit(`Cut ${plural(ids.length)}`, (p) => removeEntities(p, sceneId, ids));
      return ok ? applied(`Cut ${plural(ids.length)}. Type "paste" (or press Ctrl+V) to place them again.`, { ...NONE, removedEntityIds: ids }) : failed();
    }
    case 'duplicate': {
      const g = state.project.settings.gridSize;
      // Side by side in that direction (by the selection's size), else one grid step down-right like Ctrl+D.
      const span = spanOf(ids);
      const created: Id[] = [];
      const ok = state.edit(cmd.count === 1 ? 'Duplicate' : `Duplicate ×${cmd.count}`, (p) => {
        for (let i = 1; i <= cmd.count; i++) {
          const step = cmd.direction ? stepOf(cmd.direction, 1) : { x: 1, y: 1 };
          const offset = cmd.direction ? { x: step.x * Math.max(g, span.x) * i, y: step.y * Math.max(g, span.y) * i } : { x: g * i, y: g * i };
          created.push(...duplicateEntities(p, sceneId, ids, offset));
        }
      });
      if (!ok) return failed();
      state.selectEntities(created);
      return applied(`Made ${plural(created.length, 'copy', 'copies')}${cmd.direction ? `, going ${cmd.direction}` : ''}.`, { ...NONE, createdEntityIds: created });
    }
    case 'move': {
      const s = stepOf(cmd.direction, state.project.settings.gridSize * cmd.cells);
      const ok = state.edit(ids.length === 1 ? 'Move' : `Move ${ids.length} objects`, (p) => moveEntities(p, sceneId, ids, s));
      return ok ? applied(`Moved ${plural(ids.length)} ${plural(cmd.cells, 'square', 'squares')} ${cmd.direction}.`) : failed();
    }
    case 'rename': {
      const ok = state.edit(`Rename to ${cmd.name}`, (p) => ids.forEach((id) => renameEntity(p, sceneId, id, cmd.name)));
      return ok ? applied(ids.length === 1 ? `Renamed it ${cmd.name}.` : `Renamed ${plural(ids.length)} ${cmd.name}.`) : failed();
    }
  }
  return { status: 'error', message: 'Unknown command.' };
}

/** How much room the objects take, left to right and top to bottom (whole grid squares). */
function spanOf(ids: Id[]): Vec2 {
  const { project, activeSceneId } = useEditor.getState();
  const g = project.settings.gridSize;
  const boxes = resolveSceneEntities(project, activeSceneId).filter((e) => ids.includes(e.id)).map(getWorldBounds);
  if (!boxes.length) return { x: g, y: g };
  const w = Math.max(...boxes.map((b) => b.maxX)) - Math.min(...boxes.map((b) => b.minX));
  const h = Math.max(...boxes.map((b) => b.maxY)) - Math.min(...boxes.map((b) => b.minY));
  return { x: Math.ceil(w / g - 0.01) * g, y: Math.ceil(h / g - 0.01) * g };
}

/** The built-in objects' pictures in another size (one undoable step); says which objects changed. */
export function applySpriteResolution(res: 8 | 16 | 32 | 64): PromptOutcome {
  const { edit, logMessage } = useEditor.getState();
  let changed: string[] = [];
  const ok = edit(`Sprite size ${res}×${res}`, (p) => {
    changed = changeSpriteResolution(p, res, componentRegistry);
  });
  if (!ok) return { status: 'error', message: useEditor.getState().log.at(-1)?.message ?? "The sprite size couldn't be changed." };
  const message = changed.length
    ? `Sprites are ${res}×${res} pixels a tile now: ${changed.join(', ')}.${res === 32 ? ' (As they ship.)' : ''} Objects with their own drawings keep them.`
    : `Sprites are ${res}×${res} pixels a tile now. No built-in object needed a change (objects with their own drawings keep them).`;
  logMessage('info', message);
  return { status: 'applied', message, changes: [], result: NONE, transactionId: useEditor.getState().history.past.at(-1)?.id };
}
