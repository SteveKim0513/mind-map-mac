// 공유 폴더 코멘트 동기화 — `comments` 문서(모든 참가자 쓰기 가능)의 `Y.Map<commentId, Comment>`를 관찰해
//  1) 검증된 목록·앵커별 개수를 store에 반영하고(뷰어에서도 코멘트가 보이게),
//  2) 내가 쓰지 않은 새 코멘트가 관련자(나)에게 해당하면 알림을 만들고,
//  3) 코멘트 작성·삭제(작성자 소프트 삭제) API를 store에 등록한다.
//
// 코멘트는 맵·보드·노트 문서를 바꾸지 않으므로 읽기 전용 뷰어 가드와 무관하다. share/는 canvas/·board/·note/를 import하지
// 않는다 — 코멘트 위치로의 이동(reveal)은 App.tsx가 주입하는 훅(`onNotified`)이 맡는다.
//
// 신뢰 모델: 서버는 `comments` 문서를 모두에게 쓰기 허용하고 작성자를 검증하지 못한다. 그래서 (1) 읽을 때마다 항목을
// 검증하고(악성·과대 입력은 무시) (2) "내 코멘트만 삭제"는 UI 규칙이다 — 다른 참가자가 남의 코멘트를 위조·삭제하는 것은
// 프로토콜로 막지 못한다(알려진 한계, 콘텐츠 무결성이 아니라 대화 편의 수준의 신뢰).
import * as Y from 'yjs';
import {
  MAX_COMMENTS_PER_ROOM,
  MAX_COMMENT_TEXT,
  cleanAnchorLabel,
  cleanCommentText,
  compareComments,
  parseComment,
  parseCommentAnchor,
  previewOf,
} from '../io/commentFormat';
import type { Comment, CommentAnchor, NotificationItem, ShareRole } from '../types';
import type { AddCommentResult, CommentControls } from '../store/commentStore';
import { isSafeDocId } from '../io/shareFormat';
import { decideBaseline, shouldNotify } from './commentRules';

export const COMMENTS_MAP_NAME = 'comments';
/** 로컬에서 시작한 코멘트 변경의 트랜잭션 origin. */
export const COMMENTS_LOCAL_ORIGIN = 'share:comments-local';

/** commentSync가 결과를 내보내는 곳 — 기본 구현은 전역 store(`commentSink.ts`의 `storeCommentSink`), 테스트는 메모리 구현. */
export interface CommentSyncSink {
  /** 검증된 코멘트 목록(오래된 것부터, 지운 것 포함)이 바뀔 때. */
  setComments(roomId: string, comments: Comment[]): void;
  /** 알림 추가. 같은 id가 이미 있으면 false. */
  addNotification(item: NotificationItem): boolean;
  hasNotification(id: string): boolean;
  removeNotification(id: string): void;
  getBaseline(roomId: string): number | undefined;
  setBaseline(roomId: string, at: number): void;
  /** 저장된 알림·기준선을 다 읽을 때까지 기다린다(시작 전에 한 번). */
  ready(): Promise<void>;
  /**
   * 저장된 알림·기준선이 손상·소실돼 "복구"로 읽혔는가(생략하면 false). true면 기준선이 없는 방의 과거 코멘트를 알림으로 만들지
   * 않는다 — 기준선을 잃었다고 사이드카 안의 옛 코멘트가 전부 "새 알림"이 되면 안 된다.
   */
  stateLost?(): boolean;
  /** 쓰기 핸들을 등록/해제한다. */
  setControls(roomId: string, controls: CommentControls | null): void;
}

export interface CommentSyncOptions {
  roomId: string;
  folderName: string;
  self: { participantId: string; displayName: string; role: ShareRole };
  /** `comments` 문서. 사이드카가 있으면 이미 적용된 상태로 넘긴다. */
  ydoc: Y.Doc;
  /** 이 기기에 코멘트 사이드카가 있었는가(없으면 처음 참가한 기기 — 기준선을 지금으로 잡는다). */
  hadSidecar: boolean;
  sink: CommentSyncSink;
  /** 앵커 → "파일 이름 · 노드 글자" 같은 사람이 읽는 대상 이름. 기본은 앵커 라벨. */
  describeTarget?: (anchor: CommentAnchor) => string;
  /** 알림이 새로 만들어졌을 때(토스트 등). App.tsx가 연결한다. */
  onNotified?: (item: NotificationItem) => void;
  now?: () => number;
  newId?: () => string;
  /**
   * 진단 로그(기본: 남기지 않음). 코멘트 **내용·작성자 이름은 절대 넘기지 않는다** — 개수·사유 코드만. rooms.ts가 `[comments <방>]` 접두사와 함께
   * share 로그 싱크로 연결한다. 코멘트마다 info를 남기지 않는다(소음).
   */
  log?: (level: 'info' | 'warn' | 'error', message: string) => void;
}

export interface CommentSync {
  readonly roomId: string;
  start(): Promise<void>;
  stop(): void;
  /** 검증된 현재 목록(오래된 것부터, 지운 것 포함). */
  list(): Comment[];
  add: CommentControls['add'];
  remove: CommentControls['remove'];
}

function getCommentsMap(ydoc: Y.Doc): Y.Map<unknown> {
  return ydoc.getMap<unknown>(COMMENTS_MAP_NAME);
}

/**
 * 문서에서 검증을 통과한 코멘트만 읽는다(오래된 것부터). 원격 폭주 방어로 순회 개수와 결과 개수를 제한한다.
 * (키 충돌 — `__proto__` 등 — 은 검증에서 걸러진다: 키가 코멘트 id와 같아야 하고 id는 안전한 문자만 허용한다.)
 * 코멘트 id로 쓸 수 없는 키(정크)는 순회 상한을 소모하지 않는다 — 그런 키를 잔뜩 넣어도 그 뒤의 정상 코멘트는 보인다.
 * (id 모양은 맞지만 값이 어긋난 항목이 `MAX_COMMENTS_PER_ROOM × 4`개를 넘으면 그 뒤의 것은 보이지 않는다 — 알려진 한계.)
 * 전체 재파싱은 시작·복원 때 한 번뿐이다. 이후 변경은 `createCommentSync`가 바뀐 키만 증분으로 반영한다.
 */
export function readComments(ydoc: Y.Doc, now: number = Date.now(), stats?: { rejected: number }): Comment[] {
  const out: Comment[] = [];
  let scanned = 0;
  getCommentsMap(ydoc).forEach((value, key) => {
    if (!isSafeDocId(key)) {
      if (stats) stats.rejected++;
      return;
    }
    if (++scanned > MAX_COMMENTS_PER_ROOM * 4) return;
    const c = parseComment(value, key, now);
    if (c) out.push(c);
    else if (stats) stats.rejected++;
  });
  out.sort(compareComments);
  return out.length > MAX_COMMENTS_PER_ROOM ? out.slice(out.length - MAX_COMMENTS_PER_ROOM) : out;
}

/** 정렬된 목록에서 `c`가 들어갈(또는 있는) 자리 — 이분 탐색. */
function lowerBound(list: readonly Comment[], c: Comment): number {
  let lo = 0;
  let hi = list.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (compareComments(list[mid], c) < 0) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function randomId(): string {
  const c = globalThis.crypto;
  if (c?.randomUUID) return c.randomUUID();
  return `c-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function createCommentSync(opts: CommentSyncOptions): CommentSync {
  const { roomId, ydoc, sink, self } = opts;
  const now = opts.now ?? (() => Date.now());
  const newId = opts.newId ?? randomId;
  let started = false;
  let stopped = false;
  let baselineAt = 0;
  let current: Comment[] = [];
  /** 검증을 통과한 코멘트(id → 코멘트)와 정렬된 사본 — 이벤트마다 전체를 다시 파싱하지 않도록 증분으로 유지한다. */
  const byId = new Map<string, Comment>();
  let sorted: Comment[] = [];
  let unobserve: (() => void) | null = null;

  const describe = (anchor: CommentAnchor): string => opts.describeTarget?.(anchor) ?? anchor.label ?? '';

  /** 검증 거부 집계(원격 코멘트 항목이 형식·크기 검사를 통과하지 못한 건수) — 내용은 기록하지 않고 개수만, 60초에 한 번 요약한다. */
  const LOG_WINDOW_MS = 60_000;
  let rejectedPending = 0;
  let rejectedLoggedAt = -Infinity;
  const noteRejected = (count: number) => {
    if (count <= 0 || !opts.log) return;
    rejectedPending += count;
    const at = now();
    if (at - rejectedLoggedAt < LOG_WINDOW_MS) return;
    rejectedLoggedAt = at;
    opts.log('warn', `remote comments rejected by validation count=${rejectedPending}`);
    rejectedPending = 0;
  };

  /** 시작·복원: 전체를 한 번 읽어 증분 상태를 만든다. */
  const loadAll = () => {
    const stats = { rejected: 0 };
    sorted = readComments(ydoc, now(), stats);
    noteRejected(stats.rejected);
    byId.clear();
    for (const c of sorted) byId.set(c.id, c);
    current = sorted.slice();
  };

  const removeSorted = (old: Comment) => {
    const at = lowerBound(sorted, old);
    if (at < sorted.length && sorted[at].id === old.id) sorted.splice(at, 1);
  };

  /** 바뀐 키 하나를 다시 검증해 증분 상태에 반영한다. 반영 뒤의 유효한 코멘트(없으면 null)를 돌려준다. */
  const applyKey = (key: string): Comment | null => {
    const old = byId.get(key);
    const c = isSafeDocId(key) ? parseComment(getCommentsMap(ydoc).get(key), key, now()) : null;
    if (old) {
      removeSorted(old);
      byId.delete(key);
    }
    if (!c) return null;
    sorted.splice(lowerBound(sorted, c), 0, c);
    byId.set(key, c);
    if (sorted.length > MAX_COMMENTS_PER_ROOM) {
      const oldest = sorted.shift()!;
      byId.delete(oldest.id);
      if (oldest.id === key) return null;
    }
    return c;
  };

  const publish = () => {
    current = sorted.slice();
    sink.setComments(roomId, current);
  };

  const notifyFor = (c: Comment) => {
    if (sink.hasNotification(c.id)) return;
    if (!shouldNotify(c, { self, comments: current, baselineAt })) return;
    const item: NotificationItem = {
      id: c.id,
      type: 'comment',
      roomId,
      folderName: opts.folderName,
      anchor: c.anchor,
      targetLabel: describe(c.anchor),
      authorName: c.authorName,
      preview: previewOf(c.text),
      createdAt: c.createdAt,
      read: false,
    };
    if (sink.addNotification(item)) opts.onNotified?.(item);
  };

  const onChange = (event: Y.YMapEvent<unknown>) => {
    if (stopped) return;
    // 바뀐 키만 다시 검증한다(원격이 코멘트를 쏟아부어도 이벤트마다 5000개를 재파싱하지 않는다).
    const changed: Comment[] = [];
    let rejected = 0;
    event.changes.keys.forEach((change, key) => {
      const c = applyKey(key);
      // 지운 키·이미 넘친 코멘트가 아니라, 값이 있는데 검증을 통과하지 못한 항목만 거부로 센다.
      if (!c && change.action !== 'delete' && getCommentsMap(ydoc).has(key)) rejected++;
      if (!c) return;
      if (change.action === 'add') changed.push(c);
      else if (change.action === 'update' && c.deleted) sink.removeNotification(c.id); // 작성자가 지웠다 — 알림도 거둔다
    });
    noteRejected(rejected);
    publish();
    // 키 순서와 무관하게 오래된 코멘트부터 처리한다(스레드 참여 여부 판정이 시간순과 맞도록).
    changed.sort(compareComments);
    for (const c of changed) notifyFor(c);
  };

  const add = (anchorInput: CommentAnchor, textInput: string, parentId?: string): AddCommentResult => {
    if (!started || stopped) return { ok: false, error: 'not_ready' };
    const text = cleanCommentText(textInput);
    if (text === null) return { ok: false, error: textInput.length > MAX_COMMENT_TEXT ? 'too_long' : 'empty' };
    const label = cleanAnchorLabel((anchorInput as { label?: unknown }).label);
    const anchor = parseCommentAnchor({ ...anchorInput, label });
    if (!anchor) return { ok: false, error: 'invalid_anchor' };
    if (getCommentsMap(ydoc).size >= MAX_COMMENTS_PER_ROOM) return { ok: false, error: 'limit' };
    const comment: Comment = {
      id: newId(),
      anchor,
      authorId: self.participantId,
      authorName: self.displayName,
      text,
      createdAt: now(),
    };
    if (parentId !== undefined) {
      const parent = current.find((c) => c.id === parentId && !c.deleted);
      if (!parent) return { ok: false, error: 'invalid_anchor' };
      comment.parentId = parent.id;
    }
    const valid = parseComment(comment, comment.id, now());
    if (!valid) return { ok: false, error: 'invalid_anchor' };
    ydoc.transact(() => getCommentsMap(ydoc).set(valid.id, valid), COMMENTS_LOCAL_ORIGIN);
    return { ok: true, comment: valid };
  };

  const remove = (commentId: string): boolean => {
    if (!started || stopped) return false;
    const cur = current.find((c) => c.id === commentId);
    if (!cur || cur.deleted || cur.authorId !== self.participantId) return false;
    const gone: Comment = { ...cur, text: '', deleted: true };
    ydoc.transact(() => getCommentsMap(ydoc).set(cur.id, gone), COMMENTS_LOCAL_ORIGIN);
    return true;
  };

  return {
    roomId,
    async start() {
      if (started) return;
      // 저장된 알림·기준선을 먼저 읽는다 — 그 전에 들어온 코멘트가 기준선 없이 판정되지 않게.
      await sink.ready();
      if (stopped) return;
      started = true;
      const hadBaseline = sink.getBaseline(roomId) !== undefined;
      baselineAt = decideBaseline(sink.getBaseline(roomId), opts.hadSidecar && !sink.stateLost?.(), now());
      if (!hadBaseline) {
        sink.setBaseline(roomId, baselineAt);
        // 기준선이 없었다. 이 기기에서 이미 쓰던 방(사이드카가 있다)인데 저장된 알림 상태가 손상·소실돼 읽혔다면(`recovered`) 알림 기준선을 잃은
        // 것이라 warn. 처음 참가한 기기(사이드카 없음)는 정상 — 새로 설치한 앱은 알림 파일도 없어 `recovered`로 읽히지만 그것만으로는 경고하지 않는다.
        const reason = !opts.hadSidecar ? 'first_sync' : sink.stateLost?.() ? 'recovered' : 'no_baseline';
        opts.log?.(reason === 'recovered' ? 'warn' : 'info', `notification baseline initialized reason=${reason}`);
      }
      // 사이드카에서 온 기존 코멘트는 관찰 시작 전의 상태라 알림이 되지 않는다(이미 아는 것).
      loadAll();
      publish();
      const map = getCommentsMap(ydoc);
      map.observe(onChange);
      unobserve = () => map.unobserve(onChange);
      sink.setControls(roomId, { add, remove });
    },
    stop() {
      if (stopped) return;
      stopped = true;
      unobserve?.();
      unobserve = null;
      sink.setControls(roomId, null);
    },
    list: () => current,
    add,
    remove,
  };
}
