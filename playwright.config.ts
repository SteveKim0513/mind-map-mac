import { defineConfig } from '@playwright/test';

const isCI = !!process.env.CI;

export default defineConfig({
  testDir: './e2e',
  timeout: isCI ? 60_000 : 30_000,
  // 병렬 실행에서는 CPU 포화로 개별 액션 타임아웃(노드 생성 등)이 드물게 밀릴 수
  // 있다 — 1회 재시도로 이런 부하성 flake를 흡수한다(실패 시에만 재시도).
  // 결정적 실패는 두 번 다 깨지므로 진짜 회귀는 그대로 드러난다.
  retries: 1,
  // 각 test는 격리된 userData·workspace로 자체 Electron 인스턴스를 띄우므로
  // 병렬 실행이 안전하다. 유일한 OS 전역 자원 충돌(캡처 단축키 Alt+Space)은
  // 기본 등록 비활성화 + 단일 opt-in 테스트로 제거했고(e2e/helpers.ts,
  // electron/main.ts MINDMAP_DISABLE_GLOBAL_SHORTCUT), frontmost(앱 활성화)에
  // 의존하는 소수 테스트는 @serial로 표시해 scripts/e2e-run.mjs가 직렬 꼬리로
  // 돌린다. 워커 수는 PW_WORKERS로 조정 가능(기본 4 — Electron은 인스턴스당
  // 프로세스가 많아 코어의 1/3이 부하·속도 균형점). CI 러너는 코어가 적어 2.
  workers: isCI ? 2 : Number(process.env.PW_WORKERS) || 4,
  fullyParallel: true,
  reporter: isCI
    ? [['github'], ['html', { open: 'never' }]]
    : [['list'], ['html', { open: 'never' }]],
  use: {
    screenshot: 'only-on-failure',
    video: isCI ? 'retain-on-failure' : 'off',
  },
});
