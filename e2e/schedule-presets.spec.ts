import { test, expect, type Page } from '@playwright/test';
import { launchApp } from './helpers';

// 노드 일정의 원탭 시간 프리셋(아침/점심/저녁/밤)을 설정에서 사용자가 편집할 수 있다.
// 기본값은 그대로 유지하고, 설정에서 바꾸면 SchedulePopover의 시간 칩에 반영된다.
// — 사용자 요청 2026-07-17.

async function newScheduledNode(page: Page, phrase: string) {
  await page.click('.sb-section-btn[title="새 마인드맵"]');
  await page.waitForSelector('.canvas', { timeout: 5_000 });
  await page.click('.canvas');
  await page.keyboard.press('Enter');
  await page.waitForSelector('.editing-text', { timeout: 3_000 });
  await page.keyboard.type(phrase);
  await page.keyboard.press('Enter');
}

const chipLabels = (page: Page) =>
  page.locator('.sched-time-chip .sched-time-lbl').allTextContents();

test('일정 시간 프리셋은 기본값을 유지하고 설정에서 편집하면 팝오버에 반영된다', { tag: ['@schedule', '@command'] }, async () => {
  const { page, cleanup } = await launchApp();
  try {
    await newScheduledNode(page, '@내일 오후 3시 약속');

    // ── 기본 프리셋 확인: 아침/점심/저녁/밤 ─────────────────────────────────
    await page.locator('.gchip.sched').first().click();
    await page.waitForSelector('.sched-pop', { timeout: 3_000 });
    expect(await chipLabels(page)).toEqual(['아침', '점심', '저녁', '밤']);
    await page.click('.sched-pop .sched-x');
    await page.waitForSelector('.sched-pop', { state: 'hidden', timeout: 3_000 });

    // ── 설정 → 고급 → 프리셋 편집: 마지막 행(밤)을 오후/15:00으로 ────────────
    await page.locator('.sb-foot-btn[title^="설정"]').click();
    await page.waitForSelector('.settings', { timeout: 3_000 });
    await page.click('.set-advanced-toggle');
    const rows = page.locator('.set-preset-row');
    await expect(rows).toHaveCount(4);
    await rows.nth(3).locator('.set-preset-lbl').fill('오후');
    await rows.nth(3).locator('.set-preset-time').fill('15:00');
    await page.keyboard.press('Escape');
    await page.waitForSelector('.settings', { state: 'hidden', timeout: 3_000 });

    // ── 팝오버 재오픈: 칩이 오후 15:00로 바뀌고 밤은 사라진다 ────────────────
    await page.locator('.gchip.sched').first().click();
    await page.waitForSelector('.sched-pop', { timeout: 3_000 });
    expect(await chipLabels(page)).toEqual(['아침', '점심', '저녁', '오후']);
    const afternoon = page.locator('.sched-time-chip', { hasText: '오후' });
    await expect(afternoon.locator('.sched-time-sub')).toHaveText('15:00');
    // 새 프리셋을 실제로 적용하면 노드 시각이 15:00가 된다.
    await afternoon.click();
    await expect(page.locator('.sched-native-time')).toHaveValue('15:00');
  } finally {
    await cleanup();
  }
});
