import { test, expect } from '@playwright/test';
import { launchApp } from './helpers';

// Regression coverage for docs/product/REDESIGN-VISION-2026-07.md §3-7 —
// ⌘K auto-learns a quick key (⌥1-9) for repeatedly-run commands and bubbles
// them to the top of the empty-query list.

test('반복 실행한 명령은 목록 맨 위로 올라오고 ⌥ 단축키를 얻는다', { tag: ['@command'] }, async () => {
  const { page, cleanup } = await launchApp();
  try {
    // "사이드바 토글" 명령을 두 번 실행 — usage threshold(2)를 채운다.
    for (let i = 0; i < 2; i++) {
      await page.keyboard.press('Meta+k');
      await page.waitForSelector('.qo', { timeout: 3_000 });
      await page.click('.qo-item:has-text("사이드바 토글")');
      await page.waitForSelector('.qo', { state: 'hidden', timeout: 3_000 });
    }

    await page.keyboard.press('Meta+k');
    await page.waitForSelector('.qo', { timeout: 3_000 });

    // 맨 위(첫 qo-item)로 올라왔고 ⌥ 배지가 붙는다.
    const first = page.locator('.qo-item').first();
    await expect(first).toContainText('사이드바 토글');
    await expect(first.locator('.qo-quickkey')).toHaveText('⌥1');

    // ⌥1을 누르면 검색어 없이도 바로 실행되고 팔레트가 닫힌다.
    await page.keyboard.press('Alt+1');
    await expect(page.locator('.qo')).toHaveCount(0);
  } finally {
    await cleanup();
  }
});
