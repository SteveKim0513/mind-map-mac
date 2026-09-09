import { test, expect } from '@playwright/test';
import { readFileSync } from 'fs';
import { join } from 'path';
import { launchApp } from './helpers';

// Regression coverage for docs/product/REDESIGN-VISION-2026-07.md §3-1 /
// docs/exec-plans/completed/2026-07-10-global-capture.md.
//
// Playwright can't press a real OS-level global accelerator, so these tests
// drive the same code path through the capture:show IPC channel (exposed as
// the ⌘K "빠른 메모 열기" command) instead of the ⌥Space shortcut itself.
// The end-to-end write path (capture window -> capture:targetPath -> save)
// is identical either way.

test('전역 단축키(⌥Space)가 등록된다', { tag: ['@capture'] }, async () => {
  // Opt into real global-shortcut registration — the only test that needs it.
  // Every other instance skips it so parallel workers don't contend over Alt+Space.
  const { app, cleanup } = await launchApp({ globalShortcut: true });
  try {
    const registered = await app.evaluate(({ globalShortcut }) =>
      globalShortcut.isRegistered('Alt+Space'),
    );
    expect(registered).toBe(true);
  } finally {
    await cleanup();
  }
});

test('capture:show은 quiet 모드에서 포커스 상태를 바꾸지 않는다', { tag: ['@capture'] }, async () => {
  // launchApp()은 항상 MINDMAP_E2E_QUIET=1을 넘기지만, electron/main.ts는
  // CI 환경변수가 있으면 quiet를 의도적으로 끈다(win.focus() 기반 테스트가
  // CI에서 실제 포커스를 받게 하려고). 그래서 실제 GitHub Actions CI에서
  // 이 테스트를 그냥 돌리면 quiet 모드 자체가 꺼져 있어 전제가 깨진다 —
  // forceQuiet로 이 런치에서만 CI를 무시하고 quiet를 강제한다.
  //
  // "어떤 창도 포커스가 없어야 한다"는 절대 기준은 쓰지 않는다 — 이 OS에서는
  // 메인 윈도우가 off-screen+accessory 상태로도 capture:show 호출 전부터
  // 이미 isFocused()===true를 보고하기 때문(메인 윈도우 자체의 기존 동작이지
  // 캡처 창과 무관). 대신 capture:show 전후로 포커스된 창 집합이 그대로인지
  // 비교해, 캡처 창이 "추가로" 포커스를 가져가지 않는지만 검증한다.
  const { app, page, cleanup } = await launchApp({ forceQuiet: true });
  try {
    const focusedBefore = await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()
        .filter((w) => w.isFocused())
        .map((w) => w.id)
        .sort(),
    );

    const [capturePage] = await Promise.all([
      app.waitForEvent('window'),
      page.evaluate(() => window.api.capture.show()),
    ]);
    await capturePage.waitForSelector('.capture-input', { timeout: 5_000 });

    const focusedAfter = await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()
        .filter((w) => w.isFocused())
        .map((w) => w.id)
        .sort(),
    );
    const captureWinFocused = await app.evaluate(
      ({ BrowserWindow }, before) =>
        BrowserWindow.getAllWindows()
          .filter((w) => !before.includes(w.id))
          .some((w) => w.isFocused()),
      focusedBefore,
    );

    expect(focusedAfter).toEqual(focusedBefore);
    expect(captureWinFocused).toBe(false);
  } finally {
    await cleanup();
  }
});

test('캡처 창에 텍스트를 입력하고 Enter를 누르면 "오늘의 생각" 맵에 루트 노드로 쌓인다', { tag: ['@capture'] }, async () => {
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

test('Esc를 누르면 저장하지 않고 캡처 창이 숨겨진다', { tag: ['@capture'] }, async () => {
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
