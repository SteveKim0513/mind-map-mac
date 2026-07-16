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

    // 선택 툴바: 일정·링크·노트연결 아이콘은 없다(그대로). 색상·메모 있음. 일반 노드의
    // 실행 입구는 "할 일로 전환" 하나(완료·집중은 할 일 노드에서만, 결정 0014).
    await expect(page.locator('.sel-toolbar')).toBeVisible();
    await expect(page.locator('.st-btn[title="일정"]')).toHaveCount(0);
    await expect(page.locator('.st-btn[title="링크"]')).toHaveCount(0);
    await expect(page.locator('.st-btn[title="노드에 노트 연결"]')).toHaveCount(0);
    await expect(page.locator('.st-btn[title="색상"]')).toBeVisible();
    await expect(page.locator('.st-btn[title="메모"]')).toBeVisible();
    await expect(page.locator('.st-btn[title="할 일로 전환"]')).toBeVisible();
    await expect(page.locator('.st-btn[title="완료"]')).toHaveCount(0);

    // 우클릭 메뉴: 링크·노트연결은 항상 텍스트로 존재(백업 진입점). 일정은 할 일 노드에서만이라
    // 일반 노드 메뉴엔 "할 일로 전환"이 있고, 전환하면 "일정 지정"이 생긴다.
    await node.click({ button: 'right' });
    await page.waitForSelector('.ctx-menu', { timeout: 3_000 });
    await expect(page.locator('.ctx-item:has-text("링크 추가")')).toBeVisible();
    await expect(page.locator('.ctx-item:has-text("노드에 노트 연결")')).toBeVisible();
    await expect(page.locator('.ctx-item:has-text("할 일로 전환")')).toBeVisible();
    await page.keyboard.press('Escape');

    await node.click();
    await page.keyboard.press('Meta+Enter'); // 할 일로 전환
    await node.click({ button: 'right' });
    await page.waitForSelector('.ctx-menu', { timeout: 3_000 });
    await expect(page.locator('.ctx-item:has-text("일정 지정")')).toBeVisible();
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
