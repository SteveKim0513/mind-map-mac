// 테스트 전용 — node 환경에서 Tiptap 헤드리스 코덱이 쓸 DOM 전역(document·window·Node …)만 jsdom으로 채운다.
// Event·WebSocket·fetch 같은 네트워크·이벤트 전역은 Node 것을 그대로 둔다: vitest의 `jsdom` 환경은 이 전역들을 jsdom
// 것으로 바꿔 Node 내장 WebSocket이 깨지므로(실제 릴레이와 연결하는 통합 테스트가 못 돈다) 이 방식이 필요하다.
// 반드시 다른 import보다 먼저 import한다(prosemirror-view가 import 시점에 document·navigator를 검사).
import { JSDOM } from 'jsdom';

const KEEP_NODE = new Set([
  'Event', 'EventTarget', 'MessageEvent', 'CloseEvent', 'ErrorEvent', 'CustomEvent', 'WebSocket', 'Blob', 'File', 'FormData',
  'URL', 'URLSearchParams', 'AbortController', 'AbortSignal', 'TextEncoder', 'TextDecoder', 'performance', 'fetch', 'Headers',
  'Request', 'Response', 'crypto', 'navigator', 'self', 'globalThis', 'console', 'setTimeout', 'clearTimeout', 'setInterval',
  'clearInterval', 'queueMicrotask', 'structuredClone', 'atob', 'btoa', 'process', 'Buffer', 'global',
]);

const dom = new JSDOM('<!doctype html><html><body></body></html>', { pretendToBeVisual: true });
const win = dom.window as unknown as Record<string, unknown>;
for (const key of Object.getOwnPropertyNames(win)) {
  if (KEEP_NODE.has(key) || key in globalThis) continue;
  Object.defineProperty(globalThis, key, {
    configurable: true,
    get: () => win[key],
    set: (v: unknown) => Object.defineProperty(globalThis, key, { value: v, configurable: true, writable: true }),
  });
}
(globalThis as Record<string, unknown>).window = win;

/**
 * `WebSocket` 생성자가 Node 내장(undici) 구현인가. vitest의 jsdom 환경은 이 전역을 jsdom 구현으로 바꾸는데(소스에 jsdom 내부 `globalObject`가
 * 보인다) 그 구현은 실제 릴레이와 연결하지 못한다 — 실측: Node 22의 내장은 `class _WebSocket extends EventTarget`, jsdom 것은
 * `class WebSocket extends globalObject.EventTarget`.
 */
export function isNodeWebSocket(ctor: unknown): boolean {
  return typeof ctor === 'function' && !Function.prototype.toString.call(ctor).includes('globalObject');
}

/**
 * 실제 릴레이에 붙는 통합 테스트 파일 상단에서 부른다: Node의 네트워크 전역(WebSocket·fetch)이 살아 있는지 확인하고, 아니면 원인을
 * 알려 주는 오류로 즉시 실패한다(`// @vitest-environment node` 누락·jsdom 환경으로의 변경을 "연결 타임아웃"으로 오인하지 않게).
 */
export function assertNodeNetworkGlobals(): void {
  const g = globalThis as { WebSocket?: unknown; fetch?: unknown };
  if (typeof g.fetch !== 'function' || !isNodeWebSocket(g.WebSocket)) {
    throw new Error(
      '이 통합 테스트는 Node의 WebSocket·fetch 전역이 필요합니다 — 파일 상단에 `// @vitest-environment node`를 두세요(jsdom 환경은 WebSocket을 jsdom 구현으로 바꿔 실제 릴레이와 연결하지 못합니다).',
    );
  }
}
