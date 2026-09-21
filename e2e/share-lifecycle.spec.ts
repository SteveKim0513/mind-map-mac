import { test, expect, type Page } from '@playwright/test';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { shootBothThemes, startTestRelay, stubClipboard, withApps } from './shareHelpers';

// 공유 폴더 수명주기(ADR 0021 단계 5): 만들기 → 초대 코드 → 참가 → 참가자·온라인 표시 → 내보내기 → 정리.
// 각 테스트는 자체 릴레이(메모리 DB·임의 포트)와 격리된 Electron 인스턴스를 띄운다 — 병렬 안전.
// 시각 확인: SHARE_E2E_SHOTS=<dir> 를 주면 라이트/다크 스크린샷을 저장한다.

const OWNER = '지호';
const GUEST = '민수';
const FOLDER = '기획';

/** 사이드바의 "새 폴더" → 이름 입력 → Enter. 선택된 폴더가 있으면 그 안에 만들어진다. */
async function newFolder(page: Page, name: string): Promise<void> {
  await page.click('.sb-section-btn[title="새 폴더"]');
  const input = page.locator('.rename-input');
  await input.waitFor({ timeout: 5_000 });
  await input.fill(name);
  await input.press('Enter');
  await expect(page.locator(`.row[data-node-path$="/${name}"]`)).toBeVisible({ timeout: 5_000 });
}

const folderRow = (page: Page, name: string) => page.locator(`.row[data-node-path$="/${name}"]`);

async function openCreateDialog(page: Page, folder: string): Promise<void> {
  await folderRow(page, folder).click({ button: 'right' });
  await page.locator('.ctx-menu .ctx-item:has-text("공유 폴더로 만들기")').click();
  await expect(page.getByRole('dialog', { name: '공유 폴더로 만들기' })).toBeVisible();
  await shootBothThemes(page, 'create-dialog');
}

async function createSharedFolder(page: Page, folder: string): Promise<string> {
  await newFolder(page, folder);
  await openCreateDialog(page, folder);
  await page.getByTestId('share-name-input').fill(OWNER);
  await page.getByTestId('share-create-submit').click();
  // 초대 코드 화면으로 이어진다 — 코드가 크게 보인다.
  const code = page.getByTestId('share-invite-code');
  await expect(code).toBeVisible({ timeout: 15_000 });
  return (await code.innerText()).trim();
}

async function joinWithCode(page: Page, code: string, name: string): Promise<void> {
  await page.click('.sb-section-btn[title="공유 폴더 참가"]');
  await expect(page.getByRole('dialog', { name: '공유 폴더 참가' })).toBeVisible();
  await page.getByTestId('share-code-input').fill(code);
  await page.getByTestId('share-name-input').fill(name);
  await page.getByTestId('share-join-submit').click();
}

test(
  '공유 폴더: 만들기 → 코드로 참가 → 참가자 표시 → 내보내기 → 정리',
  { tag: ['@share'] },
  async () => {
    test.setTimeout(120_000);
    const relay = await startTestRelay();
    try {
      await withApps(2, { MINDMAP_RELAY_URL: relay.url }, async ([a, b]) => {
        // (a) A가 공유 폴더를 만들면 초대 코드가 보이고, 트리에 연결됨 표식이 붙는다
        const code = await createSharedFolder(a.page, FOLDER);
        expect(code).toMatch(/^[0-9A-Z]{4}-[0-9A-Z]{4}$/);
        const panelA = a.page.getByTestId('share-panel');
        await expect(panelA.getByTestId('share-invite-remaining')).toContainText('뒤에 만료돼요');
        await expect(panelA.getByTestId('share-status')).toHaveAttribute('data-status', 'connected', { timeout: 15_000 });
        await shootBothThemes(a.page, 'a-created-panel');

        const ownerMarker = JSON.parse(readFileSync(join(a.workspace, FOLDER, '.mindshare', 'room.json'), 'utf-8'));
        expect(ownerMarker).toMatchObject({ role: 'owner', folderName: FOLDER, displayName: OWNER });
        expect(JSON.stringify(ownerMarker)).not.toMatch(/token/i); // 토큰은 표식 파일에 두지 않는다

        // (b) B가 코드로 참가하면 B의 워크스페이스에 같은 이름의 폴더가 생긴다
        await joinWithCode(b.page, code, GUEST);
        await expect(folderRow(b.page, FOLDER)).toBeVisible({ timeout: 15_000 });
        await expect(folderRow(b.page, FOLDER).locator('.share-ic[data-share-status="connected"]')).toBeVisible({ timeout: 15_000 });
        const guestMarker = JSON.parse(readFileSync(join(b.workspace, FOLDER, '.mindshare', 'room.json'), 'utf-8'));
        expect(guestMarker).toMatchObject({ role: 'participant', folderName: FOLDER, displayName: GUEST });
        expect(guestMarker.roomId).toBe(ownerMarker.roomId);

        // (c) 두 인스턴스 모두 참가자 목록에 서로가 온라인으로 보인다 (열려 있는 패널은 주기적으로 갱신)
        await expect(panelA.getByTestId('share-person')).toHaveCount(2, { timeout: 20_000 });
        await expect(panelA.locator('.share-person[data-online="true"]')).toHaveCount(2, { timeout: 20_000 });
        await expect(panelA.locator('.share-person', { hasText: GUEST })).toContainText('참가자');
        await expect(panelA.locator('.share-person', { hasText: OWNER })).toContainText('소유자');

        await folderRow(b.page, FOLDER).getByTestId('share-badge').click();
        const panelB = b.page.getByTestId('share-panel');
        await expect(panelB.getByTestId('share-person')).toHaveCount(2, { timeout: 15_000 });
        await expect(panelB.locator('.share-person[data-online="true"]')).toHaveCount(2, { timeout: 20_000 });
        await expect(panelB.locator('.share-person', { hasText: GUEST })).toContainText('나');
        // 참가자에게는 초대 코드·내보내기가 없고 "나가기"가 있다
        await expect(panelB.getByTestId('share-invite-code')).toHaveCount(0);
        await expect(panelB.getByTestId('share-revoke')).toHaveCount(0);
        await expect(panelB.getByTestId('share-leave')).toBeVisible();
        await shootBothThemes(b.page, 'b-participants-panel');
        await b.page.keyboard.press('Escape'); // 패널 닫기(한 단계 복귀)
        await expect(panelB).toHaveCount(0);

        // (d) A가 B를 내보내면 확인을 거쳐 목록에서 사라지고, B는 '접근 해제됨'이 된다
        await panelA.locator('.share-person', { hasText: GUEST }).getByTestId('share-revoke').click();
        await expect(a.page.getByTestId('share-confirm')).toContainText(`"${GUEST}"님을 내보낼까요?`);
        await shootBothThemes(a.page, 'a-revoke-confirm');
        await a.page.getByTestId('share-confirm-revoke').click();
        await expect(panelA.getByTestId('share-person')).toHaveCount(1, { timeout: 10_000 });

        const badgeB = folderRow(b.page, FOLDER).locator('.share-ic');
        await expect(badgeB).toHaveAttribute('data-share-status', 'denied', { timeout: 20_000 });
        await folderRow(b.page, FOLDER).getByTestId('share-badge').click();
        await expect(b.page.getByTestId('share-status')).toContainText('접근 해제됨');
        await expect(b.page.getByTestId('share-panel')).toContainText('내보내졌어요');
        await shootBothThemes(b.page, 'b-denied-panel');

        // 접근 해제 후 로컬 표식만 정리 — 폴더 안의 파일은 그대로다
        await b.page.getByTestId('share-forget').click();
        await b.page.getByTestId('share-confirm-forget').click();
        await expect(b.page.getByTestId('share-panel')).toHaveCount(0);
        await expect(folderRow(b.page, FOLDER).getByTestId('share-badge')).toHaveCount(0);
        expect(existsSync(join(b.workspace, FOLDER))).toBe(true);
        expect(existsSync(join(b.workspace, FOLDER, '.mindshare'))).toBe(false);
      });
    } finally {
      await relay.close();
    }
  },
);

test(
  '공유 폴더: 소유자의 공유 해제는 확인을 거치고 로컬 파일을 남긴다',
  { tag: ['@share'] },
  async () => {
    test.setTimeout(90_000);
    const relay = await startTestRelay();
    try {
      await withApps(1, { MINDMAP_RELAY_URL: relay.url }, async ([a]) => {
        const inviteCode = await createSharedFolder(a.page, FOLDER);
        const panel = a.page.getByTestId('share-panel');
        await expect(panel.getByTestId('share-status')).toHaveAttribute('data-status', 'connected', { timeout: 15_000 });

        // 코드 복사 — 시스템 클립보드는 건드리지 않고(페이지 안에서 스텁) 복사 요청 값과 "복사됨" 표시를 확인한다
        const copied = await stubClipboard(a.page);
        await panel.getByTestId('share-copy').click();
        await expect(panel.getByTestId('share-copy')).toContainText('복사됨');
        expect(await copied()).toEqual([inviteCode]);

        // Esc는 한 단계씩: 확인 창 → 패널
        await panel.getByTestId('share-unshare').click();
        await expect(a.page.getByTestId('share-confirm')).toContainText('공유를 해제할까요?');
        await a.page.keyboard.press('Escape');
        await expect(a.page.getByTestId('share-confirm')).toHaveCount(0);
        await expect(panel).toBeVisible();

        await panel.getByTestId('share-unshare').click();
        await a.page.getByTestId('share-confirm-unshare').click();
        await expect(panel).toHaveCount(0);
        await expect(folderRow(a.page, FOLDER)).toBeVisible();
        await expect(folderRow(a.page, FOLDER).getByTestId('share-badge')).toHaveCount(0);
        expect(existsSync(join(a.workspace, FOLDER))).toBe(true);
        expect(existsSync(join(a.workspace, FOLDER, '.mindshare'))).toBe(false);
      });
    } finally {
      await relay.close();
    }
  },
);

test(
  '공유 폴더: 공유 폴더 안의 폴더는 공유할 수 없고 이유를 안내한다',
  { tag: ['@share'] },
  async () => {
    test.setTimeout(90_000);
    const relay = await startTestRelay();
    try {
      await withApps(1, { MINDMAP_RELAY_URL: relay.url }, async ([a]) => {
        await createSharedFolder(a.page, FOLDER);
        await a.page.keyboard.press('Escape'); // 패널 닫기
        await expect(a.page.getByTestId('share-panel')).toHaveCount(0);

        // 공유 폴더 행의 컨텍스트 메뉴는 "공유 설정"을 연다
        await folderRow(a.page, FOLDER).click({ button: 'right' });
        await a.page.locator('.ctx-menu .ctx-item:has-text("공유 설정")').click();
        await expect(a.page.getByTestId('share-panel')).toBeVisible();
        await a.page.keyboard.press('Escape');

        // 공유 폴더 안에 새 폴더(선택된 폴더 안에 만들어진다) → 공유 시도 → 이유 안내
        await newFolder(a.page, '하위');
        await folderRow(a.page, '하위').click({ button: 'right' });
        await a.page.locator('.ctx-menu .ctx-item:has-text("공유 폴더로 만들기")').click();
        await expect(a.page.getByTestId('share-block-reason')).toContainText('이미 공유 중인 폴더 안이에요');
        await shootBothThemes(a.page, 'blocked-dialog');
        await a.page.keyboard.press('Escape');
        await expect(a.page.getByRole('dialog')).toHaveCount(0);
        await expect(folderRow(a.page, '하위').getByTestId('share-badge')).toHaveCount(0);
      });
    } finally {
      await relay.close();
    }
  },
);

test(
  '공유 폴더 참가: 잘못된 코드는 안내 문구를 보여주고, 명령 팔레트에서도 열린다',
  { tag: ['@share', '@command'] },
  async () => {
    test.setTimeout(60_000);
    const relay = await startTestRelay();
    try {
      await withApps(1, { MINDMAP_RELAY_URL: relay.url }, async ([a]) => {
        await joinWithCode(a.page, 'ZZZZZZZZ', GUEST);
        await expect(a.page.getByTestId('share-code-error')).toHaveText('코드가 올바르지 않거나 만료됐어요.', { timeout: 10_000 });
        await expect(a.page.getByTestId('share-join-submit')).toBeEnabled(); // 다시 시도할 수 있다
        await shootBothThemes(a.page, 'join-invalid-code');
        // 코드를 고치기 시작하면 오류가 사라진다
        await a.page.getByTestId('share-code-input').fill('ZZZZZZZY');
        await expect(a.page.getByTestId('share-code-error')).toHaveCount(0);
        await a.page.keyboard.press('Escape');
        await expect(a.page.getByRole('dialog')).toHaveCount(0);

        // ⌘K → "공유 폴더 참가…"
        await a.page.keyboard.press('Meta+k');
        await a.page.locator('.qo-input').fill('공유 폴더 참가');
        await a.page.keyboard.press('Enter');
        await expect(a.page.getByRole('dialog', { name: '공유 폴더 참가' })).toBeVisible();
        // 입력한 이름은 다음에 다시 채워진다(localStorage)
        await a.page.getByTestId('share-name-input').fill(GUEST);
        await a.page.keyboard.press('Escape');
        await a.page.keyboard.press('Meta+k');
        await a.page.locator('.qo-input').fill('공유 폴더로 만들기');
        await a.page.keyboard.press('Enter');
        await expect(a.page.getByRole('dialog', { name: '공유 폴더로 만들기' })).toBeVisible();
        // 워크스페이스에 공유할 폴더가 없으면 안내한다
        await expect(a.page.getByRole('dialog')).toContainText('공유할 수 있는 폴더가 없어요');
        await expect(a.page.getByTestId('share-create-submit')).toBeDisabled();
      });
    } finally {
      await relay.close();
    }
  },
);

test(
  '공유 폴더 참가: 서버 주소가 올바르지 않으면 그 사실을 안내한다',
  { tag: ['@share'] },
  async () => {
    // 잘못된 릴레이 주소 — 기본 서버 주소(DEFAULT_RELAY_URL)의 값과 무관하게 네트워크에 나가지 않는다.
    // ("설정되지 않음" 문구는 src/share/messages.test.ts가 덮는다.)
    await withApps(1, { MINDMAP_RELAY_URL: 'not a url' }, async ([a]) => {
      await joinWithCode(a.page, 'ZZZZZZZZ', GUEST);
      await expect(a.page.getByTestId('share-error')).toHaveText('공유 서버 주소가 올바르지 않아요.', { timeout: 10_000 });
      await expect(a.page.getByTestId('share-join-submit')).toBeEnabled();
    });
  },
);
