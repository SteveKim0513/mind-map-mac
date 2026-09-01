import { test, expect, type Page } from '@playwright/test';
import { launchApp } from './helpers';

/** Create a root-level center topic. Enter with nothing selected → addRoot
 *  (the first call, canvas background click leaves nothing selected); Enter
 *  with a node selected (not editing) → addSibling, which for a root is
 *  another independent root — stacked vertically by the tree layout. */
async function addRoot(page: Page, text: string): Promise<void> {
  await page.keyboard.press('Enter');
  await page.waitForSelector('.editing-text', { timeout: 3_000 });
  await page.keyboard.type(text);
  await page.keyboard.press('Enter');
  await page.waitForSelector('.editing-text', { state: 'hidden', timeout: 3_000 });
  // useKeyboard.ts debounces the Enter that just committed an edit (< 50ms since
  // editCommittedAt) so it doesn't also fire addSibling — no DOM signal to wait on,
  // so clear that window explicitly before the next addRoot() presses Enter again.
  await page.waitForTimeout(80);
}

async function newMap(page: Page): Promise<void> {
  await page.click('.sb-section-btn[title="새 마인드맵"]');
  await page.waitForSelector('.canvas', { timeout: 5_000 });
  await page.click('.canvas');
}

test(
  'Shift+드래그로 캔버스에 박스를 그리면 박스 안의 노드들만 다중 선택된다',
  { tag: ['@map'] },
  async () => {
    const { page, cleanup } = await launchApp();
    try {
      await newMap(page);
      await addRoot(page, 'A');
      await addRoot(page, 'B');
      await addRoot(page, 'C');
      // creating C leaves it selected — clear that so the union below reflects
      // only what the marquee itself picks up, not leftover creation-time selection.
      await page.keyboard.press('Escape');

      const boxA = await page.locator('.node', { hasText: 'A' }).boundingBox();
      const boxB = await page.locator('.node', { hasText: 'B' }).boundingBox();
      const boxC = await page.locator('.node', { hasText: 'C' }).boundingBox();
      if (!boxA || !boxB || !boxC) throw new Error('노드 위치를 읽지 못함');

      // A와 B를 감싸고 C는 벗어나는 박스: A 좌상단 바깥에서 시작해 B와 C 사이까지.
      const startX = boxA.x - 40;
      const startY = boxA.y - 20;
      const endX = Math.max(boxA.x + boxA.width, boxB.x + boxB.width) + 40;
      const endY = (boxB.y + boxB.height + boxC.y) / 2;

      await page.keyboard.down('Shift');
      await page.mouse.move(startX, startY);
      await page.mouse.down();
      await page.mouse.move(endX, endY, { steps: 8 });
      await expect(page.locator('.marquee-box')).toBeVisible();
      await page.mouse.up();
      await page.keyboard.up('Shift');

      await expect(page.locator('.node', { hasText: 'A' })).toHaveClass(/selected/);
      await expect(page.locator('.node', { hasText: 'B' })).toHaveClass(/selected/);
      await expect(page.locator('.node', { hasText: 'C' })).not.toHaveClass(/selected/);
      await expect(page.locator('.marquee-box')).toHaveCount(0); // 드롭 후 사라짐
    } finally {
      await cleanup();
    }
  },
);

test(
  'Shift 없이 드래그하면 여전히 화면 이동(pan)만 하고 아무것도 선택하지 않는다',
  { tag: ['@map'] },
  async () => {
    const { page, cleanup } = await launchApp();
    try {
      await newMap(page);
      await addRoot(page, 'A');
      // creating a node leaves it selected — clear that first so the assertion
      // below actually proves the DRAG selected nothing, not just that we never checked.
      await page.keyboard.press('Escape');
      await expect(page.locator('.node', { hasText: 'A' })).not.toHaveClass(/selected/);

      const before = await page.locator('.node', { hasText: 'A' }).boundingBox();
      if (!before) throw new Error('노드 위치를 읽지 못함');

      await page.mouse.move(before.x + before.width + 60, before.y - 40);
      await page.mouse.down();
      await page.mouse.move(before.x + before.width - 40, before.y + 100, { steps: 8 });
      await page.mouse.up();

      const after = await page.locator('.node', { hasText: 'A' }).boundingBox();
      if (!after) throw new Error('노드 위치를 읽지 못함');

      // 화면이 실제로 이동했다(패닝) — 노드의 화면 좌표가 드래그만큼 바뀐다.
      expect(Math.abs(after.x - before.x)).toBeGreaterThan(50);
      // 하지만 그 과정에서 아무것도 선택되지 않는다 — 마퀴와 팬이 충돌하지 않는다.
      await expect(page.locator('.node', { hasText: 'A' })).not.toHaveClass(/selected/);
    } finally {
      await cleanup();
    }
  },
);
