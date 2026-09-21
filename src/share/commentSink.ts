// commentSync의 기본 출력 — 전역 store(코멘트 목록·알림). share/는 store/를 import할 수 있다(의존성 방향: store → domain).
import { useComments } from '../store/commentStore';
import { useNotifications } from '../store/notificationStore';
import type { CommentSyncSink } from './commentSync';

export function storeCommentSink(): CommentSyncSink {
  return {
    setComments: (roomId, comments) => useComments.getState().setRoomComments(roomId, comments),
    addNotification: (item) => useNotifications.getState().add(item),
    hasNotification: (id) => useNotifications.getState().has(id),
    removeNotification: (id) => useNotifications.getState().remove(id),
    getBaseline: (roomId) => useNotifications.getState().getBaseline(roomId),
    setBaseline: (roomId, at) => useNotifications.getState().setBaseline(roomId, at),
    ready: () => useNotifications.getState().hydrate(),
    stateLost: () => useNotifications.getState().recovered,
    setControls: (roomId, controls) => useComments.getState().setControls(roomId, controls),
  };
}
