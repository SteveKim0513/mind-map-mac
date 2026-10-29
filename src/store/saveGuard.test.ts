import { describe, it, expect, vi } from 'vitest';
import { createStore } from 'zustand/vanilla';
import { finishSave } from './saveGuard';
import { createMapStore } from './mapStore';
import { createBoardStore } from './boardStore';
import type { BoardStickyElement } from '../types';

function sticky(id: string, x = 0, y = 0): BoardStickyElement {
  return { id, kind: 'sticky', x, y, width: 160, height: 160, text: '' };
}

// 가짜 스토어: 문서(doc)가 바뀌면 dirty, markSaved가 dirty를 끈다 — 실제 스토어와 같은 규칙.
function fakeStore() {
  return createStore<{ doc: { v: number }; dirty: boolean; filePath: string | null; markSaved: (p: string) => void }>()((set) => ({
    doc: { v: 0 },
    dirty: false,
    filePath: '/ws/a.mind',
    markSaved: (p) => set({ filePath: p, dirty: false }),
  }));
}

describe('finishSave — 저장하는 동안 더 고친 편집을 잃지 않는다', () => {
  it('저장 중 더 고친 게 없으면 저장됨으로 표시한다', () => {
    const s = fakeStore();
    s.setState({ doc: { v: 1 }, dirty: true });
    const snap = s.getState().doc;
    expect(finishSave(s, 'doc', snap, '/ws/a.mind')).toBe(true);
    expect(s.getState().dirty).toBe(false);
  });

  it('저장 중 문서가 바뀌었으면 dirty를 남기고 경로만 갱신한다 (유실 방지 — 회귀 재현)', () => {
    const s = fakeStore();
    s.setState({ doc: { v: 1 }, dirty: true });
    const snap = s.getState().doc; // 저장이 시작된 시점의 스냅샷
    s.setState({ doc: { v: 2 }, dirty: true }); // 저장하는 동안 사용자가 더 입력
    expect(finishSave(s, 'doc', snap, '/ws/renamed.mind')).toBe(false);
    expect(s.getState().dirty).toBe(true); // 이미 예약된 다음 자동저장이 이어받는다
    expect(s.getState().filePath).toBe('/ws/renamed.mind');
  });

  it('markSaved를 호출하지 않는다 (경로만 setState)', () => {
    const s = fakeStore();
    const spy = vi.fn(s.getState().markSaved);
    s.setState({ markSaved: spy, doc: { v: 2 }, dirty: true });
    finishSave(s, 'doc', { v: 1 }, '/ws/a.mind');
    expect(spy).not.toHaveBeenCalled();
  });
});

describe('finishSave — 실제 맵·보드 스토어', () => {
  it('맵: 저장 중 노드를 더 추가하면 dirty가 남는다', () => {
    const store = createMapStore();
    store.getState().markSaved('/ws/m.mind');
    store.getState().addRoot(); // 첫 편집
    expect(store.getState().dirty).toBe(true);
    const snap = store.getState().doc; // 저장 시작
    store.getState().addRoot(); // 저장 중 추가 입력
    finishSave(store, 'doc', snap, '/ws/m.mind');
    expect(store.getState().dirty).toBe(true);
  });

  it('맵: 저장 중 편집이 없으면 dirty가 꺼진다', () => {
    const store = createMapStore();
    store.getState().markSaved('/ws/m.mind');
    store.getState().addRoot();
    const snap = store.getState().doc;
    finishSave(store, 'doc', snap, '/ws/m.mind');
    expect(store.getState().dirty).toBe(false);
  });

  it('보드: 저장 중 요소를 더 추가하면 dirty가 남는다', () => {
    const store = createBoardStore();
    store.getState().markSaved('/ws/b.board');
    store.getState().addElement(sticky('s1'));
    const snap = store.getState().board;
    store.getState().addElement(sticky('s2', 50, 50));
    finishSave(store, 'board', snap, '/ws/b.board');
    expect(store.getState().dirty).toBe(true);
  });
});
