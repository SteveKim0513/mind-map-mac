import { test, expect } from '@playwright/test';
import { readFileSync, readdirSync, writeFileSync, utimesSync } from 'fs';
import { join } from 'path';
import { launchApp, createNoteFromMenu } from './helpers';

// D2 (docs/exec-plans/active/2026-07-17-e2e-gap-qa-fixes.md): 열려 있는 노트가 다른
// 곳(다른 앱/기기/동기화)에서 바뀌면, 이 탭의 stale 인메모리 사본이 다음 autosave로
// 조용히 덮어쓰면 안 된다. 창이 포커스를 되찾을 때 외부 변경을 감지해 경고 토스트를
// 띄우고, 사용자가 "불러오기"를 누르면 디스크 버전으로 다시 읽어들인다.
//
// @serial: win.focus()로 외부변경 새로고침을 트리거 — 병렬 인스턴스가 macOS frontmost를
// 두고 경쟁하면 포커스가 안 잡혀 깨진다. file-management.spec.ts의 refocus 테스트와 동일.

test('열린 노트가 외부에서 바뀌면 경고 토스트가 뜨고, 불러오면 외부 내용으로 갱신된다(덮어쓰지 않음)', { tag: ['@note', '@serial'] }, async () => {
  test.setTimeout(45_000);
  const { app, page, workspace, cleanup } = await launchApp();
  try {
    // ── 노트 생성 + 본문 입력 + autosave 완료 대기 ─────────────────────────
    await createNoteFromMenu(page);
    const body = page.locator('.note-rich .ProseMirror');
    await body.click();
    await page.keyboard.type('원래내용ABC');

    const mdName = () => readdirSync(workspace).find((f) => f.endsWith('.md'));
    // autosave(800ms)가 본문을 디스크에 쓸 때까지 폴링 → 이 시점부터 탭은 dirty=false
    await expect
      .poll(() => {
        const n = mdName();
        return n ? readFileSync(join(workspace, n), 'utf-8').includes('원래내용ABC') : false;
      }, { timeout: 6_000 })
      .toBe(true);

    const notePath = join(workspace, mdName()!);

    // ── 외부 변경 시뮬레이션: 디스크의 .md를 다른 내용으로 덮어쓴다 ───────────
    // 다른 앱이 프론트매터까지 새로 쓴 상황(다른 id) → 재열기 시 에디터가 리마운트되며
    // 외부 내용을 보여준다. mtime을 확실히 앞당겨 external-change 감지를 보장.
    // 제목은 그대로 두어(제목→파일명 동기화로) 파일이 리네임되지 않게 한다.
    const external = [
      '---',
      'id: "ext-changed-note-xyz"',
      'title: "제목 없음"',
      'links: []',
      '---',
      '',
      '외부에서바뀐내용XYZ',
      '',
    ].join('\n');
    writeFileSync(notePath, external, 'utf-8');
    const future = new Date(Date.now() + 3_000);
    utimesSync(notePath, future, future); // seenMtime 기준선보다 확실히 큰 mtime

    // ── 창 blur → focus 로 외부변경 검사(onWorkspaceFocus)를 트리거 ───────────
    // 헤드리스/오프스크린 Electron에서 focus 이벤트 전달은 타이밍에 취약하고 전체 스위트
    // 부하에선 더 느리다 → 토스트가 뜰 때까지 blur/focus를 재시도(dedup은 mtime 기준이라
    // 반복해도 토스트는 하나만). 시간 기반 sleep 없이 조건 대기.
    const warnToast = page.locator('.toast--action', { hasText: '다른 곳에서 바뀌었어요' });
    await expect(async () => {
      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].blur());
      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].focus());
      await expect(warnToast).toBeVisible({ timeout: 3_000 });
    }).toPass({ timeout: 25_000 });

    // ── "불러오기" 클릭 → 디스크(외부) 버전으로 재로드 ──────────────────────
    await warnToast.locator('.toast-action', { hasText: '불러오기' }).click();

    // 에디터가 외부 내용으로 갱신되었고, stale 원래 내용은 사라졌다(조용히 덮어쓰지 않음)
    await expect(page.locator('.note-rich .ProseMirror')).toContainText('외부에서바뀐내용XYZ', { timeout: 10_000 });
    await expect(page.locator('.note-rich .ProseMirror')).not.toContainText('원래내용ABC');

    // 디스크도 외부 내용 그대로(인메모리 stale 사본으로 되덮이지 않았다)
    await page.waitForTimeout(1_200);
    expect(readFileSync(notePath, 'utf-8')).toContain('외부에서바뀐내용XYZ');
    expect(readFileSync(notePath, 'utf-8')).not.toContain('원래내용ABC');
  } finally {
    await cleanup();
  }
});
