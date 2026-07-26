import { test, expect } from '@playwright/test';
import { launchApp } from './helpers';

// 관리형 오버레이 스택(ADR 0018) — 닫기/Esc는 최상단 레이어 하나만 닫고(한 단계
// 복귀), 나중에 연 오버레이가 항상 위에 보인다(스택 순서 기반 z-index). 이전에는
// 오버레이마다 자체 window 캡처 keydown이라 겹친 상태에서 Esc 한 번에 전부 닫혔다.

test('설정 → 사용 안내: Esc가 사용 안내만 닫고 설정으로 되돌아온다', { tag: ['@view', '@nav'] }, async () => {
  const { page, cleanup } = await launchApp();
  try {
    await page.keyboard.press('Meta+,');
    await page.waitForSelector('.settings', { timeout: 3_000 });
    await page.click('.set-advanced-toggle');
    await page.click('.set-link:has-text("사용 안내")');

    // 사용 안내가 설정 위에 쌓인다 — 설정은 아래에 열린 채 유지
    await expect(page.locator('.man')).toBeVisible();
    await expect(page.locator('.settings')).toHaveCount(1);

    // Esc 1회 → 사용 안내만 닫히고 설정이 남는다
    await page.keyboard.press('Escape');
    await expect(page.locator('.man')).toHaveCount(0);
    await expect(page.locator('.settings')).toBeVisible();

    // Esc 1회 더 → 설정도 닫힌다
    await page.keyboard.press('Escape');
    await page.waitForSelector('.settings', { state: 'hidden', timeout: 3_000 });
  } finally {
    await cleanup();
  }
});

test('설정 위에서 ⌘K로 연 휴지통이 설정보다 위에 보이고, Esc가 한 단계씩 되돌린다', { tag: ['@view', '@nav'] }, async () => {
  const { page, cleanup } = await launchApp();
  try {
    await page.keyboard.press('Meta+,');
    await page.waitForSelector('.settings', { timeout: 3_000 });

    // 커맨드 팔레트로 설정 위에 휴지통을 연다
    await page.keyboard.press('Meta+k');
    await page.waitForSelector('.qo-input', { timeout: 3_000 });
    await page.fill('.qo-input', '휴지통');
    await page.click('.qo-item:has-text("휴지통 열기")');
    await page.waitForSelector('.trash-panel', { timeout: 3_000 });
    await expect(page.locator('.settings')).toHaveCount(1);

    // 나중에 연 휴지통의 백드롭이 설정 백드롭보다 z가 높다 (DOM 순서와 무관)
    const zOf = (sel: string) =>
      page.locator(sel).evaluate((el) => Number(getComputedStyle(el).zIndex));
    expect(await zOf('.wh-backdrop:has(.trash-panel)')).toBeGreaterThan(
      await zOf('.wh-backdrop:has(.settings)'),
    );

    // Esc → 휴지통만 닫히고 설정이 남는다 → Esc → 설정도 닫힌다
    await page.keyboard.press('Escape');
    await expect(page.locator('.trash-panel')).toHaveCount(0);
    await expect(page.locator('.settings')).toBeVisible();
    await page.keyboard.press('Escape');
    await page.waitForSelector('.settings', { state: 'hidden', timeout: 3_000 });
  } finally {
    await cleanup();
  }
});
