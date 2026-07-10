import { useEffect, useState } from 'react';
import { useUi } from '../store/uiStore';
import { useTemplates } from '../store/templateStore';
import { useWorkspace } from '../store/workspaceStore';
import { Icon } from './Icon';
import type { TemplateSummary } from '../../electron/preload';

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

export function TemplatePanel({ onOpen }: { onOpen: (path: string) => void }) {
  const close = useUi((s) => s.closeTemplates);
  const items = useTemplates((s) => s.items);
  const refresh = useTemplates((s) => s.refresh);
  const create = useTemplates((s) => s.create);
  const remove = useTemplates((s) => s.remove);
  const root = useWorkspace((s) => s.root);
  const [query, setQuery] = useState('');

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

  const filtered = items.filter((it) => it.title.toLowerCase().includes(query.trim().toLowerCase()));

  const newTemplate = async () => {
    const path = await create('제목 없음');
    close();
    onOpen(path);
  };
  const openOne = (it: TemplateSummary) => {
    close();
    onOpen(`${root}/.templates/${it.name}`);
  };
  const deleteOne = async (it: TemplateSummary) => {
    const r = await window.api.message({
      message: `"${it.title}" 템플릿을 삭제할까요?`,
      detail: '시스템 휴지통으로 이동됩니다.',
      buttons: ['삭제', '취소'],
      cancelId: 1,
    });
    if (r !== 0) return;
    await remove(it.name);
  };

  return (
    <div className="wh-backdrop" onMouseDown={close}>
      <div className="trash-panel" onMouseDown={(e) => e.stopPropagation()}>
        <div className="wh-head">
          <Icon name="template" />
          <span className="wh-title">Note Template</span>
          {items.length > 0 && <span className="today-summary">{items.length}개</span>}
          <button className="wh-close" title="닫기 (Esc)" onClick={close}>
            <Icon name="close" />
          </button>
        </div>

        <div className="qsearch-row">
          <Icon name="search" />
          <input
            placeholder="템플릿 검색..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoFocus
          />
        </div>

        {items.length === 0 ? (
          <div className="today-empty">
            아직 템플릿이 없어요.
            <br />
            자주 쓰는 노트 구조를 템플릿으로 만들어두면 편집기에서 "템플릿+"로 바로 불러올 수 있어요.
          </div>
        ) : filtered.length === 0 ? (
          <div className="today-empty">일치하는 템플릿이 없어요.</div>
        ) : (
          <div className="trash-body">
            {filtered.map((it) => (
              <div className="trash-row" key={it.name}>
                <span className="trash-ic file">
                  <Icon name="template" />
                </span>
                <span className="trash-info clickable" onClick={() => openOne(it)}>
                  <span className="trash-name">{it.title}</span>
                  <span className="trash-meta">{relTime(it.updatedAt)} 수정</span>
                </span>
                <span className="trash-acts">
                  <button className="trash-act" onClick={() => openOne(it)}>
                    열기
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
        )}

        <div className="trash-foot">
          <button className="trash-act" onClick={() => void newTemplate()}>
            <Icon name="plus" /> 새 템플릿
          </button>
        </div>
      </div>
    </div>
  );
}
