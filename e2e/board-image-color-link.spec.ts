import { test, expect, type Page } from '@playwright/test';
import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { launchApp } from './helpers';

// 2026-09-07: 사진(이미지) 요소도 스티키 노트처럼 색·연동(노드/노트/외부 링크)을
// 가지며, 색은 채우기가 아니라 사진 테두리에 얇게 표시된다(사진 자체를 가리지
// 않기 위해). 모양·정렬·서식·텍스트 박스 추가는 텍스트 카드 전용 기능이라
// 이미지 선택 시에는 뜨지 않는다.

// 1×1 투명 PNG — canvas 기반 fileToImageData가 실제로 디코딩할 수 있는 최소
// 유효 PNG가 필요하다(임의 바이트로는 이미지 로드가 실패한다).
const TINY_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

async function newBoard(page: Page): Promise<void> {
  await page.click('.sb-section-btn[title="새 보드"]');
  await page.waitForSelector('.board-canvas', { timeout: 5_000 });
  await page.click('.board-canvas'); // dismiss the inline rename that follows creation
}

async function addImage(page: Page, imgPath: string): Promise<void> {
  await page.setInputFiles('input[type="file"]', imgPath);
  await expect(page.locator('.board-el--image')).toHaveCount(1, { timeout: 10_000 });
}

test('사진을 추가하면 스티키와 같은 기본 색(노란색) 테두리를 갖고, 색을 바꿀 수 있다 — 모양·정렬·서식 메뉴는 뜨지 않는다', { tag: ['@board'] }, async () => {
  const { page, cleanup } = await launchApp();
  const tmpDir = mkdtempSync(join(tmpdir(), 'mindmap-e2e-img-'));
  const imgPath = join(tmpDir, 'tiny.png');
  writeFileSync(imgPath, Buffer.from(TINY_PNG_BASE64, 'base64'));
  try {
    await newBoard(page);
    await addImage(page, imgPath);
    await expect(page.locator('.board-el--image')).toHaveClass(/selected/);

    // 기본 색 = 스티키 기본값과 동일한 'yellow' — 테두리 색이 --tag-yellow 값과 같다
    const img = page.locator('.board-image');
    const yellowMatches = await img.evaluate((el) => {
      const border = getComputedStyle(el).borderColor;
      const yellow = getComputedStyle(document.documentElement).getPropertyValue('--tag-yellow').trim();
      const probe = document.createElement('div');
      probe.style.color = yellow;
      document.body.appendChild(probe);
      const resolved = getComputedStyle(probe).color;
      probe.remove();
      return border === resolved;
    });
    expect(yellowMatches).toBe(true);

    // 사진 선택 메뉴엔 색·연동만 있고, 텍스트 카드 전용 기능(모양·정렬·서식·텍스트박스)은 없다
    await expect(page.locator('.sel-toolbar .st-btn[title="색 변경"]')).toBeVisible();
    await expect(page.locator('.sel-toolbar .st-btn[title="연동"]')).toBeVisible();
    await expect(page.locator('.sel-toolbar .st-btn[title="모양 변경"]')).toHaveCount(0);
    await expect(page.locator('.sel-toolbar .st-btn[title="정렬"]')).toHaveCount(0);
    await expect(page.locator('.sel-toolbar .st-btn[title="글자 서식"]')).toHaveCount(0);
    await expect(page.locator('.sel-toolbar .st-btn[title="텍스트 박스 추가"]')).toHaveCount(0);

    // 색 변경 → 테두리 색도 바뀐다
    await page.locator('.sel-toolbar .st-btn[title="색 변경"]').click();
    await page.locator('.color-swatch-grid .color-swatch').nth(3).click(); // TAG_KEYS[3] = 'green'
    const greenMatches = await img.evaluate((el) => {
      const border = getComputedStyle(el).borderColor;
      const green = getComputedStyle(document.documentElement).getPropertyValue('--tag-green').trim();
      const probe = document.createElement('div');
      probe.style.color = green;
      document.body.appendChild(probe);
      const resolved = getComputedStyle(probe).color;
      probe.remove();
      return border === resolved;
    });
    expect(greenMatches).toBe(true);
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
    await cleanup();
  }
});

test('사진도 외부 링크에 연동할 수 있고 사진 아래 칩으로 표시되며, ×로 연결 해제할 수 있다', { tag: ['@board'] }, async () => {
  const { page, cleanup } = await launchApp();
  const tmpDir = mkdtempSync(join(tmpdir(), 'mindmap-e2e-img-'));
  const imgPath = join(tmpDir, 'tiny.png');
  writeFileSync(imgPath, Buffer.from(TINY_PNG_BASE64, 'base64'));
  try {
    await newBoard(page);
    await addImage(page, imgPath);

    await page.locator('.sel-toolbar .st-btn[title="연동"]').click();
    await page.locator('.sel-toolbar .st-link-row[title="외부 링크 연결"]').click();
    await page.locator('.st-link-input').fill('https://example.com/foo');
    await page.keyboard.press('Enter');

    const chip = page.locator('.board-image-links .board-sticky-link', { hasText: 'example.com' });
    await expect(chip).toHaveCount(1);

    await page.click('.board-canvas', { position: { x: 20, y: 20 } });
    await page.locator('.board-el--image').click();
    await page.locator('.board-image-links .board-sticky-link-x').click();
    await expect(page.locator('.board-image-links .board-sticky-link')).toHaveCount(0);
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
    await cleanup();
  }
});
