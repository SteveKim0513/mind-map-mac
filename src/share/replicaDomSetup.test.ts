// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { assertNodeNetworkGlobals, isNodeWebSocket } from './replicaDomSetup';

describe('통합 테스트 환경 가드', () => {
  it('node 환경의 내장 WebSocket·fetch를 통과시킨다', () => {
    expect(isNodeWebSocket(globalThis.WebSocket)).toBe(true);
    expect(() => assertNodeNetworkGlobals()).not.toThrow();
  });

  it('jsdom 구현(소스에 globalObject가 보이는 클래스)이나 함수가 아닌 값은 거부한다', () => {
    class JsdomLike {
      constructor() {
        // jsdom의 WebSocket 구현은 이런 식으로 globalObject를 참조한다
        void (globalObject as unknown);
      }
    }
    const globalObject = {};
    expect(isNodeWebSocket(JsdomLike)).toBe(false);
    expect(isNodeWebSocket(undefined)).toBe(false);
    expect(isNodeWebSocket({})).toBe(false);
  });

  it('WebSocket이나 fetch가 없거나 jsdom 것이면 원인을 알려 주며 던진다', () => {
    const g = globalThis as { WebSocket?: unknown; fetch?: unknown };
    const savedWs = g.WebSocket;
    const savedFetch = g.fetch;
    try {
      g.WebSocket = undefined;
      expect(() => assertNodeNetworkGlobals()).toThrow(/vitest-environment node/);
      g.WebSocket = savedWs;
      g.fetch = undefined;
      expect(() => assertNodeNetworkGlobals()).toThrow(/vitest-environment node/);
    } finally {
      g.WebSocket = savedWs;
      g.fetch = savedFetch;
    }
  });
});
