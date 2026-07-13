import { test, expect } from '@playwright/test';
import { launchApp, createNoteFromMenu } from './helpers';

// Regression coverage for docs/product/REDESIGN-VISION-2026-07.md §3-3 /
// docs/exec-plans/active/2026-07-10-smart-views.md — 최근 수정 / 즐겨찾기.

test('사이드바에 최근 수정·즐겨찾기 스마트 뷰 행이 있고 빈 상태를 보여준다', async () => {
  const { page, cleanup } = await launchApp();
  try {
    await expect(page.locator('.sb-nav-item:has-text("최근 수정")')).toBeVisible();
    await expect(page.locator('.sb-nav-item:has-text("즐겨찾기")')).toBeVisible();

    await page.click('.sb-nav-item:has-text("최근 수정")');
    await expect(page.locator('.wh-title:has-text("최근 수정")')).toBeVisible();
    await expect(page.locator('.today-empty')).toContainText('수정한 파일');
    await page.keyboard.press('Escape');

    await page.click('.sb-nav-item:has-text("즐겨찾기")');
    await expect(page.locator('.wh-title:has-text("즐겨찾기")')).toBeVisible();
    await expect(page.locator('.today-empty')).toContainText('즐겨찾기가 없어요');
  } finally {
    await cleanup();
  }
});

test('파일을 만들면 최근 수정에 나타나고, 열어서 클릭하면 이동한다', async () => {
  const { page, cleanup } = await launchApp();
  try {
    await createNoteFromMenu(page);
    await page.click('.sb-nav-item:has-text("최근 수정")');
    await expect(page.locator('.trash-row')).toHaveCount(1);
    await page.click('.trash-row .trash-act:has-text("열기")');
    // 클릭하면 패널이 닫히고 해당 노트 탭이 활성화된다.
    await expect(page.locator('.wh-title:has-text("최근 수정")')).toHaveCount(0);
    await expect(page.locator('.note-pane')).toBeVisible();
  } finally {
    await cleanup();
  }
});

test('사이드바 행의 별표로 즐겨찾기를 추가·해제할 수 있고 목록에 반영된다', async () => {
  const { page, cleanup } = await launchApp();
  try {
    await createNoteFromMenu(page);
    const row = page.locator('.row').first();
    await row.hover();
    await row.locator('.row-act[title="즐겨찾기 추가"]').click();

    await page.click('.sb-nav-item:has-text("즐겨찾기")');
    await expect(page.locator('.trash-row')).toHaveCount(1);

    // 즐겨찾기 뷰에서 해제
    await page.click('.trash-row .trash-act[title="즐겨찾기 해제"]');
    await expect(page.locator('.today-empty')).toContainText('즐겨찾기가 없어요');
  } finally {
    await cleanup();
  }
});
