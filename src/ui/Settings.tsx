import { useEffect, useRef, useState, Fragment } from 'react';
import { useUi } from '../store/uiStore';
import { useWorkspace } from '../store/workspaceStore';
import { useMetaStore } from '../store/metaStore';
import { CURRENT_VERSION } from './changelog';
import { Icon } from './Icon';
import type { MetaTemplate, MetaFieldDef, MetaFieldType } from '../types';

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

          <div className="set-sep" />
          <MetaTemplatesSection />
        </div>
      </div>
    </div>
  );
}

function MetaTemplatesSection() {
  const { templates, loaded, load, addTemplate, updateTemplate, removeTemplate } = useMetaStore();
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<MetaTemplate | null>(null);

  useEffect(() => { if (!loaded) void load(); }, [loaded, load]);

  const newId = () => Math.random().toString(36).slice(2, 10);

  if (editing) {
    return (
      <TemplateEditor
        template={editing}
        onSave={async (t) => { await updateTemplate(t); setEditing(null); }}
        onCancel={() => setEditing(null)}
      />
    );
  }
  if (creating) {
    const blank: MetaTemplate = { id: newId(), name: '', fields: [] };
    return (
      <TemplateEditor
        template={blank}
        onSave={async (t) => { await addTemplate(t); setCreating(false); }}
        onCancel={() => setCreating(false)}
      />
    );
  }

  return (
    <div className="set-section">
      <div className="set-section-head">
        <span className="set-section-label">메타 템플릿</span>
        <button className="set-mini-btn" onClick={() => setCreating(true)}>+ 새 템플릿</button>
      </div>
      {templates.length === 0 ? (
        <p className="set-empty">템플릿이 없습니다. 노트 속성을 구조화하려면 새 템플릿을 만드세요.</p>
      ) : (
        <div className="set-meta-list">
          {templates.map((t) => (
            <div key={t.id} className="set-meta-item">
              <span className="set-meta-name">{t.name}</span>
              <span className="set-meta-count">{t.fields.length}개 필드</span>
              <button className="set-meta-edit" onClick={() => setEditing(t)}>편집</button>
              <button className="set-meta-del" onClick={() => void removeTemplate(t.id)}>삭제</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function OptionsInput({ options, onChange }: { options: string[]; onChange: (opts: string[]) => void }) {
  const [text, setText] = useState(() => options.join(', '));

  const commit = () => {
    const parsed = text.split(',').map((s) => s.trim()).filter(Boolean);
    onChange(parsed);
    setText(parsed.join(', '));
  };

  return (
    <div className="tmpl-field-opts">
      <span className="tmpl-opts-label">옵션 (쉼표로 구분)</span>
      <input
        className="tmpl-opts-input"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        placeholder="예: 읽는 중, 완료, 보류"
      />
    </div>
  );
}

function TemplateEditor({
  template,
  onSave,
  onCancel,
}: {
  template: MetaTemplate;
  onSave: (t: MetaTemplate) => Promise<void>;
  onCancel: () => void;
}) {
  const [name, setName] = useState(template.name);
  const [fields, setFields] = useState(template.fields);
  const newId = () => Math.random().toString(36).slice(2, 10);

  const addField = () =>
    setFields((f) => [...f, { key: newId(), label: '', type: 'text' as MetaFieldType }]);

  const updateField = (idx: number, patch: Partial<MetaFieldDef>) =>
    setFields((f) => f.map((x, i) => {
      if (i !== idx) return x;
      const updated = { ...x, ...patch };
      if (patch.type !== undefined && patch.type !== 'select') delete updated.options;
      if (patch.type === 'select' && updated.options === undefined) updated.options = [];
      return updated;
    }));

  const removeField = (idx: number) =>
    setFields((f) => f.filter((_, i) => i !== idx));

  return (
    <div className="tmpl-editor">
      <div className="tmpl-name-row">
        <span className="tmpl-name-label">템플릿 이름</span>
        <input
          className="tmpl-name-input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="예: 책 리뷰, 회의록…"
          autoFocus
        />
      </div>
      <div className="tmpl-fields-label">필드</div>
      {fields.map((f, i) => (
        <Fragment key={f.key}>
          <div className="tmpl-field-row">
            <input
              className="tmpl-field-label"
              value={f.label}
              onChange={(e) => updateField(i, { label: e.target.value })}
              placeholder="필드 이름"
            />
            <select
              className="tmpl-field-type"
              value={f.type}
              onChange={(e) => updateField(i, { type: e.target.value as MetaFieldType })}
            >
              <option value="text">텍스트</option>
              <option value="date">날짜</option>
              <option value="number">숫자</option>
              <option value="url">URL</option>
              <option value="select">선택</option>
            </select>
            <button className="tmpl-field-del" onClick={() => removeField(i)}>×</button>
          </div>
          {f.type === 'select' && (
            <OptionsInput
              options={f.options ?? []}
              onChange={(opts) => updateField(i, { options: opts })}
            />
          )}
        </Fragment>
      ))}
      <button className="tmpl-add-field" onClick={addField}>+ 필드 추가</button>
      <div className="tmpl-actions">
        <button className="tmpl-cancel" onClick={onCancel}>취소</button>
        <button
          className="tmpl-save"
          disabled={!name.trim()}
          title={!name.trim() ? '템플릿 이름을 입력하세요' : undefined}
          onClick={() => void onSave({ ...template, name: name.trim(), fields: fields.filter(f => f.label.trim()) })}
        >저장</button>
      </div>
    </div>
  );
}
