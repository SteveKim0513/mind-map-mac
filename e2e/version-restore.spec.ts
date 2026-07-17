import { test, expect, type Page } from '@playwright/test';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { launchApp } from './helpers';

// D1 (docs/exec-plans/active/2026-07-17-e2e-gap-qa-fixes.md): 이전 버전으로 되돌릴 때
// 현재(되돌리기 직전) 작업이 조용히 사라지면 안 된다. history:restore(electron/main.ts)는
// 되돌리기 직전 디스크 바이트를 스로틀을 무시하고 강제로 스냅샷해(그렇지 않으면 방금
// 편집이라 <5분 스로틀로 스킵되어 유실) 복원 후에도 되찾을 수 있게 한다. 복원 대화상자의
// "지금 내용은 새 버전으로 남는다"는 약속을 실제로 지키는지 검증한다.

async function newMapWithRoot(page: Page, text: string) {
  await page.click('.sb-section-btn[title="새 마인드맵"]');
  await page.waitForSelector('.canvas', { timeout: 5_000 });
  await page.click('.canvas');
  await page.keyboard.press('Enter');
  await page.waitForSelector('.editing-text', { timeout: 3_000 });
  await page.keyboard.type(text);
  await page.keyboard.press('Enter');
}

/** Current .mind path in the workspace (untitled maps auto-rename, so read by ext). */
function mapPath(workspace: string): string {
  const name = readdirSync(workspace).find((f) => f.endsWith('.mind'));
  if (!name) throw new Error('no .mind file in workspace yet');
  return join(workspace, name);
}

function mapContains(workspace: string, ...needles: string[]): boolean {
  try {
    const txt = readFileSync(mapPath(workspace), 'utf-8');
    return needles.every((n) => txt.includes(n));
  } catch {
    return false;
  }
}

test('이전 버전 복원 시 되돌리기 직전 작업이 히스토리에 강제 스냅샷되어 유실되지 않는다', { tag: ['@map'] }, async () => {
  test.setTimeout(45_000);
  const { app, page, workspace, cleanup } = await launchApp();
  try {
    // ── V1: 루트 A ─ 첫 저장이 생성 직후 빈 문서를 첫 스냅샷으로 남긴다 ───────
    await newMapWithRoot(page, '복원기준A');
    // ── V2: 자식 B ─ 같은 5분 창이라 새 스냅샷은 스로틀되지만 디스크엔 A+B가 남는다 ─
    await page.keyboard.press('Tab');
    await page.waitForSelector('.editing-text', { timeout: 3_000 });
    await page.keyboard.type('복원기준B');
    await page.keyboard.press('Enter');
    await page.keyboard.press('Escape');

    // 두 노드가 디스크에 저장될 때까지(autosave 오버라이트가 최소 1회 = 스냅샷 1개 보장)
    await expect.poll(() => mapContains(workspace, '복원기준A', '복원기준B'), { timeout: 10_000 }).toBe(true);

    // 되돌릴 이전 스냅샷이 실제로 쌓였는지 확인(스냅샷/리네임-히스토리이동 정상 여부도 겸사)
    const path0 = mapPath(workspace);
    await expect
      .poll(async () => page.evaluate((p) => window.api.history.list(p).then((v) => v.length), path0), {
        timeout: 10_000,
      })
      .toBeGreaterThanOrEqual(1);

    // ── ⌘K 명령 팔레트 → "이전 버전 보기" → 버전 패널 ───────────────────────
    await page.keyboard.press('Meta+k');
    await page.waitForSelector('.qo-input', { timeout: 3_000 });
    await page.locator('.qo-input').fill('이전 버전');
    await page.locator('.qo-item', { hasText: '이전 버전 보기' }).first().click();
    await page.waitForSelector('.trash-panel', { timeout: 3_000 });
    await expect(page.locator('.wh-title')).toContainText('이전 버전');
    await page.waitForSelector('.trash-row', { timeout: 5_000 });

    // 되돌리기 확인 대화상자를 "되돌리기"(response 0)로 스텁
    await app.evaluate(({ dialog }) => {
      dialog.showMessageBox = (async () => ({ response: 0, checkboxChecked: false })) as typeof dialog.showMessageBox;
    });

    // 가장 오래된(첫) 스냅샷으로 되돌린다 — 이때 D1이 현재(A+B)를 강제 스냅샷해야 한다
    await page.locator('.trash-row').last().getByRole('button', { name: '되돌리기' }).click();

    // 복원 완료(토스트) 대기
    await expect(page.locator('.toast', { hasText: '이전 버전으로 되돌렸어요' })).toBeVisible({ timeout: 5_000 });

    // ── 검증: 복원 후 히스토리에 "되돌리기 직전 작업(A+B)"을 담은 스냅샷이 있다 ─
    const pathNow = mapPath(workspace);
    const snapshots: string[] = await page.evaluate(async (p) => {
      const list = await window.api.history.list(p);
      return Promise.all(list.map((v) => window.api.history.read(p, v.stamp)));
    }, pathNow);

    // D1: 되돌리기 직전의 A+B가 담긴 스냅샷이 반드시 존재(강제 스냅샷) → 유실 없음
    expect(snapshots.some((c) => c.includes('복원기준A') && c.includes('복원기준B'))).toBe(true);
  } finally {
    await cleanup();
  }
});
