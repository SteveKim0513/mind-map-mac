import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    testTimeout: 30_000,
    // 로컬 소켓 통합 테스트는 부하가 큰 순간 드물게 연결 단계에서 흔들린다(pre-release 중 1/80 미만 관측, 재현 불가).
    // 1회 재시도로 게이트를 안정화하되, 실패 원인은 openRaw의 failure 진단으로 남긴다.
    retry: 1,
  },
});
