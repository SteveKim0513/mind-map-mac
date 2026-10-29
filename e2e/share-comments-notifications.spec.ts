import { test, expect, type Page } from '@playwright/test';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { launchApp, type AppHandle } from './helpers';
import { shootBothThemes, startTestRelay, withApps } from './shareHelpers';

// 공유 폴더 코멘트 + 즉시 알림 + 알림 센터(ADR 0021 단계 8). 소유자 A와 참가자 B(뷰어)가 같은 폴더의 맵·보드·노트에 코멘트를 남기고,
// 상대 인스턴스에 포커스 이동·새로고침 없이 토스트·사이드바 종 뱃지가 뜨며, 알림 센터에서 읽음을 관리한다.
// 각 테스트는 자체 릴레이·격리된 인스턴스를 쓴다(병렬 안전). 시각 확인: SHARE_E2E_SHOTS=<dir> 이면 라이트/다크 스크린샷을 저장한다.

const OWNER = '지호';
const GUEST = '민수';
const FOLDER = '기획';
const MAP_FILE = '계획.mind';
const BOARD_FILE = '아이디어.board';
const NOTE_FILE = '회의록.md';
const NOTE_ID = 'e2e-comments-note';

const MAP_TEXT = JSON.stringify(
  {
    version: 1,
    id: 'e2e-cmt-map',
    rootIds: ['n1'],
    nodes: {
      n1: { id: 'n1', text: '루트 주제', parentId: null, children: ['n2', 'n3'], collapsed: false },
      n2: { id: 'n2', text: '일정 있는 가지', parentId: 'n1', children: [], collapsed: false },
      n3: { id: 'n3', text: '다른 가지', parentId: 'n1', children: [], collapsed: false },
    },
    view: { zoom: 1, panX: 0, panY: 0 },
  },
  null,
  2,
);

const BOARD_TEXT = JSON.stringify(
  {
    version: 1,
    id: 'e2e-cmt-board',
    elements: {
      s1: { id: 's1', kind: 'sticky', x: 40, y: 120, width: 180, height: 140, text: '아이디어 조각', color: 'yellow' },
      s2: { id: 's2', kind: 'sticky', x: 300, y: 120, width: 180, height: 140, text: '두 번째 조각', color: 'green' },
    },
    order: ['s1', 's2'],
    view: { zoom: 1, panX: 0, panY: 0 },
  },
  null,
  2,
);

const NOTE_TEXT = ['---', `id: "${NOTE_ID}"`, 'title: "회의록"', 'links: []', '---', '# 회의록', '', '첫 문단입니다', ''].join('\n');

const folderRow = (page: Page, name: string) => page.locator(`.row[data-node-path$="/${name}"]`);
// 사이드바 파일 행은 종류 아이콘으로 찾는다 — 파일명 문자열은 macOS에서 유니코드 정규화(NFC/NFD)가 달라 못 믿는다. 폴더에는 종류당 파일이 하나뿐이다.
// 공유 폴더 안의 행만 잡는다 — 워크스페이스 최상위의 개인(비공유) 맵 행까지 `.first()`로 잡으면, 폴더 트리가 아직 펼쳐지지/갱신되지 않은 순간에
// 개인 맵 행이 먼저 "보이는" 행이 되어 엉뚱한 파일을 열게 된다(3인 시나리오의 간헐 실패 원인: 테스트 인프라, 제품 버그 아님).
const fileRow = (page: Page, file: string) =>
  page.locator(`.row[data-node-path*="/${FOLDER}/"]:has(.ficon--${file.endsWith('.board') ? 'board' : file.endsWith('.md') ? 'note' : 'map'})`).first();

const bell = (page: Page) => page.getByTestId('sb-notifications');
const badge = (page: Page) => page.getByTestId('sb-notifications-badge');
const thread = (page: Page) => page.getByTestId('comment-thread');
const notiCenter = (page: Page) => page.getByTestId('notification-center');
const notiItems = (page: Page) => notiCenter(page).getByTestId('noti-item');

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

/** 사이드바에서 파일 행이 보이게 한다(미러링·복제 직후엔 트리가 옛 상태일 수 있어 'workspace:focus'를 보내 다시 읽게 한다). */
async function revealFile(h: AppHandle, file: string) {
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
}
const openFromSidebar = async (h: AppHandle, file: string) => {
  await (await revealFile(h, file)).click();
};

/**
 * A: 폴더에 맵·보드·노트를 파일로 먼저 만든 뒤(렌더러를 다시 불러 트리가 읽게 한다) 공유 → B 참가 → B에 세 파일이 모두 나타날 때까지 진행.
 * 반환: 두 워크스페이스의 경로.
 */
async function setupShared(a: AppHandle, b: AppHandle) {
  const dir = join(a.workspace, FOLDER);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, MAP_FILE), MAP_TEXT, 'utf-8');
  writeFileSync(join(dir, BOARD_FILE), BOARD_TEXT, 'utf-8');
  writeFileSync(join(dir, NOTE_FILE), NOTE_TEXT, 'utf-8');
  await a.page.reload();
  await expect(folderRow(a.page, FOLDER)).toBeVisible({ timeout: 15_000 });
  const code = await createSharedFolder(a.page);
  await expect(a.page.getByTestId('share-panel').getByTestId('share-status')).toHaveAttribute('data-status', 'connected', { timeout: 15_000 });
  await a.page.keyboard.press('Escape'); // 공유 패널 닫기(한 단계 복귀)
  await expect(a.page.getByTestId('share-panel')).toHaveCount(0);
  await joinWithCode(b.page, code, GUEST);
  await expect(folderRow(b.page, FOLDER)).toBeVisible({ timeout: 15_000 });
  const bDir = join(b.workspace, FOLDER);
  await expect
    .poll(() => [MAP_FILE, BOARD_FILE, NOTE_FILE].every((f) => existsSync(join(bDir, f))), { timeout: 40_000, message: 'B에 소유자의 맵·보드·노트가 나타남' })
    .toBe(true);
  // 참가자가 참가한 직후엔 기준선이 잡히고 종 버튼이 생긴다(공유 폴더가 있으므로) — 아직 알림은 없다
  await expect(bell(b.page)).toBeVisible({ timeout: 15_000 });
  await expect(badge(b.page)).toHaveCount(0);
  return { aDir: dir, bDir };
}

/** 참가자 B가 (뷰어) 맵 노드에 우클릭 → "코멘트 남기기" → 스레드에 글을 써 보낸다. */
async function commentOnNode(page: Page, nodeText: string, text: string): Promise<void> {
  await page.locator('.node', { hasText: nodeText }).click({ button: 'right' });
  await page.locator('.ctx-menu .ctx-item', { hasText: '코멘트 남기기' }).click();
  await expect(thread(page)).toBeVisible();
  await page.getByTestId('comment-input').fill(text);
  await page.getByTestId('comment-input').press('Enter');
  await expect(thread(page).getByTestId('comment-item').filter({ hasText: text })).toBeVisible();
}

/** (소유자) 공유 설정 패널에서 새 초대 코드를 만든다 — 세 번째 참가자를 부를 때. */
async function newInviteCode(page: Page): Promise<string> {
  await folderRow(page, FOLDER).click({ button: 'right' });
  await page.locator('.ctx-menu .ctx-item:has-text("공유 설정")').click();
  await page.getByTestId('share-new-code').click();
  const code = page.getByTestId('share-invite-code');
  await expect(code).toBeVisible({ timeout: 15_000 });
  const text = (await code.innerText()).trim();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('share-panel')).toHaveCount(0);
  return text;
}

/** 알림 센터를 연다(사이드바 맨 아래 종 버튼). */
async function openCenter(page: Page): Promise<void> {
  await bell(page).click();
  await expect(notiCenter(page)).toBeVisible();
}

test(
  '코멘트(맵): 뷰어인 참가자가 노드에 코멘트 → 소유자에게 즉시 토스트·뱃지 → 알림 센터에서 열기·읽음·모두 읽음, 재시작 후에도 읽음 유지',
  { tag: ['@share', '@map'] },
  async () => {
    test.setTimeout(300_000);
    const relay = await startTestRelay();
    try {
      await withApps(2, { MINDMAP_RELAY_URL: relay.url }, async ([a, b]) => {
        await setupShared(a, b);

        // 소유자는 다른 일을 하는 중이다 — 맵을 열어 두고, 알림 관련 화면은 열지 않는다
        await openFromSidebar(a, MAP_FILE);
        await a.page.waitForSelector('.canvas .node');
        await expect(a.page.locator('[data-testid="comment-chip"]')).toHaveCount(0); // 코멘트가 없는 노드에는 칩이 없다
        await expect(badge(a.page)).toHaveCount(0);

        // (b) 참가자(뷰어)가 노드에 코멘트를 남긴다 — 편집 없이. 뷰어 컨텍스트 메뉴에도 "코멘트 남기기"가 있다
        await openFromSidebar(b, MAP_FILE);
        await b.page.waitForSelector('.canvas .node');
        await expect(b.page.getByTestId('viewer-badge')).toBeVisible();
        await b.page.locator('.node', { hasText: '일정 있는 가지' }).click({ button: 'right' });
        const menu = b.page.locator('.ctx-menu');
        await expect(menu.locator('.ctx-item', { hasText: '코멘트 남기기' })).toBeVisible();
        for (const label of ['삭제', '편집', '자식 추가', '형제 추가', '복제']) await expect(menu.locator('.ctx-item', { hasText: label })).toHaveCount(0);
        await menu.locator('.ctx-item', { hasText: '코멘트 남기기' }).click();
        await expect(thread(b.page)).toBeVisible();
        await expect(thread(b.page).getByText('아직 코멘트가 없어요')).toBeVisible();
        await shootBothThemes(b.page, 'comments-thread-empty');
        // Shift+Enter는 줄바꿈, Enter는 전송
        const input = b.page.getByTestId('comment-input');
        await input.fill('이 일정');
        await input.press('Shift+Enter');
        await input.type('확인해 주세요');
        await expect(thread(b.page).getByTestId('comment-item')).toHaveCount(0);
        await input.press('Enter');
        const bItem = thread(b.page).getByTestId('comment-item').filter({ hasText: '확인해 주세요' });
        await expect(bItem).toBeVisible();
        await expect(bItem).toContainText('이 일정');
        await expect(bItem.getByTestId('comment-delete')).toBeVisible(); // 내 코멘트만 지울 수 있다
        // 참가자의 노드에는 코멘트 칩(개수)이 생긴다
        await b.page.keyboard.press('Escape'); // 바깥 클릭/Esc로 닫힌다
        await expect(thread(b.page)).toHaveCount(0);
        await expect(b.page.locator('.node', { hasText: '일정 있는 가지' }).getByTestId('comment-chip')).toHaveText('1');
        // 본인 코멘트는 본인에게 알림이 아니다
        await expect(badge(b.page)).toHaveCount(0);
        await expect(b.page.locator('.toast')).toHaveCount(0);

        // 소유자: 포커스 이동·새로고침 없이 토스트 + 종 뱃지 + 노드 칩이 뜬다
        const toast = a.page.locator('.toast', { hasText: `${GUEST}님의 코멘트` });
        await expect(toast).toBeVisible({ timeout: 20_000 });
        await expect(toast).toContainText('확인해 주세요');
        await expect(badge(a.page)).toHaveText('1');
        await expect(badge(a.page)).toHaveAttribute('data-count', '1');
        await expect(bell(a.page)).toHaveAttribute('aria-label', '알림, 안 읽음 1개');
        await expect(a.page.locator('.node', { hasText: '일정 있는 가지' }).getByTestId('comment-chip')).toHaveText('1');
        await shootBothThemes(a.page, 'comments-toast-badge');

        // (c) 알림 센터: 안 읽음으로 표시된 항목 하나 — 굵기·점·"안 읽음" 글자로 구분
        await openCenter(a.page);
        await expect(notiItems(a.page)).toHaveCount(1);
        const item = notiItems(a.page).first();
        await expect(item).toHaveAttribute('data-read', 'false');
        await expect(item.getByTestId('noti-unread-tag')).toHaveText('안 읽음');
        await expect(item).toContainText(GUEST);
        await expect(item).toContainText('이 일정');
        await expect(item).toContainText('일정 있는 가지'); // 대상(어느 노드인지)
        await expect(item).toContainText('계획'); // 대상(어느 파일인지)
        await expect(notiCenter(a.page).getByTestId('noti-summary')).toHaveText('안 읽음 1개');
        await expect(notiCenter(a.page).getByTestId('noti-read-all')).toBeEnabled();
        // 패널을 열었다고 자동으로 읽음 처리되지 않는다
        await expect(badge(a.page)).toHaveText('1');
        await shootBothThemes(a.page, 'comments-center-unread');

        // 항목 클릭 → 패널이 닫히고, 해당 노드가 선택되고, 스레드가 열리고, 읽음 처리된다
        await item.click();
        await expect(notiCenter(a.page)).toHaveCount(0);
        await expect(a.page.locator('.node', { hasText: '일정 있는 가지' })).toHaveClass(/selected/);
        await expect(thread(a.page)).toBeVisible();
        await expect(thread(a.page).getByTestId('comment-item').filter({ hasText: '확인해 주세요' })).toBeVisible();
        await expect(badge(a.page)).toHaveCount(0);
        await shootBothThemes(a.page, 'comments-owner-thread');

        // (d) 소유자가 답글 → 스레드 참여자인 B에게도 알림
        await thread(a.page).getByTestId('comment-item').filter({ hasText: '확인해 주세요' }).getByTestId('comment-reply').click();
        await expect(thread(a.page).getByText(`${GUEST}님에게 답글`)).toBeVisible();
        await a.page.getByTestId('comment-input').fill('일정은 다음 주로 옮길게요');
        await a.page.getByTestId('comment-input').press('Enter');
        await expect(thread(a.page).getByTestId('comment-item').filter({ hasText: '옮길게요' })).toBeVisible();
        await expect(badge(a.page)).toHaveCount(0); // 내가 쓴 답글은 내게 알림이 아니다
        const bToast = b.page.locator('.toast', { hasText: `${OWNER}님의 코멘트` });
        await expect(bToast).toBeVisible({ timeout: 20_000 });
        await expect(badge(b.page)).toHaveText('1');
        // 참가자 화면의 스레드에도 답글이 들어와 있다(열려 있는 팝오버가 실시간 갱신)
        await b.page.locator('.node', { hasText: '일정 있는 가지' }).getByTestId('comment-chip').click();
        await expect(thread(b.page).getByTestId('comment-item')).toHaveCount(2);
        await expect(thread(b.page).getByTestId('comment-item').filter({ hasText: '옮길게요' })).toBeVisible();
        // 남의 코멘트에는 삭제 버튼이 없다
        await expect(thread(b.page).getByTestId('comment-item').filter({ hasText: '옮길게요' }).getByTestId('comment-delete')).toHaveCount(0);
        await b.page.keyboard.press('Escape');

        // (e) 읽음 관리 — B에서: 토스트 '보기'로 이동하면 읽음, 개별 토글로 안 읽음으로 되돌리기
        await bToast.getByRole('button', { name: '보기' }).click();
        await expect(thread(b.page)).toBeVisible();
        await expect(badge(b.page)).toHaveCount(0);
        await b.page.keyboard.press('Escape');
        await openCenter(b.page);
        const bItem1 = notiItems(b.page).first();
        await expect(bItem1).toHaveAttribute('data-read', 'true');
        await bItem1.getByTestId('noti-toggle').click(); // 안 읽음으로 되돌리기(항목을 열지 않는다)
        await expect(bItem1).toHaveAttribute('data-read', 'false');
        await expect(notiCenter(b.page)).toBeVisible(); // 토글은 패널을 닫지 않는다
        await expect(badge(b.page)).toHaveText('1');
        await bItem1.getByTestId('noti-toggle').click();
        await expect(bItem1).toHaveAttribute('data-read', 'true');
        await expect(badge(b.page)).toHaveCount(0);
        await b.page.keyboard.press('Escape'); // Esc는 알림 센터를 닫는다(한 단계 복귀)
        await expect(notiCenter(b.page)).toHaveCount(0);

        // A: 참가자가 코멘트를 하나 더 남기면 안 읽음이 하나 더 쌓인다(앞의 것은 읽음)
        await b.page.locator('.node', { hasText: '일정 있는 가지' }).getByTestId('comment-chip').click();
        await b.page.getByTestId('comment-input').fill('두 번째 코멘트예요');
        await b.page.getByTestId('comment-input').press('Enter');
        await expect(thread(b.page).getByTestId('comment-item').filter({ hasText: '두 번째' })).toBeVisible();
        await b.page.keyboard.press('Escape');
        await expect(badge(a.page)).toHaveText('1', { timeout: 20_000 });
        await openCenter(a.page);
        await expect(notiItems(a.page)).toHaveCount(2);
        await expect(notiItems(a.page).nth(0)).toHaveAttribute('data-read', 'false'); // 최신순: 방금 온 것이 맨 위
        await expect(notiItems(a.page).nth(0)).toContainText('두 번째');
        await expect(notiItems(a.page).nth(1)).toHaveAttribute('data-read', 'true');
        await shootBothThemes(a.page, 'comments-center-mixed');

        // 앱 재시작(같은 userData): 알림 목록과 읽음 상태가 그대로다
        await a.page.keyboard.press('Escape');
        await a.app.close();
        const a2 = await launchApp({ env: { MINDMAP_RELAY_URL: relay.url }, reuse: { userData: a.userData, workspace: a.workspace } });
        try {
          await expect(badge(a2.page)).toHaveText('1', { timeout: 20_000 });
          await openCenter(a2.page);
          await expect(notiItems(a2.page)).toHaveCount(2);
          await expect(notiItems(a2.page).nth(0)).toHaveAttribute('data-read', 'false');
          await expect(notiItems(a2.page).nth(1)).toHaveAttribute('data-read', 'true');
          // 재시작·재연결로 같은 코멘트가 다시 알림이 되지 않는다(코멘트 id로 중복 방지)
          await a2.page.waitForTimeout(3_000);
          await expect(notiItems(a2.page)).toHaveCount(2);

          // "모두 읽음" — 패널 안 모든 항목이 읽음으로, 뱃지 사라짐. 디스크에도 기록된다
          await notiCenter(a2.page).getByTestId('noti-read-all').click();
          await expect(notiItems(a2.page).first()).toHaveAttribute('data-read', 'true');
          await expect(notiItems(a2.page).nth(1)).toHaveAttribute('data-read', 'true');
          await expect(notiCenter(a2.page).getByTestId('noti-read-all')).toBeDisabled();
          await expect(notiCenter(a2.page).getByTestId('noti-summary')).toHaveText('모두 읽었어요');
          await expect(badge(a2.page)).toHaveCount(0);
          await expect
            .poll(() => {
              const p = join(a.userData, 'notifications.json');
              if (!existsSync(p)) return null;
              const saved = JSON.parse(readFileSync(p, 'utf-8')) as { items: { read: boolean }[] };
              return saved.items.length === 2 && saved.items.every((i) => i.read);
            }, { timeout: 10_000, message: '읽음 상태가 userData/notifications.json에 저장됨' })
            .toBe(true);
          await shootBothThemes(a2.page, 'comments-center-all-read');
        } finally {
          await a2.cleanup();
        }
      });
    } finally {
      await relay.close();
    }
  },
);

test(
  '코멘트(보드·노트): 보드 요소와 노트 전체에 코멘트 → 소유자 알림 → 토스트 "보기"·알림 센터로 해당 위치로 이동',
  { tag: ['@share', '@board', '@note'] },
  async () => {
    test.setTimeout(300_000);
    const relay = await startTestRelay();
    try {
      await withApps(2, { MINDMAP_RELAY_URL: relay.url }, async ([a, b]) => {
        await setupShared(a, b);

        // ── 보드: 참가자(뷰어)가 스티키에 코멘트 ──
        await openFromSidebar(b, BOARD_FILE);
        await b.page.waitForSelector('.board-canvas .board-el--sticky');
        await expect(b.page.getByTestId('viewer-badge')).toBeVisible();
        await b.page.locator('.board-el--sticky', { hasText: '아이디어 조각' }).click({ button: 'right' });
        await expect(b.page.locator('.ctx-menu .ctx-item')).toHaveText(['코멘트 남기기']); // 뷰어: 편집 항목 없이 코멘트만
        await b.page.locator('.ctx-menu .ctx-item', { hasText: '코멘트 남기기' }).click();
        await expect(thread(b.page)).toBeVisible();
        await b.page.getByTestId('comment-input').fill('이 조각 색을 바꿔 볼까요?');
        await b.page.getByTestId('comment-input').press('Enter');
        await expect(thread(b.page).getByTestId('comment-item').filter({ hasText: '색을 바꿔' })).toBeVisible();
        await b.page.keyboard.press('Escape');
        await expect(b.page.locator('.board-el--sticky', { hasText: '아이디어 조각' }).getByTestId('comment-chip')).toHaveText('1');
        await expect(b.page.locator('.board-el--sticky', { hasText: '두 번째 조각' }).getByTestId('comment-chip')).toHaveCount(0);
        await shootBothThemes(b.page, 'comments-board-chip');

        // 소유자는 다른 파일(노트)을 보고 있다 — 다른 파일을 보고 있어도 토스트·뱃지가 뜬다
        await openFromSidebar(a, NOTE_FILE);
        await expect(a.page.locator('.note-pane .note-rich .ProseMirror')).toBeVisible({ timeout: 15_000 });
        const toast = a.page.locator('.toast', { hasText: `${GUEST}님의 코멘트` });
        await expect(toast).toBeVisible({ timeout: 20_000 });
        await expect(toast).toContainText('색을 바꿔');
        await expect(badge(a.page)).toHaveText('1');
        // 토스트의 "보기" → 보드가 열리고 해당 스티키가 선택되고 스레드가 열린다. 읽음 처리
        await toast.getByRole('button', { name: '보기' }).click();
        await a.page.waitForSelector('.board-canvas .board-el--sticky');
        await expect(a.page.locator('.board-el--sticky', { hasText: '아이디어 조각' })).toHaveClass(/selected/);
        await expect(thread(a.page)).toBeVisible();
        await expect(thread(a.page).getByTestId('comment-item').filter({ hasText: '색을 바꿔' })).toBeVisible();
        await expect(badge(a.page)).toHaveCount(0);
        await shootBothThemes(a.page, 'comments-board-thread');
        await a.page.keyboard.press('Escape');
        await expect(thread(a.page)).toHaveCount(0);

        // ── 노트: 노트 전체 단위 코멘트 (헤더의 "코멘트" 버튼) ──
        await openFromSidebar(b, NOTE_FILE);
        await expect(b.page.locator('.note-pane .note-rich .ProseMirror')).toBeVisible({ timeout: 15_000 });
        await expect(b.page.getByTestId('note-shared-badge')).toBeVisible();
        const cbtn = b.page.getByTestId('note-comment-btn');
        await expect(cbtn).toBeVisible();
        await expect(b.page.getByTestId('note-comment-count')).toHaveCount(0);
        await cbtn.click();
        await expect(thread(b.page)).toBeVisible();
        await b.page.getByTestId('comment-input').fill('회의록 제목을 다듬어 주세요');
        await b.page.getByTestId('comment-input').press('Enter');
        await expect(thread(b.page).getByTestId('comment-item').filter({ hasText: '제목을 다듬어' })).toBeVisible();
        await cbtn.click(); // 같은 버튼으로 다시 누르면 닫힌다
        await expect(thread(b.page)).toHaveCount(0);
        await expect(b.page.getByTestId('note-comment-count')).toHaveText('1');
        await shootBothThemes(b.page, 'comments-note-header');

        // 소유자(보드를 보고 있음): 새 알림 → 알림 센터에서 노트 항목을 눌러 이동
        await expect(badge(a.page)).toHaveText('1', { timeout: 20_000 });
        await openCenter(a.page);
        await expect(notiItems(a.page)).toHaveCount(2);
        const noteItem = notiItems(a.page).nth(0); // 최신순 — 방금 온 노트 코멘트
        await expect(noteItem).toHaveAttribute('data-read', 'false');
        await expect(noteItem).toContainText('회의록');
        await expect(noteItem).toContainText('제목을 다듬어');
        await expect(notiItems(a.page).nth(1)).toHaveAttribute('data-read', 'true'); // 앞서 "보기"로 연 보드 코멘트
        await noteItem.click();
        await expect(notiCenter(a.page)).toHaveCount(0);
        await expect(a.page.locator('.note-pane .note-rich .ProseMirror')).toBeVisible({ timeout: 15_000 });
        await expect(thread(a.page)).toBeVisible();
        await expect(thread(a.page).getByTestId('comment-item').filter({ hasText: '제목을 다듬어' })).toBeVisible();
        await expect(a.page.getByTestId('note-comment-btn')).toHaveAttribute('aria-pressed', 'true');
        await expect(badge(a.page)).toHaveCount(0);
        await shootBothThemes(a.page, 'comments-note-thread');

        // 자기 코멘트만 지운다: 소유자는 참가자의 코멘트를 지울 수 없고, 참가자는 자기 것을 지울 수 있다(소프트 삭제)
        await expect(thread(a.page).getByTestId('comment-delete')).toHaveCount(0);
        await b.page.getByTestId('note-comment-btn').click();
        await expect(thread(b.page).getByTestId('comment-delete')).toHaveCount(1);
        await thread(b.page).getByTestId('comment-delete').click();
        await expect(thread(b.page).getByTestId('comment-item')).toHaveCount(0);
        await expect(thread(b.page).getByText('아직 코멘트가 없어요')).toBeVisible();
        await expect(thread(a.page).getByTestId('comment-item')).toHaveCount(0, { timeout: 20_000 }); // 소유자 화면에서도 사라진다
        // 지워진 코멘트의 알림도 거둔다
        await a.page.keyboard.press('Escape');
        await openCenter(a.page);
        await expect(notiItems(a.page)).toHaveCount(1);
      });
    } finally {
      await relay.close();
    }
  },
);

// 인스턴스 3개(+ CI에서 다른 spec 병렬)는 느린 러너에서 20초 기대가 경합에 밀린다(v0.14.0 CI에서 comment-chip이 재시도로 통과) — 이 시나리오의 기대는 여유 있게 기다린다.
const THREE_PERSON_WAIT_MS = 60_000;

test(
  '코멘트: 비공유 파일에는 코멘트 UI가 없고, 관련 없는 참가자에게는 알림이 가지 않는다(코멘트는 보인다)',
  { tag: ['@share', '@map'] },
  async () => {
    test.setTimeout(420_000);
    const relay = await startTestRelay();
    try {
      await withApps(3, { MINDMAP_RELAY_URL: relay.url }, async ([a, b, c]) => {
        // 일반(비공유) 워크스페이스의 맵: 코멘트 메뉴·칩·종 버튼이 전혀 없다
        writeFileSync(join(c.workspace, '개인.mind'), MAP_TEXT.replace('루트 주제', '개인 맵의 루트'), 'utf-8');
        await c.page.reload();
        await c.page.locator('.row:has(.ficon--map)').first().click();
        await c.page.waitForSelector('.canvas .node');
        await c.page.locator('.node', { hasText: '개인 맵의 루트' }).click({ button: 'right' });
        await expect(c.page.locator('.ctx-menu .ctx-item', { hasText: '코멘트 남기기' })).toHaveCount(0);
        await c.page.keyboard.press('Escape');
        await c.page.locator('.tab.active .tab-close').click();
        await expect(bell(c.page)).toHaveCount(0); // 공유 폴더가 없고 받은 알림도 없으면 종 버튼은 보이지 않는다
        await expect(c.page.getByTestId('comment-chip')).toHaveCount(0);

        // 공유: A 소유자, B·C 참가자
        await setupShared(a, b);
        const inviteRes = await newInviteCode(a.page);
        await joinWithCode(c.page, inviteRes, '하나');
        await expect(folderRow(c.page, FOLDER)).toBeVisible({ timeout: THREE_PERSON_WAIT_MS });
        await expect
          .poll(() => existsSync(join(c.workspace, FOLDER, MAP_FILE)), { timeout: THREE_PERSON_WAIT_MS, message: 'C에도 소유자의 맵이 나타남' })
          .toBe(true);
        await expect(bell(c.page)).toBeVisible({ timeout: THREE_PERSON_WAIT_MS });

        // B가 코멘트 → 소유자 A에게는 알림, 관련 없는 참가자 C에게는 알림 없음 (하지만 C 화면에는 코멘트 칩이 보인다)
        await openFromSidebar(c, MAP_FILE);
        // 개인 맵이 아니라 소유자의 맵(루트 '루트 주제')이 열렸는지 확인한다 — 노드 존재만 기다리면 아무 맵이나 통과한다
        await expect(c.page.locator('.node', { hasText: '루트 주제' })).toBeVisible({ timeout: THREE_PERSON_WAIT_MS });
        await openFromSidebar(b, MAP_FILE);
        await b.page.waitForSelector('.canvas .node');
        await commentOnNode(b.page, '다른 가지', '관련자에게만 알려요');
        await expect(badge(a.page)).toHaveText('1', { timeout: THREE_PERSON_WAIT_MS });
        await expect(c.page.locator('.node', { hasText: '다른 가지' }).getByTestId('comment-chip')).toHaveText('1', { timeout: THREE_PERSON_WAIT_MS });
        await expect(badge(c.page)).toHaveCount(0);
        await expect(c.page.locator('.toast', { hasText: '코멘트' })).toHaveCount(0);
        await openCenter(c.page);
        await expect(c.page.getByTestId('noti-empty')).toBeVisible();
        await shootBothThemes(c.page, 'comments-center-empty');
        await c.page.keyboard.press('Escape');
        // C가 자기 코멘트를 남기면 C는 그 스레드 참여자가 된다 — 이후 B의 코멘트는 C에게도 알림
        await commentOnNode(c.page, '다른 가지', '저도 궁금해요');
        await c.page.keyboard.press('Escape');
        await expect(badge(b.page)).toHaveText('1', { timeout: THREE_PERSON_WAIT_MS }); // B(스레드 참여자)에게 C의 코멘트 알림
        await b.page.locator('.node', { hasText: '다른 가지' }).getByTestId('comment-chip').click();
        await b.page.getByTestId('comment-input').fill('답변드릴게요');
        await b.page.getByTestId('comment-input').press('Enter');
        await expect(badge(c.page)).toHaveText('1', { timeout: THREE_PERSON_WAIT_MS });
      });
    } finally {
      await relay.close();
    }
  },
);
