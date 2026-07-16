import { useEffect, useState } from 'react';
import { useUi } from '../store/uiStore';
import { useSession } from '../store/sessionStore';
import { useWorkspace } from '../store/workspaceStore';
import { Icon } from './Icon';
import type { VersionInfo } from '../../electron/preload';

function relTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return '방금';
  if (m < 60) return `${m}분 전`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}시간 전`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}일 전`;
  const dt = new Date(iso);
  return `${dt.getMonth() + 1}/${dt.getDate()}`;
}

function absTime(iso: string): string {
  const dt = new Date(iso);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${dt.getMonth() + 1}월 ${dt.getDate()}일 ${p(dt.getHours())}:${p(dt.getMinutes())}`;
}

const nameOf = (p: string) => (p.split('/').pop() ?? p).replace(/\.(mind|md)$/, '');

// IF-02 · Local version history — restore a map/note to an earlier saved point.
export function VersionHistoryPanel() {
  const close = useUi((s) => s.closeVersions);
  const filePath = useUi((s) => s.versionsPath);
  const toast = useUi((s) => s.toast);
  const reloadIfOpen = useSession((s) => s.reloadIfOpen);
  const refreshTree = useWorkspace((s) => s.refresh);

  const [versions, setVersions] = useState<VersionInfo[] | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!filePath) return;
    let alive = true;
    void window.api.history.list(filePath).then((v) => {
      if (alive) setVersions(v);
    });
    return () => {
      alive = false;
    };
  }, [filePath]);

  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    window.addEventListener('keydown', k, true);
    return () => window.removeEventListener('keydown', k, true);
  }, [close]);

  if (!filePath) return null;

  const restore = async (v: VersionInfo) => {
    const r = await window.api.message({
      message: `${absTime(v.savedAt)} 버전으로 되돌릴까요?`,
      detail: '지금 내용은 새 버전으로 히스토리에 남으니, 되돌린 뒤 다시 앞으로 올 수 있어요.',
      buttons: ['되돌리기', '취소'],
      cancelId: 1,
    });
    if (r !== 0) return;
    setBusy(true);
    try {
      await window.api.history.restore(filePath, v.stamp);
      await reloadIfOpen(filePath); // reflect it in the open tab (maps)
      await refreshTree();
      toast('이전 버전으로 되돌렸어요');
      close();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="wh-backdrop" onMouseDown={close}>
      <div className="trash-panel" onMouseDown={(e) => e.stopPropagation()}>
        <div className="wh-head">
          <Icon name="clock" />
          <span className="wh-title">이전 버전 · {nameOf(filePath)}</span>
          <button className="wh-close" title="닫기 (Esc)" onClick={close}>
            <Icon name="close" />
          </button>
        </div>

        {versions === null ? (
          <div className="today-empty">불러오는 중…</div>
        ) : versions.length === 0 ? (
          <div className="today-empty">
            아직 저장된 이전 버전이 없어요.
            <br />
            편집하며 저장될 때마다 여기에 시점별로 쌓입니다.
          </div>
        ) : (
          <div className="trash-body">
            {versions.map((v) => (
              <div className="trash-row" key={v.stamp}>
                <span className="trash-ic file">
                  <Icon name="clock" />
                </span>
                <span className="trash-info">
                  <span className="trash-name">{absTime(v.savedAt)}</span>
                  <span className="trash-meta">{relTime(v.savedAt)}</span>
                </span>
                <span className="trash-acts">
                  <button className="trash-act" disabled={busy} onClick={() => void restore(v)}>
                    되돌리기
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
