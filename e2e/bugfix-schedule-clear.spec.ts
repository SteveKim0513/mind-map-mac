import { test, expect } from '@playwright/test';
import { launchApp } from './helpers';

// 버그: 노드의 일정을 해제해도 캘린더에 그대로 남던 문제. collectAgendaCached의
// per-node dedup은 "열린 맵이 뺀 노드"를 못 지켜, 디스크의 (stale) 스케줄 복사본이
// 다시 붙었다. 열린 맵의 파일은 아예 스캔에서 제외하도록 고쳤다.
test('노드의 일정을 해제하면 캘린더에서도 사라진다', async () => {
  const { page, cleanup } = await launchApp();
  try {
    await page.click('.sb-section-btn[title="새 마인드맵"]');
    await page.waitForSelector('.canvas', { timeout: 5_000 });
    await page.click('.canvas');
    await page.keyboard.press('Enter');
    await page.waitForSelector('.editing-text', { timeout: 3_000 });
    await page.keyboard.type('@오늘 해제노드');
    await page.keyboard.press('Enter');
    const node = page.locator('.node', { hasText: '해제노드' });
    await expect(node).toHaveClass(/scheduled/);

    // 캘린더에 뜬다
    await page.click('.sb-nav-item:has-text("캘린더")');
    await page.waitForSelector('.cal', { timeout: 5_000 });
    await expect(page.locator('.cal-daycard', { hasText: '해제노드' })).toBeVisible();

    // 맵 탭으로 돌아가 우클릭 → 스케줄 해제
    await page.locator('.tab').first().click();
    await page.waitForSelector('.canvas', { timeout: 5_000 });
    await node.click({ button: 'right' });
    await page.waitForSelector('.ctx-menu', { timeout: 3_000 });
    await page.click('.ctx-item:has-text("스케줄 해제")');
    await expect(node).not.toHaveClass(/scheduled/);

    // 다시 캘린더 → 더 이상 없다 (열린 맵의 라이브 상태가 authoritative)
    await page.click('.sb-nav-item:has-text("캘린더")');
    await page.waitForSelector('.cal', { timeout: 5_000 });
    await expect(page.locator('.cal-daycard', { hasText: '해제노드' })).toHaveCount(0, { timeout: 3_000 });
  } finally {
    await cleanup();
  }
});
