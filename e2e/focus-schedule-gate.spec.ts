import { test, expect } from '@playwright/test';
import { launchApp } from './helpers';

// 결정 0011 §3: 집중 세션은 일정이 지정된 노드에서만 시작할 수 있다 — 집중이
// core(일정)에 종속되는 방향이지, core가 집중에 종속되는 게 아니다(G3와 양립).
// 세 진입점 모두 이 게이트를 지켜야 한다: 선택 툴바(버튼 자체가 없음), 우클릭
// 메뉴(비활성 + 안내), SchedulePopover(스케줄 노드에서 지금 집중 시작 제공).

// 결정 0014: 완료·일정·집중은 할 일(todo) 노드 전용. 일반 노드는 실행 UI가 아예 없고
// "할 일로 전환"만. 집중의 일정 게이트(0011 §3)는 할 일 노드 안에서 적용된다.
test('일반 노드엔 집중이 아예 없고, 일정 없는 할 일 노드는 집중이 비활성으로 안내된다', async () => {
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

    // 일반 노드: 툴바·메뉴에 집중 없음, 메뉴엔 "할 일로 전환"만
    await node.click();
    await page.waitForSelector('.sel-toolbar', { timeout: 3_000 });
    await expect(page.locator('.st-btn[title="집중 시작"]')).toHaveCount(0);
    await node.click({ button: 'right' });
    await page.waitForSelector('.ctx-menu', { timeout: 3_000 });
    await expect(page.locator('.ctx-item', { hasText: '집중 시작' })).toHaveCount(0);
    await expect(page.locator('.ctx-item', { hasText: '할 일로 전환' })).toBeVisible();
    await page.keyboard.press('Escape');

    // 할 일로 전환(⌘Enter) → 아직 일정 없으니 집중은 비활성으로 안내
    await node.click();
    await page.keyboard.press('Meta+Enter');
    await expect(node.locator('.node-check')).toBeVisible();
    await expect(page.locator('.st-btn[title="집중 시작"]')).toHaveCount(0); // 일정 있어야 집중 버튼
    await node.click({ button: 'right' });
    await page.waitForSelector('.ctx-menu', { timeout: 3_000 });
    const focusItem = page.locator('.ctx-item', { hasText: '집중 시작' });
    await expect(focusItem).toBeVisible();
    await expect(focusItem).toBeDisabled();
    await expect(focusItem).toHaveAttribute('title', '일정 설정 후 이용 가능');
  } finally {
    await cleanup();
  }
});

test('일정을 지정하면 선택 툴바·우클릭 메뉴에 집중 버튼이 활성화된다', async () => {
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

    await node.click({ button: 'right' });
    await page.waitForSelector('.ctx-menu', { timeout: 3_000 });
    const focusItem = page.locator('.ctx-item', { hasText: '집중 시작' });
    await expect(focusItem).toBeEnabled();
  } finally {
    await cleanup();
  }
});

test('SchedulePopover에서 "지금 집중 시작"을 누르면 집중 시작 프롬프트가 뜬다', async () => {
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
