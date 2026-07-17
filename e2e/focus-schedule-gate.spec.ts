import { test, expect } from '@playwright/test';
import { launchApp } from './helpers';

// 결정 0014 + 0015: 완료 · 일정 지정 · 집중은 할 일(todo) 노드 전용이고, 세 기능은
// 서로 독립이다. 집중은 더 이상 일정을 요구하지 않는다 — 0015가 0011 §3의 "집중은
// scheduled만" 게이트를 해제했다. 일반 노드는 실행 UI가 아예 없고 "할 일로 전환"만.

test('일반 노드엔 실행 UI가 없고, 할 일로 전환하면 일정·집중이 (일정 없이도) 바로 나온다', { tag: ['@focus', '@schedule'] }, async () => {
  const { page, cleanup } = await launchApp();
  try {
    await page.click('.sb-section-btn[title="새 마인드맵"]');
    await page.waitForSelector('.canvas', { timeout: 5_000 });
    await page.click('.canvas');
    await page.keyboard.press('Enter');
    await page.waitForSelector('.editing-text', { timeout: 3_000 });
    await page.keyboard.type('일정 없는 노드');
    await page.keyboard.press('Enter');
    const node = page.locator('.node', { hasText: '일정 없는 노드' });
    await expect(node).toBeVisible();

    // 일반 노드: 툴바에 집중·일정 지정 없음, 메뉴엔 "할 일로 전환"만
    await node.click();
    await page.waitForSelector('.sel-toolbar', { timeout: 3_000 });
    await expect(page.locator('.st-btn[title="집중 시작"]')).toHaveCount(0);
    await expect(page.locator('.st-btn[title="일정 지정"]')).toHaveCount(0);
    await node.click({ button: 'right' });
    await page.waitForSelector('.ctx-menu', { timeout: 3_000 });
    await expect(page.locator('.ctx-item', { hasText: '집중 시작' })).toHaveCount(0);
    await expect(page.locator('.ctx-item', { hasText: '할 일로 전환' })).toBeVisible();
    await page.keyboard.press('Escape');

    // 할 일로 전환(⌘Enter) → 일정이 없어도 일정 지정·집중이 바로 나온다 (게이트 해제)
    await node.click();
    await page.keyboard.press('Meta+Enter');
    await expect(node.locator('.node-check')).toBeVisible();
    await expect(page.locator('.st-btn[title="집중 시작"]')).toBeVisible();
    await expect(page.locator('.st-btn[title="일정 지정"]')).toBeVisible();
    await node.click({ button: 'right' });
    await page.waitForSelector('.ctx-menu', { timeout: 3_000 });
    const focusItem = page.locator('.ctx-item', { hasText: '집중 시작' });
    await expect(focusItem).toBeVisible();
    await expect(focusItem).toBeEnabled(); // 일정 없어도 활성 (게이트 없음)
  } finally {
    await cleanup();
  }
});

test('할 일 노드에서 일정 지정과 집중은 별개로 둘 다 노출된다', { tag: ['@focus', '@schedule'] }, async () => {
  const { page, cleanup } = await launchApp();
  try {
    await page.click('.sb-section-btn[title="새 마인드맵"]');
    await page.waitForSelector('.canvas', { timeout: 5_000 });
    await page.click('.canvas');
    await page.keyboard.press('Enter');
    await page.waitForSelector('.editing-text', { timeout: 3_000 });
    await page.keyboard.type('@오늘 스케줄 노드');
    await page.keyboard.press('Enter');
    const node = page.locator('.node', { hasText: '스케줄 노드' });
    await expect(node).toHaveClass(/scheduled/);

    await node.click();
    await page.waitForSelector('.sel-toolbar', { timeout: 3_000 });
    await expect(page.locator('.st-btn[title="집중 시작"]')).toBeVisible();
    await expect(page.locator('.st-btn[title="일정 지정"]')).toBeVisible();
  } finally {
    await cleanup();
  }
});

test('SchedulePopover에서 "지금 집중 시작"을 누르면 집중 시작 프롬프트가 뜬다', { tag: ['@focus', '@schedule'] }, async () => {
  const { page, cleanup } = await launchApp();
  try {
    await page.click('.sb-section-btn[title="새 마인드맵"]');
    await page.waitForSelector('.canvas', { timeout: 5_000 });
    await page.click('.canvas');
    await page.keyboard.press('Enter');
    await page.waitForSelector('.editing-text', { timeout: 3_000 });
    await page.keyboard.type('@오늘 오후 3시 스케줄 노드');
    await page.keyboard.press('Enter');

    const node = page.locator('.node', { hasText: '스케줄 노드' });
    await node.locator('.gchip.sched').click();
    await page.waitForSelector('.sched-pop', { timeout: 3_000 });

    await expect(page.locator('.sched-focus')).toBeVisible();
    await page.click('.sched-focus');
    await page.waitForSelector('.focus-start', { timeout: 3_000 });
  } finally {
    await cleanup();
  }
});
