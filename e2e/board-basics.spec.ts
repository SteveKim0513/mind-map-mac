import { test, expect, type Page } from '@playwright/test';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { launchApp } from './helpers';

async function newBoard(page: Page): Promise<void> {
  await page.click('.sb-section-btn[title="새 보드"]');
  await page.waitForSelector('.board-canvas', { timeout: 5_000 });
  await page.click('.board-canvas'); // dismiss the inline rename that follows creation
}

test('사이드바에서 새 보드를 만들면 탭과 캔버스가 열린다', { tag: ['@board'] }, async () => {
  const { page, cleanup } = await launchApp();
  try {
    await newBoard(page);
    await expect(page.locator('.tab-title')).toHaveText('제목 없음');
    await expect(page.locator('.board-canvas')).toBeVisible();
    await expect(page.locator('.row .ficon--board')).toHaveCount(1);
  } finally {
    await cleanup();
  }
});

test('툴바에서 스티키노트를 추가하면 캔버스에 표시되고 선택된다', { tag: ['@board'] }, async () => {
  const { page, cleanup } = await launchApp();
  try {
    await newBoard(page);
    await page.click('.tool-btn[title="스티키노트 추가"]');
    await expect(page.locator('.board-el--sticky')).toHaveCount(1);
    await expect(page.locator('.board-el--sticky')).toHaveClass(/selected/);
    // selected → its 4 connector anchors are visible
    await expect(page.locator('.board-anchor')).toHaveCount(4);
  } finally {
    await cleanup();
  }
});

test('스티키노트를 더블클릭하면 편집 모드로 들어가 입력한 내용이 반영된다', { tag: ['@board'] }, async () => {
  const { page, cleanup } = await launchApp();
  try {
    await newBoard(page);
    await page.click('.tool-btn[title="스티키노트 추가"]');
    await page.locator('.board-el--sticky').dblclick();
    await expect(page.locator('.board-el--sticky .board-el-input')).toBeVisible();
    await page.keyboard.type('아이디어 조각');
    await page.click('.board-canvas', { position: { x: 20, y: 20 } }); // blur → commit + exit edit mode
    await expect(page.locator('.board-el--sticky .board-el-text')).toHaveText('아이디어 조각');
  } finally {
    await cleanup();
  }
});

test('스티키노트를 드래그하면 위치가 이동하고, 리사이즈 핸들로 크기를 바꿀 수 있다', { tag: ['@board'] }, async () => {
  const { page, cleanup } = await launchApp();
  try {
    await newBoard(page);
    await page.click('.tool-btn[title="스티키노트 추가"]');
    const sticky = page.locator('.board-el--sticky');
    await expect(sticky).toHaveCount(1);

    const before = await sticky.boundingBox();
    if (!before) throw new Error('요소 위치를 읽지 못함');
    await page.mouse.move(before.x + before.width / 2, before.y + before.height / 2);
    await page.mouse.down();
    await page.mouse.move(before.x + before.width / 2 + 120, before.y + before.height / 2 + 60, { steps: 8 });
    await page.mouse.up();

    const afterMove = await sticky.boundingBox();
    if (!afterMove) throw new Error('요소 위치를 읽지 못함');
    expect(Math.abs(afterMove.x - before.x - 120)).toBeLessThan(10);
    expect(Math.abs(afterMove.y - before.y - 60)).toBeLessThan(10);

    // resize via the SE handle
    const handle = page.locator('.board-handle--se');
    const hBox = await handle.boundingBox();
    if (!hBox) throw new Error('리사이즈 핸들을 찾지 못함');
    await page.mouse.move(hBox.x + hBox.width / 2, hBox.y + hBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(hBox.x + 60, hBox.y + 40, { steps: 6 });
    await page.mouse.up();

    const afterResize = await sticky.boundingBox();
    if (!afterResize) throw new Error('요소 위치를 읽지 못함');
    expect(afterResize.width).toBeGreaterThan(afterMove.width + 30);
    expect(afterResize.height).toBeGreaterThan(afterMove.height + 20);
  } finally {
    await cleanup();
  }
});

test('연결 포인트를 클릭하면 그 방향에 연결된 스티키가 자동으로 생성되고 편집 모드로 들어간다', { tag: ['@board'] }, async () => {
  const { page, cleanup } = await launchApp();
  try {
    await newBoard(page);
    await page.click('.tool-btn[title="스티키노트 추가"]');
    await expect(page.locator('.board-el--sticky')).toHaveCount(1);

    await page.locator('.board-anchor--right').click();
    await expect(page.locator('.board-el--sticky')).toHaveCount(2);
    await expect(page.locator('.board-connector')).toHaveCount(1);
    // the newly-created sticky enters edit mode immediately
    await expect(page.locator('.board-el--sticky .board-el-input')).toBeVisible();
    await page.keyboard.type('다음 생각');
    await page.click('.board-canvas', { position: { x: 20, y: 20 } });
    await expect(page.locator('.board-el--sticky', { hasText: '다음 생각' })).toHaveCount(1);
  } finally {
    await cleanup();
  }
});

test('연결 포인트를 기존 스티키로 드래그하면 새 스티키 없이 둘을 연결한다', { tag: ['@board'] }, async () => {
  const { page, cleanup } = await launchApp();
  try {
    await newBoard(page);
    await page.click('.tool-btn[title="스티키노트 추가"]');
    const first = page.locator('.board-el--sticky').first();
    const firstBox = await first.boundingBox();
    if (!firstBox) throw new Error('요소 위치를 읽지 못함');

    // second sticky, placed well clear of the first (toolbar jitters new drops near viewport center)
    await page.click('.tool-btn[title="스티키노트 추가"]');
    const second = page.locator('.board-el--sticky').nth(1);
    const secondBoxBefore = await second.boundingBox();
    if (!secondBoxBefore) throw new Error('요소 위치를 읽지 못함');
    await page.mouse.move(secondBoxBefore.x + secondBoxBefore.width / 2, secondBoxBefore.y + secondBoxBefore.height / 2);
    await page.mouse.down();
    await page.mouse.move(secondBoxBefore.x + 400, secondBoxBefore.y + 220, { steps: 8 });
    await page.mouse.up();

    // re-select the first sticky so its anchors show, then drag its right anchor onto the second
    await first.click();
    const anchor = page.locator('.board-el--sticky').first().locator('.board-anchor--right');
    const anchorBox = await anchor.boundingBox();
    const secondBox = await second.boundingBox();
    if (!anchorBox || !secondBox) throw new Error('앵커/대상 위치를 읽지 못함');

    await page.mouse.move(anchorBox.x + anchorBox.width / 2, anchorBox.y + anchorBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(secondBox.x + secondBox.width / 2, secondBox.y + secondBox.height / 2, { steps: 10 });
    await page.mouse.up();

    await expect(page.locator('.board-el--sticky')).toHaveCount(2); // no new sticky spawned
    await expect(page.locator('.board-connector')).toHaveCount(1);
  } finally {
    await cleanup();
  }
});

test('스티키를 삭제하면 거기 연결된 화살표도 함께 삭제된다', { tag: ['@board'] }, async () => {
  const { page, cleanup } = await launchApp();
  try {
    await newBoard(page);
    await page.click('.tool-btn[title="스티키노트 추가"]');
    await page.locator('.board-anchor--right').click();
    await expect(page.locator('.board-el--sticky')).toHaveCount(2);
    await expect(page.locator('.board-connector')).toHaveCount(1);

    // the newly-created (2nd) sticky is left selected and in edit mode — exit, then select+delete the FIRST
    await page.click('.board-canvas', { position: { x: 20, y: 20 } });
    await page.locator('.board-el--sticky').first().click();
    await page.keyboard.press('Delete');

    await expect(page.locator('.board-el--sticky')).toHaveCount(1);
    await expect(page.locator('.board-connector')).toHaveCount(0);
  } finally {
    await cleanup();
  }
});

test('스티키를 선택하면 위에 뜨는 메뉴에서 색·모양을 바꿀 수 있고, 상단 태그바 필터를 켜면 다른 색은 흐려진다', { tag: ['@board'] }, async () => {
  const { page, cleanup } = await launchApp();
  try {
    await newBoard(page);
    await page.click('.tool-btn[title="스티키노트 추가"]');
    await expect(page.locator('.sel-toolbar')).toBeVisible(); // selecting/creating shows the floating menu, not a bottom-bar option

    await page.locator('.sel-toolbar .st-btn[title="색 변경"]').click();
    await page.locator('.color-swatch-grid .color-swatch').nth(3).click(); // TAG_KEYS[3] = 'green'
    await page.locator('.sel-toolbar .st-btn[title="모양 변경"]').click();
    await page.locator('.st-swatches .st-btn[title="타원"]').click();
    await expect(page.locator('.board-sticky--ellipse')).toHaveCount(1);

    await page.click('.board-canvas', { position: { x: 20, y: 20 } }); // deselect
    await page.click('.tool-btn[title="스티키노트 추가"]');
    await page.locator('.sel-toolbar .st-btn[title="색 변경"]').click();
    await page.locator('.color-swatch-grid .color-swatch').nth(5).click(); // TAG_KEYS[5] = 'violet'
    await page.click('.board-canvas', { position: { x: 20, y: 20 } });

    // color filter lives in the top TagBar (마인드맵과 동일), not the bottom toolbar
    await expect(page.locator('.tagbar-chip')).toHaveCount(2); // green + violet used
    await page.locator('.tagbar-chip .tagbar-chip-main').first().click();
    await expect(page.locator('.board-el--sticky.dimmed')).toHaveCount(1);
  } finally {
    await cleanup();
  }
});

test('스티키의 텍스트 정렬(좌우·상하)과 서식(크기·굵게)을 바꿀 수 있다', { tag: ['@board'] }, async () => {
  const { page, cleanup } = await launchApp();
  try {
    await newBoard(page);
    await page.click('.tool-btn[title="스티키노트 추가"]');

    await page.locator('.sel-toolbar .st-btn[title="정렬"]').click();
    await page.locator('.st-swatches .st-btn[title="가운데 정렬"]').click();
    await page.locator('.st-swatches .st-btn[title="아래쪽 정렬"]').click();
    await expect(page.locator('.board-el-text-main')).toHaveCSS('text-align', 'center');
    await expect(page.locator('.board-el-text-main')).toHaveClass(/valign-bottom/);

    await page.locator('.sel-toolbar .st-btn[title="글자 서식"]').click();
    await page.locator('.st-swatches .st-btn[title="크게"]').click();
    await page.locator('.st-swatches .st-btn[title="굵게"]').click();
    await page.locator('.board-el--sticky').dblclick();
    await expect(page.locator('.board-el-input')).toHaveCSS('font-weight', '700');
  } finally {
    await cleanup();
  }
});

test('"텍스트 박스 추가"를 여러 번 누르면 스티키 아래에 여러 텍스트 블록이 쌓인다', { tag: ['@board'] }, async () => {
  const { page, cleanup } = await launchApp();
  try {
    await newBoard(page);
    await page.click('.tool-btn[title="스티키노트 추가"]');
    await expect(page.locator('.board-sticky-note')).toHaveCount(0);

    await page.locator('.sel-toolbar .st-btn[title="텍스트 박스 추가"]').click();
    await expect(page.locator('.board-sticky-note .board-el-input')).toBeVisible();
    await page.keyboard.type('세부 항목 1');
    await page.click('.board-canvas', { position: { x: 20, y: 20 } });

    // fused into the sticky, not a separate draggable element
    await expect(page.locator('.board-el')).toHaveCount(1);
    await expect(page.locator('.board-sticky-note')).toHaveCount(1);

    // the button stays available — several notes can stack
    await page.locator('.board-el--sticky').click();
    await page.locator('.sel-toolbar .st-btn[title="텍스트 박스 추가"]').click();
    await page.keyboard.type('세부 항목 2');
    await page.click('.board-canvas', { position: { x: 20, y: 20 } });

    await expect(page.locator('.board-sticky-note')).toHaveCount(2);
    await expect(page.locator('.board-sticky-note').nth(0).locator('.board-el-text')).toHaveText('세부 항목 1');
    await expect(page.locator('.board-sticky-note').nth(1).locator('.board-el-text')).toHaveText('세부 항목 2');

    // each note can be individually removed
    await page.locator('.board-sticky-note').first().hover();
    await page.locator('.board-sticky-note-del').first().click();
    await expect(page.locator('.board-sticky-note')).toHaveCount(1);
    await expect(page.locator('.board-sticky-note .board-el-text')).toHaveText('세부 항목 2');
  } finally {
    await cleanup();
  }
});

test('연결 포인트를 드래그하는 동안 붙을 자리가 미리 표시되고, 화살표는 path로 그려진다', { tag: ['@board'] }, async () => {
  const { page, cleanup } = await launchApp();
  try {
    await newBoard(page);
    await page.click('.tool-btn[title="스티키노트 추가"]');
    const first = page.locator('.board-el--sticky').first();
    const firstBox = await first.boundingBox();
    if (!firstBox) throw new Error('요소 위치를 읽지 못함');

    await page.click('.tool-btn[title="스티키노트 추가"]');
    const second = page.locator('.board-el--sticky').nth(1);
    const secondBoxBefore = await second.boundingBox();
    if (!secondBoxBefore) throw new Error('요소 위치를 읽지 못함');
    await page.mouse.move(secondBoxBefore.x + secondBoxBefore.width / 2, secondBoxBefore.y + secondBoxBefore.height / 2);
    await page.mouse.down();
    await page.mouse.move(secondBoxBefore.x + 350, secondBoxBefore.y + 250, { steps: 8 });
    await page.mouse.up();

    await first.click();
    const anchor = first.locator('.board-anchor--right');
    const anchorBox = await anchor.boundingBox();
    const secondBox = await second.boundingBox();
    if (!anchorBox || !secondBox) throw new Error('앵커/대상 위치를 읽지 못함');

    await page.mouse.move(anchorBox.x + anchorBox.width / 2, anchorBox.y + anchorBox.height / 2);
    await page.mouse.down();
    // move toward (not directly onto) the second sticky, then onto it — proves
    // the snap indicator appears BEFORE mouseup, not just as a result of it
    await page.mouse.move(secondBox.x + secondBox.width / 2, secondBox.y + secondBox.height / 2, { steps: 10 });
    await expect(page.locator('.board-connect-preview')).toBeVisible();
    await expect(second.locator('.board-anchor--snap')).toHaveCount(1);
    await page.mouse.up();

    // the committed connector is rendered as a routed <path>, not a raw <line>
    await expect(page.locator('.board-connector path')).toHaveCount(1);
    await expect(page.locator('.board-connect-preview')).toHaveCount(0); // preview cleared after drop
  } finally {
    await cleanup();
  }
});

test('보드는 저장되고, 닫았다 다시 열어도 내용이 보존된다', { tag: ['@board'] }, async () => {
  const { page, workspace, cleanup } = await launchApp();
  try {
    await newBoard(page);
    await page.click('.tool-btn[title="스티키노트 추가"]');
    await page.locator('.board-el--sticky').dblclick();
    await page.keyboard.type('저장 확인용 메모');
    await page.click('.board-canvas', { position: { x: 20, y: 20 } });
    await page.locator('.board-el--sticky').click();
    await page.locator('.board-anchor--right').click();
    await page.click('.board-canvas', { position: { x: 20, y: 20 } });
    await expect(page.locator('.board-el--sticky')).toHaveCount(2);
    await expect(page.locator('.board-connector')).toHaveCount(1);

    await page.waitForTimeout(1_100); // autosave debounce (1s)

    const boardName = readdirSync(workspace).find((f) => f.endsWith('.board'));
    if (!boardName) throw new Error('.board 파일이 생성되지 않음');
    const doc = JSON.parse(readFileSync(join(workspace, boardName), 'utf-8'));
    expect(doc.version).toBe(1);
    expect(Object.keys(doc.elements)).toHaveLength(3); // 2 stickies + 1 connector
    const stickyEls = Object.values(doc.elements).filter((e) => e.kind === 'sticky');
    const connEls = Object.values(doc.elements).filter((e) => e.kind === 'connector');
    expect(stickyEls).toHaveLength(2);
    expect(connEls).toHaveLength(1);
    expect(stickyEls.some((e) => e.text === '저장 확인용 메모')).toBe(true);
    expect(connEls[0]).toMatchObject({ fromAnchor: 'right' });

    // close the tab, then reopen from the sidebar — proves the load path too
    await page.click('.tab-close');
    await expect(page.locator('.board-canvas')).toHaveCount(0);
    await page.click('.row .ficon--board');
    await expect(page.locator('.board-canvas')).toBeVisible();
    await expect(page.locator('.board-el--sticky')).toHaveCount(2);
    await expect(page.locator('.board-connector')).toHaveCount(1);
    await expect(page.locator('.board-el--sticky .board-el-text', { hasText: '저장 확인용 메모' })).toHaveCount(1);
  } finally {
    await cleanup();
  }
});
