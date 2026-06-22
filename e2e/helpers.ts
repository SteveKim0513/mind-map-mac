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

/**
 * Launch the Electron app with fully isolated userData + workspace directories.
 * Returns handles and a cleanup function that quits the app and removes the temp dirs.
 */
export async function launchApp(): Promise<AppHandle> {
  const userData = mkdtempSync(join(tmpdir(), 'mindmap-userData-'));
  const workspace = mkdtempSync(join(tmpdir(), 'mindmap-ws-'));

  const app = await electron.launch({
    args: [join(__dirname, '../dist-electron/main.js')],
    env: {
      ...process.env,
      MINDMAP_USER_DATA: userData,
      MINDMAP_WORKSPACE: workspace,
    },
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

/** Click the ＋ (create) button in the sidebar footer. */
export async function openCreateMenu(page: Page) {
  await page.click('.sb-foot-btn:first-of-type');
  await page.waitForSelector('.sb-create-menu', { state: 'visible' });
}

/**
 * Create a new note via the sidebar ＋ menu.
 * Notes use the in-editor title input as the rename entry point, so the
 * sidebar never enters inline rename mode on note creation. We just wait
 * for the tab and the sidebar label to be stable before returning.
 */
export async function createNoteFromMenu(page: Page): Promise<void> {
  await openCreateMenu(page);
  // Click "노트" option in the create menu (exact match to avoid '링크로 노트')
  await page.getByRole('button', { name: '노트', exact: true }).click();
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
