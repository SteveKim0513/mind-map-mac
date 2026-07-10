import { test, expect, _electron as electron } from '@playwright/test';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { tmpdir } from 'os';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const TEMPLATE_BODY = '## 안건\n\n## 결정사항\n';
const TEMPLATE_CONTENT = `---
id: "tpl-test-001"
title: "회의록"
links: []
---

${TEMPLATE_BODY}`;

const NOTE_CONTENT = `---
id: "note-test-001"
title: "테스트 노트"
links: []
---

`;

test('노트 템플릿 — 삽입, 사이드바 패널, 설정 토글로 숨기기', async () => {
  const userData = mkdtempSync(join(tmpdir(), 'mindmap-userData-'));
  const workspace = mkdtempSync(join(tmpdir(), 'mindmap-ws-'));

  // 워크스페이스에 숨김 .templates 폴더를 미리 만들고 템플릿 노트 하나를 시딩한다.
  const templatesDir = join(workspace, '.templates');
  mkdirSync(templatesDir, { recursive: true });
  writeFileSync(join(templatesDir, '회의록.md'), TEMPLATE_CONTENT, 'utf-8');
  writeFileSync(join(workspace, '테스트 노트.md'), NOTE_CONTENT, 'utf-8');

  const env = { ...process.env, MINDMAP_USER_DATA: userData, MINDMAP_WORKSPACE: workspace };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({
    args: [join(__dirname, '../dist-electron/main.js')],
    env,
  });

  const page = await app.firstWindow();

  try {
    await page.waitForSelector('.sidebar', { timeout: 15_000 });

    // .templates는 dot-폴더라 트리에 보이지 않아야 한다 — "테스트 노트" 한 항목만 보임.
    await expect(page.locator('.row')).toHaveCount(1);

    // ── 노트 열기 → 템플릿+ 로 삽입 ──────────────────────────────────────
    await page.click('.row');
    await page.waitForSelector('.note-pane', { timeout: 5_000 });

    const tplBtn = page.locator('button[title="템플릿 추가"]');
    await expect(tplBtn).toBeVisible();
    await tplBtn.click();

    const search = page.locator('input[placeholder*="템플릿 검색"]');
    await expect(search).toBeVisible();
    await search.fill('회의');

    await page.click('.meta-add-item.tpl:has-text("회의록")');

    await expect(page.locator('.note-rich-body')).toContainText('안건');
    await expect(page.locator('.note-rich-body')).toContainText('결정사항');

    // ── 사이드바 Note Template 패널 ─────────────────────────────────────
    const sbTplBtn = page.locator('button[title*="Note Template"]');
    await expect(sbTplBtn).toBeVisible();
    await expect(page.locator('.sb-trash-badge')).toContainText('1');
    await sbTplBtn.click();
    await expect(page.locator('.wh-title:has-text("Note Template")')).toBeVisible();
    await expect(page.locator('.trash-row:has-text("회의록")')).toBeVisible();

    // 템플릿을 탭으로 열면 일반 노트 탭과 시각적으로 구분돼야 한다 (UX 감사 F-1/F-2).
    await page.click('.trash-row:has-text("회의록") .trash-act:has-text("열기")');
    await expect(page.locator('.tab:has-text("회의록") .tab-ic--template')).toBeVisible();
    await expect(page.locator('.tab:has-text("테스트 노트") .tab-ic--note')).toBeVisible();
    await expect(page.locator('.note-template-badge')).toBeVisible();
    await expect(page.locator('.note-link-btn')).toHaveCount(0);

    // 일반 노트 탭으로 돌아가면 배지가 없고 노드 연동 버튼은 그대로 있어야 한다(회귀 방지).
    await page.click('.tab:has-text("테스트 노트")');
    await expect(page.locator('.note-template-badge')).toHaveCount(0);
    await expect(page.locator('.note-link-btn')).toBeVisible();

    // ── 툴바 "새 템플릿 만들기"는 조용히 만들고 끝나지 않고 즉시 탭으로 열려야 한다 ──
    await page.click('button[title="템플릿 추가"]');
    await page.click('.meta-add-item.add');
    await expect(page.locator('.tab.active:has-text("새 템플릿")')).toBeVisible();
    await expect(page.locator('.tab.active .tab-ic--template')).toBeVisible();
    await expect(page.locator('.note-title')).toHaveValue('새 템플릿');
    await expect(page.locator('.note-template-badge')).toBeVisible();

    // ── 설정에서 토글을 끄면 툴바 버튼 + 사이드바 버튼이 함께 사라진다 ──
    await page.keyboard.press('Meta+,');
    await page.waitForSelector('.settings', { timeout: 3_000 });
    const templatesRow = page.locator('.set-row', { hasText: '노트 템플릿' });
    await templatesRow.locator('.seg-btn:has-text("꺼짐")').click();
    await page.keyboard.press('Escape');
    await page.waitForSelector('.settings', { state: 'hidden', timeout: 3_000 });

    await expect(page.locator('button[title*="Note Template"]')).toHaveCount(0);
    await expect(page.locator('button[title="템플릿 추가"]')).toHaveCount(0);
  } finally {
    await app.close().catch(() => {});
    rmSync(userData, { recursive: true, force: true });
    rmSync(workspace, { recursive: true, force: true });
  }
});
