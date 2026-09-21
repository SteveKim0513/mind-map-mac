// 공유 노트 참가자 표시의 순수 로직(awareness 읽기·색·이니셜) — 컴포넌트(CollabPresence.tsx)·캐럿 확장이 공용으로 쓴다.
import type { Awareness } from 'y-protocols/awareness';
import { isParticipantId, parseDisplayName } from '../io/shareFormat';
import { presenceKey } from '../theme/palette';

/** awareness에 남는 "이 노트를 열어 보는 중" 표시 필드 — 헤더의 함께 보는 사람 칩이 이것을 읽는다. */
export const VIEWING_FIELD = 'viewing';

/** 칩에 보이는 최대 인원(나머지는 "+N"). */
export const MAX_PEER_CHIPS = 4;
/** awareness 상태를 훑는 최대 개수와 모으는 최대 인원 — 원격이 상태를 수천 개 만들어 렌더러를 붙잡지 못하게(방당 참가자 상한은 1000). */
export const MAX_AWARENESS_SCANNED = 200;
export const MAX_PEERS = 50;

export interface Peer {
  id: string;
  name: string;
}

/** 참가자(awareness user)의 표시색 CSS 값. participantId가 없으면 이름으로 대체한다. */
export function presenceCssVar(user: { participantId?: unknown; name?: unknown }): string {
  const id = typeof user.participantId === 'string' && user.participantId ? user.participantId : String(user.name ?? '');
  return `var(--tag-${presenceKey(id)})`;
}

/** 이름의 첫 글자(칩 안의 텍스트) — 영문은 대문자로. */
export function initialOf(name: string): string {
  const ch = Array.from(name.trim())[0] ?? '?';
  return ch.toUpperCase();
}

/**
 * awareness에서 "이 노트를 열어 보는 중"인 다른 참가자를 모은다(같은 참가자의 여러 창은 하나로, 자기 자신 제외).
 * awareness 값은 다른 참가자가 임의로 채울 수 있는 신뢰할 수 없는 입력이다 — 이름은 표시 이름 규칙(`parseDisplayName`: NFC·1~40자·
 * 제어문자와 `<>` 금지)으로 정규화하고 어긋나면 "참가자"로 대체하며, participantId도 형식을 검증한다(어긋나면 연결 번호로 대체).
 * 훑는 개수·모으는 인원에 상한이 있다. 같은 id의 상태가 여럿이면 clientID가 가장 작은 하나만 쓰고(결정적), 내 id를 내세우는 상태는
 * 무시한다(다른 창이거나 사칭 — 어느 쪽이든 칩에 나올 이유가 없다).
 */
export function readPeers(awareness: Awareness, selfParticipantId: string): Peer[] {
  const seen = new Map<string, Peer>();
  const states = [...awareness.getStates().entries()].sort(([a], [b]) => a - b).slice(0, MAX_AWARENESS_SCANNED);
  for (const [clientId, state] of states) {
    if (clientId === awareness.clientID) continue;
    if (seen.size >= MAX_PEERS) break;
    const user = state.user as { participantId?: unknown; name?: unknown } | undefined;
    if (!user || typeof user !== 'object' || state[VIEWING_FIELD] !== true) continue;
    const id = isParticipantId(user.participantId) ? user.participantId : `client-${clientId}`;
    if (id === selfParticipantId || seen.has(id)) continue;
    const name = parseDisplayName(user.name) ?? '참가자';
    seen.set(id, { id, name });
  }
  return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}

export const samePeers = (a: Peer[], b: Peer[]): boolean =>
  a.length === b.length && a.every((p, i) => p.id === b[i].id && p.name === b[i].name);
