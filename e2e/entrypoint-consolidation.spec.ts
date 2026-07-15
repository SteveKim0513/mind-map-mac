import { test, expect } from '@playwright/test';
import { launchApp } from './helpers';

// UX-CLARITY-VISION 전략 C: 일정·링크·노드에 노트 연결은 예전엔 게이지 칩(값이
// 있을 때만) / 선택 툴바 아이콘 / 우클릭 메뉴 텍스트, 이렇게 3곳에서 서로 다른
// 모습으로 접근할 수 있었다. 이제 선택 툴바에서는 이 3개를 빼고, 게이지 칩(값이
// 있을 때) + 우클릭 메뉴(항상) 두 곳으로만 접근한다.

test('선택 툴바에는 일정·링크·노트연결 아이콘이 없고, 우클릭 메뉴에는 그대로 있다', async () => {
  const { page, cleanup } = await launchApp();
  try {
    await page.click('.sb-section-btn[title="새 마인드맵"]');
    await page.waitForSelector('.canvas', { timeout: 5_000 });

    await page.click('.canvas');
    await page.keyboard.press('Enter');
    await page.waitForSelector('.editing-text', { timeout: 3_000 });
    await page.keyboard.type('진입점 정리 테스트');
    await page.keyboard.press('Enter');
    const node = page.locator('.node', { hasText: '진입점 정리 테스트' });
    await expect(node).toBeVisible();

    // 선택 툴바: 색상·완료·메모·집중·자식추가·삭제만 남아야 한다.
    await expect(page.locator('.sel-toolbar')).toBeVisible();
    await expect(page.locator('.st-btn[title="일정"]')).toHaveCount(0);
    await expect(page.locator('.st-btn[title="링크"]')).toHaveCount(0);
    await expect(page.locator('.st-btn[title="노드에 노트 연결"]')).toHaveCount(0);
    await expect(page.locator('.st-btn[title="색상"]')).toBeVisible();
    await expect(page.locator('.st-btn[title="완료"]')).toBeVisible();
    await expect(page.locator('.st-btn[title="메모"]')).toBeVisible();

    // 우클릭 메뉴: 셋 다 여전히 텍스트로 존재해야 한다(백업 진입점).
    await node.click({ button: 'right' });
    await page.waitForSelector('.ctx-menu', { timeout: 3_000 });
    await expect(page.locator('.ctx-item:has-text("링크 추가")')).toBeVisible();
    await expect(page.locator('.ctx-item:has-text("노드에 노트 연결")')).toBeVisible();
    await expect(page.locator('.ctx-item:has-text("스케줄 노드로 지정")')).toBeVisible();
  } finally {
    await cleanup();
  }
});

test('일정 칩(게이지 칩)은 값이 있을 때 계속 정상 동작한다(회귀 방지)', async () => {
  const { page, cleanup } = await launchApp();
  try {
    await page.click('.sb-section-btn[title="새 마인드맵"]');
    await page.waitForSelector('.canvas', { timeout: 5_000 });
    await page.click('.canvas');
    await page.keyboard.press('Enter');
    await page.waitForSelector('.editing-text', { timeout: 3_000 });
    await page.keyboard.type('@내일 오후 3시 회의');
    await page.keyboard.press('Enter');

    const node = page.locator('.node', { hasText: '@내일 오후 3시 회의' });
    await expect(node).toHaveClass(/scheduled/);
    await expect(node.locator('.gchip.sched')).toBeVisible();
    await node.locator('.gchip.sched').click();
    await expect(page.locator('.sched-pop')).toBeVisible({ timeout: 3_000 });
  } finally {
    await cleanup();
  }
});
