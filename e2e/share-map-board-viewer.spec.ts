import { test, expect, type Page } from '@playwright/test';
import { existsSync, readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import type { AppHandle } from './helpers';
import { shootBothThemes, startTestRelay, withApps as launchApps } from './shareHelpers';

// 공유 폴더 맵·보드 보기 전용 공유(ADR 0021 단계 7) — 소유자의 .mind/.board가 참가자에게 읽기 전용으로 복제·표시된다.
// 소유자만 편집하고 참가자는 볼 수만 있다(코멘트는 단계 8). 각 테스트는 자체 릴레이·격리된 인스턴스를 쓴다(병렬 안전).
// 시각 확인: SHARE_E2E_SHOTS=<dir> 를 주면 뷰어 화면을 라이트/다크로 저장한다.

const OWNER = '지호';
const GUEST = '민수';
const FOLDER = '기획';
const MAP_NAME = '계획';
const BOARD_NAME = '아이디어';

const MAP_TEXT = JSON.stringify(
  {
    version: 1,
    id: 'e2e-plan',
    rootIds: ['n1'],
    nodes: {
      n1: { id: 'n1', text: '루트 주제', parentId: null, children: ['n2', 'n3'], collapsed: false },
      n2: {
        id: 'n2',
        text: '일정 있는 가지',
        parentId: 'n1',
        children: [],
        collapsed: false,
        todo: true,
        scheduled: true,
        scheduleAt: '2026-10-01T09:00:00.000Z',
        reminderOn: true, // 소유자의 리마인더 신원 — 참가자에게는 가지 않는다
        reminderId: 'owner-only-reminder',
        color: 'green',
      },
      n3: { id: 'n3', text: '메모 있는 가지', parentId: 'n1', children: [], collapsed: false, note: '소유자의 메모' },
    },
    view: { zoom: 1, panX: 0, panY: 0 },
  },
  null,
  2,
);

const BOARD_TEXT = JSON.stringify(
  {
    version: 1,
    id: 'e2e-idea',
    elements: {
      s1: { id: 's1', kind: 'sticky', x: 40, y: 120, width: 180, height: 140, text: '아이디어 조각', color: 'yellow' },
      s2: { id: 's2', kind: 'sticky', x: 300, y: 120, width: 180, height: 140, text: '두 번째 조각', color: 'green', notes: ['덧붙인 글'] },
      c1: { id: 'c1', kind: 'connector', fromId: 's1', fromAnchor: 'right', toId: 's2', toAnchor: 'left', arrow: true },
    },
    order: ['s1', 's2', 'c1'],
    view: { zoom: 1, panX: 0, panY: 0 },
  },
  null,
  2,
);

const folderRow = (page: Page, name: string) => page.locator(`.row[data-node-path$="/${name}"]`);
// 사이드바 파일 행은 종류 아이콘(.ficon--map/.ficon--board)으로 찾는다 — 파일명 문자열은 macOS에서 유니코드 정규화(NFC/NFD)가 달라 못 믿는다.
// 각 테스트의 공유 폴더에는 맵 하나·보드 하나뿐이다(참가자가 만든 로컬 맵이 생기는 뒤쪽 단계에서는 쓰지 않는다).
const fileRow = (page: Page, file: string) => page.locator(`.row:has(.ficon--${file.endsWith('.board') ? 'board' : 'map'})`).first();

async function newFolder(page: Page, name: string): Promise<void> {
  await page.click('.sb-section-btn[title="새 폴더"]');
  const input = page.locator('.rename-input');
  await input.waitFor({ timeout: 5_000 });
  await input.fill(name);
  await input.press('Enter');
  await expect(folderRow(page, name)).toBeVisible({ timeout: 5_000 });
}

async function createFileVia(page: Page, dir: string, name: string, text: string, ext: string): Promise<string> {
  return page.evaluate(
    ({ dir, name, text, ext }) =>
      (window as unknown as { api: { createFile(d: string, n: string, c: string, e: string): Promise<string> } }).api.createFile(dir, name, text, ext),
    { dir, name, text, ext },
  );
}

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

/** 소유자 A가 폴더를 만들고 그 안에 맵·보드를 둔 뒤 공유하고, 참가자 B가 참가해 두 파일이 미러링될 때까지 진행한다. */
async function setupShared(a: AppHandle, b: AppHandle) {
  await newFolder(a.page, FOLDER);
  const dir = join(a.workspace, FOLDER);
  const aMap = await createFileVia(a.page, dir, MAP_NAME, MAP_TEXT, '.mind');
  const aBoard = await createFileVia(a.page, dir, BOARD_NAME, BOARD_TEXT, '.board');
  const code = await createSharedFolder(a.page);
  await expect(a.page.getByTestId('share-panel').getByTestId('share-status')).toHaveAttribute('data-status', 'connected', { timeout: 15_000 });
  await a.page.keyboard.press('Escape'); // 공유 패널 닫기(한 단계 복귀)
  await expect(a.page.getByTestId('share-panel')).toHaveCount(0);
  await joinWithCode(b.page, code, GUEST);
  await expect(folderRow(b.page, FOLDER)).toBeVisible({ timeout: 15_000 });
  const bMap = join(b.workspace, FOLDER, `${MAP_NAME}.mind`);
  const bBoard = join(b.workspace, FOLDER, `${BOARD_NAME}.board`);
  await expect.poll(() => existsSync(bMap) && existsSync(bBoard), { timeout: 40_000, message: 'B에 소유자의 맵·보드가 미러링됨' }).toBe(true);
  return { aMap, aBoard, bMap, bBoard };
}

/**
 * 사이드바에서 파일 행이 보이게 한다. 파일을 앱 밖(IPC)에서 만들었거나 미러링된 직후에는 트리가 아직 옛 상태일 수 있어,
 * 사용자가 앱으로 돌아올 때 main이 보내는 'workspace:focus'를 그대로 보내 트리를 새로 읽게 한다(실제 경로와 같다).
 * 접혀 있으면 펼친다(펼침 상태는 chevron 모양으로만 드러난다) — 3초에 한 번만 누른다.
 */
const revealFile = async (h: AppHandle, file: string) => {
  const row = fileRow(h.page, file);
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
      { timeout: 30_000, message: `${file} 행이 사이드바에 나타남` },
    )
    .toBe(true);
  return row;
};

const openFromSidebar = async (h: AppHandle, file: string) => {
  await (await revealFile(h, file)).click();
};

const closeActiveTab = async (page: Page) => {
  await page.locator('.tab.active .tab-close').click();
  await expect(page.locator('.tab')).toHaveCount(0);
};

const nodeTexts = (page: Page) => page.$$eval('.node .text', (els) => els.map((e) => e.textContent?.trim() ?? '').sort());

test(
  '뷰어(맵): 참가자는 소유자의 맵을 읽기 전용으로 보고, 소유자의 수정이 포커스 이동 없이 실시간 반영된다',
  { tag: ['@share', '@map'] },
  async () => {
    test.setTimeout(240_000);
    const relay = await startTestRelay();
    try {
      await withApps({ MINDMAP_RELAY_URL: relay.url }, async (a, b) => {
        const { aMap, bMap } = await setupShared(a, b);

        // (a) 참가자 폴더에 미러 — 내용은 같고 리마인더 신원은 제거됐다. 소유자 원본은 그대로.
        const mirrored = JSON.parse(readFileSync(bMap, 'utf-8')) as { nodes: Record<string, Record<string, unknown>> };
        expect(mirrored.nodes.n1.text).toBe('루트 주제');
        expect(mirrored.nodes.n2.scheduleAt).toBe('2026-10-01T09:00:00.000Z');
        expect(mirrored.nodes.n2.reminderOn).toBeUndefined();
        expect(mirrored.nodes.n2.reminderId).toBeUndefined();
        expect(readFileSync(aMap, 'utf-8')).toBe(MAP_TEXT);

        // 소유자 화면: 표식 없음, 편집 어포던스 그대로
        await openFromSidebar(a, `${MAP_NAME}.mind`);
        await a.page.waitForSelector('.canvas .node');
        await expect(a.page.getByTestId('viewer-badge')).toHaveCount(0);
        await a.page.locator('.node', { hasText: '루트 주제' }).click();
        await expect(a.page.locator('.sel-toolbar')).toBeVisible();

        // (f) 참가자 화면: 뷰어 표식(아이콘+텍스트) + 편집 어포던스 없음
        await openFromSidebar(b, `${MAP_NAME}.mind`);
        await b.page.waitForSelector('.canvas .node');
        const badge = b.page.getByTestId('viewer-badge');
        await expect(badge).toBeVisible();
        await expect(badge).toContainText('보기 전용');
        await expect(badge).toContainText('소유자만 편집할 수 있어요');
        expect(await nodeTexts(b.page)).toEqual(['루트 주제', '메모 있는 가지', '일정 있는 가지']);
        await expect(b.page.locator('.node', { hasText: '메모 있는 가지' }).locator('.node-memo')).toHaveText('소유자의 메모');
        await expect(b.page.locator('.node-memo[contenteditable="true"]')).toHaveCount(0);
        await expect(b.page.locator('.add-child')).toHaveCount(0);
        await expect(b.page.locator('.map-save')).toHaveCount(0);
        await shootBothThemes(b.page, 'viewer-map');

        // (b) 편집 시도 — Enter/Tab/Space/F2/Delete/입력/더블클릭/드래그/컨텍스트 메뉴/붙여넣기 → 아무 변화 없음
        const bBefore = readFileSync(bMap, 'utf-8');
        const bMtime = statSync(bMap).mtimeMs;
        const root = b.page.locator('.node', { hasText: '루트 주제' });
        await root.click();
        await expect(root).toHaveClass(/selected/); // 선택은 된다(보기 동작)
        await expect(b.page.locator('.sel-toolbar')).toHaveCount(0); // 편집 툴바 없음
        await b.page.keyboard.press('Meta+c'); // 복사는 보기 동작이다
        for (const key of ['Enter', 'Tab', 'Space', 'F2', 'Delete', 'Backspace', 'Meta+Enter', 'Meta+v', 'Meta+z', 'Meta+Shift+z', 'Meta+l']) {
          await b.page.keyboard.press(key);
        }
        await b.page.keyboard.type('입력 시도');
        await root.dblclick();
        await b.page.locator('.canvas').dblclick({ position: { x: 300, y: 500 } });
        const rb = await root.boundingBox();
        if (!rb) throw new Error('루트 노드 위치를 읽지 못함');
        await b.page.mouse.move(rb.x + rb.width / 2, rb.y + rb.height / 2);
        await b.page.mouse.down();
        await b.page.mouse.move(rb.x + rb.width / 2 + 140, rb.y + rb.height / 2 + 90, { steps: 8 });
        await b.page.mouse.up();
        await expect(b.page.locator('.editing-text')).toHaveCount(0);
        expect(await nodeTexts(b.page)).toEqual(['루트 주제', '메모 있는 가지', '일정 있는 가지']);
        const rb2 = await root.boundingBox();
        expect(Math.abs((rb2?.x ?? 0) - rb.x)).toBeLessThan(2); // 드래그로 옮겨지지 않았다
        expect(Math.abs((rb2?.y ?? 0) - rb.y)).toBeLessThan(2);
        // 우클릭: 편집 항목 없이 보기 동작만
        await root.click({ button: 'right' });
        const menu = b.page.locator('.ctx-menu');
        await expect(menu).toBeVisible();
        for (const label of ['삭제', '편집', '자식 추가', '형제 추가', '복제', '할 일로 전환', '링크 추가']) {
          await expect(menu.locator('.ctx-item', { hasText: label })).toHaveCount(0);
        }
        await expect(menu.locator('.ctx-item', { hasText: '이 노드로 확대' })).toBeVisible();
        await b.page.keyboard.press('Escape');
        // 체크박스(할 일 표시)도 눌리지 않는다
        const todoNode = b.page.locator('.node', { hasText: '일정 있는 가지' });
        await todoNode.locator('.node-check').click({ force: true });
        await expect(todoNode).not.toHaveClass(/done/);
        // 접기/펴기는 로컬 표시 상태라 동작하지만 저장 표시(dirty)는 생기지 않는다
        await root.locator('.collapse-toggle').click();
        await expect(b.page.locator('.node', { hasText: '일정 있는 가지' })).toHaveCount(0);
        await root.locator('.collapse-toggle').click();
        await expect(b.page.locator('.node', { hasText: '일정 있는 가지' })).toHaveCount(1);
        await expect(b.page.locator('.tab-dirty')).toHaveCount(0);
        // 탭을 닫는 flush도 뷰어 문서를 쓰지 않는다 — 파일 바이트·mtime 불변
        await closeActiveTab(b.page);
        expect(readFileSync(bMap, 'utf-8')).toBe(bBefore);
        expect(statSync(bMap).mtimeMs).toBe(bMtime);

        // (c) 소유자가 노드를 추가·수정 → 참가자 화면에 포커스 이동 없이 반영
        await openFromSidebar(b, `${MAP_NAME}.mind`);
        await b.page.waitForSelector('.canvas .node');
        const aRoot = a.page.locator('.node', { hasText: '루트 주제' });
        await aRoot.click();
        await a.page.keyboard.press('Tab');
        await a.page.waitForSelector('.editing-text', { timeout: 3_000 });
        await a.page.keyboard.type('소유자가 추가한 가지');
        await a.page.keyboard.press('Enter');
        await expect(b.page.locator('.node', { hasText: '소유자가 추가한 가지' })).toBeVisible({ timeout: 30_000 });
        // 소유자가 기존 노드 텍스트를 고친다
        await a.page.locator('.node', { hasText: '메모 있는 가지' }).dblclick();
        await a.page.waitForSelector('.editing-text', { timeout: 3_000 });
        await a.page.keyboard.press('Meta+a');
        await a.page.keyboard.type('고친 가지');
        await a.page.keyboard.press('Enter');
        await expect(b.page.locator('.node', { hasText: '고친 가지' })).toBeVisible({ timeout: 30_000 });
        await expect(b.page.locator('.node', { hasText: '메모 있는 가지' })).toHaveCount(0);
        // 실시간 반영 뒤에도 뷰어 상태는 그대로 — 표식·편집 없음·dirty 없음
        await expect(b.page.getByTestId('viewer-badge')).toBeVisible();
        await expect(b.page.locator('.tab-dirty')).toHaveCount(0);
        const bAfter = JSON.parse(readFileSync(bMap, 'utf-8')) as { nodes: Record<string, { text: string }> };
        expect(Object.values(bAfter.nodes).map((n) => n.text).sort()).toEqual(['고친 가지', '루트 주제', '소유자가 추가한 가지', '일정 있는 가지']);

        // 참가자가 공유 폴더 안에 직접 만든 맵은 내 기기에만 있는 로컬 파일 — 안내 토스트 + 편집 가능 + 공유되지 않는다
        await folderRow(b.page, FOLDER).click();
        await b.page.click('.sb-section-btn[title="새 마인드맵"]');
        await expect(b.page.getByText('이 폴더의 맵·보드는 소유자만 공유해요')).toBeVisible({ timeout: 5_000 });
        await b.page.waitForSelector('.canvas');
        await b.page.locator('.rename-input').press('Enter').catch(() => {});
        await b.page.click('.canvas');
        await expect(b.page.getByTestId('viewer-badge')).toHaveCount(0); // 내 파일에는 표식이 없다
        await b.page.keyboard.press('Enter');
        await b.page.waitForSelector('.editing-text', { timeout: 3_000 });
        await b.page.keyboard.type('내 로컬 주제');
        await b.page.keyboard.press('Enter');
        await expect(b.page.locator('.node', { hasText: '내 로컬 주제' })).toBeVisible();
        // 소유자에게 또 한 번 수정이 왕복한 뒤에도 소유자 폴더에는 참가자의 파일이 없다
        await a.page.locator('.node', { hasText: '루트 주제' }).click();
        await a.page.keyboard.press('Tab');
        await a.page.waitForSelector('.editing-text', { timeout: 3_000 });
        await a.page.keyboard.type('왕복 확인');
        await a.page.keyboard.press('Enter');
        // (B는 지금 자기 로컬 맵을 보고 있다 — 미러 파일에는 소유자의 수정이 계속 반영된다)
        await expect.poll(() => readFileSync(bMap, 'utf-8').includes('왕복 확인'), { timeout: 30_000, message: '소유자의 수정이 미러 파일에 도착' }).toBe(true);
        expect(readdirSync(join(a.workspace, FOLDER)).filter((n) => n.endsWith('.mind') || n.endsWith('.board')).sort()).toEqual([`${BOARD_NAME}.board`, `${MAP_NAME}.mind`].sort());
      });
    } finally {
      await relay.close();
    }
  },
);

test(
  '뷰어(보드): 참가자는 소유자의 보드를 읽기 전용으로 보고, 스티키 추가·이동이 실시간 반영된다',
  { tag: ['@share', '@board'] },
  async () => {
    test.setTimeout(240_000);
    const relay = await startTestRelay();
    try {
      await withApps({ MINDMAP_RELAY_URL: relay.url }, async (a, b) => {
        const { aBoard, bBoard } = await setupShared(a, b);
        expect(readFileSync(aBoard, 'utf-8')).toBe(BOARD_TEXT); // 소유자 원본은 그대로

        // 소유자 화면: 표식 없음 + 편집 툴바
        await openFromSidebar(a, `${BOARD_NAME}.board`);
        await a.page.waitForSelector('.board-canvas .board-el--sticky');
        await expect(a.page.getByTestId('viewer-badge')).toHaveCount(0);
        await expect(a.page.locator('.tool-btn[title="스티키노트 추가"]')).toBeVisible();

        // 참가자 화면: 표식 + 편집 어포던스 없음
        await openFromSidebar(b, `${BOARD_NAME}.board`);
        await b.page.waitForSelector('.board-canvas .board-el--sticky');
        const badge = b.page.getByTestId('viewer-badge');
        await expect(badge).toBeVisible();
        await expect(badge).toContainText('소유자만 편집할 수 있어요');
        await expect(b.page.locator('.board-el--sticky')).toHaveCount(2);
        await expect(b.page.locator('.tool-btn[title="스티키노트 추가"]')).toHaveCount(0);
        await expect(b.page.locator('.tool-btn[title="삭제"]')).toHaveCount(0);
        await expect(b.page.locator('.board-el--sticky .board-el-text', { hasText: '아이디어 조각' })).toBeVisible();
        await expect(b.page.locator('.board-sticky-note')).toContainText('덧붙인 글');
        await shootBothThemes(b.page, 'viewer-board');

        // 편집 시도 — 더블클릭 편집·입력·Delete·드래그·리사이즈·앵커·우클릭·붙여넣기 → 변화 없음
        const bBefore = readFileSync(bBoard, 'utf-8');
        const bMtime = statSync(bBoard).mtimeMs;
        const s1 = b.page.locator('.board-el--sticky', { hasText: '아이디어 조각' });
        const posOf = () => s1.evaluate((el) => ({ left: (el as HTMLElement).style.left, top: (el as HTMLElement).style.top }));
        const posBefore = await posOf();
        await s1.click();
        await expect(s1).toHaveClass(/selected/);
        await expect(b.page.locator('.board-anchor')).toHaveCount(0); // 연결 앵커 없음
        await expect(b.page.locator('.board-handle')).toHaveCount(0); // 리사이즈 핸들 없음
        await s1.dblclick();
        await expect(b.page.locator('.board-el-input')).toHaveCount(0);
        await b.page.keyboard.press('Meta+c');
        for (const key of ['Enter', 'Delete', 'Backspace', 'ArrowRight', 'ArrowDown', 'Meta+v', 'Meta+x', 'Meta+z', 'Meta+Shift+z']) {
          await b.page.keyboard.press(key);
        }
        await b.page.keyboard.type('입력 시도');
        await b.page.locator('.board-canvas').dblclick({ position: { x: 500, y: 450 } });
        const box = await s1.boundingBox();
        if (!box) throw new Error('스티키 위치를 읽지 못함');
        await b.page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
        await b.page.mouse.down();
        await b.page.mouse.move(box.x + box.width / 2 + 120, box.y + box.height / 2 + 70, { steps: 8 });
        await b.page.mouse.up();
        // 우클릭: 편집 항목 없이 "코멘트 남기기"만 있는 메뉴(코멘트는 뷰어도 남길 수 있다 — 단계 8)
        await s1.click({ button: 'right' });
        await expect(b.page.locator('.ctx-menu .ctx-item')).toHaveText(['코멘트 남기기']);
        await b.page.keyboard.press('Escape');
        await expect(b.page.locator('.ctx-menu')).toHaveCount(0);
        await expect(b.page.locator('.board-el--sticky')).toHaveCount(2);
        expect(await posOf()).toEqual(posBefore);
        await expect(b.page.locator('.tab-dirty')).toHaveCount(0);
        await closeActiveTab(b.page);
        expect(readFileSync(bBoard, 'utf-8')).toBe(bBefore);
        expect(statSync(bBoard).mtimeMs).toBe(bMtime);

        // 소유자가 스티키를 추가하고 기존 스티키를 옮기면 참가자 화면이 포커스 이동 없이 반영
        await openFromSidebar(b, `${BOARD_NAME}.board`);
        await b.page.waitForSelector('.board-canvas .board-el--sticky');
        await a.page.click('.tool-btn[title="스티키노트 추가"]');
        await expect(a.page.locator('.board-el--sticky')).toHaveCount(3);
        await a.page.locator('.board-el--sticky').last().dblclick();
        await a.page.waitForSelector('.board-el-input', { timeout: 3_000 });
        await a.page.keyboard.type('소유자가 붙인 스티키');
        await a.page.click('.board-canvas', { position: { x: 20, y: 20 } }); // blur → 커밋
        await expect(b.page.locator('.board-el--sticky', { hasText: '소유자가 붙인 스티키' })).toBeVisible({ timeout: 30_000 });
        await expect(b.page.locator('.board-el--sticky')).toHaveCount(3);

        const aS1 = a.page.locator('.board-el--sticky', { hasText: '아이디어 조각' });
        const aBox = await aS1.boundingBox();
        if (!aBox) throw new Error('소유자 스티키 위치를 읽지 못함');
        await a.page.mouse.move(aBox.x + aBox.width / 2, aBox.y + aBox.height / 2);
        await a.page.mouse.down();
        await a.page.mouse.move(aBox.x + aBox.width / 2 + 60, aBox.y + aBox.height / 2 + 140, { steps: 8 });
        await a.page.mouse.up();
        await expect.poll(async () => (await posOf()).top, { timeout: 30_000, message: '소유자의 이동이 참가자 화면에 반영됨' }).not.toBe(posBefore.top);
        await expect(b.page.getByTestId('viewer-badge')).toBeVisible();
        await expect(b.page.locator('.tab-dirty')).toHaveCount(0);
        await expect(b.page.locator('.board-anchor')).toHaveCount(0);
      });
    } finally {
      await relay.close();
    }
  },
);

test(
  '뷰어: 소유자가 파일을 지우면 참가자의 미러는 휴지통으로 가고(영구 삭제 아님) 열린 탭은 닫힌다',
  { tag: ['@share', '@map'] },
  async () => {
    test.setTimeout(240_000);
    const relay = await startTestRelay();
    try {
      await withApps({ MINDMAP_RELAY_URL: relay.url }, async (a, b) => {
        const { bMap, bBoard } = await setupShared(a, b);
        await openFromSidebar(b, `${MAP_NAME}.mind`);
        await b.page.waitForSelector('.canvas .node');
        await expect(b.page.getByTestId('viewer-badge')).toBeVisible();

        // 소유자가 사이드바에서 맵을 삭제한다
        await (await revealFile(a, `${MAP_NAME}.mind`)).click({ button: 'right' });
        await a.page.locator('.ctx-menu .ctx-item:has-text("삭제")').click();
        await expect.poll(() => existsSync(bMap), { timeout: 40_000, message: '참가자의 미러가 사라짐' }).toBe(false);
        await expect(b.page.getByText('휴지통으로 옮겼어요')).toBeVisible({ timeout: 10_000 });
        await expect(b.page.locator('.tab')).toHaveCount(0); // 열려 있던 뷰어 탭이 닫힌다
        await expect(fileRow(b.page, `${MAP_NAME}.mind`)).toHaveCount(0); // 사이드바에서도 사라짐
        // 영구 삭제가 아니라 휴지통(복구 가능) — 워크스페이스 .trash 안에 내용이 남아 있다
        const trashDir = join(b.workspace, '.trash');
        const trashed: string[] = [];
        const walk = (dir: string) => {
          for (const n of readdirSync(dir, { withFileTypes: true })) {
            const p = join(dir, n.name);
            if (n.isDirectory()) walk(p);
            else if (n.name.endsWith('.mind')) trashed.push(p);
          }
        };
        if (existsSync(trashDir)) walk(trashDir);
        expect(trashed.length).toBeGreaterThan(0);
        expect(readFileSync(trashed[0], 'utf-8')).toContain('루트 주제');
        expect(existsSync(bBoard)).toBe(true); // 다른 파일은 그대로
      });
    } finally {
      await relay.close();
    }
  },
);
