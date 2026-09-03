import { test, expect, type Page } from '@playwright/test';
import { launchApp } from './helpers';

// docs/product/specs/2026-09-03-color-tag-legend.md — 색상 태그 범례: 경로 바 아래
// 같은 높이의 태그 바(TagBar)에서 이 맵의 색상 키에 라벨을 붙이고, 칩 클릭으로
// 기존 colorFilter를 토글한다. 하단 캔버스 툴바의 기존 색 점 필터는 이 바로 완전히
// 대체됐다.

async function newMap(page: Page) {
  await page.click('.sb-section-btn[title="새 마인드맵"]');
  await page.waitForSelector('.canvas', { timeout: 5_000 });
}

async function addRootNode(page: Page, text: string) {
  await page.click('.canvas');
  await page.keyboard.press('Enter');
  await page.waitForSelector('.editing-text', { timeout: 3_000 });
  await page.keyboard.type(text);
  await page.keyboard.press('Enter');
}

async function addChild(page: Page, parentText: string, childText: string) {
  await page.locator('.node', { hasText: parentText }).click();
  await page.keyboard.press('Tab');
  await page.waitForSelector('.editing-text', { timeout: 3_000 });
  await page.keyboard.type(childText);
  await page.keyboard.press('Enter');
}

/** TAG_KEYS order is red, orange, yellow, green, teal, violet, pink, brown —
 *  `swatchIndex` picks the same-order entry in the context menu's color grid. */
async function setNodeColor(page: Page, nodeText: string, swatchIndex: number) {
  await page.locator('.node', { hasText: nodeText }).click({ button: 'right' });
  await page.waitForSelector('.ctx-menu', { timeout: 3_000 });
  await page.locator('.ctx-colors .color-swatch:not(.none)').nth(swatchIndex).click();
}

test(
  '태그 바: 칩 표시 → 필터 토글 → 상위 포함 → 펜슬로 라벨 인라인 수정',
  { tag: ['@map'] },
  async () => {
    const { page, cleanup } = await launchApp();
    try {
      await newMap(page);
      await addRootNode(page, '루트');
      await addChild(page, '루트', '빨강자식');
      await setNodeColor(page, '빨강자식', 0); // red
      await addChild(page, '루트', '주황자식');
      await setNodeColor(page, '주황자식', 1); // orange

      // 경로 바 바로 아래에 태그 바가 나타나고, 실제 쓰인 두 색이 기본 이름 칩으로 보인다.
      await expect(page.locator('.tagbar')).toBeVisible();
      await expect(page.locator('.tagbar-chip')).toHaveCount(2);
      // TAG_KEYS 순서(red, orange, …)로 정렬되므로 red는 항상 첫 칩 — hasText는 편집 중
      // <input>의 value를 텍스트로 못 잡으므로(placeholder/value는 textContent가 아님)
      // 위치 기반 로케이터를 쓴다.
      const redChip = page.locator('.tagbar-chip').nth(0);
      const orangeChip = page.locator('.tagbar-chip').nth(1);
      await expect(redChip).toContainText('로즈');
      await expect(orangeChip).toContainText('주황');

      // 칩(펜슬 제외 영역) 클릭 → colorFilter 토글: 빨강 자식만 남고 주황 자식은 숨는다.
      await redChip.locator('.tagbar-chip-main').click();
      await expect(page.locator('.node', { hasText: '빨강자식' })).toBeVisible();
      await expect(page.locator('.node', { hasText: '주황자식' })).toHaveCount(0);
      // 무색 부모("루트")는 상위 포함 토글 전에는 숨는다.
      await expect(page.locator('.node', { hasText: '루트' })).toHaveCount(0);

      // "상위" 포함 토글 → 부모가 다시 보인다.
      await expect(page.locator('.tool-btn.small', { hasText: '상위' })).toBeVisible();
      await page.locator('.tool-btn.small', { hasText: '상위' }).click();
      await expect(page.locator('.node', { hasText: '루트' })).toBeVisible();

      // 칩을 다시 클릭 → 필터 해제, 모든 노드가 다시 보인다.
      await redChip.locator('.tagbar-chip-main').click();
      await expect(page.locator('.node', { hasText: '주황자식' })).toBeVisible();

      // 펜슬로 라벨 인라인 수정 (hover로 노출되지만 opacity-only이므로 클릭 자체는 hover 없이도 유효 — 실제 사용성 확인을 위해 hover도 수행).
      await redChip.hover();
      await redChip.locator('.tagbar-chip-edit').click();
      const input = redChip.locator('.tagbar-edit-input');
      await expect(input).toBeVisible();
      await input.fill('새 아이디어');
      await input.press('Enter');
      await expect(page.locator('.tagbar-chip', { hasText: '새 아이디어' })).toBeVisible();
      await expect(page.locator('.tagbar-chip', { hasText: '로즈' })).toHaveCount(0);
    } finally {
      await cleanup();
    }
  },
);

test(
  '태그 바: ＋로 아직 안 쓰인 색에도 라벨을 정의할 수 있다 (빈 맵에서도 발견 가능)',
  { tag: ['@map'] },
  async () => {
    const { page, cleanup } = await launchApp();
    try {
      await newMap(page);
      // 색이 하나도 안 쓰인 빈 맵에서도 ＋는 항상 보인다 (발견성 — 기존 색 점 필터의 한계였음).
      await expect(page.locator('.tagbar-add')).toBeVisible();
      await expect(page.locator('.tagbar-chip')).toHaveCount(0);

      await page.click('.tagbar-add');
      await page.waitForSelector('.tagbar-add-pop', { timeout: 3_000 });
      await page.locator('.tagbar-add-option').first().click(); // TAG_KEYS[0] = red
      const input = page.locator('.tagbar-add-row .tagbar-edit-input');
      await expect(input).toBeVisible();
      await input.fill('막힘');
      await input.press('Enter');

      await expect(page.locator('.tagbar-chip', { hasText: '막힘' })).toBeVisible();
    } finally {
      await cleanup();
    }
  },
);

test(
  '태그 바: 맵이 아닌 탭만 열려 있으면 행 자체가 사라진다 (빈 22px 자리를 남기지 않음)',
  { tag: ['@map', '@note'] },
  async () => {
    const { page, cleanup } = await launchApp();
    try {
      await page.click('.sb-section-btn[title="새 노트"]');
      await page.waitForSelector('.tab', { timeout: 5_000 });
      await expect(page.locator('.tagbar')).toHaveCount(0);
    } finally {
      await cleanup();
    }
  },
);
