import { describe, expect, it } from 'vitest';
import { createMapStore, MAP_VIEWER_ALLOWED, type MapStore } from './mapStore';
import { BOARD_VIEWER_ALLOWED, createBoardStore, type BoardStore } from './boardStore';
import { isGuardedAction } from './readOnlyGuard';
import { emptyBoard } from '../io/boardFormat';
import type { BoardStickyElement } from '../types';

// 읽기 전용(뷰어) 가드 — 스토어의 **전체 액션 목록을 순회**해 허용 목록 밖은 전부 차단되는지 검증한다.
// 새 액션이 추가되면 허용 목록에 넣기 전까지 이 테스트가 그 액션도 자동으로 검사한다.

const fnKeys = (state: object): string[] =>
  Object.entries(state)
    .filter(([, v]) => typeof v === 'function')
    .map(([k]) => k);

/** 액션이 받을 만한 여러 모양의 인자 — 차단이 정말 "실행하지 않음"인지 확인하기 위해 진짜 id를 섞어 넘긴다. */
function argSets(ids: string[]): unknown[][] {
  const [a, b] = ids;
  return [
    [],
    [a],
    [a, b],
    [a, 'x'],
    [a, true],
    [a, 1],
    [[a, b]],
    [[a, b], b],
    [[a, b], 1, 2],
    [a, { x: 1, y: 2 }],
    [{ text: 'hijack' }],
  ];
}

function buildMap(): { store: MapStore; ids: string[] } {
  const store = createMapStore();
  const s = store.getState();
  s.addRoot();
  const root = store.getState().doc.rootIds[0];
  store.getState().commitText(root, '루트');
  store.getState().addChild(root);
  const a = store.getState().selectedId!;
  store.getState().commitText(a, '가');
  store.getState().addChild(root);
  const b = store.getState().selectedId!;
  store.getState().commitText(b, '나');
  store.getState().markSaved('/ws/team/map.mind');
  return { store, ids: [root, a, b] };
}

describe('맵 스토어 — 읽기 전용 가드', () => {
  it('허용 목록의 이름은 모두 실제 액션이다(오탈자·삭제된 액션 방지)', () => {
    const keys = new Set(fnKeys(createMapStore().getState()));
    for (const name of MAP_VIEWER_ALLOWED) expect(keys.has(name), name).toBe(true);
  });

  it('모든 액션은 "허용 목록이거나 가드로 감싸졌거나" 둘 중 하나다', () => {
    const state = createMapStore().getState();
    for (const key of fnKeys(state)) {
      const fn = (state as unknown as Record<string, unknown>)[key];
      expect(MAP_VIEWER_ALLOWED.has(key) || isGuardedAction(fn), key).toBe(true);
    }
  });

  it('허용 목록 밖의 모든 액션은 뷰어에서 문서·이력·dirty를 전혀 바꾸지 않는다', () => {
    const { store, ids } = buildMap();
    store.getState().setReadOnly(true);
    const before = store.getState();
    const blockedKeys = fnKeys(before).filter((k) => !MAP_VIEWER_ALLOWED.has(k));
    expect(blockedKeys.length).toBeGreaterThan(30); // 전수 검사가 비어 있지 않다는 확인
    for (const key of blockedKeys) {
      for (const args of argSets(ids)) {
        (store.getState() as unknown as Record<string, (...a: unknown[]) => unknown>)[key](...args);
      }
    }
    const after = store.getState();
    expect(after.doc).toBe(before.doc); // 같은 객체 — 어떤 변경도 없다
    expect(after.dirty).toBe(false);
    expect(after.past).toBe(before.past);
    expect(after.future).toBe(before.future);
    expect(after.editingId).toBeNull();
    expect(after.selectedIds).toEqual(before.selectedIds);
  });

  it('대조군: 같은 호출이 편집 가능한 스토어에서는 문서를 바꾼다(테스트가 공허하지 않다)', () => {
    const { store, ids } = buildMap();
    const before = store.getState().doc;
    store.getState().addChild(ids[0]);
    store.getState().setColor(ids[1], 'red');
    expect(store.getState().doc).not.toBe(before);
    expect(store.getState().dirty).toBe(true);
  });

  it('차단된 액션의 반환값은 안전한 기본값이다(hasClipboard=false, captureScheduled="")', () => {
    const { store, ids } = buildMap();
    store.getState().copyNode(ids[1]); // 복사(읽기)는 뷰어에서도 된다
    expect(store.getState().hasClipboard()).toBe(true);
    store.getState().setReadOnly(true);
    expect(store.getState().hasClipboard()).toBe(false); // 붙여넣기 불가
    expect(store.getState().captureScheduled('x', '2026-01-01T00:00:00.000Z')).toBe('');
    store.getState().pasteNode(ids[0]);
    expect(Object.keys(store.getState().doc.nodes)).toHaveLength(3);
  });

  it('회귀: 공유로 받은 노드를 복사해 내 맵에 붙여넣어도 리마인더 신원 4개 필드는 제거된다(기존 복사 규칙)', () => {
    const { store, ids } = buildMap();
    // 뷰어 문서에 리마인더 신원이 (정제되지 않은 채) 들어 있었다고 가정 — 복사 규칙이 마지막 방어선이다
    const doc = structuredClone(store.getState().doc);
    Object.assign(doc.nodes[ids[1]], { todo: true, scheduled: true, scheduleAt: '2026-10-01T09:00:00.000Z', reminderOn: true, reminderId: 'owner-reminder', reminderSyncedAt: 9, reminderBase: { title: '가', due: null, done: false } });
    store.getState().loadDoc(doc, '/ws/team/map.mind');
    store.getState().setReadOnly(true);
    store.getState().copyNode(ids[1]); // 뷰어에서도 복사(읽기)는 된다
    const mine = createMapStore();
    mine.getState().addRoot();
    const myRoot = mine.getState().doc.rootIds[0];
    mine.getState().commitText(myRoot, '내 맵');
    mine.getState().pasteNode(myRoot);
    const pasted = Object.values(mine.getState().doc.nodes).find((n) => n.text === '가')!;
    expect(pasted).toBeDefined();
    expect(pasted.scheduleAt).toBe('2026-10-01T09:00:00.000Z'); // 내용은 복사되고
    for (const f of ['reminderOn', 'reminderId', 'reminderSyncedAt', 'reminderBase'] as const) expect(pasted[f]).toBeUndefined(); // 신원은 제거
  });

  it('뷰어의 로컬 표시 액션(선택·접기·팬/줌·필터)은 동작하지만 dirty가 되지 않는다', () => {
    const { store, ids } = buildMap();
    store.getState().setReadOnly(true);
    store.getState().select(ids[1]);
    expect(store.getState().selectedId).toBe(ids[1]);
    store.getState().toggleCollapse(ids[0]);
    expect(store.getState().doc.nodes[ids[0]].collapsed).toBe(true); // 화면에서 접힘
    store.getState().toggleCollapse(ids[0]);
    store.getState().setView({ zoom: 2, panX: 10, panY: 20 });
    expect(store.getState().doc.view).toEqual({ zoom: 2, panX: 10, panY: 20 });
    store.getState().setColorFilter('red');
    store.getState().setFocus(ids[0]);
    store.getState().navigate('down');
    expect(store.getState().dirty).toBe(false);
  });

  it('setReadOnly(true)는 진행 중이던 dirty·편집을 즉시 해제한다', () => {
    const { store, ids } = buildMap();
    store.getState().startEdit(ids[1]);
    store.getState().addChild(ids[0]);
    expect(store.getState().dirty).toBe(true);
    store.getState().setReadOnly(true);
    expect(store.getState().dirty).toBe(false);
    expect(store.getState().editingId).toBeNull();
  });

  it('refreshViewerDoc: 소유자의 새 문서로 바뀌되 선택·보는 위치는 유지되고 저장 대상이 되지 않는다', () => {
    const { store, ids } = buildMap();
    store.getState().setReadOnly(true);
    store.getState().select(ids[1]);
    store.getState().setView({ zoom: 1.5, panX: 5, panY: 6 });
    const owner = structuredClone(store.getState().doc);
    owner.nodes[ids[1]].text = '가(고침)';
    owner.view = { zoom: 9, panX: 99, panY: 99 };
    store.getState().refreshViewerDoc(owner);
    const s = store.getState();
    expect(s.doc.nodes[ids[1]].text).toBe('가(고침)');
    expect(s.doc.view).toEqual({ zoom: 1.5, panX: 5, panY: 6 });
    expect(s.selectedId).toBe(ids[1]);
    expect(s.dirty).toBe(false);
  });

  it('refreshViewerDoc는 읽기 전용이 아닌 스토어에서는 아무 일도 하지 않는다', () => {
    const { store, ids } = buildMap();
    const before = store.getState().doc;
    const other = structuredClone(before);
    other.nodes[ids[1]].text = '남의 것';
    store.getState().refreshViewerDoc(other);
    expect(store.getState().doc).toBe(before);
  });

  it('loadDoc은 readOnly를 유지한다(외부 변경 다시 읽기가 가드를 풀지 않는다)', () => {
    const { store } = buildMap();
    store.getState().setReadOnly(true);
    store.getState().loadDoc(structuredClone(store.getState().doc), '/ws/team/map.mind');
    expect(store.getState().readOnly).toBe(true);
    store.getState().addRoot();
    expect(store.getState().doc.rootIds).toHaveLength(1);
  });
});

function sticky(id: string, x = 0, y = 0): BoardStickyElement {
  return { id, kind: 'sticky', x, y, width: 160, height: 160, text: '메모' };
}

function buildBoard(): { store: BoardStore; ids: string[] } {
  const store = createBoardStore();
  store.getState().loadBoard(emptyBoard(), '/ws/team/b.board');
  store.getState().addElements([sticky('s1', 10, 10), sticky('s2', 200, 10)]);
  store.getState().markSaved('/ws/team/b.board');
  return { store, ids: ['s1', 's2'] };
}

describe('보드 스토어 — 읽기 전용 가드', () => {
  it('허용 목록의 이름은 모두 실제 액션이다', () => {
    const keys = new Set(fnKeys(createBoardStore().getState()));
    for (const name of BOARD_VIEWER_ALLOWED) expect(keys.has(name), name).toBe(true);
  });

  it('모든 액션은 "허용 목록이거나 가드로 감싸졌거나" 둘 중 하나다', () => {
    const state = createBoardStore().getState();
    for (const key of fnKeys(state)) {
      const fn = (state as unknown as Record<string, unknown>)[key];
      expect(BOARD_VIEWER_ALLOWED.has(key) || isGuardedAction(fn), key).toBe(true);
    }
  });

  it('허용 목록 밖의 모든 액션은 뷰어에서 보드·이력·dirty를 전혀 바꾸지 않는다', () => {
    const { store, ids } = buildBoard();
    store.getState().setReadOnly(true);
    store.getState().setSelection(ids);
    const before = store.getState();
    const blockedKeys = fnKeys(before).filter((k) => !BOARD_VIEWER_ALLOWED.has(k));
    expect(blockedKeys.length).toBeGreaterThan(15);
    for (const key of blockedKeys) {
      for (const args of argSets(ids)) {
        (store.getState() as unknown as Record<string, (...a: unknown[]) => unknown>)[key](...args);
      }
    }
    const after = store.getState();
    expect(after.board).toBe(before.board);
    expect(after.dirty).toBe(false);
    expect(after.past).toBe(before.past);
    expect(after.future).toBe(before.future);
    expect(after.selection).toEqual(ids);
  });

  it('대조군: 같은 호출이 편집 가능한 보드에서는 바꾼다', () => {
    const { store } = buildBoard();
    const before = store.getState().board;
    store.getState().moveElements(['s1'], 5, 5);
    expect(store.getState().board).not.toBe(before);
    expect(store.getState().dirty).toBe(true);
  });

  it('뷰어에서 복사는 되지만 붙여넣기·잘라내기·복제는 안 된다', () => {
    const { store, ids } = buildBoard();
    store.getState().setSelection(ids);
    store.getState().copyElements();
    store.getState().setReadOnly(true);
    expect(store.getState().hasClipboard()).toBe(false);
    store.getState().pasteElements();
    store.getState().cutElements();
    store.getState().duplicateElements();
    expect(Object.keys(store.getState().board.elements)).toHaveLength(2);
  });

  it('뷰어의 팬/줌·선택·필터는 동작하지만 dirty가 되지 않는다', () => {
    const { store } = buildBoard();
    store.getState().setReadOnly(true);
    store.getState().setView({ zoom: 2 });
    store.getState().setSelection(['s2']);
    store.getState().selectAll();
    store.getState().setShapeFilter('ellipse');
    expect(store.getState().board.view.zoom).toBe(2);
    expect(store.getState().dirty).toBe(false);
  });

  it('진행 중이던 트랜잭션·dirty는 setReadOnly(true)로 해제되고, 이후 endTransaction도 이력을 만들지 않는다', () => {
    const { store } = buildBoard();
    store.getState().beginTransaction();
    store.getState().moveElements(['s1'], 3, 3);
    expect(store.getState().dirty).toBe(true);
    store.getState().setReadOnly(true);
    expect(store.getState().dirty).toBe(false);
    const pastLen = store.getState().past.length;
    store.getState().endTransaction();
    expect(store.getState().past).toHaveLength(pastLen);
    expect(store.getState().dirty).toBe(false);
  });

  it('refreshViewerBoard: 소유자의 새 보드로 바뀌되 보는 위치는 유지되고 저장 대상이 되지 않는다', () => {
    const { store } = buildBoard();
    store.getState().setReadOnly(true);
    store.getState().setView({ zoom: 1.7, panX: 3, panY: 4 });
    const owner = structuredClone(store.getState().board);
    owner.elements['s1'] = { ...(owner.elements['s1'] as BoardStickyElement), text: '소유자가 고침' };
    owner.view = { zoom: 9, panX: 9, panY: 9 };
    store.getState().refreshViewerBoard(owner);
    const s = store.getState();
    expect((s.board.elements['s1'] as BoardStickyElement).text).toBe('소유자가 고침');
    expect(s.board.view).toEqual({ zoom: 1.7, panX: 3, panY: 4 });
    expect(s.dirty).toBe(false);
  });

  it('loadBoard는 readOnly를 유지한다', () => {
    const { store } = buildBoard();
    store.getState().setReadOnly(true);
    store.getState().loadBoard(structuredClone(store.getState().board), '/ws/team/b.board');
    expect(store.getState().readOnly).toBe(true);
    store.getState().addElement(sticky('s3'));
    expect(Object.keys(store.getState().board.elements)).toHaveLength(2);
  });
});
