import { useEffect, useId, useMemo, useRef, useState, type ReactNode, type Ref } from 'react';
import { parseDisplayName } from '../io/shareFormat';
import {
  createSharedFolder,
  joinSharedFolder,
  listShareableFolders,
  pathBasename,
  shareBlockMessage,
  shareBlockReason,
  shareErrorMessage,
} from '../share';
import { useShare } from '../store/shareStore';
import { useUi } from '../store/uiStore';
import { useWorkspace } from '../store/workspaceStore';
import { Icon } from './Icon';
import { useFocusTrap } from './useFocusTrap';
import { useOverlayEsc } from './useOverlayEsc';

// 마지막으로 쓴 표시 이름을 기억한다 — localStorage는 막히거나 비어 있을 수 있으니 항상 try/catch.
const NAME_KEY = 'shareDisplayName';
function readName(): string {
  try {
    return localStorage.getItem(NAME_KEY) ?? '';
  } catch {
    return '';
  }
}
function rememberName(name: string): void {
  try {
    localStorage.setItem(NAME_KEY, name);
  } catch {
    /* 기억하지 못해도 동작에는 영향 없다 */
  }
}

const NAME_INVALID = '이름에 사용할 수 없는 글자가 있어요.';

/** 공유 폴더 만들기·참가 다이얼로그. 열려 있는 종류(`shareDialog`)에 따라 하나만 그린다. */
export function ShareDialog() {
  const dialog = useUi((s) => s.shareDialog);
  if (!dialog) return null;
  return dialog.kind === 'join' ? <JoinDialog /> : <CreateDialog folderPath={dialog.folderPath} />;
}

function DialogShell({
  title,
  titleId,
  busy,
  children,
}: {
  title: string;
  titleId: string;
  busy: boolean;
  children: ReactNode;
}) {
  const close = useUi((s) => s.closeShareDialog);
  const stackIndex = useUi((s) => s.overlayStack.indexOf('shareDialog'));
  const ref = useRef<HTMLDivElement>(null);
  useOverlayEsc('shareDialog', () => {
    if (!busy) close();
  });
  useFocusTrap(ref);
  return (
    <div
      className="wh-backdrop"
      style={{ zIndex: 88 + Math.max(0, stackIndex) }}
      onMouseDown={() => {
        if (!busy) close();
      }}
    >
      <div
        ref={ref}
        className="share-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="share-dialog-head">
          <Icon name="users" />
          <h2 id={titleId} className="share-dialog-title">
            {title}
          </h2>
        </div>
        {children}
      </div>
    </div>
  );
}

/** 표시 이름 입력 — 두 다이얼로그가 같은 모양·문구를 쓴다. */
function NameField({
  value,
  onChange,
  disabled,
  invalid,
  inputRef,
}: {
  value: string;
  onChange: (v: string) => void;
  disabled: boolean;
  invalid: boolean;
  inputRef?: Ref<HTMLInputElement>;
}) {
  const id = useId();
  return (
    <div className="share-field">
      <label className="share-label" htmlFor={id}>
        내 이름
      </label>
      <input
        id={id}
        ref={inputRef}
        className={`share-input${invalid ? ' invalid' : ''}`}
        data-testid="share-name-input"
        value={value}
        maxLength={40}
        placeholder="다른 참가자에게 보일 이름"
        autoComplete="off"
        spellCheck={false}
        disabled={disabled}
        aria-invalid={invalid}
        aria-describedby={invalid ? `${id}-err` : undefined}
        onChange={(e) => onChange(e.target.value)}
      />
      {invalid && (
        <p id={`${id}-err`} className="share-error" role="alert">
          {NAME_INVALID}
        </p>
      )}
    </div>
  );
}

// ── 만들기 ───────────────────────────────────────────────────────────────────

function CreateDialog({ folderPath }: { folderPath: string | null }) {
  const close = useUi((s) => s.closeShareDialog);
  const root = useWorkspace((s) => s.root);
  const tree = useWorkspace((s) => s.tree);
  const rooms = useShare((s) => s.rooms);
  const [name, setName] = useState(readName);
  const [picked, setPicked] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const titleId = useId();
  const folderId = useId();
  const nameRef = useRef<HTMLInputElement>(null);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  // 폴더를 미리 정하지 않았다면(명령 팔레트) 공유할 수 있는 폴더 중에서 고른다.
  const folders = useMemo(
    () => (folderPath ? [] : listShareableFolders(tree, root, rooms)),
    [folderPath, tree, root, rooms],
  );
  const target = folderPath ?? (picked || folders[0]?.path || null);
  const blocked = folderPath ? shareBlockReason(folderPath, root, rooms) : null;
  const nameInvalid = name.trim() !== '' && !parseDisplayName(name);
  const canSubmit = !!target && !blocked && parseDisplayName(name) !== null && !busy;

  useEffect(() => {
    nameRef.current?.focus();
  }, []);

  const submit = async () => {
    if (!canSubmit || !target) return;
    const ownerName = parseDisplayName(name);
    if (!ownerName) return;
    setBusy(true);
    setError(null);
    const res = await createSharedFolder({ folderPath: target, ownerName });
    if (!alive.current) return;
    if (!res.ok) {
      setBusy(false);
      setError(shareErrorMessage(res.error));
      return;
    }
    rememberName(ownerName);
    const ui = useUi.getState();
    ui.closeShareDialog();
    // 초대 코드 화면으로 — 방금 만든 코드를 패널에 넘긴다(서버는 코드를 다시 알려주지 못한다).
    ui.openShare(res.roomId, { code: res.invite.inviteCode, expiresAt: res.invite.inviteExpiresAt });
  };

  return (
    <DialogShell title="공유 폴더로 만들기" titleId={titleId} busy={busy}>
      {blocked ? (
        <>
          <div className="share-dialog-body">
            <p className="share-error share-error--block" role="alert" data-testid="share-block-reason">
              {shareBlockMessage(blocked)}
            </p>
          </div>
          <div className="share-actions">
            <button type="button" className="share-btn primary" onClick={close} autoFocus>
              닫기
            </button>
          </div>
        </>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <div className="share-dialog-body">
            <div className="share-field">
              <span className="share-label" id={folderId}>
                공유할 폴더
              </span>
              {folderPath ? (
                <div className="share-folder" aria-labelledby={folderId}>
                  <Icon name="folder" />
                  <span className="share-folder-name">{pathBasename(folderPath)}</span>
                </div>
              ) : folders.length > 0 ? (
                <select
                  className="share-input"
                  aria-labelledby={folderId}
                  value={target ?? ''}
                  disabled={busy}
                  onChange={(e) => setPicked(e.target.value)}
                >
                  {folders.map((f) => (
                    <option key={f.path} value={f.path}>
                      {f.label}
                    </option>
                  ))}
                </select>
              ) : (
                <p className="share-hint">공유할 수 있는 폴더가 없어요. 사이드바에서 폴더를 먼저 만들어 주세요.</p>
              )}
              <p className="share-hint">이 폴더 안의 파일이, 초대 코드를 받은 사람과 공유돼요.</p>
            </div>
            <NameField value={name} onChange={setName} disabled={busy} invalid={nameInvalid} inputRef={nameRef} />
            {error && (
              <p className="share-error" role="alert" data-testid="share-error">
                {error}
              </p>
            )}
          </div>
          <div className="share-actions">
            <button type="button" className="share-btn" onClick={close} disabled={busy}>
              취소
            </button>
            <button type="submit" className="share-btn primary" disabled={!canSubmit} data-testid="share-create-submit">
              {busy ? '만드는 중…' : '만들기'}
            </button>
          </div>
        </form>
      )}
    </DialogShell>
  );
}

// ── 참가 ─────────────────────────────────────────────────────────────────────

/** 코드 자체가 원인인 오류는 코드 입력칸 아래에, 그 밖의 오류는 폼 아래에 보인다. */
const CODE_ERRORS = new Set(['invalid_code', 'expired', 'not_found']);

function JoinDialog() {
  const close = useUi((s) => s.closeShareDialog);
  const [code, setCode] = useState('');
  const [name, setName] = useState(readName);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ field: 'code' | 'form'; msg: string } | null>(null);
  const titleId = useId();
  const codeId = useId();
  const codeRef = useRef<HTMLInputElement>(null);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    codeRef.current?.focus();
    return () => {
      alive.current = false;
    };
  }, []);

  const nameInvalid = name.trim() !== '' && !parseDisplayName(name);
  const canSubmit = code.trim() !== '' && parseDisplayName(name) !== null && !busy;

  const submit = async () => {
    if (!canSubmit) return;
    const displayName = parseDisplayName(name);
    if (!displayName) return;
    setBusy(true);
    setError(null);
    const res = await joinSharedFolder({ code, displayName });
    if (!alive.current) return;
    if (!res.ok) {
      setBusy(false);
      setError({ field: CODE_ERRORS.has(res.error) ? 'code' : 'form', msg: shareErrorMessage(res.error) });
      return;
    }
    rememberName(displayName);
    const ui = useUi.getState();
    ui.closeShareDialog();
    ui.toast(`"${res.folderName}" 공유 폴더에 참가했어요`);
    await useWorkspace.getState().refresh();
    ui.revealInSidebar(res.folderPath);
  };

  const codeError = error?.field === 'code' ? error.msg : null;

  return (
    <DialogShell title="공유 폴더 참가" titleId={titleId} busy={busy}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <div className="share-dialog-body">
          <div className="share-field">
            <label className="share-label" htmlFor={codeId}>
              초대 코드
            </label>
            <input
              id={codeId}
              ref={codeRef}
              className={`share-input share-input--code${codeError ? ' invalid' : ''}`}
              data-testid="share-code-input"
              value={code}
              maxLength={16}
              placeholder="ABCD-2345"
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              disabled={busy}
              aria-invalid={!!codeError}
              aria-describedby={codeError ? `${codeId}-err` : undefined}
              onChange={(e) => {
                setCode(e.target.value);
                if (error?.field === 'code') setError(null);
              }}
            />
            {codeError && (
              <p id={`${codeId}-err`} className="share-error" role="alert" data-testid="share-code-error">
                {codeError}
              </p>
            )}
            {!codeError && <p className="share-hint">공유하는 사람에게 받은 코드를 입력하세요. 코드는 10분 동안, 한 번만 쓸 수 있어요.</p>}
          </div>
          <NameField value={name} onChange={setName} disabled={busy} invalid={nameInvalid} />
          {error?.field === 'form' && (
            <p className="share-error" role="alert" data-testid="share-error">
              {error.msg}
            </p>
          )}
        </div>
        <div className="share-actions">
          <button type="button" className="share-btn" onClick={close} disabled={busy}>
            취소
          </button>
          <button type="submit" className="share-btn primary" disabled={!canSubmit} data-testid="share-join-submit">
            {busy ? '참가하는 중…' : '참가'}
          </button>
        </div>
      </form>
    </DialogShell>
  );
}
