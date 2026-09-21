import { existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { test, type Page } from '@playwright/test';
import { launchApp, type AppHandle } from './helpers';

const __dirname = dirname(fileURLToPath(import.meta.url));
const RELAY_ENTRY = join(__dirname, '../server/dist/relay.js');

export interface TestRelay {
  /** REST base — `MINDMAP_RELAY_URL`로 앱에 넘긴다. */
  url: string;
  wsUrl: string;
  stats(): { documents: number; connections: number };
  close(): Promise<void>;
}

/** 실행 중인 테스트 릴레이(url → 릴레이). `withApps`가 실패 진단에 relay.stats()를 첨부하려고 URL로 찾는다. */
const activeRelays = new Map<string, TestRelay>();

/**
 * 테스트 하나가 쓰는 자체 릴레이(메모리 DB, 임의 포트) — 병렬 안전(공유 상태·고정 포트 없음).
 * `server/dist`는 scripts/e2e-run.mjs가 시작 시 빌드해 둔다(`playwright test`를 직접 돌릴 때는 먼저
 * `npm --prefix server run build`).
 */
export async function startTestRelay(opts: { inviteTtlMs?: number } = {}): Promise<TestRelay> {
  if (!existsSync(RELAY_ENTRY)) {
    throw new Error(
      'server/dist/relay.js 가 없습니다 — `npm --prefix server run build` 를 먼저 실행하세요 (scripts/e2e-run.mjs · make verify-feature 는 자동으로 빌드합니다).',
    );
  }
  const mod = (await import(pathToFileURL(RELAY_ENTRY).href)) as {
    startRelay(o: { port: number; silent: boolean; inviteTtlMs?: number }): Promise<TestRelay>;
  };
  const relay = await mod.startRelay({ port: 0, silent: true, ...opts });
  activeRelays.set(relay.url, relay);
  const close = relay.close.bind(relay);
  relay.close = async () => {
    activeRelays.delete(relay.url);
    await close();
  };
  return relay;
}

const MAX_CONSOLE_LINES = 500;

function watchConsole(page: Page, sink: string[]): void {
  const push = (line: string) => {
    sink.push(line);
    if (sink.length > MAX_CONSOLE_LINES) sink.shift();
  };
  page.on('console', (msg) => push(`[${msg.type()}] ${msg.text()}`));
  page.on('pageerror', (error) => push(`[pageerror] ${error.message}`));
}

/** 실패 시 원인 분석 자료를 리포트에 첨부한다: 앱별 스크린샷(모든 창)·콘솔 로그, 릴레이 통계. 자료 수집 실패는 삼킨다. */
async function attachDiagnostics(
  apps: AppHandle[],
  consoles: string[][],
  env: Record<string, string> | undefined,
  error: unknown,
): Promise<void> {
  let info: ReturnType<typeof test.info>;
  try {
    info = test.info();
  } catch {
    return; // 테스트 밖에서 호출됨
  }
  const attach = (name: string, body: string | Buffer, contentType: string) =>
    info.attach(name, { body, contentType }).catch(() => undefined);

  await attach('failure.txt', error instanceof Error ? (error.stack ?? error.message) : String(error), 'text/plain');
  for (const [i, app] of apps.entries()) {
    let windows: Page[] = [];
    try {
      windows = app.app.windows();
    } catch {
      windows = [app.page];
    }
    for (const [w, page] of windows.entries()) {
      try {
        await attach(`app${i}-window${w}.png`, await page.screenshot(), 'image/png');
      } catch {
        // 창이 이미 닫힘 — 스크린샷 없이 진행
      }
    }
    await attach(`app${i}-console.log`, (consoles[i] ?? []).join('\n') || '(no console output captured)', 'text/plain');
  }
  const relay = env?.MINDMAP_RELAY_URL ? activeRelays.get(env.MINDMAP_RELAY_URL) : undefined;
  if (relay) await attach('relay-stats.json', JSON.stringify(relay.stats(), null, 2), 'application/json');
}

/**
 * 여러 Electron 인스턴스를 띄워 `run`에 넘기고, 어떤 경우에도 전부 정리한다.
 * `run`이 실패하면 리포트에 앱별 스크린샷·콘솔 로그·릴레이 통계를 첨부한 뒤 같은 오류를 다시 던진다(시나리오 동작은 불변).
 * `env.MINDMAP_RELAY_URL`이 `startTestRelay()`가 만든 릴레이를 가리키면 그 릴레이의 통계도 첨부된다.
 */
export async function withApps<T>(
  count: number,
  env: Record<string, string> | undefined,
  run: (apps: AppHandle[]) => Promise<T>,
): Promise<T> {
  const apps: AppHandle[] = [];
  const consoles: string[][] = [];
  try {
    for (let i = 0; i < count; i++) {
      const app = await launchApp({ env });
      const sink: string[] = [];
      consoles.push(sink);
      watchConsole(app.page, sink);
      apps.push(app);
    }
    return await run(apps);
  } catch (error) {
    await attachDiagnostics(apps, consoles, env, error);
    throw error;
  } finally {
    for (const app of apps.reverse()) await app.cleanup();
  }
}

/**
 * 시스템 클립보드를 건드리지 않고 "복사" 동작을 검증한다(전역 클립보드 의존 금지 — testing.md).
 * `navigator.clipboard.writeText`와 `document.execCommand('copy')`를 페이지 안에서 대체해 복사 요청 값을 모아 둔다.
 * 반환 함수로 지금까지 복사 요청된 문자열 목록을 읽는다.
 */
export async function stubClipboard(page: Page): Promise<() => Promise<string[]>> {
  await page.evaluate(() => {
    const w = window as unknown as { __copied?: string[] };
    w.__copied = [];
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: async (text: string) => {
          w.__copied?.push(String(text));
        },
      },
    });
    document.execCommand = (command: string) => {
      if (command !== 'copy') return false;
      const active = document.activeElement as HTMLTextAreaElement | HTMLInputElement | null;
      w.__copied?.push(active && 'value' in active ? active.value : String(document.getSelection() ?? ''));
      return true;
    };
  });
  return () => page.evaluate(() => (window as unknown as { __copied?: string[] }).__copied ?? []);
}

/**
 * 시각 확인용 스크린샷 — `SHARE_E2E_SHOTS=<dir>` 를 주면 그 폴더에 저장한다(기본은 저장 안 함).
 * 라이트·다크 둘 다 찍는다.
 */
/** 진행 중인 CSS 애니메이션·전환이 끝나길 기다린다(스크린샷이 전환 도중 색을 찍지 않게). */
async function settle(page: Page): Promise<void> {
  await page.evaluate(async () => {
    await Promise.all(document.getAnimations().map((a) => a.finished.catch(() => undefined)));
    await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));
  });
}

export async function shootBothThemes(page: Page, name: string): Promise<void> {
  const dir = process.env.SHARE_E2E_SHOTS;
  if (!dir) return;
  mkdirSync(dir, { recursive: true });
  await settle(page);
  // 원래 data-theme 속성이 없었다면(null) 끝에서 속성을 제거해 원상 복구한다 — 'light'를 남기지 않는다.
  const original = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
  for (const theme of ['light', 'dark']) {
    await page.evaluate((t) => {
      document.documentElement.dataset.theme = t;
    }, theme);
    await settle(page);
    await page.screenshot({ path: join(dir, `${name}-${theme}.png`) });
  }
  await page.evaluate((t) => {
    if (t === null) document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', t);
  }, original);
}
