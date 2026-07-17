import { test, expect } from '@playwright/test';
import { launchApp } from './helpers';

// UX-CLARITY-VISION 전략 G: 색상 선택 UI가 컨텍스트 메뉴(.ctx-colors)와 선택
// 툴바(.st-swatches) 두 벌로 따로 구현돼 있었고, 툴바 쪽은 현재 색을 표시하는
// "on" 링이 아예 없었다 — 같은 개념이 진입점마다 다르게 보이는 문제. 공유
// ColorSwatchGrid로 통합한 뒤에도 두 진입점 모두 색을 정확히 적용하고, 현재
// 색을 "on" 상태로 보여주는지 확인한다.

test('선택 툴바의 색상 스와치는 적용한 색을 켜진 상태로 보여준다', { tag: ['@map'] }, async () => {
  const { page, cleanup } = await launchApp();
  try {
    await page.click('.sb-section-btn[title="새 마인드맵"]');
    await page.waitForSelector('.canvas', { timeout: 5_000 });
    await page.click('.canvas');
    await page.keyboard.press('Enter');
    await page.waitForSelector('.editing-text', { timeout: 3_000 });
    await page.keyboard.type('색 테스트');
    await page.keyboard.press('Enter'); // commit edit (Escape would discard it), keep node selected

    const node = page.locator('.node', { hasText: '색 테스트' });
    await expect(node).toBeVisible();

    await page.click('.st-btn[title="색상"]');
    await page.waitForSelector('.st-swatches', { timeout: 3_000 });
    const firstSwatch = page.locator('.st-swatches .color-swatch:not(.none)').first();
    await firstSwatch.click();

    // node picked up the color, flyout closed
    await expect(node).toHaveClass(/tinted/);
    await expect(page.locator('.st-swatches')).toHaveCount(0);

    // reopening the flyout shows the applied color already marked "on" —
    // st-swatches never did this before the ColorSwatchGrid unification.
    await page.click('.st-btn[title="색상"]');
    await page.waitForSelector('.st-swatches', { timeout: 3_000 });
    await expect(page.locator('.st-swatches .color-swatch.on')).toHaveCount(1);
  } finally {
    await cleanup();
  }
});

test('컨텍스트 메뉴의 색상 스와치도 같은 컴포넌트를 공유한다', { tag: ['@map'] }, async () => {
  const { page, cleanup } = await launchApp();
  try {
    await page.click('.sb-section-btn[title="새 마인드맵"]');
    await page.waitForSelector('.canvas', { timeout: 5_000 });
    await page.click('.canvas');
    await page.keyboard.press('Enter');
    await page.waitForSelector('.editing-text', { timeout: 3_000 });
    await page.keyboard.type('메뉴 색 테스트');
    await page.keyboard.press('Enter'); // commit edit (Escape would discard it), keep node selected

    const node = page.locator('.node', { hasText: '메뉴 색 테스트' });
    await expect(node).toBeVisible();
    await node.click({ button: 'right' });
    await page.waitForSelector('.ctx-menu', { timeout: 3_000 });
    await page.locator('.ctx-colors .color-swatch:not(.none)').first().click();

    await expect(node).toHaveClass(/tinted/);

    await node.click({ button: 'right' });
    await page.waitForSelector('.ctx-menu', { timeout: 3_000 });
    await expect(page.locator('.ctx-colors .color-swatch.on')).toHaveCount(1);
  } finally {
    await cleanup();
  }
});
