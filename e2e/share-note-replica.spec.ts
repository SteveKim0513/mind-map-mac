import { test, expect, type Page } from '@playwright/test';
import { existsSync, readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { startTestRelay, withApps } from './shareHelpers';

// 공유 폴더 노트 복제 엔진(ADR 0021 단계 6a) — UI 없는 엔진이 실제 Electron(IPC 파일 어댑터·Tiptap 코덱)에서
// 도는지 확인한다: 소유자의 기존 노트가 참가자 워크스페이스에 파일로 나타나고(원본은 그대로), 실행 중 새로 만든 노트도 전파된다.
// 동시 타이핑·커서 등 에디터 통합은 6b. 각 테스트는 자체 릴레이·격리된 인스턴스를 쓴다(병렬 안전).

const OWNER = '지호';
const GUEST = '민수';
const FOLDER = '기획';
const NOTE_ID = 'e2e-memo-1';
// 노트 사이드카 파일 이름 = `n_` + 노트 id의 소문자 hex(src/share/docKeys.ts의 sidecarIdForDocKey) — 대소문자 무시 파일시스템 충돌·시스템 사이드카 이름 충돌 방지
const NOTE_SIDECAR = `n_${Buffer.from(NOTE_ID, 'utf-8').toString('hex')}.yjs`;
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

async function newFolder(page: Page, name: string): Promise<void> {
  await page.click('.sb-section-btn[title="새 폴더"]');
  const input = page.locator('.rename-input');
  await input.waitFor({ timeout: 5_000 });
  await input.fill(name);
  await input.press('Enter');
  await expect(folderRow(page, name)).toBeVisible({ timeout: 5_000 });
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

const count = (s: string, sub: string) => s.split(sub).length - 1;

test(
  '공유 노트 복제: 소유자의 기존 노트가 참가자 폴더에 파일로 나타나고, 새 노트도 전파된다',
  { tag: ['@share', '@note'] },
  async () => {
    test.setTimeout(150_000);
    const relay = await startTestRelay();
    try {
      await withApps(2, { MINDMAP_RELAY_URL: relay.url }, async ([a, b]) => {
        // A: 폴더를 만들고 그 안에 기존 노트(프론트매터 id 포함)를 둔 뒤 공유 폴더로 만든다
        await newFolder(a.page, FOLDER);
        const dir = join(a.workspace, FOLDER);
        const notePath: string = await a.page.evaluate(
          ({ dir, text }) =>
            (window as unknown as { api: { createFile(d: string, n: string, c: string, e: string): Promise<string> } }).api.createFile(
              dir,
              'memo',
              text,
              '.md',
            ),
          { dir, text: NOTE_TEXT },
        );
        const code = await createSharedFolder(a.page);
        await expect(a.page.getByTestId('share-panel').getByTestId('share-status')).toHaveAttribute('data-status', 'connected', {
          timeout: 15_000,
        });

        // B: 코드로 참가 → 소유자가 시드한 노트가 B의 공유 폴더 안에 파일로 만들어진다
        await joinWithCode(b.page, code, GUEST);
        await expect(folderRow(b.page, FOLDER)).toBeVisible({ timeout: 15_000 });
        const bMemo = join(b.workspace, FOLDER, 'memo.md');
        await expect.poll(() => existsSync(bMemo), { timeout: 40_000, message: 'B에 소유자의 노트가 물질화됨' }).toBe(true);

        const bText = readFileSync(bMemo, 'utf-8');
        expect(bText).toContain(`id: "${NOTE_ID}"`);
        expect(bText).toContain('title: "회의 메모"');
        expect(count(bText, '첫 문단입니다')).toBe(1); // 중복 시드 없음
        expect(count(bText, '- 항목 하나')).toBe(1);
        expect(count(bText, '마지막 문단입니다')).toBe(1);
        // 소유자의 원본 파일은 시드 때 다시 쓰이지 않는다(로드 시점에 md를 파생하지 않는다)
        expect(readFileSync(notePath, 'utf-8')).toBe(NOTE_TEXT);
        // 사이드카(노트 id를 hex로 인코딩한 이름)가 양쪽에 남는다
        await expect
          .poll(() => existsSync(join(a.workspace, FOLDER, '.mindshare', NOTE_SIDECAR)) && existsSync(join(b.workspace, FOLDER, '.mindshare', NOTE_SIDECAR)), {
            timeout: 15_000,
          })
          .toBe(true);

        // A: 실행 중 공유 폴더 안에 새 노트를 만들면 B에도 나타난다(생성자가 시드)
        await a.page.keyboard.press('Escape'); // 공유 패널 닫기(한 단계 복귀)
        await expect(a.page.getByTestId('share-panel')).toHaveCount(0);
        await folderRow(a.page, FOLDER).click();
        await a.page.click('.sb-section-btn[title="새 노트"]');
        await expect
          .poll(() => readdirSync(join(b.workspace, FOLDER)).filter((n) => n.endsWith('.md')).length, {
            timeout: 40_000,
            message: 'A의 새 노트가 B에 전파됨',
          })
          .toBe(2);
        const bNew = readdirSync(join(b.workspace, FOLDER)).find((n) => n.endsWith('.md') && n !== 'memo.md')!;
        expect(readFileSync(join(b.workspace, FOLDER, bNew), 'utf-8')).toContain('title: "제목 없음"');
        // 새 노트의 id가 A 파일에 남아 있는 id와 같다(노트 id 불변)
        const aNew = readdirSync(join(a.workspace, FOLDER)).find((n) => n.endsWith('.md') && n !== 'memo.md')!;
        const idOf = (t: string) => t.match(/^id: "(.+)"$/m)?.[1];
        expect(idOf(readFileSync(join(b.workspace, FOLDER, bNew), 'utf-8'))).toBe(idOf(readFileSync(join(a.workspace, FOLDER, aNew), 'utf-8')));
      });
    } finally {
      await relay.close();
    }
  },
);
