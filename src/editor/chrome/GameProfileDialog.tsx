import { useEffect, useState } from 'react';
import { componentRegistry } from '../../core/components/builtin';
import { checkGame, profileChoices, profileOf, setGameProfile, storedGameProfile, type ProfileChange } from '../../core/engine/profile';
import { abilityOn, gameFacts, type PlayerFacts } from '../../core/engine/actual';
import * as m from '../../core/model/mutations';
import { modules, type AbilityModule, type GeneratorModule } from '../../core/engine/modules';
import type { ModuleKind } from '../../core/engine/module';
import { PRESETS } from '../../core/engine/presets';
import { GENRES, THEMES } from '../../core/levelGen/profile';
import { useEditor } from '../store';

/** One system of the profile: its module, and what it can be. */
const SYSTEMS: { key: 'view' | 'time' | 'movement' | 'generator'; label: string; kind: ModuleKind }[] = [
  { key: 'view', label: 'View', kind: 'view' },
  { key: 'time', label: 'Time', kind: 'time' },
  { key: 'movement', label: 'Movement', kind: 'locomotion' },
  { key: 'generator', label: 'Level builder', kind: 'generator' },
];

/**
 * The game's profile (engine/profile.ts): which module of each engine system it uses. Each can be changed on its own
 * (one undoable step each); a change that doesn't go together with the rest is refused with why, one that works in
 * a lesser way says so. A preset sets them all at once (the game's objects stay). The AI changes it with
 * set_game_profile.
 */
export function GameProfileDialog() {
  const open = useEditor((s) => s.profileOpen);
  const project = useEditor((s) => s.project);
  const [problem, setProblem] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  // (Esc closes it wherever the focus is: a select loses it when the dialog redraws after a change.)
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setProblem(null);
      setDone(null);
      useEditor.getState().setProfileOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);
  if (!open) return null;
  const profile = profileOf(project, componentRegistry);
  const stored = !!storedGameProfile(project);
  const check = checkGame(project, componentRegistry);
  // What the game actually is: each player-controlled character's own movement and abilities (engine/actual.ts).
  const facts = gameFacts(project, componentRegistry);
  const { choices } = profileChoices();
  const close = () => {
    setProblem(null);
    setDone(null);
    useEditor.getState().setProfileOpen(false);
  };
  const change = (c: ProfileChange, label: string) => {
    setProblem(null);
    setDone(null);
    let notes: string[] = [];
    let refused: string | null = null;
    const ok = useEditor.getState().edit(`Game profile: ${label}`, (p) => {
      try {
        notes = setGameProfile(p, c, componentRegistry);
      } catch (e) {
        refused = (e as Error).message;
        throw e;
      }
    });
    if (ok) setDone(notes.length ? notes.join('; ') : `${label}: done`);
    else setProblem(refused ?? 'That change could not be made');
  };
  /** An ability given to, or taken from, one character: its component on that object (abilities are the character's own). */
  const toggleAbility = (pl: PlayerFacts, id: string, has: boolean) => {
    const component = modules.get<AbilityModule>('ability', id)!.component;
    setProblem(null);
    setDone(null);
    const label = `${pl.name}: ${has ? 'no ' : ''}${id}`;
    let refused: string | null = null;
    const ok = useEditor.getState().edit(`Game profile: ${label}`, (p) => {
      try {
        if (has) m.removeDefinitionComponent(p, pl.id, component);
        else m.addDefinitionComponent(p, pl.id, component, componentRegistry);
      } catch (e) {
        refused = (e as Error).message;
        throw e;
      }
    });
    if (ok) setDone(`${label}: done`);
    else setProblem(refused ?? 'That change could not be made');
  };
  const valueOf = (key: (typeof SYSTEMS)[number]['key']) => (key === 'movement' ? profile.movement.model : key === 'generator' ? (profile.generator.id ?? '') : profile[key]);
  const describe = (kind: ModuleKind, id: string) => modules.get(kind, id)?.describe ?? '';
  return (
    <div className="dialog-backdrop" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <section className="dialog profile-dialog" role="dialog" aria-label="Game profile" data-testid="profile-dialog">
        <header className="bg-head">
          <span>Game profile</span>
          <button className="icon-btn" aria-label="Close" data-testid="profile-close" onClick={close}>
            <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
              <path d="m3.5 3.5 7 7m0-7-7 7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </header>
        <p className="muted small">
          What the game is made of: how it is seen, how the player moves, what builds its levels. {profile.preset ? `Started as: ${PRESETS.find((p) => p.id === profile.preset)?.name ?? profile.preset}.` : 'Put together by hand.'}
          {!stored && ' (Worked out from the game: nothing is saved until you change something.)'}
        </p>
        <div className="profile-grid">
          {SYSTEMS.map((s) => (
            <label key={s.key} className="profile-row" data-testid={`profile-${s.key}`}>
              <span className="profile-label">{s.label}</span>
              <select
                value={valueOf(s.key)}
                onChange={(e) => {
                  const v = e.target.value;
                  change(s.key === 'generator' ? { generator: v || null } : { [s.key]: v }, `${s.label} ${v || 'none'}`);
                }}
              >
                {s.key === 'generator' && <option value="">none (levels made by hand or by the AI)</option>}
                {choices[s.key === 'movement' ? 'movement' : s.key].map((id) => (
                  <option key={id} value={id}>
                    {id}
                  </option>
                ))}
              </select>
              <span className="muted small profile-describe">{describe(s.kind, valueOf(s.key))}</span>
            </label>
          ))}
          {profile.generator.id === 'sections' && (
            <label className="profile-row" data-testid="profile-genre">
              <span className="profile-label">Kind of level</span>
              <select value={typeof profile.generator.settings.genre === 'string' ? profile.generator.settings.genre : ''} onChange={(e) => change({ genre: e.target.value || null }, `kind ${e.target.value || 'worked out'}`)}>
                <option value="">worked out from the game</option>
                {GENRES.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <div className="profile-row" data-testid="profile-abilities">
            <span className="profile-label">Players</span>
            <span className="profile-players">
              {facts.players.length === 0 && (
                <span className="muted small" data-testid="profile-no-players">
                  Movement is not in use: no object is player-controlled.
                </span>
              )}
              {facts.players.map((pl, i) => (
                <span key={pl.id} className="profile-player" data-testid={`profile-player-${i}`}>
                  <span className="profile-player-name">
                    {pl.level ? `${pl.name} (in ${pl.level})` : pl.name}: {pl.model ?? `no movement model "${pl.movement}"`}
                  </span>
                  {pl.level !== null ? (
                    <span className="muted small">{pl.abilities.map((a) => (a.works ? a.id : `${a.id} (does nothing)`)).join(', ') || 'no abilities'} · a placed copy with its own settings: change it in the level</span>
                  ) : (
                    <span className="profile-kits">
                      {choices.abilities.map((id) => {
                        const has = pl.abilities.find((a) => a.id === id);
                        const fit = abilityOn(id, pl.model);
                        return (
                          <label key={id} className="profile-check" title={has && !has.works ? `Needs ${has.needs} movement: on ${pl.name} it does nothing` : !has && !fit.works ? `Needs ${fit.needs ?? 'a movement model'} movement` : describe('ability', id)}>
                            <input
                              type="checkbox"
                              // (The first character's boxes keep the plain name; the others add which character.)
                              data-testid={i === 0 ? `profile-ability-${id}` : `profile-ability-${id}-${i}`}
                              checked={!!has}
                              disabled={!has && !fit.works}
                              onChange={() => toggleAbility(pl, id, !!has)}
                            />
                            {id.replace(/_/g, ' ')}
                            {has && !has.works ? ' (does nothing)' : ''}
                          </label>
                        );
                      })}
                    </span>
                  )}
                </span>
              ))}
            </span>
          </div>
          <div className="profile-row" data-testid="profile-turns">
            <span className="profile-label">Turns</span>
            <span className="profile-kits">
              {choices.turns.map((id) => {
                const on = (profile.turns ?? []).includes(id);
                return (
                  <label key={id} className="profile-check" title={describe('turns', id)}>
                    <input
                      type="checkbox"
                      data-testid={`profile-turns-${id}`}
                      checked={on}
                      onChange={() => change({ turns: choices.turns.filter((t) => (t === id ? !on : (profile.turns ?? []).includes(t))) }, `${on ? 'no ' : ''}${id.replace(/_/g, ' ')}`)}
                    />
                    {id.replace(/_/g, ' ')}
                  </label>
                );
              })}
            </span>
          </div>
          <div className="profile-row" data-testid="profile-random">
            <span className="profile-label">Random levels</span>
            <span className="profile-kits">
              {modules
                .list<GeneratorModule>('generator')
                .filter((g) => g.when === 'play')
                .map((g) => {
                  // (Selected as the level builder itself, or beside it.)
                  const main = profile.generator.id === g.id;
                  const on = main || (profile.generator.also ?? []).includes(g.id);
                  const also = (profile.generator.also ?? []).filter((x) => x !== g.id);
                  return (
                    <label key={g.id} className="profile-check" title={`${g.describe}. Off: ${g.without}`}>
                      <input
                        type="checkbox"
                        data-testid={`profile-random-${g.id}`}
                        checked={on}
                        onChange={() => change(on ? (main ? { generator: null } : { alsoGenerators: also }) : { alsoGenerators: [...also, g.id] }, `random levels ${on ? 'without' : 'with'} ${g.id}`)}
                      />
                      {g.id}
                    </label>
                  );
                })}
            </span>
          </div>
          <div className="profile-row" data-testid="profile-camera">
            <span className="profile-label">Camera</span>
            <span className="profile-kits">
              {choices.camera.map((id) => {
                const on = profile.camera.includes(id);
                return (
                  <label key={id} className="profile-check" title={describe('camera', id)}>
                    <input
                      type="checkbox"
                      data-testid={`profile-camera-${id}`}
                      checked={on}
                      // (Kept in the behaviours' own order: follow, then looking ahead, then rooms.)
                      onChange={() => change({ camera: choices.camera.filter((c) => (c === id ? !on : profile.camera.includes(c))) }, `camera ${on ? 'without' : 'with'} ${id.replace(/_/g, ' ')}`)}
                    />
                    {id.replace(/_/g, ' ')}
                  </label>
                );
              })}
            </span>
          </div>
          <label className="profile-row" data-testid="profile-theme">
            <span className="profile-label">Look</span>
            <select value={profile.theme ?? ''} onChange={(e) => change({ theme: e.target.value || null }, `look ${e.target.value || 'not chosen'}`)}>
              <option value="">not chosen</option>
              {THEMES.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </label>
          <div className="profile-row" data-testid="profile-kits">
            <span className="profile-label">Objects from</span>
            <span className="profile-kits">
              {profile.kits.map((k) => (
                <span key={k} className="chip">
                  {k}
                </span>
              ))}
              <select value="" data-testid="profile-add-kit" onChange={(e) => e.target.value && change({ addKits: [e.target.value] }, `add the ${e.target.value} objects`)}>
                <option value="">+ add objects from…</option>
                {choices.kits
                  .filter((k) => !profile.kits.includes(k))
                  .map((k) => (
                    <option key={k} value={k}>
                      {k}
                    </option>
                  ))}
              </select>
            </span>
          </div>
          <div className="profile-row muted small" data-testid="profile-rest">
            <span className="profile-label">Also</span>
            <span>
              geometry {profile.geometry.join(', ')} · camera {profile.camera.join(', ')} · progression {profile.progression.model}
            </span>
          </div>
        </div>
        <div className="profile-row" data-testid="profile-preset">
          <span className="profile-label">Preset</span>
          <select value="" onChange={(e) => e.target.value && change({ preset: e.target.value }, `preset ${e.target.value}`)}>
            <option value="">Set everything from a preset…</option>
            {PRESETS.map((p) => (
              <option key={p.id} value={p.id} title={p.describe}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
        <p className={`small profile-state ${check.state}`} data-testid="profile-state">
          {check.state === 'ok' ? 'These systems go together.' : check.state === 'degraded' ? `Works, with: ${check.notes.join('; ')}` : `Doesn't go together: ${check.reasons.join('; ')}`}
        </p>
        {problem && (
          <p className="small profile-problem" data-testid="profile-problem">
            {problem}
          </p>
        )}
        {done && (
          <p className="small muted" data-testid="profile-done">
            {done}
          </p>
        )}
      </section>
    </div>
  );
}
