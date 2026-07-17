import { test, expect, _electron as electron } from '@playwright/test';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { tmpdir } from 'os';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Regression: renaming a note (via the title-sync flow) renamed the companion
// .assets folder but left the body's "./<old>.assets/…" image reference
// pointing at the now-nonexistent old folder, breaking the embedded image.
//
// This also covers the 0.8.3 hidden-folder migration: pre-0.8.3 notes have a
// visible "<stem>.assets" folder (no leading dot) — a rename must upgrade it
// to the hidden ".<stem>.assets" convention, not just carry the old visible
// name forward under the new stem.

test('renaming a note rewrites its embedded image references to the new (hidden) assets folder', { tag: ['@note'] }, async () => {
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
    // The rewritten ref is URL-encoded (space → %20) so it's portable to standard
    // markdown viewers (Obsidian/GitHub/Typora); in-app rendering decodes it back.
    expect(body).toContain('./.시장%20리서치.assets/img.png');
    expect(body).not.toContain('./.시장 리서치.assets/img.png');
    expect(body).not.toContain(`./${oldStem}.assets/`);
    expect(existsSync(join(workspace, '.시장 리서치.assets', 'img.png'))).toBe(true);
    expect(existsSync(join(workspace, '시장 리서치.assets'))).toBe(false);
  } finally {
    await app.close().catch(() => {});
    rmSync(userData, { recursive: true, force: true });
    rmSync(workspace, { recursive: true, force: true });
  }
});

test('a brand-new note gets a hidden (dot-prefixed) assets folder for its first image', { tag: ['@note'] }, async () => {
  const userData = mkdtempSync(join(tmpdir(), 'mindmap-userData-'));
  const workspace = mkdtempSync(join(tmpdir(), 'mindmap-ws-'));
  const stem = '제목 없음';
  writeFileSync(
    join(workspace, `${stem}.md`),
    `---\nid: "n1"\ntitle: "${stem}"\nlinks: []\n---\n\n본문\n`,
    'utf-8',
  );

  const env = { ...process.env, MINDMAP_USER_DATA: userData, MINDMAP_WORKSPACE: workspace };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({ args: [join(__dirname, '../dist-electron/main.js')], env });
  const page = await app.firstWindow();

  try {
    await page.waitForSelector('.sidebar', { timeout: 15_000 });

    const buffer = Array.from(Buffer.from('fake-png-bytes'));
    const rel = await page.evaluate(
      ({ notePath, buffer }) =>
        (window as unknown as { api: { imagesWrite: (a: unknown) => Promise<string> } }).api.imagesWrite({
          notePath,
          filename: 'img.png',
          buffer,
        }),
      { notePath: join(workspace, `${stem}.md`), buffer },
    );

    expect(rel).toBe(`./.${stem}.assets/img.png`);
    expect(existsSync(join(workspace, `.${stem}.assets`, 'img.png'))).toBe(true);
    expect(existsSync(join(workspace, `${stem}.assets`))).toBe(false);
  } finally {
    await app.close().catch(() => {});
    rmSync(userData, { recursive: true, force: true });
    rmSync(workspace, { recursive: true, force: true });
  }
});
