import { test, expect } from '@playwright/test';
import { launchApp } from './helpers';

// UX-CLARITY-VISION 전략 A: 앱의 다른 모든 플로팅 메뉴(우클릭 메뉴, 일정/아이콘/
// 링크 팝오버, 탭 메뉴)는 Escape로 닫히는데 "템플릿 추가" 드롭다운만 그렇지
//않았다 — 우클릭 메뉴에서 배운 "Escape는 항상 닫는다"는 기대가 여기서만
// 배신당했다.

test('"템플릿 추가" 드롭다운은 Escape로 닫힌다', async () => {
  const { page, cleanup } = await launchApp();
  try {
    await page.click('.sb-section-btn[title="새 노트"]');
    await page.waitForSelector('.note-pane', { timeout: 5_000 });

    await page.click('button[title="템플릿 추가"]');
    await expect(page.locator('.meta-add-menu')).toBeVisible({ timeout: 3_000 });

    await page.keyboard.press('Escape');
    await expect(page.locator('.meta-add-menu')).toHaveCount(0);
  } finally {
    await cleanup();
  }
});
