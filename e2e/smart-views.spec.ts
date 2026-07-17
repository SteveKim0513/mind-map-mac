import { test, expect } from '@playwright/test';
import { launchApp, createNoteFromMenu } from './helpers';

// Regression coverage for docs/product/REDESIGN-VISION-2026-07.md §3-3 /
// docs/exec-plans/active/2026-07-10-smart-views.md — 최근 수정 / 즐겨찾기.
// 최근 수정은 결정 0011 §4-4에 따라 사이드바 상단 nav에서 설정(⌘,) 내부로
// 옮겨졌다 — 즐겨찾기만 1차 내비게이션에 남는다.

test('설정에 최근 수정 진입점이 있고 클릭하면 빈 상태를 보여준다', { tag: ['@view', '@nav'] }, async () => {
  const { page, cleanup } = await launchApp();
  try {
    await expect(page.locator('.sb-nav-item:has-text("즐겨찾기")')).toBeVisible();
    await expect(page.locator('.sb-nav-item:has-text("최근 수정")')).toHaveCount(0);

    await page.keyboard.press('Meta+,');
    await page.waitForSelector('.settings', { timeout: 3_000 });
    await page.click('.set-advanced-toggle');
    await page.click('.set-link:has-text("최근 수정")');
    // "최근 수정"을 클릭하면 설정 오버레이는 닫히고 최근 수정 오버레이만 남는다
    // (겹친 두 오버레이 중 위의 것이 아래 것의 클릭을 가로채는 문제 방지).
    await expect(page.locator('.settings')).toHaveCount(0);
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

test('파일을 만들면 최근 수정에 나타나고, 열어서 클릭하면 이동한다', { tag: ['@view', '@nav'] }, async () => {
  const { page, cleanup } = await launchApp();
  try {
    await createNoteFromMenu(page);
    await page.keyboard.press('Meta+,');
    await page.waitForSelector('.settings', { timeout: 3_000 });
    await page.click('.set-advanced-toggle');
    await page.click('.set-link:has-text("최근 수정")');
    await expect(page.locator('.trash-row')).toHaveCount(1);
    await page.click('.trash-row .trash-act:has-text("열기")');
    // 클릭하면 패널이 닫히고 해당 노트 탭이 활성화된다.
    await expect(page.locator('.wh-title:has-text("최근 수정")')).toHaveCount(0);
    await expect(page.locator('.note-pane')).toBeVisible();
  } finally {
    await cleanup();
  }
});

test('사이드바 행의 별표로 즐겨찾기를 추가·해제할 수 있고 목록에 반영된다', { tag: ['@view', '@nav'] }, async () => {
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
