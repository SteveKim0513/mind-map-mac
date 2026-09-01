import { test, expect, type Page } from '@playwright/test';
import { launchApp, getTabTitles } from './helpers';

/** Commit a freshly-created sidebar folder's inline rename with `name`, and wait
 *  for the tree to re-render with the new label — the same render pass that
 *  also settles `selected` to the renamed folder (Sidebar.tsx commitRename), so
 *  the next "새 폴더/새 노트" click targets the right directory, not a stale one. */
async function renameNewFolder(page: Page, name: string): Promise<void> {
  const input = page.locator('.rename-input');
  await input.waitFor({ state: 'visible', timeout: 3_000 });
  await input.fill(name);
  await input.press('Enter');
  await page.locator('.label', { hasText: name }).waitFor({ state: 'visible', timeout: 5_000 });
}

test(
  '경로 바가 같은 이름 파일의 폴더 위치를 보여주고, 세그먼트 클릭으로 사이드바에서 확인할 수 있다',
  { tag: ['@nav'] },
  async () => {
    const { page, workspace, cleanup } = await launchApp();
    try {
      // 기획/결제시스템/제목 없음.md
      await page.click('.sb-section-btn[title="새 폴더"]');
      await renameNewFolder(page, '기획');
      await page.click('.sb-section-btn[title="새 폴더"]');
      await renameNewFolder(page, '결제시스템');
      await page.click('.sb-section-btn[title="새 노트"]');
      await expect(page.locator('.tab')).toHaveCount(1);

      // 기획 폴더를 다시 선택해 타겟 디렉터리를 되돌린 뒤 형제 폴더를 만든다.
      await page.locator('.row', { hasText: '기획' }).first().click();
      await page.click('.sb-section-btn[title="새 폴더"]');
      await renameNewFolder(page, '환불정책');
      // 기획/환불정책/제목 없음.md
      await page.click('.sb-section-btn[title="새 노트"]');
      await expect(page.locator('.tab')).toHaveCount(2);

      // 두 노트 모두 기본 이름 그대로 — 탭 제목만으로는 서로 구분되지 않는다.
      expect(await getTabTitles(page)).toEqual(['제목 없음', '제목 없음']);

      // 첫 번째 탭(기획/결제시스템/제목 없음)으로 전환해 경로 바를 확인한다.
      await page.locator('.tab').first().click();
      const crumbs = await page
        .locator('.pathbar-side')
        .first()
        .locator('.pathbar-crumb')
        .allTextContents();
      expect(crumbs.map((c) => c.trim())).toEqual(['기획', '결제시스템', '제목 없음']);

      // "결제시스템" 세그먼트 클릭 → 사이드바에서 조상 폴더가 펼쳐지고 해당 행이 선택된다.
      await page.locator('.pathbar-crumb', { hasText: '결제시스템' }).click();
      const folderPath = `${workspace}/기획/결제시스템`;
      await expect(page.locator(`.row.selected[data-node-path="${folderPath}"]`)).toBeVisible({
        timeout: 3_000,
      });
    } finally {
      await cleanup();
    }
  },
);

test(
  '경로가 깊으면 가운데를 …으로 접고, 클릭하면 전체 경로가 인라인으로 펼쳐진다',
  { tag: ['@nav'] },
  async () => {
    const { page, cleanup } = await launchApp();
    try {
      // 기획/A/B/C/제목 없음.md — 5개 세그먼트라 첫/마지막 둘만 남기고 접힌다.
      await page.click('.sb-section-btn[title="새 폴더"]');
      await renameNewFolder(page, '기획');
      for (const name of ['A', 'B', 'C']) {
        await page.click('.sb-section-btn[title="새 폴더"]');
        await renameNewFolder(page, name);
      }
      await page.click('.sb-section-btn[title="새 노트"]');
      await expect(page.locator('.tab')).toHaveCount(1);

      const crumbTexts = () =>
        page.locator('.pathbar-side').first().locator('.pathbar-crumb').allTextContents();

      expect((await crumbTexts()).map((c) => c.trim())).toEqual(['기획', '…', 'C', '제목 없음']);

      await page.locator('.pathbar-ellipsis').click();
      expect((await crumbTexts()).map((c) => c.trim())).toEqual(['기획', 'A', 'B', 'C', '제목 없음']);
    } finally {
      await cleanup();
    }
  },
);

test(
  '사이드바 폴더 클릭은 선택만 하고 펼침을 건드리지 않는다 — 펼침/접기는 화살표 전용, 클릭은 다중 선택도 해제한다',
  { tag: ['@nav'] },
  async () => {
    const { page, workspace, cleanup } = await launchApp();
    try {
      await page.click('.sb-section-btn[title="새 폴더"]');
      await renameNewFolder(page, '기획');
      await page.click('.sb-section-btn[title="새 노트"]'); // 기획/제목 없음.md
      await expect(page.locator('.tab')).toHaveCount(1);

      const folderPath = `${workspace}/기획`;
      const folderRow = page.locator(`.row[data-node-path="${folderPath}"]`);
      const childLabel = page.locator('.label', { hasText: '제목 없음' });
      await expect(childLabel).toBeVisible();

      // 폴더 라벨을 클릭해도 펼침 상태는 그대로 — 자식이 계속 보이고, 선택만 된다.
      await folderRow.locator('.label').click();
      await expect(folderRow).toHaveClass(/selected/);
      await expect(childLabel).toBeVisible();

      // 화살표(twisty)를 클릭해야 접힌다.
      await folderRow.locator('.twisty').click();
      await expect(childLabel).toBeHidden();
      await folderRow.locator('.twisty').click();
      await expect(childLabel).toBeVisible();

      // ⌘클릭으로 노트를 다중 선택한 뒤 폴더를 plain click하면 선택이 해제된다
      // (이전엔 파일 클릭만 다중 선택을 해제하고 폴더 클릭은 그대로 둬 일관성이 없었다).
      await childLabel.click({ modifiers: ['Meta'] });
      await expect(page.locator('.sel-bar')).toBeVisible();
      await folderRow.locator('.label').click();
      await expect(page.locator('.sel-bar')).toBeHidden();
    } finally {
      await cleanup();
    }
  },
);
