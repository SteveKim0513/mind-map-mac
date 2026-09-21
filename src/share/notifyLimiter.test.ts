import { describe, expect, it } from 'vitest';
import type { NotificationItem } from '../types';
import { createNotifyLimiter } from './notifyLimiter';

const item = (id: string, roomId = 'room-aaaaaaaa'): NotificationItem => ({
  id,
  type: 'comment',
  roomId,
  folderName: roomId === 'room-aaaaaaaa' ? '기획' : '디자인',
  anchor: { kind: 'note', noteId: 'n1' },
  targetLabel: '노트',
  authorName: '민수',
  preview: `코멘트 ${id}`,
  createdAt: 1,
  read: false,
});

function harness(over: { windowMs?: number; max?: number } = {}) {
  const shown: string[] = [];
  const summaries: [string, string, number][] = [];
  let t = 0;
  const timers: { at: number; fn: () => void; alive: boolean }[] = [];
  const lim = createNotifyLimiter({
    onEach: (i) => void shown.push(i.id),
    onSummary: (r, f, n) => void summaries.push([r, f, n]),
    windowMs: over.windowMs ?? 10_000,
    maxPerWindow: over.max ?? 3,
    now: () => t,
    setTimer: (fn, ms) => {
      const h = { at: t + ms, fn, alive: true };
      timers.push(h);
      return h;
    },
    clearTimer: (h) => void ((h as { alive: boolean }).alive = false),
  });
  const advance = (ms: number) => {
    t += ms;
    for (const h of timers) if (h.alive && h.at <= t) {
      h.alive = false;
      h.fn();
    }
  };
  /** 타이머는 깨우지 않고 시계만 흐른다(타이머가 늦게 도는 상황). */
  const skip = (ms: number) => void (t += ms);
  return { lim, shown, summaries, advance, skip };
}

describe('notifyLimiter — 방별 토스트 속도 제한', () => {
  it('창 안의 처음 3개만 개별 토스트, 나머지는 창이 끝날 때 "N개"로 한 번에 합친다', () => {
    const h = harness();
    for (let i = 1; i <= 8; i++) h.lim.push(item(`c${i}`));
    expect(h.shown).toEqual(['c1', 'c2', 'c3']);
    expect(h.summaries).toEqual([]);
    h.advance(9_999);
    expect(h.summaries).toEqual([]);
    h.advance(1);
    expect(h.summaries).toEqual([['room-aaaaaaaa', '기획', 5]]);
  });

  it('창이 지나면 다시 개별 토스트가 나간다', () => {
    const h = harness();
    for (let i = 1; i <= 5; i++) h.lim.push(item(`c${i}`));
    h.advance(10_000); // 합침(2개)
    expect(h.summaries).toEqual([['room-aaaaaaaa', '기획', 2]]);
    h.lim.push(item('c6'));
    h.lim.push(item('c7'));
    expect(h.shown).toEqual(['c1', 'c2', 'c3', 'c6', 'c7']);
  });

  it('방마다 따로 센다', () => {
    const h = harness();
    for (let i = 1; i <= 4; i++) h.lim.push(item(`a${i}`));
    for (let i = 1; i <= 4; i++) h.lim.push(item(`b${i}`, 'room-bbbbbbbb'));
    expect(h.shown).toEqual(['a1', 'a2', 'a3', 'b1', 'b2', 'b3']);
    h.advance(10_000);
    expect(h.summaries.sort()).toEqual([['room-aaaaaaaa', '기획', 1], ['room-bbbbbbbb', '디자인', 1]].sort());
  });

  it('제한 안이면 합침 토스트가 없다', () => {
    const h = harness();
    for (let i = 1; i <= 3; i++) h.lim.push(item(`c${i}`));
    h.advance(60_000);
    expect(h.summaries).toEqual([]);
  });

  it('타이머가 늦게 돌아도(창이 끝난 뒤 다음 알림이 오면) 지난 창의 합침을 먼저 내보내고 새 창을 연다', () => {
    const h = harness();
    for (let i = 1; i <= 5; i++) h.lim.push(item(`c${i}`));
    h.skip(10_000);
    h.lim.push(item('c6'));
    expect(h.summaries).toEqual([['room-aaaaaaaa', '기획', 2]]);
    expect(h.shown).toEqual(['c1', 'c2', 'c3', 'c6']);
  });

  it('flush는 대기 중인 합침을 내보내고 멱등이다', () => {
    const h = harness();
    for (let i = 1; i <= 5; i++) h.lim.push(item(`c${i}`));
    h.lim.flush();
    expect(h.summaries).toEqual([['room-aaaaaaaa', '기획', 2]]);
    h.lim.flush();
    h.advance(20_000);
    expect(h.summaries).toHaveLength(1);
  });
});
