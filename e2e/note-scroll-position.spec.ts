import { test, expect, _electron as electron } from '@playwright/test';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { tmpdir } from 'os';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Regression: switching tabs away from a note and back reset its scroll
// position to the top. App.tsx only renders the single active tab per pane
// group (key={tab.id}), so NoteEditor fully unmounts on every tab switch —
// any scroll position living only in that unmounted DOM node was lost.

test('탭을 왔다 갔다 해도 노트의 스크롤 위치가 유지된다', { tag: ['@note'] }, async () => {
  const userData = mkdtempSync(join(tmpdir(), 'mindmap-userData-'));
  const workspace = mkdtempSync(join(tmpdir(), 'mindmap-ws-'));
  const longBody = Array.from({ length: 120 }, (_, i) => `문단 ${i + 1} — 스크롤 테스트용 내용입니다.`).join('\n\n');
  writeFileSync(
    join(workspace, '긴 노트.md'),
    `---\nid: "n1"\ntitle: "긴 노트"\nlinks: []\n---\n\n${longBody}\n`,
    'utf-8',
  );
  writeFileSync(
    join(workspace, '짧은 노트.md'),
    `---\nid: "n2"\ntitle: "짧은 노트"\nlinks: []\n---\n\n짧은 본문\n`,
    'utf-8',
  );

  const env = { ...process.env, MINDMAP_USER_DATA: userData, MINDMAP_WORKSPACE: workspace };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({ args: [join(__dirname, '../dist-electron/main.js')], env });
  const page = await app.firstWindow();

  try {
    await page.waitForSelector('.sidebar', { timeout: 15_000 });

    await page.click('.row:has-text("긴 노트")', { timeout: 5_000 });
    await page.waitForSelector('.note-rich-body', { timeout: 5_000 });

    // 아래로 스크롤 — 커밋은 120ms 디바운스(NoteEditor.tsx)이므로 그 이상 대기해
    // 실제로 scrollPositions에 반영된 뒤에 탭을 전환한다.
    await page.locator('.note-rich-body').evaluate((el) => { el.scrollTop = 800; });
    await expect
      .poll(() => page.locator('.note-rich-body').evaluate((el) => el.scrollTop))
      .toBeGreaterThan(700);
    await page.waitForTimeout(250);

    // 다른 탭으로 갔다가 돌아온다
    await page.click('.row:has-text("짧은 노트")');
    await page.waitForSelector('.note-rich-body', { timeout: 5_000 });
    await page.click('.tab:has-text("긴 노트")');
    await page.waitForSelector('.note-rich-body', { timeout: 5_000 });

    const scrollTop = await page.locator('.note-rich-body').evaluate((el) => el.scrollTop);
    expect(scrollTop).toBeGreaterThan(700);
  } finally {
    await app.close().catch(() => {});
    rmSync(userData, { recursive: true, force: true });
    rmSync(workspace, { recursive: true, force: true });
  }
});
