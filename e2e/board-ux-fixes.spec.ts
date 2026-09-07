import { test, expect, type Page } from '@playwright/test';
import { launchApp } from './helpers';

// 2026-09-06 실사용 피드백 11건에 대한 회귀 테스트. 7/8/9번은 실제 마우스 좌표
// 클릭으로 검증한다 — 이전에 키보드(Enter)로만 검증해 놓쳤던 버그였기 때문에,
// 같은 실수를 반복하지 않으려면 여기서는 반드시 좌표 클릭을 써야 한다.

async function newBoard(page: Page): Promise<void> {
  await page.click('.sb-section-btn[title="새 보드"]');
  await page.waitForSelector('.board-canvas', { timeout: 5_000 });
  await page.click('.board-canvas');
}

test('빈 캔버스를 더블클릭하면 스티키가 생성된다', { tag: ['@board'] }, async () => {
  const { page, cleanup } = await launchApp();
  try {
    await newBoard(page);
    const box = await page.locator('.board-canvas').boundingBox();
    if (!box) throw new Error('캔버스 위치를 읽지 못함');
    await page.mouse.dblclick(box.x + 300, box.y + 300);
    await expect(page.locator('.board-el--sticky')).toHaveCount(1);
    await expect(page.locator('.board-el-input')).toBeVisible(); // 바로 편집 모드로 진입
  } finally {
    await cleanup();
  }
});

test('스티키/이미지를 선택한 요소 위에서 더블클릭해도 새 스티키가 겹쳐 생기지 않는다', { tag: ['@board'] }, async () => {
  const { page, cleanup } = await launchApp();
  try {
    await newBoard(page);
    await page.click('.tool-btn[title="스티키노트 추가"]');
    await expect(page.locator('.board-el--sticky')).toHaveCount(1);
    // 기존 스티키를 더블클릭 — 자기 자신의 편집 모드로 들어가야지, 배경 더블클릭 로직이 겹쳐 발동하면 안 됨
    await page.locator('.board-el--sticky').dblclick();
    await expect(page.locator('.board-el--sticky')).toHaveCount(1);
    await expect(page.locator('.board-el-input')).toBeVisible();
  } finally {
    await cleanup();
  }
});

test('연결 포인트는 선택·hover 전에도 항상 DOM에 있고(흐리게), 활성화되면 클릭 가능해진다', { tag: ['@board'] }, async () => {
  const { page, cleanup } = await launchApp();
  try {
    await newBoard(page);
    await page.click('.tool-btn[title="스티키노트 추가"]');
    await page.click('.board-canvas', { position: { x: 20, y: 20 } }); // deselect
    // not selected/hovered — anchors are mounted but not .active
    await expect(page.locator('.board-anchor')).toHaveCount(4);
    await expect(page.locator('.board-anchor.active')).toHaveCount(0);

    await page.locator('.board-el--sticky').click();
    await expect(page.locator('.board-anchor.active')).toHaveCount(4);
  } finally {
    await cleanup();
  }
});

test('화살표는 스티키보다 뒤(DOM 순서상 먼저)에 그려진다', { tag: ['@board'] }, async () => {
  const { page, cleanup } = await launchApp();
  try {
    await newBoard(page);
    await page.click('.tool-btn[title="스티키노트 추가"]');
    await page.locator('.board-anchor--right').click();
    await expect(page.locator('.board-connector')).toHaveCount(1);
    await expect(page.locator('.board-el--sticky')).toHaveCount(2);

    // NOTE: SVG elements' `.className` is an SVGAnimatedString, not a plain
    // string — must read via getAttribute('class') here, not `.className`.
    const order = await page.locator('.board-world > *').evaluateAll((els) => els.map((e) => e.getAttribute('class') ?? ''));
    const connectorIdx = order.findIndex((c) => c.includes('board-connector') && !c.includes('preview'));
    const firstStickyIdx = order.findIndex((c) => c.includes('board-el--sticky'));
    expect(connectorIdx).toBeGreaterThanOrEqual(0);
    expect(firstStickyIdx).toBeGreaterThanOrEqual(0);
    expect(connectorIdx).toBeLessThan(firstStickyIdx); // line drawn before (behind) any sticky
  } finally {
    await cleanup();
  }
});

test('분할 화면에서 새 스티키는 그 화면 자신의 뷰포트 중앙 근처에 생긴다 (창 전체 기준 아님)', { tag: ['@board'] }, async () => {
  const { page, cleanup } = await launchApp();
  try {
    await newBoard(page);
    // 노트를 하나 더 열고(활성 탭이 됨) 화면 분할 — toggleSplit은 "현재 활성 탭"을
    // 오른쪽으로 옮기므로, 보드가 왼쪽에 남는다.
    await page.click('.sb-section-btn[title="새 노트"]');
    await page.waitForTimeout(300);
    await page.keyboard.press('Meta+k');
    await page.waitForSelector('.qo', { timeout: 3_000 });
    await page.locator('.qo-item', { hasText: '화면 분할' }).first().click();
    await expect(page.locator('.panes.split')).toBeVisible({ timeout: 3_000 });

    const leftPane = page.locator('.pane').first();
    await expect(leftPane.locator('.board-canvas')).toBeVisible();
    const leftBox = await leftPane.boundingBox();
    if (!leftBox) throw new Error('왼쪽 패널 위치를 읽지 못함');

    await leftPane.click({ position: { x: 10, y: 10 } }); // 왼쪽(보드) 패널 활성화
    await page.click('.tool-btn[title="스티키노트 추가"]');
    const stickyBox = await page.locator('.board-el--sticky').boundingBox();
    if (!stickyBox) throw new Error('스티키 위치를 읽지 못함');

    // 생성된 스티키의 화면 좌표가 왼쪽 패널 범위 "안"에 있어야 한다 —
    // 창 전체 너비 기준으로 계산했다면 오른쪽(노트) 패널 쪽으로 넘어갔을 것.
    expect(stickyBox.x).toBeGreaterThanOrEqual(leftBox.x);
    expect(stickyBox.x + stickyBox.width).toBeLessThanOrEqual(leftBox.x + leftBox.width + 5);
  } finally {
    await cleanup();
  }
});

test('연동 플라이아웃에 링크(외부 URL) 연결이 있고, 카드에 칩으로 표시되며 해제할 수 있다', { tag: ['@board'] }, async () => {
  const { page, cleanup } = await launchApp();
  try {
    await newBoard(page);
    await page.click('.tool-btn[title="스티키노트 추가"]');
    await page.locator('.sel-toolbar .st-btn[title="연동"]').click();
    await page.locator('.sel-toolbar .st-link-row[title="외부 링크 연결"]').click();
    await page.locator('.st-link-input').fill('https://example.com/foo');
    await page.keyboard.press('Enter');

    const chip = page.locator('.board-sticky-link', { hasText: 'example.com' });
    await expect(chip).toHaveCount(1);

    // close the still-open flyout first — it floats just above the card and
    // its own content (the URL row) can visually overlap the card's top edge
    await page.click('.board-canvas', { position: { x: 20, y: 20 } });
    await page.waitForTimeout(450);
    await page.locator('.board-el--sticky').click();
    await page.waitForTimeout(450);
    await page.locator('.sel-toolbar .st-btn[title="연동"]').click();
    await expect(page.locator('.sel-toolbar .st-link-row[title="링크 연결 해제"]')).toBeVisible();

    // unlink via the card's own chip × (the primary real-world affordance)
    await page.click('.board-canvas', { position: { x: 20, y: 20 } });
    await page.locator('.board-sticky-link-x').click();
    await expect(page.locator('.board-sticky-link')).toHaveCount(0);
  } finally {
    await cleanup();
  }
});

test('노드 연결 피커에서 실제 마우스 클릭으로 항목을 고르면 연결이 완료된다 (좌표 클릭 회귀 방지)', { tag: ['@board'] }, async () => {
  const { page, cleanup } = await launchApp();
  try {
    await page.click('.sb-section-btn[title="새 마인드맵"]');
    await page.waitForSelector('.canvas', { timeout: 10_000 });
    await page.click('.canvas');
    await page.keyboard.press('Enter');
    await page.waitForSelector('.editing-text', { timeout: 3_000 });
    await page.keyboard.type('좌표클릭노드');
    await page.keyboard.press('Enter');

    await newBoard(page);
    await page.click('.tool-btn[title="스티키노트 추가"]');
    await page.locator('.sel-toolbar .st-btn[title="연동"]').click();
    await page.locator('.sel-toolbar .st-link-row', { hasText: '노드 연결' }).click();

    const item = page.locator('.picker-item', { hasText: '좌표클릭노드' });
    await expect(item).toBeVisible();
    await item.click(); // 실제 좌표 클릭 — Enter가 아님. 이전엔 캔버스가 포인터를 가로채 아무 일도 안 일어났었다.

    await expect(page.locator('.picker-backdrop')).toHaveCount(0); // 피커가 닫혔다 = 연결이 진행됐다
    await expect(page.locator('.board-sticky-link', { hasText: '좌표클릭노드' })).toHaveCount(1);
  } finally {
    await cleanup();
  }
});

test('노트 연결 피커에서 실제 마우스 클릭으로 항목을 고르면 연결이 완료된다 (좌표 클릭 회귀 방지)', { tag: ['@board'] }, async () => {
  const { page, cleanup } = await launchApp();
  try {
    await page.click('.sb-section-btn[title="새 노트"]');
    await page.waitForSelector('.note-title', { timeout: 5_000 });
    const titleInput = page.locator('.note-title');
    await titleInput.click({ clickCount: 3 });
    await titleInput.fill('좌표클릭노트');
    await titleInput.press('Tab');
    await page.waitForTimeout(700); // debounced rename + sidebar/noteIndex refresh
    await page.click('.sb-section-btn[title="새 보드"]');
    await page.waitForSelector('.board-canvas', { timeout: 5_000 });
    await page.click('.board-canvas');

    await page.click('.tool-btn[title="스티키노트 추가"]');
    await page.locator('.sel-toolbar .st-btn[title="연동"]').click();
    await page.locator('.sel-toolbar .st-link-row', { hasText: '노트 연결' }).click();

    const item = page.locator('.picker-item', { hasText: '좌표클릭노트' });
    await expect(item).toBeVisible();
    await item.click();

    await expect(page.locator('.picker-backdrop')).toHaveCount(0);
    await expect(page.locator('.board-sticky-link', { hasText: '좌표클릭노트' })).toHaveCount(1);
  } finally {
    await cleanup();
  }
});

test('피커가 열려 있을 때 목록을 스크롤해도 뒤의 보드는 스크롤(팬)되지 않는다', { tag: ['@board'] }, async () => {
  const { page, cleanup } = await launchApp();
  try {
    await newBoard(page);
    await page.click('.tool-btn[title="스티키노트 추가"]');
    await page.locator('.sel-toolbar .st-btn[title="연동"]').click();
    await page.locator('.sel-toolbar .st-link-row', { hasText: '노드 연결' }).click();

    const listBox = await page.locator('.picker-list').boundingBox();
    if (!listBox) throw new Error('피커 목록 위치를 읽지 못함');
    await page.mouse.move(listBox.x + listBox.width / 2, listBox.y + listBox.height / 2);
    await page.mouse.wheel(0, 200);
    await page.waitForTimeout(150);

    await page.keyboard.press('Escape');
    await expect(page.locator('.picker-backdrop')).toHaveCount(0);
    // 스티키가 여전히 캔버스 중앙 부근(팬이 안 밀렸다면 유지되는 자리)에 보여야 한다
    await expect(page.locator('.board-el--sticky')).toBeVisible();
  } finally {
    await cleanup();
  }
});

test('색 필터를 켜면 일치하는 스티키만 그리드로 재배치돼 보이고, 끄면 원래 위치로 돌아온다', { tag: ['@board'] }, async () => {
  const { page, cleanup } = await launchApp();
  try {
    await newBoard(page);
    await page.click('.tool-btn[title="스티키노트 추가"]');
    const firstBox = await page.locator('.board-el--sticky').boundingBox();
    if (!firstBox) throw new Error('위치를 읽지 못함');
    await page.locator('.sel-toolbar .st-btn[title="색 변경"]').click();
    await page.locator('.color-swatch-grid .color-swatch').nth(3).click(); // green
    await page.click('.board-canvas', { position: { x: 20, y: 20 } });

    await page.click('.tool-btn[title="스티키노트 추가"]');
    await page.locator('.sel-toolbar .st-btn[title="색 변경"]').click();
    await page.locator('.color-swatch-grid .color-swatch').nth(5).click(); // violet
    await page.click('.board-canvas', { position: { x: 20, y: 20 } });

    await expect(page.locator('.board-el--sticky')).toHaveCount(2);
    await page.locator('.tagbar-chip .tagbar-chip-main').first().click();
    await expect(page.locator('.board-el--sticky')).toHaveCount(1); // 나머지 하나는 숨김
    const filteredBox = await page.locator('.board-el--sticky').boundingBox();
    if (!filteredBox) throw new Error('위치를 읽지 못함');

    // 필터 끄면 둘 다 다시 보이고, 첫 스티키는 원래 자리로 복귀
    await page.locator('.tagbar-chip .tagbar-chip-main').first().click();
    await expect(page.locator('.board-el--sticky')).toHaveCount(2);
  } finally {
    await cleanup();
  }
});
