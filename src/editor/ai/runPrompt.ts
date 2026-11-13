/**
 * Prompt -> context -> AI -> structured operations -> validation -> transaction.
 *
 * The AI only ever proposes operations. They are applied all-or-nothing as
 * one undoable transaction through the same mutation layer the inspector uses.
 */
import { DrawingScanner, levelSketch, type LevelSketch } from '../../core/ai/streamDrawings';
import { answerPreview, narrateOperation } from '../../core/ai/narrate';
import { levelStats, statsLine } from '../../core/ai/levelIdeas';
import { setJobNote } from './jobs';
import { generatorStatus, generatorTarget, makeBackground, useBackgroundGen } from '../backgroundGen';
import { songIdea, songInstrumentsProblem, UNUSUAL_SONG_WORDS } from '../../core/ai/songIdeas';
import { isoDrawingProblem, spriteSizeProblem } from '../../core/ai/isoDrawing';
import { undrawnObjects } from '../../core/model/drawnLook';
import { TOPICS, topicsFor } from '../../core/ai/topics';
import { ENGINE_PART_INFO, scriptedPart } from '../../core/model/engineParts';
import type { EnginePart } from '../../core/script/language';
import { unaskedChanges } from '../../core/ai/unasked';
import { buildAIPayload, codeFor, codeToSend, contextKey, type AIContext } from '../../core/ai/context';
import { AIUnavailableError, type AIPicture, type AIRequestBody, type AIResponse } from '../../core/ai/protocol';
import { HttpAIProvider, type AIProvider } from '../../core/ai/provider';
import { geminiKey, getApiKey } from './apiKey';
import { chatHistory, conversationKey, unusableReply } from './aiLog';
import type { TraceFn } from '../../core/ai/trace';
import { getAISettings } from './aiSettings';
import { GeminiProvider } from './geminiProvider';
import { BrowserClaudeProvider } from './browserProvider';
import { claudeSample, SampleAIProvider } from './sampleProvider';
import { applyAsNewObject, applyToObject, objectChoiceFor, type ObjectChoice } from '../../core/commands/objectChoice';
import { applyOperations, checkOperations, failedOperations, isEditorOperation, pruneOperations, type ApplyResult, type Operation } from '../../core/commands/operations';
import { checkEditorSetting, editorReference, editorSettingsPayload, type EditorLayout } from '../layout/settings';
import { addOverlays } from '../overlays/overlays';
import { componentRegistry } from '../../core/components/builtin';
import { isTopDownScene } from '../../core/model/topDown';
import { produce } from 'immer';
import { levelMap, type LevelMap } from '../../core/model/levelMap';
import { reachabilityProblems, winProblems } from '../../core/model/reachability';
import { useEditor } from '../store';
import { parseQuickCommand, QUICK_COMMAND_HELP, type QuickCommand } from '../../core/commands/quickCommands';
import { runQuickCommand } from '../quickCommands';
import { removeRelationship } from '../../core/logic/mutations';
import type { GameType, Id, Project, Starter } from '../../core/types';
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
  /** The AI asks before changing (turning engine code into a script): applied only on yes (applyResponse). */
  | { status: 'confirm'; message: string; changes: string[]; response: AIResponse; ctx: AIContext; answered?: 'yes' | 'no' }
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

/** A request for a whole new game ("make a game like this", "build me a space shooter game"), not a change to this one. */
export function makesAGame(request: string): boolean {
  return /\b(make|build|create|remake|recreate)\b[^.?!]{0,40}\bgame\b/i.test(request) && !/\b(this|my|the|our) game\b/i.test(request);
}

/** The starters a new game can be made from, for the AI to choose (context.newGame). */
const STARTERS: { id: Starter; is: string }[] = [
  { id: 'platformer', is: 'seen from the side, with gravity: player that runs, jumps and climbs, ground, platforms, ladders, enemies, spikes, crates, a goal (Mario-like games)' },
  { id: 'topdown', is: 'seen from above, no gravity: player that walks in every direction, floor, walls, doors, wandering enemies, hazards, a goal (Zelda, Rogue, Boulder Dash, mazes, grid and board puzzles)' },
  { id: 'rpg', is: 'an RPG, seen from above: a map to walk (the Overworld, walls, wandering slimes that start battles) and a Battle level where a party (a knight and a mage) fights monsters in turns with menus (Fight, Magic, Potion, Run); health carries over (Dragon Quest, Final Fantasy, Pokémon-like games)' },
  { id: 'roguelike', is: 'a roguelike, seen from above: one random level (a new dungeon every play: rooms, corridors, monsters and treasure picked for the floor; stairs down to deeper, harder floors), played square by square (the monsters answer each step), fog of war, gold and potions, dying starts a new run (Rogue, NetHack, Mystery Dungeon-like games)' },
  { id: 'isometric', is: 'seen from above at an angle (isometric: the level drawn as diamonds, blocks and characters standing upright on them), played as a top-down game: an island of grass blocks in water, dirt, stone ruins, wooden crates, lava, coins, a wandering enemy, a goal; the arrow keys go the way they point on the screen (isometric adventures, Diablo-like views, isometric puzzles)' },
];

export interface PromptOptions {
  /** The first request of a game just made in the New game window: the AI may move it to a better starter first. */
  newGame?: boolean;
  /** Pictures the user attached (an example of the game they want, a sprite sheet…): sent with this request only. */
  images?: AIPicture[];
  /** A new game: drawn with the engine's sprites, or every object drawn by the AI (always, with pictures). */
  sprites?: 'engine' | 'ai';
  /** What it is doing now, in a few words (the New game window shows it while the game is built). */
  onStage?: (stage: string) => void;
  /** The sprites an answer drew (its pixels), as soon as it comes back: shown while the game is built. */
  onDrawings?: (drawn: { id?: string; name: string; palette: { key: string; color: string }[]; rows: string[] }[]) => void;
  /** The level map the AI is writing (draw_map), as far as it has come: for the building window. */
  onSketch?: (sketch: LevelSketch) => void;
  /** Building more levels for a game just made (offered after a new game): it runs while the user plays and edits. */
  moreLevels?: boolean;
  /** What the AI is doing, in words, as its answer is written: its idea, its plan, and a line per finished step. */
  onNarration?: (n: Narration) => void;
}

export interface Narration {
  /** The AI thinking aloud before it builds (a quick model's few lines, as they are written). */
  thoughts: string[];
  idea: string;
  plan: string[];
  doing: string[];
}

/** The line a request with pictures carries in the chat (and so in the AI's memory of it, without the pictures). */
export function withPictureNote(request: string, images: readonly AIPicture[] | undefined): string {
  if (!images?.length) return request;
  return `${request}\n[${images.length} picture${images.length === 1 ? '' : 's'} attached: ${images.map((p) => p.name).join(', ')}]`;
}

export async function runPrompt(ctx: AIContext, request: string, signal?: AbortSignal, trace?: TraceFn, options: PromptOptions = {}): Promise<PromptOutcome> {
  const state = useEditor.getState();
  // Plain editing commands ("delete", "duplicate 3 times to the right", "paste"…) are done by the app itself, at once.
  const quick = options.images?.length ? null : quickCommandFor(ctx, request);
  if (quick) {
    trace?.('note', `Done by the app itself (no AI): ${quick.kind}`);
    return quick.kind === 'connection-delete' ? deleteConnection(ctx) : runQuickCommand(ctx, quick);
  }
  const body: AIRequestBody = {
    context: buildAIPayload(state.project, ctx, componentRegistry, editorSettingsPayload(state.layout), state.lastPlay && { report: state.lastPlay.report, changedSince: state.lastPlay.project !== state.project }, Math.random),
    request,
    // The conversation about this so far (since its last "New chat"; survives closing the card and reloading).
    history: chatHistory(conversationKey(ctx)),
    speed: getAISettings().speed,
    // What the editor's settings are: fixed, so it goes with the (cached) instructions; the context has their values.
    reference: editorReference(),
  };
  // The full code of the objects the request names, sent along (no second round trip).
  // (Also the objects the last answer here was about: "make it more visible" follows up on the Player's script.)
  const along = codeToSend(state.project, ctx, `${request}\n${body.history.at(-1)?.reply.split('\n')[0] ?? ''}`);
  if (along.length) {
    body.code = codeFor(state.project, along);
    trace?.('note', `Sent along: the code of ${body.code.map((c) => c.name).join(', ')}`);
  }
  // An isometric level and a request about how things look: the isometric blocks' pictures go along, pixels and all
  // (each shape of the auto-tiled ones too), so a restyle builds on them instead of drawing flat squares.
  const isoBlocks = isoBlocksToSend(state.project, ctx.sceneId, request, !!options.newGame && options.sprites === 'ai');
  if (isoBlocks.length) {
    const looks = codeFor(state.project, isoBlocks).filter((c) => !(body.code ?? []).some((x) => x.id === c.id));
    body.code = [...(body.code ?? []), ...looks];
    trace?.('note', `Sent along: the pictures of ${looks.map((c) => c.name.replace(/^the pictures of /, '')).join(', ')}`);
  }
  // Guidance only some requests need (music, sound effects…), by what this one is about.
  const topicScene = state.project.scenes.find((sc) => sc.id === ctx.sceneId);
  const newGameAsked = !!options.newGame || (ctx.kind === 'project' && makesAGame(request));
  // (More levels for a game just made: only the level guidance, and backgrounds; the game's look and objects are made.)
  const topics = options.moreLevels ? ['levels', 'backgrounds'] : topicsFor(ctx, request, body.history, newGameAsked, !!topicScene && isTopDownScene(state.project, topicScene, componentRegistry));
  // The level design idea goes only with requests about levels (with the level guidance), and the ideas for new
  // levels only with requests for new ones: the rest of the time they are text the AI reads for nothing.
  const level = body.context.level as { design?: { forNewLevels?: unknown[] } } | undefined;
  if (level?.design) {
    if (!topics.includes('levels')) delete level.design;
    else if (!/\b(new|next|more|another|other|extra|second|third|fourth|fifth|\d+)\s+(\w+\s+)?levels?\b|\blevels\b/i.test(request) && !options.newGame) level.design.forNewLevels = [];
  }
  // Building a level (a new game, or a level asked for): the puzzles picked for it go in the request itself, where the
  // AI can't miss them (in the context they were easily passed over for the easiest, a key and a door). Names only:
  // how each is built is in context.level.design.
  const design = (body.context.level as { design?: { puzzles?: string[]; forNewLevels?: { puzzles?: string[] }[] } } | undefined)?.design;
  const buildsLevels = newGameAsked || /\b(build|make|create|generate|design|rebuild|redo|draw|add)\b[^.?!]*\blevels?\b/i.test(request);
  if (design?.puzzles?.length && buildsLevels) {
    const names = (list: string[]) => list.map((p) => p.split(':')[0]).join(', ');
    const more = (design.forNewLevels ?? []).filter((l) => l.puzzles?.length);
    body.request = options.moreLevels
      ? `${request}\n\n[Puzzles for the new levels (the app picked them so games differ; each needed to get through; context.level.design.forNewLevels says how; a key and door may come too, never instead): ${more.map((l, i) => `new level ${i + 1}: ${names(l.puzzles!)}`).join('; ')}.]`
      : `${request}\n\n[Puzzles to build this level around (the app picked them so games differ; each needed to get through; context.level.design.puzzles says how; a key and door may come too, never instead): ${names(design.puzzles)}.${more.length ? ` Each new level you create gets its own, in context.level.design.forNewLevels (${more.map((l, i) => `${i + 2}: ${names(l.puzzles!)}`).join('; ')}).` : ''} Unless the user asked for something else.]`;
    trace?.('note', `Puzzles for this level: ${names(design.puzzles)}`);
  }
  // "Harder than level 2", "a more complex level", more levels: the level to beat, counted, goes in the request with
  // what beating it means (left to itself the AI often built a simpler one).
  const harder = /\b(harder|tougher|trickier|bigger|larger|longer|more (complex|complicated|difficult|challenging|intricate|advanced)|even more|step up)\b/i.test(request);
  if (buildsLevels && (harder || options.moreLevels)) {
    const named = /\blevel\s*(\d+)\b/i.exec(request);
    const levels = state.project.scenes.filter((sc) => sc.entities.length);
    const ref = (named ? state.project.scenes[Number(named[1]) - 1] : undefined) ?? state.project.scenes.find((sc) => sc.name.toLowerCase() !== '' && request.toLowerCase().includes(sc.name.toLowerCase()) && sc.id !== ctx.sceneId) ?? levels.at(-1);
    const st = ref ? levelStats(state.project, ref, componentRegistry) : null;
    if (ref && st) {
      body.request += `\n\n[The level to beat: ${ref.name} (${statsLine(st)}). ${options.moreLevels ? 'Each new level' : 'This one'} is harder than ${options.moreLevels ? 'the one before it' : 'that'} by its puzzles, not its size: one screen still (about 30 by 17 cells, unless the user asked for bigger), its puzzles taking more steps (one opening the way to the next: a key behind a switch behind a crate…), a few more hazards or enemies, a kind of piece it hasn't used.]`;
      trace?.('note', `The level to beat: ${ref.name} (${statsLine(st)})`);
    }
  }
  // About the background (its card, or the words): the image generator's state and size go along.
  if (ctx.kind === 'background' || /\b(background|backdrop|scenery|sky|skyline|landscape|horizon)\b/i.test(request)) {
    const t = generatorTarget(ctx.sceneId);
    const st = generatorStatus();
    const lastError = useBackgroundGen.getState().lastError;
    body.context.imageGenerator = { ready: st.ready, ...(st.why ? { why: st.why } : {}), ...(lastError ? { lastError } : {}), size: useBackgroundGen.getState().sizeMode, pixels: t.pixels };
  }
  // Music in the request: a song brief drawn at random goes along, so no two new songs come out the same.
  // (Familiar choices, unless the request asks for something unusual or original.)
  if (topics.includes('music')) body.context.songIdea = songIdea(Math.random, UNUSUAL_SONG_WORDS.test(request));
  // Pictures attached: they go along, with how to read them.
  if (options.images?.length) {
    body.images = options.images;
    topics.unshift('pictures');
    trace?.('note', `Pictures sent along: ${options.images.map((p) => `${p.name} (${p.sourceWidth}×${p.sourceHeight}, sent ${p.width}×${p.height})`).join(', ')}`);
  }
  if (topics.length) {
    body.topics = topics;
    trace?.('note', `Guidance sent along: ${topics.join(', ')}`);
  }
  const starterNow = (): GameType => useEditor.getState().project.settings.gameType ?? 'platformer';
  // A new game: from the New game window, or asked for on the whole game ("make a game like this").
  const newGame = !!options.newGame || (ctx.kind === 'project' && makesAGame(request));
  if (newGame && !options.newGame) trace?.('note', 'Asked for a whole new game: built as a new game (the starter may be switched; Undo brings the old one back)');
  // (With pictures the AI always draws the game in their style.)
  // (An original game, asked for in words, is drawn anew too: the starter's look is anything but.)
  const original = /\b(original|unique|unusual|creative|novel|weird|nothing (typical|usual|standard)|not (typical|usual|standard)|surprise me)\b/i.test(request);
  const sprites = newGame ? (options.images?.length || (original && !options.sprites) ? 'ai' : (options.sprites ?? 'engine')) : undefined;
  // (The sprite size chosen in the New game window goes along: the AI keeps it.)
  if (newGame) body.context.newGame = { current: starterNow(), starters: STARTERS, sprites, spriteSize: state.project.settings.spriteResolution ?? 32 };
  let response: AIResponse;
  let editorAfter: Operation[] = [];
  trace?.('note', `Request: ${request}\nAbout: ${contextKey(ctx)}; ${body.history.length} earlier exchange(s) sent as memory; context ${JSON.stringify(body.context).length} characters; speed ${body.speed}`);
  try {
    const provider = await currentProvider();
    const stage = options.onStage ?? (() => {});
    // Every answer passes here: the sprites it drew go to whoever shows them while it works (the building window),
    // each as soon as it is finished, read from the answer while it is still being written (where it comes in bit by bit).
    // What it is doing, in words (kept across its answers: a fix adds to it).
    const names = new Map<string, string>([...state.project.definitions.map((d) => [d.id, d.name] as [string, string]), ...state.project.scenes.map((sc) => [sc.id, sc.name] as [string, string])]);
    const narration: Narration = { thoughts: [], idea: '', plan: [], doing: [] };
    let toldAt = 0;
    const tell = (force = false) => {
      const now = Date.now();
      if (!options.onNarration || (!force && now - toldAt < 200)) return;
      toldAt = now;
      options.onNarration({ thoughts: [...narration.thoughts], idea: narration.idea, plan: [...narration.plan], doing: [...narration.doing] });
    };
    const ask: typeof provider.respond = async (b, sig, tr) => {
      const scanners = new Map<string, DrawingScanner>();
      // (The level map is read again at most a few times a second: it is looked for in all of the answer so far.)
      let sketchAt = 0;
      let sketchSeen = '';
      const draft = options.onDrawings || options.onSketch || options.onNarration
        ? (soFar: string, channel = 'text') => {
            let s = scanners.get(channel);
            if (!s)
              scanners.set(
                channel,
                (s = new DrawingScanner(
                  (d) => options.onDrawings?.([d]),
                  options.onNarration
                    ? (op) => {
                        const line = narrateOperation(op, names);
                        if (line && narration.doing.at(-1) !== line) {
                          narration.doing.push(line);
                          tell(true);
                        }
                      }
                    : undefined,
                )),
              );
            s.feed(soFar);
            if (options.onNarration) {
              const { message, changes } = answerPreview(soFar);
              // (A fix's answer has no message of its own: the first one's stays.)
              if (message && message.length >= narration.idea.length) narration.idea = message;
              if (changes.length > narration.plan.length) narration.plan = changes;
              tell();
            }
            const now = Date.now();
            if (options.onSketch && now - sketchAt > 250 && soFar.includes('draw_map')) {
              sketchAt = now;
              const sketch = levelSketch(soFar);
              // (Changed: more rows, or another map: the next level's.)
              const seen = sketch ? `${sketch.rows.length}:${sketch.rows[0]}:${sketch.legend.length}` : '';
              if (sketch && seen !== sketchSeen) {
                sketchSeen = seen;
                options.onSketch(sketch);
              }
            }
          }
        : undefined;
      // How the time went (AI History): before the first words came (the AI working it out), and the writing.
      const sentAt = Date.now();
      let firstAt = 0;
      let written = 0;
      const timed = (soFar: string, channel?: string) => {
        if (soFar.trim() && !firstAt) firstAt = Date.now();
        written = Math.max(written, soFar.length);
        draft?.(soFar, channel);
      };
      const r = await provider.respond(b, sig, tr, timed);
      tr?.('note', answerTiming(sentAt, firstAt, Date.now(), written));
      const drawn = r.operations.flatMap((o) => (o.op === 'draw_sprite' && !o.situation ? [{ name: o.name, palette: o.palette, rows: o.rows }] : []));
      if (drawn.length) options.onDrawings?.(drawn);
      return r;
    };
    // A new game, or more levels: first the AI thinks aloud (a quick model, a few lines in the user's words), shown as
    // it is written, so there is something to read at once even where the big answer only comes in whole; the build
    // then follows that plan.
    let planned = false;
    if ((newGame || options.moreLevels) && provider.thinkAloud) {
      stage('Thinking it over');
      const asked = Date.now();
      const plan = await thinkFirst(provider, planPrompt(state.project, request, body, !!options.moreLevels), signal, (soFar) => {
        narration.thoughts = soFar.split('\n').map((l) => l.replace(/^[-*•\d.)\s]+/, '').trim()).filter(Boolean);
        tell(true);
      });
      planned = !!plan;
      if (plan) {
        trace?.('note', `Thought aloud first (quick model, ${((Date.now() - asked) / 1000).toFixed(1)} s):\n${plan}`);
        body.request += `\n\n[Your plan, which the user has just watched you think through:\n${plan}\nBuild exactly that, all of it in this answer.]`;
      }
    }
    stage(planned ? 'Building what it planned' : newGame ? (options.images?.length ? 'Looking at your picture and planning the game' : 'Planning the game') : 'Working on it');
    response = await ask(body, signal, trace);
    // Other objects' code isn't sent up front (only the selected one's): when the AI needs some, it says which, and
    // the same request goes again with that code (after the cached game data, so it costs little). At most twice.
    const fetchCode = async () => {
      for (let round = 0; round < 2 && response.kind === 'need_code'; round++) {
        const asked = response.needCode ?? [];
        // Guidance it asked for ("topic:music"), and code.
        const newTopics = asked.flatMap((id) => (id.startsWith('topic:') ? [id.slice(6)] : [])).filter((t) => TOPICS[t] && !(body.topics ?? []).includes(t));
        const sent = new Set((body.code ?? []).map((c) => c.id));
        const fresh = codeFor(useEditor.getState().project, asked.filter((id) => !id.startsWith('topic:'))).filter((c) => !sent.has(c.id));
        if (!fresh.length && !newTopics.length) break;
        if (newTopics.length) {
          trace?.('note', `The AI asked for the guidance on: ${newTopics.join(', ')}; asking again with it`);
          stage(`Read the guide on ${newTopics.join(' and ')}; ${newGame ? 'building and drawing the game' : 'working on it'}`);
          body.topics = [...(body.topics ?? []), ...newTopics];
        }
        if (fresh.length) {
          const names = fresh.map((c) => c.name).join(', ');
          trace?.('note', `The AI asked for the code of: ${names}; asking again with it`);
          state.logMessage('info', `AI asked to read the code of ${names}; sending it.`);
          stage(`Read the code of ${names}; working on it`);
          body.code = [...(body.code ?? []), ...fresh];
        }
        response = await ask(body, signal, trace);
      }
    };
    await fetchCode();
    // A new game the AI would rather build on another starter: made over from that one, and the same request asked
    // again. (It may leave out which starter, there being only two; or only say so in words, building nothing.)
    let switchedTo: Starter | null = null;
    if (newGame) {
      const other: GameType = starterNow() === 'platformer' ? 'topdown' : 'platformer';
      const wantsOther = (r: AIResponse) =>
        r.kind === 'switch_starter' || (!r.operations.length && new RegExp(`${other === 'topdown' ? 'top-?down|from above' : 'platformer|side[- ]view|from the side'}[^.]{0,40}starter|starter[^.]{0,40}${other === 'topdown' ? 'top-?down' : 'platformer'}`, 'i').test(r.message));
      if (wantsOther(response)) {
        const to = response.starter && response.starter !== starterNow() ? response.starter : other;
        trace?.('note', `The AI chose the ${to} starter${response.kind === 'switch_starter' ? '' : ' (in its words)'}; asking again on it`);
        switchStarter(to);
        switchedTo = to;
        stage(`Moved to the ${to === 'topdown' ? 'top-down' : to === 'rpg' ? 'RPG' : to === 'roguelike' ? 'roguelike' : to === 'isometric' ? 'isometric' : 'platformer'} starter; building and drawing the game`);
        const now = useEditor.getState();
        body.context = buildAIPayload(now.project, ctx, componentRegistry, editorSettingsPayload(now.layout), null, Math.random);
        body.context.newGame = { current: to, starters: STARTERS, sprites };
        response = await ask(body, signal, trace);
        await fetchCode();
        // Still nothing built (or another switch): once more, plainly.
        if (response.kind === 'switch_starter' || (!response.operations.length && response.kind !== 'need_code')) {
          trace?.('retry', 'Nothing built on the new starter: asked once more, plainly');
          stage('Nothing was built yet: asking once more');
          response = await ask({ ...body, request: `${request}\n\n[The game is now on the ${switchedTo ?? starterNow()} starter, as you chose (context.newGame.current). Build the whole game now, in this answer (operations); do not switch starters again.]` }, signal, trace);
        }
      }
      if (response.kind === 'switch_starter') response = { ...response, kind: 'answer', operations: [], message: response.message || 'The AI wanted another starter but did not build the game. Ask again.' };
    } else if (response.kind === 'switch_starter') {
      // (Only a new game is made over from another starter: this one stays as it is.)
      response = { ...response, kind: 'answer', operations: [], message: `${response.message} To build it on that starter, start it as a new game (⋯ → New game), or ask on Whole game for "a new game like this".` };
    }
    if (response.kind === 'need_code') {
      // It asked for code that isn't there (or kept asking): say so rather than leave the request hanging.
      response = { ...response, kind: 'answer', operations: [], message: response.message || "The AI couldn't find the code it needed. Try selecting the object it's about and asking there." };
    }
    // An "answer" that only repeats the request (or is empty, or markup) is not one: asked once more, saying so.
    const echoed = (r: AIResponse) => !r.operations.length && unusableReply(request, r.message);
    if (echoed(response)) {
      trace?.('retry', 'The answer only repeated the request (or was empty): asked once more');
      state.logMessage('info', 'The AI only repeated the request instead of answering; asking it again.');
      response = await ask(
        {
          ...body,
          request: `${body.request}\n\n[Your previous answer only repeated this request (or said nothing), so the user got no answer. Answer it now: make the changes it asks for (operations), or, if the game already does what it asks (check the context: components, scripts, what the engine does), say so in your own words and what makes it so.]`,
        },
        signal,
        trace,
      );
      if (echoed(response)) response = { ...response, kind: 'answer', operations: [], changes: [], message: "The AI didn't answer: it only repeated your request, twice, and nothing was changed. Try asking in other words, or start a new chat here (its earlier answers may be confusing it)." };
    }
    // Game changes and editor settings in one answer (a new game that also sets how big Play draws): the game's go
    // through the checks below, the editor's are put back after them and applied after the game's (applyResponse).
    if (response.operations.some(isEditorOperation) && response.operations.some((o) => !isEditorOperation(o))) {
      editorAfter = response.operations.filter(isEditorOperation);
      response = { ...response, operations: response.operations.filter((o) => !isEditorOperation(o)) };
      trace?.('note', `Editor settings in the answer too (${editorAfter.map((o) => o.op).join(', ')}): applied after the game's changes`);
    }
    // A game change that wouldn't apply (a script with a typo, a wrong id), or a level the player can't get through,
    // goes back to the AI once, with the exact problem.
    const gameOps = (r: AIResponse) => r.operations.length > 0 && !r.operations.some(isEditorOperation);
    const broken = gameOps(response) ? checkOperations(useEditor.getState().project, response.operations, componentRegistry) : null;
    const stuck = gameOps(response) && !broken ? playability(ctx.sceneId, response.operations) : null;
    // Changes nobody asked for (a new object for a look, a built-in behavior removed): sent back too.
    // (Not while a game is being built from scratch, a new game or pictures on an empty level: reshaping the starter's
    // objects is then the point.)
    const building = newGame || (!!options.images?.length && !(state.project.scenes.find((s) => s.id === ctx.sceneId)?.entities.length ?? 0));
    const unasked = gameOps(response) && !broken && !stuck && !building ? unaskedChanges(ctx, request, response.operations, useEditor.getState().project) : null;
    // A new game asked with AI-drawn sprites (or pictures) that leaves objects with the engine's pictures or as boxes.
    const undrawn = sprites === 'ai' && gameOps(response) && !broken ? notDrawn(ctx.sceneId, response.operations, !!options.images?.length) : null;
    // Isometric blocks drawn flat, or restyled without their turns and corners.
    const isoDrawn = gameOps(response) && !broken ? isoDrawingProblem(useEditor.getState().project, response.operations) : null;
    // The sprite size changed when nobody asked (the user chose it).
    const resized = gameOps(response) && !broken ? spriteSizeProblem(useEditor.getState().project, request, response.operations) : null;
    // A new song without instruments of its own (made for its mood).
    const ownSound = gameOps(response) && !broken ? songInstrumentsProblem(response.operations) : null;
    // (Everything wrong with it at once: one more answer fixes it all.)
    const problem = broken ?? ([stuck?.text, unasked, undrawn, isoDrawn, resized, ownSound].filter(Boolean).join('; also, ') || null);
    if (problem) {
      trace?.('check', `Didn't check out: ${problem}`);
      trace?.('retry', 'Sent back once with that problem');
      stage("Fixing what didn't check out");
      state.logMessage('info', `AI answer didn't check out (${problem}); asking it to fix that.`);
      const first = [response.message, ...response.changes.map((c) => `- ${c}`)].join('\n');
      const firstAnswer = response;
      // A big answer with a few parts that wouldn't apply (a typo in one script): only those go back, and only their
      // corrections come back, put in their places; the rest is kept. (A whole game written again takes minutes.)
      const failed = broken ? failedOperations(useEditor.getState().project, response.operations, componentRegistry) : [];
      const patch = failed.length > 0 && failed.length <= 6 && response.operations.length >= 6;
      if (patch) {
        const ops = response.operations;
        const listed = failed.map((f, n) => `${n + 1}. operation ${f.index + 1} (${ops[f.index].op}): ${f.message}\n${JSON.stringify(ops[f.index]).slice(0, 12000)}`).join('\n');
        trace?.('note', `Only the ${failed.length} part(s) that failed go back; the other ${ops.length - failed.length} are kept`);
        stage(`Fixing ${failed.length === 1 ? 'one part' : `${failed.length} parts`} that didn't check out`);
        try {
          const fix = await ask(
            {
              ...body,
              history: [...body.history, { request, reply: first }],
              request: `${body.request}\n\n[Your previous answer is kept, except ${failed.length} operation(s) that could not be applied:\n${listed}\nSend ONLY the corrected replacements for these, in the same order (kind "preview", operations: just those; message "" and changes []). Do not send anything else again: the rest of your answer stays as it is.]`,
            },
            signal,
            trace,
          );
          const fixed = fix.operations.filter((o) => !isEditorOperation(o));
          const at = new Set(failed.map((f) => f.index));
          let merged: Operation[];
          if (fixed.length === failed.length) {
            const by = new Map(failed.map((f, n) => [f.index, fixed[n]]));
            merged = ops.map((o, i) => by.get(i) ?? o);
          } else {
            const firstAt = failed[0].index;
            merged = [...ops.slice(0, firstAt).filter((_, i) => !at.has(i)), ...fixed, ...ops.slice(firstAt).filter((_, i) => !at.has(i + firstAt))];
          }
          response = { ...firstAnswer, kind: 'preview', operations: merged };
          // The parts put right, the level it makes may still not work (a map written again without its door or goal):
          // that goes back once more, for just the operations that fix it (added to the answer).
          const left = playability(ctx.sceneId, merged);
          if (left) {
            trace?.('check', `Didn't check out: ${left.text}`);
            trace?.('retry', 'Sent back once more for just what fixes that');
            stage('Fixing the level');
            const more = await ask(
              {
                ...body,
                history: [...body.history, { request, reply: first }],
                request: `${body.request}\n\n[Your answer is kept (with your corrections), but the level it makes has this problem: ${left.text} Send ONLY the operations that fix it, added after your answer (kind "preview", message "" and changes []): e.g. place what is missing with place_instance (and connect it), or draw_map the whole level again with clear true.${mapText(left.map)}]`,
              },
              signal,
              trace,
            ).catch((e: Error) => {
              if (e.name === 'AbortError') throw e;
              trace?.('note', `The level fix couldn't be used (${e.message})`);
              return null;
            });
            const extra = more?.operations.filter((o) => !isEditorOperation(o)) ?? [];
            if (extra.length) response = { ...response, operations: [...merged, ...extra] };
          }
        } catch (e) {
          if ((e as Error).name === 'AbortError') throw e;
          // (The corrections were lost: what applies is kept, below.)
          trace?.('note', `The corrections couldn't be used (${(e as Error).message})`);
        }
      } else {
        try {
          response = await ask(
            {
              ...body,
              history: [...body.history, { request, reply: first }],
              request: `${body.request}\n\n[Your previous answer could not be applied: ${problem}. Fix that and send the complete corrected answer (it replaces the previous one; context.level.map shows the level without it). The user never saw the previous answer: write the message as your first answer, without mentioning an earlier attempt.${mapText(stuck?.map ?? null)}]`,
            },
            signal,
            trace,
          );
        } catch (e) {
          // The corrected answer was lost (unreadable, cut off, the AI unreachable): when the first one applies as it
          // is (only a softer problem: a level problem, an unasked change, an undrawn object), it is kept, saying so,
          // rather than losing all of it.
          if ((e as Error).name === 'AbortError' || broken) throw e;
          trace?.('note', `The corrected answer couldn't be used (${(e as Error).message}); keeping the first one, which applies`);
          state.logMessage('warn', `The AI's corrected answer couldn't be used; kept its first answer (${problem}).`);
          // (A level problem and an unasked change are each said below; an undrawn object here.)
          response = { ...firstAnswer, kind: 'preview', changes: undrawn ? [...firstAnswer.changes, `⚠ ${undrawn}`] : firstAnswer.changes };
        }
      }
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
      // Still changing what wasn't asked for: said plainly with the changes (undo takes it back).
      const stillUnasked = gameOps(response) && !building ? unaskedChanges(ctx, request, response.operations, useEditor.getState().project) : null;
      if (stillUnasked) {
        trace?.('check', `Still changes what wasn't asked for: ${stillUnasked}`);
        response = { ...response, kind: 'preview', changes: [...response.changes, `⚠ This also changed things you didn't ask for (${/removes/.test(stillUnasked) ? 'it removed a behavior or rule' : 'it made a new object'}); undo (Ctrl+Z) if you don't want that`] };
      }
      // Still not playable: show it for confirmation, with the problem.
      const stillStuck = gameOps(response) ? (playability(ctx.sceneId, response.operations)?.text ?? null) : null;
      if (stillStuck) {
        state.logMessage('warn', `AI level still has a problem: ${stillStuck}`);
        trace?.('check', `Level still has a problem: ${stillStuck}`);
        response = { ...response, kind: 'preview', changes: [...response.changes, `⚠ ${stillStuck}`] };
      }
    }
    // A new game (or the levels offered after one): the puzzles picked for each level must be in it (left alone,
    // the AI built ramps, water and the like into hardly any level). Missing ones go back once, for just the
    // operations that add them.
    if ((newGame || options.moreLevels) && gameOps(response) && design?.puzzles?.length) {
      const missing = missingPuzzles(useEditor.getState().project, ctx.sceneId, response.operations, options.moreLevels ? null : design.puzzles, (design.forNewLevels ?? []).map((l) => l.puzzles ?? []));
      if (missing) {
        trace?.('check', `The levels lack the puzzles picked for them: ${missing.text}`);
        trace?.('retry', 'Sent back once for just the operations that add them');
        stage('Adding the puzzles');
        const more = await ask(
          {
            ...body,
            history: [...body.history, { request, reply: [response.message, ...response.changes.map((c) => `- ${c}`)].join('\n') }],
            request: `${body.request}\n\n[Your answer is kept, but these levels lack the puzzles picked for them: ${missing.text}. Build each one in so it matters (context.level.design says how; the pieces: Ramp and Ramp left "/" "\\", Water and Deep water "~", Bridge "-", Crate, Spring, Teleporter, Switch…). Send ONLY the operations that add them, added after your answer (kind "preview", message "" and changes []): draw_map the level again with clear true and its sceneId (the whole level, with them in it, and everything placed after the map placed again), or place_instance / draw_tiles where they fit.${mapText(missing.map)}]`,
          },
          signal,
          trace,
        ).catch((e: Error) => {
          if (e.name === 'AbortError') throw e;
          trace?.('note', `The puzzles couldn't be added (${e.message})`);
          return null;
        });
        const extra = more?.operations.filter((o) => !isEditorOperation(o)) ?? [];
        if (extra.length) {
          const merged = [...response.operations, ...extra];
          // (Kept only when it all still applies; else the answer as it was.)
          if (!checkOperations(useEditor.getState().project, merged, componentRegistry)) response = { ...response, operations: merged };
          else trace?.('note', "The added puzzles didn't apply; kept the answer as it was");
        }
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
  // (The editor settings set aside for the checks: with the rest again, also when it waits for the user's yes.)
  if (editorAfter.length) response = { ...response, operations: [...response.operations, ...editorAfter] };
  // Turning a part of the engine's own code into a script (or anything the AI asks about first) waits for a yes.
  const parts = enginePartsTakenOver(useEditor.getState().project, response.operations);
  if (response.kind === 'confirm' || parts.length) {
    const question = parts.length && response.kind !== 'confirm' ? `${response.message} This turns ${parts.join(' and ')} (the engine's own code) into a script. Do it?` : response.message;
    trace?.('note', `Waiting for the user's yes${parts.length ? ` (turns ${parts.join(', ')} into a script)` : ''}`);
    return { status: 'confirm', message: question, changes: response.changes, response, ctx };
  }
  return applyResponse(ctx, request, response);
}

/**
 * What an engine part taken over by these operations is called, per owner ("the Player's jumping"): a use_script_for,
 * or a script set with takesOver where the owner has none for that part yet.
 */
export function enginePartsTakenOver(project: Project, operations: AIResponse['operations']): string[] {
  const out: string[] = [];
  for (const op of operations) {
    if (op.op !== 'use_script_for' && op.op !== 'set_script') continue;
    let part: EnginePart | undefined;
    if (op.op === 'use_script_for') part = op.part;
    else {
      try {
        part = (JSON.parse(op.scriptJson) as { takesOver?: EnginePart }).takesOver;
      } catch {
        part = undefined;
      }
    }
    if (!part) continue;
    const def = op.target === 'definition' ? project.definitions.find((d) => d.id === op.id) : undefined;
    const entity = op.target === 'instance' ? project.scenes.flatMap((sc) => sc.entities).find((e) => e.id === op.id) : undefined;
    const scripts = def?.scripts ?? entity?.scripts;
    if (op.op === 'set_script' && scriptedPart(scripts, part)) continue;
    const name = def?.name ?? entity?.name ?? 'the new object';
    out.push(`the ${name}'s ${ENGINE_PART_INFO[part].label}`);
  }
  return [...new Set(out)];
}

/** Applies an answer's changes (also one the user said yes to): to the object (with "a new object instead"), or as they are. */
export function applyResponse(ctx: AIContext, request: string, response: AIResponse): PromptOutcome {
  // Game changes and editor settings together: the game's first (as below), then the editor's.
  const editorOps = response.operations.filter(isEditorOperation);
  if (editorOps.length && editorOps.length < response.operations.length) {
    const out = applyResponse(ctx, request, { ...response, operations: response.operations.filter((o) => !isEditorOperation(o)) });
    if (out.status !== 'applied') return out;
    const ed = applyEditorOperations('', [], editorOps);
    return ed.status === 'applied' ? out : { ...out, changes: [...out.changes, `⚠ ${'message' in ed ? ed.message : "An editor setting couldn't be applied"}`] };
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
  return moved(applyAIOperations(request, response.message, response.changes, response.operations, contextKey(ctx)));
}

/** Operations that go with a change to one thing without being about anything else (a sound for it to play). */
const ALONG = new Set(['make_sound', 'make_instrument', 'make_song']);

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
export function applyAIOperations(request: string, message: string, changes: string[], operations: Operation[], jobKey?: string): PromptOutcome {
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
  // Background pictures the AI asked the image generator for: made now, one after another (its own Undo step each).
  const pictures = result.backgroundRequests ?? [];
  if (pictures.length) void (async () => {
    for (const b of pictures) {
      // (The size the AI chose becomes the Background panel's setting too.)
      if (b.size) useBackgroundGen.setState({ sizeMode: b.size, ...(b.size === 'custom' && b.width && b.height ? { custom: { w: b.width, h: b.height } } : {}) });
      const done = await makeBackground(b.sceneId, b.prompt, b.size ?? undefined, b.parallax);
      // (The answer's card says how it went: ready, or why not.)
      if (jobKey) setJobNote(jobKey, done.ok ? `✓ ${done.message}` : `⚠ ${done.message}`);
    }
  })();
  return { status: 'applied', message, changes, result, touched, transactionId: after.history.past.at(-1)?.id, ...(pictures.length ? { note: 'The image generator is painting the background picture: it takes about half a minute. This line changes when it is ready.' } : {}) };
}

/**
 * What the operations would newly make impossible to reach in the level (the
 * player can't get to an item, the exit, a platform…), in words; null if
 * nothing. Problems that were there before the change don't count.
 */
function playability(sceneId: Id, operations: Operation[]): { text: string; map: LevelMap | null } | null {
  const project = useEditor.getState().project;
  const problems = (pr: Project, id: Id) => [...reachabilityProblems(pr, id, componentRegistry), ...winProblems(pr, id, componentRegistry)];
  const before = new Set(problems(project, sceneId).map((p) => p.key));
  let after: Project;
  let created: Id[] = [];
  try {
    after = produce(project, (d) => {
      created = applyOperations(d, operations, componentRegistry).createdSceneIds;
    });
  } catch {
    return null;
  }
  const added = problems(after, sceneId).filter((p) => !before.has(p.key));
  // The level as the answer would leave it, so the AI can see what went wrong.
  if (added.length) return { text: added.map((p) => p.text).join(' '), map: levelMap(after, sceneId, componentRegistry) };
  // New levels made in the same answer are checked too (everything in them is new).
  for (const id of created) {
    const found = problems(after, id);
    const scene = after.scenes.find((s) => s.id === id);
    if (found.length && scene) return { text: `In the new level "${scene.name}": ${found.map((p) => p.text).join(' ')}`, map: levelMap(after, id, componentRegistry) };
  }
  return null;
}

/** The objects a new game with AI-drawn sprites would leave undrawn, as a problem to send back (or null). */
function notDrawn(sceneId: Id, operations: Operation[], pictures: boolean): string | null {
  const project = useEditor.getState().project;
  let after: Project;
  try {
    after = produce(project, (d) => void applyOperations(d, operations, componentRegistry));
  } catch {
    return null;
  }
  const names = undrawnObjects(project, after, sceneId);
  if (!names.length) return null;
  return `the game is to be drawn by you (context.newGame.sprites "ai"${pictures ? ', in the style of the pictures' : ''}), but these objects in the level would keep the engine's pictures or stay plain boxes: ${names.join(', ')}. Draw each of them with draw_sprite (ground and walls that join up with draw_autotile)${pictures ? ', as their counterparts in the pictures look' : ''}, along with everything else in your answer`;
}

function mapText(map: LevelMap | null): string {
  if (!map) return '';
  return `\n\nThe level after your previous answer would look like this (same legend as context.level.map):\n${[map.ruler, ...map.rows].join('\n')}`;
}

/** Words of a request about how things look (draw, style, colors, tiles…). */
const LOOK_WORDS = /\b(draw|redraw|repaint|paint|look|looks|style|styled|restyle|sprite|sprites|tile|tiles|block|blocks|picture|pictures|art|pixel|colou?r|colou?rs|texture|theme|cartoon\w*|realistic|cute|retro|darker|lighter|brighter|snow\w*|winter|autumn|fall|desert|spooky|grass|dirt|road|water|lava|stone|wood)\b/i;

/** In an isometric level, for a request about how things look: "look:<id>" for each isometric block object there. */
export function isoBlocksToSend(project: Project, sceneId: string, request: string, always: boolean): string[] {
  const scene = project.scenes.find((x) => x.id === sceneId);
  if (scene?.world.view !== 'iso' || (!always && !LOOK_WORDS.test(request))) return [];
  return project.definitions.filter((d) => d.components.Sprite?.isoLook === 'iso_floor' || d.components.Sprite?.isoLook === 'iso_block').map((d) => `look:${d.id}`);
}

/** What shows a puzzle is in a level (levelStats' kinds of pieces). */
const PUZZLE_PIECES: Record<string, string> = {
  'crate step': 'crates',
  'crate stack': 'crates',
  'teleporter shortcut': 'teleporters',
  'drop-through': 'jump-through platforms',
  'bridge over the gap': 'jump-through platforms',
  'swim for it': 'water to swim',
  hill: 'ramps',
  'switch and door': 'switches',
  'key and door': 'locked doors',
  'moving platform': 'moving platforms',
  'hidden ladder': 'hidden things',
  'lava pit': 'lava',
  'spring up': 'springs',
};

/**
 * The puzzles picked for the levels an answer builds that aren't in them (by the pieces each needs): this level's
 * (`here`, null: not built now) and those of the levels it creates, in order. Null when all are there.
 */
function missingPuzzles(project: Project, sceneId: Id, operations: Operation[], here: string[] | null, forNew: string[][]): { text: string; map: LevelMap | null } | null {
  let after: Project;
  let created: Id[] = [];
  try {
    after = produce(project, (d) => {
      created = applyOperations(d, operations, componentRegistry).createdSceneIds;
    });
  } catch {
    return null;
  }
  const builds = operations.some((o) => o.op === 'draw_map' && o.sceneId === sceneId);
  // (New levels are named by the ref their create_level gave them: the operations added go in the same answer.)
  const refs = operations.flatMap((o) => (o.op === 'create_level' ? [o.ref] : []));
  const check: { id: Id; as: string; puzzles: string[] }[] = [...(here && builds ? [{ id: sceneId, as: sceneId, puzzles: here }] : []), ...created.map((id, i) => ({ id, as: refs[i] ?? id, puzzles: forNew[i] ?? [] }))];
  const out: string[] = [];
  let map: LevelMap | null = null;
  for (const { id, as, puzzles } of check) {
    const scene = after.scenes.find((s) => s.id === id);
    const st = scene ? levelStats(after, scene, componentRegistry) : null;
    if (!scene || !st) continue;
    const lacking = puzzles.map((p) => p.split(':')[0].trim()).filter((name) => PUZZLE_PIECES[name] && !st.pieces.includes(PUZZLE_PIECES[name]));
    if (lacking.length) {
      out.push(`${scene.name} (sceneId ${as}): ${lacking.map((n) => `${n} (no ${PUZZLE_PIECES[n]})`).join(', ')}`);
      map ??= levelMap(after, id, componentRegistry);
    }
  }
  return out.length ? { text: out.join('; '), map } : null;
}

/**
 * An answer's time in words: before its first words (the AI working the answer out, and reading the request) and the
 * writing, with how fast it wrote. Without words as they came (a connection that gives the answer only at the end): the
 * whole time.
 */
export function answerTiming(sentAt: number, firstAt: number, doneAt: number, chars: number): string {
  const sec = (ms: number) => `${(ms / 1000).toFixed(1)} s`;
  if (!firstAt || !chars) return `Timing: the answer came all at once after ${sec(doneAt - sentAt)} (this connection doesn't send it as it is written)`;
  const writing = Math.max(1, doneAt - firstAt);
  return `Timing: first words after ${sec(firstAt - sentAt)} (the AI working it out before it writes), then ${chars} characters written in ${sec(writing)} (${Math.round((chars / writing) * 1000)} a second)`;
}

/** Thinking aloud first, given up on after a while (the build goes on without it). Null when there is none. */
async function thinkFirst(provider: { thinkAloud?: (p: string, s?: AbortSignal, t?: (x: string) => void) => Promise<string> }, prompt: string, signal: AbortSignal | undefined, onText: (soFar: string) => void): Promise<string | null> {
  const stop = new AbortController();
  const quit = () => stop.abort();
  signal?.addEventListener('abort', quit);
  const timer = setTimeout(quit, 25_000);
  try {
    const text = (await provider.thinkAloud!(prompt, stop.signal, onText)).trim();
    return text ? text.slice(0, 1500) : null;
  } catch (e) {
    if (signal?.aborted) throw e;
    return null;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', quit);
  }
}

/** What the AI thinks aloud about: the request, and the game in brief (its objects, its levels, the puzzles picked). */
export function planPrompt(project: Project, request: string, body: AIRequestBody, moreLevels: boolean): string {
  const objects = project.definitions.map((d) => d.name).slice(0, 40).join(', ');
  const levels = project.scenes.filter((sc) => sc.entities.length).map((sc) => {
    const st = levelStats(project, sc, componentRegistry);
    return st ? `${sc.name} (${statsLine(st)})` : sc.name;
  });
  const design = (body.context.level as { design?: { puzzles?: string[]; forNewLevels?: { puzzles?: string[] }[]; style?: { name: string } } } | undefined)?.design;
  const puzzles = moreLevels
    ? (design?.forNewLevels ?? []).slice(0, 2).map((l, i) => `new level ${i + 1}: ${(l.puzzles ?? []).map((p) => p.split(':')[0]).join(', ')}`).join('; ')
    : (design?.puzzles ?? []).map((p) => p.split(':')[0]).join(', ');
  return [
    `You are the AI in PXLBuilder, a maker of 2D pixel-art games, about to ${moreLevels ? 'build more levels for a game' : 'make a whole new game'} for a user who watches while you work. They asked: "${request.split('\n\n[')[0]}"`,
    `The game now: objects ${objects || 'none yet'}; levels ${levels.join('; ') || 'one, empty'}.${design?.style ? ` Kind of platformer suggested: ${design.style.name}.` : ''}${puzzles ? ` Puzzles picked for the levels: ${puzzles}.` : ''}`,
    `Think aloud for them: 4 to 7 short lines in the language they wrote in, first person, each one decision you are making: the idea and its feel, the look, the player and what it can do, the enemies and pieces, ${moreLevels ? 'each new level\'s layout and puzzles and what makes it harder' : 'the level\'s layout and puzzles'}, the background. Concrete and specific, only what you will really build. Plain lines: no headings, numbering, lists or code.`,
  ].join('\n\n');
}
