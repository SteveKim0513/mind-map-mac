#!/usr/bin/env node
/**
 * smoke.mjs — 핵심 화면 스크린샷 자동화
 *
 * 빌드된 앱을 격리 환경으로 실행하고 5개 핵심 화면을 스크린샷해
 * /tmp/smoke/ 에 저장한다. 눈으로 보고 확인하는 용도 (pass/fail 없음).
 *
 * 사전 조건: npm run build (dist-electron/main.js 필요)
 * 사용법: node scripts/smoke.mjs
 * 환경변수: SMOKE_DIR=/tmp/smoke (기본값)
 */
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { _electron: electron } = require('playwright-core');

const __dirname = dirname(fileURLToPath(import.meta.url));
const APP_DIR = join(__dirname, '..');
const MAIN_JS = join(APP_DIR, 'dist-electron/main.js');
const ELECTRON_BIN = join(APP_DIR, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron');
const SHOT_DIR = process.env.SMOKE_DIR || '/tmp/smoke';

// ── 사전 검사 ──────────────────────────────────────────────────────────────
if (!existsSync(MAIN_JS)) {
  console.error('✗ dist-electron/main.js 없음 — 먼저 npm run build 실행');
  process.exit(1);
}
if (!existsSync(ELECTRON_BIN)) {
  console.error('✗ Electron 바이너리 없음:', ELECTRON_BIN);
  process.exit(1);
}

mkdirSync(SHOT_DIR, { recursive: true });

// ── 격리 환경 생성 ──────────────────────────────────────────────────────────
const userData = mkdtempSync(join(tmpdir(), 'mindmap-smoke-ud-'));
const workspace = mkdtempSync(join(tmpdir(), 'mindmap-smoke-ws-'));
writeFileSync(join(userData, 'settings.json'), JSON.stringify({ workspace }));

function shot(name) {
  return join(SHOT_DIR, name);
}

async function wait(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

let app, page;

try {
  // ── 앱 실행 ──────────────────────────────────────────────────────────────
  console.log('▶ 앱 실행 중…');
  app = await electron.launch({
    executablePath: ELECTRON_BIN,
    args: [MAIN_JS],
    env: { ...process.env, MINDMAP_USER_DATA: userData, MINDMAP_WORKSPACE: workspace },
  });
  page = await app.firstWindow();
  await page.waitForSelector('.sidebar', { timeout: 15_000 });
  console.log('✓ 앱 로드 완료\n');

  // ── 01 — 초기 화면 ────────────────────────────────────────────────────────
  await page.screenshot({ path: shot('01-initial.png') });
  console.log('📸 01-initial.png');

  // ── 02 — 새 맵 생성 ────────────────────────────────────────────────────────
  await page.keyboard.press('Meta+n');
  // 사이드바 파일 항목이 생기거나 캔버스가 렌더되는 것을 기다림
  await page.waitForFunction(
    () => document.querySelector('.mindmap-canvas, .canvas-root, [data-testid="canvas"]') !== null
      || document.querySelectorAll('.label').length > 0,
    { timeout: 10_000 },
  ).catch(() => {}); // 없어도 스크린샷은 찍음
  await wait(500);
  await page.screenshot({ path: shot('02-new-map.png') });
  console.log('📸 02-new-map.png');

  // ── 03 — 설정 모달 ────────────────────────────────────────────────────────
  await page.keyboard.press('Meta+Comma');
  await page.waitForSelector('.settings', { timeout: 5_000 });
  await wait(200);
  await page.screenshot({ path: shot('03-settings.png') });
  console.log('📸 03-settings.png');

  // ── 04 — 설정: AI 섹션 (스크롤해서 보임 여부 확인) ─────────────────────────
  const aiSection = await page.$('.set-ai-section');
  if (aiSection) await aiSection.scrollIntoViewIfNeeded();
  await wait(150);
  await page.screenshot({ path: shot('04-settings-ai.png') });
  console.log('📸 04-settings-ai.png');

  // ── 05 — 설정 닫기 후 상태 ───────────────────────────────────────────────
  await page.keyboard.press('Escape');
  await wait(300);
  await page.screenshot({ path: shot('05-after-settings.png') });
  console.log('📸 05-after-settings.png');

  console.log(`\n✓ 완료 — ${SHOT_DIR}/`);
  console.log('  open ' + SHOT_DIR + '  # Finder에서 확인');
} catch (err) {
  console.error('\n✗ 오류:', err.message);
  if (page) await page.screenshot({ path: shot('error.png') }).catch(() => {});
  process.exitCode = 1;
} finally {
  await app?.close().catch(() => {});
  rmSync(userData, { recursive: true, force: true });
  rmSync(workspace, { recursive: true, force: true });
}
