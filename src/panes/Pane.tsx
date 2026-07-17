import { useEffect, useMemo, useRef, useState } from 'react';
import { MapContext, useMap, useMapStore, type MapStore } from '../store/mapStore';
import { useUi } from '../store/uiStore';
import { useWorkspace } from '../store/workspaceStore';
import { serialize } from '../io/formats';
import { isUntitledName, fileNameFromTitle } from '../io/autoName';
import { Canvas, type CanvasHandle } from '../canvas/Canvas';
import { NodePopover } from '../inspector/NodePopover';
import { SchedulePopover } from '../inspector/SchedulePopover';
import { LinkAddPopover } from '../inspector/LinkAddPopover';
import { ContextMenu } from '../menu/ContextMenu';
import { Breadcrumb } from '../ui/Breadcrumb';
import { Icon } from '../ui/Icon';
import { tagVar } from '../theme/palette';
import { useSession, type Tab } from '../store/sessionStore';

interface Props {
  tab: Tab;
  isActive: boolean;
  onActivate: () => void;
  onControls: (api: CanvasHandle | null) => void;
}

export function Pane({ tab, isActive, onActivate, onControls }: Props) {
  return (
    <MapContext.Provider value={tab.store as MapStore}>
      <div
        className={`pane${isActive ? ' active' : ''}`}
        onPointerDownCapture={onActivate}
      >
        <PaneBody isActive={isActive} onControls={onControls} />
      </div>
    </MapContext.Provider>
  );
}

function PaneBody({
  isActive,
  onControls,
}: {
  isActive: boolean;
  onControls: (api: CanvasHandle | null) => void;
}) {
  const store = useMapStore();
  const doc = useMap((s) => s.doc);
  const dirty = useMap((s) => s.dirty);
  const filePath = useMap((s) => s.filePath);
  const markSaved = useMap((s) => s.markSaved);
  const colorFilter = useMap((s) => s.colorFilter);
  const setColorFilter = useMap((s) => s.setColorFilter);
  const filterAncestors = useMap((s) => s.filterAncestors);
  const filterDescendants = useMap((s) => s.filterDescendants);
  const toggleFilterAncestors = useMap((s) => s.toggleFilterAncestors);
  const toggleFilterDescendants = useMap((s) => s.toggleFilterDescendants);
  const notePopoverId = useUi((s) => s.notePopoverId);
  const schedulePopoverId = useUi((s) => s.schedulePopoverId);
  const addLinkFor = useUi((s) => s.addLinkFor);
  const contextMenu = useUi((s) => s.contextMenu);

  const usedColors = useMemo(() => {
    const set = new Set<string>();
    for (const n of Object.values(doc.nodes)) if (n.color) set.add(n.color);
    return [...set];
  }, [doc]);

  const [handle, setHandle] = useState<CanvasHandle | null>(null);

  const isEmpty = doc.rootIds.length === 0;

  // report zoom controls up when this pane is the active one
  useEffect(() => {
    onControls(isActive ? handle : null);
  }, [isActive, handle, onControls]);

  // An untitled map takes its file name from the first center topic the user
  // types (spec: docs/product/specs/2026-06-11-untitled-autoname.md). Fires at
  // most once per file — after the rename the name no longer matches the pattern.
  const editingId = useMap((s) => s.editingId);
  const autoNaming = useRef(false);
  useEffect(() => {
    if (!filePath || autoNaming.current) return;
    const base = (filePath.split('/').pop() ?? '').replace(/\.mind$/, '');
    if (!isUntitledName(base)) return;
    const rootId = doc.rootIds[0];
    if (!rootId || editingId === rootId) return; // not while the title is being typed
    const title = fileNameFromTitle(doc.nodes[rootId]?.text ?? '');
    if (!title || title === base) return;
    autoNaming.current = true;
    void (async () => {
      try {
        await useSession.getState().flushSaves(filePath);
        const newPath = await window.api.rename(filePath, `${title}.mind`);
        useSession.getState().renamePath(filePath, newPath);
        await useWorkspace.getState().refresh();
      } catch {
        /* keep the untitled name; a later edit retries */
      } finally {
        autoNaming.current = false;
      }
    })();
  }, [doc, filePath, editingId]);

  // debounced autosave to this tab's file
  useEffect(() => {
    if (!dirty || !filePath) return;
    const t = setTimeout(() => {
      // Save to the tab's *current* path (read at fire time), not the path captured
      // when the timer was scheduled — guards against writing to a just-renamed path.
      const target = store.getState().filePath;
      if (!target) return;
      // Never recreate a file that's being trashed — see useSession.deletingPaths.
      if (useSession.getState().isDeleting(target)) return;
      void window.api.save(target, serialize(store.getState().doc)).then((p) => {
        if (p) markSaved(p);
      });
    }, 1000);
    return () => clearTimeout(t);
  }, [dirty, doc, filePath, markSaved, store]);

  return (
    <>
      <Canvas ref={setHandle} active={isActive} />
      <Breadcrumb />

      {isEmpty && (
        <div className="empty">
          <div className="title">빈 마인드맵</div>
          <div className="hint">
            <kbd>Enter</kbd> 를 눌러 중심 주제를 만드세요
          </div>
        </div>
      )}

      <div className="toolbar">
        <span className={`map-save${dirty ? ' saving' : ''}`} title={dirty ? '저장 중' : '저장됨'} />
        <span className="sep" />
        <button className="tool-btn icon" title="축소" onClick={() => handle?.zoomOut()}>
          <Icon name="minus" />
        </button>
        <button className="tool-btn zoom-label" title="화면 맞춤" onClick={() => handle?.fit()}>
          {Math.round(doc.view.zoom * 100)}%
        </button>
        <button className="tool-btn icon" title="확대" onClick={() => handle?.zoomIn()}>
          <Icon name="plus" />
        </button>
        <span className="sep" />
        <button className="tool-btn icon" title="화면 맞춤" onClick={() => handle?.fit()}>
          <Icon name="expand" />
        </button>
        <button
          className="tool-btn icon"
          title="화면 다시 맞춤"
          onClick={() => useUi.getState().relayout()}
        >
          <Icon name="refresh" />
        </button>
        {usedColors.length > 0 && (
          <>
            <span className="sep" />
            <span className="filter-dots" title="색상 필터">
              {usedColors.map((c) => (
                <button
                  key={c}
                  className={`filter-dot${colorFilter === c ? ' on' : ''}`}
                  style={{ background: tagVar(c) }}
                  title={colorFilter === c ? '필터 해제' : '이 색만 보기'}
                  onClick={() => setColorFilter(colorFilter === c ? null : c)}
                />
              ))}
            </span>
            {colorFilter && (
              <>
                <button
                  className={`tool-btn small${filterAncestors ? ' on' : ''}`}
                  title="상위 노드 포함"
                  onClick={toggleFilterAncestors}
                >
                  <Icon name="chevronUp" />
                  상위
                </button>
                <button
                  className={`tool-btn small${filterDescendants ? ' on' : ''}`}
                  title="하위 노드 포함"
                  onClick={toggleFilterDescendants}
                >
                  <Icon name="chevronDown" />
                  하위
                </button>
              </>
            )}
          </>
        )}
      </div>

      {notePopoverId && doc.nodes[notePopoverId] && (
        <NodePopover id={notePopoverId} onClose={() => useUi.getState().closeNote()} />
      )}
      {schedulePopoverId && doc.nodes[schedulePopoverId] && (
        <SchedulePopover id={schedulePopoverId} onClose={() => useUi.getState().closeSchedule()} />
      )}
      {addLinkFor && doc.nodes[addLinkFor] && (
        <LinkAddPopover id={addLinkFor} onClose={() => useUi.getState().closeAddLink()} />
      )}
      {contextMenu && doc.nodes[contextMenu.id] && (
        <ContextMenu
          id={contextMenu.id}
          x={contextMenu.x}
          y={contextMenu.y}
          onClose={() => useUi.getState().closeContextMenu()}
        />
      )}
    </>
  );
}
