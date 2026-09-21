// 코멘트 알림 토스트의 방(공유 폴더)별 속도 제한 — 원격 참가자가 코멘트를 쏟아부어도 화면이 토스트로 도배되지 않게 한다.
//
// 알림 자체(사이드바 종 버튼의 숫자 뱃지·알림 센터 목록)는 제한하지 않는다 — 제한하는 것은 화면에 뜨는 즉시 토스트뿐이다.
// 한 창(기본 10초)에 방마다 처음 N개(기본 3)만 개별 토스트로 보여 주고, 그 뒤의 것은 창이 끝날 때 "새 코멘트 N개" 한 번으로 합친다.
import type { NotificationItem } from '../types';

export interface NotifyLimiterOptions {
  /** 제한 안에서 개별로 보여 줄 알림. */
  onEach(item: NotificationItem): void;
  /** 제한을 넘어 합쳐진 알림들(방·폴더 이름·개수) — 창이 끝날 때 한 번. */
  onSummary(roomId: string, folderName: string, count: number): void;
  windowMs?: number;
  maxPerWindow?: number;
  now?: () => number;
  /** 테스트용 타이머 대역(기본 setTimeout/clearTimeout). */
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}

export interface NotifyLimiter {
  push(item: NotificationItem): void;
  /** 대기 중인 합침 토스트를 지금 내보내고 타이머를 정리한다(종료·테스트용). */
  flush(): void;
}

export const DEFAULT_TOAST_WINDOW_MS = 10_000;
export const DEFAULT_TOASTS_PER_WINDOW = 3;

interface RoomState {
  windowStart: number;
  shown: number;
  suppressed: number;
  folderName: string;
  timer: unknown;
}

export function createNotifyLimiter(opts: NotifyLimiterOptions): NotifyLimiter {
  const windowMs = opts.windowMs ?? DEFAULT_TOAST_WINDOW_MS;
  const max = Math.max(1, opts.maxPerWindow ?? DEFAULT_TOASTS_PER_WINDOW);
  const now = opts.now ?? (() => Date.now());
  const setTimer = opts.setTimer ?? ((fn: () => void, ms: number) => setTimeout(fn, ms));
  const clearTimer = opts.clearTimer ?? ((h: unknown) => clearTimeout(h as ReturnType<typeof setTimeout>));
  const rooms = new Map<string, RoomState>();

  const emitSummary = (roomId: string, st: RoomState) => {
    if (st.timer) clearTimer(st.timer);
    st.timer = null;
    const n = st.suppressed;
    st.suppressed = 0;
    if (n > 0) opts.onSummary(roomId, st.folderName, n);
  };

  return {
    push(item) {
      const t = now();
      let st = rooms.get(item.roomId);
      if (st && t - st.windowStart >= windowMs) {
        emitSummary(item.roomId, st); // 지난 창에서 합쳐 둔 것이 남아 있으면 먼저 내보낸다
        st = undefined;
      }
      if (!st) {
        st = { windowStart: t, shown: 0, suppressed: 0, folderName: item.folderName, timer: null };
        rooms.set(item.roomId, st);
      }
      st.folderName = item.folderName;
      if (st.shown < max) {
        st.shown++;
        opts.onEach(item);
        return;
      }
      st.suppressed++;
      if (!st.timer) {
        const roomId = item.roomId;
        const remaining = Math.max(0, st.windowStart + windowMs - t);
        const state = st;
        st.timer = setTimer(() => {
          state.timer = null;
          emitSummary(roomId, state);
          rooms.delete(roomId);
        }, remaining);
      }
    },
    flush() {
      for (const [roomId, st] of rooms) emitSummary(roomId, st);
      rooms.clear();
    },
  };
}
