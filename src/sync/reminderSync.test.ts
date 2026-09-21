// @vitest-environment jsdom
// 공유로 받은 읽기 전용 맵(뷰어)은 리마인더 동기화 대상에서 빠진다 — 참가자 미러는 노드 id가 소유자와 같고 reminderOn이 제거돼 있어
// 그대로 두면 "이 노드는 리마인더를 원치 않음"으로 오해해 같은 Apple ID를 쓰는 소유자의 실제 리마인더를 지운다(F1b 회귀 방지).
// 실제 macOS Reminders는 절대 호출하지 않는다 — window.api의 reminder* 는 전부 스텁이다.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MindMapDoc, MindNode } from '../types';
import type { ReminderInfo } from '../../electron/preload';

const reminderQuery = vi.fn<() => Promise<ReminderInfo[]>>();
const reminderDelete = vi.fn<(id: string) => Promise<void>>();
const reminderCreate = vi.fn();
const reminderUpdate = vi.fn();
const remindersAvailable = vi.fn<() => Promise<boolean>>();
vi.stubGlobal('api', { reminderQuery, reminderDelete, reminderCreate, reminderUpdate, remindersAvailable, reminderHeartbeat: vi.fn(), log: vi.fn() });

const { useSession } = await import('../store/sessionStore');
const { createMapStore } = await import('../store/mapStore');
const { reminderSyncTestApi: sync } = await import('./reminderSync');

type MapStoreT = ReturnType<typeof createMapStore>;

const node = (id: string, over: Partial<MindNode> = {}): MindNode => ({ id, text: `노드 ${id}`, parentId: null, children: [], collapsed: false, ...over });
const docOf = (nodes: MindNode[]): MindMapDoc => ({
  version: 1,
  id: 'doc-' + nodes.map((n) => n.id).join('-'),
  rootIds: nodes.map((n) => n.id),
  nodes: Object.fromEntries(nodes.map((n) => [n.id, n])),
  view: { zoom: 1, panX: 0, panY: 0 },
});

function openMap(path: string, nodes: MindNode[], opts: { readOnly?: boolean } = {}): MapStoreT {
  const store = createMapStore();
  store.getState().loadDoc(docOf(nodes), path);
  if (opts.readOnly) store.getState().setReadOnly(true);
  const tab = { id: `tab-${path}`, path, title: path, kind: 'map' as const, isTemplate: false, store };
  const cur = useSession.getState().tabs;
  useSession.setState({ tabs: [...cur, tab] });
  return store;
}

/** 소유자 본인의 동기화된 리마인더 노드(트래킹 카운트를 올려 대조 패스가 실제로 돌게 한다) — 실제 환경의 "같은 Apple ID 소유자"에 해당. */
const OWN = node('own1', { reminderOn: true, reminderId: 'rem-own', todo: true, reminderBase: { title: '노드 own1', due: null, done: false } });
const OWN_REMINDER: ReminderInfo = { id: 'rem-own', title: '노드 own1', completed: false, dueDate: null, modifiedAt: '2026-09-21T10:00:00', tag: 'own1' };
/** 소유자 Reminders 앱에 있는, 노드 `n1`에 묶인 실제 리마인더. */
const OWNERS_REMINDER: ReminderInfo = { id: 'rem-n1', title: '노드 n1', completed: false, dueDate: null, modifiedAt: '2026-09-21T10:00:00', tag: 'n1' };

beforeEach(() => {
  useSession.setState({ tabs: [], leftTabs: [], leftActive: null, rightTabs: [], rightActive: null, split: false, activeGroup: 0, recent: [] });
  sync.reset();
  for (const m of [reminderQuery, reminderDelete, reminderCreate, reminderUpdate, remindersAvailable]) m.mockReset();
  remindersAvailable.mockResolvedValue(true);
  reminderDelete.mockResolvedValue(undefined);
  reminderQuery.mockResolvedValue([OWN_REMINDER, OWNERS_REMINDER]);
});
afterEach(() => {
  sync.reset();
});

describe('reminderSync.reconcile — 읽기 전용 미러는 동기화 대상이 아니다', () => {
  it('뷰어 미러(reminderOn 없음, 소유자와 같은 노드 id)는 소유자의 리마인더를 지우지 않는다', async () => {
    openMap('/ws/mine.mind', [OWN]); // 소유자 기기의 다른 맵(같은 Apple ID)
    openMap('/ws/shared/plan.mind', [node('n1')], { readOnly: true }); // 참가자 미러: 리마인더 신원 4개 필드가 제거된 사본
    await sync.reconcile();
    expect(reminderQuery).toHaveBeenCalled(); // 대조 패스가 실제로 돌았다(조기 종료로 통과한 게 아니다)
    expect(reminderDelete).not.toHaveBeenCalled();
    expect(reminderCreate).not.toHaveBeenCalled();
  });

  it('대조군: 같은 상황에서 편집 가능한 탭이면 "원치 않음" 노드의 리마인더를 지운다(뷰어 제외 필터가 없으면 위 테스트가 실패한다)', async () => {
    openMap('/ws/mine.mind', [OWN]);
    openMap('/ws/other.mind', [node('n1')]); // readOnly 아님 — 내 로컬 맵에서 reminderOn을 끈 노드
    await sync.reconcile();
    expect(reminderDelete).toHaveBeenCalledTimes(1);
    expect(reminderDelete).toHaveBeenCalledWith('rem-n1');
  });

  it('뷰어 탭만 열려 있으면 리마인더 API 자체를 부르지 않는다(추적할 노드가 없다)', async () => {
    openMap('/ws/shared/plan.mind', [node('n1')], { readOnly: true });
    await sync.reconcile();
    expect(reminderQuery).not.toHaveBeenCalled();
    expect(reminderDelete).not.toHaveBeenCalled();
  });

  it('뷰어 미러의 노드가 중복 태그 리마인더를 "정리"하러 삭제하지도 않는다', async () => {
    reminderQuery.mockResolvedValue([
      OWN_REMINDER,
      { ...OWNERS_REMINDER, id: 'rem-n1-old', modifiedAt: '2026-09-20T10:00:00' },
      { ...OWNERS_REMINDER, id: 'rem-n1-new', modifiedAt: '2026-09-21T11:00:00' },
    ]);
    openMap('/ws/mine.mind', [OWN]);
    openMap('/ws/shared/plan.mind', [node('n1')], { readOnly: true });
    await sync.reconcile();
    expect(reminderDelete).not.toHaveBeenCalled();
  });
});

describe('reminderSync.refreshSubs — 뷰어 탭은 구독하지 않는다', () => {
  it('편집 가능한 맵 탭만 구독하고 읽기 전용 미러는 제외한다', () => {
    openMap('/ws/mine.mind', [OWN]);
    openMap('/ws/shared/plan.mind', [node('n1')], { readOnly: true });
    sync.refreshSubs();
    expect(sync.subscriptionCount()).toBe(1);
  });

  it('뷰어 탭만 있으면 구독이 0개다', () => {
    openMap('/ws/shared/plan.mind', [node('n1')], { readOnly: true });
    sync.refreshSubs();
    expect(sync.subscriptionCount()).toBe(0);
  });
});
