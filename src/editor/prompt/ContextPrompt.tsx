import { useEffect, useMemo, useRef } from 'react';
import { describeRelationship, relationshipLabel } from '../../core/logic/describe';
import { describeRef } from '../../core/logic/refs';
import { contextKey } from '../../core/ai/context';
import { CHROME_INSETS } from '../viewport/Viewport';
import { getSelectionContext, useEditor } from '../store';
import { subscribeAnchor } from './anchor';
import { placePrompt } from './placement';
import { PromptBox } from './PromptBox';

/**
 * The one contextual prompt. It exists only while something is the active
 * context (an object, a pair, a group, or the level), sits next to it, and
 * moves with it. Selecting something else replaces it; clearing the
 * selection removes it.
 */
export function ContextPrompt() {
  // Select stable pieces; deriving the context inside a selector would create a new object every render.
  const activeSceneId = useEditor((s) => s.activeSceneId);
  const selectedEntityIds = useEditor((s) => s.selectedEntityIds);
  const worldContext = useEditor((s) => s.worldContext);
  const selectedConnectionId = useEditor((s) => s.selectedConnectionId);
  const cameraOutline = useEditor((s) => s.cameraOutline);
  const ctx = useMemo(
    () => getSelectionContext({ activeSceneId, selectedEntityIds, worldContext, selectedConnectionId }),
    [activeSceneId, selectedEntityIds, worldContext, selectedConnectionId],
  );
  const key = ctx ? contextKey(ctx) : null;
  const wrapRef = useRef<HTMLDivElement>(null);
  const lineRef = useRef<SVGLineElement>(null);
  const dotRef = useRef<SVGCircleElement>(null);

  useEffect(() => {
    if (!key) return;
    let lastAnchor: Parameters<Parameters<typeof subscribeAnchor>[0]>[0] = null;
    const position = () => {
      const wrap = wrapRef.current;
      const line = lineRef.current;
      const dot = dotRef.current;
      if (!wrap || !line || !dot) return;
      const anchor = lastAnchor;
      // Until the viewport has drawn this context, the anchor still describes the previous one.
      if (!anchor || !anchor.visible || anchor.key !== key) {
        wrap.style.visibility = 'hidden';
        line.style.visibility = 'hidden';
        dot.style.visibility = 'hidden';
        return;
      }
      const size = { w: wrap.offsetWidth, h: wrap.offsetHeight };
      const p = placePrompt(anchor.rect, size, anchor.view, { insetTop: CHROME_INSETS.top, insetBottom: CHROME_INSETS.bottom });
      wrap.style.transform = `translate(${Math.round(p.x)}px, ${Math.round(p.y)}px)`;
      wrap.dataset.side = p.side;
      wrap.style.visibility = 'visible';
      line.setAttribute('x1', String(p.connector.x1));
      line.setAttribute('y1', String(p.connector.y1));
      line.setAttribute('x2', String(p.connector.x2));
      line.setAttribute('y2', String(p.connector.y2));
      dot.setAttribute('cx', String(p.connector.x2));
      dot.setAttribute('cy', String(p.connector.y2));
      line.style.visibility = 'visible';
      dot.style.visibility = 'visible';
    };
    const unsubscribe = subscribeAnchor((a) => {
      lastAnchor = a;
      position();
    });
    // Re-place when the prompt's own size changes (results, multi-line input).
    const ro = new ResizeObserver(position);
    if (wrapRef.current) ro.observe(wrapRef.current);
    return () => {
      unsubscribe();
      ro.disconnect();
    };
  }, [key]);

  if (!ctx || !key) return null;
  const { setInspectorOpen, selectEntities, setWorldContext, selectConnection, project } = useEditor.getState();
  const scene = project.scenes.find((sc) => sc.id === ctx.sceneId);
  const nameOf = (id: string) => scene?.entities.find((e) => e.id === id)?.name ?? '?';
  const objectNameOf = (id: string) => {
    const defId = scene?.entities.find((e) => e.id === id)?.definitionId;
    return defId ? (project.definitions.find((d) => d.id === defId)?.name ?? null) : null;
  };
  const header =
    ctx.kind === 'level' ? (
      <>
        <svg width="15" height="15" viewBox="0 0 16 16" aria-hidden="true">
          <circle cx="8" cy="8" r="6.2" fill="none" stroke="currentColor" strokeWidth="1.3" />
          <path d="M1.8 8h12.4M8 1.8c-3.2 3.4-3.2 9 0 12.4M8 1.8c3.2 3.4 3.2 9 0 12.4" fill="none" stroke="currentColor" strokeWidth="1.1" />
        </svg>
        {cameraOutline === 'start' ? 'Camera at start' : cameraOutline === 'limits' ? 'Camera limits' : 'World'}
      </>
    ) : ctx.kind === 'connection' ? (
      <ConnectionHeader sceneId={ctx.sceneId} relationshipId={ctx.relationshipId} />
    ) : ctx.kind === 'pair' ? (
      <>
        {nameOf(ctx.entityIds[0])} <span className="arrow">→</span> {nameOf(ctx.entityIds[1])}
      </>
    ) : ctx.kind === 'group' ? (
      <>{ctx.entityIds.length} objects</>
    ) : ctx.kind === 'entity' ? (
      <EntityHeader name={nameOf(ctx.entityIds[0])} objectName={objectNameOf(ctx.entityIds[0])} />
    ) : undefined;
  const close = () => {
    selectEntities([]);
    setWorldContext(false);
    selectConnection(null);
  };
  return (
    <div className="context-layer">
      <svg className="connector" aria-hidden="true">
        <line ref={lineRef} style={{ visibility: 'hidden' }} />
        <circle ref={dotRef} r="2.5" style={{ visibility: 'hidden' }} />
      </svg>
      <div className="context-prompt" ref={wrapRef} style={{ visibility: 'hidden' }} data-testid="context-prompt" data-context={ctx.kind}>
        <PromptBox
          key={key}
          ctx={ctx}
          header={header}
          placeholder={
            cameraOutline === 'start'
              ? 'Ask about the camera: "zoom out a bit", "start further left", "follow the player more loosely"…'
              : cameraOutline === 'limits'
                ? 'Where may the camera go? "let it show a bit below the level", "no limits"…'
                : undefined
          }
          onDetails={() => setInspectorOpen(true)}
          onEscape={close}
          onClose={close}
        />
      </div>
    </div>
  );
}

/** The selected object's name, and the library object it is a copy of when that has another name. */
function EntityHeader({ name, objectName }: { name: string; objectName: string | null }) {
  return (
    <span className="entity-head" data-testid="entity-header">
      {name}
      {objectName && objectName !== name && <span className="entity-kind">{objectName}</span>}
    </span>
  );
}

/** "Switch → Door" and what the connection does now ("opens"). */
function ConnectionHeader({ sceneId, relationshipId }: { sceneId: string; relationshipId: string }) {
  const project = useEditor((s) => s.project);
  const scene = project.scenes.find((s) => s.id === sceneId);
  const rel = scene?.relationships.find((r) => r.id === relationshipId);
  if (!scene || !rel) return null;
  return (
    <span className="connection-head" data-testid="connection-header" title={describeRelationship(project, scene, rel)}>
      {describeRef(project, scene, rel.source)} <span className="arrow">→</span> {describeRef(project, scene, rel.target)}
      <span className="connection-does">{relationshipLabel(rel)}</span>
    </span>
  );
}
