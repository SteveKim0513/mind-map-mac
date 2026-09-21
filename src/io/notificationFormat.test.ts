import { describe, expect, it } from 'vitest';
import { MAX_NOTIFICATIONS, emptyNotificationsFile, parseNotificationItem, parseNotificationsFile } from './notificationFormat';

const ROOM = 'room-abcdef12';
const item = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  type: 'comment',
  roomId: ROOM,
  folderName: '기획',
  anchor: { kind: 'map', fileId: 'file-1', targetId: 'n1', label: '루트' },
  targetLabel: '계획 · 루트',
  authorName: '민수',
  preview: '일정이 빠듯해요',
  createdAt: 1000,
  read: false,
  ...over,
});

describe('parseNotificationItem', () => {
  it('accepts a valid item and drops unknown fields', () => {
    const it1 = parseNotificationItem({ ...item('c1'), evil: 1 });
    expect(it1).toEqual(item('c1'));
  });

  it('rejects malformed items', () => {
    expect(parseNotificationItem(item('../c1'))).toBeNull();
    expect(parseNotificationItem(item('c1', { type: 'system' }))).toBeNull();
    expect(parseNotificationItem(item('c1', { roomId: 'x' }))).toBeNull();
    expect(parseNotificationItem(item('c1', { read: 'no' }))).toBeNull();
    expect(parseNotificationItem(item('c1', { authorName: '<b>' }))).toBeNull();
    expect(parseNotificationItem(item('c1', { preview: 'x'.repeat(1000) }))).toBeNull();
    expect(parseNotificationItem(item('c1', { anchor: { kind: 'nope' } }))).toBeNull();
    expect(parseNotificationItem(item('c1', { createdAt: -5 }))).toBeNull();
    expect(parseNotificationItem(null)).toBeNull();
  });
});

describe('parseNotificationsFile', () => {
  it('treats anything unrecognizable as an empty file', () => {
    expect(parseNotificationsFile(null)).toEqual(emptyNotificationsFile());
    expect(parseNotificationsFile('x')).toEqual(emptyNotificationsFile());
    expect(parseNotificationsFile([])).toEqual(emptyNotificationsFile());
    expect(parseNotificationsFile({ version: 2, items: [item('c1')] })).toEqual(emptyNotificationsFile());
  });

  it('keeps valid items newest-first, drops bad ones and duplicates', () => {
    const f = parseNotificationsFile({
      version: 1,
      items: [item('a', { createdAt: 10 }), { junk: true }, item('b', { createdAt: 30 }), item('a', { createdAt: 99 }), item('c', { createdAt: 20 })],
      baselines: {},
    });
    expect(f.items.map((i) => i.id)).toEqual(['b', 'c', 'a']);
    expect(f.items.find((i) => i.id === 'a')?.createdAt).toBe(10); // first occurrence wins
  });

  it('caps at the newest MAX_NOTIFICATIONS', () => {
    const items = Array.from({ length: MAX_NOTIFICATIONS + 50 }, (_, i) => item(`c${i}`, { createdAt: i + 1 }));
    const f = parseNotificationsFile({ version: 1, items, baselines: {} });
    expect(f.items).toHaveLength(MAX_NOTIFICATIONS);
    expect(f.items[0].createdAt).toBe(MAX_NOTIFICATIONS + 50);
  });

  it('validates baselines (room ids only, finite non-negative numbers) without prototype pollution', () => {
    const raw = JSON.parse(
      `{"version":1,"items":[],"baselines":{"${ROOM}":1234.9,"bad":5,"__proto__":7,"room-negative1":-1,"room-string12":"1"}}`,
    );
    const f = parseNotificationsFile(raw);
    expect(Object.keys(f.baselines).sort()).toEqual([ROOM, '__proto__'].sort());
    expect(f.baselines[ROOM]).toBe(1234);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(Object.getPrototypeOf(f.baselines)).toBe(Object.prototype);
  });
});
