import { test, expect, type Page } from '@playwright/test';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'fs';
import { join } from 'path';
import type { AppHandle } from './helpers';
import { shootBothThemes, startTestRelay, withApps as launchApps } from './shareHelpers';

// 보드의 노트 링크는 노트 id 기반(ADR 0022) — 공유 폴더 참가자에게도 칩이 작동한다.
// 소유자가 공유 폴더 안 노트를 스티키에 링크하면 참가자 미러 보드에 칩이 보이고(경로 없음, id만) 눌러 그 노트가 열린다.
// 공유 폴더 밖 노트에 건 링크는 참가자에게 칩이 없다. 노트 이름을 바꿔도 칩이 계속 작동한다(id 해석).
// 각 테스트는 자체 릴레이·격리된 인스턴스를 쓴다(병렬 안전). 시각 확인: SHARE_E2E_SHOTS=<dir> → 라이트/다크 스크린샷.

const OWNER = '지호';
const GUEST = '민수';
const FOLDER = '기획';
const BOARD_NAME = '아이디어';
const SHARED_NOTE_ID = 'e2e-linked-note';
const SHARED_NOTE_TITLE = '회의';
const PRIVATE_NOTE_ID = 'e2e-private-note';
const PRIVATE_NOTE_TITLE = '개인 일기';
const PM = '.note-pane .note-rich .ProseMirror';

const noteText = (id: string, title: string, body: string) => ['---', `id: "${id}"`, `title: "${title}"`, 'links: []', '---', body].join('\n');

const BOARD_TEXT = JSON.stringify(
  {
    version: 1,
    id: 'e2e-idea',
    elements: {
      s1: { id: 's1', kind: 'sticky', x: 40, y: 120, width: 200, height: 140, text: '공유 노트에 연결', color: 'yellow' },
      s2: { id: 's2', kind: 'sticky', x: 320, y: 120, width: 200, height: 140, text: '개인 노트에 연결', color: 'green' },
    },
    order: ['s1', 's2'],
    view: { zoom: 1, panX: 0, panY: 0 },
  },
  null,
  2,
);

const folderRow = (page: Page, name: string) => page.locator(`.row[data-node-path$="/${name}"]`);
// 사이드바 파일 행은 종류 아이콘으로 찾는다 — 파일명 문자열은 macOS에서 유니코드 정규화(NFC/NFD)가 달라 못 믿는다.
const boardRow = (page: Page) => page.locator('.row:has(.ficon--board)').first();
const sticky = (page: Page, text: string) => page.locator('.board-el--sticky', { hasText: text });
const chipOf = (page: Page, stickyText: string) => sticky(page, stickyText).locator('.board-sticky-link');

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

/** 두 인스턴스를 (a, b)로 받는 얇은 어댑터 — 실제 기동·정리·실패 진단은 shareHelpers의 withApps가 맡는다. */
function withApps<T>(env: Record<string, string>, run: (a: AppHandle, b: AppHandle) => Promise<T>): Promise<T> {
  return launchApps(2, env, ([a, b]) => run(a, b));
}

const listMd = (ws: string) => readdirSync(join(ws, FOLDER)).filter((n) => n.endsWith('.md'));
const mdWithId = (ws: string, id: string) => listMd(ws).find((n) => readFileSync(join(ws, FOLDER, n), 'utf-8').includes(`id: "${id}"`)) ?? null;

interface Setup {
  aBoard: string;
  bBoard: string;
  aSharedNote: string;
}

/**
 * 소유자 A: 공유 폴더(기획) 안에 노트 "회의"와 보드(스티키 2개)를, 폴더 밖(워크스페이스 루트)에 노트 "개인 일기"를 둔다(파일로 먼저 만들고
 * 렌더러를 다시 불러 트리·노트 인덱스가 읽게 한다). 폴더를 공유하고 B가 참가해 노트·보드가 미러링될 때까지 진행한다.
 */
async function setupShared(a: AppHandle, b: AppHandle): Promise<Setup> {
  const dir = join(a.workspace, FOLDER);
  mkdirSync(dir, { recursive: true });
  const aSharedNote = join(dir, `${SHARED_NOTE_TITLE}.md`);
  writeFileSync(aSharedNote, noteText(SHARED_NOTE_ID, SHARED_NOTE_TITLE, '# 회의\n\n공유 회의 본문 XYZ\n'), 'utf-8');
  writeFileSync(join(a.workspace, `${PRIVATE_NOTE_TITLE}.md`), noteText(PRIVATE_NOTE_ID, PRIVATE_NOTE_TITLE, '개인 본문\n'), 'utf-8');
  const aBoard = join(dir, `${BOARD_NAME}.board`);
  writeFileSync(aBoard, BOARD_TEXT, 'utf-8');
  await a.page.reload();
  await expect(folderRow(a.page, FOLDER)).toBeVisible({ timeout: 15_000 });

  const code = await createSharedFolder(a.page);
  await expect(a.page.getByTestId('share-panel').getByTestId('share-status')).toHaveAttribute('data-status', 'connected', { timeout: 15_000 });
  await a.page.keyboard.press('Escape'); // 공유 패널 닫기(한 단계 복귀)
  await expect(a.page.getByTestId('share-panel')).toHaveCount(0);
  await joinWithCode(b.page, code, GUEST);
  await expect(folderRow(b.page, FOLDER)).toBeVisible({ timeout: 15_000 });
  const bBoard = join(b.workspace, FOLDER, `${BOARD_NAME}.board`);
  await expect
    .poll(() => existsSync(bBoard) && mdWithId(b.workspace, SHARED_NOTE_ID) !== null, { timeout: 40_000, message: 'B에 소유자의 노트·보드가 미러링됨' })
    .toBe(true);
  return { aBoard, bBoard, aSharedNote };
}

/** 사이드바에서 보드 행이 보이게 하고 연다. 미러링된 직후에는 트리가 옛 상태일 수 있어 앱이 돌아올 때 main이 보내는 'workspace:focus'를 보낸다(실제 경로와 같다). */
async function openBoard(h: AppHandle): Promise<void> {
  const row = boardRow(h.page);
  const folderTwisty = folderRow(h.page, FOLDER).locator('.twisty--dir');
  let lastNudge = 0;
  await expect
    .poll(
      async () => {
        if (await row.isVisible()) return true;
        if (Date.now() - lastNudge > 3_000) {
          lastNudge = Date.now();
          await h.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.webContents.send('workspace:focus'));
          if ((await folderTwisty.count()) > 0 && (await folderRow(h.page, FOLDER).locator('~ div, + div').count()) === 0) await folderTwisty.click();
        }
        return false;
      },
      { timeout: 30_000, message: '보드 행이 사이드바에 나타남' },
    )
    .toBe(true);
  await row.click();
  await h.page.waitForSelector('.board-canvas .board-el--sticky');
}

/** 소유자가 스티키를 골라 노트 링크 피커에서 노트를 연결한다(실제 UI 경로). */
async function linkNote(page: Page, stickyText: string, noteTitle: string): Promise<void> {
  await sticky(page, stickyText).click();
  await page.locator('.sel-toolbar .st-btn[title="연동"]').click();
  await page.locator('.sel-toolbar .st-link-row', { hasText: '노트 연결' }).click();
  await page.locator('.picker-input').fill(noteTitle);
  await page.locator('.picker-item:not(.picker-create)', { hasText: noteTitle }).first().click();
  await expect(chipOf(page, stickyText)).toContainText(noteTitle);
  await page.click('.board-canvas', { position: { x: 20, y: 20 } }); // 선택 해제
}

type BoardJson = { elements: Record<string, { noteLink?: { notePath?: string; noteId?: string; title?: string } }> };
const readBoard = (path: string) => JSON.parse(readFileSync(path, 'utf-8')) as BoardJson;

test(
  '보드 노트 링크(공유): 공유 폴더 안 노트 칩은 참가자에게도 보이고 눌러 열리며, 폴더 밖 노트 칩은 참가자에게 없다 — 소유자 파일·칩은 그대로',
  { tag: ['@share', '@board'] },
  async () => {
    test.setTimeout(240_000);
    const relay = await startTestRelay();
    try {
      await withApps({ MINDMAP_RELAY_URL: relay.url }, async (a, b) => {
        const { aBoard, bBoard } = await setupShared(a, b);

        // 소유자: 스티키 2개에 각각 폴더 안 노트·폴더 밖 노트를 연결한다
        await openBoard(a);
        await linkNote(a.page, '공유 노트에 연결', SHARED_NOTE_TITLE);
        await linkNote(a.page, '개인 노트에 연결', PRIVATE_NOTE_TITLE);
        // 자동 저장 후 소유자 파일에는 노트 id와 (옛 호환용) 절대 경로가 함께 저장된다
        await expect
          .poll(() => readBoard(aBoard).elements.s1?.noteLink?.noteId ?? null, { timeout: 15_000, message: '소유자 보드가 noteId를 저장함' })
          .toBe(SHARED_NOTE_ID);
        await expect.poll(() => readBoard(aBoard).elements.s2?.noteLink?.noteId ?? null, { timeout: 15_000 }).toBe(PRIVATE_NOTE_ID);
        const owned = readBoard(aBoard).elements;
        expect(owned.s1.noteLink?.notePath?.startsWith(a.workspace) ?? false).toBe(true);
        expect(owned.s2.noteLink?.notePath?.startsWith(a.workspace) ?? false).toBe(true);
        const aBytes = readFileSync(aBoard, 'utf-8');
        const aMtime = statSync(aBoard).mtimeMs;

        // 참가자 미러: 공유 폴더 안 노트 링크는 {noteId,title}만(경로 없음), 폴더 밖 노트 링크는 사라졌다
        await expect
          .poll(() => readBoard(bBoard).elements.s1?.noteLink ?? null, { timeout: 40_000, message: 'B의 미러에 노트 링크가 도착함' })
          .toEqual({ noteId: SHARED_NOTE_ID, title: SHARED_NOTE_TITLE });
        const mirrored = readBoard(bBoard).elements;
        expect(mirrored.s2.noteLink).toBeUndefined();
        const mirroredRaw = readFileSync(bBoard, 'utf-8');
        expect(mirroredRaw).not.toContain(a.workspace); // 소유자 기기의 어떤 경로도 참가자에게 가지 않는다
        expect(mirroredRaw).not.toContain('notePath');
        expect(mirroredRaw).not.toContain(PRIVATE_NOTE_ID);

        // (a)(b) 참가자 화면: 공유 노트 칩은 보이고 개인 노트 스티키에는 칩이 없다
        await openBoard(b);
        await expect(b.page.getByTestId('viewer-badge')).toBeVisible();
        await expect(chipOf(b.page, '공유 노트에 연결')).toHaveCount(1);
        await expect(chipOf(b.page, '공유 노트에 연결')).toContainText(SHARED_NOTE_TITLE);
        await expect(chipOf(b.page, '개인 노트에 연결')).toHaveCount(0);
        await expect(sticky(b.page, '개인 노트에 연결')).toBeVisible(); // 스티키 자체는 그대로
        await expect(chipOf(b.page, '공유 노트에 연결').locator('.board-sticky-link-x')).toHaveCount(0); // 보기 전용 — 연결 해제 버튼 없음
        await shootBothThemes(b.page, 'board-note-link-participant');

        // 칩을 누르면 참가자 로컬의 그 노트가 오른쪽 패널에 열린다(로컬 노트 인덱스에서 id로 해석)
        await chipOf(b.page, '공유 노트에 연결').click();
        await expect(b.page.locator('.note-pane .note-title')).toHaveValue(SHARED_NOTE_TITLE, { timeout: 15_000 });
        await expect(b.page.locator(PM)).toContainText('공유 회의 본문 XYZ', { timeout: 20_000 });
        await expect(b.page.getByTestId('viewer-badge')).toBeVisible(); // 보드는 여전히 보기 전용
        await expect(b.page.locator('.tab-dirty')).toHaveCount(0); // 노트를 여는 것은 보드 문서를 바꾸지 않는다
        await shootBothThemes(b.page, 'board-note-link-opened');

        // (d) 소유자 자신의 칩은 이전과 똑같이 작동한다(폴더 안·밖 모두), 그리고 소유자 파일은 발행 뒤에도 1바이트 그대로
        await chipOf(a.page, '공유 노트에 연결').click();
        await expect(a.page.locator('.note-pane .note-title')).toHaveValue(SHARED_NOTE_TITLE, { timeout: 15_000 });
        await chipOf(a.page, '개인 노트에 연결').click();
        await expect(a.page.locator('.note-pane .note-title')).toHaveValue(PRIVATE_NOTE_TITLE, { timeout: 15_000 });
        await shootBothThemes(a.page, 'board-note-link-owner');
        expect(readFileSync(aBoard, 'utf-8')).toBe(aBytes);
        expect(statSync(aBoard).mtimeMs).toBe(aMtime);
        expect(readBoard(aBoard).elements.s1.noteLink?.notePath?.startsWith(a.workspace)).toBe(true); // 소유자 파일의 절대 경로는 그대로
      });
    } finally {
      await relay.close();
    }
  },
);

test(
  '보드 노트 링크(공유): 소유자가 노트 이름을 바꿔도 참가자·소유자의 칩이 계속 작동한다(id 해석)',
  { tag: ['@share', '@board'] },
  async () => {
    test.setTimeout(240_000);
    const relay = await startTestRelay();
    try {
      await withApps({ MINDMAP_RELAY_URL: relay.url }, async (a, b) => {
        const { aBoard, bBoard, aSharedNote } = await setupShared(a, b);
        await openBoard(a);
        await linkNote(a.page, '공유 노트에 연결', SHARED_NOTE_TITLE);
        await expect.poll(() => readBoard(aBoard).elements.s1?.noteLink?.noteId ?? null, { timeout: 15_000 }).toBe(SHARED_NOTE_ID);
        await expect
          .poll(() => readBoard(bBoard).elements.s1?.noteLink?.noteId ?? null, { timeout: 40_000, message: 'B의 미러에 노트 링크가 도착함' })
          .toBe(SHARED_NOTE_ID);
        await openBoard(b);
        await expect(chipOf(b.page, '공유 노트에 연결')).toContainText(SHARED_NOTE_TITLE);

        // 소유자가 노트를 열어 제목(=파일 이름)을 바꾼다 — 보드에 저장된 옛 경로는 이제 존재하지 않는 파일이다
        const NEW_TITLE = '새 회의록';
        await chipOf(a.page, '공유 노트에 연결').click();
        await expect(a.page.locator('.note-pane .note-title')).toHaveValue(SHARED_NOTE_TITLE, { timeout: 15_000 });
        await a.page.locator('.note-pane .note-title').fill(NEW_TITLE);
        await expect.poll(() => existsSync(aSharedNote), { timeout: 20_000, message: 'A의 파일 이름이 바뀜(옛 경로 사라짐)' }).toBe(false);
        expect(readBoard(aBoard).elements.s1.noteLink?.notePath).toBe(aSharedNote); // 소유자 보드의 경로는 낡았다
        // 참가자 쪽 노트도 새 제목을 받았다(각자 로컬 규칙으로 파일 이름이 따라간다)
        await expect(b.page.locator('.note-pane .note-title')).toHaveCount(0);
        await expect
          .poll(() => readFileSync(join(b.workspace, FOLDER, mdWithId(b.workspace, SHARED_NOTE_ID) ?? ''), 'utf-8').includes(`title: "${NEW_TITLE}"`), {
            timeout: 30_000,
            message: 'B의 노트 제목이 갱신됨',
          })
          .toBe(true);

        // 참가자: 이름이 바뀐 뒤에도 칩을 누르면 그 노트가 열린다(경로 없이 id로만 찾는다)
        await chipOf(b.page, '공유 노트에 연결').click();
        await expect(b.page.locator('.note-pane .note-title')).toHaveValue(NEW_TITLE, { timeout: 20_000 });
        await expect(b.page.locator(PM)).toContainText('공유 회의 본문 XYZ', { timeout: 20_000 });

        // 소유자: 낡은 경로가 깨졌지만 id로 해석되어 칩이 그대로 작동한다(옛 경로 폴백 이전에 id가 우선)
        await a.page.click('.board-canvas', { position: { x: 20, y: 20 } });
        await chipOf(a.page, '공유 노트에 연결').click();
        await expect(a.page.locator('.note-pane .note-title')).toHaveValue(NEW_TITLE, { timeout: 15_000 });
        await expect(a.page.locator('.toast', { hasText: '찾을 수 없습니다' })).toHaveCount(0);
      });
    } finally {
      await relay.close();
    }
  },
);
