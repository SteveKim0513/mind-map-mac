import { useEffect, useRef, useState, Fragment } from 'react';
import { useUi } from '../store/uiStore';
import { useWorkspace } from '../store/workspaceStore';
import { useMetaStore } from '../store/metaStore';
import { useTemplates } from '../store/templateStore';
import { CURRENT_VERSION, RELEASES } from './changelog';
import { Icon } from './Icon';
import { renderMarkdown } from '../note/markdown';
import type { MetaTemplate, MetaFieldDef, MetaFieldType } from '../types';

const basename = (p: string) => p.slice(p.lastIndexOf('/') + 1);

type Provider = 'claude' | 'openai';
type SettingsView = 'main' | 'ai' | 'meta' | 'updates';

interface ProviderState {
  masked: string | null;
  mode: 'view' | 'edit';
  input: string;
  error: string | null;
}

const CLAUDE_KEY_URL = 'https://console.anthropic.com/settings/api-keys';
const OPENAI_KEY_URL = 'https://platform.openai.com/api-keys';

const VIEW_TITLE: Record<SettingsView, string> = {
  main: '설정',
  ai: 'AI 기능',
  meta: '정보 양식',
  updates: '업데이트 내역',
};

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
  const [view, setView] = useState<SettingsView>('main');
  const close = useUi((s) => s.closeSettings);
  const theme = useUi((s) => s.theme);
  const fontScale = useUi((s) => s.fontScale);
  const root = useWorkspace((s) => s.root);
  const choose = useWorkspace((s) => s.choose);
  const ai = useAiProviders();
  const claudeRef = useRef<HTMLInputElement>(null) as React.RefObject<HTMLInputElement>;
  const openaiRef = useRef<HTMLInputElement>(null) as React.RefObject<HTMLInputElement>;
  const bothSet = !!(ai.claude.masked && ai.openai.masked);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (view === 'ai') {
        if (ai.claude.mode === 'edit' && ai.claude.masked) { ai.cancelClaude(); e.stopPropagation(); return; }
        if (ai.openai.mode === 'edit' && ai.openai.masked) { ai.cancelOpenai(); e.stopPropagation(); return; }
        setView('main'); e.stopPropagation(); return;
      }
      if (view !== 'main') { setView('main'); e.stopPropagation(); return; }
      close();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [close, ai, view]);

  useEffect(() => { if (ai.claude.mode === 'edit') claudeRef.current?.focus(); }, [ai.claude.mode]);
  useEffect(() => { if (ai.openai.mode === 'edit') openaiRef.current?.focus(); }, [ai.openai.mode]);

  return (
    <div className="wh-backdrop" onMouseDown={close}>
      <div className="settings" onMouseDown={(e) => e.stopPropagation()}>
        <div className="settings-head">
          {view !== 'main' && (
            <button className="set-back-btn" onClick={() => setView('main')} title="뒤로 (Esc)">
              <Icon name="chevronLeft" />
            </button>
          )}
          <span className="settings-title">{VIEW_TITLE[view]}</span>
          <button className="wh-close" title="닫기 (Esc)" onClick={close}>
            <Icon name="close" />
          </button>
        </div>

        <div className="settings-body">
          {view === 'main' && (
            <MainView
              theme={theme}
              fontScale={fontScale}
              root={root}
              choose={choose}
              ai={ai}
              navigate={setView}
            />
          )}
          {view === 'ai' && (
            <AiView
              ai={ai}
              claudeRef={claudeRef}
              openaiRef={openaiRef}
              bothSet={bothSet}
            />
          )}
          {view === 'meta' && <MetaView />}
          {view === 'updates' && <UpdatesView />}
        </div>
      </div>
    </div>
  );
}

function MainView({
  theme, fontScale, root, choose, ai, navigate,
}: {
  theme: string;
  fontScale: number;
  root: string | null;
  choose: () => Promise<void>;
  ai: ReturnType<typeof useAiProviders>;
  navigate: (v: SettingsView) => void;
}) {
  const { templates } = useMetaStore();
  const templatesEnabled = useTemplates((s) => s.enabled);
  const setTemplatesEnabled = useTemplates((s) => s.setEnabled);
  // 자주 안 만지는 항목은 기본으로 접어둔다(macOS 인쇄 대화상자의 "옵션 더 보기"와 같은 패턴) —
  // REDESIGN-VISION §3-4. 안 없앤다, 접을 뿐 — AI 기능은 여기 그대로 있다.
  const [advancedOpen, setAdvancedOpen] = useState(false);

  return (
    <>
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

      <div className="set-row">
        <div>
          <span className="set-label">노트 템플릿</span>
          <p className="set-desc">사이드바에 템플릿 폴더 표시, 편집기에 템플릿+ 버튼 표시</p>
        </div>
        <div className="seg">
          <button
            className={`seg-btn${templatesEnabled ? ' on' : ''}`}
            onClick={() => void setTemplatesEnabled(true)}
          >
            켜짐
          </button>
          <button
            className={`seg-btn${!templatesEnabled ? ' on' : ''}`}
            onClick={() => void setTemplatesEnabled(false)}
          >
            꺼짐
          </button>
        </div>
      </div>

      <button
        className="set-advanced-toggle"
        onClick={() => setAdvancedOpen((o) => !o)}
        aria-expanded={advancedOpen}
      >
        <Icon name={advancedOpen ? 'chevronDown' : 'chevronRight'} />
        고급 설정 {advancedOpen ? '숨기기' : '보기'}
      </button>

      {advancedOpen && (
        <>
          <div className="set-sep" />

          <button className="set-link" onClick={() => navigate('ai')}>
            <span className="set-link-main"><Icon name="bulb" /> AI 기능</span>
            {ai.active
              ? <span className="set-link-sub">{ai.active === 'claude' ? 'Claude' : 'GPT'} 활성</span>
              : <span className="set-link-sub">미연결</span>}
            <Icon name="chevronRight" />
          </button>

          <button className="set-link" onClick={() => navigate('meta')}>
            <span className="set-link-main"><Icon name="table" /> 정보 양식</span>
            {templates.length > 0 && <span className="set-link-sub">{templates.length}개</span>}
            <Icon name="chevronRight" />
          </button>

          <CaptureStatusRow />

          <div className="set-sep" />

          <button
            className="set-link"
            onClick={() => {
              useUi.getState().closeSettings();
              useUi.getState().openRecent();
            }}
          >
            <span className="set-link-main"><Icon name="clock" /> 최근 수정</span>
            <Icon name="chevronRight" />
          </button>
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
          <button className="set-link" onClick={() => navigate('updates')}>
            <span className="set-link-main"><Icon name="flag" /> 업데이트 내역</span>
            <Icon name="chevronRight" />
          </button>
        </>
      )}
    </>
  );
}

/** Global quick-capture (⌥Space) has no toggle in v1 — just a quiet status
 *  line so a shortcut conflict with another app is at least discoverable. */
function CaptureStatusRow() {
  const [status, setStatus] = useState<{ registered: boolean; accelerator: string } | null>(null);
  useEffect(() => {
    void window.api.capture.status().then(setStatus);
  }, []);
  if (!status) return null;
  return (
    <div className="set-row">
      <div>
        <span className="set-label">전역 캡처</span>
        <p className="set-desc">
          {status.registered
            ? `${status.accelerator} — 어디서든 빠르게 생각을 적어요`
            : `${status.accelerator}를 다른 앱이 사용 중이라 꺼져 있어요`}
        </p>
      </div>
    </div>
  );
}

function AiView({
  ai, claudeRef, openaiRef, bothSet,
}: {
  ai: ReturnType<typeof useAiProviders>;
  claudeRef: React.RefObject<HTMLInputElement>;
  openaiRef: React.RefObject<HTMLInputElement>;
  bothSet: boolean;
}) {
  const openUrl = (url: string) => void window.api.shell.openExternal(url);

  return (
    <div className="set-ai-section">
      <div className="set-ai-header">
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
                  title={bothSet ? 'Claude를 활성 모델로 선택' : ai.active === 'claude' ? '현재 활성 모델' : '비활성 모델'}
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
                  title={bothSet ? 'GPT를 활성 모델로 선택' : ai.active === 'openai' ? '현재 활성 모델' : '비활성 모델'}
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
  );
}

function MetaView() {
  const { templates, loaded, load, addTemplate, updateTemplate, removeTemplate } = useMetaStore();
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<MetaTemplate | null>(null);

  useEffect(() => { if (!loaded) void load(); }, [loaded, load]);

  const newId = () => Math.random().toString(36).slice(2, 10);

  // removeTemplate cascades: it strips this template's block out of EVERY note
  // that uses it, across the whole workspace, with no undo — confirm first
  // (per UX-CLARITY-VISION §전략 H, every irreversible multi-file action needs
  // either a confirm or an undo; this one can't offer undo, so it gets a confirm).
  const deleteTemplate = async (t: MetaTemplate) => {
    const r = await window.api.message({
      message: `"${t.name}" 양식을 삭제할까요?`,
      detail: '이 양식을 쓰는 모든 노트에서 해당 항목이 함께 사라지며, 되돌릴 수 없습니다.',
      buttons: ['삭제', '취소'],
      cancelId: 1,
    });
    if (r !== 0) return;
    await removeTemplate(t.id);
  };

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
    <div className="set-meta-view">
      <div className="set-meta-view-head">
        <button className="set-mini-btn" onClick={() => setCreating(true)}>+ 새 양식</button>
      </div>
      {templates.length === 0 ? (
        <p className="set-empty">양식이 없습니다. 노트 속성을 구조화하려면 새 양식을 만드세요.</p>
      ) : (
        <div className="set-meta-list">
          {templates.map((t) => (
            <div key={t.id} className="set-meta-item">
              <span className="set-meta-name">{t.name}</span>
              <span className="set-meta-count">{t.fields.length}개 필드</span>
              <button className="set-meta-edit" onClick={() => setEditing(t)}>편집</button>
              <button className="set-meta-del" onClick={() => void deleteTemplate(t)}>삭제</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function UpdatesView() {
  return (
    <div className="set-updates-view">
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
        <span className="tmpl-name-label">양식 이름</span>
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
          title={!name.trim() ? '양식 이름을 입력하세요' : undefined}
          onClick={() => void onSave({ ...template, name: name.trim(), fields: fields.filter(f => f.label.trim()) })}
        >저장</button>
      </div>
    </div>
  );
}
