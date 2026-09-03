import { test, expect, type Page } from '@playwright/test';
import { launchApp } from './helpers';

async function newBoard(page: Page): Promise<void> {
  await page.click('.sb-section-btn[title="새 보드"]');
  await page.waitForSelector('.board-canvas', { timeout: 5_000 });
  await page.click('.board-canvas'); // dismiss the inline rename that follows creation
}

async function addAndNameSticky(page: Page, text: string): Promise<void> {
  await page.click('.tool-btn[title="스티키노트 추가"]');
  await page.locator('.board-el--sticky').dblclick();
  await page.keyboard.type(text);
  await page.click('.board-canvas', { position: { x: 20, y: 20 } }); // blur → commit
  await page.waitForTimeout(450); // clear the 400ms double-click window before any re-click
}

test('선택한 스티키에서 방향키를 누르면 그 방향에 연결된 스티키를 만들고, 이미 있으면 그리로 이동한다', { tag: ['@board'] }, async () => {
  const { page, cleanup } = await launchApp();
  try {
    await newBoard(page);
    await addAndNameSticky(page, '루트');
    await page.locator('.board-el--sticky', { hasText: '루트' }).click();
    await page.waitForTimeout(450);

    await page.keyboard.press('ArrowRight');
    await expect(page.locator('.board-el--sticky')).toHaveCount(2);
    // the created sticky enters edit mode immediately, same as an anchor click
    await expect(page.locator('.board-el-input')).toBeVisible();
    await page.keyboard.type('오른쪽');
    await page.click('.board-canvas', { position: { x: 20, y: 20 } });
    await page.waitForTimeout(450);

    // pressing the SAME direction again from the root navigates to the
    // existing child instead of creating a duplicate
    await page.locator('.board-el--sticky', { hasText: '루트' }).click();
    await page.waitForTimeout(450);
    await page.keyboard.press('ArrowRight');
    await expect(page.locator('.board-el--sticky')).toHaveCount(2);
    await expect(page.locator('.board-el--sticky.selected', { hasText: '오른쪽' })).toHaveCount(1);

    // a different direction still creates a new child
    await page.locator('.board-el--sticky', { hasText: '루트' }).click();
    await page.waitForTimeout(450);
    await page.keyboard.press('ArrowDown');
    await page.keyboard.type('아래');
    await page.click('.board-canvas', { position: { x: 20, y: 20 } });
    await expect(page.locator('.board-el--sticky')).toHaveCount(3);
    await expect(page.locator('.board-connector')).toHaveCount(2);
  } finally {
    await cleanup();
  }
});

test('선택한 스티키에서 Enter를 누르면 편집 모드로 들어간다', { tag: ['@board'] }, async () => {
  const { page, cleanup } = await launchApp();
  try {
    await newBoard(page);
    await addAndNameSticky(page, '메모');
    await page.locator('.board-el--sticky').click();
    await page.waitForTimeout(450);
    await page.keyboard.press('Enter');
    await expect(page.locator('.board-el-input')).toBeVisible();
  } finally {
    await cleanup();
  }
});

test('"정리"를 누르면 선택한 스티키에서 연결된 자식들이 옆 열로 가지런히 재배치된다', { tag: ['@board'] }, async () => {
  const { page, cleanup } = await launchApp();
  try {
    await newBoard(page);
    await addAndNameSticky(page, '루트');
    await page.locator('.board-el--sticky', { hasText: '루트' }).click();
    await page.waitForTimeout(450);
    await page.keyboard.press('ArrowRight');
    await page.keyboard.type('자식');
    await page.click('.board-canvas', { position: { x: 20, y: 20 } });
    await page.waitForTimeout(450);

    // drag the child far away from its auto-created spot
    const child = page.locator('.board-el--sticky', { hasText: '자식' });
    const before = await child.boundingBox();
    if (!before) throw new Error('위치를 읽지 못함');
    await page.mouse.move(before.x + before.width / 2, before.y + before.height / 2);
    await page.mouse.down();
    await page.mouse.move(before.x + 600, before.y + 500, { steps: 8 });
    await page.mouse.up();
    const moved = await child.boundingBox();
    if (!moved) throw new Error('위치를 읽지 못함');
    expect(Math.abs(moved.x - before.x)).toBeGreaterThan(400);

    await page.locator('.board-el--sticky', { hasText: '루트' }).click();
    await page.waitForTimeout(450);
    const tidyBtn = page.locator('.tool-btn[title*="정리"]');
    await expect(tidyBtn).toBeEnabled();
    await tidyBtn.click();

    const tidied = await child.boundingBox();
    if (!tidied) throw new Error('위치를 읽지 못함');
    // back to (roughly) one column over from the root, not the far-away drop spot
    expect(Math.abs(tidied.x - moved.x)).toBeGreaterThan(300);
  } finally {
    await cleanup();
  }
});

test('정리 버튼은 연결이 없는 스티키를 선택하면 비활성화된다', { tag: ['@board'] }, async () => {
  const { page, cleanup } = await launchApp();
  try {
    await newBoard(page);
    await addAndNameSticky(page, '외톨이');
    await page.locator('.board-el--sticky').click();
    await page.waitForTimeout(200);
    await expect(page.locator('.tool-btn[title*="정리"]')).toBeEnabled(); // enabled: it IS a sticky, tidy just no-ops with no edges

    // deselect entirely → disabled
    await page.click('.board-canvas', { position: { x: 20, y: 20 } });
    await expect(page.locator('.tool-btn[title*="정리"]')).toBeDisabled();
  } finally {
    await cleanup();
  }
});

test('여러 스티키를 함께 선택하면 플로팅 메뉴가 한 번에 모두에 적용된다', { tag: ['@board'] }, async () => {
  const { page, cleanup } = await launchApp();
  try {
    await newBoard(page);
    await page.click('.tool-btn[title="스티키노트 추가"]');
    await page.waitForTimeout(200);
    await page.click('.board-canvas', { position: { x: 20, y: 20 } });
    await page.waitForTimeout(200);
    await page.click('.tool-btn[title="스티키노트 추가"]');
    await expect(page.locator('.board-el--sticky')).toHaveCount(2);
    await page.waitForTimeout(200);

    // marquee-select both (generous margin past the canvas edges so a sticky
    // spawned near the viewport edge is never juuust outside the drag rect)
    const canvasBox = await page.locator('.board-canvas').boundingBox();
    if (!canvasBox) throw new Error('캔버스 위치를 읽지 못함');
    await page.mouse.move(canvasBox.x + 2, canvasBox.y + 2);
    await page.mouse.down();
    await page.mouse.move(canvasBox.x + canvasBox.width / 2, canvasBox.y + canvasBox.height / 2, { steps: 6 });
    await page.mouse.move(canvasBox.x + canvasBox.width - 2, canvasBox.y + canvasBox.height - 2, { steps: 6 });
    await page.mouse.up();
    await expect(page.locator('.board-el--sticky.selected')).toHaveCount(2);
    await expect(page.locator('.sel-toolbar')).toBeVisible();

    // single-selection-only actions are hidden during bulk edit
    await expect(page.locator('.sel-toolbar .st-btn[title="텍스트 박스 추가"]')).toHaveCount(0);
    await expect(page.locator('.sel-toolbar .st-btn[title="연동"]')).toHaveCount(0);

    const yellowBefore = await page.locator('.board-sticky').first().evaluate((e) => getComputedStyle(e).backgroundColor);

    await page.locator('.sel-toolbar .st-btn[title="색 변경"]').click();
    await expect(page.locator('.st-swatches')).toBeVisible();
    await page.locator('.color-swatch-grid .color-swatch').nth(3).click();
    await page.waitForTimeout(200);

    const colors = await page.locator('.board-sticky').evaluateAll((els) => els.map((e) => getComputedStyle(e).backgroundColor));
    expect(colors[0]).toBe(colors[1]); // both got the SAME bulk-applied color
    expect(colors[0]).not.toBe(yellowBefore); // and it actually changed, not a no-op
  } finally {
    await cleanup();
  }
});

test('화살표를 선택하면 라벨을 붙일 수 있고, 경로 중간에 표시된다', { tag: ['@board'] }, async () => {
  const { page, cleanup } = await launchApp();
  try {
    await newBoard(page);
    await addAndNameSticky(page, '루트');
    await page.locator('.board-el--sticky', { hasText: '루트' }).click();
    await page.waitForTimeout(450);
    await page.keyboard.press('ArrowRight');
    await page.keyboard.type('자식');
    await page.click('.board-canvas', { position: { x: 20, y: 20 } });
    await page.waitForTimeout(300);

    await page.locator('.board-connector path').click({ force: true });
    await expect(page.locator('.board-label-chip.ghost')).toHaveCount(1); // add-label affordance, no text yet

    await page.keyboard.press('Enter');
    await expect(page.locator('.board-label-input')).toBeVisible();
    await page.keyboard.type('왜냐하면');
    await page.keyboard.press('Enter');

    await expect(page.locator('.board-label-chip', { hasText: '왜냐하면' })).toHaveCount(1);
    await expect(page.locator('.board-label-chip.ghost')).toHaveCount(0);
  } finally {
    await cleanup();
  }
});

test('화살표를 선택하면 양 끝에 손잡이가 보이고, 드래그해서 다른 스티키로 재연결할 수 있다', { tag: ['@board'] }, async () => {
  const { page, cleanup } = await launchApp();
  try {
    await newBoard(page);
    await addAndNameSticky(page, '루트');
    await page.locator('.board-el--sticky', { hasText: '루트' }).click();
    await page.waitForTimeout(450);
    await page.keyboard.press('ArrowRight');
    await page.keyboard.type('원래대상');
    await page.click('.board-canvas', { position: { x: 20, y: 20 } });
    await page.waitForTimeout(450);

    // a third sticky, dragged well clear of the connector's path (but not so far
    // it ends up under the tab/path/tag bars at the very top of the window —
    // clicking a connector whose route passes behind that chrome is unreliable)
    await page.click('.tool-btn[title="스티키노트 추가"]');
    const third = page.locator('.board-el--sticky').last();
    const thirdBefore = await third.boundingBox();
    if (!thirdBefore) throw new Error('위치를 읽지 못함');
    await page.mouse.move(thirdBefore.x + thirdBefore.width / 2, thirdBefore.y + thirdBefore.height / 2);
    await page.mouse.down();
    await page.mouse.move(thirdBefore.x + 500, thirdBefore.y + 250, { steps: 8 });
    await page.mouse.up();
    await page.waitForTimeout(200);

    await page.locator('.board-connector path').click({ force: true });
    await expect(page.locator('.board-connector-endpoint')).toHaveCount(2);

    const toEndpoint = page.locator('.board-connector-endpoint').nth(1); // the 'to' end (at 원래대상)
    const epBox = await toEndpoint.boundingBox();
    const thirdBox = await third.boundingBox();
    if (!epBox || !thirdBox) throw new Error('위치를 읽지 못함');
    await page.mouse.move(epBox.x + epBox.width / 2, epBox.y + epBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(thirdBox.x + thirdBox.width / 2, thirdBox.y + thirdBox.height / 2, { steps: 10 });
    await page.mouse.up();

    // still exactly one connector, no new sticky spawned by the drop
    await expect(page.locator('.board-connector')).toHaveCount(1);
    await expect(page.locator('.board-el--sticky')).toHaveCount(3);

    // the connector stays selected after a successful reattach (nothing clears
    // selection on drop) — reuse that instead of re-clicking its now-different,
    // re-routed path, which is just as unreliable to blind-click as the original
    await expect(page.locator('.board-connector-endpoint')).toHaveCount(2);
    const toEndpoint2 = page.locator('.board-connector-endpoint').nth(1);
    const epBox2 = await toEndpoint2.boundingBox();
    if (!epBox2) throw new Error('위치를 읽지 못함');
    await page.mouse.move(epBox2.x + epBox2.width / 2, epBox2.y + epBox2.height / 2);
    await page.mouse.down();
    await page.mouse.move(epBox2.x + 350, epBox2.y + 250, { steps: 6 }); // empty canvas, far from any sticky
    await page.mouse.up();
    await expect(page.locator('.board-connector')).toHaveCount(1);
    await expect(page.locator('.board-el--sticky')).toHaveCount(3); // no implicit spawn, unlike a fresh anchor drag
  } finally {
    await cleanup();
  }
});

test('스티키를 마인드맵 노드에 연동하면 카드에 칩이 뜨고, 누르면 그 노드로 이동한다', { tag: ['@board'] }, async () => {
  const { page, cleanup } = await launchApp();
  try {
    // a mindmap with one node to link against
    await page.click('.sb-section-btn[title="새 마인드맵"]');
    await page.waitForSelector('.canvas', { timeout: 10_000 });
    await page.click('.canvas');
    await page.keyboard.press('Enter');
    await page.waitForSelector('.editing-text', { timeout: 3_000 });
    await page.keyboard.type('연동 대상 노드');
    await page.keyboard.press('Enter');

    await newBoard(page);
    await page.click('.tool-btn[title="스티키노트 추가"]');
    await page.waitForTimeout(200);
    await page.locator('.board-el--sticky').click();
    await page.waitForTimeout(450);

    await page.locator('.sel-toolbar .st-btn[title="연동"]').click();
    await page.locator('.sel-toolbar .st-link-row', { hasText: '노드 연결' }).click();
    await expect(page.locator('.picker-item', { hasText: '연동 대상 노드' })).toBeVisible();
    await page.keyboard.press('Enter'); // pick the (only, already-active) result

    const chip = page.locator('.board-sticky-link', { hasText: '연동 대상 노드' });
    await expect(chip).toHaveCount(1);

    await chip.click();
    await expect(page.locator('.canvas')).toBeVisible();
    await expect(page.locator('.node.selected', { hasText: '연동 대상 노드' })).toHaveCount(1);
  } finally {
    await cleanup();
  }
});

test('노드 연결을 해제하면 칩이 사라진다', { tag: ['@board'] }, async () => {
  const { page, cleanup } = await launchApp();
  try {
    await page.click('.sb-section-btn[title="새 마인드맵"]');
    await page.waitForSelector('.canvas', { timeout: 10_000 });
    await page.click('.canvas');
    await page.keyboard.press('Enter');
    await page.waitForSelector('.editing-text', { timeout: 3_000 });
    await page.keyboard.type('노드');
    await page.keyboard.press('Enter');

    await newBoard(page);
    await page.click('.tool-btn[title="스티키노트 추가"]');
    await page.waitForTimeout(200);
    await page.locator('.board-el--sticky').click();
    await page.waitForTimeout(450);
    await page.locator('.sel-toolbar .st-btn[title="연동"]').click();
    await page.locator('.sel-toolbar .st-link-row', { hasText: '노드 연결' }).click();
    await expect(page.locator('.picker-item', { hasText: '노드' })).toBeVisible();
    await page.keyboard.press('Enter');
    await expect(page.locator('.board-sticky-link')).toHaveCount(1);

    await page.locator('.board-sticky-link-x').click();
    await expect(page.locator('.board-sticky-link')).toHaveCount(0);
  } finally {
    await cleanup();
  }
});

test('보드는 화살표 라벨과 노드 연결을 저장하고, 다시 열어도 보존된다', { tag: ['@board'] }, async () => {
  const { page, cleanup } = await launchApp();
  try {
    await page.click('.sb-section-btn[title="새 마인드맵"]');
    await page.waitForSelector('.canvas', { timeout: 10_000 });
    await page.click('.canvas');
    await page.keyboard.press('Enter');
    await page.waitForSelector('.editing-text', { timeout: 3_000 });
    await page.keyboard.type('저장 확인 노드');
    await page.keyboard.press('Enter');

    await newBoard(page);
    await addAndNameSticky(page, '루트');
    await page.locator('.board-el--sticky', { hasText: '루트' }).click();
    await page.waitForTimeout(450);
    await page.keyboard.press('ArrowRight');
    await page.keyboard.type('자식');
    await page.click('.board-canvas', { position: { x: 20, y: 20 } });
    await page.waitForTimeout(300);

    await page.locator('.board-connector path').click({ force: true });
    await page.keyboard.press('Enter');
    await page.keyboard.type('저장 라벨');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(200);

    await page.locator('.board-el--sticky', { hasText: '루트' }).click();
    await page.waitForTimeout(450);
    await page.locator('.sel-toolbar .st-btn[title="연동"]').click();
    await page.locator('.sel-toolbar .st-link-row', { hasText: '노드 연결' }).click();
    await expect(page.locator('.picker-item', { hasText: '저장 확인 노드' })).toBeVisible();
    await page.keyboard.press('Enter');
    await expect(page.locator('.board-sticky-link')).toHaveCount(1);

    await page.waitForTimeout(1_100); // autosave debounce

    await page.click('.tab.active .tab-close'); // two tabs are open (map + board) — close the active (board) one specifically
    await expect(page.locator('.board-canvas')).toHaveCount(0);
    await page.click('.row .ficon--board');
    await expect(page.locator('.board-canvas')).toBeVisible();

    await expect(page.locator('.board-label-chip', { hasText: '저장 라벨' })).toHaveCount(1);
    await expect(page.locator('.board-sticky-link', { hasText: '저장 확인 노드' })).toHaveCount(1);
  } finally {
    await cleanup();
  }
});
