// @vitest-environment jsdom
// 공유로 받은 읽기 전용 맵·보드(뷰어)의 탭 수명주기 — 열기·저장 제외·실시간 다시 로드·뒤늦은 뷰어 전환.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { emptyDoc, serialize } from '../io/formats';
import { emptyBoard, serializeBoard } from '../io/boardFormat';
import type { BoardStickyElement, MindMapDoc, ShareMarker } from '../types';
import type { BoardStore } from './boardStore';
import type { MapStore } from './mapStore';

const mockSave = vi.fn().mockResolvedValue('/saved');
const mockReadFile = vi.fn();
vi.stubGlobal('api', { save: mockSave, readFile: mockReadFile });

const { useSession } = await import('./sessionStore');
const { isViewerFile, localOnlyFileNotice, setFileSavedHook, useShare } = await import('./shareStore');

const FOLDER = '/ws/team';
const MIRROR_MAP = `${FOLDER}/plan.mind`;
const MIRROR_BOARD = `${FOLDER}/idea.board`;
const OWN_MAP = `${FOLDER}/mine.mind`;

const marker = (role: ShareMarker['role']): ShareMarker => ({
  v: 1,
  roomId: 'room-AAAAAAAA',
  relayUrl: 'https://relay.example.com',
  role,
  participantId: 'pid-AAAAAAAAAAAA',
  folderName: 'team',
  displayName: '나',
});

function setRoom(role: ShareMarker['role'], files: Record<string, string>) {
  useShare.setState({
    rooms: {
      'room-AAAAAAAA': { marker: marker(role), folderPath: FOLDER, status: 'connected', error: null, participants: [], docs: {}, notes: {}, files, replica: null },
    },
  });
}

const mapContent = (text = '루트') => {
  const d: MindMapDoc = emptyDoc();
  d.rootIds = ['r'];
  d.nodes = { r: { id: 'r', text, parentId: null, children: [], collapsed: false } };
  return serialize(d);
};
const boardContent = (text = '스티키') => {
  const b = emptyBoard();
  const s: BoardStickyElement = { id: 's', kind: 'sticky', x: 0, y: 0, width: 100, height: 100, text };
  b.elements = { s };
  b.order = ['s'];
  return serializeBoard(b);
};

const mapStoreOf = (path: string) => useSession.getState().tabs.find((t) => t.path === path)!.store as MapStore;
const boardStoreOf = (path: string) => useSession.getState().tabs.find((t) => t.path === path)!.store as BoardStore;

beforeEach(() => {
  useShare.setState({ rooms: {} });
  useSession.setState({ tabs: [], leftTabs: [], leftActive: null, rightTabs: [], rightActive: null, split: false, activeGroup: 0, recent: [] });
  mockSave.mockClear();
  mockReadFile.mockReset();
  setFileSavedHook(null);
});

describe('isViewerFile', () => {
  it('참가자의 미러 파일만 뷰어다 — 내가 만든 파일·소유자·폴더 밖은 편집 가능', () => {
    setRoom('participant', { [MIRROR_MAP]: 'map-plan' });
    const rooms = useShare.getState().rooms;
    expect(isViewerFile(rooms, MIRROR_MAP)).toBe(true);
    expect(isViewerFile(rooms, OWN_MAP)).toBe(false);
    expect(isViewerFile(rooms, '/ws/elsewhere/plan.mind')).toBe(false);
    setRoom('owner', { [MIRROR_MAP]: 'map-plan' });
    expect(isViewerFile(useShare.getState().rooms, MIRROR_MAP)).toBe(false);
  });
});

describe('뷰어 탭 열기', () => {
  it('미러 맵·보드는 readOnly로 열리고 내 로컬 파일은 편집 가능하다', () => {
    setRoom('participant', { [MIRROR_MAP]: 'map-plan', [MIRROR_BOARD]: 'board-idea' });
    const s = useSession.getState();
    s.openPath(MIRROR_MAP, mapContent());
    s.openPath(MIRROR_BOARD, boardContent());
    s.openPath(OWN_MAP, mapContent('내 것'));
    expect(mapStoreOf(MIRROR_MAP).getState().readOnly).toBe(true);
    expect(boardStoreOf(MIRROR_BOARD).getState().readOnly).toBe(true);
    expect(mapStoreOf(OWN_MAP).getState().readOnly).toBe(false);
    // 뷰어에서 편집 시도는 아무 일도 없다
    mapStoreOf(MIRROR_MAP).getState().addRoot();
    boardStoreOf(MIRROR_BOARD).getState().removeElements(['s']);
    expect(Object.keys(mapStoreOf(MIRROR_MAP).getState().doc.nodes)).toEqual(['r']);
    expect(Object.keys(boardStoreOf(MIRROR_BOARD).getState().board.elements)).toEqual(['s']);
  });

  it('소유자의 파일은 뷰어가 아니다', () => {
    setRoom('owner', { [MIRROR_MAP]: 'map-plan' });
    useSession.getState().openPath(MIRROR_MAP, mapContent());
    expect(mapStoreOf(MIRROR_MAP).getState().readOnly).toBe(false);
  });

  it('syncViewerFlags: 공유 연결이 준비되기 전에 열린 탭도 뒤늦게 뷰어로 바뀐다(세션 복원)', () => {
    useSession.getState().openPath(MIRROR_MAP, mapContent());
    useSession.getState().openPath(MIRROR_BOARD, boardContent());
    expect(mapStoreOf(MIRROR_MAP).getState().readOnly).toBe(false);
    setRoom('participant', { [MIRROR_MAP]: 'map-plan', [MIRROR_BOARD]: 'board-idea' });
    useSession.getState().syncViewerFlags();
    expect(mapStoreOf(MIRROR_MAP).getState().readOnly).toBe(true);
    expect(boardStoreOf(MIRROR_BOARD).getState().readOnly).toBe(true);
  });
});

describe('뷰어는 저장하지 않는다', () => {
  it('탭을 닫을 때 flush도 뷰어 문서는 쓰지 않는다(dirty를 억지로 켜도)', async () => {
    setRoom('participant', { [MIRROR_MAP]: 'map-plan', [MIRROR_BOARD]: 'board-idea' });
    useSession.getState().openPath(MIRROR_MAP, mapContent());
    useSession.getState().openPath(MIRROR_BOARD, boardContent());
    mapStoreOf(MIRROR_MAP).setState({ dirty: true }); // 어떤 버그로든 dirty가 됐다고 가정
    boardStoreOf(MIRROR_BOARD).setState({ dirty: true });
    for (const t of [...useSession.getState().tabs]) await useSession.getState().closeTab(t.id);
    expect(mockSave).not.toHaveBeenCalled();
  });

  it('뷰어의 허용된 표시 액션(팬/줌·접기)은 dirty를 만들지 않는다', () => {
    setRoom('participant', { [MIRROR_MAP]: 'map-plan' });
    useSession.getState().openPath(MIRROR_MAP, mapContent());
    const st = mapStoreOf(MIRROR_MAP).getState();
    st.setView({ zoom: 2 });
    st.select('r');
    expect(mapStoreOf(MIRROR_MAP).getState().dirty).toBe(false);
  });

  it('편집 가능한 탭은 저장 후 notifyFileSaved 훅을 부른다(소유자 발행 경로)', async () => {
    const hook = vi.fn();
    setFileSavedHook(hook);
    setRoom('owner', {});
    useSession.getState().openPath(MIRROR_MAP, mapContent());
    mapStoreOf(MIRROR_MAP).getState().addRoot();
    expect(mapStoreOf(MIRROR_MAP).getState().dirty).toBe(true);
    for (const t of [...useSession.getState().tabs]) await useSession.getState().closeTab(t.id);
    expect(mockSave).toHaveBeenCalledTimes(1);
    expect(hook).toHaveBeenCalledWith('/saved');
  });
});

describe('뷰어 실시간 다시 로드(reloadIfOpen)', () => {
  it('소유자의 새 내용으로 바뀌되 readOnly·보는 위치·선택은 유지되고 dirty가 되지 않는다', async () => {
    setRoom('participant', { [MIRROR_MAP]: 'map-plan' });
    useSession.getState().openPath(MIRROR_MAP, mapContent('옛 내용'));
    const store = mapStoreOf(MIRROR_MAP);
    store.getState().setView({ zoom: 1.8, panX: 11, panY: 22 });
    mockReadFile.mockResolvedValueOnce(mapContent('소유자가 고침'));
    await useSession.getState().reloadIfOpen(MIRROR_MAP);
    const s = store.getState();
    expect(s.doc.nodes['r'].text).toBe('소유자가 고침');
    expect(s.readOnly).toBe(true);
    expect(s.doc.view).toEqual({ zoom: 1.8, panX: 11, panY: 22 });
    expect(s.selectedId).toBe('r');
    expect(s.dirty).toBe(false);
  });

  it('보드도 같다', async () => {
    setRoom('participant', { [MIRROR_BOARD]: 'board-idea' });
    useSession.getState().openPath(MIRROR_BOARD, boardContent('옛'));
    const store = boardStoreOf(MIRROR_BOARD);
    store.getState().setView({ zoom: 2 });
    mockReadFile.mockResolvedValueOnce(boardContent('새'));
    await useSession.getState().reloadIfOpen(MIRROR_BOARD);
    expect((store.getState().board.elements['s'] as BoardStickyElement).text).toBe('새');
    expect(store.getState().board.view.zoom).toBe(2);
    expect(store.getState().readOnly).toBe(true);
    expect(store.getState().dirty).toBe(false);
  });

  it('일반(편집 가능) 맵은 기존처럼 통째로 다시 불러온다', async () => {
    setRoom('participant', {});
    useSession.getState().openPath(OWN_MAP, mapContent('옛'));
    mockReadFile.mockResolvedValueOnce(mapContent('디스크'));
    await useSession.getState().reloadIfOpen(OWN_MAP);
    expect(mapStoreOf(OWN_MAP).getState().doc.nodes['r'].text).toBe('디스크');
    expect(mapStoreOf(OWN_MAP).getState().readOnly).toBe(false);
  });
});

describe('localOnlyFileNotice', () => {
  it('참가자가 공유 폴더에 새 파일을 만들면 방마다 한 번만 안내한다 — 소유자·폴더 밖은 안내 없음', () => {
    setRoom('participant', {});
    const rooms = useShare.getState().rooms;
    expect(localOnlyFileNotice(rooms, '/ws/elsewhere/x.mind')).toBeNull();
    const first = localOnlyFileNotice(rooms, `${FOLDER}/새 맵.mind`);
    expect(first).toContain('소유자만 공유');
    expect(first).toContain('내 기기에만');
    expect(localOnlyFileNotice(rooms, `${FOLDER}/또.board`)).toBeNull(); // 이미 안내함
    useShare.setState({ rooms: { 'room-AAAAAAAA': { ...rooms['room-AAAAAAAA'], marker: marker('owner') } } });
    expect(localOnlyFileNotice(useShare.getState().rooms, `${FOLDER}/x.mind`)).toBeNull();
  });
});
