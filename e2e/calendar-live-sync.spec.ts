import { test, expect, type Page } from '@playwright/test';
import { launchApp } from './helpers';

// 회귀: 분할 뷰에서 캘린더가 마운트된 채로 옆 맵 패널에 스케줄을 부여하면, 캘린더가
// 갱신되지 않았다. CalendarView가 마운트 시 1회만 아젠다를 수집했기 때문(탭 전환은
// remount로 반영됐지만 분할 뷰에선 둘 다 계속 떠 있어 반영 안 됨). 이제 열린 맵
// 스토어 변경을 구독해 라이브로 재수집한다. — 사용자 리포트 2026-07-17.

async function newScheduledNode(page: Page, phrase: string) {
  await page.click('.sb-section-btn[title="새 마인드맵"]');
  await page.waitForSelector('.canvas', { timeout: 5_000 });
  await page.click('.canvas');
  await page.keyboard.press('Enter');
  await page.waitForSelector('.editing-text', { timeout: 3_000 });
  await page.keyboard.type(phrase);
  await page.keyboard.press('Enter');
}

test('분할 뷰: 맵에서 스케줄을 부여하면 옆 캘린더가 재오픈 없이 갱신된다', { tag: ['@calendar', '@schedule'] }, async () => {
  const { page, cleanup } = await launchApp();
  try {
    // 시드 스케줄 노드 → 캘린더 진입 → "오른쪽에 열기"로 우측 분할(캘린더 좌 + 맵 우, 둘 다 마운트)
    await newScheduledNode(page, '@오늘 오후 3시 시드노드');
    await page.click('.sb-nav-item:has-text("캘린더")');
    await page.waitForSelector('.cal', { timeout: 5_000 });

    await page
      .locator('.cal-daycard', { hasText: '시드노드' })
      .locator('.cal-daycard-hit')
      .click();
    await expect(page.locator('.cal-peek-drawer')).toBeVisible();
    await page.locator('.cal-peek-open').first().click();
    await expect(page.locator('.panes.split')).toBeVisible({ timeout: 3_000 });

    // 우측 맵 캔버스에 오늘 스케줄 노드를 새로 추가 (탭 전환 없음).
    const canvas = page.locator('.panes.split .canvas').last();
    await canvas.click();
    await page.keyboard.press('Enter');
    await page.waitForSelector('.editing-text', { timeout: 3_000 });
    await page.keyboard.type('@오늘 오후 4시 라이브추가노드');
    await page.keyboard.press('Enter');

    // 재오픈/탭 전환 없이 좌측 캘린더 일간 목록이 새 노드를 보여줘야 한다(라이브 구독).
    await expect(page.locator('.cal-daycard', { hasText: '라이브추가노드' })).toBeVisible({
      timeout: 6_000,
    });
  } finally {
    await cleanup();
  }
});
