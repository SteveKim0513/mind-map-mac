// 읽기 전용(뷰어) 문서 가드 — 공유 폴더에서 소유자가 공유한 맵·보드를 참가자가 볼 때 쓴다(ADR 0021).
//
// 규칙: 문서를 바꿀 수 있는 모든 스토어 액션은 **기본 차단**이고, 로컬 표시 상태(선택·팬/줌·검색·접기·필터)와
// 문서 수명주기(load/markSaved/…)만 **명시적 허용 목록**으로 열어 준다. 액션을 하나씩 손으로 막지 않고 스토어
// 생성 지점에서 액션 객체 전체를 감싸므로, 나중에 새 액션이 추가돼도 허용 목록에 넣기 전까지는 뷰어에서 자동 차단된다.
//
// 또 하나의 안전장치: 뷰어 스토어에서는 어떤 경로로든 `dirty: true`가 되지 않는다(`guardSet`). 허용된 표시 액션
// (setView·toggleCollapse …)이 문서 객체를 고치더라도 자동저장 경로(dirty 기준)에 올라가지 못한다.
import type { StoreApi } from 'zustand';

const GUARDED = Symbol.for('mindmap.readOnlyGuarded');

export interface GuardOptions {
  /** 읽기 전용에서도 동작하는 액션(로컬 표시 상태·문서 수명주기). 여기 없는 함수는 모두 차단된다. */
  allow: ReadonlySet<string>;
  /** 차단된 액션이 `undefined` 대신 돌려줄 값(예: `hasClipboard` → false). */
  blockedResult?: Readonly<Record<string, unknown>>;
}

/** 스토어 상태 객체의 함수 프로퍼티를 읽기 전용일 때 아무 일도 하지 않도록 감싼다(허용 목록 제외). */
export function guardActions<S extends { readOnly: boolean }>(state: S, get: () => S, opts: GuardOptions): S {
  const out: Record<string, unknown> = { ...state };
  for (const [key, value] of Object.entries(state)) {
    if (typeof value !== 'function' || opts.allow.has(key)) continue;
    const fn = value as (...args: unknown[]) => unknown;
    const blocked = opts.blockedResult && Object.prototype.hasOwnProperty.call(opts.blockedResult, key) ? opts.blockedResult[key] : undefined;
    const wrapped = (...args: unknown[]): unknown => (get().readOnly ? blocked : fn(...args));
    Object.defineProperty(wrapped, GUARDED, { value: true });
    out[key] = wrapped;
  }
  return out as S;
}

/** `guardActions`가 감싼 함수인가(테스트가 "허용 목록이거나 감싸졌거나"를 전수 검사할 때 쓴다). */
export function isGuardedAction(fn: unknown): boolean {
  return typeof fn === 'function' && (fn as unknown as Record<symbol, unknown>)[GUARDED] === true;
}

/**
 * 스토어의 `set`을 감싼다: 읽기 전용이면 `dirty: true`를 `false`로 되돌린다 — 뷰어 문서는 절대 저장 대상이 되지 않는다.
 * (zustand의 `set` 시그니처가 오버로드돼 있어 여기서만 좁은 캐스팅을 쓴다.)
 */
export function guardSet<S extends { readOnly: boolean; dirty: boolean }>(
  set: StoreApi<S>['setState'],
  get: () => S,
): StoreApi<S>['setState'] {
  const guarded = (partial: unknown, replace?: boolean): void => {
    let next = typeof partial === 'function' ? (partial as (s: S) => unknown)(get()) : partial;
    if (next && typeof next === 'object' && (next as Partial<S>).dirty === true && get().readOnly) {
      next = { ...(next as object), dirty: false };
    }
    (set as (p: unknown, r?: boolean) => void)(next, replace);
  };
  return guarded as StoreApi<S>['setState'];
}
