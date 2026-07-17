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
}

/**
 * Launch the Electron app with fully isolated userData + workspace directories.
 * Returns handles and a cleanup function that quits the app and removes the temp dirs.
 */
export async function launchApp(opts: LaunchOptions = {}): Promise<AppHandle> {
  const userData = mkdtempSync(join(tmpdir(), 'mindmap-userData-'));
  const workspace = mkdtempSync(join(tmpdir(), 'mindmap-ws-'));

  // MINDMAP_E2E_QUIET keeps the Electron window off-screen and un-activated —
  // Playwright drives it over CDP either way, so there's no reason for it to
  // pop to the front and steal focus from whatever else is on screen.
  const env = {
    ...process.env,
    MINDMAP_USER_DATA: userData,
    MINDMAP_WORKSPACE: workspace,
    MINDMAP_E2E_QUIET: '1',
  };
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

  const app = await electron.launch({
    args: [join(__dirname, '../dist-electron/main.js')],
    env,
  });

  const page = await app.firstWindow();
  // Wait for the sidebar to be visible — indicates the app is fully loaded.
  await page.waitForSelector('.sidebar', { timeout: 15_000 });

  const cleanup = async () => {
    await app.close().catch(() => {});
    rmSync(userData, { recursive: true, force: true });
    rmSync(workspace, { recursive: true, force: true });
  };

  return { app, page, workspace, cleanup };
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
