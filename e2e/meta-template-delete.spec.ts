import { test, expect, _electron as electron } from '@playwright/test';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { tmpdir } from 'os';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const TEMPLATE_ID = 'tmpl-test-001';
const TEMPLATE_NAME = '테스트 메타';
const FIELD_KEY = 'author';

const META_TEMPLATES = JSON.stringify([
  {
    id: TEMPLATE_ID,
    name: TEMPLATE_NAME,
    fields: [{ key: FIELD_KEY, label: '작가', type: 'text' }],
  },
]);

const NOTE_CONTENT = `---
id: "note-test-001"
title: "테스트 노트"
links: []
_meta: [{"templateId":"${TEMPLATE_ID}","values":{"${FIELD_KEY}":"홍길동"}}]
---

노트 본문입니다.
`;

test('템플릿 삭제 시 노트의 메타 블록이 즉시 사라지고 파일에서도 제거된다', { tag: ['@note'] }, async () => {
  // ── 격리된 환경 세팅 ─────────────────────────────────────────────────────
  const userData = mkdtempSync(join(tmpdir(), 'mindmap-userData-'));
  const workspace = mkdtempSync(join(tmpdir(), 'mindmap-ws-'));
  const notePath = join(workspace, '테스트 노트.md');

  // 메타 템플릿 파일을 userData에 미리 작성
  writeFileSync(join(userData, 'meta-templates.json'), META_TEMPLATES, 'utf-8');
  // _meta 블록이 있는 노트 파일을 워크스페이스에 미리 작성
  writeFileSync(notePath, NOTE_CONTENT, 'utf-8');

  const env = { ...process.env, MINDMAP_USER_DATA: userData, MINDMAP_WORKSPACE: workspace };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({
    args: [join(__dirname, '../dist-electron/main.js')],
    env,
  });

  const page = await app.firstWindow();

  try {
    await page.waitForSelector('.sidebar', { timeout: 15_000 });

    // ── 노트 열기 ────────────────────────────────────────────────────────
    await page.click('.row', { timeout: 5_000 });
    await page.waitForSelector('.note-pane', { timeout: 5_000 });

    // 메타 블록이 노트 UI에 표시되는지 확인
    await expect(page.locator('.meta-block-title').first()).toBeVisible({ timeout: 5_000 });
    await expect(page.locator('.meta-block-title').first()).toContainText(TEMPLATE_NAME);

    // 삭제된 템플릿 경고가 없어야 함 (정상 상태)
    await expect(page.locator('.meta-block--deleted')).toHaveCount(0);

    // ── 설정 열기 → 정보 양식 서브스크린 (고급 설정 아래) ─────────────────
    await page.keyboard.press('Meta+,');
    await page.waitForSelector('.settings', { timeout: 3_000 });

    // 고급 설정을 펼쳐야 정보 양식 링크가 보인다
    await page.click('.set-advanced-toggle');

    // 정보 양식 서브스크린으로 이동
    await page.click('.set-link:has-text("정보 양식")');
    await page.waitForSelector('.set-meta-item', { timeout: 3_000 });
    await expect(page.locator('.set-meta-name')).toContainText(TEMPLATE_NAME);

    // 삭제는 이제 확인 대화상자를 거친다(모든 노트에서 함께 사라지는 파괴적 동작이라 —
    // UX-CLARITY-VISION 전략 H) — 네이티브 dialog.showMessageBox를 자동 확인으로 스텁.
    await app.evaluate(({ dialog }) => {
      dialog.showMessageBox = (async () => ({ response: 0, checkboxChecked: false })) as typeof dialog.showMessageBox;
    });

    // 삭제 버튼 클릭
    await page.click('.set-meta-del');

    // 목록에서 사라졌는지 확인
    await expect(page.locator('.set-meta-item')).toHaveCount(0, { timeout: 3_000 });

    // 설정 닫기
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    await page.waitForSelector('.settings', { state: 'hidden', timeout: 3_000 });

    // ── 노트 UI에서 메타 블록이 사라졌는지 확인 ─────────────────────────
    await expect(page.locator('.meta-block')).toHaveCount(0, { timeout: 3_000 });
    await expect(page.locator('.meta-block--deleted')).toHaveCount(0);

    // ── 파일에서도 _meta가 제거됐는지 확인 (autosave 대기 1200ms) ────────
    await page.waitForTimeout(1_200);
    const diskContent = readFileSync(notePath, 'utf-8');
    expect(diskContent).not.toContain('_meta');
    expect(diskContent).not.toContain(TEMPLATE_ID);
  } finally {
    await app.close().catch(() => {});
    rmSync(userData, { recursive: true, force: true });
    rmSync(workspace, { recursive: true, force: true });
  }
});

test('취소하면 양식과 메타 블록이 그대로 남는다', { tag: ['@note'] }, async () => {
  const userData = mkdtempSync(join(tmpdir(), 'mindmap-userData-'));
  const workspace = mkdtempSync(join(tmpdir(), 'mindmap-ws-'));
  const notePath = join(workspace, '테스트 노트.md');

  writeFileSync(join(userData, 'meta-templates.json'), META_TEMPLATES, 'utf-8');
  writeFileSync(notePath, NOTE_CONTENT, 'utf-8');

  const env = { ...process.env, MINDMAP_USER_DATA: userData, MINDMAP_WORKSPACE: workspace };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({
    args: [join(__dirname, '../dist-electron/main.js')],
    env,
  });
  const page = await app.firstWindow();

  try {
    await page.waitForSelector('.sidebar', { timeout: 15_000 });
    await page.click('.row', { timeout: 5_000 });
    await page.waitForSelector('.note-pane', { timeout: 5_000 });

    await page.keyboard.press('Meta+,');
    await page.waitForSelector('.settings', { timeout: 3_000 });
    await page.click('.set-advanced-toggle');
    await page.click('.set-link:has-text("정보 양식")');
    await page.waitForSelector('.set-meta-item', { timeout: 3_000 });

    // 대화상자에서 "취소"(두 번째 버튼, index 1)를 누른 것으로 스텁.
    await app.evaluate(({ dialog }) => {
      dialog.showMessageBox = (async () => ({ response: 1, checkboxChecked: false })) as typeof dialog.showMessageBox;
    });
    await page.click('.set-meta-del');

    // 취소했으므로 목록에 그대로 남아 있어야 한다.
    await expect(page.locator('.set-meta-item')).toHaveCount(1);
    await expect(page.locator('.set-meta-name')).toContainText(TEMPLATE_NAME);

    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    await page.waitForSelector('.settings', { state: 'hidden', timeout: 3_000 });

    // 노트의 메타 블록도 그대로.
    await expect(page.locator('.meta-block-title').first()).toContainText(TEMPLATE_NAME);
  } finally {
    await app.close().catch(() => {});
    rmSync(userData, { recursive: true, force: true });
    rmSync(workspace, { recursive: true, force: true });
  }
});
