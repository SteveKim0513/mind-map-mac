import { test, expect, type Page } from '@playwright/test';
import { launchApp } from './helpers';

// 2026-09-07 실사용 피드백(스크린샷 2건 + 추가 3건)에 대한 회귀 테스트.

async function newBoard(page: Page): Promise<void> {
  await page.click('.sb-section-btn[title="새 보드"]');
  await page.waitForSelector('.board-canvas', { timeout: 5_000 });
  await page.click('.board-canvas');
}

test('노드 연결 피커 검색창에서 백스페이스를 눌러도 스티키가 삭제되지 않는다', { tag: ['@board'] }, async () => {
  const { page, cleanup } = await launchApp();
  try {
    await newBoard(page);
    await page.click('.tool-btn[title="스티키노트 추가"]');
    await expect(page.locator('.board-el--sticky')).toHaveCount(1);
    await page.locator('.sel-toolbar .st-btn[title="연동"]').click();
    await page.locator('.sel-toolbar .st-link-row', { hasText: '노드 연결' }).click();

    const input = page.locator('.picker-input');
    await input.fill('abc');
    await input.press('Backspace');
    await input.press('Backspace');

    // the picker (and its input) must still be there — a real delete would
    // have closed the picker along with the sticky it was attached to
    await expect(page.locator('.picker-backdrop')).toHaveCount(1);
    await expect(input).toHaveValue('a');
    await page.keyboard.press('Escape');
    await expect(page.locator('.board-el--sticky')).toHaveCount(1);
  } finally {
    await cleanup();
  }
});

test('노트 연결 피커 검색창에서 백스페이스를 눌러도 스티키가 삭제되지 않는다', { tag: ['@board'] }, async () => {
  const { page, cleanup } = await launchApp();
  try {
    await newBoard(page);
    await page.click('.tool-btn[title="스티키노트 추가"]');
    await page.locator('.sel-toolbar .st-btn[title="연동"]').click();
    await page.locator('.sel-toolbar .st-link-row', { hasText: '노트 연결' }).click();

    const input = page.locator('.picker-input');
    await input.fill('abc');
    await input.press('Backspace');

    await expect(page.locator('.picker-backdrop')).toHaveCount(1);
    await expect(input).toHaveValue('ab');
    await page.keyboard.press('Escape');
    await expect(page.locator('.board-el--sticky')).toHaveCount(1);
  } finally {
    await cleanup();
  }
});

test('외부 링크 입력창에서 백스페이스를 눌러도 스티키가 삭제되지 않는다', { tag: ['@board'] }, async () => {
  const { page, cleanup } = await launchApp();
  try {
    await newBoard(page);
    await page.click('.tool-btn[title="스티키노트 추가"]');
    await page.locator('.sel-toolbar .st-btn[title="연동"]').click();
    await page.locator('.sel-toolbar .st-link-row[title="외부 링크 연결"]').click();

    const input = page.locator('.st-link-input');
    await input.fill('https://example.com');
    await input.press('Backspace');
    await input.press('Backspace');

    await expect(page.locator('.board-el--sticky')).toHaveCount(1);
    await expect(input).toHaveValue('https://example.c');
  } finally {
    await cleanup();
  }
});

test('이미 연결된 두 스티키 사이를 다시 드래그해도 중복 화살표가 생기지 않고 기존 화살표가 선택된다', { tag: ['@board'] }, async () => {
  const { page, cleanup } = await launchApp();
  try {
    await newBoard(page);
    await page.click('.tool-btn[title="스티키노트 추가"]');
    const first = page.locator('.board-el--sticky').first();

    await page.click('.tool-btn[title="스티키노트 추가"]');
    const second = page.locator('.board-el--sticky').nth(1);
    const secondBoxBefore = await second.boundingBox();
    if (!secondBoxBefore) throw new Error('요소 위치를 읽지 못함');
    await page.mouse.move(secondBoxBefore.x + secondBoxBefore.width / 2, secondBoxBefore.y + secondBoxBefore.height / 2);
    await page.mouse.down();
    await page.mouse.move(secondBoxBefore.x + 400, secondBoxBefore.y + 220, { steps: 8 });
    await page.mouse.up();

    const dragConnector = async () => {
      await first.click();
      const anchor = page.locator('.board-el--sticky').first().locator('.board-anchor--right');
      const anchorBox = await anchor.boundingBox();
      const secondBox = await second.boundingBox();
      if (!anchorBox || !secondBox) throw new Error('앵커/대상 위치를 읽지 못함');
      await page.mouse.move(anchorBox.x + anchorBox.width / 2, anchorBox.y + anchorBox.height / 2);
      await page.mouse.down();
      await page.mouse.move(secondBox.x + secondBox.width / 2, secondBox.y + secondBox.height / 2, { steps: 10 });
      await page.mouse.up();
    };

    await dragConnector();
    await expect(page.locator('.board-connector')).toHaveCount(1);

    await page.click('.board-canvas', { position: { x: 20, y: 20 } });
    await dragConnector(); // same pair, again
    await expect(page.locator('.board-el--sticky')).toHaveCount(2); // still no 3rd/duplicate sticky
    await expect(page.locator('.board-connector')).toHaveCount(1); // no duplicate connector
    await expect(page.locator('.board-connector.selected')).toHaveCount(1); // the existing one got selected
  } finally {
    await cleanup();
  }
});

test('긴 텍스트가 연동 칩과 겹치지 않는다', { tag: ['@board'] }, async () => {
  const { page, cleanup } = await launchApp();
  try {
    await newBoard(page);
    await page.click('.tool-btn[title="스티키노트 추가"]');
    await page.locator('.board-el--sticky').dblclick();
    await page.keyboard.type('한 줄\n두 줄\n세 줄\n네 줄\n다섯 줄\n여섯 줄\n일곱 줄\n여덟 줄');
    await page.click('.board-canvas', { position: { x: 20, y: 20 } });

    await page.locator('.board-el--sticky').click();
    await page.locator('.sel-toolbar .st-btn[title="연동"]').click();
    await page.locator('.sel-toolbar .st-link-row[title="외부 링크 연결"]').click();
    await page.locator('.st-link-input').fill('https://example.com/foo');
    await page.keyboard.press('Enter');
    await page.click('.board-canvas', { position: { x: 20, y: 20 } });

    const textBox = await page.locator('.board-el-text').boundingBox();
    const linksBox = await page.locator('.board-sticky-links').boundingBox();
    if (!textBox || !linksBox) throw new Error('텍스트/칩 영역 위치를 읽지 못함');
    // the text box must end at or above where the chip row begins — no overlap
    expect(textBox.y + textBox.height).toBeLessThanOrEqual(linksBox.y + 1); // +1px rounding slack
  } finally {
    await cleanup();
  }
});

test('보드에서 노드에 연결하면, 그 노드 쪽에 "보드에서 참조됨" 칩이 뜨고 클릭하면 보드로 돌아간다', { tag: ['@board'] }, async () => {
  const { page, cleanup } = await launchApp();
  try {
    await page.click('.sb-section-btn[title="새 마인드맵"]');
    await page.waitForSelector('.canvas', { timeout: 10_000 });
    await page.click('.canvas');
    await page.keyboard.press('Enter');
    await page.waitForSelector('.editing-text', { timeout: 3_000 });
    await page.keyboard.type('백링크노드');
    await page.keyboard.press('Enter');
    await page.keyboard.press('Escape');

    await newBoard(page);
    await page.click('.tool-btn[title="스티키노트 추가"]');
    await page.locator('.sel-toolbar .st-btn[title="연동"]').click();
    await page.locator('.sel-toolbar .st-link-row', { hasText: '노드 연결' }).click();
    await page.locator('.picker-item', { hasText: '백링크노드' }).click();
    await expect(page.locator('.board-sticky-link', { hasText: '백링크노드' })).toHaveCount(1);
    await page.waitForTimeout(1200); // board autosave (1s debounce) + reindex

    // switch to the map tab (created first, so it's the first .tab) — the
    // node should now show a "board" backlink chip
    await page.locator('.tab').first().click();
    await expect(page.locator('.canvas')).toBeVisible();

    const boardChip = page.locator('.gchip.board');
    await expect(boardChip).toHaveCount(1);
    await boardChip.click();
    await expect(page.locator('.board-canvas')).toBeVisible();
    await expect(page.locator('.board-el--sticky.selected')).toHaveCount(1);
  } finally {
    await cleanup();
  }
});
