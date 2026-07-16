import { test, expect } from '@playwright/test';
import { launchApp } from './helpers';

// docs/product/specs/2026-07-16-todo-node.md / 결정 0014 — 생각(일반 노드)과 실행(할 일 노드)을
// 가른다. 완료·일정·집중은 할 일 노드에서만. 일반 노드 메뉴는 "할 일로 전환"만.

async function newMapWithNode(page: import('@playwright/test').Page, text: string) {
  await page.click('.sb-section-btn[title="새 마인드맵"]');
  await page.waitForSelector('.canvas', { timeout: 5_000 });
  await page.click('.canvas');
  await page.keyboard.press('Enter');
  await page.waitForSelector('.editing-text', { timeout: 3_000 });
  await page.keyboard.type(text);
  await page.keyboard.press('Enter');
}

test('일반 노드 메뉴엔 "할 일로 전환"만, 전환하면 완료·일정·집중이 나온다', async () => {
  const { page, cleanup } = await launchApp();
  try {
    await newMapWithNode(page, '브레인스토밍 생각');
    const node = page.locator('.node', { hasText: '브레인스토밍 생각' });

    // 일반 노드: 실행 기능 없음, "할 일로 전환"만
    await node.click({ button: 'right' });
    await page.waitForSelector('.ctx-menu', { timeout: 3_000 });
    await expect(page.locator('.ctx-item', { hasText: '할 일로 전환' })).toBeVisible();
    await expect(page.locator('.ctx-item', { hasText: '완료 표시' })).toHaveCount(0);
    await expect(page.locator('.ctx-item', { hasText: '집중 시작' })).toHaveCount(0);
    await expect(node.locator('.node-check')).toHaveCount(0); // 체크박스 없음

    // 할 일로 전환 → 체크박스 등장 + 실행 메뉴 노출
    await page.click('.ctx-item:has-text("할 일로 전환")');
    await expect(node.locator('.node-check')).toBeVisible();

    await node.click({ button: 'right' });
    await page.waitForSelector('.ctx-menu', { timeout: 3_000 });
    await expect(page.locator('.ctx-item', { hasText: '완료 표시' })).toBeVisible();
    await expect(page.locator('.ctx-item', { hasText: '집중 시작' })).toBeVisible();
    await expect(page.locator('.ctx-item', { hasText: '일반 노드로 되돌리기' })).toBeVisible();
    await page.keyboard.press('Escape');
  } finally {
    await cleanup();
  }
});

test('일정을 자연어로 잡으면 자동으로 할 일 노드가 된다', async () => {
  const { page, cleanup } = await launchApp();
  try {
    await newMapWithNode(page, '@내일 오후 3시 회의 준비');
    const node = page.locator('.node', { hasText: '회의 준비' });
    await expect(node).toHaveClass(/todo/);
    await expect(node).toHaveClass(/scheduled/);
    await expect(node.locator('.node-check')).toBeVisible();
  } finally {
    await cleanup();
  }
});

test('다중 선택에 일반 노드가 섞이면 "완료"가 안 보이고, 전원 할 일이면 보인다', async () => {
  const { page, cleanup } = await launchApp();
  try {
    await newMapWithNode(page, '루트 생각');
    // Tab으로 자식 추가 → 자식은 일반 노드(상속 안 함)
    await page.keyboard.press('Tab');
    await page.waitForSelector('.editing-text', { timeout: 3_000 });
    await page.keyboard.type('자식 생각');
    await page.keyboard.press('Enter');
    await page.keyboard.press('Escape');

    const root = page.locator('.node', { hasText: '루트 생각' });
    const child = page.locator('.node', { hasText: '자식 생각' });

    // 둘 다 일반 노드 → 다중 선택 메뉴에 "완료" 없음
    await root.click();
    await child.click({ modifiers: ['Shift'] });
    await child.click({ button: 'right' });
    await page.waitForSelector('.ctx-menu:has-text("개 선택됨")', { timeout: 3_000 });
    await expect(page.locator('.ctx-item', { hasText: '완료' })).toHaveCount(0);
    await page.keyboard.press('Escape');

    // 둘 다 할 일로 전환
    await root.click();
    await page.keyboard.press('Meta+Enter');
    await child.click();
    await page.keyboard.press('Meta+Enter');

    // 전원 할 일 → 다중 선택 메뉴에 "완료" 등장
    await root.click();
    await child.click({ modifiers: ['Shift'] });
    await child.click({ button: 'right' });
    await page.waitForSelector('.ctx-menu:has-text("개 선택됨")', { timeout: 3_000 });
    await expect(page.locator('.ctx-item', { hasText: '완료 표시' })).toBeVisible();
    await page.keyboard.press('Escape');
  } finally {
    await cleanup();
  }
});

test('"일반 노드로 되돌리기"는 할 일 상태를 지운다', async () => {
  const { page, cleanup } = await launchApp();
  try {
    await newMapWithNode(page, '되돌릴 할 일');
    const node = page.locator('.node', { hasText: '되돌릴 할 일' });
    await node.click({ button: 'right' });
    await page.click('.ctx-item:has-text("할 일로 전환")');
    await expect(node.locator('.node-check')).toBeVisible();

    await node.click({ button: 'right' });
    await page.click('.ctx-item:has-text("일반 노드로 되돌리기")');
    await expect(node.locator('.node-check')).toHaveCount(0);
    await expect(node).not.toHaveClass(/todo/);

    // 다시 일반 노드 메뉴 — "할 일로 전환"만
    await node.click({ button: 'right' });
    await page.waitForSelector('.ctx-menu', { timeout: 3_000 });
    await expect(page.locator('.ctx-item', { hasText: '할 일로 전환' })).toBeVisible();
    await expect(page.locator('.ctx-item', { hasText: '완료 표시' })).toHaveCount(0);
    await page.keyboard.press('Escape');
  } finally {
    await cleanup();
  }
});
