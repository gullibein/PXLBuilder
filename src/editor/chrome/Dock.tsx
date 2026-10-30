import { PlayButton } from './TopBar';
import { useCloseOutside } from '../prompt/closeOutside';
import { NoteIcon } from './NoteIcon';
import { openNewSound } from '../sounds';
import { DeleteConfirm } from './SoundEditor';
import { deleteSelection } from '../actions';
import { JobDots } from './JobDots';
import { playSound } from '../audio/synth';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { componentRegistry } from '../../core/components/builtin';
import { createStarterAssets, createStarterDefinitions } from '../../core/model/factory';
import { countInstances, deleteObject, resetStarterDefinition, starterKeyOf } from '../../core/model/mutations';
import type { ObjectDefinition } from '../../core/types';
import { CATEGORIES, categoryOf } from '../categories';
import { PromptBox } from '../prompt/PromptBox';
import { SpriteImage } from '../SpriteImage';
import { getActiveScene, useEditor } from '../store';
import { DEFINITION_DRAG_TYPE } from '../viewport/Viewport';

/** The built-in objects (only their names are used, to tell which library objects can be reset). */
const STARTER_NAMES = createStarterDefinitions(componentRegistry, createStarterAssets());

/**
 * Bottom dock: Create (describe a new object) and Objects (the library).
 * Clicking an object picks it up as a brush to draw onto the level.
 */
export function Dock() {
  const dock = useEditor((s) => s.dock);
  const setDock = useEditor((s) => s.setDock);
  const playHere = useEditor((s) => s.layout.playButton === 'bottom');
  // The Objects and Sounds tabs close as soon as the top bar, the tool bar or the AI History / Console / Debug
  // buttons are used.
  useEffect(() => {
    if (dock !== 'library' && dock !== 'sounds') return;
    const away = (e: PointerEvent) => {
      if ((e.target as Element | null)?.closest?.('.topbar, .tool-panel, .tray-chips')) useEditor.getState().setDock(null);
    };
    window.addEventListener('pointerdown', away, true);
    return () => window.removeEventListener('pointerdown', away, true);
  }, [dock]);
  return (
    <div className="dock-wrap">
      {dock === 'create' && <CreatePanel />}
      {dock === 'library' && <ObjectsPanel />}
      {dock === 'sounds' && <SoundsPanel />}
      <nav className="dock" aria-label="Create and objects">
        <button className={`dock-btn primary job-anchor${dock === 'create' ? ' on' : ''}`} data-testid="dock-create" onClick={() => setDock(dock === 'create' ? null : 'create')}>
          <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
            <path d="M7 2v10M2 7h10" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
          Create
          <JobDots keys={['create']} open={dock === 'create'} />
        </button>
        <button className={`dock-btn${dock === 'library' ? ' on' : ''}`} title="Objects" aria-label="Objects" data-testid="dock-library" onClick={() => setDock(dock === 'library' ? null : 'library')}>
          <svg width="15" height="15" viewBox="0 0 16 16" aria-hidden="true">
            <path d="M8 1.8 13.5 5v6L8 14.2 2.5 11V5z M2.5 5 8 8.2 13.5 5 M8 8.2v6" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
          </svg>
          <span className="dock-label">Objects</span>
        </button>
        <button className={`dock-btn${dock === 'sounds' ? ' on' : ''}`} title="Sounds" aria-label="Sounds" data-testid="dock-sounds" onClick={() => setDock(dock === 'sounds' ? null : 'sounds')}>
          <NoteIcon />
          <span className="dock-label">Sounds</span>
        </button>
        <button className="dock-btn" title="Music: instruments and songs" aria-label="Music" data-testid="dock-music" onClick={() => (setDock(null), useEditor.getState().setMusicStudio({}))}>
          <svg width="15" height="15" viewBox="0 0 16 16" aria-hidden="true">
            <path d="M5.5 12.5V3.5l8-1.8v9M5.5 6.2l8-1.8" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
            <circle cx="3.8" cy="12.6" r="1.8" fill="currentColor" />
            <circle cx="11.8" cy="10.8" r="1.8" fill="currentColor" />
          </svg>
          <span className="dock-label">Music</span>
        </button>
        <TrashButton />
        {playHere && <PlayButton />}
      </nav>
    </div>
  );
}

function TrashIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M2.5 4h11M6 4V2.5h4V4M4 4l.7 9.5h6.6L12 4M6.6 6.5v5M9.4 6.5v5" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** The × at the top right of a tab's panel. */
function PanelClose() {
  return (
    <button className="icon-btn dock-panel-close" aria-label="Close" title="Close" data-testid="dock-panel-close" onClick={() => useEditor.getState().setDock(null)}>
      <svg width="12" height="12" viewBox="0 0 14 14" aria-hidden="true">
        <path d="m3.5 3.5 7 7m0-7-7 7" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      </svg>
    </button>
  );
}

/** A small preview of an object: its placeholder sprite, to scale within the tile. */
export function Thumb({ def, size = 34 }: { def: ObjectDefinition; size?: number }) {
  const sprite = def.components.Sprite ?? {};
  const asset = useEditor((s) => (typeof sprite.assetId === 'string' ? s.project.assets.find((a) => a.id === sprite.assetId) : undefined));
  if (asset) {
    return (
      <span className="thumb" aria-hidden="true">
        <SpriteImage asset={asset} frame={typeof sprite.frame === 'number' ? sprite.frame : 1} size={size} />
      </span>
    );
  }
  const w = typeof sprite.width === 'number' ? sprite.width : 32;
  const h = typeof sprite.height === 'number' ? sprite.height : 32;
  const k = size / Math.max(w, h, 1);
  const circle = def.components.Collider?.shape === 'circle';
  const color = typeof sprite.color === 'string' ? sprite.color : '#888';
  const tile = def.metadata.placement === 'tile';
  return (
    <span className="thumb" aria-hidden="true">
      <span
        style={{
          width: Math.max(4, w * k),
          height: Math.max(4, h * k),
          background: tile ? `linear-gradient(${color} 0 0) bottom / 100% 78% no-repeat, color-mix(in srgb, ${color}, white 35%)` : color,
          borderRadius: circle ? '50%' : 3,
        }}
      />
    </span>
  );
}

/** What an "Ask AI…" card from the Objects or Sounds tab is about, and the item it was asked from (on screen). */
type LibraryAsk = { kind: 'object' | 'sound'; id: string; rect: { left: number; top: number; width: number } };

function ObjectTile({ def, armOnClick = true, onAsk }: { def: ObjectDefinition; armOnClick?: boolean; onAsk?: (ask: LibraryAsk) => void }) {
  const tool = useEditor((s) => s.tool);
  const armed = tool.kind === 'brush' && tool.definitionId === def.id;
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [deleting, setDeleting] = useState(false);
  const { setTool, setDock, selectDefinition, setInspectorOpen, openSprites } = useEditor.getState();
  const isStarter = starterKeyOf(def, STARTER_NAMES) !== null;
  const menuAnchor = useRef<HTMLButtonElement>(null);
  return (
    <button
      ref={menuAnchor}
      className={`tile${armed ? ' armed' : ''}`}
      draggable
      aria-pressed={armed}
      data-testid={`definition-${def.name}`}
      data-definition={def.id}
      title={`${def.description || def.name}\nClick to draw it onto the level, or drag it in. Right-click for more.`}
      onClick={() => {
        if (!armOnClick) return;
        if (armed) setTool({ kind: 'select' });
        else {
          // Already drawing (the Draw tool): go on drawing with this. Else: place it once, then back to selecting.
          setTool({ kind: 'brush', definitionId: def.id, once: tool.kind !== 'brush' || tool.once === true });
          setDock(null);
          // Its small card (picture, Edit sprite, Autotile, Details…) shows at the top right.
          useEditor.getState().setPickedDefinition(def.id);
        }
      }}
      onDragStart={(e) => {
        e.dataTransfer.setData(DEFINITION_DRAG_TYPE, def.id);
        e.dataTransfer.effectAllowed = 'copy';
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        setMenu({ x: e.clientX, y: e.clientY });
      }}
    >
      <Thumb def={def} />
      <span className="tile-name">{def.name}</span>
      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
          items={[
            ...(onAsk
              ? [
                  {
                    label: 'Ask AI…',
                    testId: 'menu-ai-prompt',
                    run: () => onAsk({ kind: 'object', id: def.id, rect: tileRect(menuAnchor.current) }),
                  },
                ]
              : []),
            {
              label: 'Details…',
              testId: 'menu-inspector',
              run: () => {
                selectDefinition(def.id);
                setInspectorOpen(true);
                setDock(null);
              },
            },
            { label: 'Edit sprite', testId: 'menu-edit-sprite', run: () => editSpriteOf(def.id) },
            ...(canAutotile(def) ? [{ label: 'Autotile…', testId: 'menu-autotile', run: () => useEditor.getState().setAutotileEditor(def.id) }] : []),
            { label: 'Code', testId: 'menu-code', run: () => useEditor.getState().openCodeEditor({ definitionId: def.id, entityId: null }) },
            { label: 'Sprites', testId: 'menu-sprites', run: () => openSprites(def.id) },
            ...(isStarter
              ? [
                  {
                    label: 'Reset to default',
                    testId: 'menu-reset',
                    run: () => useEditor.getState().edit(`Reset ${def.name} to default`, (p) => resetStarterDefinition(p, def.id, componentRegistry)),
                  },
                ]
              : []),
            { label: 'Delete…', testId: 'menu-delete-object', run: () => setDeleting(true) },
          ]}
        />
      )}
      {deleting && <ObjectDeleteConfirm def={def} onDone={() => setDeleting(false)} />}
    </button>
  );
}

function tileRect(el: Element | null): LibraryAsk['rect'] {
  const r = el?.getBoundingClientRect();
  return r ? { left: r.left, top: r.top, width: r.width } : { left: window.innerWidth / 2, top: window.innerHeight / 2, width: 0 };
}

const ASK_WIDTH = 300;

/**
 * The AI prompt card for one library object or one sound (right-click → Ask AI…): "make this yellow", "lower in
 * pitch". It sits just above the item it was asked from; × or Esc closes it (a request still running carries on).
 */
function LibraryPrompt({ ask, onClose }: { ask: LibraryAsk; onClose: () => void }) {
  const sceneId = useEditor((s) => s.activeSceneId);
  const def = useEditor((s) => (ask.kind === 'object' ? s.project.definitions.find((d) => d.id === ask.id) : undefined));
  const sound = useEditor((s) => (ask.kind === 'sound' ? s.project.assets.find((a) => a.id === ask.id && a.kind === 'sound') : undefined));
  const ref = useRef<HTMLDivElement>(null);
  useCloseOutside(ref, onClose);
  if (!def && !sound) return null;
  const left = Math.max(12, Math.min(ask.rect.left + ask.rect.width / 2 - ASK_WIDTH / 2, window.innerWidth - ASK_WIDTH - 12));
  const bottom = Math.max(12, window.innerHeight - ask.rect.top + 8);
  const header = def ? (
    <span className="library-ask-head">
      <Thumb def={def} size={16} />
      {def.name}
    </span>
  ) : (
    <span className="library-ask-head">
      <NoteIcon />
      {sound!.name}
    </span>
  );
  return createPortal(
    <div className="library-ask" ref={ref} style={{ left, bottom, width: ASK_WIDTH }} data-testid="library-prompt" data-context={ask.kind}>
      <PromptBox
        key={`${ask.kind}:${ask.id}`}
        ctx={def ? { kind: 'object', sceneId, definitionId: def.id } : { kind: 'sound', sceneId, assetId: sound!.id }}
        header={header}
        autoFocus
        placeholder={def ? 'e.g. "make it yellow"' : 'e.g. "lower in pitch"'}
        onEscape={onClose}
        onClose={onClose}
        renderApplied={
          sound
            ? () => (
                <button className="chip-btn small" data-testid="library-prompt-play" onClick={() => sound.synth && playSound(sound.synth)}>
                  ▶ Play it
                </button>
              )
            : undefined
        }
      />
    </div>,
    document.body,
  );
}

/** A small menu at the pointer. Closes on outside click, Escape, or after choosing. */
export function ContextMenu(props: { x: number; y: number; items: { label: string; testId?: string; run: () => void }[]; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const close = (e: Event) => {
      if (!ref.current?.contains(e.target as Node)) props.onClose();
    };
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && props.onClose();
    window.addEventListener('pointerdown', close, true);
    window.addEventListener('keydown', esc);
    return () => {
      window.removeEventListener('pointerdown', close, true);
      window.removeEventListener('keydown', esc);
    };
  });
  // Portal to <body>: the dock is transformed, which would make `position: fixed` relative to it. Kept on screen.
  const left = Math.min(props.x, window.innerWidth - 180);
  const top = Math.min(props.y, window.innerHeight - 20 - props.items.length * 36);
  return createPortal(
    <div
      ref={ref}
      className="context-menu"
      role="menu"
      data-testid="object-menu"
      style={{ left, top }}
      onClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.preventDefault()}
    >
      {props.items.map((item) => (
        <span
          key={item.label}
          role="menuitem"
          tabIndex={0}
          className="menu-row"
          data-testid={item.testId}
          onClick={() => {
            props.onClose();
            item.run();
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              props.onClose();
              item.run();
            }
          }}
        >
          {item.label}
        </span>
      ))}
    </div>,
    document.body,
  );
}

/**
 * The trash can: deletes what is selected (objects, or a connection), and
 * objects dragged onto it (the level view drops them here; it lights up while
 * they are over it). For touch screens, which have no Delete key. Undo brings
 * them back.
 */
function TrashButton() {
  const count = useEditor((s) => s.selectedEntityIds.length);
  const connection = useEditor((s) => s.selectedConnectionId !== null);
  const hot = useEditor((s) => s.trashHot);
  const what = connection ? 'the selected connection' : count === 1 ? 'the selected object' : count > 1 ? `the ${count} selected objects` : null;
  return (
    <button
      className={`dock-btn trash-btn${hot ? ' hot' : ''}`}
      data-testid="trash"
      aria-label={what ? `Delete ${what}` : 'Trash: select objects (or drag them here) to delete them'}
      title={what ? `Delete ${what} (Del)` : 'Drag objects here to delete them, or select them and tap this'}
      aria-disabled={!what}
      onClick={() => what && deleteSelection()}
    >
      <svg width="15" height="15" viewBox="0 0 16 16" aria-hidden="true">
        <path d="M2.5 4h11M6 4V2.5h4V4M4 4l.7 9.5h6.6L12 4M6.6 6.5v5M9.4 6.5v5" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </button>
  );
}

const GROUPS_KEY = 'pxlbuilder.objectGroups';

function ObjectsPanel() {
  const definitions = useEditor((s) => s.project.definitions);
  const [category, setCategory] = useState<string>('All');
  // The groups can be hidden (they take room a phone doesn't have); remembered in this browser.
  const [groupsShown, setGroupsShown] = useState(() => {
    try {
      return localStorage.getItem(GROUPS_KEY) !== 'hidden';
    } catch {
      return true;
    }
  });
  const toggleGroups = () => {
    setGroupsShown(!groupsShown);
    try {
      localStorage.setItem(GROUPS_KEY, groupsShown ? 'hidden' : 'shown');
    } catch {
      // Not remembered (storage unavailable).
    }
  };
  const present = CATEGORIES.filter((c) => definitions.some((d) => categoryOf(d) === c));
  const shown = category === 'All' ? definitions : definitions.filter((d) => categoryOf(d) === category);
  const [asking, setAsking] = useState<LibraryAsk | null>(null);
  // Asked to open an object's card (a prompt was moved there): next to its tile, once the tiles are on screen.
  const libraryAsk = useEditor((s) => s.libraryAsk);
  useEffect(() => {
    if (!libraryAsk) return;
    if (category !== 'All' && !shown.some((d) => d.id === libraryAsk)) setCategory('All');
    const frame = requestAnimationFrame(() => {
      const tile = document.querySelector(`[data-definition="${CSS.escape(libraryAsk)}"]`);
      tile?.scrollIntoView({ block: 'nearest' });
      setAsking({ kind: 'object', id: libraryAsk, rect: tileRect(tile) });
      useEditor.getState().setLibraryAsk(null);
    });
    return () => cancelAnimationFrame(frame);
  }, [libraryAsk, category]);
  return (
    <section className={`dock-panel objects${groupsShown ? '' : ' groups-hidden'}`} data-testid="library-panel" data-movable="library-panel" aria-label="Objects">
      <div className="move-grip wide" data-move-handle title="Drag to move" />
      <PanelClose />
      <button className="groups-toggle" data-testid="groups-toggle" aria-expanded={groupsShown} title={groupsShown ? 'Hide the groups' : 'Show the groups'} onClick={toggleGroups}>
        <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
          <path d={groupsShown ? 'M3 7.5 6 4.5l3 3' : 'M3 4.5 6 7.5l3-3'} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        Groups{category !== 'All' && !groupsShown ? `: ${category}` : ''}
      </button>
      <nav className="category-list" role="tablist" aria-label="Categories" hidden={!groupsShown}>
        {['All', ...present].map((c) => (
          <button key={c} role="tab" aria-selected={category === c} className={`category${category === c ? ' on' : ''}`} onClick={() => setCategory(c)}>
            {c}
            <span className="n">{c === 'All' ? definitions.length : definitions.filter((d) => categoryOf(d) === c).length}</span>
          </button>
        ))}
      </nav>
      <div className="objects-main">
        <div className="tiles" data-testid="object-library">
          {shown.map((d) => (
            <ObjectTile key={d.id} def={d} onAsk={setAsking} />
          ))}
        </div>
        <p className="panel-hint">Click an object to draw with it. Drag across the level to draw a row.</p>
      </div>
      {asking && <LibraryPrompt ask={asking} onClose={() => setAsking(null)} />}
    </section>
  );
}

/** The game's sounds: hear them, edit them in the sound editor, make new ones. */
function SoundsPanel() {
  const assets = useEditor((s) => s.project.assets);
  const [deleting, setDeleting] = useState<{ id: string; name: string } | null>(null);
  const sounds = assets.filter((a) => a.kind === 'sound' && a.synth);
  const [menu, setMenu] = useState<{ id: string; x: number; y: number; row: Element } | null>(null);
  const [asking, setAsking] = useState<LibraryAsk | null>(null);
  const menuSound = menu ? sounds.find((a) => a.id === menu.id) : undefined;
  const sceneId = useEditor((s) => s.activeSceneId);
  return (
    <section className="dock-panel sounds" data-testid="sounds-panel" data-movable="sounds-panel" aria-label="Sounds">
      <div className="move-grip wide" data-move-handle title="Drag to move" />
      <PanelClose />
      <div className="sound-list" data-testid="sound-list">
        {sounds.map((a) => (
          <div
            key={a.id}
            className="sound-row"
            data-testid={`sound-${a.name}`}
            title="Right-click for more"
            onContextMenu={(e) => {
              e.preventDefault();
              setMenu({ id: a.id, x: e.clientX, y: e.clientY, row: e.currentTarget });
            }}
          >
            <button className="sound-btn" data-testid="sound-play" title="Play" onClick={() => playSound(a.synth!)}>
              ▶ {a.name}
            </button>
            <span className="muted small">{a.description}</span>
            <button className="icon-btn" aria-label={`Edit ${a.name}`} title="Edit this sound in the sound editor" data-testid="sound-edit" onClick={() => useEditor.getState().setSoundEditor(a.id)}>
              ✎
            </button>
            <button className="icon-btn" aria-label={`Delete ${a.name}`} title="Delete this sound" data-testid="sound-list-delete" onClick={() => setDeleting({ id: a.id, name: a.name })}>
              <TrashIcon />
            </button>
          </div>
        ))}
        {sounds.length === 0 && <p className="muted small">No sounds yet.</p>}
      </div>
      {menu && menuSound && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
          items={[
            { label: 'Ask AI…', testId: 'menu-ai-prompt', run: () => setAsking({ kind: 'sound', id: menuSound.id, rect: tileRect(menu.row) }) },
            { label: 'Play', testId: 'menu-play', run: () => playSound(menuSound.synth!) },
            { label: 'Edit…', testId: 'menu-edit-sound', run: () => useEditor.getState().setSoundEditor(menuSound.id) },
            { label: 'Delete…', testId: 'menu-delete-sound', run: () => setDeleting({ id: menuSound.id, name: menuSound.name }) },
          ]}
        />
      )}
      {asking && <LibraryPrompt ask={asking} onClose={() => setAsking(null)} />}
      <button className="chip-btn sound-new" data-testid="sound-new" onClick={() => void openNewSound()}>
        + New sound
      </button>
      {deleting && (
        <DeleteConfirm
          name={deleting.name}
          onCancel={() => setDeleting(null)}
          onDelete={() => {
            const { id, name } = deleting;
            setDeleting(null);
            useEditor.getState().edit(`Delete sound ${name}`, (p) => void (p.assets = p.assets.filter((x) => x.id !== id)));
          }}
        />
      )}
      <div className="sounds-ask">
        <PromptBox ctx={{ kind: 'sound', sceneId, assetId: null }} placeholder={'Describe a sound: "a springy boing when the player jumps"'} testId="sounds-prompt" />
      </div>
    </section>
  );
}

function CreatePanel() {
  const scene = useEditor(getActiveScene);
  const definitions = useEditor((s) => s.project.definitions);
  return (
    <section className="dock-panel create" data-testid="create-panel" data-movable="create-panel" aria-label="Create an object">
      <div className="move-grip wide" data-move-handle title="Drag to move" />
      <PromptBox
        ctx={{ kind: 'create', sceneId: scene.id }}
        autoFocus
        placeholder="A flying robot that shoots lasers…"
        testId="create-prompt"
        onEscape={() => useEditor.getState().setDock(null)}
        renderApplied={(outcome) => {
          const created = definitions.filter((d) => outcome.result.createdDefinitionIds.includes(d.id));
          if (!created.length) return null;
          return (
            <div className="created">
              <span className="panel-hint">Click to draw it, or drag it into your level</span>
              <div className="tiles">
                {created.map((d) => (
                  <ObjectTile key={d.id} def={d} />
                ))}
              </div>
            </div>
          );
        }}
      />
    </section>
  );
}

/** Objects that can autotile: laid out in a grid (tiles, platforms, ground…), or already autotiling. */
export function canAutotile(def: ObjectDefinition): boolean {
  if (!def.components.Sprite) return false;
  return def.metadata.placement === 'tile' || ['Platforms', 'Environment'].includes(categoryOf(def)) || def.components.Sprite.autotile === true;
}

/** Opens the sprite editor on an object's look (a new drawing when it has no picture the editor can edit). */
export function editSpriteOf(definitionId: string): void {
  const { project, openSpriteEditor } = useEditor.getState();
  const def = project.definitions.find((d) => d.id === definitionId);
  if (!def) return;
  const assetId = typeof def.components.Sprite?.assetId === 'string' ? def.components.Sprite.assetId : null;
  const asset = assetId ? project.assets.find((a) => a.id === assetId) : undefined;
  const editable = !!asset && (!!asset.pixelArt || (asset.kind === 'image' && asset.width <= 64 && asset.height <= 64));
  openSpriteEditor({ definitionId, assetId: editable ? asset!.id : null });
}

/**
 * "Delete object?" for a library object (Objects → right-click → Delete…). With copies in the levels: delete them
 * too, or keep them there as standalone things. One Undo step either way.
 */
function ObjectDeleteConfirm({ def, onDone }: { def: ObjectDefinition; onDone: () => void }) {
  const copies = useEditor((s) => countInstances(s.project, def.id));
  useEffect(() => {
    const esc = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      onDone();
    };
    window.addEventListener('keydown', esc, true);
    return () => window.removeEventListener('keydown', esc, true);
  }, [onDone]);
  const remove = (keep: boolean) => {
    onDone();
    const s = useEditor.getState();
    const done = s.edit(keep ? `Delete object ${def.name} (copies kept)` : `Delete object ${def.name}`, (p) => deleteObject(p, def.id, keep ? 'keep' : 'remove', componentRegistry));
    if (!done) return;
    if (s.pickedDefinitionId === def.id) s.setPickedDefinition(null);
    const tool = useEditor.getState().tool;
    if (tool.kind === 'brush' && tool.definitionId === def.id) s.setTool({ kind: 'select' });
  };
  const n = copies === 1 ? 'its copy' : `its ${copies} copies`;
  return createPortal(
    <div className="dialog-backdrop confirm-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onDone()} onClick={(e) => e.stopPropagation()}>
      <section className="dialog" role="alertdialog" aria-label="Delete object?" data-testid="object-delete-confirm">
        <header className="bg-head">
          <span>Delete object?</span>
        </header>
        <p className="dialog-text">
          “{def.name}” goes from the object library{copies ? `, and it has ${copies === 1 ? 'a copy' : `${copies} copies`} in the levels` : ''}. Undo brings it back.
        </p>
        <footer className="se-footer">
          <span className="grow" />
          <button className="chip-btn" data-testid="object-delete-cancel" onClick={onDone} autoFocus>
            Cancel
          </button>
          {copies > 0 && (
            <button className="chip-btn" data-testid="object-delete-keep" title="The copies stay in the levels, as standalone things" onClick={() => remove(true)}>
              Keep {copies === 1 ? 'the copy' : 'the copies'}
            </button>
          )}
          <button className="danger-btn" data-testid="object-delete-yes" onClick={() => remove(false)}>
            {copies ? `Delete it and ${n}` : 'Delete'}
          </button>
        </footer>
      </section>
    </div>,
    document.body,
  );
}
