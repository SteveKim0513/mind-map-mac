import { useBoard } from '../store/boardStore';
import { useDismissablePosition } from '../ui/useDismissablePosition';

interface Props {
  /** The element id(s) this menu acts on — already the current selection by
   *  the time this renders (BoardCanvasArea's right-click handler sets
   *  `selection` to this same list before opening the menu). */
  ids: string[];
  x: number;
  y: number;
  onClose: () => void;
  /** 공유 폴더의 보드면 "코멘트 남기기" — 요소 하나에만 붙는다. 없으면(일반 보드) 항목을 그리지 않는다. */
  onComment?: (id: string) => void;
  /** 뷰어(공유로 받은 읽기 전용 보드): 편집 항목 없이 코멘트만. */
  viewer?: boolean;
}

/** Board's own right-click menu for a sticky/image — kept separate from
 *  `menu/ContextMenu.tsx` (mindmap-only: addChild/addSibling/setTodo/
 *  schedule/focus, none of which apply to a board element) rather than
 *  generalizing that component, which would need every one of its actions
 *  gated behind a kind check for no shared benefit. Shares only
 *  `useDismissablePosition` (ui/) and the global `.ctx-menu`/`.ctx-item`
 *  CSS (styles.css) for visual parity — same pattern `panes/TabBar.tsx`
 *  already uses for its own independent right-click menu (local `useState`
 *  + this same hook, not the mindmap's `uiStore.contextMenu`). */
export function BoardContextMenu({ ids, x, y, onClose, onComment, viewer = false }: Props) {
  const duplicateElements = useBoard((s) => s.duplicateElements);
  const removeElements = useBoard((s) => s.removeElements);
  const { ref, pos } = useDismissablePosition<HTMLDivElement>(x, y, onClose, { bottomInset: 76 });

  if (!ids.length) return null;
  const run = (fn: () => void) => () => {
    fn();
    onClose();
  };

  const canComment = !!onComment && ids.length === 1;
  if (viewer) {
    if (!canComment) return null;
    return (
      <div ref={ref} className="ctx-menu" style={{ left: pos.left, top: pos.top }} onPointerDown={(e) => e.stopPropagation()}>
        <button className="ctx-item" data-testid="ctx-comment" onClick={run(() => onComment(ids[0]))}>
          <span>코멘트 남기기</span>
        </button>
      </div>
    );
  }

  return (
    <div ref={ref} className="ctx-menu" style={{ left: pos.left, top: pos.top }} onPointerDown={(e) => e.stopPropagation()}>
      {ids.length > 1 && <div className="ctx-head">{ids.length}개 선택됨</div>}
      <button className="ctx-item" onClick={run(() => duplicateElements())}>
        <span>복제</span>
      </button>
      {canComment && (
        <button className="ctx-item" data-testid="ctx-comment" onClick={run(() => onComment(ids[0]))}>
          <span>코멘트 남기기</span>
        </button>
      )}
      <div className="ctx-sep" />
      <button className="ctx-item danger" onClick={run(() => removeElements(ids))}>
        <span>삭제</span>
        <kbd>⌫</kbd>
      </button>
    </div>
  );
}
