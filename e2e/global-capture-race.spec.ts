import { test, expect, _electron as electron } from '@playwright/test';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { tmpdir } from 'os';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Regression: if "오늘의 생각.mind" happens to be open in a tab, that tab's
// stale in-memory copy would win the next debounced autosave and silently
// erase a capture written to disk while it was open (docs/exec-plans/
// completed/2026-07-10-global-capture.md's accepted risk — turned out common
// enough in practice to fix: even just viewing the map marks it dirty via
// setView, so opening it to check a capture worked was enough to trigger this).

test('캡처 대상 맵이 열려 있어도 캡처한 노드가 지워지지 않는다', { tag: ['@capture'] }, async () => {
  const userData = mkdtempSync(join(tmpdir(), 'mindmap-userData-'));
  const workspace = mkdtempSync(join(tmpdir(), 'mindmap-ws-'));
  const targetPath = join(workspace, '오늘의 생각.mind');
  writeFileSync(
    targetPath,
    JSON.stringify({
      version: 1,
      id: 'doc1',
      rootIds: ['r1'],
      nodes: { r1: { id: 'r1', text: '이미 있던 생각', parentId: null, children: [], collapsed: false } },
      view: { zoom: 1, panX: 0, panY: 0 },
    }),
    'utf-8',
  );

  const env = { ...process.env, MINDMAP_USER_DATA: userData, MINDMAP_WORKSPACE: workspace };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({ args: [join(__dirname, '../dist-electron/main.js')], env });
  const page = await app.firstWindow();

  try {
    await page.waitForSelector('.sidebar', { timeout: 15_000 });

    // 맵을 탭으로 연다 — 인메모리 store에 "이미 있던 생각" 하나만 로드된다.
    await page.click('.row', { timeout: 5_000 });
    await page.waitForSelector('.canvas', { timeout: 5_000 });
    await page.waitForSelector('.node', { timeout: 5_000 });

    // 뷰 상태 변경(화면 맞춤)만으로도 dirty가 켜진다 — 1초 뒤 자동저장 예약됨.
    await page.keyboard.press('Meta+0');

    // 자동저장(1초)이 뜨기 전에 같은 파일에 캡처를 써 넣는다.
    const [capturePage] = await Promise.all([
      app.waitForEvent('window'),
      page.evaluate(() => window.api.capture.show()),
    ]);
    await capturePage.waitForSelector('.capture-input', { timeout: 5_000 });
    await capturePage.fill('.capture-input', '새로운 생각');
    await capturePage.press('.capture-input', 'Enter');

    // 열려 있던 탭의 자동저장 타이머(1초)가 지나간 뒤에도 두 노드 모두 남아 있어야 한다.
    await page.waitForTimeout(1_800);

    const doc = JSON.parse(readFileSync(targetPath, 'utf-8'));
    const texts = doc.rootIds.map((id: string) => doc.nodes[id].text);
    expect(texts).toContain('이미 있던 생각');
    expect(texts).toContain('새로운 생각');

    // 열려 있던 탭 화면에도 캡처된 노드가 반영돼 있어야 한다(리로드 확인).
    await expect(page.locator('.node', { hasText: '새로운 생각' })).toBeVisible();
  } finally {
    await app.close().catch(() => {});
    rmSync(userData, { recursive: true, force: true });
    rmSync(workspace, { recursive: true, force: true });
  }
});
