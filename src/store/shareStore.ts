import { useMemo } from 'react';
import { create } from 'zustand';
import type * as Y from 'yjs';
import type { Awareness } from 'y-protocols/awareness';
import type { NoteDoc, ShareConnStatus, ShareMarker, ShareParticipant, ShareRole } from '../types';

/** 등록된 공유 문서 — Y.Doc과 그 awareness(커서·프레즌스). 소유는 src/share/ 세션이 갖는다. */
export interface ShareDocEntry {
  ydoc: Y.Doc;
  awareness: Awareness;
}

/**
 * 방의 노트 복제 매니저(share/replica)가 store에 등록하는 제어 핸들 — note/ 같은 다른 도메인이
 * share/를 import하지 않고 store를 통해서만 매니저에 접근하게 한다(6b 에디터가 사용).
 */
export interface ReplicaControls {
  /** 로컬에서 노트 제목이 바뀌었음을 알린다(manifest 제목 갱신). 같은 제목이면 무시. */
  onLocalTitleChanged: (noteId: string, title: string) => void;
  /** 노트 문서를 (아직 안 열렸으면 열어서) 돌려준다 — 에디터가 Collaboration에 붙일 Y.Doc·awareness. */
  ensureNoteDoc: (noteId: string) => Promise<ShareDocEntry | null>;
  /**
   * 공유 노트 파일을 **복제 매니저의 직렬 큐 안에서** 고친다(다시 읽기 → 변경 → 쓰기). 공유 노트 파일의 단일 쓰기 주체는 매니저이므로
   * `readFile → 필드 교체 → save`를 큐 밖에서 하면 그 사이에 매니저가 쓴 원격 편집이 옛 본문으로 되돌아간다 — 링크·메타·제목·본문
   * 일괄 치환 같은 로컬 변경은 반드시 이 경로를 쓴다. `mutator`가 null을 돌려주면 변경 없음.
   */
  patchLocalNote: (path: string, mutator: (note: NoteDoc) => NoteDoc | null, hint?: { noteId: string }) => Promise<PatchNoteResult>;
}

/** `patchLocalNote`의 결과. */
export type PatchNoteResult =
  | { status: 'not_shared' } // 이 경로는 (이 방에서) 공유 노트가 아니다 — 호출자가 일반 노트 경로로 처리한다
  | { status: 'unchanged'; note: NoteDoc; path: string }
  | { status: 'written'; note: NoteDoc; path: string }
  | { status: 'failed' }; // 읽기·쓰기 실패(파일이 사라짐 등) — 아무것도 쓰지 않았다

/** 공유 폴더(방) 하나의 렌더러 상태. */
export interface ShareRoom {
  marker: ShareMarker;
  /** 이 공유 폴더의 절대 경로(워크스페이스 안). */
  folderPath: string;
  status: ShareConnStatus;
  /** 마지막 연결/설정 오류 코드(사람이 읽는 문구가 아니라 코드). 정상이면 null. */
  error: string | null;
  participants: ShareParticipant[];
  /** docKey → 열려 있는 문서. */
  docs: Record<string, ShareDocEntry>;
  /**
   * 같은 roomId의 표식이 있는 **다른 폴더**들(Finder 복사본 등). 이 방은 `folderPath` 하나에만 연결되고 이 폴더들은 연결하지 않는다 —
   * 어느 쪽이 진짜인지 자동으로 고르지 않고 사용자에게 충돌로 보여 준다.
   */
  conflictPaths?: string[];
  /** 접근 해제가 아닌 사유로 열지 못한 문서들(docKey → 사유 코드) — 세션은 살아 있고 재시도 중이다. */
  docProblems?: Record<string, string>;
  /** 이 방 폴더 안에서 공유 중인 노트: 절대 경로 → noteId. 노트 복제 매니저가 채운다. */
  notes: Record<string, string>;
  /** 노트 복제 매니저의 제어 핸들(없으면 null). */
  replica: ReplicaControls | null;
  /**
   * 이 방 폴더 안에서 공유 중인 맵·보드: 절대 경로 → fileId. 파일 복제 매니저가 채운다.
   * 소유자에게는 발행 중인 파일, 참가자에게는 소유자의 것을 받아 둔 **읽기 전용 미러**다(참가자가 폴더 안에 직접
   * 만든 맵·보드는 여기 없다 — 내 기기에만 있는 로컬 파일이라 편집할 수 있다).
   */
  files: Record<string, string>;
}

interface ShareState {
  /** roomId → 방. `Object.hasOwn`으로만 조회한다(`getRoom`). */
  rooms: Record<string, ShareRoom>;
  /**
   * 워크스페이스에서 발견한 표식으로 방 목록을 맞춘다(기존 방의 상태·문서는 유지, 사라진 방은 제거).
   * `opts.keep`에 든 방은 이번 스캔에 안 보여도 지우지 않는다(일시적 스캔 실패·부분 결과 — 호출자가 히스테리시스로 판단).
   * 같은 roomId의 표식이 여러 폴더에 있으면 기존 방의 폴더(없으면 경로순 첫 폴더)에만 연결하고 나머지는 `conflictPaths`에 둔다.
   * 기존 방의 폴더가 바뀌었으면(이름 변경·이동) 그 폴더 아래의 공유 노트·파일 경로 맵도 새 경로로 옮긴다.
   */
  setMarkers: (entries: { folderPath: string; marker: ShareMarker }[], opts?: { keep?: readonly string[] }) => void;
  /**
   * 폴더(또는 그 상위)가 `oldPath` → `newPath`로 이름이 바뀌거나 옮겨졌다 — 그 아래의 방 폴더·노트·파일 경로를 즉시 옮긴다.
   * 사이드바가 디스크 이동 직후 부른다: 표식 재스캔이 도는 사이에도 공유 노트가 "일반 노트"로 보여 자동저장이 본문을 덮어쓰거나,
   * 뷰어 미러가 편집 가능해지는 틈을 없앤다(연결 재시작은 `refreshShareMarkers`가 이어서 한다).
   */
  relocateFolder: (oldPath: string, newPath: string) => void;
  /** 서버가 알려 준 내 역할로 이 방의 표식 역할을 바로잡는다(로컬 표식 파일은 신뢰하지 않는다). */
  setMarkerRole: (roomId: string, role: ShareRole) => void;
  /** 문서 하나의 열기 실패(사유)를 기록하거나(reason 문자열) 해제한다(null). */
  setDocProblem: (roomId: string, docKey: string, reason: string | null) => void;
  setStatus: (roomId: string, status: ShareConnStatus, error?: string | null) => void;
  setParticipants: (roomId: string, participants: ShareParticipant[]) => void;
  /** 이 방의 공유 노트 경로 맵을 통째로 교체한다. */
  setRoomNotes: (roomId: string, notes: Record<string, string>) => void;
  /** 이 방의 공유 맵·보드 경로 맵을 통째로 교체한다. */
  setRoomFiles: (roomId: string, files: Record<string, string>) => void;
  setReplicaControls: (roomId: string, controls: ReplicaControls | null) => void;
  registerDoc: (roomId: string, docKey: string, entry: ShareDocEntry) => void;
  unregisterDoc: (roomId: string, docKey: string) => void;
  removeRoom: (roomId: string) => void;
  getRoom: (roomId: string) => ShareRoom | undefined;
  getDoc: (roomId: string, docKey: string) => ShareDocEntry | undefined;
  /**
   * `filePath`가 공유 노트(공유 폴더 안에서 복제 매니저가 관리하는 노트)인가. 공유 노트 파일은 복제 매니저가
   * **단일 쓰기 주체**이므로 NotePane 자동저장 같은 다른 쓰기 경로는 이 값이 true면 파일을 쓰지 않아야 한다.
   */
  isSharedNote: (filePath: string) => boolean;
  /** `filePath`의 공유 노트 정보(방·noteId·내 역할). 공유 노트가 아니면 null. */
  sharedNoteAt: (filePath: string) => SharedNoteInfo | null;
}

export interface SharedNoteInfo {
  roomId: string;
  noteId: string;
  role: ShareRole;
}

function has<T extends object>(obj: T, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

const trimSlash = (p: string): string => p.replace(/\/+$/, '');

/** 경로 맵(절대 경로 → id)의 키를 `oldDir/…` → `newDir/…`로 옮긴다. 폴더 밖 키는 그대로. */
function rebasePaths(map: Record<string, string>, oldDir: string, newDir: string): Record<string, string> {
  if (oldDir === newDir) return map;
  const out: Record<string, string> = {};
  for (const [p, id] of Object.entries(map)) {
    const key = p.startsWith(oldDir + '/') ? newDir + p.slice(oldDir.length) : p;
    Object.defineProperty(out, key, { value: id, enumerable: true, writable: true, configurable: true });
  }
  return out;
}

/** 방의 폴더 경로를 `newFolder`로 바꾸고(이름 변경·이동) 공유 노트·파일 경로 맵도 따라 옮긴다. */
function rebaseRoom(room: ShareRoom, newFolder: string): ShareRoom {
  const oldDir = trimSlash(room.folderPath);
  const newDir = trimSlash(newFolder);
  if (oldDir === newDir) return room.folderPath === newFolder ? room : { ...room, folderPath: newFolder };
  return { ...room, folderPath: newFolder, notes: rebasePaths(room.notes, oldDir, newDir), files: rebasePaths(room.files, oldDir, newDir) };
}

/** 방 하나만 갱신한 새 rooms. 방이 없으면 그대로(늦게 도착한 이벤트 무시). */
function patchRoom(
  rooms: Record<string, ShareRoom>,
  roomId: string,
  patch: (room: ShareRoom) => ShareRoom,
): Record<string, ShareRoom> {
  if (!has(rooms, roomId)) return rooms;
  const next = patch(rooms[roomId]);
  return next === rooms[roomId] ? rooms : { ...rooms, [roomId]: next }; // 바뀐 게 없으면 참조 유지(불필요한 리렌더 방지)
}

export const useShare = create<ShareState>((set, get) => ({
  rooms: {},

  setMarkers: (entries, opts) =>
    set((s) => {
      const groups = new Map<string, { folderPath: string; marker: ShareMarker }[]>();
      for (const e of [...entries].sort((a, b) => a.folderPath.localeCompare(b.folderPath))) {
        const g = groups.get(e.marker.roomId);
        if (g) g.push(e);
        else groups.set(e.marker.roomId, [e]);
      }
      const next: Record<string, ShareRoom> = {};
      for (const [roomId, cands] of groups) {
        const prev = has(s.rooms, roomId) ? s.rooms[roomId] : undefined;
        // 기존 방이 연결돼 있던 폴더가 아직 후보에 있으면 그대로(복사본이 방을 가로채지 못하게), 아니면 경로순 첫 폴더.
        const chosen = (prev && cands.find((c) => c.folderPath === prev.folderPath)) || cands[0];
        const conflictPaths = cands.filter((c) => c !== chosen).map((c) => c.folderPath);
        next[roomId] = prev
          ? { ...rebaseRoom(prev, chosen.folderPath), marker: chosen.marker, conflictPaths }
          : {
              marker: chosen.marker,
              folderPath: chosen.folderPath,
              status: 'idle',
              error: null,
              participants: [],
              docs: {},
              conflictPaths,
              docProblems: {},
              notes: {},
              replica: null,
              files: {},
            };
      }
      for (const roomId of opts?.keep ?? []) if (!has(next, roomId) && has(s.rooms, roomId)) next[roomId] = s.rooms[roomId];
      return { rooms: next };
    }),

  relocateFolder: (oldPath, newPath) =>
    set((s) => {
      const from = trimSlash(oldPath);
      const to = trimSlash(newPath);
      if (!from || !to || from === to) return s;
      let changed = false;
      const rooms: Record<string, ShareRoom> = {};
      for (const [id, room] of Object.entries(s.rooms)) {
        const dir = trimSlash(room.folderPath);
        if (dir === from || dir.startsWith(from + '/')) {
          changed = true;
          rooms[id] = rebaseRoom(room, to + dir.slice(from.length));
        } else rooms[id] = room;
      }
      return changed ? { rooms } : s;
    }),

  setMarkerRole: (roomId, role) =>
    set((s) => ({
      rooms: patchRoom(s.rooms, roomId, (r) => (r.marker.role === role ? r : { ...r, marker: { ...r.marker, role } })),
    })),

  setDocProblem: (roomId, docKey, reason) =>
    set((s) => ({
      rooms: patchRoom(s.rooms, roomId, (r) => {
        const problems = r.docProblems ?? {};
        const cur = has(problems, docKey) ? problems[docKey] : null;
        if (cur === reason) return r;
        const docProblems = { ...problems };
        if (reason === null) delete docProblems[docKey];
        else Object.defineProperty(docProblems, docKey, { value: reason, enumerable: true, writable: true, configurable: true });
        return { ...r, docProblems };
      }),
    })),

  setStatus: (roomId, status, error = null) =>
    set((s) => ({ rooms: patchRoom(s.rooms, roomId, (r) => ({ ...r, status, error })) })),

  setParticipants: (roomId, participants) =>
    set((s) => ({ rooms: patchRoom(s.rooms, roomId, (r) => ({ ...r, participants })) })),

  setRoomNotes: (roomId, notes) => set((s) => ({ rooms: patchRoom(s.rooms, roomId, (r) => ({ ...r, notes })) })),

  setRoomFiles: (roomId, files) => set((s) => ({ rooms: patchRoom(s.rooms, roomId, (r) => ({ ...r, files })) })),

  setReplicaControls: (roomId, replica) =>
    set((s) => ({ rooms: patchRoom(s.rooms, roomId, (r) => ({ ...r, replica })) })),

  registerDoc: (roomId, docKey, entry) =>
    set((s) => ({ rooms: patchRoom(s.rooms, roomId, (r) => ({ ...r, docs: { ...r.docs, [docKey]: entry } })) })),

  unregisterDoc: (roomId, docKey) =>
    set((s) => ({
      rooms: patchRoom(s.rooms, roomId, (r) => {
        if (!has(r.docs, docKey)) return r;
        const docs = { ...r.docs };
        delete docs[docKey];
        return { ...r, docs };
      }),
    })),

  removeRoom: (roomId) =>
    set((s) => {
      if (!has(s.rooms, roomId)) return s;
      const rooms = { ...s.rooms };
      delete rooms[roomId];
      return { rooms };
    }),

  getRoom: (roomId) => (has(get().rooms, roomId) ? get().rooms[roomId] : undefined),

  getDoc: (roomId, docKey) => {
    const room = get().getRoom(roomId);
    return room && has(room.docs, docKey) ? room.docs[docKey] : undefined;
  },

  sharedNoteAt: (filePath) => sharedNoteAt(get().rooms, filePath),
  isSharedNote: (filePath) => sharedNoteAt(get().rooms, filePath) !== null,
}));

/** 경로 → 공유 노트 정보(순수). 방 폴더 안이어도 복제 매니저가 아직 등록하지 않은 파일은 null. */
export function sharedNoteAt(rooms: Record<string, ShareRoom>, filePath: string): SharedNoteInfo | null {
  for (const [roomId, room] of Object.entries(rooms)) {
    if (has(room.notes, filePath)) return { roomId, noteId: room.notes[filePath], role: room.marker.role };
  }
  return null;
}

/**
 * `filePath`가 **읽기 전용으로 받은 맵·보드**(참가자의 미러)인가 — 뷰어 모드로 열어야 하는 파일.
 * 참가자가 공유 폴더 안에 직접 만든 로컬 맵·보드, 그리고 소유자 자신의 파일은 false다.
 */
export function isViewerFile(rooms: Record<string, ShareRoom>, filePath: string): boolean {
  const room = findRoomForPath(rooms, filePath);
  return !!room && room.marker.role === 'participant' && has(room.files, filePath);
}

const localOnlyNoticed = new Set<string>();
/**
 * 참가자가 공유 폴더 안에 맵·보드를 새로 만들었을 때 한 번(방마다) 보여 줄 안내 문구 — 소유자 것만 공유되고 내가 만든
 * 파일은 내 기기에만 있다는 것. 보여 줄 필요가 없으면(소유자·공유 폴더 밖·이미 안내함) null.
 */
export function localOnlyFileNotice(rooms: Record<string, ShareRoom>, path: string): string | null {
  const room = findRoomForPath(rooms, path);
  if (!room || room.marker.role !== 'participant' || localOnlyNoticed.has(room.marker.roomId)) return null;
  localOnlyNoticed.add(room.marker.roomId);
  return '이 폴더의 맵·보드는 소유자만 공유해요. 만든 파일은 내 기기에만 있어요';
}

/** 공유 폴더 안의 맵·보드 파일 저장이 끝났음을 알리는 훅 — 소유자의 발행 매니저(share/)가 등록한다(store가 share/를 import하지 않게). */
let fileSavedHook: ((path: string) => void) | null = null;
export function setFileSavedHook(fn: ((path: string) => void) | null): void {
  fileSavedHook = fn;
}
/** 맵·보드 자동저장 직후 호출(Pane·BoardPane·탭 닫기 flush). 훅이 없으면(공유 미사용) 아무 일도 없다. */
export function notifyFileSaved(path: string): void {
  try {
    fileSavedHook?.(path);
  } catch {
    /* 공유 발행 실패가 저장 경로를 깨뜨리면 안 된다 */
  }
}

/**
 * `filePath`가 속한 공유 폴더(가장 깊이 일치하는 folderPath)를 찾는다. 공유 폴더 밖이면 undefined.
 * 노트·맵·보드가 "이 파일은 공유 중인가 / 내 역할은?"을 물을 때 store를 통해 쓴다.
 */
export function findRoomForPath(rooms: Record<string, ShareRoom>, filePath: string): ShareRoom | undefined {
  let best: ShareRoom | undefined;
  for (const room of Object.values(rooms)) {
    const dir = room.folderPath.replace(/\/+$/, '');
    if (filePath === dir || filePath.startsWith(dir + '/')) {
      if (!best || dir.length > best.folderPath.replace(/\/+$/, '').length) best = room;
    }
  }
  return best;
}

/** 파일 경로 → 내 공유 역할(공유 폴더 밖이면 null). */
export function roleForPath(rooms: Record<string, ShareRoom>, filePath: string): ShareRole | null {
  return findRoomForPath(rooms, filePath)?.marker.role ?? null;
}

/**
 * `filePath`의 공유 노트 정보를 구독한다(NotePane용). 객체를 selector가 직접 돌려주면 매 호출마다 새 객체라
 * 무한 재렌더가 나므로, 원시 문자열 키로 구독한 뒤 메모한다.
 */
export function useSharedNoteInfo(filePath: string | null): SharedNoteInfo | null {
  const key = useShare((s) => {
    const info = filePath ? sharedNoteAt(s.rooms, filePath) : null;
    return info ? `${info.roomId}\u0000${info.noteId}\u0000${info.role}` : '';
  });
  return useMemo(() => {
    if (!key) return null;
    const [roomId, noteId, role] = key.split('\u0000');
    return { roomId, noteId, role: role as ShareRole };
  }, [key]);
}
