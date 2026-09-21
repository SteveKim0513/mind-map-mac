// 코멘트(공유 폴더, ADR 0021 단계 8)의 외부 입력 경계 — `comments` Y.Doc의 값은 모든 참가자가 쓸 수 있는
// 신뢰할 수 없는 입력이다. 읽을 때마다 여기를 통과시키고, 어긋난 항목은 조용히 무시한다.
// 어떤 parse 함수도 던지지 않는다 — 검증 실패는 null.
import type { Comment, CommentAnchor } from '../types';
import { isParticipantId, isSafeDocId, parseDisplayName } from './shareFormat';

/** 코멘트 본문 최대 길이(글자 수). */
export const MAX_COMMENT_TEXT = 2000;
/** 방당 코멘트 상한 — 넘으면 새 코멘트를 막고, 읽을 때도 이만큼만 취한다(원격 폭주 방어). */
export const MAX_COMMENTS_PER_ROOM = 5000;
/** 앵커 라벨(대상 이름 스냅샷) 최대 길이. */
export const MAX_ANCHOR_LABEL = 60;
/** 맵 노드 id · 보드 요소 id 최대 길이. */
export const MAX_TARGET_ID = 128;
/** 알림 미리보기 최대 길이. */
export const MAX_PREVIEW = 80;
/** 미래 시각 허용 폭 — 시계가 어긋난 기기를 견디되 정렬을 망가뜨리는 값은 거른다. */
const MAX_FUTURE_SKEW_MS = 24 * 60 * 60 * 1000;

// 본문에 허용하지 않는 문자: 줄바꿈·탭 외의 제어 문자, 방향 재정의(bidi override/isolate)류.
// eslint-disable-next-line no-control-regex
const BAD_TEXT_RE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\u202A-\u202E\u2066-\u2069]/;
// eslint-disable-next-line no-control-regex
const STRIP_TEXT_RE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\u202A-\u202E\u2066-\u2069]/g;

/** 사람이 쓴 입력을 코멘트 본문으로 정리한다: 줄바꿈 통일·나쁜 문자 제거·앞뒤 공백 제거. 비었거나 너무 길면 null. */
export function cleanCommentText(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  const text = input.replace(/\r\n?/g, '\n').replace(STRIP_TEXT_RE, '').trim();
  if (text.length < 1) return null;
  if (text.length > MAX_COMMENT_TEXT * 2 || [...text].length > MAX_COMMENT_TEXT) return null;
  return text;
}

function isSafeLabel(v: unknown): v is string {
  return typeof v === 'string' && v.length <= MAX_ANCHOR_LABEL * 2 && [...v].length <= MAX_ANCHOR_LABEL && !BAD_TEXT_RE.test(v) && !/[\n\t]/.test(v);
}

/** 사람이 볼 라벨로 정리(공백 접기·길이 제한). 비면 undefined. */
export function cleanAnchorLabel(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined;
  const flat = v.replace(STRIP_TEXT_RE, '').replace(/\s+/g, ' ').trim();
  if (!flat) return undefined;
  const chars = [...flat];
  return chars.length > MAX_ANCHOR_LABEL ? chars.slice(0, MAX_ANCHOR_LABEL - 1).join('') + '…' : flat;
}

function isTargetId(v: unknown): v is string {
  return typeof v === 'string' && v.length >= 1 && v.length <= MAX_TARGET_ID && !/[\p{C}]/u.test(v);
}

/** 앵커 검증 — 알 수 없는 필드는 버린다. */
export function parseCommentAnchor(raw: unknown): CommentAnchor | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const label = o.label === undefined ? undefined : isSafeLabel(o.label) ? o.label : null;
  if (label === null) return null;
  if (o.kind === 'note') {
    if (!isSafeDocId(o.noteId)) return null;
    return label === undefined ? { kind: 'note', noteId: o.noteId } : { kind: 'note', noteId: o.noteId, label };
  }
  if (o.kind === 'map' || o.kind === 'board') {
    if (!isSafeDocId(o.fileId)) return null;
    if (o.targetId !== undefined && !isTargetId(o.targetId)) return null;
    const a: CommentAnchor = { kind: o.kind, fileId: o.fileId };
    if (o.targetId !== undefined) a.targetId = o.targetId as string;
    if (label !== undefined) a.label = label;
    return a;
  }
  return null;
}

/**
 * 원격에서 온 값 하나를 검증. `key`(Y.Map의 키)가 주어지면 코멘트 id와 같아야 한다.
 * 삭제된 코멘트(`deleted: true`)는 본문이 비어 있어도 된다.
 */
export function parseComment(raw: unknown, key?: string, now: number = Date.now()): Comment | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  if (!isSafeDocId(o.id)) return null;
  if (key !== undefined && key !== o.id) return null;
  const anchor = parseCommentAnchor(o.anchor);
  if (!anchor) return null;
  if (!isParticipantId(o.authorId)) return null;
  const authorName = parseDisplayName(o.authorName);
  if (!authorName) return null;
  if (typeof o.createdAt !== 'number' || !Number.isFinite(o.createdAt) || o.createdAt < 0 || o.createdAt > now + MAX_FUTURE_SKEW_MS) return null;
  if (o.parentId !== undefined && !isSafeDocId(o.parentId)) return null;
  if (o.deleted !== undefined && o.deleted !== true) return null;
  let text: string;
  if (o.deleted === true) {
    text = '';
  } else {
    if (typeof o.text !== 'string' || o.text.length < 1 || o.text.length > MAX_COMMENT_TEXT * 2 || [...o.text].length > MAX_COMMENT_TEXT) return null;
    if (BAD_TEXT_RE.test(o.text)) return null;
    text = o.text;
  }
  const c: Comment = { id: o.id, anchor, authorId: o.authorId, authorName, text, createdAt: Math.floor(o.createdAt) };
  if (o.parentId !== undefined) c.parentId = o.parentId as string;
  if (o.deleted === true) c.deleted = true;
  return c;
}

/** 같은 앵커(대상)를 가리키는 코멘트끼리 같은 키 — 라벨은 무시한다. 방 안에서만 유일하다(id는 '|'를 포함할 수 없어 모호하지 않다). */
export function anchorKey(a: CommentAnchor): string {
  return a.kind === 'note' ? `n|${a.noteId}` : `f|${a.fileId}|${a.targetId ?? ''}`;
}

export function sameAnchor(a: CommentAnchor, b: CommentAnchor): boolean {
  return anchorKey(a) === anchorKey(b);
}

/** 오래된 것부터, 같은 시각이면 id 순 — 모든 기기에서 같은 순서. */
export function compareComments(a: Comment, b: Comment): number {
  return a.createdAt - b.createdAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

/** 알림·토스트에 쓸 본문 미리보기 — 공백을 접고 길이를 제한한다. */
export function previewOf(text: string, max: number = MAX_PREVIEW): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  const chars = [...flat];
  return chars.length > max ? chars.slice(0, max - 1).join('') + '…' : flat;
}
