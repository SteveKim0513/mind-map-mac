import { useEffect, useMemo, useState } from 'react';
import { MapContext, useMap, useMapStore } from '../store/mapStore';
import { useUi } from '../store/uiStore';
import { serialize } from '../io/formats';
import { Canvas, type CanvasHandle } from '../canvas/Canvas';
import { NodePopover } from '../inspector/NodePopover';
import { SchedulePopover } from '../inspector/SchedulePopover';
import { ContextMenu } from '../menu/ContextMenu';
import { Breadcrumb } from '../ui/Breadcrumb';
import type { Tab } from '../store/sessionStore';

interface Props {
  tab: Tab;
  isActive: boolean;
  onActivate: () => void;
  onControls: (api: CanvasHandle | null) => void;
}

export function Pane({ tab, isActive, onActivate, onControls }: Props) {
  return (
    <MapContext.Provider value={tab.store}>
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

  // debounced autosave to this tab's file
  useEffect(() => {
    if (!dirty || !filePath) return;
    const t = setTimeout(() => {
      void window.api.save(filePath, serialize(store.getState().doc)).then((p) => {
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
        <button className="tool-btn" title="축소" onClick={() => handle?.zoomOut()}>
          −
        </button>
        <button className="tool-btn zoom-label" onClick={() => handle?.fit()}>
          {Math.round(doc.view.zoom * 100)}%
        </button>
        <button className="tool-btn" title="확대" onClick={() => handle?.zoomIn()}>
          ＋
        </button>
        <span className="sep" />
        <button className="tool-btn" title="화면 맞춤" onClick={() => handle?.fit()}>
          맞춤
        </button>
        <button className="tool-btn" title="새로고침 (재배치)" onClick={() => useUi.getState().relayout()}>
          ↻
        </button>
        {usedColors.length > 0 && (
          <>
            <span className="sep" />
            <span className="filter-dots" title="색상 필터">
              {usedColors.map((c) => (
                <button
                  key={c}
                  className={`filter-dot${colorFilter === c ? ' on' : ''}`}
                  style={{ background: c }}
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
                  ↑ 상위
                </button>
                <button
                  className={`tool-btn small${filterDescendants ? ' on' : ''}`}
                  title="하위 노드 포함"
                  onClick={toggleFilterDescendants}
                >
                  ↓ 하위
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
