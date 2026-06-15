import { useEffect } from 'react';
import { useUi } from '../store/uiStore';
import { Icon } from './Icon';
import { renderMarkdown } from '../note/markdown';
import { RELEASES } from './changelog';

/** Full release history — opened from settings. */
export function UpdatesOverlay() {
  const close = useUi((s) => s.closeUpdates);
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    window.addEventListener('keydown', k, true);
    return () => window.removeEventListener('keydown', k, true);
  }, [close]);

  return (
    <div className="wh-backdrop" onMouseDown={close}>
      <div className="upd" onMouseDown={(e) => e.stopPropagation()}>
        <div className="wh-head">
          <span className="wh-title">업데이트 내역</span>
          <button className="wh-close" title="닫기 (Esc)" onClick={close}><Icon name="close" /></button>
        </div>
        <div className="upd-body">
          {RELEASES.length === 0 ? (
            <div className="wh-empty">기록이 없어요.</div>
          ) : (
            RELEASES.map((r) => (
              <div className="upd-rel" key={r.version}>
                <div className="upd-rel-head">
                  <span className="upd-ver">v{r.version}</span>
                  <span className="upd-date">{r.date}</span>
                </div>
                <div className="upd-md">{renderMarkdown(r.body)}</div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

/** One-time card after an auto-update lands on a newer version. */
export function WhatsNewCard() {
  const version = useUi((s) => s.whatsNew)!;
  const close = () => useUi.getState().setWhatsNew(null);
  const openAll = () => { close(); useUi.getState().openUpdates(); };
  const rel = RELEASES.find((r) => r.version === version);

  return (
    <div className="focus-done-backdrop" onMouseDown={close}>
      <div className="whatsnew" onMouseDown={(e) => e.stopPropagation()}>
        <div className="whatsnew-head">
          <span className="whatsnew-spark">✨</span>
          <div>
            <div className="whatsnew-title">업데이트됨 · v{version}</div>
            <div className="whatsnew-sub">새로운 점</div>
          </div>
        </div>
        <div className="whatsnew-md">{rel ? renderMarkdown(rel.body) : '바뀐 점을 불러올 수 없어요.'}</div>
        <div className="whatsnew-actions">
          <button className="whatsnew-all" onClick={openAll}>전체 내역</button>
          <button className="whatsnew-ok" onClick={close}>확인</button>
        </div>
      </div>
    </div>
  );
}
