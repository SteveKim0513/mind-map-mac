import { useEffect, useRef, type RefObject } from 'react';

const FOCUSABLE =
  'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * 모달의 포커스 관리: Tab/Shift+Tab이 `ref` 안에서만 순환하고, 닫힐 때 열기 전에 포커스가 있던
 * 요소로 돌려준다(키보드 사용자가 자리를 잃지 않게). 초기 포커스는 호출한 컴포넌트가 정한다.
 */
export function useFocusTrap(ref: RefObject<HTMLElement | null>): void {
  // 첫 렌더 시점(자식의 자동 포커스 effect보다 앞)에 열기 전 포커스 요소를 붙잡는다.
  const previousRef = useRef<HTMLElement | null>(
    typeof document !== 'undefined' ? (document.activeElement as HTMLElement | null) : null,
  );
  useEffect(() => {
    const el = ref.current;
    const previous = previousRef.current;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Tab' || !el) return;
      const items = [...el.querySelectorAll<HTMLElement>(FOCUSABLE)];
      if (items.length === 0) {
        e.preventDefault();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      if (e.shiftKey && (active === first || !el.contains(active))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (active === last || !el.contains(active))) {
        e.preventDefault();
        first.focus();
      }
    };
    el?.addEventListener('keydown', onKey);
    return () => {
      el?.removeEventListener('keydown', onKey);
      if (previous && document.contains(previous)) previous.focus();
    };
  }, [ref]);
}
