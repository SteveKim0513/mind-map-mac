import { test, expect } from '@playwright/test';
import { startTestRelay, withApps } from './shareHelpers';

// 렌더러 CSP 실효성(ADR 0021 결정 6): 빌드된 앱(file://)의 렌더러가 임의의 외부 목적지로 fetch/WebSocket을 보낼 수 없고,
// 설정된 릴레이 origin으로는 나갈 수 있어야 한다. "네트워크가 막혀서 실패한 것"과 "CSP가 막은 것"을 구분하려고
// 실패 여부가 아니라 `securitypolicyviolation` 이벤트(위반 디렉티브·차단 URI)를 증거로 삼는다.
// 테스트마다 자체 릴레이·임의 포트를 쓴다(병렬 안전).
//
// 한계: 비패키지(E2E/dev)에서는 CSP가 localhost 임의 포트를 허용하므로(electron/share.ts buildConnectSrc allowLocalhost)
// "릴레이가 아닌 다른 localhost 포트가 막힌다"는 여기서 검증할 수 없다. 패키지 빌드의 CSP도 검증하지 못한다.

interface Probe {
  protocol: string;
  externalFetch: { violated: string | null; blocked: string | null; rejected: boolean };
  externalSocket: { violated: string | null; blocked: string | null; opened: boolean };
  relayFetch: { ok: boolean; status: number; violations: number };
  relaySocket: { opened: boolean; violations: number };
}

test(
  '공유 폴더 CSP: 외부 fetch·WebSocket은 CSP 위반으로 막히고 릴레이 origin으로는 나간다',
  { tag: ['@share'] },
  async () => {
    test.setTimeout(60_000);
    const relay = await startTestRelay();
    try {
      await withApps(1, { MINDMAP_RELAY_URL: relay.url }, async ([a]) => {
        const probe = await a.page.evaluate(
          async ({ relayUrl, relayWs }): Promise<Probe> => {
            const violations: { directive: string; blocked: string }[] = [];
            document.addEventListener('securitypolicyviolation', (event) => {
              violations.push({ directive: event.violatedDirective, blocked: event.blockedURI });
            });
            const TIMEOUT_MS = 8000;
            /** 위반 이벤트가 (다른 비동기 작업과 무관하게) 도착할 때까지 이벤트 기반으로 기다린다. */
            const violationFor = (needle: string) =>
              new Promise<{ directive: string; blocked: string } | null>((resolve) => {
                const seen = () => violations.find((v) => v.blocked.includes(needle));
                const existing = seen();
                if (existing) return resolve(existing);
                const onViolation = () => {
                  const hit = seen();
                  if (!hit) return;
                  document.removeEventListener('securitypolicyviolation', onViolation);
                  resolve(hit);
                };
                document.addEventListener('securitypolicyviolation', onViolation);
                setTimeout(() => {
                  document.removeEventListener('securitypolicyviolation', onViolation);
                  resolve(seen() ?? null);
                }, TIMEOUT_MS);
              });
            const socketResult = (url: string) =>
              new Promise<boolean>((resolve) => {
                let ws: WebSocket;
                try {
                  ws = new WebSocket(url);
                } catch {
                  return resolve(false);
                }
                ws.onopen = () => {
                  ws.close();
                  resolve(true);
                };
                ws.onerror = () => resolve(false);
                ws.onclose = () => resolve(false);
              });

            // 1) 외부 fetch — CSP가 막아야 한다
            let rejected = false;
            const externalFetchDone = fetch('https://example.com/', { mode: 'no-cors' }).catch(() => {
              rejected = true;
            });
            const fetchViolation = await violationFor('example.com');
            await externalFetchDone;

            // 2) 외부 WebSocket
            const externalOpened = socketResult('wss://evil.example/');
            const socketViolation = await violationFor('evil.example');
            const opened = await externalOpened;

            // 3) 릴레이 origin — 허용되어야 하고 위반 이벤트가 늘지 않아야 한다
            const before = violations.length;
            const res = await fetch(`${relayUrl}/health`);
            const relayFetch = { ok: res.ok, status: res.status, violations: violations.length - before };
            const relayOpened = await socketResult(relayWs);
            const relaySocket = { opened: relayOpened, violations: violations.length - before - relayFetch.violations };

            return {
              protocol: location.protocol,
              externalFetch: { violated: fetchViolation?.directive ?? null, blocked: fetchViolation?.blocked ?? null, rejected },
              externalSocket: { violated: socketViolation?.directive ?? null, blocked: socketViolation?.blocked ?? null, opened },
              relayFetch,
              relaySocket,
            };
          },
          { relayUrl: relay.url, relayWs: relay.wsUrl },
        );

        // 빌드 앱은 file:// 로 로드된다(dev 서버가 아님)
        expect(probe.protocol).toBe('file:');

        // 외부 fetch: CSP connect-src 위반 이벤트가 있고 요청은 거절됐다
        expect(probe.externalFetch.violated).toMatch(/^connect-src/);
        expect(probe.externalFetch.blocked).toContain('example.com');
        expect(probe.externalFetch.rejected).toBe(true);

        // 외부 WebSocket: 위반 이벤트가 있고 열리지 않았다
        expect(probe.externalSocket.violated).toMatch(/^connect-src/);
        expect(probe.externalSocket.blocked).toContain('evil.example');
        expect(probe.externalSocket.opened).toBe(false);

        // 릴레이: REST(fetch)와 WebSocket 모두 성공, CSP 위반 없음
        expect(probe.relayFetch).toEqual({ ok: true, status: 200, violations: 0 });
        expect(probe.relaySocket).toEqual({ opened: true, violations: 0 });
      });
    } finally {
      await relay.close();
    }
  },
);
