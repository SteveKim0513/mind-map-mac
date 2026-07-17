import { test, expect } from '@playwright/test';
import { launchApp } from './helpers';

// 실행(일정·집중)은 할 일(todo) 노드에서만 — ⌘K 명령 팔레트도 툴바·메뉴와 같은 게이트를
// 지켜야 한다(누수 수정, 결정 0014). 일반 노드엔 "할 일로 전환"만.
test('⌘K: 일반 노드엔 집중·일정 명령이 없고 "할 일로 전환"만, 할 일 노드엔 뜬다', async () => {
  const { page, cleanup } = await launchApp();
  try {
    await page.click('.sb-section-btn[title="새 마인드맵"]');
    await page.waitForSelector('.canvas', { timeout: 5_000 });
    await page.click('.canvas');
    await page.keyboard.press('Enter');
    await page.waitForSelector('.editing-text', { timeout: 3_000 });
    await page.keyboard.type('생각노드');
    await page.keyboard.press('Enter');
    const node = page.locator('.node', { hasText: '생각노드' });
    await node.click(); // select

    // 일반 노드: ⌘K에 집중/일정 없음, "할 일로 전환" 있음
    await page.keyboard.press('Meta+k');
    await page.waitForSelector('.qo', { timeout: 3_000 });
    await page.locator('.qo-input').fill('선택 노드');
    await expect(page.locator('.qo-item', { hasText: '집중 시작' })).toHaveCount(0);
    await expect(page.locator('.qo-item', { hasText: '일정 설정' })).toHaveCount(0);
    await expect(page.locator('.qo-item', { hasText: '할 일로 전환' })).toBeVisible();
    await page.keyboard.press('Escape');

    // 할 일로 전환 → ⌘K에 집중/일정이 뜬다
    await node.click();
    await page.keyboard.press('Meta+Enter');
    await expect(node.locator('.node-check')).toBeVisible();
    await page.keyboard.press('Meta+k');
    await page.waitForSelector('.qo', { timeout: 3_000 });
    await page.locator('.qo-input').fill('선택 노드');
    await expect(page.locator('.qo-item', { hasText: '집중 시작' })).toBeVisible();
    await expect(page.locator('.qo-item', { hasText: '일정 설정' })).toBeVisible();
  } finally {
    await cleanup();
  }
});
