import { useEffect } from 'react';
import { useUi } from '../store/uiStore';
import { useWorkspace } from '../store/workspaceStore';
import { CURRENT_VERSION } from './changelog';
import { Icon } from './Icon';

const basename = (p: string) => p.slice(p.lastIndexOf('/') + 1);

/** Settings — real options only (theme, text size, workspace, version). Usage and
 *  shortcuts live behind "사용 안내" → the Manual. Opened from the sidebar gear / ⌘,. */
export function Settings() {
  const close = useUi((s) => s.closeSettings);
  const theme = useUi((s) => s.theme);
  const fontScale = useUi((s) => s.fontScale);
  const root = useWorkspace((s) => s.root);
  const choose = useWorkspace((s) => s.choose);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [close]);

  return (
    <div className="wh-backdrop" onMouseDown={close}>
      <div className="settings" onMouseDown={(e) => e.stopPropagation()}>
        <div className="settings-head">
          <span className="settings-title">설정</span>
          <button className="wh-close" title="닫기 (Esc)" onClick={close}>
            <Icon name="close" />
          </button>
        </div>

        <div className="settings-body">
          <div className="set-row">
            <span className="set-label">테마</span>
            <div className="seg">
              <button className={`seg-btn${theme === 'light' ? ' on' : ''}`} onClick={() => useUi.getState().setTheme('light')}>
                <Icon name="sun" />
                라이트
              </button>
              <button className={`seg-btn${theme === 'dark' ? ' on' : ''}`} onClick={() => useUi.getState().setTheme('dark')}>
                <Icon name="moon" />
                다크
              </button>
            </div>
          </div>

          <div className="set-row">
            <span className="set-label">글자 크기</span>
            <div className="fs-stepper">
              <button className="fs-btn" title="작게" onClick={() => useUi.getState().setFontScale(fontScale - 0.1)}>
                <span className="fs-a sm">A</span>
              </button>
              <span className="fs-val">{Math.round(fontScale * 100)}%</span>
              <button className="fs-btn" title="크게" onClick={() => useUi.getState().setFontScale(fontScale + 0.1)}>
                <span className="fs-a lg">A</span>
              </button>
            </div>
          </div>

          <div className="set-row">
            <span className="set-label">워크스페이스</span>
            <button className="set-folder" title="폴더 변경" onClick={() => void choose()}>
              <Icon name="folder" />
              <span className="set-folder-name">{root ? basename(root) : '폴더 선택'}</span>
              <span className="set-folder-act">변경</span>
            </button>
          </div>

          <div className="set-sep" />

          <button className="set-link" onClick={() => useUi.getState().openManual()}>
            <span className="set-link-main">
              <Icon name="memo" />
              사용 안내
            </span>
            <span className="set-link-sub">단축키 · 사용법</span>
            <Icon name="chevronRight" />
          </button>

          <button className="set-link" onClick={() => useUi.getState().openUpdates()}>
            <span className="set-link-main">
              <Icon name="flag" />
              업데이트 내역
            </span>
            <span className="set-link-sub">v{CURRENT_VERSION}</span>
            <Icon name="chevronRight" />
          </button>
        </div>
      </div>
    </div>
  );
}
