import { useEffect } from 'react';
import { useUi } from '../store/uiStore';
import { useWorkspace } from '../store/workspaceStore';
import { recentFiles } from '../sidebar/smartViews';
import { Icon } from './Icon';

function relTime(ms: number): string {
  const diff = Date.now() - ms;
  const m = Math.floor(diff / 60000);
  if (m < 1) return '방금';
  if (m < 60) return `${m}분 전`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}시간 전`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}일 전`;
  const dt = new Date(ms);
  return `${dt.getMonth() + 1}/${dt.getDate()}`;
}

function dirLabel(filePath: string, root: string): string {
  const parent = filePath.slice(0, filePath.lastIndexOf('/'));
  if (parent === root) return '워크스페이스';
  return parent.startsWith(root + '/') ? parent.slice(root.length + 1) : parent;
}

export function RecentView({ onOpen }: { onOpen: (path: string) => void }) {
  const close = useUi((s) => s.closeRecent);
  const root = useWorkspace((s) => s.root);
  const tree = useWorkspace((s) => s.tree);
  const items = recentFiles(tree);

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
          <Icon name="clock" />
          <span className="wh-title">최근 수정</span>
          <button className="wh-close" title="닫기 (Esc)" onClick={close}>
            <Icon name="close" />
          </button>
        </div>

        {items.length === 0 ? (
          <div className="today-empty">아직 수정한 파일이 없어요.</div>
        ) : (
          <div className="trash-body">
            {items.map((it) => (
              <div className="trash-row" key={it.path}>
                <span className="trash-ic file">
                  <Icon name={it.name.endsWith('.md') ? 'note' : 'mindmap'} />
                </span>
                <span className="trash-info clickable" onClick={() => openOne(it.path)}>
                  <span className="trash-name">{it.name.replace(/\.(mind|md)$/, '')}</span>
                  <span className="trash-meta">
                    {relTime(it.mtimeMs)} · {root ? dirLabel(it.path, root) : ''}
                  </span>
                </span>
                <span className="trash-acts">
                  <button className="trash-act" onClick={() => openOne(it.path)}>
                    열기
                  </button>
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
