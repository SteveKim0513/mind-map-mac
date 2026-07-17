import { test, expect } from '@playwright/test';
import { launchApp } from './helpers';

// Regression coverage for the node-anchored popover refactor (SchedulePopover/
// NodePopover/LinkAddPopover now share useNodeAnchoredPosition +
// useOutsideDismiss instead of each hand-rolling the same position/dismiss
// logic — UX-CLARITY-VISION 전략 A). These two popovers had no prior E2E
// coverage at all.

test('아이콘 팝오버 — 우클릭 메뉴로 열고, 아이콘을 고르고, Escape로 닫힌다', { tag: ['@map'] }, async () => {
  const { page, cleanup } = await launchApp();
  try {
    await page.click('.sb-section-btn[title="새 마인드맵"]');
    await page.waitForSelector('.canvas', { timeout: 5_000 });
    await page.click('.canvas');
    await page.keyboard.press('Enter');
    await page.waitForSelector('.editing-text', { timeout: 3_000 });
    await page.keyboard.type('아이콘 테스트');
    await page.keyboard.press('Enter');

    const node = page.locator('.node', { hasText: '아이콘 테스트' });
    await node.click({ button: 'right' });
    await page.waitForSelector('.ctx-menu', { timeout: 3_000 });
    await page.click('.ctx-item:has-text("아이콘…")');

    await expect(page.locator('.icon-pop')).toBeVisible({ timeout: 3_000 });
    await page.click('.icon-pop .icon-opt[title="별표"]');
    await expect(node.locator('.icon')).toBeVisible();
    await expect(page.locator('.icon-pop')).toBeVisible(); // picking an icon doesn't auto-close

    await page.keyboard.press('Escape');
    await expect(page.locator('.icon-pop')).toHaveCount(0);
  } finally {
    await cleanup();
  }
});

test('링크 추가 팝오버 — 우클릭 메뉴로 열고, URL을 넣으면 링크 칩이 생긴다', { tag: ['@map'] }, async () => {
  const { page, cleanup } = await launchApp();
  try {
    await page.click('.sb-section-btn[title="새 마인드맵"]');
    await page.waitForSelector('.canvas', { timeout: 5_000 });
    await page.click('.canvas');
    await page.keyboard.press('Enter');
    await page.waitForSelector('.editing-text', { timeout: 3_000 });
    await page.keyboard.type('링크 테스트');
    await page.keyboard.press('Enter');

    const node = page.locator('.node', { hasText: '링크 테스트' });
    await node.click({ button: 'right' });
    await page.waitForSelector('.ctx-menu', { timeout: 3_000 });
    await page.click('.ctx-item:has-text("링크 추가")');

    await expect(page.locator('.linkadd-pop')).toBeVisible({ timeout: 3_000 });
    await page.fill('.linkadd-input', 'https://example.com');
    await page.keyboard.press('Enter');

    await expect(page.locator('.linkadd-pop')).toHaveCount(0);
    await expect(node.locator('.gchip.link')).toBeVisible();
  } finally {
    await cleanup();
  }
});
