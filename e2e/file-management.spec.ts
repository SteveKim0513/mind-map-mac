import { test, expect } from '@playwright/test';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
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

    // Delete moves to the workspace trash immediately (no timed window).
    // ⌘+click to multi-select the row, then click the selection-bar "삭제".
    await page.locator('.row').first().click({ modifiers: ['Meta'] });
    await page.waitForSelector('.sel-bar', { timeout: 2_000 });
    await page.getByTestId('btn-delete-marked').click();
    await page.waitForSelector('.sel-bar', { state: 'hidden', timeout: 3_000 });
    await page.waitForTimeout(800); // move + refresh

    expect(await getTabTitles(page)).toHaveLength(0);
    expect(await getSidebarLabels(page)).toHaveLength(0);
  } finally {
    await cleanup();
  }
});

// ── Trash: delete → restore ─────────────────────────────────────────────────
test('a deleted file lands in the trash panel and restores from it', async () => {
  const { page, cleanup } = await launchApp();
  try {
    await createNoteFromMenu(page);
    expect(await getSidebarLabels(page)).toHaveLength(1);

    // delete it
    await page.locator('.row').first().click({ modifiers: ['Meta'] });
    await page.waitForSelector('.sel-bar', { timeout: 2_000 });
    await page.getByTestId('btn-delete-marked').click();
    await page.waitForTimeout(800);
    expect(await getSidebarLabels(page)).toHaveLength(0);

    // trash badge appears; open the trash panel and confirm the item is there
    await page.waitForSelector('.sb-trash-badge', { timeout: 3_000 });
    await page.locator('.sb-foot-btn[title^="휴지통"]').click();
    await page.waitForSelector('.trash-panel', { timeout: 3_000 });
    expect(await page.locator('.trash-row').count()).toBe(1);

    // restore → file returns to the sidebar, trash empties
    await page.locator('.trash-row').first().getByRole('button', { name: '복원' }).click();
    await page.waitForTimeout(800);
    expect(await page.locator('.trash-row').count()).toBe(0);
    await page.keyboard.press('Escape'); // close the (now empty) panel
    expect(await getSidebarLabels(page)).toHaveLength(1);
  } finally {
    await cleanup();
  }
});

// ── Code block: syntax highlighting + markdown round-trip ────────────────────
test('a note code block highlights by language and round-trips to markdown', async () => {
  const { page, workspace, cleanup } = await launchApp();
  try {
    await createNoteFromMenu(page);

    // insert a code block via the "/" slash menu
    const body = page.locator('.note-rich .ProseMirror');
    await body.click();
    await page.keyboard.type('/');
    await page.waitForSelector('.slash-menu', { timeout: 2_000 });
    await page.locator('.slash-item', { hasText: '코드블록' }).click();
    await page.waitForSelector('.cb', { timeout: 2_000 });

    // pick a language, type code → lowlight produces token spans
    await page.locator('.cb-lang').selectOption('javascript');
    await page.locator('.cb-pre code').click();
    await page.keyboard.type('const x = 1');
    await expect(page.locator('.cb-pre .hljs-keyword').first()).toBeVisible({ timeout: 3_000 });

    // saved markdown keeps the fenced block + language (round-trip)
    await page.waitForTimeout(1_000); // autosave debounce
    const mdName = readdirSync(workspace).find((f) => f.endsWith('.md'))!;
    const md = readFileSync(join(workspace, mdName), 'utf-8');
    expect(md).toMatch(/```javascript/);
    expect(md).toContain('const x = 1');
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
    await expect
      .poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isFocused()))
      .toBe(false);
    await app.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0];
      win.focus();
    });

    // Poll for the refresh to propagate instead of a fixed sleep — the debounced
    // tree rebuild can take longer than a flat timeout under system load.
    await expect
      .poll(async () => (await getSidebarLabels(page)).some((l) => l.includes('외부파일')), {
        timeout: 5_000,
      })
      .toBe(true);
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
