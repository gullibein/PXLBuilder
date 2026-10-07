/**
 * Prompt -> context -> AI -> structured operations -> validation -> transaction.
 *
 * The AI only ever proposes operations. They are applied all-or-nothing as
 * one undoable transaction through the same mutation layer the inspector uses.
 */
import { buildAIPayload, contextKey, type AIContext } from '../../core/ai/context';
import { AIUnavailableError, type AIResponse } from '../../core/ai/protocol';
import { HttpAIProvider, type AIProvider } from '../../core/ai/provider';
import { geminiKey, getApiKey } from './apiKey';
import { chatHistory } from './aiLog';
import { getAISettings } from './aiSettings';
import { GeminiProvider } from './geminiProvider';
import { BrowserClaudeProvider } from './browserProvider';
import { claudeSample, SampleAIProvider } from './sampleProvider';
import { applyAsNewObject, applyToObject, objectChoiceFor, type ObjectChoice } from '../../core/commands/objectChoice';
import { applyOperations, checkOperations, isEditorOperation, pruneOperations, type ApplyResult, type Operation } from '../../core/commands/operations';
import { checkEditorSetting, editorSettingsPayload, type EditorLayout } from '../layout/settings';
import { addOverlays } from '../overlays/overlays';
import { componentRegistry } from '../../core/components/builtin';
import { produce } from 'immer';
import { levelMap, type LevelMap } from '../../core/model/levelMap';
import { reachabilityProblems } from '../../core/model/reachability';
import { useEditor } from '../store';
import type { Id, Project } from '../../core/types';

/** A change to what one library object is (its behavior or look), which can go to the object or to a new one. */
export interface ObjectChange {
  message: string;
  changes: string[];
  operations: Operation[];
  choice: ObjectChoice;
}

/**
 * What a prompt did. The AI's changes are always applied at once, as one
 * undoable step (the user tries them on the level and undoes what they don't
 * want); nothing waits for an Apply.
 */
export type PromptOutcome =
  /**
   * `editor`: the change was to the editor's own settings (undone with the editor's undo, not the project's).
   * `asNew`: the change went to an object (every copy); it can be made a new object instead.
   * `note`: a line worth showing on the card (e.g. that a new object was made).
   * `undone`: the user undid it from the card (it stays in the card's chat, marked).
   */
  | { status: 'applied'; message: string; changes: string[]; result: ApplyResult; editor?: boolean; touched?: Touched[]; transactionId?: number; asNew?: ObjectChange; note?: string; undone?: boolean }
  | { status: 'message'; message: string; tone: 'info' | 'warn' }
  | { status: 'error'; message: string };

let override: AIProvider | null = null;
const httpProvider = new HttpAIProvider();

/** Swaps the AI provider (other vendors, a hosted backend, tests). */
export function setAIProvider(next: AIProvider | null): void {
  override = next;
}

/**
 * Where the AI comes from: inside claude.ai (the published app) the viewer's
 * Claude account (pages there can't contact other services); else Gemini when
 * chosen in AI connection; else the user's own Anthropic key when set; else
 * this computer's PXLBuilder server.
 */
async function currentProvider(): Promise<AIProvider> {
  if (override) return override;
  const sample = await claudeSample();
  if (sample) return new SampleAIProvider(sample);
  const settings = getAISettings();
  if (settings.vendor === 'gemini') {
    const gKey = geminiKey.get();
    if (!gKey) throw new AIUnavailableError('Gemini is chosen as the AI, but there is no Gemini API key yet. Add one in ⋯ → AI connection (or switch back to Claude there).');
    return new GeminiProvider(gKey, settings.geminiModel, settings.geminiBackup || null, (note) => useEditor.getState().logMessage('info', note));
  }
  const key = getApiKey();
  return key ? new BrowserClaudeProvider(key) : httpProvider;
}

export function labelFor(request: string): string {
  const text = request.trim().replace(/\s+/g, ' ');
  return text.length > 60 ? `${text.slice(0, 57)}…` : text;
}

export async function runPrompt(ctx: AIContext, request: string, signal?: AbortSignal): Promise<PromptOutcome> {
  const state = useEditor.getState();
  const body = {
    context: buildAIPayload(state.project, ctx, componentRegistry, editorSettingsPayload(state.layout), state.lastPlay && { report: state.lastPlay.report, changedSince: state.lastPlay.project !== state.project }),
    request,
    // The conversation about this so far (since its last "New chat"; survives closing the card and reloading).
    history: chatHistory(contextKey(ctx)),
    speed: getAISettings().speed,
  };
  let response: AIResponse;
  try {
    const provider = await currentProvider();
    response = await provider.respond(body, signal);
    // A game change that wouldn't apply (a script with a typo, a wrong id), or a level the player can't get through,
    // goes back to the AI once, with the exact problem.
    const gameOps = (r: AIResponse) => r.operations.length > 0 && !r.operations.some(isEditorOperation);
    const broken = gameOps(response) ? checkOperations(useEditor.getState().project, response.operations, componentRegistry) : null;
    const stuck = gameOps(response) && !broken ? playability(ctx.sceneId, response.operations) : null;
    const problem = broken ?? stuck?.text ?? null;
    if (problem) {
      state.logMessage('info', `AI answer didn't check out (${problem}); asking it to fix that.`);
      const first = [response.message, ...response.changes.map((c) => `- ${c}`)].join('\n');
      response = await provider.respond(
        {
          ...body,
          history: [...body.history, { request, reply: first }],
          request: `${request}\n\n[Your previous answer could not be applied: ${problem}. Fix that and send the complete corrected answer (it replaces the previous one; context.level.map shows the level without it).${mapText(stuck?.map ?? null)}]`,
        },
        signal,
      );
      // Still not right: keep what applies, leave out the rest, and say so.
      const again = gameOps(response) ? checkOperations(useEditor.getState().project, response.operations, componentRegistry) : null;
      if (again) {
        const { kept, skipped } = pruneOperations(useEditor.getState().project, response.operations, componentRegistry);
        state.logMessage('warn', `AI answer still didn't check out; left out ${skipped.length} part(s): ${skipped.join('; ')}`);
        if (!kept.length) return { status: 'error', message: `The AI's change couldn't be applied. ${skipped[0]}` };
        const note = skipped.length === 1 ? `Left out one part that couldn't be applied: ${skipped[0]}` : `Left out ${skipped.length} parts that couldn't be applied (first: ${skipped[0]})`;
        response = { ...response, kind: 'preview', operations: kept, changes: [...response.changes, `⚠ ${note}`] };
      }
      // Still not playable: show it for confirmation, with the problem.
      const stillStuck = gameOps(response) ? (playability(ctx.sceneId, response.operations)?.text ?? null) : null;
      if (stillStuck) {
        state.logMessage('warn', `AI level still has a problem: ${stillStuck}`);
        response = { ...response, kind: 'preview', changes: [...response.changes, `⚠ ${stillStuck}`] };
      }
    }
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e;
    const message = e instanceof AIUnavailableError ? e.message : `AI request failed: ${(e as Error).message}`;
    state.logMessage('error', message);
    return { status: 'error', message };
  }

  if (response.operations.length === 0) {
    return { status: 'message', message: response.message, tone: response.kind === 'unsupported' ? 'warn' : 'info' };
  }
  if (!response.operations.some(isEditorOperation)) {
    const now = useEditor.getState();
    const choice = objectChoiceFor(now.project, response.operations, 'entityIds' in ctx ? ctx.entityIds : []);
    if (choice) {
      // A change to what an object is goes to the object (every copy); the card offers "a new object instead".
      const change: ObjectChange = { message: response.message, changes: response.changes, operations: response.operations, choice };
      const out = applyObjectChoice(request, change, 'object');
      return out.status === 'applied' ? { ...out, asNew: change } : out;
    }
  }
  return applyAIOperations(request, response.message, response.changes, response.operations);
}

/** An object or entity an AI change was made to (shown so the user sees where it went). */
export interface Touched {
  label: string;
  entityIds: Id[];
}

/** Which objects/entities the operations changed: library objects (every copy) and single entities. */
export function touchedBy(project: Project, sceneId: Id, operations: Operation[]): Touched[] {
  const defs = new Set<Id>();
  const ents = new Set<Id>();
  for (const op of operations) {
    if ('target' in op && typeof op.target === 'string' && 'id' in op) (op.target === 'definition' ? defs : ents).add(op.id);
    if (op.op === 'set_transform') ents.add(op.entityId);
  }
  const scene = project.scenes.find((s) => s.id === sceneId);
  const out: Touched[] = [];
  for (const id of defs) {
    const def = project.definitions.find((d) => d.id === id);
    if (!def) continue;
    const copies = scene?.entities.filter((e) => e.definitionId === id).map((e) => e.id) ?? [];
    out.push({ label: `${def.name} (every copy${copies.length ? `, ${copies.length} in this level` : ''})`, entityIds: copies });
  }
  for (const id of ents) {
    const e = scene?.entities.find((x) => x.id === id);
    if (e) out.push({ label: e.name, entityIds: [id] });
  }
  return out;
}

const EMPTY_RESULT: ApplyResult = { createdDefinitionIds: [], createdEntityIds: [], createdRelationshipIds: [], createdRuleIds: [], removedEntityIds: [], createdAssetIds: [] };

/**
 * Applies editor-setting operations as one step of the editor's own undo.
 * Every value is checked against the setting's schema first; one bad value rejects all.
 */
function applyEditorOperations(message: string, changes: string[], operations: Operation[]): PromptOutcome {
  const { setLayout, logMessage, layout } = useEditor.getState();
  const patch: Record<string, unknown> = {};
  let overlays = layout.overlays;
  const reject = (err: string): PromptOutcome => {
    logMessage('error', `Editor change rejected: ${err}`);
    return { status: 'error', message: `The AI's editor change couldn't be applied. ${err}.` };
  };
  for (const op of operations) {
    if (!isEditorOperation(op)) return { status: 'error', message: "The AI mixed editor and game changes, so nothing was changed." };
    if (op.op === 'remove_editor_overlay') {
      if (!overlays.some((o) => o.id === op.id)) return reject(`There is no overlay "${op.id}"`);
      overlays = overlays.filter((o) => o.id !== op.id);
      continue;
    }
    if (op.op === 'add_editor_overlay') {
      let parsed: unknown;
      try {
        parsed = JSON.parse(op.overlayJson);
      } catch {
        return reject('The overlay is not valid JSON');
      }
      const next = addOverlays(overlays, [parsed], () => `ovl_${Math.random().toString(36).slice(2, 10)}`);
      if ('error' in next) return reject(next.error);
      overlays = next;
      continue;
    }
    let value: unknown;
    try {
      value = JSON.parse(op.valueJson);
    } catch {
      return { status: 'error', message: `The AI's value for "${op.key}" isn't valid, so nothing was changed.` };
    }
    const err = checkEditorSetting(op.key, value);
    if (err) return reject(err);
    patch[op.key] = value;
  }
  setLayout({ ...(patch as Partial<EditorLayout>), overlays });
  logMessage('info', `Editor: ${message}`);
  return { status: 'applied', message, changes, result: EMPTY_RESULT, editor: true };
}

/**
 * Applies a change to what an object is, as the user chose: to the object
 * (every copy), or to a new object the selected copies become.
 */
export function applyObjectChoice(request: string, outcome: ObjectChange, as: 'object' | 'new'): PromptOutcome {
  const { edit, logMessage } = useEditor.getState();
  const { choice } = outcome;
  let result: ApplyResult = EMPTY_RESULT;
  let newName = '';
  const ok = edit(
    `✨ ${labelFor(request)}${as === 'new' ? ' (new object)' : ''}`,
    (p) => {
      if (as === 'new') {
        const r = applyAsNewObject(p, outcome.operations, choice, componentRegistry);
        newName = p.definitions.find((d) => d.id === r.newDefinitionId)?.name ?? '';
        result = r;
      } else result = applyToObject(p, outcome.operations, choice, componentRegistry);
    },
    { source: 'ai', changes: outcome.changes, operations: outcome.operations },
  );
  if (!ok) {
    const last = useEditor.getState().log.at(-1);
    return { status: 'error', message: `The AI's change couldn't be applied. ${last?.message.split(': ').slice(1).join(': ') ?? ''}`.trim() };
  }
  const after = useEditor.getState();
  const scene = after.project.scenes.find((s) => s.id === after.activeSceneId);
  const defId = as === 'new' ? result.createdDefinitionIds[0] : choice.definitionId;
  const copies = scene?.entities.filter((e) => e.definitionId === defId).map((e) => e.id) ?? [];
  if (copies.length) after.flashEntities(copies);
  const label = as === 'new' ? `${newName} (new object, ${copies.length} in this level)` : `${choice.objectName} (every copy${copies.length ? `, ${copies.length} in this level` : ''})`;
  logMessage('info', `AI: ${outcome.message}${as === 'new' ? ` — as a new object, ${newName}` : ''}`);
  return {
    status: 'applied',
    message: as === 'new' ? `Created ${newName}: ${choice.objectName} with this change. The other ${choice.objectName}s stay as they were.` : outcome.message,
    changes: outcome.changes,
    result,
    touched: [{ label, entityIds: copies }],
    transactionId: after.history.past.at(-1)?.id,
    ...(as === 'new' ? { note: `Created ${newName}: ${choice.objectName} with this change. The other ${choice.objectName}s stay as they were.` } : {}),
  };
}

/** Applies AI operations as one transaction. Invalid operations reject the whole set. */
export function applyAIOperations(request: string, message: string, changes: string[], operations: Operation[]): PromptOutcome {
  if (operations.some(isEditorOperation)) return applyEditorOperations(message, changes, operations);
  const { edit, logMessage } = useEditor.getState();
  let result: ApplyResult = EMPTY_RESULT;
  const ok = edit(
    `✨ ${labelFor(request)}`,
    (p) => {
      result = applyOperations(p, operations, componentRegistry);
    },
    { source: 'ai', changes, operations },
  );
  if (!ok) {
    const last = useEditor.getState().log.at(-1);
    return { status: 'error', message: `The AI's change couldn't be applied. ${last?.message.split(': ').slice(1).join(': ') ?? ''}`.trim() };
  }
  logMessage('info', `AI: ${message}`);
  const after = useEditor.getState();
  const touched = touchedBy(after.project, after.activeSceneId, operations);
  const ids = touched.flatMap((t) => t.entityIds);
  if (ids.length) after.flashEntities(ids);
  return { status: 'applied', message, changes, result, touched, transactionId: after.history.past.at(-1)?.id };
}

/**
 * What the operations would newly make impossible to reach in the level (the
 * player can't get to an item, the exit, a platform…), in words; null if
 * nothing. Problems that were there before the change don't count.
 */
function playability(sceneId: Id, operations: Operation[]): { text: string; map: LevelMap | null } | null {
  const project = useEditor.getState().project;
  const before = new Set(reachabilityProblems(project, sceneId, componentRegistry).map((p) => p.key));
  let after: Project;
  try {
    after = produce(project, (d) => {
      applyOperations(d, operations, componentRegistry);
    });
  } catch {
    return null;
  }
  const added = reachabilityProblems(after, sceneId, componentRegistry).filter((p) => !before.has(p.key));
  if (!added.length) return null;
  // The level as the answer would leave it, so the AI can see what went wrong.
  return { text: added.map((p) => p.text).join(' '), map: levelMap(after, sceneId, componentRegistry) };
}

function mapText(map: LevelMap | null): string {
  if (!map) return '';
  return `\n\nThe level after your previous answer would look like this (same legend as context.level.map):\n${[map.ruler, ...map.rows].join('\n')}`;
}
