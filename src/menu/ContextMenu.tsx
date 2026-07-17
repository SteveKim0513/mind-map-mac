import { useMap, useMapStore } from '../store/mapStore';
import { useUi } from '../store/uiStore';
import { requestFocusStart } from '../focus/controller';
import { ColorSwatchGrid } from '../ui/ColorSwatchGrid';
import { useDismissablePosition } from '../ui/useDismissablePosition';

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
  // 76px bottom inset keeps the menu clear of the floating zoom toolbar,
  // which paints above us (the pane's stacking context outranks the canvas's)
  const { ref, pos } = useDismissablePosition<HTMLDivElement>(x, y, onClose, { bottomInset: 76 });

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
    // 결정 0014 · 완료는 할 일 노드에서만. 선택에 일반 노드가 하나라도 섞이면 "완료"를 아예 숨긴다.
    const allTodo = sel.every((i) => map.doc.nodes[i]?.todo);
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
          <ColorSwatchGrid value={uniformColor} onChange={(c) => run(() => map.setColorSelected(c))()} />
        </div>
        {allTodo && (
          <button className="ctx-item" onClick={run(() => map.toggleDoneSelected())}>
            <span>{allDone ? '완료 해제' : '완료 표시'}</span>
          </button>
        )}
        <div className="ctx-sep" />

        <button className="ctx-item danger" onClick={run(() => map.deleteSelected())}>
          <span>삭제</span>
          <kbd>⌫</kbd>
        </button>
      </div>
    );
  }

  const focusing = useUi((s) => !!s.activeFocus);

  return (
    <div
      ref={ref}
      className="ctx-menu"
      style={{ left: pos.left, top: pos.top }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      {/* 구조 — 노드 자체의 뼈대 (축 무관, 결정 0011). 축 순서는 유지하되 라벨은 노출하지 않는다 (카피 감사 2026-07-15) */}
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
      {hasChildren && (
        <button className="ctx-item" onClick={run(() => map.toggleCollapse(id))}>
          <span>{node.collapsed ? '펼치기' : '접기'}</span>
        </button>
      )}
      <button className="ctx-item" onClick={run(() => useUi.getState().zoomTo(id))}>
        <span>이 노드로 확대</span>
        <kbd>Z</kbd>
      </button>
      <button className="ctx-item" onClick={run(() => map.duplicateNode(id))}>
        <span>복제</span>
      </button>
      <div className="ctx-sep" />

      {/* 정리 — 생각을 포착·구조화(색·아이콘·메모·링크) */}
      <div className="ctx-colors">
        <ColorSwatchGrid value={node.color} onChange={(c) => run(() => map.setColor(id, c))()} />
      </div>
      <button className="ctx-item subtle" onClick={run(() => useUi.getState().openNote(id))}>
        <span>아이콘…</span>
      </button>
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
      <div className="ctx-sep" />

      {/* 실행 — 완료·일정·집중은 할 일(todo) 노드에서만. 일반 노드는 "할 일로 전환"만 (결정 0014) */}
      {node.todo ? (
        <>
          <button className="ctx-item" onClick={run(() => map.toggleDone(id))}>
            <span>{node.done ? '완료 해제' : '완료 표시'}</span>
            <kbd>⌘↵</kbd>
          </button>
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
              <span>{hasChildren ? '하위까지 일정 지정' : '일정 지정'}</span>
            </button>
          )}
          <button
            className="ctx-item"
            onClick={run(() => {
              if (focusing) useUi.getState().toast('집중이 이미 진행 중입니다');
              else requestFocusStart(mapStore, id);
            })}
          >
            <span>{focusing ? '집중 중…' : '집중 시작'}</span>
          </button>
          <button className="ctx-item subtle" onClick={run(() => map.setTodo(id, false))}>
            <span>일반 노드로 되돌리기</span>
          </button>
        </>
      ) : (
        <button className="ctx-item" onClick={run(() => map.setTodo(id, true))}>
          <span>할 일로 전환</span>
          <kbd>⌘↵</kbd>
        </button>
      )}
      <div className="ctx-sep" />

      {/* 통찰 — 더 깊이 쓰고 되짚어 이해(결정 0011) */}
      <button className="ctx-item" onClick={run(() => map.setFocus(id))}>
        <span>이 노드만 보기</span>
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
        <span>노드에 노트 연결</span>
      </button>
      <div className="ctx-sep" />
      <button className="ctx-item danger" onClick={run(() => map.deleteNode(id))}>
        <span>삭제</span>
        <kbd>⌫</kbd>
      </button>
    </div>
  );
}
