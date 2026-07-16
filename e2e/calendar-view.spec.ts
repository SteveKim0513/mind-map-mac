import { test, expect } from '@playwright/test';
import { launchApp } from './helpers';

// 결정 0011 §4-4 / docs/product/specs/2026-07-15-calendar-view.md — "오늘"
// 오버레이를 캘린더 탭(일/주/월)으로 승격. 사이드바 "캘린더" 버튼 → 탭으로
// 열리고, 기본 진입 뷰는 일간이라 오늘 일정이 첫 화면에 바로 보인다.

test('사이드바 "캘린더"를 누르면 캘린더가 탭으로 열리고 일간 뷰가 기본이다', async () => {
  const { page, cleanup } = await launchApp();
  try {
    await page.click('.sb-nav-item:has-text("캘린더")');
    await page.waitForSelector('.cal', { timeout: 5_000 });
    await expect(page.locator('.tab')).toHaveCount(1);
    await expect(page.locator('.cal-toggle-btn.on')).toHaveText('일');
    await expect(page.locator('.cal-empty')).toContainText('오늘 예정된 일정이 없어요');
  } finally {
    await cleanup();
  }
});

test('캘린더는 싱글턴 탭이다 — 두 번 열어도 탭이 하나만 생긴다', async () => {
  const { page, cleanup } = await launchApp();
  try {
    await page.click('.sb-section-btn[title="새 마인드맵"]');
    await page.waitForSelector('.canvas', { timeout: 5_000 });
    await page.click('.sb-nav-item:has-text("캘린더")');
    await page.waitForSelector('.cal', { timeout: 5_000 });
    await expect(page.locator('.tab')).toHaveCount(2); // 마인드맵 탭 + 캘린더 탭

    // 다른 탭으로 옮긴 뒤 다시 "캘린더"를 눌러도 새 탭이 생기지 않고 기존 탭이 활성화된다.
    await page.locator('.tab').first().click();
    await page.click('.sb-nav-item:has-text("캘린더")');
    await expect(page.locator('.tab')).toHaveCount(2);
    await expect(page.locator('.cal')).toBeVisible();
  } finally {
    await cleanup();
  }
});

test('오늘 일정이 있으면 일간 뷰에 나타나고, 집중을 시작할 수 있다', async () => {
  const { page, cleanup } = await launchApp();
  try {
    await page.click('.sb-section-btn[title="새 마인드맵"]');
    await page.waitForSelector('.canvas', { timeout: 5_000 });
    await page.click('.canvas');
    await page.keyboard.press('Enter');
    await page.waitForSelector('.editing-text', { timeout: 3_000 });
    await page.keyboard.type('@오늘 오후 3시 캘린더 테스트 노드');
    await page.keyboard.press('Enter');
    await expect(page.locator('.node', { hasText: '캘린더 테스트 노드' })).toHaveClass(/scheduled/);

    await page.click('.sb-nav-item:has-text("캘린더")');
    await page.waitForSelector('.cal', { timeout: 5_000 });

    const card = page.locator('.cal-daycard', { hasText: '캘린더 테스트 노드' });
    await expect(card).toBeVisible();
    await card.locator('.cal-daycard-act--focus').click();
    await page.waitForSelector('.focus-start', { timeout: 3_000 });
  } finally {
    await cleanup();
  }
});

test('일/주/월 토글이 각각 다른 레이아웃을 보여준다', async () => {
  const { page, cleanup } = await launchApp();
  try {
    await page.click('.sb-nav-item:has-text("캘린더")');
    await page.waitForSelector('.cal', { timeout: 5_000 });

    await page.click('.cal-toggle-btn:has-text("주")');
    await expect(page.locator('.cal-wk-grid')).toBeVisible();

    await page.click('.cal-toggle-btn:has-text("월")');
    await expect(page.locator('.cal-month-grid')).toBeVisible();
    await expect(page.locator('.cal-month-cell.today')).toBeVisible();

    await page.click('.cal-toggle-btn:has-text("일")');
    await expect(page.locator('.cal-empty')).toBeVisible();
  } finally {
    await cleanup();
  }
});

test('월간 뷰에서 오늘 셀을 클릭하면 일간 뷰로 전환된다', async () => {
  const { page, cleanup } = await launchApp();
  try {
    await page.click('.sb-nav-item:has-text("캘린더")');
    await page.waitForSelector('.cal', { timeout: 5_000 });
    await page.click('.cal-toggle-btn:has-text("월")');
    await page.waitForSelector('.cal-month-grid', { timeout: 3_000 });

    await page.click('.cal-month-cell.today');
    await expect(page.locator('.cal-toggle-btn.on')).toHaveText('일');
    await expect(page.locator('.cal-empty')).toBeVisible();
  } finally {
    await cleanup();
  }
});

test('⌘K 명령 팔레트의 "캘린더 열기"로도 캘린더 탭을 열 수 있다', async () => {
  const { page, cleanup } = await launchApp();
  try {
    await page.keyboard.press('Meta+k');
    await page.waitForSelector('.qo-input', { timeout: 3_000 });
    await page.fill('.qo-input', '캘린더 열기');
    await page.click('.qo-item:has-text("캘린더 열기")');
    await page.waitForSelector('.cal', { timeout: 5_000 });
  } finally {
    await cleanup();
  }
});
