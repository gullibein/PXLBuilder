/**
 * "Save with history": the game's file with everything about how it was made beside it, for working out afterwards
 * what the engine and the AI did together. It opens as an ordinary game (the extra part is not read). What is in it:
 * the app's version, the AI connection's settings (never the key), every AI request of this visit in full (what
 * was sent, the answers uncut, every step, how it ended), the shorter traces the AI History still holds of earlier
 * visits, the console, the last play and play check, the screen, and notes on the game's scripts (how big each is,
 * and long formulas written more than once).
 */
import { componentRegistry } from '../core/components/builtin';
import { levelsToGetThrough } from '../core/ai/levelIdeas';
import { exprSlots, SCRIPT_LIMITS, type BehaviorScript, type Stmt } from '../core/script/language';
import { projectToBundle } from '../core/serialization/serialize';
import type { Project } from '../core/types';
import { aiHistoryFor, useAILog } from './ai/aiLog';
import { getAISettings } from './ai/aiSettings';
import { diagnosticsFor, withoutKeys } from './ai/diagnostics';
import { getSpend } from './ai/spend';
import { offerTextFile, sizeText, slugify } from './persistence';
import { useEditor } from './store';

/** How big a script is, and the long formulas it writes more than once (what a way to write a test once would save). */
export interface ScriptNote {
  owner: string;
  script: string;
  handlers: number;
  statements: number;
  vars: number;
  states: number;
  deepest: number;
  longestExpression: number;
  /** Formulas of 120 characters or more that appear more than once: how long, how often, and how each begins. */
  repeated: { chars: number; times: number; begins: string }[];
  characters: number;
}

export function scriptNote(owner: string, script: BehaviorScript): ScriptNote {
  let statements = 0;
  let deepest = 0;
  const seen = new Map<string, number>();
  const read = (text: string | null | undefined) => {
    if (typeof text === 'string') seen.set(text, (seen.get(text) ?? 0) + 1);
  };
  const walk = (list: Stmt[], depth: number) => {
    deepest = Math.max(deepest, depth);
    for (const s of list) {
      statements++;
      for (const text of exprSlots(s)) read(text);
      const inner = s as { then?: Stmt[]; else?: Stmt[] };
      if (Array.isArray(inner.then)) walk(inner.then, depth + 1);
      if (Array.isArray(inner.else)) walk(inner.else, depth + 1);
    }
  };
  for (const h of script.handlers) {
    read(h.if);
    walk(h.do, 1);
  }
  const all = [...seen.entries()];
  return {
    owner,
    script: script.name,
    handlers: script.handlers.length,
    statements,
    vars: script.vars.length,
    states: script.states.length,
    deepest,
    longestExpression: Math.max(0, ...all.map(([t]) => t.length)),
    repeated: all
      .filter(([t, n]) => n > 1 && t.length >= 120)
      .map(([t, n]) => ({ chars: t.length, times: n, begins: t.slice(0, 80) }))
      .sort((a, b) => b.chars * b.times - a.chars * a.times),
    characters: JSON.stringify(script).length,
  };
}

/** Notes on the game as it is: what kind the app takes it for, and its scripts. */
export function gameNotes(project: Project): { levels: number; objects: number; placed: number; levelsToGetThrough: boolean; scriptLimits: typeof SCRIPT_LIMITS; scripts: ScriptNote[] } {
  const scripts = [
    ...project.definitions.flatMap((d) => (d.scripts ?? []).map((s) => scriptNote(d.name, s))),
    ...project.scenes.flatMap((sc) => sc.entities.flatMap((e) => ((e as { scripts?: BehaviorScript[] }).scripts ?? []).map((s) => scriptNote(`${e.name ?? e.id} (placed in ${sc.name})`, s)))),
  ];
  return {
    levels: project.scenes.length,
    objects: project.definitions.length,
    placed: project.scenes.reduce((n, s) => n + s.entities.length, 0),
    levelsToGetThrough: levelsToGetThrough(project, componentRegistry),
    scriptLimits: SCRIPT_LIMITS,
    scripts,
  };
}

/** The file's text. */
export function historyFileText(): string {
  const state = useEditor.getState();
  const project = state.project;
  const full = diagnosticsFor(project.id);
  // (Requests of earlier visits: the AI History's own steps, cut short as it keeps them; those of this visit are in full.)
  const earlier = useAILog
    .getState()
    .entries.filter((e) => e.project === project.id && e.trace?.length && !full.some((r) => r.request === e.request && Math.abs(r.time - e.time) < 30 * 60_000))
    .map((e) => ({ time: e.time, where: e.where, request: e.request, status: e.status, message: e.message, changes: e.changes, steps: e.trace }));
  const ai = getAISettings();
  const view = typeof window === 'undefined' ? null : { width: window.innerWidth, height: window.innerHeight, pixelRatio: window.devicePixelRatio, browser: navigator.userAgent };
  const diagnostics = {
    about: 'Saved with "Save with history": how this game was made, for analysing the engine. The game itself is the rest of the file and opens as usual. No API key is ever in here.',
    version: __PXL_VERSION__,
    saved: new Date().toISOString(),
    ai: { vendor: ai.vendor, claudeModel: ai.claudeModel, geminiModel: ai.geminiModel, geminiBackup: ai.geminiBackup, speed: ai.speed },
    spend: getSpend(),
    screen: view,
    requests: full,
    earlierRequests: earlier,
    console: state.log,
    lastPlay: state.lastPlay ? { report: state.lastPlay.report, gameChangedSince: state.lastPlay.project !== project } : null,
    lastPlayCheck: state.lastProbe ? { report: state.lastProbe.report, gameChangedSince: state.lastProbe.project !== project } : null,
    game: gameNotes(project),
  };
  return withoutKeys(JSON.stringify({ ...projectToBundle(project), aiHistory: aiHistoryFor(project.id), diagnostics }));
}

/** Offers the file as a download, beside the game's own save (which it does not replace). */
export async function saveWithHistory(): Promise<void> {
  const { project, logMessage } = useEditor.getState();
  const text = historyFileText();
  const filename = `${slugify(project.name) || 'project'}.with-history.pxlproj.json`;
  const result = await offerTextFile(filename, text);
  const requests = diagnosticsFor(project.id).length;
  if (result === 'saved') logMessage('info', `Saved "${project.name}" with its history (${filename}, ${sizeText(new Blob([text]).size)}): ${requests} AI request${requests === 1 ? '' : 's'} of this visit in full, the console and the last play. The game's own save is not changed.`);
  else if (result === 'declined') logMessage('info', 'Save cancelled');
  else logMessage('error', 'Could not save the file with its history here.');
}
