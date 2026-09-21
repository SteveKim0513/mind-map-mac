import { useCallback, useEffect, useId, useRef, useState } from 'react';
import {
  connStatusDetail,
  connStatusText,
  docProblemMessage,
  SERVER_LEFTOVER_MESSAGE,
  forgetSharedFolder,
  formatInviteCode,
  formatRemaining,
  issueInvite,
  refreshParticipants,
  removeParticipant,
  shareErrorMessage,
  unshareFolder,
} from '../share';
import { useShare, type ShareRoom } from '../store/shareStore';
import { useUi } from '../store/uiStore';
import type { ShareParticipant } from '../types';
import { Icon } from './Icon';
import { ShareStatusIcon } from './ShareStatus';
import { useFocusTrap } from './useFocusTrap';
import { useOverlayEsc } from './useOverlayEsc';

/** 패널이 열려 있는 동안 참가자·온라인 상태를 새로 받는 주기. */
const POLL_MS = 5000;

type Confirm =
  | { kind: 'revoke'; participant: ShareParticipant }
  | { kind: 'leave' }
  | { kind: 'unshare' }
  | { kind: 'forget' };

/** 클립보드 복사 — 포커스가 없는 창에서는 비동기 API가 거부될 수 있어 execCommand로 한 번 더 시도한다. */
async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      return ok;
    } catch {
      return false;
    }
  }
}

function useNow(active: boolean, intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [active, intervalMs]);
  return now;
}

/** 공유 설정 패널: 초대 코드(소유자) · 참가자 목록 · 연결 상태 · 나가기/공유 해제. */
export function SharePanel() {
  const roomId = useUi((s) => s.shareRoomId);
  const room = useShare((s) =>
    roomId && Object.prototype.hasOwnProperty.call(s.rooms, roomId) ? s.rooms[roomId] : undefined,
  );
  const close = useUi((s) => s.closeShare);
  const stackIndex = useUi((s) => s.overlayStack.indexOf('share'));
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();

  // Esc는 한 단계 복귀(ADR 0018): 확인 창이 열려 있으면 그것만 닫고, 아니면 패널을 닫는다.
  const onEsc = useCallback(() => {
    if (busy) return;
    if (confirm) setConfirm(null);
    else close();
  }, [busy, confirm, close]);
  useOverlayEsc('share', onEsc);
  useFocusTrap(ref);

  useEffect(() => {
    ref.current?.focus();
  }, []);

  // 대상이 사라지면(정리·해제 완료, 워크스페이스 전환 등) 패널도 닫는다.
  useEffect(() => {
    if (roomId && !room) close();
  }, [roomId, room, close]);

  // 열려 있는 동안 참가자 목록을 5초마다, 열 때 즉시 새로 받는다. 접근이 해제된 뒤에는 멈춘다.
  const denied = room?.status === 'denied';
  useEffect(() => {
    if (!roomId || denied) return;
    void refreshParticipants(roomId);
    const t = setInterval(() => void refreshParticipants(roomId), POLL_MS);
    return () => clearInterval(t);
  }, [roomId, denied]);

  if (!roomId || !room) return null;

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
        className="share-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        data-testid="share-panel"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="wh-head">
          <Icon name="users" />
          <span className="wh-title" id={titleId}>
            공유 설정
          </span>
          <span className="share-head-folder" title={room.marker.folderName}>
            {room.marker.folderName}
          </span>
          <button className="wh-close" title="닫기 (Esc)" aria-label="닫기" onClick={close}>
            <Icon name="close" />
          </button>
        </div>

        <div className="share-panel-body">
          <StatusSection room={room} onForget={() => setConfirm({ kind: 'forget' })} />
          {room.marker.role === 'owner' && !denied && <InviteSection roomId={roomId} disabled={!!confirm || busy} />}
          {/* 접근이 해제되면 마지막으로 본 목록은 낡은 정보라 숨긴다 */}
          {!denied && <ParticipantsSection room={room} onRevoke={(p) => setConfirm({ kind: 'revoke', participant: p })} />}
        </div>

        {confirm ? (
          <ConfirmBar
            confirm={confirm}
            room={room}
            busy={busy}
            setBusy={setBusy}
            onCancel={() => setConfirm(null)}
          />
        ) : (
          !denied && (
            <div className="share-panel-foot">
              {room.marker.role === 'owner' ? (
                <button className="share-btn danger" data-testid="share-unshare" onClick={() => setConfirm({ kind: 'unshare' })}>
                  공유 해제
                </button>
              ) : (
                <button className="share-btn danger" data-testid="share-leave" onClick={() => setConfirm({ kind: 'leave' })}>
                  나가기
                </button>
              )}
            </div>
          )
        )}
      </div>
    </div>
  );
}

// ── 연결 상태 ────────────────────────────────────────────────────────────────

function StatusSection({ room, onForget }: { room: ShareRoom; onForget: () => void }) {
  const detail = connStatusDetail(room.status, room.error);
  const docProblem = docProblemMessage(room.docProblems);
  return (
    <section className="share-sec" aria-label="연결 상태">
      <div className="share-status" data-testid="share-status" data-status={room.status} aria-live="polite">
        <ShareStatusIcon status={room.status} error={room.error} />
        <span className="share-status-label">{connStatusText(room.status, room.error)}</span>
      </div>
      {detail && <p className="share-hint">{detail}</p>}
      {(room.conflictPaths?.length ?? 0) > 0 && (
        <p className="share-hint" data-testid="share-conflict">
          같은 공유 폴더가 다른 곳에도 있어요({room.conflictPaths!.map((p) => p.split('/').pop()).join(', ')}). 이 폴더만 연결돼 있고 다른 폴더는
          연결하지 않아요 — 복사본이라면 지워 주세요.
        </p>
      )}
      {docProblem && room.status !== 'denied' && (
        <p className="share-hint" data-testid="share-doc-problem">
          {docProblem}
        </p>
      )}
      {room.status === 'denied' && (
        <button className="share-btn" data-testid="share-forget" onClick={onForget}>
          이 컴퓨터에서 공유 정리하기
        </button>
      )}
    </section>
  );
}

// ── 초대 코드 (소유자) ───────────────────────────────────────────────────────

function InviteSection({ roomId, disabled }: { roomId: string; disabled: boolean }) {
  const invite = useUi((s) => s.shareInvite);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const now = useNow(!!invite, 1000);
  const remaining = invite ? invite.expiresAt - now : 0;
  const live = !!invite && remaining > 0;

  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1600);
    return () => clearTimeout(t);
  }, [copied]);

  const newCode = async () => {
    setBusy(true);
    setError(null);
    const res = await issueInvite(roomId);
    setBusy(false);
    if (!res.ok) {
      setError(shareErrorMessage(res.error));
      return;
    }
    setCopied(false);
    useUi.getState().setShareInvite({ code: res.invite.inviteCode, expiresAt: res.invite.inviteExpiresAt });
  };

  const copy = async () => {
    if (!invite) return;
    if (await copyText(formatInviteCode(invite.code))) setCopied(true);
    else setError('복사하지 못했어요. 코드를 직접 선택해서 복사해 주세요.');
  };

  return (
    <section className="share-sec" aria-label="초대 코드">
      <div className="share-sec-label">초대 코드</div>
      {live && invite ? (
        <>
          <div className="share-code-row">
            <code className="share-code" data-testid="share-invite-code" aria-label={`초대 코드 ${invite.code.split('').join(' ')}`}>
              {formatInviteCode(invite.code)}
            </code>
            <button className="share-btn" onClick={() => void copy()} disabled={disabled} data-testid="share-copy">
              <Icon name="copy" />
              <span aria-live="polite">{copied ? '복사됨' : '복사'}</span>
            </button>
          </div>
          <p className="share-hint" data-testid="share-invite-remaining">
            한 명만 쓸 수 있고, <span className="share-remaining">{formatRemaining(remaining)}</span> 뒤에 만료돼요.
          </p>
        </>
      ) : (
        <p className="share-hint">
          {invite ? '코드가 만료됐어요. ' : ''}새 코드를 만들어 함께할 사람에게 전달하세요.
        </p>
      )}
      {error && (
        <p className="share-error" role="alert">
          {error}
        </p>
      )}
      <button className="share-btn" onClick={() => void newCode()} disabled={busy || disabled} data-testid="share-new-code">
        {busy ? '만드는 중…' : '새 코드 만들기'}
      </button>
    </section>
  );
}

// ── 참가자 ───────────────────────────────────────────────────────────────────

function ParticipantsSection({ room, onRevoke }: { room: ShareRoom; onRevoke: (p: ShareParticipant) => void }) {
  const isOwner = room.marker.role === 'owner';
  const people = room.participants;
  return (
    <section className="share-sec" aria-label="참가자">
      <div className="share-sec-label">
        참가자 <span className="share-count">{people.length > 0 ? people.length : ''}</span>
      </div>
      {people.length === 0 ? (
        <p className="share-hint">참가자 목록을 불러오는 중이에요…</p>
      ) : (
        <ul className="share-people" data-testid="share-people">
          {people.map((p) => {
            const isMe = p.participantId === room.marker.participantId;
            return (
              <li className="share-person" key={p.participantId} data-testid="share-person" data-online={p.online}>
                <span className="share-avatar" aria-hidden="true">
                  {[...p.displayName][0]}
                </span>
                <span className="share-person-info">
                  <span className="share-person-name">
                    {p.displayName}
                    {isMe && <span className="share-me">나</span>}
                  </span>
                  <span className="share-person-role">{p.role === 'owner' ? '소유자' : '참가자'}</span>
                </span>
                <span className={`share-presence${p.online ? ' on' : ''}`}>
                  <span className={`share-dot share-dot--${p.online ? 'connected' : 'offline'}`} aria-hidden="true" />
                  {p.online ? '온라인' : '오프라인'}
                </span>
                {isOwner && p.role !== 'owner' && (
                  <button className="share-btn danger small" onClick={() => onRevoke(p)} data-testid="share-revoke">
                    내보내기
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

// ── 확인 (파괴적 동작) ───────────────────────────────────────────────────────

function ConfirmBar({
  confirm,
  room,
  busy,
  setBusy,
  onCancel,
}: {
  confirm: Confirm;
  room: ShareRoom;
  busy: boolean;
  setBusy: (b: boolean) => void;
  onCancel: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const descId = useId();

  // 파괴적 동작의 기본 포커스는 취소 — Enter 한 번으로 실수하지 않게.
  useEffect(() => {
    cancelRef.current?.focus();
  }, []);

  const others = room.participants.filter((p) => p.role !== 'owner').length;
  const copy = (() => {
    switch (confirm.kind) {
      case 'revoke':
        return {
          title: `"${confirm.participant.displayName}"님을 내보낼까요?`,
          detail: '더 이상 이 폴더의 변경을 받거나 보낼 수 없어요. 새 초대 코드가 있으면 다시 참가할 수 있어요.',
          action: '내보내기',
          testid: 'share-confirm-revoke',
        };
      case 'leave':
        return {
          title: '이 공유 폴더에서 나갈까요?',
          detail: '이 컴퓨터에서 공유가 해제돼요. 폴더 안의 파일은 그대로 남아요. 다시 참가하려면 새 초대 코드가 필요해요.',
          action: '나가기',
          testid: 'share-confirm-leave',
        };
      case 'unshare':
        return {
          title: '공유를 해제할까요?',
          detail:
            others > 0
              ? `참가자 ${others}명이 더 이상 이 폴더에 접근할 수 없게 돼요. 폴더 안의 파일은 모두 그대로 남아요.`
              : '폴더 안의 파일은 모두 그대로 남아요. 다시 공유하려면 폴더를 새로 공유 폴더로 만들어야 해요.',
          action: '공유 해제',
          testid: 'share-confirm-unshare',
        };
      case 'forget':
        return {
          title: '이 컴퓨터에서 공유를 정리할까요?',
          detail: '폴더 안의 파일은 그대로 남아요. 다시 참가하려면 새 초대 코드가 필요해요.',
          action: '정리하기',
          testid: 'share-confirm-forget',
        };
    }
  })();

  const run = async () => {
    setBusy(true);
    setError(null);
    const ui = useUi.getState();
    let res: { ok: true; serverLeftover?: boolean } | { ok: false; error: string };
    if (confirm.kind === 'revoke') res = await removeParticipant(room.marker.roomId, confirm.participant.participantId);
    else if (confirm.kind === 'unshare') res = await unshareFolder(room.marker.roomId);
    else res = await forgetSharedFolder(room.marker.roomId);
    setBusy(false);
    if (!res.ok) {
      setError(shareErrorMessage(res.error));
      return;
    }
    if (confirm.kind === 'revoke') {
      ui.toast(`"${confirm.participant.displayName}"님을 내보냈어요`);
      onCancel();
      return;
    }
    ui.closeShare(); // 대상 폴더의 공유가 끝났다 — 패널도 함께 닫힌다
    ui.toast(confirm.kind === 'unshare' ? '공유를 해제했어요' : confirm.kind === 'leave' ? '공유 폴더에서 나갔어요' : '공유를 정리했어요');
    // 소유자의 공유 해제인데 서버에 남은 정보(방·참가자 기록)를 지우지 못했다 — 로컬 정리는 끝났으니 알리기만 한다.
    if ('serverLeftover' in res && res.serverLeftover) ui.toastError(SERVER_LEFTOVER_MESSAGE);
  };

  return (
    <div className="share-confirm" role="alertdialog" aria-labelledby={titleId} aria-describedby={descId} data-testid="share-confirm">
      <p className="share-confirm-title" id={titleId}>
        {copy.title}
      </p>
      <p className="share-hint" id={descId}>
        {copy.detail}
      </p>
      {error && (
        <p className="share-error" role="alert">
          {error}
        </p>
      )}
      <div className="share-actions">
        <button ref={cancelRef} className="share-btn" onClick={onCancel} disabled={busy}>
          취소
        </button>
        <button className="share-btn danger solid" onClick={() => void run()} disabled={busy} data-testid={copy.testid}>
          {busy ? '처리 중…' : copy.action}
        </button>
      </div>
    </div>
  );
}
