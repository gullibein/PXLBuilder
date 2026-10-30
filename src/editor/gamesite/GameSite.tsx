import { useEffect, useState } from 'react';
import { usesMenuKey } from '../../core/script/language';
import { componentRegistry } from '../../core/components/builtin';
import { gameFromText } from '../../core/serialization/serialize';
import type { Project } from '../../core/types';
import { dropUnusedChoice, gameFileText, openGameText, sizeText } from '../persistence';
import { PlayView } from '../play/PlayView';
import { useEditor } from '../store';
import { gameShot } from './gameShot';
import { gameSiteAvailable, listSiteGames, myId, ownerNames, publishGame, removeSiteGame, siteGameShot, siteGameText, type SiteGame } from './gameSite';

const CloseIcon = () => (
  <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
    <path d="m3.5 3.5 7 7m0-7-7 7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
  </svg>
);

/** PXLGameSite: put this game up, or browse and play everyone's. */
export function GameSite() {
  const which = useEditor((s) => s.gameSite);
  const [available, setAvailable] = useState<boolean | null>(null);
  useEffect(() => {
    if (which) void gameSiteAvailable().then(setAvailable);
  }, [which]);
  if (!which) return null;
  const close = () => useEditor.getState().setGameSite(null);
  if (available === false) {
    return (
      <div className="dialog-backdrop" onMouseDown={(e) => e.target === e.currentTarget && close()}>
        <section className="dialog" role="dialog" aria-label="PXLGameSite" data-testid="gamesite-unavailable" onKeyDown={(e) => e.key === 'Escape' && close()}>
          <header className="bg-head">
            <span>PXLGameSite</span>
            <button className="icon-btn" aria-label="Close" onClick={close}>
              <CloseIcon />
            </button>
          </header>
          <p className="dialog-text">PXLGameSite is in the published PXLBuilder app on claude.ai: the games are kept there, for everyone the app is shared with. Open PXLBuilder there (signed in) to put games up and play other people's.</p>
          <footer className="se-footer">
            <span className="grow" />
            <button className="chip-btn" autoFocus onClick={close}>
              Close
            </button>
          </footer>
        </section>
      </div>
    );
  }
  if (available === null) return null;
  return which === 'save' ? <SaveToSite close={close} /> : <Browse close={close} />;
}

function SaveToSite({ close }: { close: () => void }) {
  const project = useEditor((s) => s.project);
  const [name, setName] = useState(project.name);
  const [shot, setShot] = useState<string | null>(null);
  const [state, setState] = useState<'idle' | 'saving' | 'done'>('idle');
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    void gameShot(project).then(setShot);
  }, [project]);
  const save = async () => {
    setState('saving');
    setError(null);
    const r = await publishGame(project.id, name.trim(), gameFileText(dropUnusedChoice()), shot);
    if (r.ok) {
      setState('done');
      useEditor.getState().logMessage('info', `"${name.trim()}" is on PXLGameSite: everyone the app is shared with can play it.`);
    } else {
      setState('idle');
      setError(r.error);
    }
  };
  return (
    <div className="dialog-backdrop" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <section className="dialog gamesite-save" role="dialog" aria-label="Save to PXLGameSite" data-testid="gamesite-save" onKeyDown={(e) => e.key === 'Escape' && close()}>
        <header className="bg-head">
          <span>Save to PXLGameSite</span>
          <button className="icon-btn" aria-label="Close" onClick={close}>
            <CloseIcon />
          </button>
        </header>
        <figure className="gs-card big">
          {shot ? <img className="gs-shot" src={shot} alt="" data-testid="gamesite-save-shot" /> : <div className="gs-shot empty">Taking the picture…</div>}
          <figcaption>
            <input className="gs-name-input" value={name} maxLength={80} aria-label="The game's name" data-testid="gamesite-save-name" onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && state === 'idle' && name.trim() && void save()} />
          </figcaption>
        </figure>
        <p className="muted small">The picture is the start of the first level, as it plays. Everyone the app is shared with can play the game and open a copy of it. Saving it again replaces it.</p>
        {error && <p className="dialog-text warn">Could not put it up ({error}).</p>}
        {state === 'done' && (
          <p className="dialog-text" data-testid="gamesite-save-done">
            It is on PXLGameSite.
          </p>
        )}
        <footer className="se-footer">
          {state === 'done' ? (
            <button className="chip-btn" onClick={() => useEditor.getState().setGameSite('view')}>
              View PXLGameSite
            </button>
          ) : null}
          <span className="grow" />
          <button className="chip-btn" onClick={close}>
            {state === 'done' ? 'Close' : 'Cancel'}
          </button>
          {state !== 'done' && (
            <button className="btn-primary" disabled={state === 'saving' || !name.trim() || !shot} data-testid="gamesite-save-confirm" onClick={() => void save()}>
              {state === 'saving' ? 'Saving…' : 'Save to PXLGameSite'}
            </button>
          )}
        </footer>
      </section>
    </div>
  );
}

function Browse({ close }: { close: () => void }) {
  const [games, setGames] = useState<SiteGame[] | null>(null);
  const [shots, setShots] = useState<Record<string, string | null>>({});
  const [names, setNames] = useState<Record<string, string>>({});
  const [me, setMe] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [playing, setPlaying] = useState<{ game: SiteGame; project: Project } | null>(null);
  const [confirm, setConfirm] = useState<string | null>(null);
  const key = (g: SiteGame) => `${g.owner}/${g.gameId}`;
  useEffect(() => {
    void myId().then(setMe);
    listSiteGames().then(
      async (list) => {
        setGames(list);
        void ownerNames([...new Set(list.map((g) => g.owner))]).then(setNames);
        for (const g of list) void siteGameShot(g).then((png) => setShots((s) => ({ ...s, [key(g)]: png })));
      },
      (e) => setError(String((e as { code?: string })?.code ?? (e as Error)?.message ?? e)),
    );
  }, []);
  const load = async (g: SiteGame) => gameFromText(await siteGameText(g), componentRegistry).project;
  const play = async (g: SiteGame) => {
    try {
      setPlaying({ game: g, project: await load(g) });
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const openCopy = async (g: SiteGame) => {
    try {
      const text = await siteGameText(g);
      close();
      openGameText(text, `PXLGameSite (${g.name})`);
    } catch (e) {
      setError((e as Error).message);
    }
  };
  if (playing) {
    const stop = () => setPlaying(null);
    // A game with a menu of its own (a pause menu) gets Escape; Back to PXLGameSite leaves it.
    const ownMenu = usesMenuKey(playing.project);
    return (
      <div className="gamesite-play" data-testid="gamesite-play" onKeyDown={(e) => e.key === 'Escape' && !ownMenu && stop()}>
        <header className="gamesite-play-bar">
          <span className="gs-title">{playing.game.name}</span>
          <span className="grow" />
          <button className="chip-btn" data-testid="gamesite-play-copy" onClick={() => void openCopy(playing.game)}>
            Open a copy in the editor
          </button>
          <button className="chip-btn" data-testid="gamesite-play-close" onClick={stop}>
            Back to PXLGameSite
          </button>
        </header>
        <div className="gamesite-play-stage">
          <PlayView project={playing.project} startSceneId={playing.project.scenes[0]?.id ?? ''} playPixels={() => useEditor.getState().layout.playPixels} stopHint={ownMenu ? undefined : 'Esc goes back'} touchControls />
        </div>
      </div>
    );
  }
  return (
    <div className="dialog-backdrop" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <section className="dialog gamesite" role="dialog" aria-label="PXLGameSite" data-testid="gamesite" onKeyDown={(e) => e.key === 'Escape' && close()}>
        <header className="bg-head">
          <span>PXLGameSite</span>
          <button className="icon-btn" aria-label="Close" onClick={close} autoFocus>
            <CloseIcon />
          </button>
        </header>
        {error && <p className="dialog-text warn">Something went wrong ({error}).</p>}
        {!games && !error && <p className="muted small">Loading the games…</p>}
        {games && games.length === 0 && (
          <p className="muted small" data-testid="gamesite-empty">
            No games yet. Put yours up with Save to PXLGameSite (in the game's menu).
          </p>
        )}
        {games && games.length > 0 && (
          <ul className="gs-grid" data-testid="gamesite-grid">
            {games.map((g) => {
              const shot = shots[key(g)];
              const mine = g.owner === me;
              return (
                <li key={key(g)} className="gs-card" data-testid="gamesite-game">
                  <button className="gs-pick" title={`Play ${g.name}`} onClick={() => void play(g)} data-testid="gamesite-game-play">
                    {shot ? <img className="gs-shot" src={shot} alt="" /> : <div className="gs-shot empty" />}
                  </button>
                  <div className="gs-caption">
                    <span className="gs-name" data-testid="gamesite-game-name">
                      {g.name}
                    </span>
                    <span className="muted small">
                      {mine ? 'yours' : names[g.owner] || 'someone'} · {new Date(g.savedAt).toLocaleDateString()} · {sizeText(g.bytes)}
                    </span>
                  </div>
                  <div className="gs-actions">
                    <button className="chip-btn" onClick={() => void play(g)}>
                      Play
                    </button>
                    <button className="chip-btn" onClick={() => void openCopy(g)} data-testid="gamesite-game-copy">
                      Open a copy
                    </button>
                    {mine &&
                      (confirm === key(g) ? (
                        <button
                          className="chip-btn danger"
                          data-testid="gamesite-game-remove-confirm"
                          onClick={async () => {
                            await removeSiteGame(g).catch(() => undefined);
                            setGames((list) => list?.filter((x) => key(x) !== key(g)) ?? null);
                          }}
                        >
                          Take it off
                        </button>
                      ) : (
                        <button className="chip-btn" data-testid="gamesite-game-remove" onClick={() => setConfirm(key(g))}>
                          Remove
                        </button>
                      ))}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
