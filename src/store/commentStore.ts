import { useMemo } from 'react';
import { create } from 'zustand';
import { anchorKey } from '../io/commentFormat';
import { fileExtKind } from '../io/fileKind';
import type { Comment, CommentAnchor } from '../types';
import { findRoomForPath, sharedNoteAt, useShare } from './shareStore';

/**
 * 공유 폴더 코멘트의 렌더러 상태. 코멘트의 진실은 `share/commentSync`가 관찰하는 `comments` Y.Doc이고, 이 store는 그 검증된
 * 사본(방별 목록 + 앵커별 개수)과 쓰기 핸들(`controls`)만 담는다 — canvas/·board/·note/·ui/는 share/를 import하지 않고
 * 이 store를 통해서만 코멘트를 읽고 쓴다(shareStore의 `ReplicaControls`와 같은 방식).
 * 코멘트는 문서를 바꾸지 않으므로 읽기 전용 뷰어 가드(`readOnlyGuard`)와 무관하게 동작한다.
 */

export type AddCommentError = 'empty' | 'too_long' | 'limit' | 'invalid_anchor' | 'not_ready';
export type AddCommentResult = { ok: true; comment: Comment } | { ok: false; error: AddCommentError };

/** 방 하나의 코멘트 쓰기 핸들 — commentSync가 등록한다. */
export interface CommentControls {
  add: (anchor: CommentAnchor, text: string, parentId?: string) => AddCommentResult;
  /** 내 코멘트만 지운다(작성자 소프트 삭제). 남의 코멘트·없는 코멘트면 false. */
  remove: (commentId: string) => boolean;
}

interface RoomComments {
  /** 지운 것 포함, 오래된 것부터. */
  list: Comment[];
  /** 앵커별 지워지지 않은 코멘트 개수(`anchorKey`). */
  counts: Record<string, number>;
}

interface CommentState {
  rooms: Record<string, RoomComments>;
  controls: Record<string, CommentControls>;
  setRoomComments: (roomId: string, list: Comment[]) => void;
  clearRoom: (roomId: string) => void;
  setControls: (roomId: string, controls: CommentControls | null) => void;
  getControls: (roomId: string) => CommentControls | undefined;
}

function has(obj: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

/** 목록에서 앵커별 개수를 센다(순수). */
export function countByAnchor(list: readonly Comment[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const c of list) {
    if (c.deleted) continue;
    const k = anchorKey(c.anchor);
    Object.defineProperty(counts, k, { value: (has(counts, k) ? counts[k] : 0) + 1, enumerable: true, writable: true, configurable: true });
  }
  return counts;
}

export const useComments = create<CommentState>((set, get) => ({
  rooms: {},
  controls: {},
  setRoomComments: (roomId, list) => set((s) => ({ rooms: { ...s.rooms, [roomId]: { list, counts: countByAnchor(list) } } })),
  clearRoom: (roomId) =>
    set((s) => {
      if (!has(s.rooms, roomId)) return s;
      const rooms = { ...s.rooms };
      delete rooms[roomId];
      return { rooms };
    }),
  setControls: (roomId, controls) =>
    set((s) => {
      const next = { ...s.controls };
      if (controls) next[roomId] = controls;
      else delete next[roomId];
      return { controls: next };
    }),
  getControls: (roomId) => (has(get().controls, roomId) ? get().controls[roomId] : undefined),
}));

/** 한 앵커의 (지워지지 않은) 코멘트 개수 — 순수. */
export function commentCount(rooms: Record<string, RoomComments>, roomId: string, anchor: CommentAnchor): number {
  const room = has(rooms, roomId) ? rooms[roomId] : undefined;
  const k = anchorKey(anchor);
  return room && has(room.counts, k) ? room.counts[k] : 0;
}

// ── 파일·노트 → 코멘트 대상 ───────────────────────────────────────────────────

/** 파일이 코멘트를 받을 수 있는 공유 파일이면 그 방·파일 id·종류. 일반(비공유) 파일이면 null. */
export interface CommentFileTarget {
  roomId: string;
  fileId: string;
  kind: 'map' | 'board';
}

/**
 * 맵·보드 경로 → 코멘트 대상(순수). 공유 폴더 안이고 **복제 매니저가 공유 중으로 등록한 파일**(소유자의 발행 파일 또는 참가자의
 * 읽기 전용 미러)만 해당한다 — 참가자가 폴더 안에 직접 만든 로컬 맵·보드는 공유되지 않으므로 코멘트 대상이 아니다.
 */
export function commentTargetForFile(rooms: ReturnType<typeof useShare.getState>['rooms'], path: string | null): CommentFileTarget | null {
  if (!path) return null;
  const room = findRoomForPath(rooms, path);
  if (!room || !has(room.files, path)) return null;
  const kind = fileExtKind(path);
  if (kind !== 'map' && kind !== 'board') return null;
  return { roomId: room.marker.roomId, fileId: room.files[path], kind };
}

/** 파일 경로의 코멘트 대상을 구독한다(원시 문자열 키로 구독한 뒤 메모 — 객체를 selector가 만들면 무한 재렌더). */
export function useCommentFileTarget(path: string | null): CommentFileTarget | null {
  const key = useShare((s) => {
    const t = commentTargetForFile(s.rooms, path);
    return t ? `${t.roomId}|${t.fileId}|${t.kind}` : '';
  });
  return useMemo(() => {
    if (!key) return null;
    const [roomId, fileId, kind] = key.split('|');
    return { roomId, fileId, kind: kind as 'map' | 'board' };
  }, [key]);
}

/** 노트 경로의 코멘트 대상(공유 노트면 방·노트 id). */
export function commentTargetForNote(rooms: ReturnType<typeof useShare.getState>['rooms'], path: string | null): { roomId: string; noteId: string } | null {
  if (!path) return null;
  const info = sharedNoteAt(rooms, path);
  return info ? { roomId: info.roomId, noteId: info.noteId } : null;
}

/**
 * 맵 노드·보드 요소 하나의 코멘트 개수를 구독한다. 공유 파일이 아니면 0(코멘트 UI는 그리지 않는다).
 * 노드마다 호출되므로 selector는 원시값(숫자)만 돌려준다.
 */
export function useTargetCommentCount(target: CommentFileTarget | null, targetId: string): number {
  const roomId = target?.roomId ?? '';
  const k = target ? anchorKey({ kind: target.kind, fileId: target.fileId, targetId }) : '';
  return useComments((s) => {
    if (!k) return 0;
    const room = has(s.rooms, roomId) ? s.rooms[roomId] : undefined;
    return room && has(room.counts, k) ? room.counts[k] : 0;
  });
}

/** 노트 전체의 코멘트 개수를 구독한다. */
export function useNoteCommentCount(roomId: string | null, noteId: string | null): number {
  const k = noteId ? anchorKey({ kind: 'note', noteId }) : '';
  return useComments((s) => {
    if (!roomId || !k) return 0;
    const room = has(s.rooms, roomId) ? s.rooms[roomId] : undefined;
    return room && has(room.counts, k) ? room.counts[k] : 0;
  });
}

/** 한 앵커의 스레드(지운 코멘트는 원 코멘트에 답글이 달린 경우에만 "삭제됨" 자리표시로 남긴다). */
export function threadFor(list: readonly Comment[], anchor: CommentAnchor): Comment[] {
  const k = anchorKey(anchor);
  const inAnchor = list.filter((c) => anchorKey(c.anchor) === k);
  const parentsWithReplies = new Set(inAnchor.filter((c) => !c.deleted && c.parentId).map((c) => c.parentId as string));
  return inAnchor.filter((c) => !c.deleted || parentsWithReplies.has(c.id));
}
