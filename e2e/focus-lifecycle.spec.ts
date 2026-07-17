import { test, expect } from '@playwright/test';
import { launchApp } from './helpers';

// 집중 세션 데이터 손실 회귀 방지 (spec 2026-06-12-focus-session §14-I):
// 종료 직전에 작업 로그를 타이핑해도 (1) 본문이 저장되고, (2) 세션이 "진행 중"으로
// 고착되지 않고 종료되며, (3) 집중 기록에 남는다. 예전엔 endFocusSession이 디스크를
// 읽어 되쓰며 자동저장과 경합해 본문·end가 유실됐다 → flushSaves로 해결.
test('집중 종료 직전에 타이핑해도 본문이 저장되고, 세션이 기록에 남는다', { tag: ['@focus', '@todo'] }, async () => {
  const { page, cleanup } = await launchApp();
  try {
    // 일정 있는 할 일 노드를 만들고 집중을 시작한다.
    await page.click('.sb-section-btn[title="새 마인드맵"]');
    await page.waitForSelector('.canvas', { timeout: 5_000 });
    await page.click('.canvas');
    await page.keyboard.press('Enter');
    await page.waitForSelector('.editing-text', { timeout: 3_000 });
    await page.keyboard.type('@오늘 집중저장테스트');
    await page.keyboard.press('Enter');

    const node = page.locator('.node', { hasText: '집중저장테스트' });
    await node.click();
    await page.waitForSelector('.sel-toolbar', { timeout: 3_000 });
    await page.locator('.st-btn[title="집중 시작"]').click();

    // 시작 프롬프트 → 시작 (목표는 비워도 됨)
    await page.waitForSelector('.focus-start', { timeout: 3_000 });
    await page.locator('.focus-start-go').click();

    // 세션 노트가 열리고 배너가 진행 중으로 뜬다.
    await page.waitForSelector('.session-banner.running', { timeout: 5_000 });
    await expect(page.locator('.sess-end')).toBeVisible();

    // 세션이 집계되려면 durationSec ≥ 1이어야 한다(anti-noise). 실제 벽시계 시간을
    // 조금 흘려보낸다 — 조건 폴링이 아니라 시간 기반 기능(소요시간) 검증용.
    await page.waitForTimeout(1300);

    // 작업 로그를 타이핑한 "직후" 종료 → 자동저장(800ms) 경합을 유발한다.
    const editor = page.locator('.ProseMirror').last();
    await editor.click();
    await page.keyboard.type('작업 로그 저장 확인용 본문');
    await page.locator('.sess-end').click();

    // 완료 카드 → 완료
    await page.waitForSelector('.focus-done', { timeout: 5_000 });
    await page.locator('.focus-done-ok').click();

    // (1)+(2) 세션 노트가 종료 상태로 유지된다(진행 중 아님) + 본문 보존
    await expect(page.locator('.session-banner.running')).toHaveCount(0);
    await expect(page.locator('.ProseMirror').last()).toContainText('작업 로그 저장 확인용 본문');

    // (3) 집중 기록에 이 세션이 남는다 (end가 디스크에 영속됐다는 증거)
    await page.click('.sb-nav-item:has-text("캘린더")');
    await page.waitForSelector('.cal', { timeout: 5_000 });
    await page.locator('.cal-history-btn').click();
    await expect(page.locator('.wh-entry', { hasText: '집중저장테스트' })).toBeVisible({ timeout: 5_000 });
  } finally {
    await cleanup();
  }
});

// 일정 없는 할 일 노드에서 바로 집중하면 그 시각이 스케줄로 자동 배치된다 (0015 후속 요청).
test('일정 없는 할 일 노드에서 집중을 시작하면 그 노드가 자동으로 스케줄된다', { tag: ['@focus', '@todo'] }, async () => {
  const { page, cleanup } = await launchApp();
  try {
    await page.click('.sb-section-btn[title="새 마인드맵"]');
    await page.waitForSelector('.canvas', { timeout: 5_000 });
    await page.click('.canvas');
    await page.keyboard.press('Enter');
    await page.waitForSelector('.editing-text', { timeout: 3_000 });
    await page.keyboard.type('자동배치노드');
    await page.keyboard.press('Enter');

    const node = page.locator('.node', { hasText: '자동배치노드' });
    await node.click();
    await page.keyboard.press('Meta+Enter'); // 할 일로 전환 (일정 없음)
    await expect(node).not.toHaveClass(/scheduled/);

    await page.locator('.st-btn[title="집중 시작"]').click();
    await page.waitForSelector('.focus-start', { timeout: 3_000 });
    await page.locator('.focus-start-go').click();
    await page.waitForSelector('.session-banner.running', { timeout: 5_000 });

    // 집중을 시작하는 순간 노드에 일정(scheduleAt)이 잡힌다 → 캘린더에 뜬다
    await expect(node).toHaveClass(/scheduled/, { timeout: 3_000 });
  } finally {
    await cleanup();
  }
});

// 집중 통계 칩은 할 일 노드에만 — 일반 노드로 되돌리면 사라진다 (누수 수정).
test('집중한 노드를 일반 노드로 되돌리면 집중시간 칩이 사라진다', { tag: ['@focus', '@todo'] }, async () => {
  const { page, cleanup } = await launchApp();
  try {
    await page.click('.sb-section-btn[title="새 마인드맵"]');
    await page.waitForSelector('.canvas', { timeout: 5_000 });
    await page.click('.canvas');
    await page.keyboard.press('Enter');
    await page.waitForSelector('.editing-text', { timeout: 3_000 });
    await page.keyboard.type('칩테스트노드');
    await page.keyboard.press('Enter');
    const node = page.locator('.node', { hasText: '칩테스트노드' });

    // 할 일로 전환 → 집중 (짧게) → 종료
    await node.click();
    await page.keyboard.press('Meta+Enter');
    await page.locator('.st-btn[title="집중 시작"]').click();
    await page.waitForSelector('.focus-start', { timeout: 3_000 });
    await page.locator('.focus-start-go').click();
    await page.waitForSelector('.session-banner.running', { timeout: 5_000 });
    await page.waitForTimeout(1300); // durationSec ≥ 1 이라야 집계된다
    await page.locator('.sess-end').click();
    await page.waitForSelector('.focus-done', { timeout: 5_000 });
    await page.locator('.focus-done-ok').click();

    // 할 일 노드엔 집중시간 칩이 뜬다
    await expect(node.locator('.gchip.focus')).toBeVisible({ timeout: 4_000 });

    // 일반 노드로 되돌리면 실행 지표(칩)가 사라진다
    await node.click({ button: 'right' });
    await page.waitForSelector('.ctx-menu', { timeout: 3_000 });
    await page.click('.ctx-item:has-text("일반 노드로 되돌리기")');
    await expect(node.locator('.gchip.focus')).toHaveCount(0, { timeout: 3_000 });
  } finally {
    await cleanup();
  }
});
