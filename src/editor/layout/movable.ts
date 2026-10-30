/**
 * Every floating panel can be moved: drag it by its title bar (or its grip, on the panels without one). Where it
 * was moved to is kept in this browser (an editor preference, never part of the game) and used again whenever it
 * opens. A double-click on the title bar puts that panel back; "Reset editor layout" puts all of them back.
 *
 * A panel takes part by carrying `data-movable="<name>"` on its outermost element; every dialog (`.dialog` with a
 * test id) does by itself, under that id. The move is the CSS `translate`
 * property, which adds to whatever the panel does itself with `transform` (the prompt card and an object's panel
 * follow the selection that way, and stay that far from where they would be).
 */

const STORAGE_KEY = 'pxlbuilder.panelPositions';

/** Where a panel's title bar is: dragging these moves it. */
const HANDLES = 'header, .prompt-header, .drawer-head, .object-card-head, [data-move-handle]';
/** Inside a title bar, these do their own thing on a press. */
const INTERACTIVE = 'button, input, select, textarea, a, [role="slider"], [contenteditable="true"], [data-no-move]';

type Offset = { x: number; y: number };

const PANELS = '[data-movable], .dialog[data-testid]';

/** The name a panel's place is kept under. */
function nameOf(el: HTMLElement): string {
  return el.dataset.movable ?? el.dataset.testid ?? '';
}

let offsets: Record<string, Offset> = load();

function load(): Record<string, Offset> {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as Record<string, Offset>;
    return Object.fromEntries(Object.entries(raw).filter(([, o]) => o && Number.isFinite(o.x) && Number.isFinite(o.y)));
  } catch {
    return {};
  }
}

function save(): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(offsets));
  } catch {
    // (Not kept: private window or storage turned off. The panel still moves.)
  }
}

function apply(el: HTMLElement): void {
  const o = offsets[nameOf(el)];
  el.style.translate = o ? `${Math.round(o.x)}px ${Math.round(o.y)}px` : '';
}

/** Puts every panel back where it opens by itself. */
export function resetPanelPositions(): void {
  offsets = {};
  save();
  document.querySelectorAll<HTMLElement>(PANELS).forEach(apply);
}

/** How far a panel has been moved (for tests and the editor's own checks). */
export function panelOffset(name: string): Offset | null {
  return offsets[name] ?? null;
}

/**
 * Starts the mover (once, for the whole editor): panels opening get their place, and title bars can be dragged.
 * Returns the function that stops it.
 */
export function startPanelMover(root: HTMLElement = document.body): () => void {
  root.querySelectorAll<HTMLElement>(PANELS).forEach(apply);
  const observer = new MutationObserver((changes) => {
    for (const c of changes) {
      for (const n of c.addedNodes) {
        if (!(n instanceof HTMLElement)) continue;
        if (n.matches(PANELS)) apply(n);
        n.querySelectorAll<HTMLElement>(PANELS).forEach(apply);
      }
      // A panel that becomes another one in place (the prompt card for another object) keeps its own place.
      if (c.type === 'attributes' && c.target instanceof HTMLElement && c.target.dataset.movable) apply(c.target);
    }
  });
  observer.observe(root, { subtree: true, childList: true, attributes: true, attributeFilter: ['data-movable'] });

  /** The panel a press on this would move (on its title bar, not on a button in it), or null. */
  const panelAt = (target: EventTarget | null): HTMLElement | null => {
    if (!(target instanceof Element)) return null;
    if (target.closest(INTERACTIVE)) return null;
    const handle = target.closest(HANDLES);
    return handle?.closest<HTMLElement>(PANELS) ?? null;
  };

  const down = (e: PointerEvent) => {
    if (e.button !== 0) return;
    const panel = panelAt(e.target);
    if (!panel) return;
    const name = nameOf(panel);
    const from = offsets[name] ?? { x: 0, y: 0 };
    const start = { x: e.clientX, y: e.clientY };
    const rect = panel.getBoundingClientRect();
    let moving = false;
    const move = (ev: PointerEvent) => {
      let dx = ev.clientX - start.x;
      let dy = ev.clientY - start.y;
      if (!moving) {
        // A small slip is still a click (titles that open something stay clickable).
        if (Math.hypot(dx, dy) < 4) return;
        moving = true;
        panel.classList.add('is-moving');
        document.body.classList.add('moving-panel');
      }
      ev.preventDefault();
      // Never out of reach: at least 48 px of it, and its top edge, stay in the window.
      dx = Math.min(Math.max(dx, 48 - rect.right), window.innerWidth - 48 - rect.left);
      dy = Math.min(Math.max(dy, -rect.top), window.innerHeight - 32 - rect.top);
      offsets[name] = { x: from.x + dx, y: from.y + dy };
      apply(panel);
    };
    const up = () => {
      window.removeEventListener('pointermove', move, true);
      window.removeEventListener('pointerup', up, true);
      window.removeEventListener('pointercancel', up, true);
      if (!moving) return;
      panel.classList.remove('is-moving');
      document.body.classList.remove('moving-panel');
      save();
      // The click that ends a drag isn't a click on what is under it.
      window.addEventListener('click', swallow, { capture: true, once: true });
      setTimeout(() => window.removeEventListener('click', swallow, true), 0);
    };
    window.addEventListener('pointermove', move, true);
    window.addEventListener('pointerup', up, true);
    window.addEventListener('pointercancel', up, true);
  };
  const swallow = (e: Event) => {
    e.stopPropagation();
    e.preventDefault();
  };
  const dbl = (e: MouseEvent) => {
    const panel = panelAt(e.target);
    if (!panel || !offsets[nameOf(panel)]) return;
    delete offsets[nameOf(panel)];
    save();
    apply(panel);
  };
  root.addEventListener('pointerdown', down, true);
  root.addEventListener('dblclick', dbl, true);
  return () => {
    observer.disconnect();
    root.removeEventListener('pointerdown', down, true);
    root.removeEventListener('dblclick', dbl, true);
  };
}
