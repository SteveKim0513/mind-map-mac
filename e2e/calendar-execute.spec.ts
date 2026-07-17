import { test, expect } from '@playwright/test';
import { launchApp } from './helpers';

// docs/product/specs/2026-07-15-calendar-execute-insight.md (Phase 1+2) +
// 2026-07-15-calendar-timeblocking.md (Phase 3). 캘린더를 "읽는 화면"에서
// "실행하고 되돌아보는 화면"으로 승격한 것: 시간 그리드 블록, 빈 슬롯 캡처,
// 계획↔실행 요약, 소요 시간(타임블로킹) 컨트롤.

async function newMapWithScheduled(page: import('@playwright/test').Page, text: string) {
  await page.click('.sb-section-btn[title="새 마인드맵"]');
  await page.waitForSelector('.canvas', { timeout: 5_000 });
  await page.click('.canvas');
  await page.keyboard.press('Enter');
  await page.waitForSelector('.editing-text', { timeout: 3_000 });
  await page.keyboard.type(text);
  await page.keyboard.press('Enter');
}

test('주간 시간 그리드에 시각 지정 노드가 블록으로 뜬다', { tag: ['@calendar', '@schedule'] }, async () => {
  const { page, cleanup } = await launchApp();
  try {
    await newMapWithScheduled(page, '@오늘 오후 3시 그리드블록');
    await page.click('.sb-nav-item:has-text("캘린더")');
    await page.waitForSelector('.cal', { timeout: 5_000 });
    await page.click('.cal-toggle-btn:has-text("주")');
    await expect(page.locator('.cal-wk-grid')).toBeVisible();
    await expect(page.locator('.cal-wk-block', { hasText: '그리드블록' })).toBeVisible();
  } finally {
    await cleanup();
  }
});

test('일간 요약이 오늘의 계획 개수를 보여준다 (계획↔실행)', { tag: ['@calendar', '@schedule'] }, async () => {
  const { page, cleanup } = await launchApp();
  try {
    await newMapWithScheduled(page, '@오늘 요약계획');
    await page.click('.sb-nav-item:has-text("캘린더")');
    await page.waitForSelector('.cal', { timeout: 5_000 });
    // 기본 진입 = 일간(오늘). 요약 한 줄에 "계획 1"이 뜬다.
    await expect(page.locator('.cal-day-summary')).toContainText('계획 1');
  } finally {
    await cleanup();
  }
});

test('빈 슬롯을 클릭하면 일정 피커가 열리고, 기존 노드를 검색해 일정을 잡는다', { tag: ['@calendar', '@schedule'] }, async () => {
  const { page, cleanup } = await launchApp();
  try {
    // 일정 없는 일반 노드를 하나 만든다 (피커의 검색 대상).
    await page.click('.sb-section-btn[title="새 마인드맵"]');
    await page.waitForSelector('.canvas', { timeout: 5_000 });
    await page.click('.canvas');
    await page.keyboard.press('Enter');
    await page.waitForSelector('.editing-text', { timeout: 3_000 });
    await page.keyboard.type('픽커노드');
    await page.keyboard.press('Enter');

    await page.click('.sb-nav-item:has-text("캘린더")');
    await page.waitForSelector('.cal', { timeout: 5_000 });
    await page.click('.cal-toggle-btn:has-text("주")');
    await page.waitForSelector('.cal-wk-grid', { timeout: 3_000 });

    // 오늘 컬럼의 빈 곳을 클릭 → 피커가 열린다 (새 노드 생성 아님).
    await page.locator('.cal-wk-col.today').click({ position: { x: 20, y: 180 } });
    await page.waitForSelector('.cal-picker', { timeout: 3_000 });

    // 기존 노드를 검색해 선택 → 그 슬롯 시각에 일정이 잡혀 블록으로 뜬다.
    await page.locator('.cal-picker-search').fill('픽커노드');
    await page.locator('.cal-picker-row', { hasText: '픽커노드' }).first().click();

    await expect(page.locator('.cal-wk-block', { hasText: '픽커노드' })).toBeVisible({ timeout: 3_000 });
  } finally {
    await cleanup();
  }
});

test('시각을 지정하면 SchedulePopover에 소요 시간 컨트롤이 뜨고, 칩 선택이 반영된다', { tag: ['@calendar', '@schedule'] }, async () => {
  const { page, cleanup } = await launchApp();
  try {
    await newMapWithScheduled(page, '@오늘 오후 3시 소요노드');
    const node = page.locator('.node', { hasText: '소요노드' });
    await expect(node).toHaveClass(/scheduled/);

    await node.locator('.gchip.sched').click();
    await page.waitForSelector('.sched-pop', { timeout: 3_000 });

    // 시각이 지정돼 있으므로 소요 시간 컨트롤이 노출된다(progressive disclosure).
    await expect(page.locator('.sched-dur')).toBeVisible();
    const oneHour = page.locator('.sched-dur .sched-chip', { hasText: '1시간' });
    await oneHour.click();
    await expect(oneHour).toHaveClass(/\bon\b/);
  } finally {
    await cleanup();
  }
});

test('월간 뷰에서 일정 칩을 다음 날 셀로 드래그하면 그 날짜로 옮겨진다', { tag: ['@calendar', '@schedule'] }, async () => {
  const { page, cleanup } = await launchApp();
  try {
    await newMapWithScheduled(page, '@오늘 드래그노드');
    await page.click('.sb-nav-item:has-text("캘린더")');
    await page.waitForSelector('.cal', { timeout: 5_000 });
    await page.click('.cal-toggle-btn:has-text("월")');
    await page.waitForSelector('.cal-month-grid', { timeout: 3_000 });

    const todayChip = page.locator('.cal-month-cell.today .cal-chip', { hasText: '드래그노드' });
    await expect(todayChip).toBeVisible();

    // 오늘 셀의 다음 셀(= 다음 날)로 HTML5 드래그.
    const tomorrow = page.locator('.cal-month-cell.today + .cal-month-cell');
    await todayChip.dragTo(tomorrow);

    // 옮겨진 칩이 다음 날 셀에 있고, 오늘 셀에는 없다.
    await expect(tomorrow.locator('.cal-chip', { hasText: '드래그노드' })).toBeVisible({ timeout: 3_000 });
    await expect(page.locator('.cal-month-cell.today .cal-chip', { hasText: '드래그노드' })).toHaveCount(0);
  } finally {
    await cleanup();
  }
});
