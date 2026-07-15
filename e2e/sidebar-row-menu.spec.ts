import { test, expect } from '@playwright/test';
import { launchApp, createNoteFromMenu, getSidebarLabels } from './helpers';

// UX-CLARITY-VISION 전략 A: 캔버스 노드와 탭은 우클릭하면 보조 메뉴가 뜨는데,
// 사이드바 파일/폴더 행만 우클릭에 아무 반응이 없었다 — 호버해야 나오는 아이콘
// (즐겨찾기·이름 변경·삭제)뿐이었다. 이제 사이드바 행도 우클릭 메뉴를 갖는다.

test('사이드바 파일 행 우클릭 — 메뉴가 뜨고, "삭제"를 누르면 정말 삭제된다', async () => {
  const { page, cleanup } = await launchApp();
  try {
    await createNoteFromMenu(page);
    await page.waitForSelector('.row', { timeout: 5_000 });
    expect(await getSidebarLabels(page)).toHaveLength(1);

    await page.click('.row', { button: 'right' });
    await expect(page.locator('.ctx-menu')).toBeVisible({ timeout: 3_000 });
    await expect(page.locator('.ctx-menu .ctx-item:has-text("즐겨찾기 추가")')).toBeVisible();
    await expect(page.locator('.ctx-menu .ctx-item:has-text("이름 변경")')).toBeVisible();

    // Escape로 닫힌다 (다른 모든 보조 메뉴와 동일한 기대).
    await page.keyboard.press('Escape');
    await expect(page.locator('.ctx-menu')).toHaveCount(0);

    // 다시 열어서 삭제까지 실제로 동작하는지 확인.
    await page.click('.row', { button: 'right' });
    await page.waitForSelector('.ctx-menu', { timeout: 3_000 });
    await page.click('.ctx-menu .ctx-item:has-text("삭제")');
    await page.waitForTimeout(500);
    expect(await getSidebarLabels(page)).toHaveLength(0);
  } finally {
    await cleanup();
  }
});

test('사이드바 행 우클릭 메뉴에서 즐겨찾기 토글이 실제로 반영된다', async () => {
  const { page, cleanup } = await launchApp();
  try {
    await createNoteFromMenu(page);
    await page.waitForSelector('.row', { timeout: 5_000 });

    await page.click('.row', { button: 'right' });
    await page.waitForSelector('.ctx-menu', { timeout: 3_000 });
    await page.click('.ctx-menu .ctx-item:has-text("즐겨찾기 추가")');

    // row-actions are hover-revealed (opacity), so hover the row first —
    // the state change itself (class + title) is what we're verifying here.
    await page.hover('.row');
    await expect(page.locator('.row-act.on')).toBeVisible({ timeout: 3_000 });

    await page.click('.row', { button: 'right' });
    await page.waitForSelector('.ctx-menu', { timeout: 3_000 });
    await expect(page.locator('.ctx-menu .ctx-item:has-text("즐겨찾기 해제")')).toBeVisible();
  } finally {
    await cleanup();
  }
});
