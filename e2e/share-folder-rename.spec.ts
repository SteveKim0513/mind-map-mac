import { test, expect, type Page } from '@playwright/test';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import type { AppHandle } from './helpers';
import { startTestRelay, withApps } from './shareHelpers';

// 공유 폴더 이름 변경·이동 — 복제 매니저·사이드카가 폴더 경로를 붙잡고 있어서, 폴더를 사이드바에서 이름 바꾸면 연결을 새 경로로 다시 시작해야 한다.
// 그렇지 않으면 원격 편집이 옛 경로에 쓰이지 못해 디스크에 반영되지 않고(파일이 뒤처짐), 공유 노트가 일반 노트로 보여 자동저장이 본문을 덮어쓰며,
// 참가자의 읽기 전용 미러가 편집 가능해진다. 기다림은 모두 상태(폴링)로 한다 — 시간 대기 없음.
// 각 테스트는 자체 릴레이·격리된 인스턴스를 쓴다(병렬 안전).

const OWNER = '지호';
const GUEST = '민수';
const FOLDER = '기획';
const RENAMED = 'renamed-plan';
const NOTE_ID = 'e2e-rename-1';
const NOTE_FILE = '회의 메모.md'; // 제목과 같은 이름 — 제목 → 파일명 규칙이 열 때 이름을 바꾸지 않게
const MAP_FILE = '계획.mind';
const NOTE_TEXT = ['---', `id: "${NOTE_ID}"`, 'title: "회의 메모"', 'links: []', '---', '# 회의 메모', '', '첫 문단입니다', '', '마지막 문단입니다'].join('\n');
const mapText = (root: string) =>
  JSON.stringify(
    {
      version: 1,
      id: 'e2e-rename-map',
      rootIds: ['n1'],
      nodes: { n1: { id: 'n1', text: root, parentId: null, children: [], collapsed: false } },
      view: { zoom: 1, panX: 0, panY: 0 },
    },
    null,
    2,
  );

const PM = '.note-pane .note-rich .ProseMirror';
const folderRow = (page: Page, name: string) => page.locator(`.row[data-node-path$="/${name}"]`);
const shareBadgeState = (page: Page, folder: string, state: string) => folderRow(page, folder).locator(`[data-share-status="${state}"]`);
const count = (s: string, sub: string) => s.split(sub).length - 1;

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

/** 폴더를 사이드바에서 이름 변경한다(우클릭 메뉴 → 이름 변경 → 입력 → Enter). */
async function renameFolder(page: Page, from: string, to: string): Promise<void> {
  await folderRow(page, from).click({ button: 'right' });
  await page.locator('.ctx-menu .ctx-item:has-text("이름 변경")').click();
  const input = page.locator('.rename-input');
  await input.waitFor({ timeout: 5_000 });
  await input.fill(to);
  await input.press('Enter');
  await expect(folderRow(page, to)).toBeVisible({ timeout: 10_000 });
}

/** 사이드바에서 노트를 연다(폴더가 접혀 있으면 화살표로 펼친다). */
async function openNote(h: AppHandle, folder: string, file = NOTE_FILE): Promise<void> {
  const page = h.page;
  const row = page.locator(`.row[data-node-path$="/${folder}/${file}"]`);
  const shown = (ms: number) => row.waitFor({ state: 'visible', timeout: ms }).then(() => true, () => false);
  for (let i = 0; i < 3 && !(await shown(i === 0 ? 8_000 : 3_000)); i++) {
    await folderRow(page, folder).locator('svg').first().click();
  }
  await row.click();
  await expect(page.locator(PM)).toBeVisible({ timeout: 15_000 });
}

const editorText = (page: Page): Promise<string> =>
  page.evaluate((sel) => (document.querySelector(sel) as unknown as { editor: { getText(): string } }).editor.getText(), PM);

async function focusAtEnd(page: Page): Promise<void> {
  await page.evaluate((sel) => {
    (document.querySelector(sel) as unknown as { editor: { commands: { focus(p: string): boolean } } }).editor.commands.focus('end');
  }, PM);
  await expect(page.locator(PM)).toBeFocused();
}

/** 타이핑은 에디터 포커스가 실제로 올 때까지 기다린 뒤에 한다(Tiptap focus는 다음 프레임). */
async function typeAtEnd(page: Page, text: string): Promise<void> {
  await focusAtEnd(page); // 캐럿을 문서 끝으로
  await page.keyboard.type(text, { delay: 30 });
}

const mdFiles = (dir: string) => readdirSync(dir).filter((n) => n.endsWith('.md'));
const readNote = (dir: string) => readFileSync(join(dir, mdFiles(dir)[0]), 'utf-8');

/** 소유자 A: 폴더 + 노트 + 맵을 파일로 만들어 공유하고, 참가자 B가 참가해 둘 다 받을 때까지. */
async function setupShared(a: AppHandle, b: AppHandle): Promise<{ aMap: string }> {
  const dir = join(a.workspace, FOLDER);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, NOTE_FILE), NOTE_TEXT, 'utf-8');
  const aMap = join(dir, MAP_FILE);
  writeFileSync(aMap, mapText('루트 주제'), 'utf-8');
  await a.page.reload();
  await expect(folderRow(a.page, FOLDER)).toBeVisible({ timeout: 15_000 });
  const code = await createSharedFolder(a.page);
  await expect(a.page.getByTestId('share-panel').getByTestId('share-status')).toHaveAttribute('data-status', 'connected', { timeout: 15_000 });
  await a.page.keyboard.press('Escape'); // 공유 패널 닫기(한 단계 복귀)
  await expect(a.page.getByTestId('share-panel')).toHaveCount(0);
  await joinWithCode(b.page, code, GUEST);
  await expect(folderRow(b.page, FOLDER)).toBeVisible({ timeout: 15_000 });
  await expect
    .poll(() => existsSync(join(b.workspace, FOLDER, NOTE_FILE)) && existsSync(join(b.workspace, FOLDER, MAP_FILE)), {
      timeout: 40_000,
      message: 'B에 소유자의 노트·맵이 받아짐',
    })
    .toBe(true);
  return { aMap };
}

test(
  '공유 폴더 이름 변경(소유자): 연결이 새 경로로 다시 시작되어 상대 편집이 새 경로 파일에 반영되고, 열어 둔 노트는 공유 상태를 유지하며, 옛 경로는 되살아나지 않는다',
  { tag: ['@share', '@note'] },
  async () => {
    test.setTimeout(240_000);
    const relay = await startTestRelay();
    try {
      await withApps(2, { MINDMAP_RELAY_URL: relay.url }, async ([a, b]) => {
        await setupShared(a, b);
        await openNote(a, FOLDER);
        await openNote(b, FOLDER);
        await expect(a.page.locator(PM)).toContainText('첫 문단입니다', { timeout: 20_000 });
        await expect(b.page.locator(PM)).toContainText('첫 문단입니다', { timeout: 20_000 });
        await expect(a.page.getByTestId('note-shared-badge')).toHaveAttribute('data-status', 'connected', { timeout: 15_000 });

        // 기준선: 이름을 바꾸기 전에는 B의 편집이 A에게 간다
        await typeAtEnd(b.page, 'BEFORE1');
        await expect.poll(() => editorText(a.page), { timeout: 30_000, message: 'A의 에디터가 B의 편집을 받음' }).toContain('BEFORE1');

        // 소유자 A가 공유 폴더를 사이드바에서 이름 변경한다(노트는 열려 있다)
        await renameFolder(a.page, FOLDER, RENAMED);
        expect(existsSync(join(a.workspace, FOLDER))).toBe(false);
        expect(existsSync(join(a.workspace, RENAMED, NOTE_FILE))).toBe(true);
        // 연결이 새 경로로 다시 시작되어 "연결됨"이 된다(트리의 공유 표식이 새 폴더를 따라간다)
        await expect(shareBadgeState(a.page, RENAMED, 'connected')).toBeVisible({ timeout: 40_000 });
        // 열어 둔 노트는 공유 상태를 유지한다 — 일반 노트로 보이면 자동저장이 본문을 덮어쓴다
        await expect(a.page.getByTestId('note-shared-badge')).toHaveAttribute('data-status', 'connected', { timeout: 40_000 });

        // (1) B의 편집이 A의 **새 경로** 파일에 반영된다(옛 경로에 쓰려다 실패해 파일이 뒤처지면 안 된다)
        await typeAtEnd(b.page, 'AFTER2');
        await expect
          .poll(() => readNote(join(a.workspace, RENAMED)).includes('AFTER2'), { timeout: 60_000, message: 'B의 편집이 A의 새 경로 파일에 반영됨' })
          .toBe(true);
        expect(existsSync(join(a.workspace, FOLDER))).toBe(false); // 옛 경로를 되살리지 않았다

        // (2) A의 편집도 B에게 간다(이름을 바꾼 뒤의 소유자 편집이 공유 상태로 처리됨)
        await typeAtEnd(a.page, 'OWNER3');
        await expect.poll(() => readNote(join(a.workspace, RENAMED)).includes('OWNER3'), { timeout: 30_000, message: 'A의 편집이 A 새 경로 파일에 파생됨' }).toBe(true);
        await expect
          .poll(() => readNote(join(b.workspace, FOLDER)).includes('OWNER3'), { timeout: 60_000, message: 'A의 편집이 B 파일에 반영됨' })
          .toBe(true);
        await expect.poll(() => readNote(join(a.workspace, RENAMED)).includes('OWNER3'), { timeout: 30_000 }).toBe(true);

        // 세 편집이 양쪽 파일에 정확히 한 번씩 — 소실·중복 없음(이름 변경 뒤 옛 본문으로 덮어쓰이지 않았다)
        for (const dir of [join(a.workspace, RENAMED), join(b.workspace, FOLDER)]) {
          const text = readNote(dir);
          expect(mdFiles(dir)).toHaveLength(1);
          for (const t of ['BEFORE1', 'AFTER2', 'OWNER3', '첫 문단입니다', '마지막 문단입니다']) expect(count(text, t), `${dir}: ${t}`).toBe(1);
          expect(text).toContain(`id: "${NOTE_ID}"`);
        }
      });
    } finally {
      await relay.close();
    }
  },
);

test(
  '공유 폴더 이름 변경(참가자): 받은 맵의 읽기 전용이 유지되고 소유자의 수정이 새 경로의 미러에 계속 반영된다',
  { tag: ['@share', '@map'] },
  async () => {
    test.setTimeout(240_000);
    const relay = await startTestRelay();
    try {
      await withApps(2, { MINDMAP_RELAY_URL: relay.url }, async ([a, b]) => {
        const { aMap } = await setupShared(a, b);

        // B가 받은 맵을 열면 읽기 전용 뷰어다(폴더가 접혀 있으면 펼친다 — 맵 행은 종류 아이콘으로 찾는다)
        const mapRow = b.page.locator('.row:has(.ficon--map)').first();
        for (let i = 0; i < 3 && !(await mapRow.isVisible().catch(() => false)); i++) {
          await folderRow(b.page, FOLDER).locator('svg').first().click();
          await mapRow.waitFor({ state: 'visible', timeout: 3_000 }).catch(() => undefined);
        }
        await expect(mapRow).toBeVisible({ timeout: 20_000 });
        await mapRow.click();
        await b.page.waitForSelector('.canvas .node', { timeout: 20_000 });
        await expect(b.page.getByTestId('viewer-badge')).toBeVisible();
        await expect(b.page.locator('.node', { hasText: '루트 주제' })).toBeVisible();

        // B가 공유 폴더를 이름 변경한다(뷰어 탭이 열려 있다)
        await renameFolder(b.page, FOLDER, RENAMED);
        expect(existsSync(join(b.workspace, FOLDER))).toBe(false);
        expect(existsSync(join(b.workspace, RENAMED, MAP_FILE))).toBe(true);
        await expect(shareBadgeState(b.page, RENAMED, 'connected')).toBeVisible({ timeout: 40_000 });

        // 이름을 바꾼 뒤에도 계속 읽기 전용이다(뷰어 판정이 새 경로를 따라간다 — 편집 가능해지면 소유자의 미러를 덮어쓰게 된다)
        const badge = b.page.getByTestId('viewer-badge');
        await expect(badge).toBeVisible({ timeout: 20_000 });
        await expect(badge).toHaveAttribute('data-state', 'live');
        await expect(b.page.locator('.add-child')).toHaveCount(0);
        await expect(b.page.locator('.map-save')).toHaveCount(0);

        // 소유자가 맵을 고치면(포커스 → 스캔 → 발행) 새 경로의 미러가 갱신되고 열려 있는 뷰어에도 반영된다
        writeFileSync(aMap, mapText('수정된 루트'), 'utf-8');
        await expect
          .poll(
            async () => {
              await a.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.webContents.send('workspace:focus'));
              return readFileSync(join(b.workspace, RENAMED, MAP_FILE), 'utf-8').includes('수정된 루트');
            },
            { timeout: 60_000, message: '소유자의 수정이 새 경로의 미러에 반영됨' },
          )
          .toBe(true);
        await expect(b.page.locator('.node', { hasText: '수정된 루트' })).toBeVisible({ timeout: 30_000 });
        await expect(b.page.getByTestId('viewer-badge')).toBeVisible();
        expect(existsSync(join(b.workspace, FOLDER))).toBe(false); // 옛 경로를 되살리지 않았다
        // 미러 파일은 소유자의 것과 같다(참가자가 편집한 적 없다)
        expect((JSON.parse(readFileSync(join(b.workspace, RENAMED, MAP_FILE), 'utf-8')) as { nodes: { n1: { text: string } } }).nodes.n1.text).toBe('수정된 루트');
      });
    } finally {
      await relay.close();
    }
  },
);
