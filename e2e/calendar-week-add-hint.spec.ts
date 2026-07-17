import { test, expect, type Page } from '@playwright/test';
import { launchApp } from './helpers';

// 주간 시간 그리드의 "+ 일정" 어포던스: 예전에는 컬럼 상단에 고정돼 커서를 따라가지
// 않고 시각도 안 보여, 어디를 클릭하면 몇 시가 잡히는지 알기 어려웠다. 이제 커서의
// 스냅된 시각 위치에 점선 가이드 + "+ 일정 HH:MM" 라벨을 띄운다(클릭 캡처와 일치).
// — 사용자 리포트 2026-07-17.

async function newScheduledNode(page: Page, phrase: string) {
  await page.click('.sb-section-btn[title="새 마인드맵"]');
  await page.waitForSelector('.canvas', { timeout: 5_000 });
  await page.click('.canvas');
  await page.keyboard.press('Enter');
  await page.waitForSelector('.editing-text', { timeout: 3_000 });
  await page.keyboard.type(phrase);
  await page.keyboard.press('Enter');
}

test('주간 그리드: "+ 일정" 힌트가 커서를 따라오며 그 시각을 보여준다', { tag: ['@calendar', '@schedule'] }, async () => {
  const { page, cleanup } = await launchApp();
  try {
    await newScheduledNode(page, '@오늘 오후 3시 시드노드');
    await page.click('.sb-nav-item:has-text("캘린더")');
    await page.waitForSelector('.cal', { timeout: 5_000 });
    await page.locator('.cal-toggle-btn', { hasText: '주' }).click();
    await page.waitForSelector('.cal-wk-grid', { timeout: 5_000 });

    const col = page.locator('.cal-wk-col').nth(3);
    const box = await col.boundingBox();
    expect(box).not.toBeNull();

    const label = page.locator('.cal-wk-addhint-label').first();
    const hintTop = () =>
      page
        .locator('.cal-wk-addhint')
        .first()
        .evaluate((el) => parseFloat((el as HTMLElement).style.top));

    // 위쪽 호버 → 힌트가 그 시각(HH:MM)을 보여준다.
    await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height * 0.2);
    await expect(label).toBeVisible();
    const label1 = (await label.textContent())?.trim() ?? '';
    const top1 = await hintTop();
    expect(label1).toMatch(/\+ 일정 \d{2}:\d{2}/);

    // 아래쪽 호버 → 시각·위치가 커서를 따라 달라진다(상단 고정이 아니다).
    await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height * 0.7);
    const label2 = (await label.textContent())?.trim() ?? '';
    const top2 = await hintTop();
    expect(label2).toMatch(/\+ 일정 \d{2}:\d{2}/);
    expect(label2).not.toBe(label1);
    expect(top2).toBeGreaterThan(top1);

    // 클릭 → 그 시각으로 일정 생성 피커가 열린다(시간 필드 프리필).
    await page.mouse.click(box!.x + box!.width / 2, box!.y + box!.height * 0.7);
    await expect(page.locator('.cal-picker')).toBeVisible({ timeout: 3_000 });
    await expect(page.locator('.cal-picker-timefield')).toBeVisible();
  } finally {
    await cleanup();
  }
});
