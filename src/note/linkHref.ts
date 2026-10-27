// 사용자가 입력한 링크 주소를 열 수 있는 형태로 다듬는다 — 순수 함수(React·store 무의존).
// 스킴이 없는 `naver.com`은 그대로 열면 앱 내부 상대 경로로 해석돼 조용히 실패하므로 https://를 붙인다.
// 위험한 스킴(file: 등)을 막는 일은 여기서 하지 않는다 — 열기 직전 `io/linkSafety`가 맡는다.

const HAS_SCHEME = /^[a-z][a-z0-9+.-]*:/i;
const HOST_PORT = /^[^\s/:@]+:\d+(\/|$|\?|#)/; // localhost:3000/x — 스킴처럼 보이지만 주소다
const EMAIL = /^[^\s/:@]+@[^\s/:@]+\.[^\s/:@]+$/;

export function normalizeLinkHref(raw: string): string {
  const s = raw.trim();
  if (!s) return '';
  if (HOST_PORT.test(s)) return `https://${s}`;
  if (HAS_SCHEME.test(s)) return s;
  if (EMAIL.test(s)) return `mailto:${s}`;
  return `https://${s}`;
}
