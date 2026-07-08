import { useEffect, useRef, useState } from 'react';
import { useUi } from '../store/uiStore';
import { useWorkspace } from '../store/workspaceStore';
import { CURRENT_VERSION } from './changelog';
import { Icon } from './Icon';

const basename = (p: string) => p.slice(p.lastIndexOf('/') + 1);

type Provider = 'claude' | 'openai';

interface ProviderState {
  masked: string | null;
  mode: 'view' | 'edit';
  input: string;
  error: string | null;
}

const CLAUDE_KEY_URL = 'https://console.anthropic.com/settings/api-keys';
const OPENAI_KEY_URL = 'https://platform.openai.com/api-keys';

function useAiProviders() {
  const [claude, setClaude] = useState<ProviderState>({ masked: null, mode: 'view', input: '', error: null });
  const [openai, setOpenai] = useState<ProviderState>({ masked: null, mode: 'view', input: '', error: null });
  const [active, setActiveState] = useState<Provider | null>(null);
  const toast = useUi((s) => s.toast);

  useEffect(() => {
    void (async () => {
      const [cm, om, act] = await Promise.all([
        window.api.ai.getMasked(),
        window.api.ai.getOpenAiMasked(),
        window.api.ai.getActive(),
      ]);
      setClaude((p) => ({ ...p, masked: cm }));
      setOpenai((p) => ({ ...p, masked: om }));
      if (act) setActiveState(act);
      else if (cm && !om) setActiveState('claude');
      else if (!cm && om) setActiveState('openai');
    })();
  }, []);

  const saveClaude = async () => {
    const key = claude.input.trim();
    if (!key.startsWith('sk-ant-') || key.length < 20) {
      setClaude((p) => ({ ...p, error: '올바른 Claude API 키를 입력해주세요.' }));
      return;
    }
    await window.api.ai.setKey(key);
    const masked = await window.api.ai.getMasked();
    setClaude({ masked, mode: 'view', input: '', error: null });
    if (!openai.masked) {
      await window.api.ai.setActive('claude');
      setActiveState('claude');
    }
    toast('Claude API 키가 저장됐습니다.');
  };

  const saveOpenai = async () => {
    const key = openai.input.trim();
    if (!key.startsWith('sk-') || key.length < 20) {
      setOpenai((p) => ({ ...p, error: '올바른 OpenAI API 키를 입력해주세요.' }));
      return;
    }
    await window.api.ai.setOpenAiKey(key);
    const masked = await window.api.ai.getOpenAiMasked();
    setOpenai({ masked, mode: 'view', input: '', error: null });
    if (!claude.masked) {
      await window.api.ai.setActive('openai');
      setActiveState('openai');
    }
    toast('OpenAI API 키가 저장됐습니다.');
  };

  const clearClaude = async () => {
    await window.api.ai.clearKey();
    const newActive = openai.masked ? 'openai' : null;
    setClaude({ masked: null, mode: 'view', input: '', error: null });
    setActiveState(newActive);
    if (newActive) await window.api.ai.setActive(newActive);
    toast('Claude API 키를 삭제했습니다.');
  };

  const clearOpenai = async () => {
    await window.api.ai.clearOpenAiKey();
    const newActive = claude.masked ? 'claude' : null;
    setOpenai({ masked: null, mode: 'view', input: '', error: null });
    setActiveState(newActive);
    if (newActive) await window.api.ai.setActive(newActive);
    toast('OpenAI API 키를 삭제했습니다.');
  };

  const switchActive = async (provider: Provider) => {
    await window.api.ai.setActive(provider);
    setActiveState(provider);
  };

  const editClaude = () => setClaude((p) => ({ ...p, mode: 'edit', input: '', error: null }));
  const editOpenai = () => setOpenai((p) => ({ ...p, mode: 'edit', input: '', error: null }));
  const cancelClaude = () => setClaude((p) => ({ ...p, mode: 'view', input: '', error: null }));
  const cancelOpenai = () => setOpenai((p) => ({ ...p, mode: 'view', input: '', error: null }));

  return {
    claude, setClaude, saveClaude, clearClaude, editClaude, cancelClaude,
    openai, setOpenai, saveOpenai, clearOpenai, editOpenai, cancelOpenai,
    active, switchActive,
  };
}

export function Settings() {
  const close = useUi((s) => s.closeSettings);
  const theme = useUi((s) => s.theme);
  const fontScale = useUi((s) => s.fontScale);
  const root = useWorkspace((s) => s.root);
  const choose = useWorkspace((s) => s.choose);
  const ai = useAiProviders();
  const claudeRef = useRef<HTMLInputElement>(null);
  const openaiRef = useRef<HTMLInputElement>(null);
  const bothSet = !!(ai.claude.masked && ai.openai.masked);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (ai.claude.mode === 'edit' && ai.claude.masked) { ai.cancelClaude(); e.stopPropagation(); return; }
      if (ai.openai.mode === 'edit' && ai.openai.masked) { ai.cancelOpenai(); e.stopPropagation(); return; }
      close();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [close, ai]);

  useEffect(() => { if (ai.claude.mode === 'edit') claudeRef.current?.focus(); }, [ai.claude.mode]);
  useEffect(() => { if (ai.openai.mode === 'edit') openaiRef.current?.focus(); }, [ai.openai.mode]);

  const openUrl = (url: string) => void window.api.shell.openExternal(url);

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
          {/* 테마 */}
          <div className="set-row">
            <span className="set-label">테마</span>
            <div className="seg">
              <button className={`seg-btn${theme === 'light' ? ' on' : ''}`} onClick={() => useUi.getState().setTheme('light')}>
                <Icon name="sun" /> 라이트
              </button>
              <button className={`seg-btn${theme === 'dark' ? ' on' : ''}`} onClick={() => useUi.getState().setTheme('dark')}>
                <Icon name="moon" /> 다크
              </button>
            </div>
          </div>

          {/* 글자 크기 */}
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

          {/* 워크스페이스 */}
          <div className="set-row">
            <span className="set-label">워크스페이스</span>
            <button className="set-folder" title="폴더 변경" onClick={() => void choose()}>
              <Icon name="folder" />
              <span className="set-folder-name">{root ? basename(root) : '폴더 선택'}</span>
              <span className="set-folder-act">변경</span>
            </button>
          </div>

          <div className="set-sep" />

          {/* AI 기능 */}
          <div className="set-ai-section">
            <div className="set-ai-header">
              <span className="set-label">AI 기능</span>
              {ai.active && (
                <span className="set-ai-badge">
                  <span className="set-ai-dot" />
                  {ai.active === 'claude' ? 'Claude' : 'GPT'} 활성
                </span>
              )}
            </div>

            <div className="set-ai-providers">
              {/* Claude */}
              <div className={`set-ai-provider${ai.active === 'claude' ? ' active' : ''}`}>
                {ai.claude.mode === 'edit' ? (
                  <div className="set-ai-edit">
                    <div className="set-ai-input-row">
                      <input
                        ref={claudeRef}
                        className={`set-ai-input${ai.claude.error ? ' error' : ''}`}
                        type="password"
                        placeholder="Claude API 키 붙여넣기"
                        value={ai.claude.input}
                        onChange={(e) => ai.setClaude((p) => ({ ...p, input: e.target.value }))}
                        onKeyDown={(e) => { if (e.key === 'Enter') void ai.saveClaude(); }}
                      />
                      <button className="set-ai-btn-primary" onClick={() => void ai.saveClaude()}>저장</button>
                      <button className="set-ai-btn-ghost" onClick={ai.cancelClaude}>취소</button>
                    </div>
                    {ai.claude.error && <p className="set-ai-error">{ai.claude.error}</p>}
                    <button className="set-ai-link-btn" onClick={() => openUrl(CLAUDE_KEY_URL)}>
                      Anthropic 콘솔에서 발급받기 →
                    </button>
                  </div>
                ) : (
                  <>
                    <div className="set-ai-provider-row">
                      <button
                        className={`set-ai-radio${ai.active === 'claude' ? ' on' : ''}${bothSet ? ' switchable' : ''}`}
                        title={bothSet ? 'Claude를 활성 모델로 선택' : undefined}
                        onClick={bothSet ? () => void ai.switchActive('claude') : undefined}
                      />
                      <span className="set-ai-provider-name">Claude</span>
                      {ai.claude.masked ? (
                        <>
                          <span className="set-ai-masked">{ai.claude.masked}</span>
                          <div className="set-ai-actions">
                            <button className="set-ai-btn-ghost sm" onClick={ai.editClaude}>수정</button>
                            <button className="set-ai-btn-ghost sm danger" onClick={() => void ai.clearClaude()}>삭제</button>
                          </div>
                        </>
                      ) : (
                        <>
                          <span className="set-ai-empty">연결 안 됨</span>
                          <button className="set-ai-btn-ghost sm" onClick={ai.editClaude}>연결</button>
                        </>
                      )}
                    </div>
                    {!ai.claude.masked && (
                      <button className="set-ai-link-btn" onClick={() => openUrl(CLAUDE_KEY_URL)}>
                        Anthropic 콘솔에서 발급받기 →
                      </button>
                    )}
                  </>
                )}
              </div>

              {/* OpenAI */}
              <div className={`set-ai-provider${ai.active === 'openai' ? ' active' : ''}`}>
                {ai.openai.mode === 'edit' ? (
                  <div className="set-ai-edit">
                    <div className="set-ai-input-row">
                      <input
                        ref={openaiRef}
                        className={`set-ai-input${ai.openai.error ? ' error' : ''}`}
                        type="password"
                        placeholder="OpenAI API 키 붙여넣기"
                        value={ai.openai.input}
                        onChange={(e) => ai.setOpenai((p) => ({ ...p, input: e.target.value }))}
                        onKeyDown={(e) => { if (e.key === 'Enter') void ai.saveOpenai(); }}
                      />
                      <button className="set-ai-btn-primary" onClick={() => void ai.saveOpenai()}>저장</button>
                      <button className="set-ai-btn-ghost" onClick={ai.cancelOpenai}>취소</button>
                    </div>
                    {ai.openai.error && <p className="set-ai-error">{ai.openai.error}</p>}
                    <button className="set-ai-link-btn" onClick={() => openUrl(OPENAI_KEY_URL)}>
                      OpenAI 플랫폼에서 발급받기 →
                    </button>
                  </div>
                ) : (
                  <>
                    <div className="set-ai-provider-row">
                      <button
                        className={`set-ai-radio${ai.active === 'openai' ? ' on' : ''}${bothSet ? ' switchable' : ''}`}
                        title={bothSet ? 'GPT를 활성 모델로 선택' : undefined}
                        onClick={bothSet ? () => void ai.switchActive('openai') : undefined}
                      />
                      <span className="set-ai-provider-name">GPT</span>
                      {ai.openai.masked ? (
                        <>
                          <span className="set-ai-masked">{ai.openai.masked}</span>
                          <div className="set-ai-actions">
                            <button className="set-ai-btn-ghost sm" onClick={ai.editOpenai}>수정</button>
                            <button className="set-ai-btn-ghost sm danger" onClick={() => void ai.clearOpenai()}>삭제</button>
                          </div>
                        </>
                      ) : (
                        <>
                          <span className="set-ai-empty">연결 안 됨</span>
                          <button className="set-ai-btn-ghost sm" onClick={ai.editOpenai}>연결</button>
                        </>
                      )}
                    </div>
                    {!ai.openai.masked && (
                      <button className="set-ai-link-btn" onClick={() => openUrl(OPENAI_KEY_URL)}>
                        OpenAI 플랫폼에서 발급받기 →
                      </button>
                    )}
                  </>
                )}
              </div>
            </div>
          </div>

          <div className="set-sep" />

          <button className="set-link" onClick={() => useUi.getState().openManual()}>
            <span className="set-link-main"><Icon name="memo" /> 사용 안내</span>
            <span className="set-link-sub">단축키 · 사용법</span>
            <Icon name="chevronRight" />
          </button>
          <button className="set-link" onClick={() => void window.api.checkForUpdates()}>
            <span className="set-link-main"><Icon name="download" /> 업데이트 확인</span>
            <span className="set-link-sub">v{CURRENT_VERSION}</span>
            <Icon name="chevronRight" />
          </button>
          <button className="set-link" onClick={() => useUi.getState().openUpdates()}>
            <span className="set-link-main"><Icon name="flag" /> 업데이트 내역</span>
            <Icon name="chevronRight" />
          </button>
        </div>
      </div>
    </div>
  );
}
