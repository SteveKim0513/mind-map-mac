import { test, expect } from '@playwright/test';
import { launchApp } from './helpers';

// UX-CLARITY-VISION 전략 D: 커맨드 팔레트가 지금까지는 노드를 "찾아서 선택"만
// 시켜줬을 뿐 실행은 못 시켰다 — 일정·색상·링크·노트연결·집중 세션 같은 노드
// 동작은 작은 아이콘을 우연히 발견하는 것 외엔 접근 경로가 없었다. 선택된
// 노드가 있으면 이 동작들이 팔레트 명령으로도 뜨고 실행되는지 확인한다.

test('선택된 노드가 있으면 커맨드 팔레트에서 정리(색상)·실행(일정) 동작을 실행할 수 있다', { tag: ['@command', '@schedule'] }, async () => {
  const { page, cleanup } = await launchApp();
  try {
    await page.click('.sb-section-btn[title="새 마인드맵"]');
    await page.waitForSelector('.canvas', { timeout: 5_000 });

    await page.click('.canvas');
    await page.keyboard.press('Enter');
    await page.waitForSelector('.editing-text', { timeout: 3_000 });
    await page.keyboard.type('팔레트 동작 테스트');
    await page.keyboard.press('Enter');
    const node = page.locator('.node', { hasText: '팔레트 동작 테스트' });
    await expect(node).toBeVisible();

    // 색상은 정리 동작이라 노드 종류와 무관 — 일반 노드에서 바로 실행된다.
    await page.keyboard.press('Meta+k');
    await page.waitForSelector('.qo-input', { timeout: 3_000 });
    await page.fill('.qo-input', '색상 — 보라');
    await page.click('.qo-item:has-text("선택 노드: 색상 — 보라")');
    await expect(node).toHaveClass(/tinted/);

    // 일정 설정은 실행이라 할 일(todo) 노드에서만 — 먼저 할 일로 전환한다(결정 0014).
    await node.click();
    await page.keyboard.press('Meta+Enter');
    await expect(node.locator('.node-check')).toBeVisible();

    // ⌘K → "선택 노드: 일정 설정" 실행 → SchedulePopover가 이 노드를 대상으로 열림.
    await page.keyboard.press('Meta+k');
    await page.waitForSelector('.qo-input', { timeout: 3_000 });
    await page.fill('.qo-input', '일정 설정');
    await page.click('.qo-item:has-text("선택 노드: 일정 설정")');
    await expect(page.locator('.sched-pop')).toBeVisible({ timeout: 3_000 });
    // Close via the × button (Escape also clears selection — useKeyboard.ts).
    await page.click('.sched-x');
    await expect(page.locator('.sched-pop')).toHaveCount(0);
  } finally {
    await cleanup();
  }
});

test('선택된 노드가 없으면 노드 동작 명령이 팔레트에 나타나지 않는다', { tag: ['@command', '@schedule'] }, async () => {
  const { page, cleanup } = await launchApp();
  try {
    // 홈 화면(활성 맵 없음) 상태에서 바로 팔레트를 연다.
    await page.keyboard.press('Meta+k');
    await page.waitForSelector('.qo-input', { timeout: 3_000 });
    await page.fill('.qo-input', '선택 노드');
    await expect(page.locator('.qo-item')).toHaveCount(0);
  } finally {
    await cleanup();
  }
});
