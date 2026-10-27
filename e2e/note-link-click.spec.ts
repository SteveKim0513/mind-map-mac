import { test, expect, type Page } from '@playwright/test';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { launchApp, type AppHandle } from './helpers';

const NOTE = `---
id: "n-link"
title: "링크 노트"
links: []
---

첫 문단 [네이버](https://naver.com) 링크

둘째 문단

셋째 문단
`;

// 앱을 띄우기 전에 노트를 시딩한다(사이드바는 실행 시 워크스페이스를 읽는다).
async function launchWithNote(): Promise<AppHandle & { dispose: () => Promise<void> }> {
  const userData = mkdtempSync(join(tmpdir(), 'mindmap-userData-'));
  const workspace = mkdtempSync(join(tmpdir(), 'mindmap-ws-'));
  writeFileSync(join(workspace, '링크 노트.md'), NOTE, 'utf-8');
  const h = await launchApp({ reuse: { userData, workspace } });
  const dispose = async () => {
    await h.cleanup();
    rmSync(userData, { recursive: true, force: true });
    rmSync(workspace, { recursive: true, force: true });
  };
  return { ...h, dispose };
}

async function openNote(page: Page) {
  await page.click('.row:has-text("링크 노트")', { timeout: 10_000 });
  await page.waitForSelector('.note-rich .ProseMirror a', { timeout: 10_000 });
}

test('노트 링크를 그냥 클릭하면 열린다', { tag: ['@note'] }, async () => {
  const h = await launchWithNote();
  try {
    await openNote(h.page);
    // 실제 브라우저가 뜨지 않게 window.open을 가로채 호출을 기록한다.
    await h.page.evaluate(() => {
      const w = window as unknown as { __opened: string[] };
      w.__opened = [];
      window.open = ((u?: string | URL) => {
        w.__opened.push(String(u));
        return null;
      }) as typeof window.open;
    });
    await h.page.click('.note-rich .ProseMirror a');
    await expect
      .poll(() => h.page.evaluate(() => (window as unknown as { __opened: string[] }).__opened))
      .toEqual(['https://naver.com']);
  } finally {
    await h.dispose();
  }
});

test('링크에 마우스를 올리면 실제 주소가 보인다', { tag: ['@note'] }, async () => {
  const h = await launchWithNote();
  try {
    await openNote(h.page);
    await h.page.hover('.note-rich .ProseMirror a');
    await expect(h.page.locator('.note-link-tip')).toContainText('https://naver.com');
    await h.page.mouse.move(5, 5);
    await expect(h.page.locator('.note-link-tip')).toHaveCount(0);
  } finally {
    await h.dispose();
  }
});

test('노트 맨 아래 빈 공간을 누르면 커서가 문서 끝에 놓인다', { tag: ['@note'] }, async () => {
  const h = await launchWithNote();
  try {
    await openNote(h.page);
    const body = h.page.locator('.note-rich-body');
    const box = (await body.boundingBox())!;
    await body.click({ position: { x: box.width / 2, y: box.height - 8 } });
    // 캐럿 이동은 한 프레임 뒤에 적용된다 — 커서가 문서 끝에 놓일 때까지 기다린 뒤 입력한다.
    await expect
      .poll(() =>
        h.page.evaluate(() => {
          const sel = window.getSelection();
          return sel?.isCollapsed && sel.anchorNode?.textContent === '셋째 문단' && sel.anchorOffset === 5;
        }),
      )
      .toBe(true);
    await h.page.keyboard.type('끝');
    await expect(h.page.locator('.note-rich .ProseMirror p').last()).toHaveText('셋째 문단끝');
  } finally {
    await h.dispose();
  }
});
