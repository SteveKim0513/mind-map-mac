// @vitest-environment jsdom
// 공유 폴더 노트 탭의 저장(flushSaves·closeTab의 flushTab 분기) 계약 — 구현체(sharedNoteSave·복제 큐)가 바뀌어도 유지돼야 하는
// **관찰 가능한** 동작만 고정한다:
//   1) 공유 노트는 화면의 (낡을 수 있는) 본문을 절대 디스크에 쓰지 않는다 — 본문은 복제 매니저가 단일 쓰기 주체다.
//   2) 프론트매터(제목·노드 연결 links)만 갱신하고, 제목을 보낸 뒤에는 titleEdited가 풀린다(markTitleSynced).
//   3) 공유가 아닌 노트는 예전처럼 화면 본문을 그대로 저장한다(대조군 — 분기 자체가 사라져도 알아챈다).
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { parseNote, serializeNote } from '../io/noteFormat';
import type { NoteDoc, ShareMarker } from '../types';
import type { NoteStore } from './noteStore';

const disk = new Map<string, string>();
const saves: { path: string; content: string }[] = [];
const mockSave = vi.fn(async (path: string, content: string) => {
  saves.push({ path, content });
  disk.set(path, content);
  return path;
});
const mockReadFile = vi.fn(async (path: string) => {
  const v = disk.get(path);
  if (v === undefined) throw new Error('ENOENT');
  return v;
});
vi.stubGlobal('api', { save: mockSave, readFile: mockReadFile });

const { useSession } = await import('./sessionStore');
const { useShare } = await import('./shareStore');
type ShareRoomT = ReturnType<typeof useShare.getState>['rooms'][string];

const SHARED = '/ws/기획/memo.md';
const LOCAL = '/ws/개인/memo.md';
const DISK_BODY = '디스크의 진짜 본문\n\n다른 참가자가 방금 쓴 문장';
const STALE_BODY = '화면에 남아 있는 (오래된) 본문';

const base = (over: Partial<NoteDoc> = {}): NoteDoc => ({ id: 'n1', title: '회의 메모', body: STALE_BODY, links: [], ...over });

function registerRoom() {
  const marker = { v: 1, roomId: 'room-AAAAAAAA', relayUrl: 'https://relay.example.com', role: 'participant', participantId: 'p1', folderName: '기획', displayName: '나' } as ShareMarker;
  const room = {
    marker,
    folderPath: '/ws/기획',
    status: 'connected',
    error: null,
    participants: [],
    docs: {},
    notes: { [SHARED]: 'n1' },
    files: {},
    replica: { onLocalTitleChanged: vi.fn(), ensureNoteDoc: vi.fn(async () => null) },
  } as unknown as ShareRoomT;
  useShare.setState({ rooms: { 'room-AAAAAAAA': room } });
}

/** 탭을 열고(화면 상태 = STALE_BODY) 디스크에는 다른 참가자가 쓴 최신 본문을 둔다. */
function openNoteTab(path: string): NoteStore {
  disk.set(path, serializeNote(base({ body: DISK_BODY })));
  useSession.getState().openPath(path, serializeNote(base()));
  return useSession.getState().tabs.find((t) => t.path === path)!.store as NoteStore;
}

const bodiesWritten = () => saves.map((s) => parseNote(s.content).body);
const diskNote = (path: string) => parseNote(disk.get(path)!);

beforeEach(() => {
  disk.clear();
  saves.length = 0;
  mockSave.mockClear();
  mockReadFile.mockClear();
  useShare.setState({ rooms: {} });
  useSession.setState({ tabs: [], leftTabs: [], leftActive: null, rightTabs: [], rightActive: null, split: false, activeGroup: 0, recent: [] });
});

describe('flushSaves — 공유 노트는 본문을 쓰지 않는다', () => {
  it('제목을 고쳤을 때(titleEdited true): 본문은 디스크 그대로, 프론트매터 제목만 바뀌고 titleEdited가 풀린다', async () => {
    registerRoom();
    const store = openNoteTab(SHARED);
    store.getState().setTitle('새 제목');
    expect(store.getState().dirty).toBe(true);
    expect(store.getState().titleEdited).toBe(true);

    await useSession.getState().flushSaves(SHARED);

    expect(bodiesWritten().every((b) => b === DISK_BODY)).toBe(true); // 낡은 화면 본문은 한 번도 쓰이지 않았다
    expect(diskNote(SHARED).body).toBe(DISK_BODY);
    expect(diskNote(SHARED).title).toBe('새 제목');
    expect(store.getState().titleEdited).toBe(false); // markTitleSynced
    expect(store.getState().dirty).toBe(false); // markSaved
  });

  it('제목을 안 고쳤을 때(titleEdited false): 본문뿐 아니라 제목도 낡은 화면 값으로 덮지 않는다', async () => {
    registerRoom();
    const store = openNoteTab(SHARED);
    disk.set(SHARED, serializeNote(base({ title: '상대가 바꾼 제목', body: DISK_BODY }))); // 그 사이 원격이 제목을 바꿨다
    store.getState().setBody('화면에서 고친 본문'); // dirty지만 제목은 손대지 않음
    expect(store.getState().titleEdited).toBe(false);

    await useSession.getState().flushSaves(SHARED);

    expect(bodiesWritten().every((b) => b === DISK_BODY)).toBe(true);
    expect(diskNote(SHARED).body).toBe(DISK_BODY);
    expect(diskNote(SHARED).title).toBe('상대가 바꾼 제목');
    expect(store.getState().titleEdited).toBe(false);
    expect(store.getState().dirty).toBe(false);
  });

  it('노드 연결(links)은 기기 로컬 프론트매터라 저장되고, 본문은 여전히 디스크 그대로다', async () => {
    registerRoom();
    const store = openNoteTab(SHARED);
    store.getState().addLink({ mapId: 'm1', nodeId: 'x', nodeText: '노드' });

    await useSession.getState().flushSaves(SHARED);

    expect(diskNote(SHARED).links).toEqual([{ mapId: 'm1', nodeId: 'x', nodeText: '노드' }]);
    expect(diskNote(SHARED).body).toBe(DISK_BODY);
    expect(store.getState().dirty).toBe(false);
  });

  it('파일이 사라졌으면(읽기 실패) 아무것도 쓰지 않고 dirty를 유지한다(삭제된 파일을 되살리지 않는다)', async () => {
    registerRoom();
    const store = openNoteTab(SHARED);
    store.getState().setTitle('새 제목');
    disk.delete(SHARED);

    await useSession.getState().flushSaves(SHARED);

    expect(saves).toHaveLength(0);
    expect(store.getState().dirty).toBe(true);
    expect(store.getState().titleEdited).toBe(true);
  });
});

describe('closeTab — 닫을 때도 같은 계약', () => {
  it.each([
    ['제목을 고친 경우', (s: NoteStore) => s.getState().setTitle('닫기 전 제목'), '닫기 전 제목'],
    ['본문만 고친 경우', (s: NoteStore) => s.getState().setBody('닫기 전 화면 본문'), '회의 메모'],
  ])('%s: 본문을 쓰지 않고 탭을 닫는다', async (_name, edit, expectedTitle) => {
    registerRoom();
    const store = openNoteTab(SHARED);
    edit(store);
    const tabId = useSession.getState().tabs[0].id;

    await useSession.getState().closeTab(tabId);

    expect(useSession.getState().tabs).toHaveLength(0);
    expect(bodiesWritten().every((b) => b === DISK_BODY)).toBe(true);
    expect(diskNote(SHARED).body).toBe(DISK_BODY);
    expect(diskNote(SHARED).title).toBe(expectedTitle);
  });
});

describe('대조군 — 공유가 아닌 노트는 화면 본문을 그대로 저장한다', () => {
  it('flushSaves가 화면 본문을 디스크에 쓴다', async () => {
    const store = openNoteTab(LOCAL); // 방에 등록되지 않은 경로
    store.getState().setBody('내 노트의 새 본문');

    await useSession.getState().flushSaves(LOCAL);

    expect(saves).toHaveLength(1);
    expect(diskNote(LOCAL).body).toBe('내 노트의 새 본문');
    expect(store.getState().dirty).toBe(false);
  });
});
