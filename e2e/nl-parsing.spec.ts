import { test, expect } from '@playwright/test';
import { launchApp } from './helpers';

// Regression coverage for docs/product/REDESIGN-VISION-2026-07.md §3-2 /
// docs/exec-plans/active/2026-07-10-nl-schedule-parsing.md.

test('노드 텍스트에 "@내일 3시"를 커밋하면 자동으로 일정이 잡힌다', { tag: ['@schedule', '@map'] }, async () => {
  const { page, cleanup } = await launchApp();
  try {
    await page.click('.sb-section-btn[title="새 마인드맵"]');
    await page.waitForSelector('.canvas', { timeout: 5_000 });
    await page.click('.canvas');
    await page.keyboard.press('Enter');
    await page.waitForSelector('.editing-text', { timeout: 3_000 });
    await page.keyboard.type('@내일 오후 3시 리뷰');
    await page.keyboard.press('Enter');

    const node = page.locator('.node', { hasText: '@내일 오후 3시 리뷰' });
    await expect(node).toHaveClass(/scheduled/);
    await expect(node.locator('.gchip.sched')).toBeVisible();
  } finally {
    await cleanup();
  }
});

test('"@" 없이 "오늘"을 라벨처럼 써도 일정으로 오인식하지 않는다', { tag: ['@schedule', '@map'] }, async () => {
  // Regression: 사용자 리포트 — "오늘 : 회의 메모"처럼 라벨로 쓴 날짜 단어가
  // 계속 자동으로 일정을 만들어 불편했다. 이제 "@"로 명시해야만 인식한다.
  const { page, cleanup } = await launchApp();
  try {
    await page.click('.sb-section-btn[title="새 마인드맵"]');
    await page.waitForSelector('.canvas', { timeout: 5_000 });
    await page.click('.canvas');
    await page.keyboard.press('Enter');
    await page.waitForSelector('.editing-text', { timeout: 3_000 });
    await page.keyboard.type('오늘 : 회의 메모');
    await page.keyboard.press('Enter');

    const node = page.locator('.node', { hasText: '오늘 : 회의 메모' });
    await expect(node).not.toHaveClass(/scheduled/);
    await expect(node.locator('.gchip.sched')).toHaveCount(0);
  } finally {
    await cleanup();
  }
});

test('노드 텍스트에 "#red"를 커밋하면 자동으로 색이 지정된다', { tag: ['@schedule', '@map'] }, async () => {
  const { page, cleanup } = await launchApp();
  try {
    await page.click('.sb-section-btn[title="새 마인드맵"]');
    await page.waitForSelector('.canvas', { timeout: 5_000 });
    await page.click('.canvas');
    await page.keyboard.press('Enter');
    await page.waitForSelector('.editing-text', { timeout: 3_000 });
    await page.keyboard.type('급한 작업 #red');
    await page.keyboard.press('Enter');

    const node = page.locator('.node', { hasText: '급한 작업 #red' });
    await expect(node).toHaveClass(/tinted/);
  } finally {
    await cleanup();
  }
});

test('일반 텍스트("할 일이 3개 남았다")는 일정으로 오인식하지 않는다', { tag: ['@schedule', '@map'] }, async () => {
  const { page, cleanup } = await launchApp();
  try {
    await page.click('.sb-section-btn[title="새 마인드맵"]');
    await page.waitForSelector('.canvas', { timeout: 5_000 });
    await page.click('.canvas');
    await page.keyboard.press('Enter');
    await page.waitForSelector('.editing-text', { timeout: 3_000 });
    await page.keyboard.type('할 일이 3개 남았다');
    await page.keyboard.press('Enter');

    const node = page.locator('.node', { hasText: '할 일이 3개 남았다' });
    await expect(node).not.toHaveClass(/scheduled/);
  } finally {
    await cleanup();
  }
});
