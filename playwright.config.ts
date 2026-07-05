import { defineConfig } from '@playwright/test';

const isCI = !!process.env.CI;

export default defineConfig({
  testDir: './e2e',
  timeout: isCI ? 60_000 : 30_000,
  retries: isCI ? 1 : 0, // CI에서 flaky 방지용 1회 재시도
  workers: 1, // Electron 테스트는 직렬 실행 (인스턴스 하나씩)
  fullyParallel: false,
  reporter: isCI
    ? [['github'], ['html', { open: 'never' }]]
    : [['list'], ['html', { open: 'never' }]],
  use: {
    screenshot: 'only-on-failure',
    video: isCI ? 'retain-on-failure' : 'off',
  },
});
