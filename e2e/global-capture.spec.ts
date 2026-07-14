import { test, expect } from '@playwright/test';
import { readFileSync } from 'fs';
import { join } from 'path';
import { launchApp } from './helpers';

// Regression coverage for docs/product/REDESIGN-VISION-2026-07.md §3-1 /
// docs/exec-plans/completed/2026-07-10-global-capture.md.
//
// Playwright can't press a real OS-level global accelerator, so these tests
// drive the same code path through the capture:show IPC channel (exposed as
// the ⌘K "빠른 캡처 열기" command) instead of the ⌥Space shortcut itself.
// The end-to-end write path (capture window -> capture:targetPath -> save)
// is identical either way.

test('전역 단축키(⌥Space)가 등록된다', async () => {
  const { app, cleanup } = await launchApp();
  try {
    const registered = await app.evaluate(({ globalShortcut }) =>
      globalShortcut.isRegistered('Alt+Space'),
    );
    expect(registered).toBe(true);
  } finally {
    await cleanup();
  }
});

test('캡처 창에 텍스트를 입력하고 Enter를 누르면 "오늘의 생각" 맵에 루트 노드로 쌓인다', async () => {
  const { app, page, workspace, cleanup } = await launchApp();
  try {
    const [capturePage] = await Promise.all([
      app.waitForEvent('window'),
      page.evaluate(() => window.api.capture.show()),
    ]);
    await capturePage.waitForSelector('.capture-input', { timeout: 5_000 });
    await capturePage.fill('.capture-input', '@내일 오후 2시 팀 회고 #teal');
    await capturePage.press('.capture-input', 'Enter');

    // 창은 닫히지 않고 숨겨진다 — 저장이 끝나길 기다렸다가 파일을 직접 확인.
    await expect
      .poll(() => {
        try {
          return JSON.parse(readFileSync(join(workspace, '오늘의 생각.mind'), 'utf-8'));
        } catch {
          return null;
        }
      }, { timeout: 5_000 })
      .not.toBeNull();

    const doc = JSON.parse(readFileSync(join(workspace, '오늘의 생각.mind'), 'utf-8'));
    expect(doc.rootIds).toHaveLength(1);
    const node = doc.nodes[doc.rootIds[0]];
    expect(node.text).toBe('@내일 오후 2시 팀 회고 #teal');
    expect(node.scheduled).toBe(true);
    expect(node.color).toBe('teal');

    // 두 번째 캡처 — 캡처 창은 닫히지 않고 숨겨져 있던 걸 재사용하므로(§1의
    // "재생성 비용 절감" 설계) 새 window 이벤트가 아니라 같은 페이지를 재사용한다.
    await page.evaluate(() => window.api.capture.show());
    await expect(capturePage.locator('.capture-input')).toHaveValue('', { timeout: 5_000 });
    await capturePage.fill('.capture-input', '두 번째 생각');
    await capturePage.press('.capture-input', 'Enter');

    await expect
      .poll(() => {
        const d = JSON.parse(readFileSync(join(workspace, '오늘의 생각.mind'), 'utf-8'));
        return d.rootIds.length;
      }, { timeout: 5_000 })
      .toBe(2);
  } finally {
    await cleanup();
  }
});

test('Esc를 누르면 저장하지 않고 캡처 창이 숨겨진다', async () => {
  const { app, page, workspace, cleanup } = await launchApp();
  try {
    const [capturePage] = await Promise.all([
      app.waitForEvent('window'),
      page.evaluate(() => window.api.capture.show()),
    ]);
    await capturePage.waitForSelector('.capture-input', { timeout: 5_000 });
    await capturePage.fill('.capture-input', '저장되면 안 되는 텍스트');
    await capturePage.press('.capture-input', 'Escape');
    await capturePage.waitForTimeout(300);

    expect(() => readFileSync(join(workspace, '오늘의 생각.mind'), 'utf-8')).toThrow();
  } finally {
    await cleanup();
  }
});
