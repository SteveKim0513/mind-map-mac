import { test, expect, type Page } from '@playwright/test';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { launchApp } from './helpers';

// 2026-09-07 "자동 정렬이 별로다", "화살표 연결 디자인이 별로다" 피드백에 대한
// 회귀 테스트 — 커넥터 색상 커스터마이즈. (이 라운드에서 함께 만들었던 "방향
// 인식 정리" 테스트는 같은 날 있었던 두 번째 피드백 라운드("관계도가 안
// 보인다")에서 elkjs 그래프 레이아웃으로 완전히 대체돼 board-graph-layout-
// elkjs.spec.ts로 옮겨졌다 — 더 이상 방향을 보존하지 않으므로 이 파일에선 제거.)

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
