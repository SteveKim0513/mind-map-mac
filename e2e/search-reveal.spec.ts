import { test, expect, type Page } from '@playwright/test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launchApp } from './helpers';

// Global search → the opened file shows where the query hit, scrolls to it and
// steps through repeats (spec 2026-10-29-search-reveal-match).
//
// Files are written BEFORE launch (fresh userData + workspace via `reuse`) so the
// sidebar tree — which global search reads — has them from the start, with no
// autosave or focus-refresh timing involved.

const WORD = '찾을단어';

/** A long note: three hits far apart, so reaching the later ones needs scrolling. */
function longNote(): string {
  const filler = (n: number) => Array.from({ length: n }, (_, i) => `채우는 문단 ${i + 1}.`).join('\n\n');
  const body = [`첫 ${WORD} 여기.`, filler(40), `두 번째 ${WORD} 여기.`, filler(40), `마지막 ${WORD}.`].join('\n\n');
  return ['---', 'id: "note-sr"', 'title: "검색이동노트"', 'links: []', '---', '', body].join('\n');
}

/** root → 접힌가지 (collapsed) → hidden target; plus a visible second hit. */
function mapWithCollapsedHit(): string {
  const node = (id: string, text: string, parentId: string | null, children: string[], collapsed = false) => ({
    id,
    text,
    parentId,
    children,
    collapsed,
  });
  return JSON.stringify({
    version: 1,
    id: 'MAP-SR',
    rootIds: ['R'],
    nodes: {
      R: node('R', '루트', null, ['A', 'C']),
      A: node('A', '접힌가지', 'R', ['B'], true),
      B: node('B', `숨은 ${WORD}`, 'A', []),
      C: node('C', `보이는 ${WORD}`, 'R', []),
    },
    view: { zoom: 1, pan: { x: 0, y: 0 } },
  });
}

async function launchWith(files: Record<string, string>) {
  const userData = mkdtempSync(join(tmpdir(), 'mindmap-userData-'));
  const workspace = mkdtempSync(join(tmpdir(), 'mindmap-ws-'));
  for (const [name, content] of Object.entries(files)) writeFileSync(join(workspace, name), content, 'utf-8');
  const handle = await launchApp({ reuse: { userData, workspace } });
  return {
    app: handle.app,
    page: handle.page,
    cleanup: async () => {
      await handle.cleanup(); // quits the app only (reuse)
      rmSync(userData, { recursive: true, force: true });
      rmSync(workspace, { recursive: true, force: true });
    },
  };
}

async function pickGlobalResult(page: Page, query: string, label: string) {
  await page.keyboard.press('Meta+Shift+F');
  await page.waitForSelector('.gs', { timeout: 5_000 });
  await page.fill('.qo-input', query);
  const hit = page.locator('.qo-item', { hasText: label }).first();
  await expect(hit).toBeVisible({ timeout: 5_000 });
  await hit.click();
}

test('전체 검색에서 노트를 고르면 일치를 모두 강조하고 첫 일치로 스크롤하며, Enter/⇧Enter로 오가고 Esc로 닫힌다', { tag: ['@note', '@nav'] }, async () => {
  const { page, cleanup } = await launchWith({ '검색이동노트.md': longNote() });
  try {
    await pickGlobalResult(page, WORD, '검색이동노트');

    const bar = page.getByTestId('note-find');
    const count = page.getByTestId('note-find-count');
    await expect(bar).toBeVisible({ timeout: 5_000 });
    await expect(bar.locator('input')).toHaveValue(WORD);
    await expect(count).toHaveText('1/3');
    await expect(page.locator('.note-rich .search-hit')).toHaveCount(3);
    const active = page.locator('.note-rich .search-hit-active');
    await expect(active).toHaveCount(1);
    await expect(active).toBeInViewport();

    // the input has focus → Enter goes to the next hit, which is far below
    await page.keyboard.press('Enter');
    await expect(count).toHaveText('2/3');
    await expect(active).toHaveText(WORD);
    await expect(active).toBeInViewport();
    await expect(page.locator('.note-rich p', { hasText: `두 번째 ${WORD}` }).locator('.search-hit-active')).toHaveCount(1);

    await page.keyboard.press('Enter');
    await expect(count).toHaveText('3/3');
    await page.keyboard.press('Enter'); // wraps around
    await expect(count).toHaveText('1/3');
    await page.keyboard.press('Shift+Enter'); // and back
    await expect(count).toHaveText('3/3');
    await expect(active).toBeInViewport();

    // typing a new query re-searches in place
    await bar.locator('input').fill('채우는 문단 7.');
    await expect(count).toHaveText('1/2'); // "7." in both filler runs

    await page.keyboard.press('Escape');
    await expect(bar).toBeHidden();
    await expect(page.locator('.note-rich .search-hit')).toHaveCount(0);
  } finally {
    await cleanup();
  }
});

test('노트에서 ⌘F(메뉴 찾기)는 전체 검색이 아니라 노트 안 찾기 바를 연다', { tag: ['@note', '@nav'] }, async () => {
  const { app, page, cleanup } = await launchWith({ '검색이동노트.md': longNote() });
  try {
    await page.locator('.label', { hasText: '검색이동노트' }).first().click();
    await page.waitForSelector('.note-rich .ProseMirror', { timeout: 5_000 });

    // ⌘F is a native menu accelerator, which Playwright input can't press — drive
    // the same IPC the menu sends (flow-moves.spec.ts strategy).
    await app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.webContents.send('menu', 'find');
    });
    const bar = page.getByTestId('note-find');
    await expect(bar).toBeVisible({ timeout: 5_000 });
    await expect(page.locator('.gs')).toHaveCount(0);
    await expect(bar.locator('input')).toBeFocused();

    await page.keyboard.type(WORD);
    await expect(page.getByTestId('note-find-count')).toHaveText('1/3');
    await expect(page.locator('.note-rich .search-hit')).toHaveCount(3);
  } finally {
    await cleanup();
  }
});

test('전체 검색에서 접힌 가지 아래 노드를 고르면 가지를 펼쳐 보여 주고, 맵 찾기 바가 검색어를 이어받아 다음 일치로 갈 수 있다', { tag: ['@map', '@nav'] }, async () => {
  const { page, cleanup } = await launchWith({ '검색이동맵.mind': mapWithCollapsedHit() });
  try {
    await pickGlobalResult(page, WORD, `숨은 ${WORD}`);

    // the hidden node is laid out (its branch was expanded) and is the current match
    const hidden = page.locator('.node[data-node-id="B"]');
    await expect(hidden).toBeVisible({ timeout: 5_000 });
    await expect(hidden).toHaveClass(/active-match/);
    await expect(hidden).toBeInViewport();

    const bar = page.locator('.search');
    await expect(bar.locator('input')).toHaveValue(WORD);
    await expect(page.locator('.node.match')).toHaveCount(2);

    await page.keyboard.press('Enter');
    await expect(page.locator('.node[data-node-id="C"]')).toHaveClass(/active-match/);
    await expect(hidden).not.toHaveClass(/active-match/);
  } finally {
    await cleanup();
  }
});
