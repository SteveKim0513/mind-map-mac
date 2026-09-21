import { create } from 'zustand';
import { emptyNotificationsFile, MAX_NOTIFICATIONS, parseNotificationsFile } from '../io/notificationFormat';
import type { NotificationItem, NotificationsFile } from '../types';

/**
 * 알림 센터의 상태(공유 폴더 코멘트 알림). 알림·읽음 상태·방별 기준선은 **이 기기의 로컬 상태**다 — 서버로 보내지 않고
 * (다중 기기 동기화 없음), 앱을 다시 켜도 남도록 main의 `notifications:*` IPC(userData/notifications.json)에 저장한다.
 * 알림 id는 코멘트 id라 같은 코멘트가 두 번 알림이 되지 않는다. 최근 500건만 보관한다.
 */

/** 영속 저장소 포트 — 기본은 `window.api.notifications`. 테스트가 메모리 구현으로 바꿔 끼운다. */
export interface NotificationStorage {
  load(): Promise<unknown>;
  save(data: NotificationsFile): Promise<unknown>;
}

function defaultStorage(): NotificationStorage | null {
  const api = typeof window !== 'undefined' ? (window as { api?: { notifications?: NotificationStorage } }).api : undefined;
  return api?.notifications ?? null;
}

let storageOverride: NotificationStorage | null | undefined;
/** 저장소를 바꾼다(`undefined`면 기본값 `window.api.notifications`로 되돌린다). 테스트·비-Electron 환경용. */
export function setNotificationStorage(s: NotificationStorage | null | undefined): void {
  storageOverride = s;
}
const storage = (): NotificationStorage | null => (storageOverride !== undefined ? storageOverride : defaultStorage());

interface NotificationState {
  /** 최신순(createdAt 내림차순). */
  items: NotificationItem[];
  /** 방별 기준선(epoch ms) — commentSync가 "과거 코멘트 폭탄"을 막는 데 쓴다. */
  baselines: Record<string, number>;
  hydrated: boolean;
  /**
   * 저장소가 "복구됨"으로 표시한 채 읽혔는가(파일이 없거나·비었거나·손상됨 — `notifications:load`의 `recovered`). 이 상태에서는
   * 방별 기준선이 없다고 해서 "이 기기가 아직 못 본 과거 코멘트가 있다"고 볼 수 없다 → commentSync가 과거 코멘트를 알림으로
   * 만들지 않고 "지금"을 기준선으로 삼는다(알림 폭주 방지).
   */
  recovered: boolean;
  /** 저장소에서 읽어 합친다(멱등 — 진행 중인 호출과 이미 끝난 호출은 같은 결과를 돌려준다). */
  hydrate: () => Promise<void>;
  /** 새 알림. 같은 id가 이미 있으면(읽었든 아니든) 무시하고 false. */
  add: (item: NotificationItem) => boolean;
  has: (id: string) => boolean;
  setRead: (id: string, read: boolean) => void;
  toggleRead: (id: string) => void;
  markAllRead: () => void;
  remove: (id: string) => void;
  /** 방을 나가거나 공유가 끝났을 때: 그 방의 알림과 기준선을 지운다. */
  forgetRoom: (roomId: string) => void;
  getBaseline: (roomId: string) => number | undefined;
  setBaseline: (roomId: string, at: number) => void;
  /** 대기 중인 저장을 끝낸다(테스트·종료 직전). */
  flush: () => Promise<void>;
}

let hydratePromise: Promise<void> | null = null;
let saveChain: Promise<void> = Promise.resolve();
let saveQueued = false;

function has(obj: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

const byNewest = (a: NotificationItem, b: NotificationItem): number =>
  b.createdAt - a.createdAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/** 안 읽은 알림 개수. */
export const unreadCount = (items: readonly NotificationItem[]): number => items.reduce((n, i) => n + (i.read ? 0 : 1), 0);

export const useNotifications = create<NotificationState>((set, get) => {
  /** 같은 틱의 여러 변경을 한 번의 저장으로 합치고, 저장은 직렬화한다(오래된 상태가 새 상태를 덮어쓰지 않게). */
  const persist = (): void => {
    // 저장된 내용을 읽기 전에는 쓰지 않는다 — 빈(또는 일부만 든) 메모리 상태가 디스크의 기록을 덮어쓰지 않게.
    // (읽기 전에 들어온 변경은 hydrate가 합친 뒤 한 번에 저장한다.)
    if (!get().hydrated || saveQueued) return;
    saveQueued = true;
    saveChain = saveChain.then(async () => {
      saveQueued = false;
      const st = storage();
      if (!st) return;
      const { items, baselines } = get();
      try {
        await st.save({ version: 1, items, baselines });
      } catch {
        /* 저장 실패가 알림 표시를 막으면 안 된다 — 다음 변경에서 다시 저장한다 */
      }
    });
  };

  return {
    items: [],
    baselines: {},
    hydrated: false,
    recovered: false,

    hydrate: () => {
      if (hydratePromise) return hydratePromise;
      hydratePromise = (async () => {
        let loaded: NotificationsFile = emptyNotificationsFile();
        let recovered = false;
        const st = storage();
        if (st) {
          try {
            const raw = await st.load();
            loaded = parseNotificationsFile(raw);
            recovered = !!raw && typeof raw === 'object' && (raw as { recovered?: unknown }).recovered === true;
          } catch {
            loaded = emptyNotificationsFile();
            recovered = true; // 읽지 못했다 — 기준선이 사라진 것과 같다
          }
        }
        const hadEarly = get().items.length > 0 || Object.keys(get().baselines).length > 0;
        set((s) => {
          // 읽기 전에 이미 들어온 알림(있다면)은 유지하되, 저장된 읽음 상태를 우선한다.
          const byId = new Map<string, NotificationItem>();
          for (const i of s.items) byId.set(i.id, i);
          for (const i of loaded.items) byId.set(i.id, i);
          const items = [...byId.values()].sort(byNewest).slice(0, MAX_NOTIFICATIONS);
          const baselines = { ...s.baselines };
          for (const [roomId, at] of Object.entries(loaded.baselines)) {
            Object.defineProperty(baselines, roomId, { value: at, enumerable: true, writable: true, configurable: true });
          }
          return { items, baselines, hydrated: true, recovered };
        });
        if (hadEarly) persist();
      })();
      return hydratePromise;
    },

    has: (id) => get().items.some((i) => i.id === id),

    add: (item) => {
      if (get().items.some((i) => i.id === item.id)) return false;
      set((s) => ({ items: [item, ...s.items].sort(byNewest).slice(0, MAX_NOTIFICATIONS) }));
      persist();
      return true;
    },

    setRead: (id, read) => {
      const cur = get().items.find((i) => i.id === id);
      if (!cur || cur.read === read) return;
      set((s) => ({ items: s.items.map((i) => (i.id === id ? { ...i, read } : i)) }));
      persist();
    },

    toggleRead: (id) => {
      const cur = get().items.find((i) => i.id === id);
      if (cur) get().setRead(id, !cur.read);
    },

    markAllRead: () => {
      if (!get().items.some((i) => !i.read)) return;
      set((s) => ({ items: s.items.map((i) => (i.read ? i : { ...i, read: true })) }));
      persist();
    },

    remove: (id) => {
      if (!get().items.some((i) => i.id === id)) return;
      set((s) => ({ items: s.items.filter((i) => i.id !== id) }));
      persist();
    },

    forgetRoom: (roomId) => {
      const hadItems = get().items.some((i) => i.roomId === roomId);
      const hadBaseline = has(get().baselines, roomId);
      if (!hadItems && !hadBaseline) return;
      set((s) => {
        const baselines = { ...s.baselines };
        delete baselines[roomId];
        return { items: s.items.filter((i) => i.roomId !== roomId), baselines };
      });
      persist();
    },

    getBaseline: (roomId) => (has(get().baselines, roomId) ? get().baselines[roomId] : undefined),

    setBaseline: (roomId, at) => {
      set((s) => {
        const baselines = { ...s.baselines };
        Object.defineProperty(baselines, roomId, { value: at, enumerable: true, writable: true, configurable: true });
        return { baselines };
      });
      persist();
    },

    flush: async () => {
      await saveChain;
    },
  };
});

/** 테스트 전용: 모듈 수준 상태(진행 중 hydrate·저장 큐)와 store를 처음 상태로 되돌린다. */
export function resetNotificationsForTest(): void {
  hydratePromise = null;
  saveChain = Promise.resolve();
  saveQueued = false;
  useNotifications.setState({ items: [], baselines: {}, hydrated: false, recovered: false });
}
