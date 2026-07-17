import { test, expect, type Page } from '@playwright/test';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { launchApp, createNoteFromMenu } from './helpers';

// C1/C2 회귀 그물망 (docs/exec-plans/active/2026-07-17-e2e-gap-qa-fixes.md):
// 표 편집은 그동안 E2E 커버리지가 0이라 데이터 손실을 냈던 영역이다.
//  · C1 — 셀 안에서 Tab은 다음 셀로 이동해야 한다(포커스가 툴바로 튀지 않음).
//  · C2 — 셀에 파이프("x|y")를 넣어도 마크다운 직렬화 시 이스케이프되어
//         라운드트립 후 표가 리터럴 텍스트로 무너지지 않는다.
// 직렬화 단위는 src/note/tableMarkdown.test.ts가 mock으로 커버하지만, mock의
// renderInline은 write(문자열)만 호출한다. 실제 prosemirror-markdown는 text()
// 안에서 write()를 "인자 없이" 호출하므로 실제 에디터 경로가 진짜 회귀를 드러낸다.

/** Insert a 3x3 table via the slash menu. Caret ends in the first (header) cell. */
async function insertTable(page: Page) {
  await createNoteFromMenu(page);
  const body = page.locator('.note-rich .ProseMirror');
  await body.click();
  await page.keyboard.type('/');
  await page.waitForSelector('.slash-menu', { timeout: 2_000 });
  await page.locator('.slash-item', { hasText: '표' }).click();
  await page.waitForSelector('.note-rich table', { timeout: 3_000 });
  // insertTable은 캐럿을 첫 셀에 두고 에디터를 포커스한다(pick()의 .chain().focus()).
  // 셀을 클릭하면 행 드래그 핸들 위젯을 잘못 눌러 입력이 유실되므로 바로 타이핑한다.
  await expect(body).toBeFocused();
}

const cellTexts = (page: Page) =>
  page.locator('.note-rich table th, .note-rich table td').allTextContents();

// ── C1 · Tab이 셀 사이를 이동한다 ────────────────────────────────────────────
test('표: Tab이 A·B·C를 서로 다른 셀로 이동시킨다(한 셀에 뭉치지 않음)', { tag: ['@note'] }, async () => {
  const { page, cleanup } = await launchApp();
  try {
    await insertTable(page);
    await page.keyboard.type('A');
    await page.keyboard.press('Tab');
    await page.keyboard.type('B');
    await page.keyboard.press('Tab');
    await page.keyboard.type('C');

    const cells = await cellTexts(page);
    expect(cells).toContain('A');
    expect(cells).toContain('B');
    expect(cells).toContain('C');
    // Tab이 안 먹혔다면 한 셀에 "ABC"로 뭉쳤을 것
    expect(cells).not.toContain('ABC');
  } finally {
    await cleanup();
  }
});

// ── C2 · 파이프 셀이 마크다운 라운드트립 후에도 표를 유지한다 ─────────────────
test('표: 셀 내용(파이프 포함)이 디스크 마크다운 라운드트립 후에도 살아남는다', { tag: ['@note'] }, async () => {
  const { page, workspace, cleanup } = await launchApp();
  try {
    await insertTable(page);
    await page.keyboard.type('A');
    await page.keyboard.press('Tab');
    await page.keyboard.type('B');
    await page.keyboard.press('Tab');
    await page.keyboard.type('C');
    await page.keyboard.press('Tab');
    await page.keyboard.type('x|y'); // 리터럴 파이프

    // DOM에는 분명히 값이 들어가 있다
    const before = await cellTexts(page);
    expect(before).toContain('x|y');
    expect(before).toContain('A');

    // ── 디스크 마크다운: 진짜 GFM 표 + 셀 내용 보존 + 이스케이프된 파이프 ─────
    await page.waitForTimeout(1_200); // note autosave(800ms) + 여유
    const mdName = readdirSync(workspace).find((f) => f.endsWith('.md'));
    if (!mdName) throw new Error('no .md file written');
    const md = readFileSync(join(workspace, mdName), 'utf-8');
    expect(md).toMatch(/\|\s*---\s*\|/); // 구분선 행 → 파라그래프가 아니라 표
    // 셀 내용이 보존돼야 한다 — 빈 격자(|  |  |)로 저장되면 데이터 손실
    expect(md).toMatch(/\|\s*A\s*\|\s*B\s*\|\s*C\s*\|/);
    expect(md).toContain('x\\|y'); // C2: 파이프가 이스케이프됨(표를 붕괴시키지 않음)

    // ── 재열기(마크다운 → 에디터 파싱) 라운드트립 — 표 구조·값 생존 ───────────
    await page.keyboard.press('Meta+w'); // 활성 탭 닫기
    await page.waitForSelector('.note-rich', { state: 'detached', timeout: 5_000 }).catch(() => {});
    await page.locator('.row').first().click(); // 사이드바에서 노트 재열기
    await page.waitForSelector('.note-rich table', { timeout: 5_000 });

    const after = await cellTexts(page);
    expect(after).toContain('x|y'); // 파이프 복원(리터럴 텍스트로 무너지지 않음)
    expect(after).toContain('A');
    expect(after).toContain('B');
    expect(after).toContain('C');
  } finally {
    await cleanup();
  }
});
