import { useEffect, useRef, useState } from 'react';
import { deleteSelection, duplicateSelection, frameView, selectAll } from './actions';
import { newProject, openProjectFile, PROJECT_FILE_EXTENSION, saveProjectToFile } from './persistence';
import { useEditor } from './store';

interface MenuItem {
  label: string;
  shortcut?: string;
  checked?: boolean;
  disabled?: boolean;
  testId?: string;
  run: () => void;
}

export function MenuBar() {
  const fileInput = useRef<HTMLInputElement>(null);
  const name = useEditor((s) => s.project.name);
  const dirty = useEditor((s) => s.dirty);
  const hasSelection = useEditor((s) => s.selectedEntityIds.length > 0);
  const showGrid = useEditor((s) => s.showGrid);
  const snapToGrid = useEditor((s) => s.snapToGrid);
  const { setShowGrid, setSnapToGrid } = useEditor.getState();

  const menus: Record<string, MenuItem[]> = {
    File: [
      {
        label: 'New Project',
        testId: 'menu-new',
        run: () => {
          if (!useEditor.getState().dirty || confirm('Discard unsaved changes and start a new project?')) newProject();
        },
      },
      { label: 'Open…', shortcut: 'Ctrl+O', testId: 'menu-open', run: () => fileInput.current?.click() },
      { label: 'Save', shortcut: 'Ctrl+S', testId: 'menu-save', run: saveProjectToFile },
    ],
    Edit: [
      { label: 'Duplicate', shortcut: 'Ctrl+D', disabled: !hasSelection, run: duplicateSelection },
      { label: 'Delete', shortcut: 'Del', disabled: !hasSelection, run: deleteSelection },
      { label: 'Select All', shortcut: 'Ctrl+A', run: selectAll },
    ],
    View: [
      { label: 'Show Grid', checked: showGrid, run: () => setShowGrid(!showGrid) },
      { label: 'Snap to Grid', checked: snapToGrid, run: () => setSnapToGrid(!snapToGrid) },
      { label: 'Frame Selection / All', shortcut: 'F', run: frameView },
    ],
  };

  return (
    <div className="menubar">
      <span className="brand">PXLBuilder</span>
      {Object.entries(menus).map(([title, items]) => (
        <Menu key={title} title={title} items={items} />
      ))}
      <span className="project-title" data-testid="project-title">
        {name}
        {dirty && <span title="Unsaved changes"> •</span>}
      </span>
      <input
        ref={fileInput}
        type="file"
        accept={`${PROJECT_FILE_EXTENSION},.json,application/json`}
        data-testid="open-file-input"
        style={{ display: 'none' }}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void openProjectFile(file);
          e.target.value = '';
        }}
      />
    </div>
  );
}

function Menu({ title, items }: { title: string; items: MenuItem[] }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, [open]);
  return (
    <div className="menu" ref={ref}>
      <button className={`menu-title${open ? ' open' : ''}`} data-testid={`menu-${title}`} onClick={() => setOpen(!open)}>
        {title}
      </button>
      {open && (
        <div className="menu-dropdown">
          {items.map((item) => (
            <button
              key={item.label}
              className="menu-item"
              disabled={item.disabled}
              data-testid={item.testId}
              onClick={() => {
                setOpen(false);
                item.run();
              }}
            >
              <span className="check">{item.checked ? '✓' : ''}</span>
              <span className="grow">{item.label}</span>
              {item.shortcut && <span className="shortcut">{item.shortcut}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
