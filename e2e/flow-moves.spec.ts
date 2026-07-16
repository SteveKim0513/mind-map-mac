import { test, expect } from '@playwright/test';
import { launchApp } from './helpers';

// 카피 감사 Part 2 (docs/product/reports/COPY-AND-FLOW-AUDIT-2026-07-15.md §4) —
// depth/위치/접근점 이동이 실제로 배선됐는지 확인한다: 새 노트 ⌘⇧N, 노트 연결 ⌘L,
// 미리알림 동기화 진입점(⌘K + 설정). 온보딩 코치는 결정 0013로 제거됨.

test('새 노트 메뉴 명령(⌘⇧N 경로)이 노트 편집기를 연다', async () => {
  const { app, page, cleanup } = await launchApp();
  try {
    // ⌘⇧N은 네이티브 메뉴 accelerator → send('menu','new-note'). Playwright는 OS 메뉴
    // accelerator를 직접 누를 수 없어 같은 IPC 경로를 구동한다(global-capture.spec.ts 전략).
    await app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.webContents.send('menu', 'new-note');
    });
    await page.waitForSelector('.note-pane', { timeout: 5_000 });
    await expect(page.locator('.note-pane')).toBeVisible();
  } finally {
    await cleanup();
  }
});

test('⌘L로 선택한 노드에 노트 연결 피커가 열린다', async () => {
  const { page, cleanup } = await launchApp();
  try {
    await page.click('.sb-section-btn[title="새 마인드맵"]');
    await page.waitForSelector('.canvas', { timeout: 5_000 });
    await page.click('.canvas');
    await page.keyboard.press('Enter');
    await page.waitForSelector('.editing-text', { timeout: 3_000 });
    await page.keyboard.type('연결 대상 노드');
    await page.keyboard.press('Enter');
    const node = page.locator('.node', { hasText: '연결 대상 노드' });
    await node.click();
    await page.keyboard.press('Meta+l');
    await expect(page.locator('.picker.note-ctx')).toBeVisible({ timeout: 3_000 });
  } finally {
    await cleanup();
  }
});

test('⌘K "미리알림 동기화 설정"으로 설정이 열리고 미리알림 행이 보인다', async () => {
  const { page, cleanup } = await launchApp();
  try {
    await page.keyboard.press('Meta+k');
    await page.waitForSelector('.qo-input', { timeout: 3_000 });
    await page.fill('.qo-input', '미리알림');
    await page.click('.qo-item:has-text("미리알림 동기화 설정")');
    await page.waitForSelector('.settings', { timeout: 3_000 });
    await expect(page.locator('.set-row', { hasText: '미리알림 동기화' })).toBeVisible();
  } finally {
    await cleanup();
  }
});

test('빈 마인드맵에는 조용한 빈 상태 안내가 뜬다 (온보딩 코치 없음)', async () => {
  const { page, cleanup } = await launchApp();
  try {
    await page.click('.sb-section-btn[title="새 마인드맵"]');
    await page.waitForSelector('.canvas', { timeout: 5_000 });
    // 온보딩 코치는 기능 안정화 전까지 도입하지 않는다(결정 0013) — 조용한 빈 상태만.
    await expect(page.locator('.empty')).toBeVisible();
    await expect(page.locator('.frc')).toHaveCount(0);
  } finally {
    await cleanup();
  }
});
