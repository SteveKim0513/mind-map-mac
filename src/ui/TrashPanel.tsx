import { useEffect, useState } from 'react';
import { useUi } from '../store/uiStore';
import { useTrash } from '../store/trashStore';
import { useWorkspace } from '../store/workspaceStore';
import { Icon } from './Icon';
import type { TrashItem } from '../../electron/preload';

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

const nameOf = (it: TrashItem) => it.name.replace(/\.(mind|md)$/, '');
const kindLabel = (it: TrashItem) =>
  it.type === 'dir' ? '폴더' : it.name.endsWith('.md') ? '노트' : '마인드맵';
const iconName = (it: TrashItem) =>
  it.type === 'dir' ? 'folder' : it.name.endsWith('.md') ? 'note' : 'file';

function originDir(it: TrashItem, root: string): string {
  const parent = it.originalPath.slice(0, it.originalPath.lastIndexOf('/'));
  if (parent === root) return '워크스페이스';
  return parent.startsWith(root + '/') ? parent.slice(root.length + 1) : parent;
}

export function TrashPanel() {
  const close = useUi((s) => s.closeTrash);
  const items = useTrash((s) => s.items);
  const refreshTrash = useTrash((s) => s.refresh);
  const root = useWorkspace((s) => s.root);
  const refreshTree = useWorkspace((s) => s.refresh);

  // IF-06 · trash retention toggle (auto-purge items older than N months)
  const [autoPurge, setAutoPurge] = useState(false); // default OFF (opt-in) — see main.ts IF-06
  const [retentionDays, setRetentionDays] = useState(90);
  const months = Math.max(1, Math.round(retentionDays / 30));

  useEffect(() => {
    void refreshTrash();
    void window.api.trashAutoPurgeGet().then(setAutoPurge);
    void window.api.trashRetentionDays().then(setRetentionDays);
  }, [refreshTrash]);

  const setPurge = async (v: boolean) => {
    setAutoPurge(v);
    await window.api.trashAutoPurgeSet(v);
    await refreshTrash(); // turning it on may sweep expired items right away
  };
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    window.addEventListener('keydown', k, true);
    return () => window.removeEventListener('keydown', k, true);
  }, [close]);

  const restore = async (it: TrashItem) => {
    await window.api.trashRestore(it.trashedPath);
    await Promise.all([refreshTrash(), refreshTree()]);
  };
  const deleteOne = async (it: TrashItem) => {
    const r = await window.api.message({
      message: `"${nameOf(it)}"을(를) 삭제할까요?`,
      detail: '시스템 휴지통으로 이동되며 앱에서 복원할 수 없습니다.',
      buttons: ['삭제', '취소'],
      cancelId: 1,
    });
    if (r !== 0) return;
    await window.api.trashDeleteOne(it.trashedPath);
    await refreshTrash();
  };
  const emptyAll = async () => {
    const r = await window.api.message({
      message: '휴지통을 비울까요?',
      detail: `${items.length}개 항목이 시스템 휴지통으로 이동하며, 앱에서는 더 이상 복원할 수 없습니다.`,
      buttons: ['휴지통 비우기', '취소'],
      cancelId: 1,
    });
    if (r !== 0) return;
    await window.api.trashEmpty();
    await refreshTrash();
  };

  return (
    <div className="wh-backdrop" onMouseDown={close}>
      <div className="trash-panel" onMouseDown={(e) => e.stopPropagation()}>
        <div className="wh-head">
          <Icon name="trash" />
          <span className="wh-title">휴지통</span>
          {items.length > 0 && <span className="today-summary">{items.length}개</span>}
          <button className="wh-close" title="닫기 (Esc)" onClick={close}>
            <Icon name="close" />
          </button>
        </div>

        <div className="trash-retention">
          <span className="trash-retention-label">
            {months}개월 지난 항목 자동 정리
            <small>{autoPurge ? `${months}개월이 지나면 시스템 휴지통으로 옮겨요` : '직접 비울 때까지 보관해요'}</small>
          </span>
          <div className="seg" role="group" aria-label="자동 정리">
            <button
              className={`seg-btn${autoPurge ? ' on' : ''}`}
              aria-pressed={autoPurge}
              onClick={() => void setPurge(true)}
            >
              켜짐
            </button>
            <button
              className={`seg-btn${!autoPurge ? ' on' : ''}`}
              aria-pressed={!autoPurge}
              onClick={() => void setPurge(false)}
            >
              꺼짐
            </button>
          </div>
        </div>

        {items.length === 0 ? (
          <div className="today-empty">
            휴지통이 비어 있어요.
            <br />
            사이드바에서 삭제한 파일이 여기로 들어옵니다.
          </div>
        ) : (
          <>
            <div className="trash-body">
              {items.map((it) => (
                <div className="trash-row" key={it.trashedPath}>
                  <span className={`trash-ic ${it.type}`}>
                    <Icon name={iconName(it)} />
                  </span>
                  <span className="trash-info">
                    <span className="trash-name">{nameOf(it)}</span>
                    <span className="trash-meta">
                      {kindLabel(it)} · {originDir(it, root)} · {relTime(it.deletedAt)}
                    </span>
                  </span>
                  <span className="trash-acts">
                    <button className="trash-act" onClick={() => void restore(it)}>
                      복원
                    </button>
                    <button
                      className="trash-act danger"
                      onClick={() => void deleteOne(it)}
                      title="삭제"
                    >
                      <Icon name="trash" />
                    </button>
                  </span>
                </div>
              ))}
            </div>
            <div className="trash-foot">
              <button className="trash-empty" onClick={() => void emptyAll()}>
                휴지통 비우기
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
