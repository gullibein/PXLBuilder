import { useEditor } from '../store';
import { Thumb } from './Dock';

/** Left tool panel: Select (arrow), Draw (pen), the level background, and the level's logic. */
export function ToolPanel() {
  const tool = useEditor((s) => s.tool);
  const backgroundOpen = useEditor((s) => s.backgroundOpen);
  const logicOpen = useEditor((s) => s.logicOpen);
  const logicCount = useEditor((s) => {
    const scene = s.project.scenes.find((x) => x.id === s.activeSceneId) ?? s.project.scenes[0];
    return scene.relationships.length + scene.rules.length;
  });
  const brush = useEditor((s) => (s.tool.kind === 'brush' ? s.project.definitions.find((d) => d.id === (s.tool as { definitionId: string }).definitionId) : undefined));
  const { setTool, usePen, setBackgroundOpen, setLogicOpen, setDock } = useEditor.getState();
  return (
    <nav className="tool-panel" aria-label="Tools" data-testid="tool-panel">
      <button
        className={`tool${tool.kind === 'select' ? ' on' : ''}`}
        title="Select and move (V)"
        aria-label="Select"
        aria-pressed={tool.kind === 'select'}
        data-testid="tool-select"
        onClick={() => setTool({ kind: 'select' })}
      >
        <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
          <path d="M4 2.5v12.2l3.3-3.2 2.2 4.8 2.2-1-2.2-4.7h4.6z" fill="currentColor" stroke="currentColor" strokeWidth="1" strokeLinejoin="round" />
        </svg>
      </button>
      <button
        className={`tool${tool.kind === 'brush' ? ' on' : ''}`}
        title="Draw with an object (B)"
        aria-label="Draw"
        aria-pressed={tool.kind === 'brush'}
        data-testid="tool-pen"
        onClick={usePen}
      >
        <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
          <path d="M3 15l1-4.2L12.2 2.6a1.6 1.6 0 0 1 2.3 0l.9.9a1.6 1.6 0 0 1 0 2.3L7.2 14z M10.8 4l3.2 3.2" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
        </svg>
      </button>
      {brush && (
        <button className="tool brush-pick" title={`Drawing with ${brush.name}. Click to choose another object.`} aria-label="Choose what to draw" data-testid="tool-brush-pick" onClick={() => setDock('library')}>
          <Thumb def={brush} size={20} />
        </button>
      )}
      <span className="tool-sep" />
      <button
        className={`tool${backgroundOpen ? ' on' : ''}`}
        title="Background"
        aria-label="Background"
        aria-pressed={backgroundOpen}
        data-testid="tool-background"
        onClick={() => setBackgroundOpen(!backgroundOpen)}
      >
        <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
          <rect x="2.2" y="3.2" width="13.6" height="11.6" rx="2" fill="none" stroke="currentColor" strokeWidth="1.4" />
          <path d="m3 13 4-4.2 3 3 1.8-1.8L15 13.4" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
          <circle cx="11.8" cy="6.6" r="1.4" fill="currentColor" />
        </svg>
      </button>
      <button
        className={`tool${logicOpen ? ' on' : ''}`}
        title="Logic: how things are connected, and the level's rules"
        aria-label="Logic"
        aria-pressed={logicOpen}
        data-testid="tool-logic"
        onClick={() => setLogicOpen(!logicOpen)}
      >
        <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
          <circle cx="4.5" cy="4.5" r="2.2" fill="none" stroke="currentColor" strokeWidth="1.4" />
          <circle cx="13.5" cy="9" r="2.2" fill="none" stroke="currentColor" strokeWidth="1.4" />
          <circle cx="4.5" cy="13.5" r="2.2" fill="none" stroke="currentColor" strokeWidth="1.4" />
          <path d="M6.5 5.5 11.4 8M6.5 12.5l4.9-2.5" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
        </svg>
        {logicCount > 0 && <span className="tool-badge">{logicCount}</span>}
      </button>
    </nav>
  );
}
