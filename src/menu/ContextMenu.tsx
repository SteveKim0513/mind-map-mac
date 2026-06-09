import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useMap } from '../store/mapStore';
import { useUi } from '../store/uiStore';

const COLORS = ['#62aef0', '#d6b6f6', '#ff64c8', '#dd5b00', '#2a9d99', '#1aae39'];

interface Props {
  id: string;
  x: number;
  y: number;
  onClose: () => void;
}

export function ContextMenu({ id, x, y, onClose }: Props) {
  const node = useMap((s) => s.doc.nodes[id]);
  const map = useMap((s) => s);
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x, top: y });

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setPos({
      left: Math.min(x, window.innerWidth - r.width - 8),
      top: Math.min(y, window.innerHeight - r.height - 8),
    });
  }, [x, y]);

  useEffect(() => {
    const down = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('mousedown', down);
    window.addEventListener('keydown', key, true);
    return () => {
      window.removeEventListener('mousedown', down);
      window.removeEventListener('keydown', key, true);
    };
  }, [onClose]);

  if (!node) return null;
  const run = (fn: () => void) => () => {
    fn();
    onClose();
  };
  const hasChildren = node.children.length > 0;

  return (
    <div
      ref={ref}
      className="ctx-menu"
      style={{ left: pos.left, top: pos.top }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      {map.selectedIds.length >= 2 && (
        <>
          {map.selectedIds.length === 2 && (
            <button
              className="ctx-item"
              onClick={run(() => map.addConnection(map.selectedIds[0], map.selectedIds[1]))}
            >
              <span>🔗 두 노드 연결</span>
            </button>
          )}
          <button className="ctx-item" onClick={run(() => map.addSection(map.selectedIds))}>
            <span>▢ 섹션으로 묶기 ({map.selectedIds.length})</span>
          </button>
          <div className="ctx-sep" />
        </>
      )}
      <button className="ctx-item" onClick={run(() => map.addChild(id))}>
        <span>자식 추가</span>
        <kbd>Tab</kbd>
      </button>
      <button className="ctx-item" onClick={run(() => map.addSibling(id))}>
        <span>형제 추가</span>
        <kbd>↵</kbd>
      </button>
      <button className="ctx-item" onClick={run(() => map.startEdit(id))}>
        <span>편집</span>
        <kbd>Space</kbd>
      </button>
      <div className="ctx-sep" />

      <div className="ctx-colors">
        {COLORS.map((c) => (
          <button
            key={c}
            className="ctx-swatch"
            style={{ background: c }}
            onClick={run(() => map.setColor(id, node.color === c ? undefined : c))}
          />
        ))}
        <button
          className="ctx-swatch none"
          title="색 제거"
          onClick={run(() => map.setColor(id, undefined))}
        />
      </div>

      <button className="ctx-item" onClick={run(() => useUi.getState().openNote(id))}>
        <span>노트·링크</span>
      </button>
      <button className="ctx-item" onClick={run(() => map.toggleDone(id))}>
        <span>{node.done ? '완료 해제' : '완료 표시'}</span>
        <kbd>⌘↵</kbd>
      </button>
      <div className="ctx-sep" />
      {node.scheduled ? (
        <>
          <button className="ctx-item" onClick={run(() => useUi.getState().openSchedule(id))}>
            <span>📅 스케줄 설정…</span>
          </button>
          <button className="ctx-item" onClick={run(() => map.setScheduled(id, false))}>
            <span>스케줄 해제{hasChildren ? ' (하위 포함)' : ''}</span>
          </button>
        </>
      ) : (
        <button className="ctx-item" onClick={run(() => map.setScheduled(id, true))}>
          <span>📅 스케줄 노드로 지정{hasChildren ? ' (하위 포함)' : ''}</span>
        </button>
      )}
      {hasChildren && (
        <button className="ctx-item" onClick={run(() => map.toggleCollapse(id))}>
          <span>{node.collapsed ? '펼치기' : '접기'}</span>
        </button>
      )}
      <div className="ctx-sep" />

      <button className="ctx-item" onClick={run(() => map.setFocus(id))}>
        <span>이 노드에 집중</span>
      </button>
      <button className="ctx-item" onClick={run(() => useUi.getState().zoomTo(id))}>
        <span>이 노드로 확대</span>
        <kbd>Z</kbd>
      </button>
      <button className="ctx-item" onClick={run(() => map.duplicateNode(id))}>
        <span>복제</span>
      </button>
      <div className="ctx-sep" />
      <button className="ctx-item danger" onClick={run(() => map.deleteNode(id))}>
        <span>삭제</span>
        <kbd>⌫</kbd>
      </button>
    </div>
  );
}
