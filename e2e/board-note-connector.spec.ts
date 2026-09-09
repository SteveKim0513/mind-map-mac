import { test, expect, type Page } from '@playwright/test';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { launchApp } from './helpers';

// 2026-09-09 "화살표 연결을 스티키 노트 밑에 추가된 노트로도 연결 가능하게
// 해줘" — a sticky's fused "텍스트 박스 추가" note blocks (BoardStickyElement.
// notes[], stacked below the main card) can now be a connector endpoint too,
// not just the sticky's own main card.

async function newBoard(page: Page): Promise<void> {
  await page.click('.sb-section-btn[title="새 보드"]');
  await page.waitForSelector('.board-canvas', { timeout: 5_000 });
  await page.click('.board-canvas'); // dismiss the inline rename that follows creation
}

async function readSavedBoard(workspace: string): Promise<{ elements: Record<string, { kind: string; fromNoteIndex?: number; toNoteIndex?: number }> }> {
  const boardName = readdirSync(workspace).find((f) => f.endsWith('.board'));
  if (!boardName) throw new Error('.board 파일이 생성되지 않음');
  return JSON.parse(readFileSync(join(workspace, boardName), 'utf-8'));
}

test('스티키 아래 텍스트 박스(추가된 노트)의 연결점을 클릭하면 거기서 연결된 새 스티키가 생긴다', { tag: ['@board'] }, async () => {
  const { page, workspace, cleanup } = await launchApp();
  try {
    await newBoard(page);
    await page.click('.tool-btn[title="스티키노트 추가"]');
    await page.locator('.sel-toolbar .st-btn[title="텍스트 박스 추가"]').click();
    await page.locator('.board-sticky-note .board-el-input').fill('세부 항목');
    await page.click('.board-canvas', { position: { x: 20, y: 20 } }); // blur, then re-select
    await page.locator('.board-el--sticky').click();

    // the note box carries its own 4 anchors, distinct from the main card's
    const noteAnchor = page.locator('.board-sticky-note').locator('.board-anchor--right');
    await expect(noteAnchor).toHaveCount(1);
    await noteAnchor.click(); // plain click (no drag) — spawns a connected child sticky

    await expect(page.locator('.board-el--sticky')).toHaveCount(2);
    await expect(page.locator('.board-connector')).toHaveCount(1);
    await page.click('.board-canvas', { position: { x: 20, y: 20 } });
    await page.waitForTimeout(1_100); // autosave debounce

    const doc = await readSavedBoard(workspace);
    const conn = Object.values(doc.elements).find((e) => e.kind === 'connector')!;
    expect(conn.fromNoteIndex).toBe(0); // attached to the note, not the main card
    expect(conn.toNoteIndex).toBeUndefined(); // the new sticky's own main card
  } finally {
    await cleanup();
  }
});

test('화살표를 다른 스티키의 텍스트 박스 위로 드래그하면 그 텍스트 박스에 붙는다(메인 카드가 아니라)', { tag: ['@board'] }, async () => {
  const { page, workspace, cleanup } = await launchApp();
  try {
    await newBoard(page);
    await page.click('.tool-btn[title="스티키노트 추가"]');
    const first = page.locator('.board-el--sticky').first();

    await page.click('.tool-btn[title="스티키노트 추가"]');
    const second = page.locator('.board-el--sticky').nth(1);
    const secondBoxBefore = await second.boundingBox();
    if (!secondBoxBefore) throw new Error('요소 위치를 읽지 못함');
    // drag it clear of the first sticky, then give it a note box
    await page.mouse.move(secondBoxBefore.x + secondBoxBefore.width / 2, secondBoxBefore.y + secondBoxBefore.height / 2);
    await page.mouse.down();
    await page.mouse.move(secondBoxBefore.x + 350, secondBoxBefore.y + 250, { steps: 8 });
    await page.mouse.up();
    await second.click();
    await page.locator('.sel-toolbar .st-btn[title="텍스트 박스 추가"]').click();
    await page.locator('.board-sticky-note .board-el-input').fill('세부 항목');
    await page.click('.board-canvas', { position: { x: 20, y: 20 } });

    await first.click();
    const anchor = first.locator('.board-anchor--right');
    const anchorBox = await anchor.boundingBox();
    const noteBox = await second.locator('.board-sticky-note').boundingBox();
    if (!anchorBox || !noteBox) throw new Error('앵커/텍스트 박스 위치를 읽지 못함');

    await page.mouse.move(anchorBox.x + anchorBox.width / 2, anchorBox.y + anchorBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(noteBox.x + noteBox.width / 2, noteBox.y + noteBox.height / 2, { steps: 10 });
    // the snap indicator lands on the NOTE's own anchor, not the sticky's main card
    await expect(second.locator('.board-sticky-note').locator('.board-anchor--snap')).toHaveCount(1);
    await page.mouse.up();

    await expect(page.locator('.board-connector path')).toHaveCount(1);
    await page.waitForTimeout(1_100); // autosave debounce

    const doc = await readSavedBoard(workspace);
    const conn = Object.values(doc.elements).find((e) => e.kind === 'connector')!;
    expect(conn.fromNoteIndex).toBeUndefined(); // from the first sticky's main card
    expect(conn.toNoteIndex).toBe(0); // to the second sticky's note box
  } finally {
    await cleanup();
  }
});
