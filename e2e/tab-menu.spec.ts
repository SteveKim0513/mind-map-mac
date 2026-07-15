import { test, expect } from '@playwright/test';
import { launchApp, createNoteFromMenu } from './helpers';

// UX-CLARITY-VISION 전략 A: 탭 우클릭 메뉴는 캔버스 우클릭 메뉴와 달리 Escape로
// 안 닫히고 화면 경계 클램핑도 없었다 — 같은 "우클릭하면 보조 메뉴가 뜬다"는
// 학습이 탭에서는 배신당했다. 공유 훅(useDismissablePosition)으로 통일한 뒤,
// 실제로 Escape가 먹는지 확인한다.

test('탭 우클릭 메뉴는 Escape로 닫힌다', async () => {
  const { page, cleanup } = await launchApp();
  try {
    await createNoteFromMenu(page);
    await page.waitForSelector('.tab', { timeout: 5_000 });

    await page.click('.tab', { button: 'right' });
    await expect(page.locator('.tab-menu')).toBeVisible({ timeout: 3_000 });

    await page.keyboard.press('Escape');
    await expect(page.locator('.tab-menu')).toHaveCount(0);
  } finally {
    await cleanup();
  }
});

test('탭 우클릭 메뉴에서 "닫기"를 누르면 해당 탭이 닫힌다(회귀 방지)', async () => {
  const { page, cleanup } = await launchApp();
  try {
    await createNoteFromMenu(page);
    await page.waitForSelector('.tab', { timeout: 5_000 });

    await page.click('.tab', { button: 'right' });
    await page.waitForSelector('.tab-menu', { timeout: 3_000 });
    await page.click('.tab-menu .ctx-item:has-text("닫기")');

    await expect(page.locator('.tab')).toHaveCount(0);
  } finally {
    await cleanup();
  }
});
