import { test, expect, _electron as electron } from '@playwright/test';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { tmpdir } from 'os';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Regression: renaming a note (via the title-sync flow) renamed the companion
// .assets folder but left the body's "./<old>.assets/…" image reference
// pointing at the now-nonexistent old folder, breaking the embedded image.

test('renaming a note rewrites its embedded image references to the new assets folder', async () => {
  const userData = mkdtempSync(join(tmpdir(), 'mindmap-userData-'));
  const workspace = mkdtempSync(join(tmpdir(), 'mindmap-ws-'));
  const oldStem = '제목 없음';
  mkdirSync(join(workspace, `${oldStem}.assets`), { recursive: true });
  writeFileSync(join(workspace, `${oldStem}.assets`, 'img.png'), 'fake-png-bytes', 'utf-8');
  writeFileSync(
    join(workspace, `${oldStem}.md`),
    `---\nid: "n1"\ntitle: "${oldStem}"\nlinks: []\n---\n\n![](./${oldStem}.assets/img.png)\n\n본문\n`,
    'utf-8',
  );

  const env = { ...process.env, MINDMAP_USER_DATA: userData, MINDMAP_WORKSPACE: workspace };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({ args: [join(__dirname, '../dist-electron/main.js')], env });
  const page = await app.firstWindow();

  try {
    await page.waitForSelector('.sidebar', { timeout: 15_000 });
    await page.click('.row', { timeout: 5_000 });
    await page.waitForSelector('.note-pane', { timeout: 5_000 });

    const titleInput = page.locator('.note-title');
    await titleInput.click({ clickCount: 3 });
    await titleInput.fill('시장 리서치');
    await titleInput.press('Tab');

    // debounced rename (600ms) + our image-path rewrite
    await expect
      .poll(() => {
        try {
          readFileSync(join(workspace, '시장 리서치.md'), 'utf-8');
          return true;
        } catch {
          return false;
        }
      }, { timeout: 5_000 })
      .toBe(true);

    const body = readFileSync(join(workspace, '시장 리서치.md'), 'utf-8');
    expect(body).toContain('./시장 리서치.assets/img.png');
    expect(body).not.toContain(`./${oldStem}.assets/`);
  } finally {
    await app.close().catch(() => {});
    rmSync(userData, { recursive: true, force: true });
    rmSync(workspace, { recursive: true, force: true });
  }
});
