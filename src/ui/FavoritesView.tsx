import { useEffect } from 'react';
import { useUi } from '../store/uiStore';
import { useWorkspace } from '../store/workspaceStore';
import { usePins } from '../store/pinStore';
import { Icon } from './Icon';

function dirLabel(filePath: string, root: string): string {
  const parent = filePath.slice(0, filePath.lastIndexOf('/'));
  if (parent === root) return '워크스페이스';
  return parent.startsWith(root + '/') ? parent.slice(root.length + 1) : parent;
}

export function FavoritesView({ onOpen }: { onOpen: (path: string) => void }) {
  const close = useUi((s) => s.closeFavorites);
  const root = useWorkspace((s) => s.root);
  const paths = usePins((s) => s.paths);
  const refresh = usePins((s) => s.refresh);
  const toggle = usePins((s) => s.toggle);

  useEffect(() => {
    void refresh();
  }, [refresh]);
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    window.addEventListener('keydown', k, true);
    return () => window.removeEventListener('keydown', k, true);
  }, [close]);

  const openOne = (p: string) => {
    close();
    onOpen(p);
  };

  return (
    <div className="wh-backdrop" onMouseDown={close}>
      <div className="trash-panel" onMouseDown={(e) => e.stopPropagation()}>
        <div className="wh-head">
          <Icon name="star" />
          <span className="wh-title">즐겨찾기</span>
          <button className="wh-close" title="닫기 (Esc)" onClick={close}>
            <Icon name="close" />
          </button>
        </div>

        {paths.length === 0 ? (
          <div className="today-empty">
            아직 즐겨찾기가 없어요.
            <br />
            사이드바에서 파일에 마우스를 올리면 별표로 추가할 수 있어요.
          </div>
        ) : (
          <div className="trash-body">
            {paths.map((p) => {
              const name = p.slice(p.lastIndexOf('/') + 1).replace(/\.(mind|md)$/, '');
              return (
                <div className="trash-row" key={p}>
                  <span className="trash-ic file">
                    <Icon name={p.endsWith('.md') ? 'note' : 'mindmap'} />
                  </span>
                  <span className="trash-info clickable" onClick={() => openOne(p)}>
                    <span className="trash-name">{name}</span>
                    <span className="trash-meta">{root ? dirLabel(p, root) : ''}</span>
                  </span>
                  <span className="trash-acts">
                    <button className="trash-act" onClick={() => openOne(p)}>
                      열기
                    </button>
                    <button className="trash-act" title="즐겨찾기 해제" onClick={() => void toggle(p)}>
                      <Icon name="star" />
                    </button>
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
