// 알림 저장 파일(`userData/notifications.json`)의 경계 — 렌더러가 main으로 보내는 값도, main이 디스크에서 읽은 값도
// 신뢰하지 않는다. 항목 하나가 어긋나면 그 항목만 버리고, 파일 전체가 어긋나면 빈 상태로 취급한다(던지지 않는다).
import type { NotificationItem, NotificationsFile } from '../types';
import { parseCommentAnchor } from './commentFormat';
import { isRoomId, isSafeDocId, parseDisplayName } from './shareFormat';

/** 저장하는 알림 개수 상한(최근 것부터). */
export const MAX_NOTIFICATIONS = 500;
/** 방 기준선 개수 상한(방이 이보다 많을 일은 없다 — 손상된 파일 방어). */
const MAX_BASELINES = 1000;
const MAX_FOLDER_NAME = 255;
const MAX_TARGET_LABEL = 300;
const MAX_STORED_PREVIEW = 200;

export const emptyNotificationsFile = (): NotificationsFile => ({ version: 1, items: [], baselines: {} });

const hasBadChar = (s: string): boolean => /[\p{C}]/u.test(s);
// 미리보기는 줄바꿈 없는 한 줄이다(previewOf가 공백을 접는다).
const hasControl = (s: string): boolean => /\p{Cc}/u.test(s);

export function parseNotificationItem(raw: unknown): NotificationItem | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  if (!isSafeDocId(o.id)) return null;
  if (o.type !== 'comment') return null;
  if (!isRoomId(o.roomId)) return null;
  if (typeof o.folderName !== 'string' || o.folderName.length > MAX_FOLDER_NAME || hasBadChar(o.folderName)) return null;
  const anchor = parseCommentAnchor(o.anchor);
  if (!anchor) return null;
  if (typeof o.targetLabel !== 'string' || o.targetLabel.length > MAX_TARGET_LABEL || hasBadChar(o.targetLabel)) return null;
  const authorName = parseDisplayName(o.authorName);
  if (!authorName) return null;
  if (typeof o.preview !== 'string' || o.preview.length > MAX_STORED_PREVIEW || hasControl(o.preview)) return null;
  if (typeof o.createdAt !== 'number' || !Number.isFinite(o.createdAt) || o.createdAt < 0) return null;
  if (typeof o.read !== 'boolean') return null;
  return {
    id: o.id,
    type: 'comment',
    roomId: o.roomId,
    folderName: o.folderName,
    anchor,
    targetLabel: o.targetLabel,
    authorName,
    preview: o.preview,
    createdAt: Math.floor(o.createdAt),
    read: o.read,
  };
}

/** 저장 파일 → 검증된 내용. 알 수 없는 필드는 버리고, 중복 id는 첫 항목만, 최신 500건만 취한다. */
export function parseNotificationsFile(raw: unknown): NotificationsFile {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return emptyNotificationsFile();
  const o = raw as Record<string, unknown>;
  if (o.version !== 1) return emptyNotificationsFile();
  const seen = new Set<string>();
  const items: NotificationItem[] = [];
  if (Array.isArray(o.items)) {
    for (const r of o.items.slice(0, MAX_NOTIFICATIONS * 2)) {
      const item = parseNotificationItem(r);
      if (item && !seen.has(item.id)) {
        seen.add(item.id);
        items.push(item);
      }
    }
  }
  items.sort((a, b) => b.createdAt - a.createdAt || (a.id < b.id ? -1 : 1));
  const baselines: Record<string, number> = {};
  if (o.baselines && typeof o.baselines === 'object' && !Array.isArray(o.baselines)) {
    let n = 0;
    for (const [roomId, at] of Object.entries(o.baselines as Record<string, unknown>)) {
      if (n >= MAX_BASELINES) break;
      if (isRoomId(roomId) && typeof at === 'number' && Number.isFinite(at) && at >= 0) {
        Object.defineProperty(baselines, roomId, { value: Math.floor(at), enumerable: true, writable: true, configurable: true });
        n++;
      }
    }
  }
  return { version: 1, items: items.slice(0, MAX_NOTIFICATIONS), baselines };
}
