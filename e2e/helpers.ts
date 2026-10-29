import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { tmpdir } from 'os';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

export interface AppHandle {
  app: ElectronApplication;
  page: Page;
  workspace: string;
  /** This instance's isolated userData directory (settings, tokens, notifications …). */
  userData: string;
  cleanup: () => Promise<void>;
}

export interface LaunchOptions {
  /**
   * Register the OS-global capture shortcut (Alt+Space) on this instance.
   * Off by default: the accelerator is a single global registration, so under
   * parallel workers every instance would fight over it and only the first would
   * win. Only the one test that asserts registration needs this. See
   * electron/main.ts MINDMAP_DISABLE_GLOBAL_SHORTCUT.
   */
  globalShortcut?: boolean;
  /**
   * Force MINDMAP_E2E_QUIET to actually take effect for this one launch by
   * clearing an inherited CI env var, even when the outer test run itself is
   * executing under CI. electron/main.ts intentionally disables quiet mode
   * whenever CI is set (so win.focus()-dependent tests get real OS focus on
   * CI runners) — but a test that asserts the quiet-mode behavior itself
   * (e.g. "the capture window doesn't steal focus") needs quiet mode to
   * actually be on regardless of that ambient CI override, or the assertion
   * is untestable in CI. Only use this for tests like that.
   */
  forceQuiet?: boolean;
  /**
   * Extra environment variables for this Electron instance, merged over the
   * defaults (e.g. `{ MINDMAP_RELAY_URL: relay.url }` to point the shared-folder
   * feature at a per-test relay). Applied last, so it can also override
   * MINDMAP_* defaults — keep it to what the test actually needs.
   */
  env?: Record<string, string>;
  /**
   * Relaunch on the SAME userData + workspace directories as an earlier instance — an app restart:
   * everything persisted (safeStorage tokens, notifications.json, session, sidecars) is still there.
   * Close the earlier instance first (`await first.app.close()`). The relaunched handle's `cleanup`
   * only quits the app; the directories are removed by the ORIGINAL handle's `cleanup`.
   */
  reuse?: { userData: string; workspace: string };
}

/**
 * Launch the Electron app with fully isolated userData + workspace directories.
 * Returns handles and a cleanup function that quits the app and removes the temp dirs.
 */
export async function launchApp(opts: LaunchOptions = {}): Promise<AppHandle> {
  const userData = opts.reuse?.userData ?? mkdtempSync(join(tmpdir(), 'mindmap-userData-'));
  const workspace = opts.reuse?.workspace ?? mkdtempSync(join(tmpdir(), 'mindmap-ws-'));

  // MINDMAP_E2E_QUIET keeps the Electron window off-screen and un-activated —
  // Playwright drives it over CDP either way, so there's no reason for it to
  // pop to the front and steal focus from whatever else is on screen.
  // Inside the E2E VM (scripts/e2e-vm.sh sets MINDMAP_E2E_VM) there is no
  // human screen to protect, and quiet's 'accessory' policy breaks win.focus()
  // on macOS 26, so windows open normally there. forceQuiet tests still get it.
  const quiet = opts.forceQuiet || !process.env.MINDMAP_E2E_VM;
  const env: Record<string, string | undefined> = {
    ...process.env,
    MINDMAP_USER_DATA: userData,
    MINDMAP_WORKSPACE: workspace,
  };
  if (quiet) env.MINDMAP_E2E_QUIET = '1';
  else delete env.MINDMAP_E2E_QUIET;
  // Skip the OS-global capture shortcut so parallel instances don't contend
  // over the single Alt+Space registration (opt in per test when needed).
  if (opts.globalShortcut) {
    delete env.MINDMAP_DISABLE_GLOBAL_SHORTCUT;
  } else {
    env.MINDMAP_DISABLE_GLOBAL_SHORTCUT = '1';
  }
  // VSCode sets ELECTRON_RUN_AS_NODE=1 which makes Electron behave as plain Node.
  // Remove it so the child process starts as a real Electron browser process.
  delete env.ELECTRON_RUN_AS_NODE;
  if (opts.forceQuiet) delete env.CI;
  if (opts.env) Object.assign(env, opts.env);

  const app = await electron.launch({
    args: [join(__dirname, '../dist-electron/main.js')],
    env,
  });

  const page = await app.firstWindow();
  // Wait for the sidebar to be visible — indicates the app is fully loaded.
  await page.waitForSelector('.sidebar', { timeout: 15_000 });

  const cleanup = async () => {
    await app.close().catch(() => {});
    if (opts.reuse) return; // the original launch owns (and removes) the directories
    rmSync(userData, { recursive: true, force: true });
    rmSync(workspace, { recursive: true, force: true });
  };

  return { app, page, workspace, userData, cleanup };
}

/**
 * 자동저장이 끝날 때까지 기다린다 — 툴바의 저장 표시등(`.map-save.saving` = dirty)이 꺼질 때까지.
 * 고정 `waitForTimeout(1_100)`은 느린 디스크·부하에서 저장보다 먼저 파일을 읽어 깨진다.
 * 편집 직후(저장 표시등이 켜진 뒤)에 호출한다.
 */
export async function waitForSaved(page: Page): Promise<void> {
  await page.waitForSelector('.map-save:not(.saving)', { timeout: 10_000 });
}

/**
 * Create a new note via the sidebar library header button.
 * Notes use the in-editor title input as the rename entry point, so the
 * sidebar never enters inline rename mode on note creation. We just wait
 * for the tab and the sidebar label to be stable before returning.
 */
export async function createNoteFromMenu(page: Page): Promise<void> {
  await page.click('.sb-section-btn[title="새 노트"]');
  // Tab appears immediately when the note is opened
  await page.waitForSelector('.tab', { timeout: 5_000 });
  // Sidebar shows the note as a stable .label (no inline rename for notes)
  await page.waitForSelector('.label', { timeout: 5_000 });
}

/** Get all visible tab titles from the tab bar. */
export async function getTabTitles(page: Page): Promise<string[]> {
  return page.$$eval('.tab-title', (els) => els.map((e) => e.textContent?.trim() ?? ''));
}

/** Get all sidebar file/folder labels (handles both normal and rename-mode items). */
export async function getSidebarLabels(page: Page): Promise<string[]> {
  return page.$$eval('.label, .rename-input', (els) =>
    els.map((e) =>
      e.tagName === 'INPUT'
        ? (e as HTMLInputElement).value?.trim() ?? ''
        : e.textContent?.trim() ?? '',
    ),
  );
}

/** Write a file directly into the test workspace (simulates an external Finder change). */
export function writeExternalFile(workspace: string, name: string, content: string): string {
  const p = join(workspace, name);
  writeFileSync(p, content, 'utf-8');
  return p;
}
