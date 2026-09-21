import { defineConfig } from 'vitest/config';

// Separate from vite.config.ts so the electron plugin doesn't run during tests.
export default defineConfig({
  test: {
    environment: 'node',
    // electron/ 의 순수 로직(share.ts 등)도 테스트한다 — electron 런타임을 import하지 않는 파일만.
    include: ['src/**/*.test.ts', 'electron/**/*.test.ts'],
  },
});
