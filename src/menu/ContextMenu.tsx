import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useMap, useMapStore } from '../store/mapStore';
import { useUi } from '../store/uiStore';
import { requestFocusStart } from '../focus/controller';
import { TAG_KEYS, tagVar } from '../theme/palette';

interface Props {
  id: string;
  x: number;
  y: number;
  onClose: () => void;
}

export function ContextMenu({ id, x, y, onClose }: Props) {
  const node = useMap((s) => s.doc.nodes[id]);
  const map = useMap((s) => s);
  const mapStore = useMapStore();
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x, top: y });

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    // 76px bottom inset keeps the menu clear of the floating zoom toolbar,
    // which paints above us (the pane's stacking context outranks the canvas's)
    setPos({
      left: Math.min(x, window.innerWidth - r.width - 8),
      top: Math.min(y, window.innerHeight - r.height - 76),
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

  // Multi-selection gets its OWN menu — only actions that apply to the whole
  // selection (the single-node items would silently act on just one node).
  const sel = map.selectedIds;
  if (sel.length >= 2) {
    const colorSet = new Set(sel.map((i) => map.doc.nodes[i]?.color));
    const uniformColor = colorSet.size === 1 ? [...colorSet][0] : undefined;
    const allDone = sel.every((i) => map.doc.nodes[i]?.done);
    return (
      <div
        ref={ref}
        className="ctx-menu"
        style={{ left: pos.left, top: pos.top }}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <div className="ctx-head">{sel.length}개 선택됨</div>
        {sel.length === 2 && (
          <button className="ctx-item" onClick={run(() => map.addConnection(sel[0], sel[1]))}>
            <span>두 노드 연결</span>
          </button>
        )}
        <button className="ctx-item" onClick={run(() => map.addSection(sel))}>
          <span>섹션으로 묶기</span>
        </button>
        <div className="ctx-sep" />

        {/* 색상 — 선택 전체에 한 번에 적용 */}
        <div className="ctx-colors">
          {TAG_KEYS.map((c) => (
            <button
              key={c}
              className={`ctx-swatch${uniformColor === c ? ' on' : ''}`}
              style={{ background: tagVar(c), ['--sw' as string]: tagVar(c) }}
              onClick={run(() => map.setColorSelected(uniformColor === c ? undefined : c))}
            />
          ))}
          <button
            className={`ctx-swatch none${!uniformColor ? ' on' : ''}`}
            title="색 제거"
            onClick={run(() => map.setColorSelected(undefined))}
          />
        </div>
        <button className="ctx-item" onClick={run(() => map.toggleDoneSelected())}>
          <span>{allDone ? '완료 해제' : '완료 표시'}</span>
        </button>
        <div className="ctx-sep" />

        <button className="ctx-item danger" onClick={run(() => map.deleteSelected())}>
          <span>삭제</span>
          <kbd>⌫</kbd>
        </button>
      </div>
    );
  }

  return (
    <div
      ref={ref}
      className="ctx-menu"
      style={{ left: pos.left, top: pos.top }}
      onPointerDown={(e) => e.stopPropagation()}
    >
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

      {/* 속성: 색상 · 아이콘 · 완료 — 그룹 구분은 decisions/0004 (진입점 매트릭스 A안) */}
      <div className="ctx-colors">
        {TAG_KEYS.map((c) => (
          <button
            key={c}
            className={`ctx-swatch${node.color === c ? ' on' : ''}`}
            style={{ background: tagVar(c), ['--sw' as string]: tagVar(c) }}
            onClick={run(() => map.setColor(id, node.color === c ? undefined : c))}
          />
        ))}
        <button
          className={`ctx-swatch none${!node.color ? ' on' : ''}`}
          title="색 제거"
          onClick={run(() => map.setColor(id, undefined))}
        />
      </div>
      <button className="ctx-item subtle" onClick={run(() => useUi.getState().openNote(id))}>
        <span>아이콘…</span>
      </button>
      <button className="ctx-item" onClick={run(() => map.toggleDone(id))}>
        <span>{node.done ? '완료 해제' : '완료 표시'}</span>
        <kbd>⌘↵</kbd>
      </button>
      <div className="ctx-sep" />

      {/* 첨부: 메모 · 링크 · 노트 */}
      <button
        className="ctx-item"
        onClick={run(() => useUi.getState().setMemoEditFor(id))}
        disabled={!!node.note}
      >
        <span>{node.note ? '메모 있음' : '메모 추가'}</span>
      </button>
      <button className="ctx-item" onClick={run(() => useUi.getState().openAddLink(id))}>
        <span>링크 추가</span>
      </button>
      <button
        className="ctx-item"
        onClick={run(() =>
          useUi.getState().openLinkNote({
            mapId: map.doc.id ?? '',
            nodeId: id,
            nodeText: node.text,
            mapPath: map.filePath ?? '',
          }),
        )}
      >
        <span>노트 추가·연결</span>
      </button>
      <div className="ctx-sep" />

      {/* 일정 */}
      {node.scheduled ? (
        <>
          <button className="ctx-item" onClick={run(() => useUi.getState().openSchedule(id))}>
            <span>날짜·시간 설정…</span>
          </button>
          <button className="ctx-item" onClick={run(() => map.setScheduled(id, false))}>
            <span>{hasChildren ? '하위까지 스케줄 해제' : '스케줄 해제'}</span>
          </button>
        </>
      ) : (
        <button className="ctx-item" onClick={run(() => map.setScheduled(id, true))}>
          <span>{hasChildren ? '하위까지 스케줄 노드로 지정' : '스케줄 노드로 지정'}</span>
        </button>
      )}
      <div className="ctx-sep" />

      {/* 집중 세션 */}
      <button className="ctx-item" onClick={run(() => requestFocusStart(mapStore, id))}>
        <span>집중 세션 시작</span>
      </button>
      <div className="ctx-sep" />

      {/* 보기 · 기타 */}
      {hasChildren && (
        <button className="ctx-item" onClick={run(() => map.toggleCollapse(id))}>
          <span>{node.collapsed ? '펼치기' : '접기'}</span>
        </button>
      )}
      <button className="ctx-item" onClick={run(() => map.setFocus(id))}>
        <span>이 노드만 보기</span>
      </button>
      <button className="ctx-item" onClick={run(() => useUi.getState().zoomTo(id))}>
        <span>이 노드로 확대</span>
        <kbd>Z</kbd>
      </button>
      <button className="ctx-item" onClick={run(() => map.duplicateNode(id))}>
        <span>복제</span>
      </button>
      <button className="ctx-item danger" onClick={run(() => map.deleteNode(id))}>
        <span>삭제</span>
        <kbd>⌫</kbd>
      </button>
    </div>
  );
}
