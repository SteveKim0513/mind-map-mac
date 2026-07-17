import { test, expect, _electron as electron } from '@playwright/test';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { tmpdir } from 'os';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Regression test for a bug where flex-item buttons/labels without
// flex-shrink:0 + white-space:nowrap wrapped their text character-by-
// character (reading as vertical text) once their flex container was
// squeezed narrower than the text's natural width. Root cause + fix:
// .md-tb-btn / .meta-add-wrap / .qo-name-txt / .meta-block-title /
// .set-meta-name in src/styles.css.

test('노트 에디터 툴바의 "양식+" 버튼은 좁은 폭에서도 한 줄을 유지한다', { tag: ['@view'] }, async () => {
  // The originally reported bug: .meta-add-wrap (the "양식+" button) only
  // renders when at least one meta template exists, so it must be pre-seeded —
  // the other toolbar buttons (H1/B/I/…) were never affected, they already
  // sat inside a .md-tb-group with flex-shrink:0.
  const TEMPLATE_ID = 'tmpl-resp-toolbar';
  const userData = mkdtempSync(join(tmpdir(), 'mindmap-userData-'));
  const workspace = mkdtempSync(join(tmpdir(), 'mindmap-ws-'));
  writeFileSync(
    join(userData, 'meta-templates.json'),
    JSON.stringify([{ id: TEMPLATE_ID, name: '테스트 메타', fields: [{ key: 'author', label: '작가', type: 'text' }] }]),
    'utf-8',
  );

  const env = { ...process.env, MINDMAP_USER_DATA: userData, MINDMAP_WORKSPACE: workspace };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({ args: [join(__dirname, '../dist-electron/main.js')], env });
  const page = await app.firstWindow();

  try {
    await page.waitForSelector('.sidebar', { timeout: 15_000 });
    await page.click('.sb-section-btn[title="새 노트"]');
    await page.waitForSelector('.note-pane', { timeout: 5_000 });
    await page.click('.ProseMirror');
    await page.waitForSelector('.meta-add-wrap', { timeout: 5_000 });

    // Shrink the actual BrowserWindow well below electron/main.ts's minWidth:640 —
    // setSize() bypasses the OS-level drag-resize floor, which is how this bug
    // was originally found (real users can still hit sub-640 effective toolbar
    // width via split panes; this is the most direct repro).
    await app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0].setSize(480, 700); });
    await page.waitForTimeout(150);

    // .md-tb-btn itself has a fixed height:30px in CSS, so wrapped text bleeds
    // outside the button rather than growing its own box — the wrapping
    // .meta-add-wrap div (no fixed height) is what actually reveals the bug,
    // since it stretches to the wrapped/overflowing content's real extent.
    const wrapBox = await page.locator('.meta-add-wrap').boundingBox();
    expect(wrapBox?.height ?? 0).toBeLessThan(34);

    // Sanity: the toolbar should be scrolling horizontally (not squeezing items).
    const { sw, cw } = await page.locator('.md-toolbar').evaluate((el) => ({ sw: el.scrollWidth, cw: el.clientWidth }));
    expect(sw).toBeGreaterThan(cw);
  } finally {
    await app.close().catch(() => {});
    rmSync(userData, { recursive: true, force: true });
    rmSync(workspace, { recursive: true, force: true });
  }
});

test('메타 블록 제목과 설정의 템플릿 이름은 좁은 폭에서 줄바꿈 대신 말줄임으로 표시된다', { tag: ['@view'] }, async () => {
  const TEMPLATE_ID = 'tmpl-resp-001';
  const TEMPLATE_NAME = '회의록 - 매우 긴 이름의 주간 스프린트 리뷰 템플릿';
  const FIELD_KEY = 'author';

  const userData = mkdtempSync(join(tmpdir(), 'mindmap-userData-'));
  const workspace = mkdtempSync(join(tmpdir(), 'mindmap-ws-'));
  writeFileSync(
    join(userData, 'meta-templates.json'),
    JSON.stringify([
      { id: TEMPLATE_ID, name: TEMPLATE_NAME, fields: [{ key: FIELD_KEY, label: '작가', type: 'text' }] },
    ]),
    'utf-8',
  );
  writeFileSync(
    join(workspace, '테스트 노트.md'),
    `---\nid: "note-resp-001"\ntitle: "테스트 노트"\nlinks: []\n_meta: [{"templateId":"${TEMPLATE_ID}","values":{"${FIELD_KEY}":"홍길동"}}]\n---\n\n본문\n`,
    'utf-8',
  );

  const env = { ...process.env, MINDMAP_USER_DATA: userData, MINDMAP_WORKSPACE: workspace };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({ args: [join(__dirname, '../dist-electron/main.js')], env });
  const page = await app.firstWindow();

  try {
    await page.waitForSelector('.sidebar', { timeout: 15_000 });

    // ── meta-block-title (note pane, squeezed to simulate a narrow split pane) ──
    await page.click('.row', { timeout: 5_000 });
    await page.waitForSelector('.meta-block-title', { timeout: 5_000 });
    await page.evaluate(() => {
      const pane = document.querySelector('.note-pane') as HTMLElement | null;
      if (pane) { pane.style.width = '220px'; pane.style.maxWidth = '220px'; pane.style.flex = 'none'; }
    });
    await page.waitForTimeout(150);
    const titleBox = await page.locator('.meta-block-title').first().boundingBox();
    expect(titleBox?.height ?? 0).toBeLessThan(22);

    // ── set-meta-name (Settings → 고급 설정 → 정보 양식, squeezed row) ──
    await page.keyboard.press('Meta+,');
    await page.waitForSelector('.settings', { timeout: 3_000 });
    await page.click('.set-advanced-toggle');
    await page.click('.set-link:has-text("정보 양식")');
    await page.waitForSelector('.set-meta-item', { timeout: 3_000 });
    await page.evaluate(() => {
      const row = document.querySelector('.set-meta-item') as HTMLElement | null;
      if (row) { row.style.width = '200px'; row.style.maxWidth = '200px'; }
    });
    await page.waitForTimeout(150);
    const nameBox = await page.locator('.set-meta-name').first().boundingBox();
    expect(nameBox?.height ?? 0).toBeLessThan(22);
  } finally {
    await app.close().catch(() => {});
    rmSync(userData, { recursive: true, force: true });
    rmSync(workspace, { recursive: true, force: true });
  }
});

test('Quick Open / 전체 검색 / 명령 팔레트의 항목 이름은 좁은 폭에서 말줄임으로 표시된다', { tag: ['@view'] }, async () => {
  const userData = mkdtempSync(join(tmpdir(), 'mindmap-userData-'));
  const workspace = mkdtempSync(join(tmpdir(), 'mindmap-ws-'));
  // A long title is required to force the wrap in the unfixed markup —
  // short titles never exceed the squeezed width and the test would pass
  // trivially either way.
  writeFileSync(
    join(workspace, '아주아주아주아주아주아주 긴 제목의 테스트 노트입니다.md'),
    '---\nid: "note-resp-002"\ntitle: "아주아주아주아주아주아주 긴 제목의 테스트 노트입니다"\nlinks: []\n---\n\n본문\n',
    'utf-8',
  );

  const env = { ...process.env, MINDMAP_USER_DATA: userData, MINDMAP_WORKSPACE: workspace };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({ args: [join(__dirname, '../dist-electron/main.js')], env });
  const page = await app.firstWindow();

  try {
    await page.waitForSelector('.sidebar', { timeout: 15_000 });

    // Quick Open (⌘P) and Global Search (⌘⇧F) both list the seeded note by title.
    for (const key of ['Meta+p', 'Meta+Shift+F'] as const) {
      await page.keyboard.press(key);
      await page.waitForSelector('.qo-item', { timeout: 5_000 });
      await page.evaluate(() => {
        const modal = document.querySelector('.qo') as HTMLElement | null;
        if (modal) modal.style.width = '180px';
      });
      await page.waitForTimeout(150);
      // .qo-name exists in both the buggy and fixed markup, so this genuinely
      // exercises the regression rather than skipping when the fix's own class is absent.
      const box = await page.locator('.qo-name').first().boundingBox();
      expect(box?.height ?? 0).toBeLessThan(22);
      await page.keyboard.press('Escape');
      await page.waitForTimeout(100);
    }

    // Command Palette (⌘K) items have shorter, fixed labels (e.g. "파일 빠른 열기"),
    // so just confirm the same .qo-name-txt/.qo-name structure holds up narrow too.
    await page.keyboard.press('Meta+k');
    await page.waitForSelector('.qo-item', { timeout: 5_000 });
    await page.evaluate(() => {
      const modal = document.querySelector('.qo') as HTMLElement | null;
      if (modal) modal.style.width = '160px';
    });
    await page.waitForTimeout(150);
    const cmdkBox = await page.locator('.qo-name').first().boundingBox();
    expect(cmdkBox?.height ?? 0).toBeLessThan(22);
  } finally {
    await app.close().catch(() => {});
    rmSync(userData, { recursive: true, force: true });
    rmSync(workspace, { recursive: true, force: true });
  }
});
