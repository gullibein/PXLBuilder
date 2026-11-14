/**
 * The level menu's engine-built levels (no AI): a new level, the level built again, a variation of it; and the "two
 * more levels" after a new game. Each is checked by the builder before it changes anything, and is one Undo step.
 */
import { produce } from 'immer';
import { componentRegistry } from '../core/components/builtin';
import { applyBuilt, blueprintFor, buildLevel, newBuiltLevel, noBuilderReason, type BuildKind } from '../core/levelGen/build';
import { LevelGenError, type GenerateResult } from '../core/levelGen/generate';
import { newLevelSeed } from '../core/levelGen/random';
import { addScene } from '../core/model/mutations';
import type { Id, Project, Scene } from '../core/types';
import { frameView } from './actions';
import { useEditor } from './store';

export type BuildOutcome = { ok: true; message: string; sceneIds: Id[] } | { ok: false; message: string };

/** In words: what was built and how it checked out. */
function summary(built: GenerateResult): string {
  const f = built.madeBy.fingerprint as { structure?: string; sections?: string[] } | null;
  const how = built.state === 'validated' ? 'checked: playable' : `not proven playable (${built.notes.at(-1) ?? 'the checker could not judge it'})`;
  return `${f?.structure ?? 'level'}, ${f?.sections?.length ?? 0} sections, difficulty ${built.madeBy.blueprint.difficulty} · ${how}`;
}

const fail = (e: unknown): BuildOutcome => {
  if (e instanceof LevelGenError) return { ok: false, message: e.message };
  throw e;
};

/** New level (after the others), this level built again, or a variation of it. */
export function engineBuild(kind: BuildKind): BuildOutcome {
  const state = useEditor.getState();
  const project = state.project;
  const why = noBuilderReason(project, componentRegistry);
  if (why) return { ok: false, message: why };
  const seed = newLevelSeed();
  try {
    if (kind === 'new') {
      const ask = blueprintFor(project, null, 'new', seed)!;
      const { scene, built } = newBuiltLevel(project, `Level ${project.scenes.length + 1}`, ask.blueprint, componentRegistry, ask);
      const ok = state.edit(`New level, built by the engine`, (p) => {
        addScene(p, scene);
        applyBuilt(p, scene.id, built, componentRegistry);
      });
      if (!ok) return { ok: false, message: "The new level couldn't be added (the Console says why)" };
      state.setActiveScene(scene.id);
      frameView();
      return { ok: true, message: `${scene.name}: ${summary(built)}`, sceneIds: [scene.id] };
    }
    const sceneId = state.activeSceneId;
    const ask = blueprintFor(project, sceneId, kind, seed);
    if (!ask) return { ok: false, message: 'Only a level the engine built can be varied: use Regenerate to build this one anew' };
    const built = buildLevel(project, sceneId, ask.blueprint, componentRegistry, ask);
    const label = kind === 'regenerate' ? 'Level built again by the engine' : 'A variation of the level, by the engine';
    if (!state.edit(label, (p) => void applyBuilt(p, sceneId, built, componentRegistry))) return { ok: false, message: "The level couldn't be changed (the Console says why)" };
    frameView();
    return { ok: true, message: `${summary(built)} · Undo brings the old level back`, sceneIds: [sceneId] };
  } catch (e) {
    return fail(e);
  }
}

/** `n` more levels after the game's, each a step harder, of other structures than the ones before: one Undo step. */
export function engineMoreLevels(n: number): BuildOutcome {
  const state = useEditor.getState();
  const why = noBuilderReason(state.project, componentRegistry);
  if (why) return { ok: false, message: why };
  const made: { scene: Scene; built: GenerateResult }[] = [];
  let soFar: Project = state.project;
  try {
    for (let i = 0; i < n; i++) {
      const ask = blueprintFor(soFar, null, 'new', newLevelSeed())!;
      const r = newBuiltLevel(soFar, `Level ${soFar.scenes.length + 1}`, ask.blueprint, componentRegistry, ask);
      made.push(r);
      // (The next one is built knowing about this one: harder, another structure.)
      soFar = produce(soFar, (d) => {
        addScene(d, JSON.parse(JSON.stringify(r.scene)));
        applyBuilt(d, r.scene.id, r.built, componentRegistry);
      });
    }
  } catch (e) {
    return fail(e);
  }
  const ok = state.edit(`${n} more levels, built by the engine`, (p) => {
    for (const r of made) {
      addScene(p, r.scene);
      applyBuilt(p, r.scene.id, r.built, componentRegistry);
    }
  });
  if (!ok) return { ok: false, message: "The levels couldn't be added (the Console says why)" };
  return { ok: true, message: made.map((r) => `${r.scene.name}: ${summary(r.built)}`).join('; '), sceneIds: made.map((r) => r.scene.id) };
}
