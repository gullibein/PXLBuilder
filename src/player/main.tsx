/**
 * The standalone game player: an exported game's page. The game travels inside
 * the page (a JSON script element, the same bundle the editor saves); this
 * loads it and plays it full screen, from its first level, with the same
 * runtime and play screen as the editor's Play, and nothing else on the page. Nothing else is needed: no
 * server, no editor, no internet.
 */
import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { componentRegistry } from '../core/components/builtin';
import { gameFromText, projectFromBundle } from '../core/serialization/serialize';
import type { Project } from '../core/types';
import { audio } from '../editor/audio/synth';
import { PlayView } from '../editor/play/PlayView';
import '../editor/editor.css';
import './player.css';

function loadGame(): { project: Project } | { error: string } | null {
  const el = document.getElementById('pxl-game');
  if (!el?.textContent) return null;
  try {
    return { project: projectFromBundle(JSON.parse(el.textContent), componentRegistry).project };
  } catch (e) {
    return { error: `The game in this page couldn't be read: ${(e as Error).message}` };
  }
}

/** The game inside this page (an exported game), or none (the game player, which games are dropped onto). */
const embedded = !!document.getElementById('pxl-game')?.textContent;

/** On-screen buttons on phones: chosen when the game was exported; the empty player always has them. */
const touchControls = (() => {
  const el = document.getElementById('pxl-game');
  return !el?.textContent || el.dataset.touch === '1';
})();

// Browsers only let a page make sound after the first key or tap: the game's sounds start then.
const unlockSound = () => {
  audio();
  window.removeEventListener('pointerdown', unlockSound);
  window.removeEventListener('keydown', unlockSound);
};
window.addEventListener('pointerdown', unlockSound);
window.addEventListener('keydown', unlockSound);

function Player() {
  const [game, setGame] = useState(loadGame);
  // Each game dropped in starts afresh (a new play screen).
  const [run, setRun] = useState(0);
  const [dragging, setDragging] = useState(false);

  // The game player (no game inside): a saved game (.pxlproj.json) or an exported game page (.html) dropped
  // anywhere on the page plays. An exported game is only its game.
  useEffect(() => {
    if (embedded) return;
    const over = (e: DragEvent) => {
      if (!e.dataTransfer?.types.includes('Files')) return;
      e.preventDefault();
      setDragging(true);
    };
    const leave = (e: DragEvent) => {
      if (!e.relatedTarget) setDragging(false);
    };
    const drop = async (e: DragEvent) => {
      const file = e.dataTransfer?.files?.[0];
      if (!file) return;
      e.preventDefault();
      setDragging(false);
      try {
        const { project } = gameFromText(await file.text(), componentRegistry);
        setGame({ project });
        setRun((n) => n + 1);
        document.title = project.name;
      } catch (err) {
        setGame({ error: `${file.name} isn't a game this player can run: ${(err as Error).message}` });
      }
    };
    window.addEventListener('dragover', over);
    window.addEventListener('dragleave', leave);
    window.addEventListener('drop', drop);
    return () => {
      window.removeEventListener('dragover', over);
      window.removeEventListener('dragleave', leave);
      window.removeEventListener('drop', drop);
    };
  }, []);

  const dropHint = dragging && <div className="player-drop">Drop the game here to play it</div>;
  if (!game || 'error' in game) {
    return (
      <div className="player-note" data-testid="player-empty">
        {game?.error ?? 'Drop a game here to play it: a game saved from PXLBuilder (.pxlproj.json), or one exported as a web page (.html).'}
        {dropHint}
      </div>
    );
  }
  const { project } = game;
  return (
    <>
      <PlayView key={run} project={project} startSceneId={project.startSceneId} playPixels={() => 0} keyHints={false} touchControls={touchControls} />
      {dropHint}
    </>
  );
}

document.title = (() => {
  const g = loadGame();
  return g && 'project' in g ? g.project.name : 'PXLBuilder game player';
})();
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Player />
  </StrictMode>,
);
