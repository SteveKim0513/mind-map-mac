import { test, expect, type Page } from '@playwright/test';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import type { AppHandle } from './helpers';
import { shootBothThemes, startTestRelay, withApps, type TestRelay } from './shareHelpers';

// 공유 폴더 노트 실시간 공동편집(ADR 0021 단계 6b): 두 실제 Electron 인스턴스가 같은 노트를 동시에 편집한다.
// 각 테스트는 자체 릴레이·격리된 인스턴스를 쓴다(병렬 안전). 시각 확인: SHARE_E2E_SHOTS=<dir> 이면 라이트/다크 스크린샷 저장.

const OWNER = '지호';
const GUEST = '민수';
const FOLDER = '기획';
const NOTE_ID = 'e2e-collab-1';
// 파일 이름을 제목과 같게 둔다 — 제목 → 파일명 규칙이 노트를 여는 순간 이름을 바꾸지 않게(경로가 테스트 내내 안정).
const FILE = '회의 메모.md';
const NOTE_TEXT = [
  '---',
  `id: "${NOTE_ID}"`,
  'title: "회의 메모"',
  'links: []',
  '---',
  '# 회의 메모',
  '',
  '첫 문단입니다',
  '',
  '- 항목 하나',
  '- 항목 둘',
  '',
  '마지막 문단입니다',
].join('\n');

const folderRow = (page: Page, name: string) => page.locator(`.row[data-node-path$="/${name}"]`);
const PM = '.note-pane .note-rich .ProseMirror';

async function createSharedFolder(page: Page): Promise<string> {
  await folderRow(page, FOLDER).click({ button: 'right' });
  await page.locator('.ctx-menu .ctx-item:has-text("공유 폴더로 만들기")').click();
  await page.getByTestId('share-name-input').fill(OWNER);
  await page.getByTestId('share-create-submit').click();
  const code = page.getByTestId('share-invite-code');
  await expect(code).toBeVisible({ timeout: 15_000 });
  return (await code.innerText()).trim();
}

async function joinWithCode(page: Page, code: string, name: string): Promise<void> {
  await page.click('.sb-section-btn[title="공유 폴더 참가"]');
  await page.getByTestId('share-code-input').fill(code);
  await page.getByTestId('share-name-input').fill(name);
  await page.getByTestId('share-join-submit').click();
}

/** 사이드바에서 노트를 연다(폴더가 접혀 있으면 화살표로 펼친다 — 이름을 클릭하면 선택만 된다). */
async function openNote(h: AppHandle, file = FILE): Promise<void> {
  const page = h.page;
  const row = page.locator(`.row[data-node-path$="/${FOLDER}/${file}"]`);
  const shown = (ms: number) => row.waitFor({ state: 'visible', timeout: ms }).then(() => true, () => false);
  // 이미 펼쳐져 있는데 트리 갱신이 늦을 수 있으니 먼저 기다리고, 그래도 없을 때만 토글한다(토글은 접기·펴기가 번갈아 일어난다).
  for (let i = 0; i < 3 && !(await shown(i === 0 ? 8_000 : 3_000)); i++) {
    await folderRow(page, FOLDER).locator('svg').first().click();
  }
  await row.click();
  await expect(page.locator(PM)).toBeVisible({ timeout: 15_000 });
}

/** 에디터의 순수 본문 텍스트(다른 참가자의 캐럿 라벨 텍스트가 섞이지 않게 Tiptap API로 읽는다). */
const editorText = (page: Page): Promise<string> =>
  page.evaluate((sel) => (document.querySelector(sel) as unknown as { editor: { getText(): string } }).editor.getText(), PM);

/**
 * 에디터 안 위치(문서 시작/끝)로 캐럿을 옮기고 실제 DOM 포커스가 올 때까지 기다린다. Tiptap의 focus 명령은
 * DOM 포커스를 다음 animation frame으로 미루므로(화면 밖 창에서는 더 늦다) 기다리지 않고 바로 타이핑하면 첫 글자가 사라진다.
 */
async function focusAt(page: Page, where: 'start' | 'end'): Promise<void> {
  await page.evaluate(
    ([sel, w]) => {
      (document.querySelector(sel) as unknown as { editor: { commands: { focus(p: string): boolean } } }).editor.commands.focus(w);
    },
    [PM, where] as const,
  );
  await expect(page.locator(PM)).toBeFocused();
}

const count = (s: string, sub: string) => s.split(sub).length - 1;
const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

/**
 * A: 폴더 + 기존 노트를 만들어 공유 → B 참가 → B에 노트가 물질화될 때까지 기다린다.
 * 반환: 두 워크스페이스의 노트 경로.
 */
async function setupPair(relay: TestRelay, a: AppHandle, b: AppHandle): Promise<{ aNote: string; bNote: string }> {
  void relay;
  // 폴더와 노트를 파일로 먼저 만들고 렌더러를 다시 불러 트리가 읽게 한다(API로 만든 파일은 트리가 포커스 때만 갱신).
  const dir = join(a.workspace, FOLDER);
  mkdirSync(dir, { recursive: true });
  const aNote = join(dir, FILE);
  writeFileSync(aNote, NOTE_TEXT, 'utf-8');
  await a.page.reload();
  await expect(folderRow(a.page, FOLDER)).toBeVisible({ timeout: 15_000 });
  const code = await createSharedFolder(a.page);
  await expect(a.page.getByTestId('share-panel').getByTestId('share-status')).toHaveAttribute('data-status', 'connected', { timeout: 15_000 });
  await a.page.keyboard.press('Escape'); // 공유 패널 닫기(한 단계 복귀)
  await expect(a.page.getByTestId('share-panel')).toHaveCount(0);

  await joinWithCode(b.page, code, GUEST);
  await expect(folderRow(b.page, FOLDER)).toBeVisible({ timeout: 15_000 });
  const bNote = join(b.workspace, FOLDER, FILE);
  await expect.poll(() => existsSync(bNote), { timeout: 40_000, message: 'B에 소유자의 노트가 물질화됨' }).toBe(true);
  return { aNote, bNote };
}

test(
  '공유 노트 공동편집: 노트가 보이고, 동시 타이핑이 수렴하며, 캐럿 라벨·참가자 칩이 보이고, 자기 편집만 undo되고, 디스크에 파생된다',
  { tag: ['@share', '@note'] },
  async () => {
    test.setTimeout(180_000);
    const relay = await startTestRelay();
    try {
      await withApps(2, { MINDMAP_RELAY_URL: relay.url }, async ([a, b]) => {
        const { aNote } = await setupPair(relay, a, b);

        // (a) B가 탭에서 노트를 열면 내용이 보인다 — 공유 표식과 함께
        await openNote(b);
        await expect(b.page.locator(PM)).toContainText('첫 문단입니다', { timeout: 20_000 });
        await expect(b.page.locator(PM)).toContainText('마지막 문단입니다');
        await expect(b.page.getByTestId('note-shared-badge')).toContainText('공유됨');
        await expect(b.page.getByTestId('note-shared-badge')).toHaveAttribute('data-status', 'connected', { timeout: 15_000 });
        await expect(b.page.locator('.note-pane .note-save')).toHaveCount(0); // 공유 노트는 "저장됨" 대신 공유 표식

        await openNote(a);
        await expect(a.page.locator(PM)).toContainText('첫 문단입니다', { timeout: 20_000 });

        // (b) 서로 다른 위치에서 동시에 타이핑 → 같은 텍스트로 수렴(중복·소실 없음)
        await Promise.all([focusAt(a.page, 'start'), focusAt(b.page, 'end')]);
        await Promise.all([a.page.keyboard.type('AAA', { delay: 40 }), b.page.keyboard.type('BBB', { delay: 40 })]);
        await expect
          .poll(
            async () => {
              const [ta, tb] = await Promise.all([editorText(a.page), editorText(b.page)]);
              return ta === tb && count(ta, 'AAA') === 1 && count(ta, 'BBB') === 1;
            },
            { timeout: 30_000, message: '두 에디터가 같은 텍스트로 수렴' },
          )
          .toBe(true);
        const converged = await editorText(a.page);
        expect(converged).toContain('AAA회의 메모');
        expect(converged).toContain('마지막 문단입니다BBB');
        expect(count(converged, '첫 문단입니다')).toBe(1); // 중복 시드 없음

        // (c) 상대의 캐럿 라벨(이름)이 보이고, 헤더에 함께 보는 사람 칩이 뜬다(자기 자신 제외)
        await expect(b.page.locator('.collab-caret-label', { hasText: OWNER })).toBeVisible({ timeout: 15_000 });
        await expect(a.page.locator('.collab-caret-label', { hasText: GUEST })).toBeVisible({ timeout: 15_000 });
        await expect(b.page.locator('[data-testid="collab-peer"][data-name="' + OWNER + '"]')).toBeVisible({ timeout: 15_000 });
        await expect(b.page.getByTestId('collab-peer')).toHaveCount(1); // 나(민수)는 칩에 없다
        await expect(a.page.locator('[data-testid="collab-peer"][data-name="' + GUEST + '"]')).toBeVisible({ timeout: 15_000 });
        await shootBothThemes(a.page, 'collab-a-editor');
        await shootBothThemes(b.page, 'collab-b-editor');

        // 원격 캐럿이 자기 편집 자리로 옮겨 다니지 않는지, 외부 변경 프롬프트가 뜨지 않는지(공유 노트는 매니저가 처리)
        await expect(a.page.locator('.toast', { hasText: '다른 곳에서 바뀌었어요' })).toHaveCount(0);
        await expect(b.page.locator('.toast', { hasText: '다른 곳에서 바뀌었어요' })).toHaveCount(0);

        // (d) 디바운스 후 A의 디스크 .md가 편집 결과와 일치하고 프론트매터가 보존된다
        await expect
          .poll(() => readFileSync(aNote, 'utf-8').includes('BBB'), { timeout: 30_000, message: 'A의 파일에 파생 md가 쓰임' })
          .toBe(true);
        const disk = readFileSync(aNote, 'utf-8');
        expect(disk).toContain(`id: "${NOTE_ID}"`);
        expect(disk).toContain('title: "회의 메모"');
        expect(disk).toContain('AAA회의 메모');
        expect(disk).toContain('마지막 문단입니다BBB');
        expect(count(disk, 'AAA')).toBe(1);
        expect(count(disk, '첫 문단입니다')).toBe(1);
        expect(count(disk, '- 항목 하나')).toBe(1);

        // A의 undo는 자기 편집(AAA)만 되돌린다 — B의 BBB는 남고, 두 화면이 다시 수렴한다
        await focusAt(a.page, 'start');
        await a.page.keyboard.press('ControlOrMeta+z');
        await expect
          .poll(async () => {
            const [ta, tb] = await Promise.all([editorText(a.page), editorText(b.page)]);
            return ta === tb && !ta.includes('AAA') && ta.includes('마지막 문단입니다BBB');
          }, { timeout: 20_000, message: 'undo가 자기 편집만 되돌림' })
          .toBe(true);
        await a.page.keyboard.press('ControlOrMeta+Shift+z');
        await expect
          .poll(async () => (await editorText(b.page)).includes('AAA회의 메모'), { timeout: 20_000, message: 'redo가 복원됨' })
          .toBe(true);
      });
    } finally {
      await relay.close();
    }
  },
);

test(
  '공유 노트: 이미지 삽입은 막히고 토스트로 알리며, 제목 변경이 상대에게 전파된다(파일명은 각자 로컬 규칙)',
  { tag: ['@share', '@note'] },
  async () => {
    test.setTimeout(180_000);
    const relay = await startTestRelay();
    try {
      await withApps(2, { MINDMAP_RELAY_URL: relay.url }, async ([a, b]) => {
        const { aNote, bNote } = await setupPair(relay, a, b);
        await openNote(a);
        await openNote(b);
        await expect(b.page.locator(PM)).toContainText('첫 문단입니다', { timeout: 20_000 });

        // (e) 툴바 이미지 선택 → 삽입되지 않고 토스트
        const toastText = '공유 폴더 노트에는 아직 이미지를 넣을 수 없어요';
        await a.page.locator('.note-pane .note-rich input[type="file"]').setInputFiles({ name: 'x.png', mimeType: 'image/png', buffer: TINY_PNG });
        await expect(a.page.locator('.toast', { hasText: toastText })).toBeVisible({ timeout: 5_000 });
        await expect(a.page.locator(`${PM} img`)).toHaveCount(0);
        // 붙여넣기(이미지 파일이 든 클립보드)도 막힌다
        await a.page.evaluate(async (sel) => {
          const el = document.querySelector(sel) as HTMLElement;
          const dt = new DataTransfer();
          dt.items.add(new File([new Uint8Array([137, 80, 78, 71])], 'p.png', { type: 'image/png' }));
          el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
        }, PM);
        await expect(a.page.locator(`${PM} img`)).toHaveCount(0);
        await shootBothThemes(a.page, 'collab-image-blocked');

        // (f) A가 제목을 바꾸면 B의 제목 입력·파일에 전파되고, 파일 이름은 각자 로컬 규칙(제목 → 파일명)으로 따라간다
        const NEW_TITLE = '새 회의 제목';
        await a.page.locator('.note-pane .note-title').fill(NEW_TITLE);
        await expect(b.page.locator('.note-pane .note-title')).toHaveValue(NEW_TITLE, { timeout: 30_000 });
        const listMd = (ws: string) => readdirSync(join(ws, FOLDER)).filter((n) => n.endsWith('.md'));
        await expect
          .poll(() => listMd(a.workspace).includes(`${NEW_TITLE}.md`), { timeout: 20_000, message: 'A의 파일명이 제목을 따라감' })
          .toBe(true);
        await expect
          .poll(() => listMd(b.workspace).some((n) => readFileSync(join(b.workspace, FOLDER, n), 'utf-8').includes(`title: "${NEW_TITLE}"`)), {
            timeout: 30_000,
            message: 'B의 프론트매터 제목이 갱신됨',
          })
          .toBe(true);
        // 제목 변경·이름 변경 흐름에서 본문이 중복되거나 사라지지 않는다
        for (const [ws, orig] of [[a.workspace, aNote], [b.workspace, bNote]] as const) {
          void orig;
          const files = listMd(ws);
          expect(files).toHaveLength(1);
          const text = readFileSync(join(ws, FOLDER, files[0]), 'utf-8');
          expect(count(text, '첫 문단입니다')).toBe(1);
          expect(count(text, '마지막 문단입니다')).toBe(1);
          expect(text).toContain(`id: "${NOTE_ID}"`);
        }
        await expect(a.page.locator(PM)).toContainText('첫 문단입니다'); // 이름이 바뀐 뒤에도 에디터가 그대로(공유 유지)
        await expect(a.page.getByTestId('note-shared-badge')).toContainText('공유됨');
      });
    } finally {
      await relay.close();
    }
  },
);

test(
  '공유 노트: 강퇴되면 에디터가 읽기 전용이 되고 안내가 뜨며 로컬 파일은 남는다',
  { tag: ['@share', '@note'] },
  async () => {
    test.setTimeout(180_000);
    const relay = await startTestRelay();
    try {
      await withApps(2, { MINDMAP_RELAY_URL: relay.url }, async ([a, b]) => {
        const { bNote } = await setupPair(relay, a, b);
        await openNote(b);
        await expect(b.page.locator(PM)).toContainText('첫 문단입니다', { timeout: 20_000 });
        await expect(b.page.locator(PM)).toHaveAttribute('contenteditable', 'true');

        // A가 참가자 B를 내보낸다
        await folderRow(a.page, FOLDER).getByTestId('share-badge').click();
        const panelA = a.page.getByTestId('share-panel');
        await expect(panelA.getByTestId('share-person')).toHaveCount(2, { timeout: 20_000 });
        await panelA.locator('.share-person', { hasText: GUEST }).getByTestId('share-revoke').click();
        await a.page.getByTestId('share-confirm-revoke').click();
        await expect(panelA.getByTestId('share-person')).toHaveCount(1, { timeout: 10_000 });

        // (g) B의 에디터: 읽기 전용 + 안내, 내용과 로컬 파일은 그대로
        await expect(b.page.getByTestId('note-collab-notice')).toContainText('내보내져', { timeout: 30_000 });
        await expect(b.page.locator(PM)).toHaveAttribute('contenteditable', 'false');
        await expect(b.page.getByTestId('note-shared-badge')).toHaveAttribute('data-status', 'denied');
        await expect(b.page.locator('.note-pane .note-title')).toHaveJSProperty('readOnly', true);
        await expect(b.page.locator(PM)).toContainText('첫 문단입니다');
        await shootBothThemes(b.page, 'collab-b-kicked');
        // 읽기 전용이라 타이핑해도 바뀌지 않는다
        const before = await editorText(b.page);
        await b.page.locator(PM).click({ force: true });
        await b.page.keyboard.type('ZZZ');
        expect(await editorText(b.page)).toBe(before);
        expect(existsSync(bNote)).toBe(true);
        expect(readFileSync(bNote, 'utf-8')).toContain('첫 문단입니다');
      });
    } finally {
      await relay.close();
    }
  },
);
