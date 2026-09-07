import { test, expect, type Page } from '@playwright/test';
import { launchApp } from './helpers';

// 2026-09-07 (두 번째 피드백) "정리가 관계도를 오히려 안 보이게 만든다" — 트리
// 전용 BFS 알고리즘을 elkjs의 layered(Sugiyama) 그래프 레이아웃으로 교체.
// "정리"는 이제 비동기(elkjs가 동적 import + Promise로 동작)라 클릭 후 결과를
// 읽기 전에 waitForTimeout이 필요하다.

async function newBoard(page: Page): Promise<void> {
  await page.click('.sb-section-btn[title="새 보드"]');
  await page.waitForSelector('.board-canvas', { timeout: 5_000 });
  await page.click('.board-canvas');
}

/** Adds a named sticky, then drags it to an explicit screen position — new
 *  stickies spawn near the SAME jittered viewport-center spot (board-basics.
 *  spec.ts's own comment: "toolbar jitters new drops near viewport center"),
 *  so two+ created back-to-back can end up stacked and unclickable by name
 *  unless spread apart. */
async function addStickyAt(page: Page, text: string, x: number, y: number): Promise<void> {
  await page.click('.tool-btn[title="스티키노트 추가"]');
  const el = page.locator('.board-el--sticky.selected');
  await el.dblclick();
  await page.keyboard.type(text);
  await page.click('.board-canvas', { position: { x: 20, y: 20 } });
  await page.waitForTimeout(450);

  const box = await page.locator('.board-el--sticky', { hasText: text }).boundingBox();
  if (!box) throw new Error('위치를 읽지 못함');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(x, y, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(200);
}

/** Drags a connector between two named stickies' anchors — same recipe as
 *  board-basics.spec.ts's "연결 포인트를 기존 스티키로 드래그" test. */
async function dragConnect(page: Page, fromSticky: string, side: 'right' | 'left' | 'top' | 'bottom', toSticky: string): Promise<void> {
  await page.locator('.board-el--sticky', { hasText: fromSticky }).click();
  const anchor = page.locator('.board-el--sticky', { hasText: fromSticky }).locator(`.board-anchor--${side}`);
  const anchorBox = await anchor.boundingBox();
  const targetBox = await page.locator('.board-el--sticky', { hasText: toSticky }).boundingBox();
  if (!anchorBox || !targetBox) throw new Error('앵커/대상 위치를 읽지 못함');
  await page.mouse.move(anchorBox.x + anchorBox.width / 2, anchorBox.y + anchorBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(targetBox.x + targetBox.width / 2, targetBox.y + targetBox.height / 2, { steps: 10 });
  await page.mouse.up();
}

test('"정리"를 누르면 (비동기 완료 후) 흩어진 스티키들이 서로 가까워진다', { tag: ['@board'] }, async () => {
  const { page, cleanup } = await launchApp();
  try {
    await newBoard(page);
    const canvasBox = await page.locator('.board-canvas').boundingBox();
    if (!canvasBox) throw new Error('캔버스 위치를 읽지 못함');
    await addStickyAt(page, '루트', canvasBox.x + 300, canvasBox.y + 300);
    await addStickyAt(page, '자식', canvasBox.x + 700, canvasBox.y + 300);
    await dragConnect(page, '루트', 'right', '자식');
    await expect(page.locator('.board-connector')).toHaveCount(1);

    // scatter the child far away
    const child = page.locator('.board-el--sticky', { hasText: '자식' });
    const scattered = await child.boundingBox();
    if (!scattered) throw new Error('위치를 읽지 못함');
    await page.mouse.move(scattered.x + scattered.width / 2, scattered.y + scattered.height / 2);
    await page.mouse.down();
    await page.mouse.move(scattered.x + 700, scattered.y + 500, { steps: 8 });
    await page.mouse.up();
    const before = await child.boundingBox();
    if (!before) throw new Error('위치를 읽지 못함');

    await page.locator('.board-el--sticky', { hasText: '루트' }).click();
    await page.waitForTimeout(450);
    await page.locator('.tool-btn[title*="정리"]').click();
    await page.waitForTimeout(800); // elkjs's dynamic import + layout — async now

    const rootBox = await page.locator('.board-el--sticky', { hasText: '루트' }).boundingBox();
    const after = await child.boundingBox();
    if (!rootBox || !after) throw new Error('위치를 읽지 못함');
    const distBefore = Math.hypot(before.x - rootBox.x, before.y - rootBox.y);
    const distAfter = Math.hypot(after.x - rootBox.x, after.y - rootBox.y);
    expect(distAfter).toBeLessThan(distBefore); // pulled back in from the far-away drop
  } finally {
    await cleanup();
  }
});

test('교차 연결(다이아몬드 구조)을 "정리"해도 모든 스티키가 그대로 남고 사라지지 않는다', { tag: ['@board'] }, async () => {
  const { page, cleanup } = await launchApp();
  try {
    await newBoard(page);
    const canvasBox = await page.locator('.board-canvas').boundingBox();
    if (!canvasBox) throw new Error('캔버스 위치를 읽지 못함');
    // diamond: A→B, A→C, B→D, C→D — D is reachable by two independent paths,
    // exactly the shape the old first-edge-wins tree walk used to break on
    await addStickyAt(page, 'A', canvasBox.x + 300, canvasBox.y + 300);
    await addStickyAt(page, 'B', canvasBox.x + 700, canvasBox.y + 150);
    await addStickyAt(page, 'C', canvasBox.x + 700, canvasBox.y + 450);
    await addStickyAt(page, 'D', canvasBox.x + 1100, canvasBox.y + 300);
    await dragConnect(page, 'A', 'right', 'B');
    await dragConnect(page, 'A', 'right', 'C');
    await dragConnect(page, 'B', 'right', 'D');
    await dragConnect(page, 'C', 'right', 'D');
    await expect(page.locator('.board-connector')).toHaveCount(4);

    await page.locator('.board-el--sticky', { hasText: 'A' }).click();
    await page.waitForTimeout(450);
    await page.locator('.tool-btn[title*="정리"]').click();
    await page.waitForTimeout(800);

    // all 4 stickies and all 4 connectors survived the reorganization
    await expect(page.locator('.board-el--sticky')).toHaveCount(4);
    await expect(page.locator('.board-connector')).toHaveCount(4);
  } finally {
    await cleanup();
  }
});

test('"정리"를 눌러도 선택한 스티키 자신의 위치는 그대로 유지된다', { tag: ['@board'] }, async () => {
  const { page, cleanup } = await launchApp();
  try {
    await newBoard(page);
    const canvasBox = await page.locator('.board-canvas').boundingBox();
    if (!canvasBox) throw new Error('캔버스 위치를 읽지 못함');
    await addStickyAt(page, '루트', canvasBox.x + 300, canvasBox.y + 300);
    await addStickyAt(page, '자식', canvasBox.x + 700, canvasBox.y + 300);
    await dragConnect(page, '루트', 'right', '자식');

    const root = page.locator('.board-el--sticky', { hasText: '루트' });
    await root.click();
    await page.waitForTimeout(450);
    const before = await root.boundingBox();
    if (!before) throw new Error('위치를 읽지 못함');

    await page.locator('.tool-btn[title*="정리"]').click();
    await page.waitForTimeout(800);

    const after = await root.boundingBox();
    if (!after) throw new Error('위치를 읽지 못함');
    expect(Math.abs(after.x - before.x)).toBeLessThan(2);
    expect(Math.abs(after.y - before.y)).toBeLessThan(2);
  } finally {
    await cleanup();
  }
});
