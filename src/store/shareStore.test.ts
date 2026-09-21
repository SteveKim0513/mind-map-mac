// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { Awareness } from 'y-protocols/awareness';
import type { ShareMarker, ShareParticipant } from '../types';
import { findRoomForPath, isViewerFile, roleForPath, useShare } from './shareStore';

function marker(roomId: string, role: ShareMarker['role'] = 'participant'): ShareMarker {
  return {
    v: 1,
    roomId,
    relayUrl: 'https://relay.example.com',
    role,
    participantId: 'pid-AAAAAAAAAAAA',
    folderName: 'f',
    displayName: '지호',
  };
}
const R1 = 'room-AAAAAAAA';
const R2 = 'room-BBBBBBBB';

function entry() {
  const ydoc = new Y.Doc();
  return { ydoc, awareness: new Awareness(ydoc) };
}

beforeEach(() => {
  useShare.setState({ rooms: {} });
});

describe('setMarkers', () => {
  it('표식으로 방을 만든다(초기 상태 idle)', () => {
    useShare.getState().setMarkers([{ folderPath: '/ws/team', marker: marker(R1, 'owner') }]);
    expect(useShare.getState().getRoom(R1)).toMatchObject({
      folderPath: '/ws/team',
      status: 'idle',
      error: null,
      participants: [],
      docs: {},
      marker: { role: 'owner' },
    });
  });

  it('재호출 시 기존 방의 상태·문서는 유지하고 표식·경로만 갱신, 사라진 방은 제거', () => {
    const s = useShare.getState();
    s.setMarkers([
      { folderPath: '/ws/a', marker: marker(R1) },
      { folderPath: '/ws/b', marker: marker(R2) },
    ]);
    const e = entry();
    s.setStatus(R1, 'connected');
    s.registerDoc(R1, 'manifest', e);

    s.setMarkers([{ folderPath: '/ws/renamed', marker: { ...marker(R1), displayName: '새이름' } }]);
    const r1 = useShare.getState().getRoom(R1)!;
    expect(r1.folderPath).toBe('/ws/renamed');
    expect(r1.marker.displayName).toBe('새이름');
    expect(r1.status).toBe('connected');
    expect(r1.docs.manifest).toBe(e);
    expect(useShare.getState().getRoom(R2)).toBeUndefined();
  });

  it('같은 roomId 표식이 두 폴더에 있으면(폴더 복사) 경로순 첫 폴더만 쓴다', () => {
    useShare.getState().setMarkers([
      { folderPath: '/ws/z-copy', marker: marker(R1) },
      { folderPath: '/ws/a-orig', marker: marker(R1) },
    ]);
    expect(Object.keys(useShare.getState().rooms)).toEqual([R1]);
    expect(useShare.getState().getRoom(R1)!.folderPath).toBe('/ws/a-orig');
  });
});

describe('상태 액션', () => {
  beforeEach(() => {
    useShare.getState().setMarkers([{ folderPath: '/ws/a', marker: marker(R1) }]);
  });

  it('setStatus는 오류 코드를 함께 기록하고, 오류 없이 호출하면 지운다', () => {
    const s = useShare.getState();
    s.setStatus(R1, 'denied', 'no_token');
    expect(s.getRoom(R1)).toMatchObject({ status: 'denied', error: 'no_token' });
    s.setStatus(R1, 'connecting');
    expect(s.getRoom(R1)).toMatchObject({ status: 'connecting', error: null });
  });

  it('setParticipants', () => {
    const p: ShareParticipant = { participantId: 'pid-AAAAAAAAAAAA', displayName: '지호', role: 'owner', joinedAt: 1, online: true };
    useShare.getState().setParticipants(R1, [p]);
    expect(useShare.getState().getRoom(R1)!.participants).toEqual([p]);
  });

  it('registerDoc / getDoc / unregisterDoc', () => {
    const s = useShare.getState();
    const e1 = entry();
    const e2 = entry();
    s.registerDoc(R1, 'note:n1', e1);
    s.registerDoc(R1, 'note:n2', e2);
    expect(s.getDoc(R1, 'note:n1')).toBe(e1);
    expect(s.getDoc(R1, 'note:n2')).toBe(e2);
    s.unregisterDoc(R1, 'note:n1');
    expect(s.getDoc(R1, 'note:n1')).toBeUndefined();
    expect(s.getDoc(R1, 'note:n2')).toBe(e2);
    s.unregisterDoc(R1, 'note:none'); // 없는 문서 — 무시
  });

  it('없는 방에 대한 (늦게 도착한) 이벤트는 무시한다', () => {
    const s = useShare.getState();
    s.setStatus(R2, 'connected');
    s.setParticipants(R2, []);
    s.registerDoc(R2, 'manifest', entry());
    s.unregisterDoc(R2, 'manifest');
    expect(s.getRoom(R2)).toBeUndefined();
    expect(Object.keys(useShare.getState().rooms)).toEqual([R1]);
  });

  it('removeRoom', () => {
    useShare.getState().removeRoom(R1);
    expect(useShare.getState().rooms).toEqual({});
    useShare.getState().removeRoom(R1); // 멱등
  });

  it('프로토타입 키(__proto__/constructor)로 조회해도 가짜 방이 나오지 않는다', () => {
    const s = useShare.getState();
    expect(s.getRoom('__proto__')).toBeUndefined();
    expect(s.getRoom('constructor')).toBeUndefined();
    expect(s.getDoc(R1, '__proto__')).toBeUndefined();
    expect(s.getDoc(R1, 'constructor')).toBeUndefined();
    s.setStatus('constructor', 'connected');
    expect(Object.keys(useShare.getState().rooms)).toEqual([R1]);
  });

  it('불변 갱신 — 다른 방의 참조는 그대로', () => {
    const s = useShare.getState();
    s.setMarkers([
      { folderPath: '/ws/a', marker: marker(R1) },
      { folderPath: '/ws/b', marker: marker(R2) },
    ]);
    const before = useShare.getState().rooms;
    s.setStatus(R1, 'connected');
    const after = useShare.getState().rooms;
    expect(after).not.toBe(before);
    expect(after[R2]).toBe(before[R2]);
    expect(after[R1]).not.toBe(before[R1]);
  });
});

describe('findRoomForPath / roleForPath', () => {
  it('가장 깊이 일치하는 공유 폴더를 찾고, 접두사만 같은 폴더는 무시', () => {
    useShare.getState().setMarkers([
      { folderPath: '/ws/team', marker: marker(R1, 'participant') },
      { folderPath: '/ws/team/inner', marker: marker(R2, 'owner') },
    ]);
    const rooms = useShare.getState().rooms;
    expect(findRoomForPath(rooms, '/ws/team/a.md')?.marker.roomId).toBe(R1);
    expect(findRoomForPath(rooms, '/ws/team/inner/x/b.mind')?.marker.roomId).toBe(R2);
    expect(findRoomForPath(rooms, '/ws/team')?.marker.roomId).toBe(R1);
    expect(findRoomForPath(rooms, '/ws/teammate/a.md')).toBeUndefined();
    expect(findRoomForPath(rooms, '/ws/other.md')).toBeUndefined();
    expect(roleForPath(rooms, '/ws/team/a.md')).toBe('participant');
    expect(roleForPath(rooms, '/ws/team/inner/b.mind')).toBe('owner');
    expect(roleForPath(rooms, '/ws/other.md')).toBeNull();
  });
});

describe('공유 노트 조회(isSharedNote·sharedNoteAt)', () => {
  it('복제 매니저가 등록한 경로만 공유 노트로 취급한다', () => {
    const s = useShare.getState();
    s.setMarkers([{ folderPath: '/ws/team', marker: marker(R1, 'participant') }]);
    expect(s.isSharedNote('/ws/team/a.md')).toBe(false); // 방 안이어도 등록 전에는 아니다
    s.setRoomNotes(R1, { '/ws/team/a.md': 'note-a', '/ws/team/sub/b.md': 'note-b' });
    expect(useShare.getState().isSharedNote('/ws/team/a.md')).toBe(true);
    expect(useShare.getState().isSharedNote('/ws/team/c.md')).toBe(false);
    expect(useShare.getState().isSharedNote('/ws/other/a.md')).toBe(false);
    expect(useShare.getState().sharedNoteAt('/ws/team/sub/b.md')).toEqual({
      roomId: R1,
      noteId: 'note-b',
      role: 'participant',
    });
    expect(useShare.getState().sharedNoteAt('/ws/team/c.md')).toBeNull();
  });

  it('setMarkers 재호출·상태 변경에도 노트 맵과 제어 핸들은 유지되고 방이 사라지면 함께 사라진다', () => {
    const s = useShare.getState();
    s.setMarkers([{ folderPath: '/ws/team', marker: marker(R1, 'owner') }]);
    s.setRoomNotes(R1, { '/ws/team/a.md': 'note-a' });
    const controls = { onLocalTitleChanged: () => {}, ensureNoteDoc: async () => null, patchLocalNote: async () => ({ status: 'not_shared' as const }) };
    s.setReplicaControls(R1, controls);
    useShare.getState().setMarkers([{ folderPath: '/ws/team', marker: marker(R1, 'owner') }]);
    useShare.getState().setStatus(R1, 'connected');
    expect(useShare.getState().isSharedNote('/ws/team/a.md')).toBe(true);
    expect(useShare.getState().getRoom(R1)?.replica).toBe(controls);
    useShare.getState().setMarkers([]);
    expect(useShare.getState().isSharedNote('/ws/team/a.md')).toBe(false);
  });

  it('없는 방에 대한 등록은 무시한다', () => {
    useShare.getState().setRoomNotes('nope-nope-nope', { '/x.md': 'n' });
    expect(useShare.getState().isSharedNote('/x.md')).toBe(false);
  });
});

describe('setMarkers — 폴더 이동·충돌·유지', () => {
  it('기존 방의 폴더가 바뀌면 경로 맵(노트·파일)도 새 경로로 옮긴다 — 이름 변경 직후에도 공유 노트가 일반 노트로 보이는 틈이 없다', () => {
    const s = useShare.getState();
    s.setMarkers([{ folderPath: '/ws/team', marker: marker(R1) }]);
    s.setRoomNotes(R1, { '/ws/team/a.md': 'note-a', '/ws/team/sub/b.md': 'note-b' });
    s.setRoomFiles(R1, { '/ws/team/plan.mind': 'file-1' });
    useShare.getState().setMarkers([{ folderPath: '/ws/renamed', marker: marker(R1) }]);
    const room = useShare.getState().getRoom(R1)!;
    expect(room.folderPath).toBe('/ws/renamed');
    expect(room.notes).toEqual({ '/ws/renamed/a.md': 'note-a', '/ws/renamed/sub/b.md': 'note-b' });
    expect(room.files).toEqual({ '/ws/renamed/plan.mind': 'file-1' });
    expect(useShare.getState().isSharedNote('/ws/renamed/a.md')).toBe(true);
    expect(useShare.getState().isSharedNote('/ws/team/a.md')).toBe(false);
  });

  it('접두사만 같은 폴더의 경로는 옮기지 않는다(/ws/team vs /ws/team2)', () => {
    const s = useShare.getState();
    s.setMarkers([{ folderPath: '/ws/team', marker: marker(R1) }]);
    s.setRoomNotes(R1, { '/ws/team/a.md': 'note-a', '/ws/team2/x.md': 'stray' });
    useShare.getState().setMarkers([{ folderPath: '/ws/other', marker: marker(R1) }]);
    expect(useShare.getState().getRoom(R1)!.notes).toEqual({ '/ws/other/a.md': 'note-a', '/ws/team2/x.md': 'stray' });
  });

  it('keep에 든 방은 이번 스캔에 안 보여도 지우지 않는다(일시적 스캔 실패)', () => {
    const s = useShare.getState();
    s.setMarkers([
      { folderPath: '/ws/a', marker: marker(R1) },
      { folderPath: '/ws/b', marker: marker(R2) },
    ]);
    s.setStatus(R2, 'connected');
    useShare.getState().setMarkers([{ folderPath: '/ws/a', marker: marker(R1) }], { keep: [R2, 'room-nope1234'] });
    expect(Object.keys(useShare.getState().rooms).sort()).toEqual([R1, R2]);
    expect(useShare.getState().getRoom(R2)).toMatchObject({ status: 'connected', folderPath: '/ws/b' }); // 상태·경로 그대로
    useShare.getState().setMarkers([{ folderPath: '/ws/a', marker: marker(R1) }]);
    expect(Object.keys(useShare.getState().rooms)).toEqual([R1]);
  });

  it('같은 roomId의 표식이 여러 폴더에 있으면 기존 방의 폴더(없으면 경로순 첫 폴더)에 연결하고 나머지는 conflictPaths', () => {
    useShare.getState().setMarkers([
      { folderPath: '/ws/z-copy', marker: marker(R1) },
      { folderPath: '/ws/b-orig', marker: marker(R1) },
    ]);
    let room = useShare.getState().getRoom(R1)!;
    expect(room.folderPath).toBe('/ws/b-orig'); // 처음엔 경로순
    expect(room.conflictPaths).toEqual(['/ws/z-copy']);
    // 이후 더 앞선 이름의 복사본이 생겨도 이미 연결된 폴더가 이긴다
    useShare.getState().setMarkers([
      { folderPath: '/ws/a-copy', marker: marker(R1) },
      { folderPath: '/ws/b-orig', marker: marker(R1) },
      { folderPath: '/ws/z-copy', marker: marker(R1) },
    ]);
    room = useShare.getState().getRoom(R1)!;
    expect(room.folderPath).toBe('/ws/b-orig');
    expect(room.conflictPaths).toEqual(['/ws/a-copy', '/ws/z-copy']);
    // 연결돼 있던 폴더가 사라지면(이동) 남은 후보 중 경로순 첫 폴더
    useShare.getState().setMarkers([
      { folderPath: '/ws/a-copy', marker: marker(R1) },
      { folderPath: '/ws/z-copy', marker: marker(R1) },
    ]);
    room = useShare.getState().getRoom(R1)!;
    expect(room.folderPath).toBe('/ws/a-copy');
    expect(room.conflictPaths).toEqual(['/ws/z-copy']);
  });
});

describe('relocateFolder — 사이드바가 이동 직후 부르는 즉시 재매핑', () => {
  beforeEach(() => {
    const s = useShare.getState();
    s.setMarkers([
      { folderPath: '/ws/team', marker: marker(R1) },
      { folderPath: '/ws/proj/deep', marker: marker(R2) },
    ]);
    s.setRoomNotes(R1, { '/ws/team/a.md': 'note-a' });
    s.setRoomFiles(R1, { '/ws/team/p.mind': 'f1' });
    s.setRoomNotes(R2, { '/ws/proj/deep/c.md': 'note-c' });
  });

  it('공유 폴더 자체의 이름 변경', () => {
    useShare.getState().relocateFolder('/ws/team', '/ws/팀');
    const room = useShare.getState().getRoom(R1)!;
    expect(room.folderPath).toBe('/ws/팀');
    expect(room.notes).toEqual({ '/ws/팀/a.md': 'note-a' });
    expect(room.files).toEqual({ '/ws/팀/p.mind': 'f1' });
    expect(useShare.getState().getRoom(R2)!.folderPath).toBe('/ws/proj/deep'); // 다른 방은 그대로
  });

  it('공유 폴더를 품은 상위 폴더의 이동·이름 변경', () => {
    useShare.getState().relocateFolder('/ws/proj', '/ws/archive/proj2');
    const room = useShare.getState().getRoom(R2)!;
    expect(room.folderPath).toBe('/ws/archive/proj2/deep');
    expect(room.notes).toEqual({ '/ws/archive/proj2/deep/c.md': 'note-c' });
    expect(useShare.getState().isSharedNote('/ws/archive/proj2/deep/c.md')).toBe(true);
  });

  it('관계없는 경로·같은 경로·파일 이동·접두사만 같은 형제는 아무것도 바꾸지 않는다', () => {
    const before = useShare.getState().rooms;
    useShare.getState().relocateFolder('/ws/other', '/ws/other2');
    useShare.getState().relocateFolder('/ws/team', '/ws/team');
    useShare.getState().relocateFolder('/ws/team/a.md', '/ws/team/b.md'); // 파일 하나의 이동
    useShare.getState().relocateFolder('/ws/tea', '/ws/x'); // 접두사만 같은 형제
    useShare.getState().relocateFolder('', '/ws/x');
    expect(useShare.getState().rooms).toBe(before); // 참조까지 그대로(불필요한 리렌더 없음)
  });

  it('뷰어 미러(files)도 따라가서 이동 직후에도 읽기 전용이 유지된다', () => {
    useShare.getState().setMarkers([{ folderPath: '/ws/team', marker: marker(R1, 'participant') }]);
    useShare.getState().setRoomFiles(R1, { '/ws/team/p.mind': 'f1' });
    useShare.getState().relocateFolder('/ws/team', '/ws/renamed');
    expect(isViewerFile(useShare.getState().rooms, '/ws/renamed/p.mind')).toBe(true);
    expect(isViewerFile(useShare.getState().rooms, '/ws/team/p.mind')).toBe(false);
  });
});

describe('setMarkerRole·setDocProblem', () => {
  it('서버가 알려 준 역할로 표식 역할만 바꾼다(다른 값·상태는 그대로)', () => {
    useShare.getState().setMarkers([{ folderPath: '/ws/team', marker: marker(R1, 'owner') }]);
    useShare.getState().setStatus(R1, 'connected');
    useShare.getState().setMarkerRole(R1, 'participant');
    expect(useShare.getState().getRoom(R1)).toMatchObject({ status: 'connected', marker: { role: 'participant', participantId: 'pid-AAAAAAAAAAAA' } });
    const before = useShare.getState().rooms;
    useShare.getState().setMarkerRole(R1, 'participant'); // 같은 값이면 참조 유지
    expect(useShare.getState().rooms).toBe(before);
    useShare.getState().setMarkerRole('nope-nope-nope', 'owner'); // 없는 방은 무시
  });

  it('문서 문제 기록·해제(사유 문자열, 같은 값이면 참조 유지, 없는 방 무시)', () => {
    useShare.getState().setMarkers([{ folderPath: '/ws/team', marker: marker(R1) }]);
    useShare.getState().setDocProblem(R1, 'manifest', 'room_full');
    useShare.getState().setDocProblem(R1, 'note:n1', 'doc_too_large');
    expect(useShare.getState().getRoom(R1)!.docProblems).toEqual({ manifest: 'room_full', 'note:n1': 'doc_too_large' });
    const before = useShare.getState().rooms;
    useShare.getState().setDocProblem(R1, 'manifest', 'room_full');
    expect(useShare.getState().rooms).toBe(before);
    useShare.getState().setDocProblem(R1, 'manifest', null);
    expect(useShare.getState().getRoom(R1)!.docProblems).toEqual({ 'note:n1': 'doc_too_large' });
    useShare.getState().setDocProblem('nope-nope-nope', 'manifest', 'x');
    // 프로토타입 오염 키도 안전하다
    useShare.getState().setDocProblem(R1, '__proto__', 'x');
    expect(({} as Record<string, unknown>).x).toBeUndefined();
  });
});
