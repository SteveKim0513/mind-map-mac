import { test, expect, type Page } from '@playwright/test';
import { launchApp } from './helpers';

// docs/product/specs/2026-07-16-calendar-ux-overhaul.md — 캘린더 UX 개선:
// 집중·완료 버튼 통일(§3.1), 클릭→미리보기→우측분할(§3.2), 통합 일정 생성
// (기존 노드 검색 + 오늘의 생각, §3.3–3.6), 월간 스크롤(§3.7).

/** Make a new map and add a scheduled node via natural-language typing. */
async function newScheduledNode(page: Page, phrase: string) {
  await page.click('.sb-section-btn[title="새 마인드맵"]');
  await page.waitForSelector('.canvas', { timeout: 5_000 });
  await page.click('.canvas');
  await page.keyboard.press('Enter');
  await page.waitForSelector('.editing-text', { timeout: 3_000 });
  await page.keyboard.type(phrase);
  await page.keyboard.press('Enter');
}

async function openCalendar(page: Page) {
  await page.click('.sb-nav-item:has-text("캘린더")');
  await page.waitForSelector('.cal', { timeout: 5_000 });
}

test('일간 집중·완료 버튼이 둘 다 아이콘+라벨 pill로 통일됐다 (§3.1)', async () => {
  const { page, cleanup } = await launchApp();
  try {
    await newScheduledNode(page, '@오늘 오후 3시 버튼통일노드');
    await openCalendar(page);
    const card = page.locator('.cal-daycard', { hasText: '버튼통일노드' });
    await expect(card).toBeVisible();
    await expect(card.locator('.cal-daycard-act--focus')).toContainText('집중');
    await expect(card.locator('.cal-daycard-act--done')).toContainText('완료');
  } finally {
    await cleanup();
  }
});

test('스케줄 클릭 → 서브트리 미리보기 서랍 → "오른쪽에 열기"로 우측 분할 (§3.2)', async () => {
  const { page, cleanup } = await launchApp();
  try {
    await newScheduledNode(page, '@오늘 오후 3시 미리보기노드');
    await openCalendar(page);

    const card = page.locator('.cal-daycard', { hasText: '미리보기노드' });
    await card.locator('.cal-daycard-hit').click();

    // 서랍 + 읽기전용 아웃라인 미리보기가 카드 아래 열린다.
    await expect(page.locator('.cal-peek-drawer')).toBeVisible();
    await expect(page.locator('.cal-peek-outline')).toBeVisible();

    // "오른쪽에 열기" → 우측 분할이 생긴다.
    await page.locator('.cal-peek-open').first().click();
    await expect(page.locator('.panes.split')).toBeVisible({ timeout: 3_000 });
  } finally {
    await cleanup();
  }
});

test('일간 "일정 추가"에서 종일↔시간 토글이 동작한다 (§3.6)', async () => {
  const { page, cleanup } = await launchApp();
  try {
    // 맵이 하나는 있어야 캘린더로 진입 가능(빈 워크스페이스면 홈).
    await newScheduledNode(page, '@오늘 오후 3시 시드노드');
    await openCalendar(page);

    await page.locator('.cal-add-btn').click();
    await page.waitForSelector('.cal-picker', { timeout: 3_000 });

    // 기본은 종일. 시간 필드는 숨김.
    await expect(page.locator('.cal-picker-seg')).toBeVisible();
    await expect(page.locator('.cal-picker-timefield')).toHaveCount(0);

    // "시간 지정" → HH:mm 필드가 나타난다.
    await page.locator('.cal-picker-seg-btn', { hasText: '시간 지정' }).click();
    await expect(page.locator('.cal-picker-timefield')).toBeVisible();
  } finally {
    await cleanup();
  }
});

test('"새로 만들기"는 오늘의 생각에 새 일정을 담는다 (§3.3)', async () => {
  const { page, cleanup } = await launchApp();
  try {
    await newScheduledNode(page, '@오늘 오후 3시 시드노드');
    await openCalendar(page);

    await page.locator('.cal-add-btn').click();
    await page.waitForSelector('.cal-picker', { timeout: 3_000 });
    await page.locator('.cal-picker-search').fill('인박스일정');
    await page.locator('.cal-picker-new').click();

    // 오늘의 생각.mind가 사이드바에 생기고, 새 일정이 일간 목록에 뜬다.
    await expect(page.locator('.cal-daycard', { hasText: '인박스일정' })).toBeVisible({ timeout: 4_000 });
  } finally {
    await cleanup();
  }
});

test('월간 셀은 3개를 넘겨도 "+N" 없이 전부 보여준다 (§3.7)', async () => {
  const { page, cleanup } = await launchApp();
  try {
    // 같은 날(오늘)에 4개의 일정 노드를 만든다(각각 다른 맵 — 캘린더가 전부 모은다).
    for (const n of ['월노드1', '월노드2', '월노드3', '월노드4']) {
      await newScheduledNode(page, `@오늘 오후 3시 ${n}`);
    }

    await openCalendar(page);
    await page.click('.cal-toggle-btn:has-text("월")');
    await page.waitForSelector('.cal-month-grid', { timeout: 3_000 });

    // "+N" 축약 버튼은 더 이상 없다.
    await expect(page.locator('.cal-month-more')).toHaveCount(0);
    // 오늘 셀에 4개의 칩이 모두 렌더된다(스크롤 컨테이너 안에).
    const todayCell = page.locator('.cal-month-cell.today');
    await expect(todayCell.locator('.cal-chip')).toHaveCount(4);
  } finally {
    await cleanup();
  }
});

// 진입점 일관화 (2026-07-16-calendar-schedule-add-consolidation.md)
test('"일정 추가" 버튼이 일/주/월 헤더에 모두 있고, 토글 만진 뒤 Escape로 피커가 닫힌다', async () => {
  const { page, cleanup } = await launchApp();
  try {
    await newScheduledNode(page, '@오늘 오후 3시 시드노드');
    await openCalendar(page);

    await expect(page.locator('.cal-add-btn')).toBeVisible(); // 일간
    await page.click('.cal-toggle-btn:has-text("주")');
    await page.waitForSelector('.cal-wk-grid', { timeout: 3_000 });
    await expect(page.locator('.cal-add-btn')).toBeVisible(); // 주간
    await page.click('.cal-toggle-btn:has-text("월")');
    await page.waitForSelector('.cal-month-grid', { timeout: 3_000 });
    await expect(page.locator('.cal-add-btn')).toBeVisible(); // 월간

    // 피커 열고 토글 클릭(포커스가 검색 입력 밖) → Escape로 닫힌다 (F4)
    await page.locator('.cal-add-btn').click();
    await page.waitForSelector('.cal-picker', { timeout: 3_000 });
    await page.locator('.cal-picker-seg-btn', { hasText: '시간 지정' }).click();
    await page.keyboard.press('Escape');
    await expect(page.locator('.cal-picker')).toHaveCount(0);
  } finally {
    await cleanup();
  }
});

test('주간 빈 슬롯으로 열면 피커에 토글이 보이고 "시간 지정"으로 프리필된다', async () => {
  const { page, cleanup } = await launchApp();
  try {
    await newScheduledNode(page, '@오늘 오후 3시 시드노드');
    await openCalendar(page);
    await page.click('.cal-toggle-btn:has-text("주")');
    await page.waitForSelector('.cal-wk-grid', { timeout: 3_000 });

    await page.locator('.cal-wk-col.today').click({ position: { x: 20, y: 180 } });
    await page.waitForSelector('.cal-picker', { timeout: 3_000 });
    await expect(page.locator('.cal-picker-seg')).toBeVisible(); // 토글 항상 노출
    await expect(page.locator('.cal-picker-seg-btn.on')).toContainText('시간 지정'); // 슬롯 시각 프리필
    await expect(page.locator('.cal-picker-timefield')).toBeVisible();
  } finally {
    await cleanup();
  }
});

test('시간이 겹치는 일정은 주간 그리드에서 나란히 열 분할되고 hover로 확대된다', async () => {
  const { page, cleanup } = await launchApp();
  try {
    // 같은 시각(오후 3시) 3개 → 3-way 겹침
    for (const n of ['겹침알파', '겹침베타', '겹침감마']) {
      await newScheduledNode(page, `@오늘 오후 3시 ${n}`);
    }
    await openCalendar(page);
    await page.click('.cal-toggle-btn:has-text("주")');
    await page.waitForSelector('.cal-wk-grid', { timeout: 3_000 });

    // 3개가 겹침 열 분할(.overlap)로 나란히 렌더된다
    await expect(page.locator('.cal-wk-block.overlap')).toHaveCount(3);

    // hover하면 그 블록이 전체 폭으로 확대되어 읽힌다(다른 블록보다 넓어짐)
    const blocks = page.locator('.cal-wk-block.overlap');
    const narrow = await blocks.nth(0).evaluate((el) => el.getBoundingClientRect().width);
    await blocks.nth(0).hover();
    await page.waitForTimeout(150);
    const wide = await blocks.nth(0).evaluate((el) => el.getBoundingClientRect().width);
    expect(wide).toBeGreaterThan(narrow);
  } finally {
    await cleanup();
  }
});
