import { test, expect, type Page } from '@playwright/test';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { launchApp } from './helpers';

// AGENTS.md 최상위 불변조건 + ADR 0016 (docs/decisions/0016-…):
// 복사/붙여넣기(⌘C/⌘V)와 복제(우클릭 "복제")는 리마인더 4개 필드
// (reminderOn/reminderId/reminderSyncedAt/reminderBase)를 모두 제거하고, 실행 상태
// (todo)와 타임블록 길이(durationMin)는 유지한다. 새 노드는 고유 id를 받는다.
//
// 주의: reminderOn/reminderId는 실제 macOS Reminders 동기화 없이는 세팅되지 않으므로
// (E2E엔 Reminders 권한이 없다) 여기선 "부재"를 검증한다. reminderOn을 실제로 켠
// 노드에서 복제가 4필드를 실제로 벗겨내는지는 store 단위 테스트
// (src/store/mapStore.qafixes.test.ts · "A1 · duplicate strips all reminder fields")가
// 커버한다. 이 스펙의 회귀 가치는 UI→디스크 전 구간에서 붙여넣기/복제가
// todo·durationMin은 살리고 리마인더 필드는 절대 만들지 않는다는 것.

interface DiskNode {
  id: string;
  text: string;
  todo?: boolean;
  durationMin?: number;
  scheduleAt?: string;
  reminderOn?: boolean;
  reminderId?: string;
  reminderSyncedAt?: number;
  reminderBase?: unknown;
}

function readMapNodes(workspace: string): DiskNode[] {
  const name = readdirSync(workspace).find((f) => f.endsWith('.mind'));
  if (!name) throw new Error('no .mind file written to workspace');
  const doc = JSON.parse(readFileSync(join(workspace, name), 'utf-8')) as {
    nodes: Record<string, DiskNode>;
  };
  return Object.values(doc.nodes);
}

async function newMapWithNode(page: Page, text: string) {
  await page.click('.sb-section-btn[title="새 마인드맵"]');
  await page.waitForSelector('.canvas', { timeout: 5_000 });
  await page.click('.canvas');
  await page.keyboard.press('Enter');
  await page.waitForSelector('.editing-text', { timeout: 3_000 });
  await page.keyboard.type(text);
  await page.keyboard.press('Enter');
}

test('붙여넣기·복제 노드는 리마인더 4필드를 갖지 않고 todo·durationMin·일정은 유지한다', { tag: ['@map', '@schedule'] }, async () => {
  const { page, workspace, cleanup } = await launchApp();
  try {
    // ── 일정(=자동 할 일) 노드 생성 ──────────────────────────────────────────
    await newMapWithNode(page, '@내일 오후 3시 회의준비');
    const nodes = page.locator('.node', { hasText: '회의준비' });
    await expect(nodes).toHaveCount(1);
    await expect(nodes.first()).toHaveClass(/todo/);
    await expect(nodes.first()).toHaveClass(/scheduled/);

    // ── 소요 시간(durationMin=60) 지정 — 시각이 있으니 컨트롤이 노출된다 ──────
    await nodes.first().locator('.gchip.sched').click();
    await page.waitForSelector('.sched-pop', { timeout: 3_000 });
    const oneHour = page.locator('.sched-dur .sched-chip', { hasText: '1시간' });
    await oneHour.click();
    await expect(oneHour).toHaveClass(/\bon\b/);

    // 팝오버를 닫는다(노드 위를 덮고 있어 직접 클릭이 막히므로 전용 닫기 버튼 사용).
    await page.click('.sched-pop .sched-x');
    await page.waitForSelector('.sched-pop', { state: 'hidden', timeout: 3_000 });

    // ── 복제(우클릭 "복제") → 형제 클론 1개 (우클릭이 노드를 선택한다) ────────
    await nodes.first().click({ button: 'right' });
    await page.waitForSelector('.ctx-menu', { timeout: 3_000 });
    await page.click('.ctx-item:has-text("복제")');
    await expect(nodes).toHaveCount(2);

    // ── 복사→붙여넣기 → 자식 클론 1개 (복제된 클론이 선택된 상태에서) ────────
    // duplicateNode가 클론을 선택 상태로 두므로 그 리프 노드를 복사한다.
    await page.keyboard.press('Meta+c');
    await page.keyboard.press('Meta+v');
    await expect(nodes).toHaveCount(3);

    // ── 디스크(.mind) 검증 ───────────────────────────────────────────────────
    await page.waitForTimeout(1_200); // autosave(1s) + 여유
    const diskNodes = readMapNodes(workspace).filter((n) => n.text.includes('회의준비'));
    expect(diskNodes.length).toBe(3);

    // 모두 고유 id
    const ids = new Set(diskNodes.map((n) => n.id));
    expect(ids.size).toBe(3);

    for (const n of diskNodes) {
      // 유지되어야 하는 것
      expect(n.todo).toBe(true);
      expect(n.durationMin).toBe(60);
      expect(typeof n.scheduleAt).toBe('string');
      expect(n.scheduleAt).toBeTruthy();
      // 절대 존재하면 안 되는 리마인더 4필드
      expect(n.reminderOn ?? undefined).toBeUndefined();
      expect(n.reminderId ?? undefined).toBeUndefined();
      expect(n.reminderSyncedAt ?? undefined).toBeUndefined();
      expect(n.reminderBase ?? undefined).toBeUndefined();
    }
  } finally {
    await cleanup();
  }
});
