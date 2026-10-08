import { useMemo } from 'react';
import { createStarterAssets } from '../../core/model/factory';
import { createTopDownStarterAssets } from '../../core/model/topDownStarters';
import type { GameType } from '../../core/types';
import { startNewGame } from '../persistence';
import { useEditor } from '../store';

/**
 * "What kind of game?": shown on the first visit (no saved game yet) and by
 * ⋯ → New project. One click makes a new game of that kind (its starter
 * objects, gravity or none) and drops the user into the editor. It only
 * chooses the start: the game can still be changed into anything later.
 */
export function GameChooser() {
  const mode = useEditor((s) => s.gameChooser);
  const close = useEditor((s) => s.setGameChooser);
  if (!mode) return null;
  const pick = (type: GameType) => {
    startNewGame(type, mode === 'first');
    close(null);
  };
  return (
    <div className="dialog-backdrop" onMouseDown={(e) => e.target === e.currentTarget && close(null)}>
      <section className="dialog game-dialog" role="dialog" aria-label="What kind of game?" data-testid="game-chooser">
        <header className="bg-head">
          <span>{mode === 'first' ? 'What kind of game do you want to make?' : 'New game: what kind?'}</span>
          <button className="icon-btn" aria-label="Close" data-testid="game-chooser-close" onClick={() => close(null)}>
            <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
              <path d="m3.5 3.5 7 7m0-7-7 7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </header>
        <div className="game-grid">
          <button className="style-card game-card" data-testid="game-platformer" onClick={() => pick('platformer')}>
            <PlatformerPreview />
            <span className="style-name">Platformer</span>
            <span className="style-blurb">Seen from the side, with gravity: run, jump and climb (like Mario).</span>
          </button>
          <button className="style-card game-card" data-testid="game-topdown" onClick={() => pick('topdown')}>
            <TopDownPreview />
            <span className="style-name">Top-down</span>
            <span className="style-blurb">Seen from above: walk in every direction through rooms and corridors (like Zelda or Rogue).</span>
          </button>
        </div>
        <p className="muted small">
          This picks the starting objects; nothing is locked. Mix freely later, or ask the AI to turn it into the other kind.
          {mode === 'new' && ' Undo brings back the game you have now.'}
        </p>
      </section>
    </div>
  );
}

/** A tiny scene drawn with the real starter pictures (16 px a tile). */
function Tiles({ items, background }: { items: { src?: string; color?: string; x: number; y: number; w?: number; h?: number }[]; background: string }) {
  return (
    <span className="game-preview" aria-hidden="true" style={{ background }}>
      {items.map((t, i) =>
        t.src ? (
          <img key={i} src={t.src} alt="" style={{ left: t.x * 16, top: t.y * 16, width: (t.w ?? 1) * 16, height: (t.h ?? 1) * 16 }} />
        ) : (
          <span key={i} style={{ left: t.x * 16, top: t.y * 16, width: (t.w ?? 1) * 16, height: (t.h ?? 1) * 16, background: t.color }} />
        ),
      )}
    </span>
  );
}

function PlatformerPreview() {
  const a = useMemo(() => createStarterAssets(), []);
  return (
    <Tiles
      background="#1d2330"
      items={[
        { color: '#5fa83f', x: 0, y: 5, w: 6 },
        { color: '#5fa83f', x: 8, y: 3, w: 4 },
        { color: '#5fa83f', x: 13, y: 5, w: 3 },
        { src: a.player.data, x: 2, y: 4 },
        { src: a.enemy.data, x: 9, y: 2 },
        { src: a.hazard.data, x: 6, y: 5.5, w: 2, h: 0.5 },
        { src: a.goal.data, x: 14, y: 4 },
        { src: a.ladder.data, x: 7, y: 3 },
        { src: a.ladder.data, x: 7, y: 4 },
      ]}
    />
  );
}

function TopDownPreview() {
  const a = useMemo(() => createTopDownStarterAssets(), []);
  const items: { src?: string; x: number; y: number }[] = [];
  for (let x = 0; x < 16; x++) {
    for (let y = 0; y < 6; y++) items.push({ src: x === 0 || x === 15 || y === 0 || y === 5 || (x === 8 && y !== 3) ? a.wall.data : a.floor.data, x, y });
  }
  items.push({ src: a.door.data, x: 8, y: 3 }, { src: a.player.data, x: 3, y: 2 }, { src: a.enemy.data, x: 11, y: 3 }, { src: a.goal.data, x: 13, y: 1 }, { src: a.hazard.data, x: 5, y: 4 });
  return <Tiles background="#16131f" items={items} />;
}
