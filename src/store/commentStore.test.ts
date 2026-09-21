import { beforeEach, describe, expect, it } from 'vitest';
import { anchorKey } from '../io/commentFormat';
import type { Comment, CommentAnchor, ShareMarker } from '../types';
import { commentCount, commentTargetForFile, commentTargetForNote, countByAnchor, threadFor, useComments } from './commentStore';
import { useShare } from './shareStore';

const ROOM = 'room-abcdef12';
const NODE_A: CommentAnchor = { kind: 'map', fileId: 'file-1', targetId: 'A' };
const NODE_B: CommentAnchor = { kind: 'map', fileId: 'file-1', targetId: 'B' };
const NOTE: CommentAnchor = { kind: 'note', noteId: 'note-1' };

let seq = 0;
const c = (anchor: CommentAnchor, over: Partial<Comment> = {}): Comment => ({
  id: `c${++seq}`,
  anchor,
  authorId: 'participant-1',
  authorName: '민수',
  text: '내용',
  createdAt: seq,
  ...over,
});

describe('commentStore — per-anchor counts', () => {
  beforeEach(() => {
    useComments.setState({ rooms: {}, controls: {} });
  });

  it('counts live comments per anchor and ignores deleted ones and labels', () => {
    const list = [c(NODE_A), c({ ...NODE_A, label: '다른 라벨' }), c(NODE_B), c(NOTE), c(NODE_A, { deleted: true, text: '' })];
    const counts = countByAnchor(list);
    expect(counts[anchorKey(NODE_A)]).toBe(2);
    expect(counts[anchorKey(NODE_B)]).toBe(1);
    expect(counts[anchorKey(NOTE)]).toBe(1);
  });

  it('setRoomComments keeps rooms separate and exposes counts', () => {
    useComments.getState().setRoomComments(ROOM, [c(NODE_A), c(NODE_A)]);
    useComments.getState().setRoomComments('room-other123', [c(NODE_A)]);
    const rooms = useComments.getState().rooms;
    expect(commentCount(rooms, ROOM, NODE_A)).toBe(2);
    expect(commentCount(rooms, 'room-other123', NODE_A)).toBe(1);
    expect(commentCount(rooms, ROOM, NODE_B)).toBe(0);
    expect(commentCount(rooms, 'room-missing1', NODE_A)).toBe(0);
    useComments.getState().clearRoom(ROOM);
    expect(commentCount(useComments.getState().rooms, ROOM, NODE_A)).toBe(0);
  });

  it('controls are per room and removable', () => {
    const controls = { add: () => ({ ok: false as const, error: 'not_ready' as const }), remove: () => false };
    useComments.getState().setControls(ROOM, controls);
    expect(useComments.getState().getControls(ROOM)).toBe(controls);
    expect(useComments.getState().getControls('room-other123')).toBeUndefined();
    useComments.getState().setControls(ROOM, null);
    expect(useComments.getState().getControls(ROOM)).toBeUndefined();
  });
});

describe('threadFor', () => {
  it('returns one anchor’s thread only, oldest first as given', () => {
    const a1 = c(NODE_A);
    const b1 = c(NODE_B);
    const a2 = c(NODE_A, { parentId: a1.id });
    expect(threadFor([a1, b1, a2], NODE_A).map((x) => x.id)).toEqual([a1.id, a2.id]);
  });

  it('hides a deleted comment unless a live reply still hangs under it', () => {
    const gone = c(NODE_A, { deleted: true, text: '' });
    const goneWithReply = c(NODE_A, { deleted: true, text: '' });
    const reply = c(NODE_A, { parentId: goneWithReply.id });
    expect(threadFor([gone, goneWithReply, reply], NODE_A).map((x) => x.id)).toEqual([goneWithReply.id, reply.id]);
  });
});

describe('comment targets (only shared files can be commented on)', () => {
  const marker = (role: 'owner' | 'participant'): ShareMarker => ({
    v: 1,
    roomId: ROOM,
    relayUrl: 'https://relay.example.com',
    role,
    participantId: 'participant-1',
    folderName: '기획',
    displayName: '민수',
  });
  beforeEach(() => {
    useShare.getState().setMarkers([{ folderPath: '/ws/기획', marker: marker('participant') }]);
    useShare.getState().setRoomFiles(ROOM, { '/ws/기획/계획.mind': 'file-1', '/ws/기획/아이디어.board': 'file-2' });
    useShare.getState().setRoomNotes(ROOM, { '/ws/기획/회의.md': 'note-1' });
  });

  it('maps a shared map/board path to room + file id + kind', () => {
    const rooms = useShare.getState().rooms;
    expect(commentTargetForFile(rooms, '/ws/기획/계획.mind')).toEqual({ roomId: ROOM, fileId: 'file-1', kind: 'map' });
    expect(commentTargetForFile(rooms, '/ws/기획/아이디어.board')).toEqual({ roomId: ROOM, fileId: 'file-2', kind: 'board' });
  });

  it('gives nothing for ordinary files: outside a shared folder, or a local-only file inside one', () => {
    const rooms = useShare.getState().rooms;
    expect(commentTargetForFile(rooms, '/ws/개인/메모.mind')).toBeNull();
    expect(commentTargetForFile(rooms, '/ws/기획/내가 만든 맵.mind')).toBeNull(); // participant's own local file: not published
    expect(commentTargetForFile(rooms, null)).toBeNull();
    expect(commentTargetForFile({}, '/ws/기획/계획.mind')).toBeNull();
  });

  it('maps a shared note path to room + note id, and ordinary notes to nothing', () => {
    const rooms = useShare.getState().rooms;
    expect(commentTargetForNote(rooms, '/ws/기획/회의.md')).toEqual({ roomId: ROOM, noteId: 'note-1' });
    expect(commentTargetForNote(rooms, '/ws/개인/일기.md')).toBeNull();
    expect(commentTargetForNote(rooms, null)).toBeNull();
  });
});
