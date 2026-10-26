/**
 * Prompt -> context -> AI -> structured operations -> validation -> transaction.
 *
 * The AI only ever proposes operations. They are applied all-or-nothing as
 * one undoable transaction through the same mutation layer the inspector uses.
 */
import { buildAIPayload, codeFor, codeToSend, contextKey, type AIContext } from '../../core/ai/context';
import { AIUnavailableError, type AIRequestBody, type AIResponse } from '../../core/ai/protocol';
import { HttpAIProvider, type AIProvider } from '../../core/ai/provider';
import { geminiKey, getApiKey } from './apiKey';
import { chatHistory } from './aiLog';
import type { TraceFn } from '../../core/ai/trace';
import { getAISettings } from './aiSettings';
import { GeminiProvider } from './geminiProvider';
import { BrowserClaudeProvider } from './browserProvider';
import { claudeSample, SampleAIProvider } from './sampleProvider';
import { applyAsNewObject, applyToObject, objectChoiceFor, type ObjectChoice } from '../../core/commands/objectChoice';
import { applyOperations, checkOperations, isEditorOperation, pruneOperations, type ApplyResult, type Operation } from '../../core/commands/operations';
import { checkEditorSetting, editorReference, editorSettingsPayload, type EditorLayout } from '../layout/settings';
import { addOverlays } from '../overlays/overlays';
import { componentRegistry } from '../../core/components/builtin';
import { produce } from 'immer';
import { levelMap, type LevelMap } from '../../core/model/levelMap';
import { reachabilityProblems } from '../../core/model/reachability';
import { useEditor } from '../store';
import { parseQuickCommand, QUICK_COMMAND_HELP, type QuickCommand } from '../../core/commands/quickCommands';
import { runQuickCommand } from '../quickCommands';
import { removeRelationship } from '../../core/logic/mutations';
import type { GameType, Id, Project } from '../../core/types';
import { switchStarter } from '../persistence';

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
  | { status: 'applied'; message: string; changes: string[]; result: ApplyResult; editor?: boolean; touched?: Touched[]; transactionId?: number; asNew?: ObjectChange; note?: string; undone?: boolean; movedTo?: AIContext }
  /** `movedTo`: the exchange was about something else, and went to that one's card (this says so, with a way there). */
  | { status: 'message'; message: string; tone: 'info' | 'warn'; movedTo?: AIContext }
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
  if (sample) return new SampleAIProvider(sample, (note) => useEditor.getState().logMessage('warn', note));
  const settings = getAISettings();
  if (settings.vendor === 'gemini') {
    const gKey = geminiKey.get();
    if (!gKey) throw new AIUnavailableError('Gemini is chosen as the AI, but there is no Gemini API key yet. Add one in ⋯ → AI connection (or switch back to Claude there).');
    return new GeminiProvider(gKey, settings.geminiModel, settings.geminiBackup || null, (note) => useEditor.getState().logMessage('info', note));
  }
  const key = getApiKey();
  return key ? new BrowserClaudeProvider(key, (message) => useEditor.getState().logMessage('info', message), (note) => useEditor.getState().logMessage('warn', note)) : httpProvider;
}

/** The plain editing command this prompt is, for this card (objects, the level; "delete" also for a connection). */
function quickCommandFor(ctx: AIContext, request: string): QuickCommand | { kind: 'connection-delete' } | null {
  const cmd = parseQuickCommand(request);
  if (!cmd) return null;
  if (ctx.kind === 'connection') return cmd.kind === 'delete' ? { kind: 'connection-delete' } : null;
  // The sprite size is about the whole game: from any card about the game.
  if (cmd.kind === 'sprite_resolution') return ctx.kind === 'editor' || ctx.kind === 'create' ? null : cmd;
  return ctx.kind === 'entity' || ctx.kind === 'pair' || ctx.kind === 'group' || ctx.kind === 'level' ? cmd : null;
}

function deleteConnection(ctx: AIContext): PromptOutcome {
  if (ctx.kind !== 'connection') return { status: 'error', message: 'Not a connection.' };
  const { edit, selectConnection } = useEditor.getState();
  const ok = edit('Remove connection', (p) => removeRelationship(p, ctx.sceneId, ctx.relationshipId));
  if (!ok) return { status: 'error', message: useEditor.getState().log.at(-1)?.message ?? "The connection couldn't be removed." };
  selectConnection(null);
  return { status: 'applied', message: 'Removed the connection.', changes: [], result: EMPTY_RESULT, transactionId: useEditor.getState().history.past.at(-1)?.id };
}

export function labelFor(request: string): string {
  const text = request.trim().replace(/\s+/g, ' ');
  return text.length > 60 ? `${text.slice(0, 57)}…` : text;
}

/** The starters a new game can be made from, for the AI to choose (context.newGame). */
const STARTERS: { id: GameType; is: string }[] = [
  { id: 'platformer', is: 'seen from the side, with gravity: player that runs, jumps and climbs, ground, platforms, ladders, enemies, spikes, crates, a goal (Mario-like games)' },
  { id: 'topdown', is: 'seen from above, no gravity: player that walks in every direction, floor, walls, doors, wandering enemies, hazards, a goal (Zelda, Rogue, Boulder Dash, mazes, grid and board puzzles)' },
];

export interface PromptOptions {
  /** The first request of a game just made in the New game window: the AI may move it to a better starter first. */
  newGame?: boolean;
}

export async function runPrompt(ctx: AIContext, request: string, signal?: AbortSignal, trace?: TraceFn, options: PromptOptions = {}): Promise<PromptOutcome> {
  const state = useEditor.getState();
  // Plain editing commands ("delete", "duplicate 3 times to the right", "paste"…) are done by the app itself, at once.
  const quick = quickCommandFor(ctx, request);
  if (quick) {
    trace?.('note', `Done by the app itself (no AI): ${quick.kind}`);
    return quick.kind === 'connection-delete' ? deleteConnection(ctx) : runQuickCommand(ctx, quick);
  }
  const body: AIRequestBody = {
    context: buildAIPayload(state.project, ctx, componentRegistry, editorSettingsPayload(state.layout), state.lastPlay && { report: state.lastPlay.report, changedSince: state.lastPlay.project !== state.project }, Math.random),
    request,
    // The conversation about this so far (since its last "New chat"; survives closing the card and reloading).
    history: chatHistory(contextKey(ctx)),
    speed: getAISettings().speed,
    // What the editor's settings are: fixed, so it goes with the (cached) instructions; the context has their values.
    reference: editorReference(),
  };
  // The full code of the objects the request names, sent along (no second round trip).
  const along = codeToSend(state.project, ctx, request);
  if (along.length) {
    body.code = codeFor(state.project, along);
    trace?.('note', `Sent along: the code of ${body.code.map((c) => c.name).join(', ')}`);
  }
  const starterNow = (): GameType => useEditor.getState().project.settings.gameType ?? 'platformer';
  if (options.newGame) body.context.newGame = { current: starterNow(), starters: STARTERS };
  let response: AIResponse;
  trace?.('note', `Request: ${request}\nAbout: ${contextKey(ctx)}; ${body.history.length} earlier exchange(s) sent as memory; context ${JSON.stringify(body.context).length} characters; speed ${body.speed}`);
  try {
    const provider = await currentProvider();
    response = await provider.respond(body, signal, trace);
    // A new game the AI would rather build on another starter: made over from that one, and the same request asked again (once).
    if (response.kind === 'switch_starter') {
      const to = response.starter;
      if (options.newGame && to && to !== starterNow()) {
        trace?.('note', `The AI chose the ${to} starter; asking again on it`);
        switchStarter(to);
        const now = useEditor.getState();
        body.context = buildAIPayload(now.project, ctx, componentRegistry, editorSettingsPayload(now.layout), null, Math.random);
        body.context.newGame = { current: starterNow(), starters: STARTERS };
        response = await provider.respond(body, signal, trace);
      }
      if (response.kind === 'switch_starter') response = { ...response, kind: 'answer', operations: [], message: response.message || 'The AI wanted another starter but did not build the game. Ask again.' };
    }
    // Other objects' code isn't sent up front (only the selected one's): when the AI needs some, it says which, and
    // the same request goes again with that code (after the cached game data, so it costs little). At most twice.
    for (let round = 0; round < 2 && response.kind === 'need_code'; round++) {
      const sent = new Set((body.code ?? []).map((c) => c.id));
      const fresh = codeFor(useEditor.getState().project, response.needCode ?? []).filter((c) => !sent.has(c.id));
      if (!fresh.length) break;
      const names = fresh.map((c) => c.name).join(', ');
      trace?.('note', `The AI asked for the code of: ${names}; asking again with it`);
      state.logMessage('info', `AI asked to read the code of ${names}; sending it.`);
      body.code = [...(body.code ?? []), ...fresh];
      response = await provider.respond(body, signal, trace);
    }
    if (response.kind === 'need_code') {
      // It asked for code that isn't there (or kept asking): say so rather than leave the request hanging.
      response = { ...response, kind: 'answer', operations: [], message: response.message || "The AI couldn't find the code it needed. Try selecting the object it's about and asking there." };
    }
    // A game change that wouldn't apply (a script with a typo, a wrong id), or a level the player can't get through,
    // goes back to the AI once, with the exact problem.
    const gameOps = (r: AIResponse) => r.operations.length > 0 && !r.operations.some(isEditorOperation);
    const broken = gameOps(response) ? checkOperations(useEditor.getState().project, response.operations, componentRegistry) : null;
    const stuck = gameOps(response) && !broken ? playability(ctx.sceneId, response.operations) : null;
    const problem = broken ?? stuck?.text ?? null;
    if (problem) {
      trace?.('check', `Didn't check out: ${problem}`);
      trace?.('retry', 'Sent back once with that problem');
      state.logMessage('info', `AI answer didn't check out (${problem}); asking it to fix that.`);
      const first = [response.message, ...response.changes.map((c) => `- ${c}`)].join('\n');
      response = await provider.respond(
        {
          ...body,
          history: [...body.history, { request, reply: first }],
          request: `${request}\n\n[Your previous answer could not be applied: ${problem}. Fix that and send the complete corrected answer (it replaces the previous one; context.level.map shows the level without it). The user never saw the previous answer: write the message as your first answer, without mentioning an earlier attempt.${mapText(stuck?.map ?? null)}]`,
        },
        signal,
        trace,
      );
      // Still not right: keep what applies, leave out the rest, and say so.
      const again = gameOps(response) ? checkOperations(useEditor.getState().project, response.operations, componentRegistry) : null;
      if (again) {
        const { kept, skipped } = pruneOperations(useEditor.getState().project, response.operations, componentRegistry);
        state.logMessage('warn', `AI answer still didn't check out; left out ${skipped.length} part(s): ${skipped.join('; ')}`);
        trace?.('check', `Still didn't check out; left out ${skipped.length} part(s): ${skipped.join('; ')}`);
        if (!kept.length) return { status: 'error', message: `The AI's change couldn't be applied. ${skipped[0]}` };
        const note = skipped.length === 1 ? `Left out one part that couldn't be applied: ${skipped[0]}` : `Left out ${skipped.length} parts that couldn't be applied (first: ${skipped[0]})`;
        response = { ...response, kind: 'preview', operations: kept, changes: [...response.changes, `⚠ ${note}`] };
      }
      // Still not playable: show it for confirmation, with the problem.
      const stillStuck = gameOps(response) ? (playability(ctx.sceneId, response.operations)?.text ?? null) : null;
      if (stillStuck) {
        state.logMessage('warn', `AI level still has a problem: ${stillStuck}`);
        trace?.('check', `Level still has a problem: ${stillStuck}`);
        response = { ...response, kind: 'preview', changes: [...response.changes, `⚠ ${stillStuck}`] };
      }
    }
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e;
    const message = e instanceof AIUnavailableError ? `${e.message} (Without an AI these still work: ${QUICK_COMMAND_HELP}.)` : `AI request failed: ${(e as Error).message}`;
    trace?.('error', message);
    state.logMessage('error', message);
    return { status: 'error', message };
  }

  if (response.operations.length === 0) {
    return { status: 'message', message: response.message, tone: response.kind === 'unsupported' ? 'warn' : 'info' };
  }
  // Asked on one thing's card about another ("make the enemy faster" on the player's): the exchange goes to that one's card.
  const elsewhere = aboutSomethingElse(useEditor.getState().project, ctx, response.operations);
  const moved = (out: PromptOutcome): PromptOutcome => (out.status === 'applied' && elsewhere ? { ...out, movedTo: elsewhere } : out);
  if (!response.operations.some(isEditorOperation)) {
    const now = useEditor.getState();
    const choice = objectChoiceFor(now.project, response.operations, 'entityIds' in ctx ? ctx.entityIds : []);
    if (choice) {
      // A change to what an object is goes to the object (every copy); the card offers "a new object instead".
      const change: ObjectChange = { message: response.message, changes: response.changes, operations: response.operations, choice };
      const out = applyObjectChoice(request, change, 'object');
      return moved(out.status === 'applied' ? { ...out, asNew: change } : out);
    }
  }
  return moved(applyAIOperations(request, response.message, response.changes, response.operations));
}

/** Operations that go with a change to one thing without being about anything else (a sound for it to play). */
const ALONG = new Set(['make_sound']);

/**
 * The card an answer belongs on, when it was asked on one thing's card (a placed object, or a library object) and
 * changes only one other thing: that thing's own card. A placed thing's card, or for a change to a library object
 * (every copy) its one copy in the level, or with several copies the object's card in Objects. Null when it changes
 * the thing it was asked about (or its object), several things, or the level (placing, drawing, connecting…).
 */
export function aboutSomethingElse(project: Project, ctx: AIContext, operations: Operation[]): AIContext | null {
  if (ctx.kind !== 'entity' && ctx.kind !== 'object') return null;
  const scene = project.scenes.find((s) => s.id === ctx.sceneId);
  if (!scene) return null;
  const selfEntity = ctx.kind === 'entity' ? ctx.entityIds[0] : null;
  const selfObject = ctx.kind === 'object' ? ctx.definitionId : (scene.entities.find((e) => e.id === selfEntity)?.definitionId ?? null);
  const entities = new Set<Id>();
  const objects = new Set<Id>();
  for (const op of operations) {
    if (ALONG.has(op.op)) continue;
    if (op.op === 'set_transform') entities.add(op.entityId);
    else if ('target' in op && 'id' in op && typeof op.id === 'string') (op.target === 'definition' ? objects : entities).add(op.id);
    else return null;
  }
  // A placed thing changed together with its own object counts as one thing.
  for (const id of entities) {
    const def = scene.entities.find((e) => e.id === id)?.definitionId;
    if (def) objects.delete(def);
  }
  if (entities.size + objects.size !== 1) return null;
  if (entities.size) {
    const id = [...entities][0];
    const entity = scene.entities.find((e) => e.id === id);
    // (On a library object's card, one of its own copies is still about it.)
    if (id === selfEntity || !entity || (ctx.kind === 'object' && entity.definitionId === selfObject)) return null;
    return { kind: 'entity', sceneId: scene.id, entityIds: [id] };
  }
  const def = [...objects][0];
  if (def === selfObject || !project.definitions.some((d) => d.id === def)) return null;
  const copies = scene.entities.filter((e) => e.definitionId === def);
  return copies.length === 1 ? { kind: 'entity', sceneId: scene.id, entityIds: [copies[0].id] } : { kind: 'object', sceneId: scene.id, definitionId: def };
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

const EMPTY_RESULT: ApplyResult = { createdDefinitionIds: [], createdEntityIds: [], createdRelationshipIds: [], createdRuleIds: [], removedEntityIds: [], createdAssetIds: [], createdSceneIds: [] };

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
  let openEditor: { definitionId: string; assetId: string | null } | null = null;
  for (const op of operations) {
    if (!isEditorOperation(op)) return { status: 'error', message: "The AI mixed editor and game changes, so nothing was changed." };
    if (op.op === 'open_sprite_editor') {
      // A placed copy opens its object's sprite; the situation's look, or its normal one.
      const { project } = useEditor.getState();
      const entity = project.scenes.flatMap((s) => s.entities).find((e) => e.id === op.id);
      const def = project.definitions.find((d) => d.id === (entity ? entity.definitionId : op.id));
      if (!def) return reject(entity ? `${entity.name} has no object to edit the sprite of` : `There is no object "${op.id}"`);
      const ref = op.situation ? def.components.SpriteStates?.[op.situation] : def.components.Sprite?.assetId;
      const assetId = typeof ref === 'string' && project.assets.some((a) => a.id === ref) ? ref : null;
      openEditor = { definitionId: def.id, assetId };
      continue;
    }
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
  if (Object.keys(patch).length || overlays !== layout.overlays) setLayout({ ...(patch as Partial<EditorLayout>), overlays });
  if (openEditor) useEditor.getState().openSpriteEditor(openEditor);
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
  let created: Id[] = [];
  try {
    after = produce(project, (d) => {
      created = applyOperations(d, operations, componentRegistry).createdSceneIds;
    });
  } catch {
    return null;
  }
  const added = reachabilityProblems(after, sceneId, componentRegistry).filter((p) => !before.has(p.key));
  // The level as the answer would leave it, so the AI can see what went wrong.
  if (added.length) return { text: added.map((p) => p.text).join(' '), map: levelMap(after, sceneId, componentRegistry) };
  // New levels made in the same answer are checked too (everything in them is new).
  for (const id of created) {
    const problems = reachabilityProblems(after, id, componentRegistry);
    const scene = after.scenes.find((s) => s.id === id);
    if (problems.length && scene) return { text: `In the new level "${scene.name}": ${problems.map((p) => p.text).join(' ')}`, map: levelMap(after, id, componentRegistry) };
  }
  return null;
}

function mapText(map: LevelMap | null): string {
  if (!map) return '';
  return `\n\nThe level after your previous answer would look like this (same legend as context.level.map):\n${[map.ruler, ...map.rows].join('\n')}`;
}
