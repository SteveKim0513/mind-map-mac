import { useMap } from '../store/mapStore';
import { Icon } from './Icon';

export function Breadcrumb() {
  const focusRootId = useMap((s) => s.focusRootId);
  const node = useMap((s) => (s.focusRootId ? s.doc.nodes[s.focusRootId] : null));
  const setFocus = useMap((s) => s.setFocus);

  if (!focusRootId || !node) return null;
  const parentId = node.parentId;

  return (
    <div className="breadcrumb">
      <button className="bc-exit" onClick={() => setFocus(null)} title="포커스 해제 (Esc)">
        <Icon name="home" />
        전체
      </button>
      {parentId && (
        <button className="bc-up" title="상위로" onClick={() => setFocus(parentId)}>
          <Icon name="chevronUp" />
        </button>
      )}
      <span className="bc-label">이 노드만</span>
      <span className="bc-current" title={node.text}>
        {node.text?.trim() || '제목 없음'}
      </span>
    </div>
  );
}
