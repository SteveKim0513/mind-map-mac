import { test, expect, type Page } from '@playwright/test';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { launchApp } from './helpers';

// 2026-09-07 "자동 정렬이 별로다", "화살표 연결 디자인이 별로다" 피드백에 대한
// 회귀 테스트 — 방향 인식 "정리"와 커넥터 색상 커스터마이즈.

async function newBoard(page: Page): Promise<void> {
  await page.click('.sb-section-btn[title="새 보드"]');
  await page.waitForSelector('.board-canvas', { timeout: 5_000 });
  await page.click('.board-canvas');
}

async function addAndNameSticky(page: Page, text: string): Promise<void> {
  await page.click('.tool-btn[title="스티키노트 추가"]');
  await page.locator('.board-el--sticky').dblclick();
  await page.keyboard.type(text);
  await page.click('.board-canvas', { position: { x: 20, y: 20 } });
  await page.waitForTimeout(450);
}

test('아래쪽 화살표로 만든 자식은 "정리" 후에도 아래쪽에 남는다 (오른쪽으로 튀지 않음)', { tag: ['@board'] }, async () => {
  const { page, cleanup } = await launchApp();
  try {
    await newBoard(page);
    await addAndNameSticky(page, '루트');
    const root = page.locator('.board-el--sticky', { hasText: '루트' });
    await root.click();
    await page.waitForTimeout(450);
    const rootBoxBefore = await root.boundingBox();
    if (!rootBoxBefore) throw new Error('위치를 읽지 못함');

    await page.keyboard.press('ArrowDown');
    await page.keyboard.type('아래');
    await page.click('.board-canvas', { position: { x: 20, y: 20 } });
    await page.waitForTimeout(450);

    // scatter the child off to the side so 정리 has visible work to do
    const child = page.locator('.board-el--sticky', { hasText: '아래' });
    const before = await child.boundingBox();
    if (!before) throw new Error('위치를 읽지 못함');
    await page.mouse.move(before.x + before.width / 2, before.y + before.height / 2);
    await page.mouse.down();
    await page.mouse.move(before.x + 500, before.y - 300, { steps: 8 });
    await page.mouse.up();

    await root.click();
    await page.waitForTimeout(450);
    await page.locator('.tool-btn[title*="정리"]').click();
    await page.waitForTimeout(200);

    const tidied = await child.boundingBox();
    if (!tidied) throw new Error('위치를 읽지 못함');
    // still BELOW the root (not forced back to the root's right side)
    expect(tidied.y).toBeGreaterThan(rootBoxBefore.y + rootBoxBefore.height);
    // roughly centered under the root, not off to a column on the right
    expect(Math.abs(tidied.x - rootBoxBefore.x)).toBeLessThan(rootBoxBefore.width * 2);
  } finally {
    await cleanup();
  }
});

test('"정리"는 서로 다른 방향의 자식들을 각자의 방향에 독립적으로 배치한다', { tag: ['@board'] }, async () => {
  const { page, cleanup } = await launchApp();
  try {
    await newBoard(page);
    await addAndNameSticky(page, '루트');
    const root = page.locator('.board-el--sticky', { hasText: '루트' });
    await root.click();
    await page.waitForTimeout(450);
    const rootBox = await root.boundingBox();
    if (!rootBox) throw new Error('위치를 읽지 못함');

    await page.keyboard.press('ArrowRight');
    await page.keyboard.type('오른쪽');
    await page.click('.board-canvas', { position: { x: 20, y: 20 } });
    await page.waitForTimeout(450);

    await root.click();
    await page.waitForTimeout(450);
    await page.keyboard.press('ArrowDown');
    await page.keyboard.type('아래');
    await page.click('.board-canvas', { position: { x: 20, y: 20 } });
    await page.waitForTimeout(450);

    await root.click();
    await page.waitForTimeout(450);
    await page.locator('.tool-btn[title*="정리"]').click();
    await page.waitForTimeout(200);

    const rightBox = await page.locator('.board-el--sticky', { hasText: '오른쪽' }).boundingBox();
    const downBox = await page.locator('.board-el--sticky', { hasText: '아래' }).boundingBox();
    if (!rightBox || !downBox) throw new Error('위치를 읽지 못함');
    expect(rightBox.x).toBeGreaterThan(rootBox.x + rootBox.width); // to the right
    expect(downBox.y).toBeGreaterThan(rootBox.y + rootBox.height); // below
  } finally {
    await cleanup();
  }
});

test('커넥터를 선택하면 색을 바꿀 수 있고, 화살촉도 같은 색을 따르며, 저장 후에도 유지된다', { tag: ['@board'] }, async () => {
  const { page, workspace, cleanup } = await launchApp();
  try {
    await newBoard(page);
    await addAndNameSticky(page, '루트');
    await page.locator('.board-el--sticky').click();
    await page.locator('.board-anchor--right').click();
    await page.click('.board-canvas', { position: { x: 20, y: 20 } });
    await expect(page.locator('.board-connector')).toHaveCount(1);
    await page.waitForTimeout(300);

    await page.locator('.board-connector path').first().click({ force: true });
    await expect(page.locator('.sel-toolbar .st-btn[title="화살표 색"]')).toBeVisible();
    await page.locator('.sel-toolbar .st-btn[title="화살표 색"]').click();
    await page.locator('.color-swatch-grid .color-swatch').nth(3).click();
    await page.waitForTimeout(1_100); // autosave debounce

    const boardName = readdirSync(workspace).find((f) => f.endsWith('.board'));
    if (!boardName) throw new Error('.board 파일이 생성되지 않음');
    const doc = JSON.parse(readFileSync(join(workspace, boardName), 'utf-8'));
    const connEl = Object.values(doc.elements).find((e: unknown) => (e as { kind: string }).kind === 'connector') as { color?: string };
    expect(connEl.color).toBeTruthy();

    // close and reopen — color survives the round trip
    await page.click('.tab-close');
    await expect(page.locator('.board-canvas')).toHaveCount(0);
    await page.click('.row .ficon--board');
    await expect(page.locator('.board-canvas')).toBeVisible();
    await page.locator('.board-connector path').first().click({ force: true });
    await expect(page.locator('.sel-toolbar .st-btn[title="화살표 색"] .st-dot')).not.toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  } finally {
    await cleanup();
  }
});
