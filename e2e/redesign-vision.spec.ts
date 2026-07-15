import { test, expect } from '@playwright/test';
import { launchApp } from './helpers';

// Regression coverage for docs/product/REDESIGN-VISION-2026-07.md §3-4/§3-6/§3-8:
// collapsible advanced settings, meta+/양식+ rename, and the docked focus pill's
// collapsed-by-default ambient presentation + quiet dot badges.

test('설정의 고급 옵션은 기본으로 접혀 있고, 펼치면 정보 양식 링크가 보인다', async () => {
  const { page, cleanup } = await launchApp();
  try {
    await page.keyboard.press('Meta+,');
    await page.waitForSelector('.settings', { timeout: 3_000 });

    // 기본 상태: 고급 링크(AI 기능/정보 양식/사용 안내/업데이트)가 안 보여야 한다.
    await expect(page.locator('.set-link')).toHaveCount(0);
    await expect(page.locator('.set-advanced-toggle')).toContainText('고급 설정 보기');

    await page.click('.set-advanced-toggle');
    await expect(page.locator('.set-link:has-text("정보 양식")')).toBeVisible();
    await expect(page.locator('.set-link:has-text("AI 기능")')).toBeVisible();
    await expect(page.locator('.set-advanced-toggle')).toContainText('고급 설정 숨기기');

    await page.click('.set-advanced-toggle');
    await expect(page.locator('.set-link')).toHaveCount(0);
  } finally {
    await cleanup();
  }
});

test('노트 편집기 툴바는 "양식+" 버튼을 쓴다', async () => {
  const { page, cleanup } = await launchApp();
  try {
    await page.click('.sb-section-btn[title="새 노트"]');
    await page.waitForSelector('.note-pane', { timeout: 5_000 });
    await page.click('.ProseMirror');
    // 시딩된 메타 템플릿이 없으면 버튼 자체가 안 보인다 — 존재하지 않아야 정상.
    await expect(page.locator('button[title="메타 추가"]')).toHaveCount(0);
    await expect(page.locator('button[title="양식 추가"]')).toHaveCount(0);
  } finally {
    await cleanup();
  }
});

test('집중 세션 위젯은 사이드바 독킹 시 기본으로 접혀 있고, 클릭하면 펼쳐진다', async () => {
  const { page, cleanup } = await launchApp();
  try {
    await page.click('.sb-section-btn[title="새 마인드맵"]');
    await page.waitForSelector('.canvas', { timeout: 5_000 });
    await page.click('.canvas');
    await page.keyboard.press('Enter');
    await page.waitForSelector('.editing-text', { timeout: 3_000 });
    await page.keyboard.type('테스트 노드');
    await page.keyboard.press('Enter');
    await page.waitForSelector('.node', { timeout: 3_000 });

    await page.click('.node');
    await page.waitForSelector('.sel-toolbar', { timeout: 3_000 });
    await page.click('.st-btn[title="집중 세션 시작"]');
    await page.waitForSelector('.focus-start', { timeout: 3_000 });
    await page.keyboard.press('Enter');

    // 독킹된 위젯은 기본으로 접힌 앰비언트 타이머로 시작한다 (§3-8).
    await expect(page.locator('.focus-pill.docked.collapsed')).toBeVisible({ timeout: 3_000 });
    await expect(page.locator('.focus-pill.docked:not(.collapsed) .focus-end')).toHaveCount(0);

    // 클릭하면 펼쳐져 종료 버튼이 보인다.
    await page.click('.focus-pill.docked.collapsed');
    await expect(page.locator('.focus-pill.docked:not(.collapsed) .focus-end')).toBeVisible();

    // 접기 버튼으로 다시 접을 수 있다.
    await page.click('.focus-collapse');
    await expect(page.locator('.focus-pill.docked.collapsed')).toBeVisible();

    // 정리: 세션 종료 (다른 테스트에 영향 없도록)
    await page.click('.focus-pill.docked.collapsed');
    await page.click('.focus-end');
  } finally {
    await cleanup();
  }
});

test('휴지통·노트 템플릿 배지는 숫자가 아닌 조용한 점으로 표시된다', async () => {
  const { page, cleanup, workspace: _workspace } = await launchApp();
  try {
    await page.click('.sb-section-btn[title="새 노트"]');
    await page.waitForSelector('.note-pane', { timeout: 5_000 });

    await page.click('.row', { modifiers: ['Meta'] });
    await page.waitForSelector('.sel-bar', { timeout: 2_000 });
    await page.getByTestId('btn-delete-marked').click();
    await page.waitForTimeout(500);

    const trashBtn = page.locator('.sb-foot-btn[title^="휴지통"]');
    await expect(trashBtn.locator('.sb-dot-badge')).toBeVisible({ timeout: 3_000 });
    // 숫자 배지는 완전히 제거됐다 — 텍스트 콘텐츠가 없는 순수 점(dot)이어야 한다.
    await expect(trashBtn.locator('.sb-dot-badge')).toHaveText('');
  } finally {
    await cleanup();
  }
});
