// 코멘트 동기화 테스트 전용 도구 — 전역 store 대신 메모리에 모으는 sink (프로덕션 코드에서 import하지 않는다).
import type { Comment, NotificationItem } from '../types';
import type { CommentControls } from '../store/commentStore';
import type { CommentSyncSink } from './commentSync';

export function memSink(over: Partial<{ baselines: Record<string, number>; preNotified: string[]; stateLost: boolean }> = {}) {
  const notifications = new Map<string, NotificationItem>();
  for (const id of over.preNotified ?? []) notifications.set(id, { id } as NotificationItem);
  const baselines = new Map<string, number>(Object.entries(over.baselines ?? {}));
  const lists: Comment[][] = [];
  let controls: CommentControls | null = null;
  const sink: CommentSyncSink = {
    setComments: (_roomId, c) => void lists.push(c),
    addNotification: (item) => {
      if (notifications.has(item.id)) return false;
      notifications.set(item.id, item);
      return true;
    },
    hasNotification: (id) => notifications.has(id),
    removeNotification: (id) => void notifications.delete(id),
    getBaseline: (r) => baselines.get(r),
    setBaseline: (r, at) => void baselines.set(r, at),
    ready: async () => undefined,
    stateLost: () => over.stateLost === true,
    setControls: (_r, c) => void (controls = c),
  };
  return { sink, notifications, baselines, lists, controls: () => controls };
}
