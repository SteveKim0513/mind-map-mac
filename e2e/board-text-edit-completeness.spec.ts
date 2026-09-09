import { test, expect, type Page } from '@playwright/test';
import { launchApp } from './helpers';

// 2026-09-07 사용자 보고("텍스트 편집 중 스크롤하면 보드 전체가 같이 움직임") +
// 같은 코드 경로 감사 중 발견한 관련 2건(Escape 취소 불가)에 대한 회귀 테스트.
// 실행취소 과다 기록(문항 B)은 이 프로젝트에 undo E2E 선례가 전혀 없어(mapStore도
// 유닛 테스트로만 검증) 같은 관례로 boardStore.test.ts의 유닛 테스트로 검증한다.

async function newBoard(page: Page): Promise<void> {
  await page.click('.sb-section-btn[title="새 보드"]');
  await page.waitForSelector('.board-canvas', { timeout: 5_000 });
  await page.click('.board-canvas');
}

test('스티키 텍스트 편집 중 텍스트 영역 안에서 스크롤해도 보드는 움직이지 않는다', { tag: ['@board'] }, async () => {
  const { page, cleanup } = await launchApp();
  try {
    await newBoard(page);
    await page.click('.tool-btn[title="스티키노트 추가"]');
    await page.locator('.board-el--sticky').dblclick();
    // enough lines to make the textarea itself scrollable
    const lines = Array.from({ length: 30 }, (_, i) => `${i + 1}번째 줄`).join('\n');
    await page.locator('.board-el-input').fill(lines);

    const before = await page.locator('.board-world').getAttribute('style');
    const box = await page.locator('.board-el-input').boundingBox();
    if (!box) throw new Error('텍스트 영역 위치를 읽지 못함');
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.wheel(0, 300);
    await page.waitForTimeout(100);
    const after = await page.locator('.board-world').getAttribute('style');

    expect(after).toBe(before); // pan/zoom transform unchanged — the wheel stayed inside the textarea
  } finally {
    await cleanup();
  }
});

test('"텍스트 박스 추가" 블록 편집 중 스크롤해도 보드는 움직이지 않는다', { tag: ['@board'] }, async () => {
  const { page, cleanup } = await launchApp();
  try {
    await newBoard(page);
    await page.click('.tool-btn[title="스티키노트 추가"]');
    await page.locator('.board-el--sticky').click();
    await page.locator('.sel-toolbar .st-btn[title="텍스트 박스 추가"]').click();
    // "텍스트 박스 추가" already opens the new block in edit mode — no double-click needed
    const lines = Array.from({ length: 30 }, (_, i) => `${i + 1}번째 줄`).join('\n');
    await page.locator('.board-sticky-note .board-el-input').fill(lines);

    const before = await page.locator('.board-world').getAttribute('style');
    const box = await page.locator('.board-sticky-note .board-el-input').boundingBox();
    if (!box) throw new Error('텍스트 영역 위치를 읽지 못함');
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.wheel(0, 300);
    await page.waitForTimeout(100);
    const after = await page.locator('.board-world').getAttribute('style');

    expect(after).toBe(before);
  } finally {
    await cleanup();
  }
});

test('"텍스트 박스 추가" 블록은 blur 후 더블클릭으로 재편집이 가능하다', { tag: ['@board'] }, async () => {
  const { page, cleanup } = await launchApp();
  try {
    await newBoard(page);
    await page.click('.tool-btn[title="스티키노트 추가"]');
    await page.locator('.board-el--sticky').click();
    await page.locator('.sel-toolbar .st-btn[title="텍스트 박스 추가"]').click();
    await page.locator('.board-sticky-note .board-el-input').fill('첫 입력');
    await page.click('.board-canvas', { position: { x: 20, y: 20 } }); // blur → commits "첫 입력"

    await expect(page.locator('.board-sticky-note .board-el-input')).toHaveCount(0);
    await expect(page.locator('.board-sticky-note .board-el-text')).toHaveText('첫 입력');

    await page.locator('.board-sticky-note .board-el-text').dblclick();
    await expect(page.locator('.board-sticky-note .board-el-input')).toHaveCount(1); // 재편집 진입
    await page.locator('.board-sticky-note .board-el-input').fill('첫 입력 + 추가');
    await page.click('.board-canvas', { position: { x: 20, y: 20 } });

    await expect(page.locator('.board-sticky-note .board-el-text')).toHaveText('첫 입력 + 추가');
  } finally {
    await cleanup();
  }
});

test('스티키 텍스트 편집 중 Escape를 누르면 편집 시작 전 텍스트로 되돌아간다', { tag: ['@board'] }, async () => {
  const { page, cleanup } = await launchApp();
  try {
    await newBoard(page);
    await page.click('.tool-btn[title="스티키노트 추가"]');
    await page.locator('.board-el--sticky').dblclick();
    await page.keyboard.type('원본');
    await page.click('.board-canvas', { position: { x: 20, y: 20 } }); // blur → commits "원본"

    await page.locator('.board-el--sticky').dblclick();
    await page.locator('.board-el-input').fill('원본 수정중');
    await page.keyboard.press('Escape');

    await expect(page.locator('.board-el-input')).toHaveCount(0); // editing closed
    await expect(page.locator('.board-el-text')).toHaveText('원본'); // reverted, not "원본 수정중"
  } finally {
    await cleanup();
  }
});
