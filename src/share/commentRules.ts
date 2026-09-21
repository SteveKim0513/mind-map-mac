// 코멘트 알림 규칙(순수) — 어떤 새 코멘트가 이 기기의 사용자에게 알림이 되는가.
//
// 알림은 별도 채널이 아니라 `comments` 문서 관찰로 만든다(폴링 없음). 소음을 줄이려고 "관련자"에게만 알린다:
//   ① 방 소유자(그 방의 모든 파일·노트의 주인)
//   ② 같은 앵커(같은 노드·요소·노트)의 스레드에 이미 코멘트한 사람, 또는 내 코멘트에 답글이 달린 경우의 나
// 그 밖의 참가자에게는 알림을 만들지 않는다(코멘트 목록·칩에는 그대로 보인다).
import type { Comment, ShareRole } from '../types';
import { sameAnchor } from '../io/commentFormat';

/**
 * 기준선 여유: 기준선보다 이만큼 이전에 쓰인 코멘트까지는 "새 코멘트"로 본다 — 기기 시계가 몇 초~몇 분 어긋나 있어도
 * 방금 달린 코멘트를 놓치지 않게. (그보다 오래된 코멘트는 처음 동기화로 들어와도 알림이 되지 않는다.)
 */
export const BASELINE_SLACK_MS = 60_000;

export interface NotifySelf {
  participantId: string;
  role: ShareRole;
}

export interface NotifyContext {
  self: NotifySelf;
  /** 이 방의 현재 코멘트 전체(새 코멘트 포함, 지운 것 포함). */
  comments: readonly Comment[];
  /** 이 기기가 이 방의 코멘트를 알기 시작한 시각(epoch ms). */
  baselineAt: number;
}

/** 이 코멘트의 관련자가 나인가(소유자이거나, 같은 스레드에 이미 참여했거나, 부모 코멘트가 내 것). */
export function isRelevantToSelf(comment: Comment, ctx: NotifyContext): boolean {
  if (ctx.self.role === 'owner') return true;
  for (const c of ctx.comments) {
    if (c.id === comment.id || c.deleted || c.authorId !== ctx.self.participantId) continue;
    if (sameAnchor(c.anchor, comment.anchor)) return true;
  }
  if (comment.parentId) {
    const parent = ctx.comments.find((c) => c.id === comment.parentId);
    if (parent && parent.authorId === ctx.self.participantId) return true;
  }
  return false;
}

/**
 * 이 코멘트로 알림을 만들어야 하는가. (중복 방지 — 이미 같은 id의 알림이 있는가 — 는 호출자가 store에서 확인한다.)
 *  - 지워진 코멘트·내가 쓴 코멘트는 알림이 아니다.
 *  - 기준선(참가한 시점)보다 한참 이전에 쓰인 코멘트는 "이미 아는 것"이다 — 새로 참가한 기기가 최초 동기화로 받는
 *    과거 코멘트가 알림 폭탄이 되지 않게.
 *  - 관련자가 아니면 알리지 않는다.
 */
export function shouldNotify(comment: Comment, ctx: NotifyContext): boolean {
  if (comment.deleted) return false;
  if (comment.authorId === ctx.self.participantId) return false;
  if (comment.createdAt < ctx.baselineAt - BASELINE_SLACK_MS) return false;
  return isRelevantToSelf(comment, ctx);
}

/**
 * 이 기기의 기준선을 정한다. 이미 저장된 값이 있으면 그것을 쓴다. 없으면:
 *  - 사이드카가 있었으면(이 기기가 이 방의 코멘트 상태를 이미 갖고 있었다) 0 — 사이드카에 없던 코멘트는 전부 새 것이다.
 *  - 없으면(처음 참가한 기기) 지금 — 최초 동기화로 들어오는 기존 코멘트는 알림이 되지 않는다.
 */
export function decideBaseline(stored: number | undefined, hadSidecar: boolean, now: number): number {
  if (stored !== undefined) return stored;
  return hadSidecar ? 0 : now;
}
