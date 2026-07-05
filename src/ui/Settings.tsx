import { useEffect, useRef, useState } from 'react';
import { useUi } from '../store/uiStore';
import { useWorkspace } from '../store/workspaceStore';
import { CURRENT_VERSION } from './changelog';
import { Icon } from './Icon';

const basename = (p: string) => p.slice(p.lastIndexOf('/') + 1);

function useAiKey() {
  const [masked, setMasked] = useState<string | null>(null);
  const [mode, setMode] = useState<'view' | 'edit'>('view');
  const [input, setInput] = useState('');
  const [error, setError] = useState<string | null>(null);
  const toast = useUi((s) => s.toast);

  useEffect(() => {
    window.api.ai.getMasked().then((m) => {
      setMasked(m);
      setMode(m ? 'view' : 'edit');
    });
  }, []);

  const save = async () => {
    const key = input.trim();
    if (!key.startsWith('sk-ant-') || key.length < 20) {
      setError('sk-ant- 로 시작하는 유효한 키를 입력해주세요.');
      return;
    }
    await window.api.ai.setKey(key);
    const m = await window.api.ai.getMasked();
    setMasked(m);
    setMode('view');
    setInput('');
    setError(null);
    toast('AI 기능이 활성화됐습니다.');
  };

  const clear = async () => {
    await window.api.ai.clearKey();
    setMasked(null);
    setMode('edit');
    setInput('');
    setError(null);
    toast('AI 기능을 비활성화했습니다.');
  };

  const startEdit = () => {
    setInput('');
    setError(null);
    setMode('edit');
  };

  const cancelEdit = () => {
    setError(null);
    setInput('');
    setMode('view');
  };

  return { masked, mode, input, setInput, error, save, clear, startEdit, cancelEdit };
}

/** Settings — real options only (theme, text size, workspace, version). Usage and
 *  shortcuts live behind "사용 안내" → the Manual. Opened from the sidebar gear / ⌘,. */
export function Settings() {
  const close = useUi((s) => s.closeSettings);
  const theme = useUi((s) => s.theme);
  const fontScale = useUi((s) => s.fontScale);
  const root = useWorkspace((s) => s.root);
  const choose = useWorkspace((s) => s.choose);
  const ai = useAiKey();
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (ai.mode === 'edit' && ai.masked) { ai.cancelEdit(); e.stopPropagation(); }
        else close();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [close, ai]);

  useEffect(() => {
    if (ai.mode === 'edit') inputRef.current?.focus();
  }, [ai.mode]);

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

          {/* AI 기능 섹션 */}
          <div className="set-ai-section">
            <div className="set-ai-header">
              <span className="set-label">AI 기능</span>
              {ai.masked && (
                <span className="set-ai-badge">
                  <span className="set-ai-dot" />
                  활성
                </span>
              )}
            </div>

            {ai.mode === 'view' && ai.masked ? (
              <div className="set-ai-view">
                <span className="set-ai-masked">{ai.masked}</span>
                <div className="set-ai-actions">
                  <button className="set-ai-btn-ghost" onClick={ai.startEdit}>수정</button>
                  <button className="set-ai-btn-ghost danger" onClick={ai.clear}>삭제</button>
                </div>
              </div>
            ) : (
              <div className="set-ai-edit">
                <div className="set-ai-input-row">
                  <input
                    ref={inputRef}
                    className={`set-ai-input${ai.error ? ' error' : ''}`}
                    type="password"
                    placeholder="sk-ant-api03-…"
                    value={ai.input}
                    onChange={(e) => { ai.setInput(e.target.value); }}
                    onKeyDown={(e) => { if (e.key === 'Enter') void ai.save(); }}
                  />
                  <button className="set-ai-btn-primary" onClick={() => void ai.save()}>저장</button>
                  {ai.masked && (
                    <button className="set-ai-btn-ghost" onClick={ai.cancelEdit}>취소</button>
                  )}
                </div>
                {ai.error && <p className="set-ai-error">{ai.error}</p>}
                {!ai.masked && (
                  <p className="set-ai-hint">
                    키가 없으면 AI 기능이 비활성화됩니다. console.anthropic.com에서 발급하세요.
                  </p>
                )}
              </div>
            )}
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

          <button className="set-link" onClick={() => void window.api.checkForUpdates()}>
            <span className="set-link-main">
              <Icon name="download" />
              업데이트 확인
            </span>
            <span className="set-link-sub">v{CURRENT_VERSION}</span>
            <Icon name="chevronRight" />
          </button>

          <button className="set-link" onClick={() => useUi.getState().openUpdates()}>
            <span className="set-link-main">
              <Icon name="flag" />
              업데이트 내역
            </span>
            <Icon name="chevronRight" />
          </button>
        </div>
      </div>
    </div>
  );
}
