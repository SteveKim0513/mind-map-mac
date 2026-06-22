import { test, expect } from '@playwright/test';
import { launchApp, createNoteFromMenu, getTabTitles, getSidebarLabels, writeExternalFile } from './helpers';

// ── App launch ─────────────────────────────────────────────────────────────
test('app launches and shows an empty workspace', async () => {
  const { page, cleanup } = await launchApp();
  try {
    await expect(page.locator('.sidebar')).toBeVisible();
    const labels = await getSidebarLabels(page);
    expect(labels).toHaveLength(0); // fresh workspace — nothing yet
  } finally {
    await cleanup();
  }
});

// ── Create note ─────────────────────────────────────────────────────────────
test('creating a note opens a tab and adds an entry to the sidebar', async () => {
  const { page, cleanup } = await launchApp();
  try {
    await createNoteFromMenu(page);

    // Tab should be open
    const titles = await getTabTitles(page);
    expect(titles.length).toBeGreaterThan(0);

    // Sidebar should list the note
    const labels = await getSidebarLabels(page);
    expect(labels.length).toBeGreaterThan(0);
  } finally {
    await cleanup();
  }
});

// ── Delete note ─────────────────────────────────────────────────────────────
test('deleting a note closes its tab and removes it from the sidebar', async () => {
  test.setTimeout(25_000); // 4 s toast timer + buffer, well within 25 s
  const { page, cleanup } = await launchApp();
  try {
    await createNoteFromMenu(page);
    expect(await getTabTitles(page)).toHaveLength(1);

    // Delete uses a 4-second undo-toast. Use ⌘+click to multi-select the
    // row, then click the always-visible "삭제" button in the selection bar.
    await page.locator('.row').first().click({ modifiers: ['Meta'] });
    await page.waitForSelector('.sel-bar', { timeout: 2_000 });
    await page.getByTestId('btn-delete-marked').click();
    await page.waitForSelector('.sel-bar', { state: 'hidden', timeout: 3_000 });

    // Wait for the 4 s undo window to expire + file removal + UI refresh
    await page.waitForTimeout(5_500);

    expect(await getTabTitles(page)).toHaveLength(0);
    expect(await getSidebarLabels(page)).toHaveLength(0);
  } finally {
    await cleanup();
  }
});

// ── External file change (focus refresh) ───────────────────────────────────
test('sidebar updates when a file is added externally and the window regains focus', async () => {
  const { app, page, workspace, cleanup } = await launchApp();
  try {
    // Confirm empty start
    expect(await getSidebarLabels(page)).toHaveLength(0);

    // Write a file from outside the app (simulates Finder action)
    writeExternalFile(workspace, '외부파일.md', '# 외부에서 만든 노트\n\n내용');

    // Simulate window losing then regaining focus to trigger the refresh
    await app.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0];
      win.blur();
    });
    await page.waitForTimeout(200);
    await app.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0];
      win.focus();
    });

    // Give the refresh time to propagate
    await page.waitForTimeout(500);

    const labels = await getSidebarLabels(page);
    expect(labels.some((l) => l.includes('외부파일'))).toBe(true);
  } finally {
    await cleanup();
  }
});

// ── Rename note ─────────────────────────────────────────────────────────────
test('renaming a note title updates the tab title and sidebar label', async () => {
  const { page, cleanup } = await launchApp();
  try {
    await createNoteFromMenu(page);

    // The note opens in a rename state — type a new title
    const titleInput = page.locator('.note-title');
    await titleInput.click({ clickCount: 3 }); // select all
    await titleInput.fill('새로운 제목');
    await titleInput.press('Tab'); // commit

    // Wait for the debounced rename (600ms) + sidebar refresh
    await page.waitForTimeout(1500);

    const labels = await getSidebarLabels(page);
    expect(labels.some((l) => l.includes('새로운 제목'))).toBe(true);

    const titles = await getTabTitles(page);
    expect(titles.some((t) => t.includes('새로운 제목'))).toBe(true);
  } finally {
    await cleanup();
  }
});
