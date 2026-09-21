import { useEffect, useState, type CSSProperties } from 'react';
import type { Awareness } from 'y-protocols/awareness';
import { Icon } from '../ui/Icon';
import { MAX_PEER_CHIPS, initialOf, presenceCssVar, readPeers, samePeers, type Peer } from './collabPeers';

// 공유 폴더 노트 헤더의 두 표시 — "공유됨" 표식(연결 상태 포함)과 "지금 함께 보는 사람" 칩.
// 화면 문구는 사용자 언어만 쓴다(공유 폴더·참가자·오프라인). 상태는 색만이 아니라 아이콘 모양과 텍스트로도 구분한다.

/** 표식이 보여 줄 상태: 방 연결 상태 + 공유가 끝난 경우(`ended`). */
export type SharedNoteStatus = 'connected' | 'connecting' | 'offline' | 'denied' | 'ended';

const STATUS_LABEL: Record<SharedNoteStatus, string> = {
  connected: '공유됨',
  connecting: '공유됨 · 연결 중',
  offline: '공유됨 · 오프라인',
  denied: '공유 끊김',
  ended: '공유 종료',
};

const STATUS_HINT: Record<SharedNoteStatus, string> = {
  connected: '공유 폴더의 노트예요 — 다른 참가자의 변경이 바로 반영돼요',
  connecting: '공유 폴더에 연결하는 중이에요 — 그동안에도 계속 편집할 수 있어요',
  offline: '오프라인이에요 — 계속 편집할 수 있고, 연결되면 자동으로 합쳐져요',
  denied: '이 공유 폴더에서 내보내졌어요 — 읽기만 할 수 있어요',
  ended: '공유가 끝난 노트예요 — 읽기만 할 수 있어요',
};

export function SharedNoteBadge({ status }: { status: SharedNoteStatus }) {
  const off = status === 'denied' || status === 'ended';
  return (
    <span className="note-shared-badge" data-testid="note-shared-badge" data-status={status} title={STATUS_HINT[status]}>
      <Icon name={off ? 'userOff' : 'users'} />
      <span className="share-dot" aria-hidden="true" />
      <span>{STATUS_LABEL[status]}</span>
    </span>
  );
}

/** 헤더의 "지금 함께 보는 사람" 칩 — 최대 4명 + "+N", 자기 자신 제외. 아무도 없으면 아무것도 그리지 않는다. */
export function CollabPeers({ awareness, selfParticipantId }: { awareness: Awareness; selfParticipantId: string }) {
  const [peers, setPeers] = useState<Peer[]>([]);
  useEffect(() => {
    const read = () => {
      const next = readPeers(awareness, selfParticipantId);
      setPeers((prev) => (samePeers(prev, next) ? prev : next));
    };
    read();
    awareness.on('change', read);
    return () => {
      awareness.off('change', read);
    };
  }, [awareness, selfParticipantId]);

  if (peers.length === 0) return null;
  const shown = peers.slice(0, MAX_PEER_CHIPS);
  const rest = peers.slice(MAX_PEER_CHIPS);
  return (
    <span
      className="collab-peers"
      data-testid="collab-peers"
      role="group"
      aria-label={`지금 함께 보는 사람 ${peers.length}명: ${peers.map((p) => p.name).join(', ')}`}
    >
      {shown.map((p) => (
        <span
          key={p.id}
          className="collab-peer"
          data-testid="collab-peer"
          data-name={p.name}
          title={`${p.name} — 지금 이 노트를 보고 있어요`}
          style={{ '--collab-c': presenceCssVar({ participantId: p.id, name: p.name }) } as CSSProperties}
        >
          {initialOf(p.name)}
        </span>
      ))}
      {rest.length > 0 && (
        <span className="collab-peer more" data-testid="collab-peer-more" title={rest.map((p) => p.name).join(', ')}>
          +{rest.length}
        </span>
      )}
    </span>
  );
}
