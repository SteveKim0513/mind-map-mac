import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MAX_NOTIFICATIONS } from '../io/notificationFormat';
import type { NotificationItem, NotificationsFile } from '../types';
import { resetNotificationsForTest, setNotificationStorage, unreadCount, useNotifications, type NotificationStorage } from './notificationStore';

const ROOM = 'room-abcdef12';
const item = (id: string, createdAt: number, over: Partial<NotificationItem> = {}): NotificationItem => ({
  id,
  type: 'comment',
  roomId: ROOM,
  folderName: '기획',
  anchor: { kind: 'map', fileId: 'file-1', targetId: 'n1' },
  targetLabel: '계획 · 루트',
  authorName: '민수',
  preview: '코멘트',
  createdAt,
  read: false,
  ...over,
});

/** 디스크(userData/notifications.json) 대역 — JSON으로 직렬화해 앱 재시작처럼 완전히 새로 읽는다. */
function memDisk(initial?: unknown) {
  let raw: string | null = initial === undefined ? null : JSON.stringify(initial);
  const saves: NotificationsFile[] = [];
  const storage: NotificationStorage = {
    load: async () => (raw === null ? { version: 1, items: [], baselines: {} } : JSON.parse(raw)),
    save: async (data) => {
      saves.push(data);
      raw = JSON.stringify(data);
    },
  };
  return { storage, saves, raw: () => raw };
}

/** 앱을 껐다 켠 것처럼 모듈 상태를 비우고 같은 디스크로 다시 hydrate한다. */
async function restart(disk: ReturnType<typeof memDisk>) {
  resetNotificationsForTest();
  setNotificationStorage(disk.storage);
  await useNotifications.getState().hydrate();
}

beforeEach(() => {
  resetNotificationsForTest();
});
afterEach(() => {
  setNotificationStorage(undefined);
});

describe('notificationStore — read state', () => {
  it('adds newest-first and counts unread', async () => {
    const disk = memDisk();
    setNotificationStorage(disk.storage);
    await useNotifications.getState().hydrate();
    const s = useNotifications.getState();
    expect(s.add(item('a', 100))).toBe(true);
    expect(s.add(item('b', 300))).toBe(true);
    expect(s.add(item('c', 200))).toBe(true);
    expect(useNotifications.getState().items.map((i) => i.id)).toEqual(['b', 'c', 'a']);
    expect(unreadCount(useNotifications.getState().items)).toBe(3);
  });

  it('does not add the same comment twice, even after it was read', async () => {
    setNotificationStorage(memDisk().storage);
    await useNotifications.getState().hydrate();
    const s = useNotifications.getState();
    expect(s.add(item('a', 100))).toBe(true);
    s.setRead('a', true);
    expect(s.add(item('a', 100))).toBe(false);
    expect(useNotifications.getState().items).toHaveLength(1);
    expect(useNotifications.getState().items[0].read).toBe(true);
  });

  it('toggles a single item between read and unread', async () => {
    setNotificationStorage(memDisk().storage);
    await useNotifications.getState().hydrate();
    const s = useNotifications.getState();
    s.add(item('a', 100));
    s.toggleRead('a');
    expect(useNotifications.getState().items[0].read).toBe(true);
    s.toggleRead('a');
    expect(useNotifications.getState().items[0].read).toBe(false);
    s.setRead('nope', true); // unknown id: no-op
    expect(useNotifications.getState().items).toHaveLength(1);
  });

  it('marks everything read at once and leaves unread count at zero', async () => {
    setNotificationStorage(memDisk().storage);
    await useNotifications.getState().hydrate();
    const s = useNotifications.getState();
    s.add(item('a', 1));
    s.add(item('b', 2));
    s.setRead('a', true);
    s.markAllRead();
    expect(useNotifications.getState().items.every((i) => i.read)).toBe(true);
    expect(unreadCount(useNotifications.getState().items)).toBe(0);
  });

  it('caps the list at the newest MAX_NOTIFICATIONS', async () => {
    setNotificationStorage(memDisk().storage);
    await useNotifications.getState().hydrate();
    const s = useNotifications.getState();
    for (let i = 0; i < MAX_NOTIFICATIONS + 25; i++) s.add(item(`c${i}`, i + 1));
    const items = useNotifications.getState().items;
    expect(items).toHaveLength(MAX_NOTIFICATIONS);
    expect(items[0].id).toBe(`c${MAX_NOTIFICATIONS + 24}`);
    expect(items.some((i) => i.id === 'c0')).toBe(false); // oldest fell off
  });

  it('forgetRoom drops that room’s notifications and baseline only', async () => {
    setNotificationStorage(memDisk().storage);
    await useNotifications.getState().hydrate();
    const s = useNotifications.getState();
    s.add(item('a', 1));
    s.add(item('b', 2, { roomId: 'room-other123' }));
    s.setBaseline(ROOM, 50);
    s.setBaseline('room-other123', 60);
    s.forgetRoom(ROOM);
    expect(useNotifications.getState().items.map((i) => i.id)).toEqual(['b']);
    expect(useNotifications.getState().getBaseline(ROOM)).toBeUndefined();
    expect(useNotifications.getState().getBaseline('room-other123')).toBe(60);
  });
});

describe('notificationStore — persistence (read state survives an app restart)', () => {
  it('round-trips items, read flags and baselines through the disk', async () => {
    const disk = memDisk();
    setNotificationStorage(disk.storage);
    await useNotifications.getState().hydrate();
    const s = useNotifications.getState();
    s.add(item('a', 100));
    s.add(item('b', 200));
    s.add(item('c', 300));
    s.setRead('b', true);
    s.setBaseline(ROOM, 4242);
    await s.flush();

    await restart(disk);
    const after = useNotifications.getState();
    expect(after.hydrated).toBe(true);
    expect(after.items.map((i) => [i.id, i.read])).toEqual([
      ['c', false],
      ['b', true],
      ['a', false],
    ]);
    expect(after.getBaseline(ROOM)).toBe(4242);
    expect(unreadCount(after.items)).toBe(2);

    // "모두 읽음" is persisted too
    after.markAllRead();
    await after.flush();
    await restart(disk);
    expect(unreadCount(useNotifications.getState().items)).toBe(0);
  });

  it('saves after every change (coalescing same-tick changes into one save) and serializes writes', async () => {
    const disk = memDisk();
    setNotificationStorage(disk.storage);
    await useNotifications.getState().hydrate();
    const s = useNotifications.getState();
    s.add(item('a', 1));
    s.add(item('b', 2));
    s.setRead('a', true);
    await s.flush();
    expect(disk.saves.length).toBeGreaterThanOrEqual(1);
    expect(disk.saves.length).toBeLessThanOrEqual(3);
    const last = disk.saves.at(-1)!;
    expect(last.items.map((i) => [i.id, i.read]).sort()).toEqual([['a', true], ['b', false]]);
  });

  it('hydrate merges an early in-memory notification with the stored ones (stored read state wins)', async () => {
    const disk = memDisk({ version: 1, items: [item('old', 10, { read: true })], baselines: { [ROOM]: 5 } });
    setNotificationStorage(disk.storage);
    useNotifications.getState().add(item('early', 20)); // arrived before the disk read finished
    await useNotifications.getState().hydrate();
    expect(useNotifications.getState().items.map((i) => [i.id, i.read])).toEqual([
      ['early', false],
      ['old', true],
    ]);
    expect(useNotifications.getState().getBaseline(ROOM)).toBe(5);
    await useNotifications.getState().flush();
    // the merged result (early + stored) was written back; nothing was clobbered on the way
    expect(disk.saves.every((d) => d.items.some((i) => i.id === 'old'))).toBe(true);
    expect(disk.saves.at(-1)?.items.map((i) => i.id).sort()).toEqual(['early', 'old']);
  });

  it('a corrupt or hostile file loads as empty instead of crashing', async () => {
    const disk = memDisk({ version: 1, items: [{ id: '../x', type: 'comment' }, 'junk', null], baselines: 'nope' });
    setNotificationStorage(disk.storage);
    await useNotifications.getState().hydrate();
    expect(useNotifications.getState().items).toEqual([]);

    resetNotificationsForTest();
    setNotificationStorage({
      load: async () => {
        throw new Error('disk gone');
      },
      save: async () => undefined,
    });
    await useNotifications.getState().hydrate();
    expect(useNotifications.getState().hydrated).toBe(true);
  });

  it('works without any storage (non-Electron): in-memory only', async () => {
    setNotificationStorage(null);
    await useNotifications.getState().hydrate();
    useNotifications.getState().add(item('a', 1));
    await useNotifications.getState().flush();
    expect(useNotifications.getState().items).toHaveLength(1);
  });
});

describe('notificationStore — recovered (notifications.json 소실·손상)', () => {
  it('main이 recovered 표시를 붙여 돌려주면 recovered=true, 정상 파일이면 false', async () => {
    setNotificationStorage({ load: async () => ({ version: 1, items: [], baselines: {}, recovered: true }), save: async () => undefined });
    await useNotifications.getState().hydrate();
    expect(useNotifications.getState().recovered).toBe(true);

    resetNotificationsForTest();
    setNotificationStorage({ load: async () => ({ version: 1, items: [], baselines: {} }), save: async () => undefined });
    await useNotifications.getState().hydrate();
    expect(useNotifications.getState().recovered).toBe(false);
  });

  it('load가 던져도(IPC 실패) 복구로 취급한다 — 기준선을 알 수 없다', async () => {
    setNotificationStorage({
      load: async () => {
        throw new Error('ipc');
      },
      save: async () => undefined,
    });
    await useNotifications.getState().hydrate();
    expect(useNotifications.getState()).toMatchObject({ hydrated: true, recovered: true, items: [] });
  });

  it('저장소가 없으면(비-Electron) 복구 표시 없이 빈 상태', async () => {
    setNotificationStorage(null);
    await useNotifications.getState().hydrate();
    expect(useNotifications.getState()).toMatchObject({ hydrated: true, recovered: false });
  });
});
