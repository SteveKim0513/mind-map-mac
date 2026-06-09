import { useMap } from '../store/mapStore';

export function Breadcrumb() {
  const focusRootId = useMap((s) => s.focusRootId);
  const node = useMap((s) => (s.focusRootId ? s.doc.nodes[s.focusRootId] : null));
  const setFocus = useMap((s) => s.setFocus);

  if (!focusRootId || !node) return null;
  const parentId = node.parentId;

  return (
    <div className="breadcrumb">
      <button className="bc-exit" onClick={() => setFocus(null)} title="포커스 해제 (Esc)">
        ⌂ 전체
      </button>
      {parentId && (
        <button className="bc-up" title="상위로" onClick={() => setFocus(parentId)}>
          ↑
        </button>
      )}
      <span className="bc-label">집중</span>
      <span className="bc-current" title={node.text}>
        {node.text?.trim() || '제목 없음'}
      </span>
    </div>
  );
}
