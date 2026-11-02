import { useEffect, useRef, useState } from 'react';
import { componentRegistry } from '../../core/components/builtin';
import { generateDungeon, newSeed } from '../../core/model/dungeon';
import { keepDungeon, setGenerator } from '../../core/model/mutations';
import type { DungeonGenerator, DungeonSpawn, Project, Scene } from '../../core/types';
import { NumberInput } from '../panels/FieldEditor';
import { getActiveScene, useEditor } from '../store';

/**
 * A random level's recipe (Tool panel → Random level): its size, rooms and corridors, the parts it is built of,
 * the monsters and treasure it places (how often, from which floor). The level shows one example (its seed),
 * faint; Reroll shows another, and six side by side show how much they differ. Keep turns the example into
 * ordinary objects. Every change is one Undo step; the AI changes the same with set_generator.
 */
export function DungeonPanel() {
  const open = useEditor((s) => s.dungeonOpen);
  const scene = useEditor(getActiveScene);
  const project = useEditor((s) => s.project);
  const [many, setMany] = useState(false);
  if (!open) return null;
  const { edit, setDungeonOpen } = useEditor.getState();
  const g = scene.generator;
  const set = (label: string, patch: Partial<Record<keyof DungeonGenerator, unknown>> | null, key?: string) =>
    edit(label, (p) => setGenerator(p, scene.id, patch as Record<string, unknown> | null), key ? { coalesceKey: `${scene.id}.generator.${key}` } : undefined);
  const example = g ? generateDungeon(project, scene, componentRegistry, g.preview, g.previewFloor) : null;
  const objects = [...project.definitions].sort((a, b) => a.name.localeCompare(b.name));
  const pickObject = (value: string | null, onPick: (id: string | null) => void, testId: string, none = true) => (
    <select value={value ?? ''} data-testid={testId} onChange={(e) => onPick(e.target.value || null)}>
      {none && <option value="">(none)</option>}
      {objects.map((d) => (
        <option key={d.id} value={d.id}>
          {d.name}
        </option>
      ))}
    </select>
  );
  const spawnList = (what: 'monsters' | 'loot', list: DungeonSpawn[]) => {
    const put = (next: DungeonSpawn[]) => set(`Random level: ${what}`, { [what]: next });
    return (
      <div className="dg-spawns" data-testid={`dungeon-${what}`}>
        {list.map((s, n) => (
          <div key={n} className="dg-spawn">
            {pickObject(s.object, (id) => id && put(list.map((x, k) => (k === n ? { ...x, object: id } : x))), `dungeon-${what}-object`, false)}
            <label title="How often, compared with the others (2 = twice as often)">
              ×<NumberInput value={s.weight} step={1} onCommit={(v) => put(list.map((x, k) => (k === n ? { ...x, weight: v } : x)))} />
            </label>
            <label title="From which floor down it appears">
              from floor <NumberInput value={s.fromFloor} step={1} onCommit={(v) => put(list.map((x, k) => (k === n ? { ...x, fromFloor: v } : x)))} />
            </label>
            <button className="icon-btn" aria-label="Remove" onClick={() => put(list.filter((_, k) => k !== n))}>
              ×
            </button>
          </div>
        ))}
        <button className="text-btn" data-testid={`dungeon-${what}-add`} onClick={() => objects[0] && put([...list, { object: objects[0].id, weight: 1, fromFloor: 1 }])}>
          + Add
        </button>
      </div>
    );
  };
  const num = (label: string, key: keyof DungeonGenerator, step = 1) => (
    <label className="dg-num">
      <span>{label}</span>
      <NumberInput value={g![key] as number} step={step} testId={`dungeon-${key}`} onCommit={(v) => set(`Random level: ${label.toLowerCase()}`, { [key]: v }, key)} />
    </label>
  );

  return (
    <section className="background-panel dungeon-panel" data-testid="dungeon-panel" data-movable="dungeon-panel" aria-label="Random level">
      <header className="bg-head">
        <span>
          Random level <span className="muted">· {scene.name}</span>
        </span>
        <button className="icon-btn" aria-label="Close" data-testid="dungeon-close" onClick={() => setDungeonOpen(false)}>
          <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
            <path d="m3.5 3.5 7 7m0-7-7 7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </button>
      </header>
      {!g ? (
        <div className="dg-body">
          <p className="muted small">A random level is built anew every time it is played: rooms joined by corridors, walls round them, the player in the first room, the way down in the farthest, monsters and treasure picked for the floor. What you place by hand stays where it is.</p>
          <button
            className="btn-primary"
            data-testid="dungeon-make"
            onClick={() => {
              set('Make the level random', {});
              // The view on the dungeon (its top left square is the level's 0, 0), all of it in sight.
              const made = useEditor.getState().project.scenes.find((x) => x.id === scene.id)?.generator;
              if (made) useEditor.getState().setCamera({ x: (made.width * 32) / 2, y: (made.height * 32) / 2, zoom: Math.min(1, Math.max(0.3, (window.innerHeight - 120) / (made.height * 32))) });
            }}
          >
            Make this level random
          </button>
        </div>
      ) : (
        <div className="dg-body">
          <div className="dg-row">
            <span className="small">
              Example <span className="muted">(faint on the level)</span>: seed
            </span>
            <NumberInput value={g.preview} step={1} testId="dungeon-preview" onCommit={(v) => set('Random level: example', { preview: v })} />
            <span className="small">floor</span>
            <NumberInput value={g.previewFloor} step={1} testId="dungeon-preview-floor" onCommit={(v) => set('Random level: example floor', { previewFloor: v })} />
            <button className="btn-primary" data-testid="dungeon-reroll" onClick={() => set('Random level: another example', { preview: newSeed() })}>
              Reroll
            </button>
            <button className={`chip-btn${many ? ' on' : ''}`} data-testid="dungeon-many" onClick={() => setMany(!many)}>
              Show 6
            </button>
          </div>
          {many && <Thumbnails project={project} scene={scene} onPick={(seed) => set('Random level: example', { preview: seed })} />}
          {example && (
            <p className={`small${example.problems.length ? ' dg-problem' : ' muted'}`} data-testid="dungeon-report">
              {example.problems.length ? `⚠ ${example.problems.join('; ')}` : `${example.rooms} rooms, ${example.entities.length} things placed.`}
            </p>
          )}
          <div className="dg-grid">
            {num('Width', 'width')}
            {num('Height', 'height')}
            {num('Rooms', 'rooms')}
            {num('Room min', 'roomMin')}
            {num('Room max', 'roomMax')}
            {num('Corridor', 'corridor')}
            {num('Loops (0-1)', 'loops', 0.1)}
          </div>
          <div className="dg-parts">
            <label>Wall {pickObject(g.wall, (id) => set('Random level: wall', { wall: id }), 'dungeon-wall')}</label>
            <label>Floor {pickObject(g.floor, (id) => set('Random level: floor', { floor: id }), 'dungeon-floor')}</label>
            <label>Way down {pickObject(g.stairs, (id) => set('Random level: way down', { stairs: id }), 'dungeon-stairs')}</label>
          </div>
          <h4 className="dg-h">Monsters</h4>
          <div className="dg-grid">
            {num('First floor', 'monsterCount')}
            {num('More a floor', 'monstersPerFloor')}
          </div>
          {spawnList('monsters', g.monsters)}
          <h4 className="dg-h">Treasure</h4>
          <div className="dg-grid">
            {num('First floor', 'lootCount')}
            {num('More a floor', 'lootPerFloor')}
          </div>
          {spawnList('loot', g.loot)}
          <label className="dialog-check small">
            <input type="checkbox" checked={g.seed === null} data-testid="dungeon-new-each" onChange={(e) => set('Random level: play seed', { seed: e.target.checked ? null : g.preview })} />A new dungeon every play (off: always the example's, to test it)
          </label>
          <div className="dg-foot">
            <button className="text-btn" data-testid="dungeon-keep" title="The example becomes ordinary objects you can edit; the level is no longer random" onClick={() => edit('Keep this dungeon', (p) => keepDungeon(p, scene.id, componentRegistry))}>
              Keep this layout
            </button>
            <button className="text-btn" data-testid="dungeon-off" onClick={() => set('Ordinary level', null)}>
              Make it an ordinary level
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

/** Six examples side by side (small maps: walls, floor, start, way down, monsters, treasure); a click shows it. */
function Thumbnails({ project, scene, onPick }: { project: Project; scene: Scene; onPick: (seed: number) => void }) {
  const [seeds] = useState(() => Array.from({ length: 6 }, () => newSeed()));
  return (
    <div className="dg-thumbs" data-testid="dungeon-thumbs">
      {seeds.map((seed) => (
        <Thumb key={seed} project={project} scene={scene} seed={seed} onPick={() => onPick(seed)} />
      ))}
    </div>
  );
}

function Thumb({ project, scene, seed, onPick }: { project: Project; scene: Scene; seed: number; onPick: () => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const g = scene.generator!;
  const d = generateDungeon(project, scene, componentRegistry, seed, g.previewFloor);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const px = 3;
    c.width = g.width * px;
    c.height = g.height * px;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = '#2b2f3a';
    ctx.fillRect(0, 0, c.width, c.height);
    const color = (id: string) => (id === g.wall ? '#8a90a6' : id === g.stairs ? '#ffd166' : g.monsters.some((s) => s.object === id) ? '#ff5a5a' : g.loot.some((s) => s.object === id) ? '#f5c542' : id === g.floor ? '#4a5060' : '#cfd6ff');
    for (const e of d.entities) {
      ctx.fillStyle = color(e.definitionId ?? '');
      ctx.fillRect(Math.floor(e.transform.position.x / 32) * px, Math.floor(e.transform.position.y / 32) * px, px, px);
    }
    if (d.start) {
      ctx.fillStyle = '#5fe08a';
      ctx.fillRect(Math.floor(d.start.x / 32) * px - 1, Math.floor(d.start.y / 32) * px - 1, px + 2, px + 2);
    }
  });
  return (
    <button className="dg-thumb" title={`Seed ${seed}${d.problems.length ? `: ${d.problems.join('; ')}` : ''}`} onClick={onPick}>
      <canvas ref={ref} />
      <span className="small">
        {d.problems.length ? '⚠ ' : ''}
        {seed}
      </span>
    </button>
  );
}
