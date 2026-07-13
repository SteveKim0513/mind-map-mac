import { test, expect } from '@playwright/test';
import { launchApp } from './helpers';

// Regression: SchedulePopover's "스케줄 지우기" button called
// setScheduleAt(id, undefined), which only cleared the date and left
// `scheduled: true` — scheduleInfo(undefined) falls back to a bare "일정"
// label, so the chip never actually disappeared. From the user's side this
// looked exactly like "there's no way to remove a schedule".

test('일정 팝오버의 "스케줄 지우기"를 누르면 일정 칩이 완전히 사라진다', async () => {
  const { page, cleanup } = await launchApp();
  try {
    await page.click('.sb-section-btn[title="새 마인드맵"]');
    await page.waitForSelector('.canvas', { timeout: 5_000 });
    await page.click('.canvas');
    await page.keyboard.press('Enter');
    await page.waitForSelector('.editing-text', { timeout: 3_000 });
    await page.keyboard.type('내일 오후 3시 회의');
    await page.keyboard.press('Enter');

    const node = page.locator('.node', { hasText: '내일 오후 3시 회의' });
    await expect(node).toHaveClass(/scheduled/);
    await expect(node.locator('.gchip.sched')).toBeVisible();

    await node.locator('.gchip.sched').click();
    await page.waitForSelector('.sched-pop', { timeout: 3_000 });
    await page.click('.sched-clear');

    await expect(node).not.toHaveClass(/scheduled/);
    await expect(node.locator('.gchip.sched')).toHaveCount(0);
  } finally {
    await cleanup();
  }
});
