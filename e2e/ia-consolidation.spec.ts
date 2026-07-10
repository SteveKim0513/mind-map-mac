import { test, expect } from '@playwright/test';
import { launchApp, createNoteFromMenu } from './helpers';

// Regression coverage for docs/product/IA-STRATEGY-2026-07.md §5-1/§5-5/§5-6:
// command palette node search + "search everywhere" escape hatches, context
// menu group labels on the multi-select menu, and the split-view growth nudge.

test('⌘K가 활성 맵의 노드도 검색하고, 전체 검색으로 넘어갈 수 있다', async () => {
  const { page, cleanup } = await launchApp();
  try {
    await page.click('.sb-section-btn[title="새 마인드맵"]');
    await page.waitForSelector('.canvas', { timeout: 5_000 });

    // 노드 하나를 만든다 (Enter → 편집모드 → 텍스트 → Enter로 커밋).
    await page.click('.canvas');
    await page.keyboard.press('Enter');
    await page.waitForSelector('.editing-text', { timeout: 3_000 });
    await page.keyboard.type('회의 준비사항');
    await page.keyboard.press('Enter');
    await expect(page.locator('.node', { hasText: '회의 준비사항' })).toBeVisible();

    // ⌘K로 그 노드를 검색 — "노드" 그룹으로 뜨고, 선택하면 캔버스에서 선택된다.
    await page.keyboard.press('Meta+k');
    await page.waitForSelector('.qo-input', { timeout: 3_000 });
    await page.fill('.qo-input', '회의');
    await expect(page.locator('.qo-group', { hasText: '노드' })).toBeVisible();
    await page.click('.qo-item:has-text("회의 준비사항")');
    await expect(page.locator('.node.selected', { hasText: '회의 준비사항' })).toBeVisible();

    // "전체에서 찾기" 힌트 — 팔레트를 닫고 전체 검색을 쿼리 그대로 이어서 연다.
    await page.keyboard.press('Meta+k');
    await page.waitForSelector('.qo-input', { timeout: 3_000 });
    await page.fill('.qo-input', '회의');
    const more = page.locator('.qo-more');
    await expect(more).toBeVisible();
    await more.click();
    await expect(page.locator('.qo.gs .qo-input')).toHaveValue('회의');
    await page.keyboard.press('Escape');

    // ⌘P(파일명 검색)도 콘텐츠로 못 찾으면 전체 검색으로 넘어가는 탈출구가 있다.
    await page.keyboard.press('Meta+p');
    await page.waitForSelector('.qo-input', { timeout: 3_000 });
    await page.fill('.qo-input', '존재하지않는파일이름');
    await expect(page.locator('.qo-empty-more')).toBeVisible();
    await page.click('.qo-empty-more');
    await expect(page.locator('.qo.gs')).toBeVisible();
    await page.keyboard.press('Escape');

    // 두 번째 노드를 만들고(Tab → 자식), 다중 선택 컨텍스트 메뉴에 그룹 레이블이 있는지 확인.
    await page.locator('.node', { hasText: '회의 준비사항' }).click();
    await page.keyboard.press('Tab');
    await page.waitForSelector('.editing-text', { timeout: 3_000 });
    await page.keyboard.type('세부 항목');
    await page.keyboard.press('Enter');

    const node1 = page.locator('.node', { hasText: '회의 준비사항' });
    const node2 = page.locator('.node', { hasText: '세부 항목' });
    await node1.click();
    await node2.click({ modifiers: ['Shift'] });
    await expect(page.locator('.node.selected')).toHaveCount(2);
    await node2.click({ button: 'right' });
    await expect(page.locator('.ctx-group-label', { hasText: '구조' })).toBeVisible();
    await expect(page.locator('.ctx-group-label', { hasText: '속성' })).toBeVisible();
  } finally {
    await cleanup();
  }
});

test('탭이 5개 이상 열리면 화면 분할을 1회 제안한다', async () => {
  const { page, cleanup } = await launchApp();
  try {
    for (let i = 0; i < 5; i++) {
      await createNoteFromMenu(page);
    }
    await expect(page.locator('.tab')).toHaveCount(5);

    const toast = page.locator('.toast--action', { hasText: '화면을 나눠서' });
    await expect(toast).toBeVisible({ timeout: 3_000 });
    await page.click('.toast-action');
    await expect(page.locator('.tabbar.split')).toBeVisible({ timeout: 3_000 });
  } finally {
    await cleanup();
  }
});
