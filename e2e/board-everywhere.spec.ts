import { test, expect } from '@playwright/test';
import { launchApp } from './helpers';

// Board is a third, equal file type alongside map/note — these tests cover the
// places that used to only know about the other two (2026-09-03 audit: "홈
// 화면도 보드가 있다는 것을 반영해야지 ... 전체적으로 보드 기능이 추가된 점을
// 모든 곳에 반영해줘"). board-basics.spec.ts covers the board canvas itself.

test('빈 워크스페이스의 홈 화면에 "새 보드" 버튼이 있고, 누르면 보드가 만들어져 열린다', { tag: ['@board', '@nav'] }, async () => {
  const { page, cleanup } = await launchApp();
  try {
    await expect(page.locator('.home')).toBeVisible();
    await expect(page.locator('.home-new--board')).toBeVisible();
    await page.click('.home-new--board');
    await expect(page.locator('.board-canvas')).toBeVisible();
    await expect(page.locator('.row .ficon--board')).toHaveCount(1);
  } finally {
    await cleanup();
  }
});

test('⌘K 명령 팔레트에 "새 보드" 명령이 있고 실행하면 보드가 열린다', { tag: ['@board', '@command'] }, async () => {
  const { page, cleanup } = await launchApp();
  try {
    await page.keyboard.press('Meta+k');
    await page.waitForSelector('.qo', { timeout: 3_000 });
    const item = page.locator('.qo-item', { hasText: '새 보드' });
    await expect(item).toBeVisible();
    await item.click();
    await expect(page.locator('.board-canvas')).toBeVisible();
  } finally {
    await cleanup();
  }
});

test('보드가 Quick Open · 즐겨찾기에서 ".board" 확장자 없이, 마인드맵으로 오분류되지 않고 표시된다', { tag: ['@board', '@nav'] }, async () => {
  const { page, cleanup } = await launchApp();
  try {
    await page.click('.sb-section-btn[title="새 보드"]');
    await page.waitForSelector('.board-canvas', { timeout: 5_000 });
    await page.click('.board-canvas'); // dismiss inline rename

    // Quick Open (⌘P) shows it without the raw ".board" extension
    await page.keyboard.press('Meta+p');
    await page.waitForSelector('.qo', { timeout: 3_000 });
    const qoItem = page.locator('.qo-item', { hasText: '제목 없음' }).first();
    await expect(qoItem).toBeVisible();
    await expect(qoItem.locator('.qo-name-txt')).toHaveText('제목 없음'); // no ".board" suffix leaking through
    await page.keyboard.press('Escape');

    // Favorite it via the sidebar row, then check the Favorites overlay
    await page.locator('.row', { hasText: '제목 없음' }).hover();
    await page.locator('.row-act[title="즐겨찾기 추가"]').click();
    await page.locator('.sb-nav-item', { hasText: '즐겨찾기' }).click();
    const favRow = page.locator('.trash-row', { hasText: '제목 없음' });
    await expect(favRow).toBeVisible();
    await expect(favRow.locator('.trash-name')).toHaveText('제목 없음');
  } finally {
    await cleanup();
  }
});

test('전체 검색(⌘⇧F)이 보드 스티키 텍스트를 찾고, 선택하면 그 보드를 열고 스티키를 선택한다', { tag: ['@board', '@nav'] }, async () => {
  const { page, cleanup } = await launchApp();
  try {
    await page.click('.sb-section-btn[title="새 보드"]');
    await page.waitForSelector('.board-canvas', { timeout: 5_000 });
    await page.click('.board-canvas');
    await page.click('.tool-btn[title="스티키노트 추가"]');
    await page.locator('.board-el--sticky').dblclick();
    await page.keyboard.type('전역검색용스티키');
    await page.click('.board-canvas', { position: { x: 20, y: 20 } });
    await page.waitForTimeout(1_100); // autosave debounce — global search reads from disk

    await page.keyboard.press('Meta+Shift+F');
    await page.waitForSelector('.gs', { timeout: 3_000 });
    await page.fill('.qo-input', '전역검색용스티키');
    const hit = page.locator('.qo-item', { hasText: '전역검색용스티키' }).first();
    await expect(hit).toBeVisible();
    await expect(hit.locator('.gs-ic--board')).toHaveCount(1);
    await hit.click();

    await expect(page.locator('.board-canvas')).toBeVisible();
    await expect(page.locator('.board-el--sticky.selected', { hasText: '전역검색용스티키' })).toHaveCount(1);
  } finally {
    await cleanup();
  }
});
