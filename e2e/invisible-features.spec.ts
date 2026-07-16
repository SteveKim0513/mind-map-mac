import { test, expect } from '@playwright/test';
import { readFileSync } from 'fs';
import { join } from 'path';
import { launchApp, writeExternalFile, getSidebarLabels } from './helpers';

// Covers the user-visible "invisible feature" work:
//   IF-06 trash retention toggle, IF-09 system-theme option, IF-04 external-change warning.

const MIND = (topic: string) =>
  JSON.stringify({
    version: 1,
    id: 'm-test',
    rootIds: ['r1'],
    nodes: { r1: { id: 'r1', text: topic, parentId: null, children: [] } },
    view: { zoom: 1, pan: { x: 0, y: 0 } },
  });

test('IF-06 · trash retention toggle (default OFF / opt-in / 3 months) persists', async () => {
  const { page, cleanup } = await launchApp();
  try {
    await page.locator('.sb-foot-btn[title^="휴지통"]').click();
    await page.waitForSelector('.trash-panel');

    const row = page.locator('.trash-retention');
    await expect(row).toBeVisible();
    await expect(row).toContainText('3개월'); // fixed 3-month window
    // default is OFF — auto-purge is destructive, so it must be opt-in (기획서 §6)
    await expect(row.locator('.seg-btn', { hasText: '꺼짐' })).toHaveClass(/on/);

    // turn it ON → reflected in UI and in the IPC-backed setting
    await row.getByRole('button', { name: '켜짐' }).click();
    await expect(row.locator('.seg-btn', { hasText: '켜짐' })).toHaveClass(/on/);
    await expect
      .poll(() => page.evaluate(() => window.api.trashAutoPurgeGet()))
      .toBe(true);
  } finally {
    await cleanup();
  }
});

test('IF-09 · theme offers a system option and follows it', async () => {
  const { page, cleanup } = await launchApp();
  try {
    await page.locator('.sb-foot-btn[title^="설정"]').click();
    await page.waitForSelector('.settings');

    const themeSeg = page.locator('.set-row', { hasText: '테마' }).locator('.seg');
    await expect(themeSeg.getByRole('button', { name: '시스템' })).toBeVisible();

    // pick an explicit mode → data-theme applies
    await themeSeg.getByRole('button', { name: '라이트' }).click();
    await expect
      .poll(() => page.evaluate(() => document.documentElement.dataset.theme))
      .toBe('light');

    // back to system → the preference is persisted as 'system'
    await themeSeg.getByRole('button', { name: '시스템' }).click();
    await expect
      .poll(() => page.evaluate(() => localStorage.getItem('themeMode')))
      .toBe('system');
  } finally {
    await cleanup();
  }
});

test('IF-04 · warns when an open map is changed on disk externally', async () => {
  const { app, page, workspace, cleanup } = await launchApp();
  try {
    // Seed a map file, surface it in the sidebar, then open it (records a baseline).
    writeExternalFile(workspace, '테스트맵.mind', MIND('처음'));
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].blur());
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].focus());
    await expect
      .poll(async () => (await getSidebarLabels(page)).some((l) => l.includes('테스트맵')), { timeout: 5_000 })
      .toBe(true);
    await page.locator('.label', { hasText: '테스트맵' }).first().click();
    await page.waitForSelector('.tab', { timeout: 5_000 });

    // Now something outside the app rewrites the same file (iCloud/other device).
    writeExternalFile(workspace, '테스트맵.mind', MIND('밖에서 바뀜'));

    // Regain focus → the app should offer to reload the disk version.
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].blur());
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].focus());
    await expect(page.locator('.toast', { hasText: '다른 곳에서 바뀌었어요' })).toBeVisible({
      timeout: 5_000,
    });
  } finally {
    await cleanup();
  }
});

test('IF-05 · deleting a node drops the dead link from a note that pointed at it', async () => {
  const { app, page, workspace, cleanup } = await launchApp();
  try {
    // A map with one node, and a (closed) note whose frontmatter links to it.
    writeExternalFile(
      workspace,
      '테스트맵.mind',
      JSON.stringify({
        version: 1,
        id: 'MAP1',
        rootIds: ['N1'],
        nodes: { N1: { id: 'N1', text: '삭제될 노드', parentId: null, children: [] } },
        view: { zoom: 1, pan: { x: 0, y: 0 } },
      }),
    );
    writeExternalFile(
      workspace,
      '연결노트.md',
      ['---', 'id: "note-1"', 'title: "연결노트"', 'links: [{"mapId":"MAP1","nodeId":"N1","nodeText":"삭제될 노드"}]', '---', '', '본문'].join('\n'),
    );

    // Surface both files (tree + note index rebuild on focus).
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].blur());
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].focus());
    await expect
      .poll(async () => (await getSidebarLabels(page)).some((l) => l.includes('테스트맵')), { timeout: 5_000 })
      .toBe(true);

    // sanity: the note file starts with the link
    expect(readFileSync(join(workspace, '연결노트.md'), 'utf-8')).toContain('"nodeId":"N1"');

    // Open the map, select the node, delete it.
    await page.locator('.label', { hasText: '테스트맵' }).first().click();
    const node = page.locator('.node', { hasText: '삭제될 노드' });
    await node.click();
    await page.keyboard.press('Delete');
    await expect(node).toHaveCount(0);

    // The note's dead link is cleaned up on disk (fire-and-forget GC).
    await expect
      .poll(() => readFileSync(join(workspace, '연결노트.md'), 'utf-8').includes('"nodeId":"N1"'), {
        timeout: 5_000,
      })
      .toBe(false);
  } finally {
    await cleanup();
  }
});

test('IF-05 · editing a node text refreshes the cached label in a linked note', async () => {
  const { app, page, workspace, cleanup } = await launchApp();
  try {
    writeExternalFile(
      workspace,
      '맵.mind',
      JSON.stringify({
        version: 1,
        id: 'MAP2',
        rootIds: ['N1'],
        nodes: { N1: { id: 'N1', text: '원래 이름', parentId: null, children: [] } },
        view: { zoom: 1, pan: { x: 0, y: 0 } },
      }),
    );
    writeExternalFile(
      workspace,
      '레이블노트.md',
      ['---', 'id: "note-2"', 'title: "레이블노트"', 'links: [{"mapId":"MAP2","nodeId":"N1","nodeText":"원래 이름"}]', '---', '', '본문'].join('\n'),
    );

    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].blur());
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].focus());
    await expect
      .poll(async () => (await getSidebarLabels(page)).some((l) => l === '맵'), { timeout: 5_000 })
      .toBe(true);

    await page.locator('.label', { hasText: '맵' }).first().click();
    const node = page.locator('.node', { hasText: '원래 이름' });
    await node.dblclick();
    await page.waitForSelector('.editing-text', { timeout: 3_000 });
    await page.keyboard.press('Meta+A');
    await page.keyboard.type('새 이름');
    await page.keyboard.press('Enter');
    await expect(page.locator('.node', { hasText: '새 이름' })).toBeVisible();

    // the note's cached chip label follows the rename on disk
    await expect
      .poll(() => readFileSync(join(workspace, '레이블노트.md'), 'utf-8').includes('"nodeText":"새 이름"'), {
        timeout: 5_000,
      })
      .toBe(true);
  } finally {
    await cleanup();
  }
});

test('IF-08 · "겹침 정돈" pushes overlapping root subtrees apart', async () => {
  const { app, page, workspace, cleanup } = await launchApp();
  try {
    // Two roots dropped almost on top of each other (overlapping manualPos).
    writeExternalFile(
      workspace,
      '겹침맵.mind',
      JSON.stringify({
        version: 1,
        id: 'MAP3',
        rootIds: ['A', 'B'],
        nodes: {
          A: { id: 'A', text: '가지 하나', parentId: null, children: [], manualPos: { x: 0, y: 0 } },
          B: { id: 'B', text: '가지 둘', parentId: null, children: [], manualPos: { x: 0, y: 8 } },
        },
        view: { zoom: 1, pan: { x: 0, y: 0 } },
      }),
    );
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].blur());
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].focus());
    await expect
      .poll(async () => (await getSidebarLabels(page)).some((l) => l === '겹침맵'), { timeout: 5_000 })
      .toBe(true);

    await page.locator('.label', { hasText: '겹침맵' }).first().click();
    await page.waitForSelector('.node', { timeout: 5_000 });

    // ⌘K → 겹침 정돈
    await page.keyboard.press('Meta+k');
    await page.waitForSelector('.qo-input', { timeout: 3_000 });
    await page.fill('.qo-input', '겹침 정돈');
    await page.click('.qo-item:has-text("겹침 정돈")');
    await expect(page.locator('.toast', { hasText: '정돈' })).toBeVisible({ timeout: 3_000 });

    // The moved root is pushed down and persisted — the two roots are separated.
    await expect
      .poll(() => {
        const doc = JSON.parse(readFileSync(join(workspace, '겹침맵.mind'), 'utf-8'));
        return doc.nodes.B.manualPos.y - doc.nodes.A.manualPos.y;
      }, { timeout: 5_000 })
      .toBeGreaterThan(40);
  } finally {
    await cleanup();
  }
});
