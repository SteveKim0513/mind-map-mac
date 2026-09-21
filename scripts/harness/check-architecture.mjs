#!/usr/bin/env node
/**
 * 아키텍처 구조 검사 — 금지된 의존성 방향 탐지
 * make harness-check 또는 node scripts/harness/check-architecture.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '../..');
const SRC = path.join(ROOT, 'src');

let failures = 0;

function fail(msg) {
  console.error(`  ✗ ${msg}`);
  failures++;
}

function warn(msg) {
  console.warn(`  ⚠ ${msg}`);
}

// src/ 파일 재귀 수집
function collectFiles(dir, ext = ['.ts', '.tsx']) {
  const results = [];
  if (!fs.existsSync(dir)) return results;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory() && entry.name !== 'node_modules') {
      results.push(...collectFiles(full, ext));
    } else if (entry.isFile() && ext.some(e => entry.name.endsWith(e))) {
      results.push(full);
    }
  }
  return results;
}

// import 구문 추출
function extractImports(content) {
  const re = /(?:import|from)\s+['"]([^'"]+)['"]/g;
  const imports = [];
  let m;
  while ((m = re.exec(content)) !== null) {
    imports.push(m[1]);
  }
  return imports;
}

// 모듈 영역 판별
function getModule(filePath) {
  const rel = path.relative(SRC, filePath);
  const parts = rel.split('/');
  return parts[0].replace(/\.(ts|tsx)$/, '');
}

// ── 규칙 1: src/ → electron/ 런타임 import 금지 (type-only는 허용) ──
// 설계 의도: electron/preload.ts에서 'import type'으로 타입만 가져오는 것은 허용.
// window.api 브리지를 통해 타입 안전성을 확보하는 공식 패턴이다.
// 금지: 'import { ... } from ..electron/' (런타임 값 import)
console.log('\n[1] src/ → electron/ 런타임 import 검사 (type-only 허용)');
const srcFiles = collectFiles(SRC);
for (const file of srcFiles) {
  const content = fs.readFileSync(file, 'utf8');
  // import type { ... } from '...' 는 제외 (타입 전용)
  const runtimeImports = content
    .split('\n')
    .filter(line => !line.trim().startsWith('import type') && !line.trim().startsWith('// '))
    .join('\n');
  const imports = extractImports(runtimeImports);
  for (const imp of imports) {
    if (imp.includes('/electron/') || imp.startsWith('../electron/') || imp.startsWith('../../electron/')) {
      fail(`${path.relative(ROOT, file)}: electron/ 런타임 import 금지. window.api 사용 또는 'import type' 전환.`);
    }
  }
}
if (failures === 0) console.log('  ✓ 위반 없음');

// ── 규칙 2: store/ → ui/canvas/note/focus/sidebar/panes 등 import 금지 ──
console.log('\n[2] store/ → 렌더러 모듈 import 검사');
const storeDir = path.join(SRC, 'store');
const storeFiles = collectFiles(storeDir);
// 순수 렌더링 모듈 — store에서 절대 참조하면 안 됨 (하드 실패)
const UI_MODULES = ['canvas', 'ui', 'sidebar', 'panes', 'inspector', 'menu', 'board', 'calendar', 'share'];
let storeViolations = 0;
for (const file of storeFiles) {
  const content = fs.readFileSync(file, 'utf8');
  const imports = extractImports(content);
  for (const imp of imports) {
    for (const mod of UI_MODULES) {
      if (imp.includes(`../${mod}/`) || imp.includes(`/${mod}/`)) {
        fail(`${path.relative(ROOT, file)}: store/는 ${mod}/ 을 import할 수 없습니다. ARCHITECTURE.md 참조.`);
        storeViolations++;
      }
    }
  }
}
if (storeViolations === 0) console.log('  ✓ 위반 없음');

// ── 규칙 3: store/ → 도메인 모듈 import 탐지 (workspaceStore → note/ 등) ──
// layout/은 순수 계산 유틸리티이므로 어디서든 참조 허용.
// focus/는 canvas·note가 스케줄 표시를 위해 참조 (설계 의도).
// 진짜 문제: store/ 계층이 도메인 모듈의 비-타입 로직을 import하는 경우.
console.log('\n[3] store/ → 도메인 모듈 비-타입 import 검사');
const DOMAIN_MODULES = ['canvas', 'note', 'focus', 'sync', 'search', 'board', 'calendar', 'share'];
let domainViolations = 0;
for (const mod of DOMAIN_MODULES) {
  // store/가 특정 도메인 모듈의 런타임 값을 import하는지 검사
  const storeDir2 = path.join(SRC, 'store');
  if (!fs.existsSync(storeDir2)) continue;
  const storeFiles2 = collectFiles(storeDir2);
  for (const file of storeFiles2) {
    const content = fs.readFileSync(file, 'utf8');
    // type-only import 제외
    const runtimeLines = content
      .split('\n')
      .filter(line => !line.trim().startsWith('import type'))
      .join('\n');
    const imports = extractImports(runtimeLines);
    for (const imp of imports) {
      if (imp.includes(`../${mod}/`) || imp.includes(`/${mod}/`)) {
        warn(`${path.relative(ROOT, file)}: store/ → ${mod}/ 런타임 import (기술부채 — tech-debt-tracker.md 참조)`);
        domainViolations++;
      }
    }
  }
}
if (domainViolations === 0) console.log('  ✓ 위반 없음');

// ── 규칙 4: 필수 파일 존재 확인 ──
console.log('\n[4] 필수 하네스 파일 존재 확인');
const REQUIRED_FILES = [
  'CLAUDE.md',
  'AGENTS.md',
  'ARCHITECTURE.md',
  'Makefile',
  '.claude/settings.json',
  '.claude/rules/architecture.md',
  '.claude/rules/testing.md',
  '.claude/rules/security.md',
  '.claude/rules/electron.md',
  '.claude/rules/frontend.md',
  '.claude/skills/verify/SKILL.md',
  '.claude/skills/fix-bug/SKILL.md',
  '.claude/skills/compact-prep/SKILL.md',
  '.claude/skills/explore/SKILL.md',
  '.claude/agents/codebase-explorer.md',
  '.claude/agents/implementation-worker.md',
  '.claude/rules/context-management.md',
  '.claude/hooks/block-destructive-command.sh',
  '.claude/hooks/protect-sensitive-files.sh',
  '.claude/hooks/save-context.sh',
  '.claude/hooks/restore-context.sh',
  'docs/exec-plans/tech-debt-tracker.md',
  'docs/operations/local-development.md',
  'docs/operations/testing.md',
];
for (const f of REQUIRED_FILES) {
  const full = path.join(ROOT, f);
  if (!fs.existsSync(full)) {
    fail(`필수 파일 없음: ${f}`);
  }
}
if (failures === 0) console.log('  ✓ 모든 필수 파일 존재');

// ── 규칙 5: CLAUDE.md 길이 확인 ──
console.log('\n[5] CLAUDE.md 길이 검사 (200줄 미만 권장)');
const claudeMd = path.join(ROOT, 'CLAUDE.md');
if (fs.existsSync(claudeMd)) {
  const lines = fs.readFileSync(claudeMd, 'utf8').split('\n').length;
  if (lines > 200) {
    warn(`CLAUDE.md가 ${lines}줄입니다. 200줄 미만을 권장합니다. 상세 내용은 rules/ 또는 skills/로 이동하세요.`);
  } else {
    console.log(`  ✓ CLAUDE.md: ${lines}줄`);
  }
}

// ════════════════════════════════════════════════════════════════════════════
// 규칙 6–10: 도메인 경계 기계 검사 (정적·동적 import, 상대경로를 실제 경로로 해석)
//
// 공통 원칙
//  - 대상은 src/**·electron/** 의 비-테스트 파일. 테스트(*.test.ts(x))는 통합 테스트가 여러 모듈을 조립하므로 제외한다.
//  - 'import type'(및 모든 specifier가 inline type인 import)은 "type-only"로 분류한다. 규칙별로 허용 여부가 다르다.
//  - `import('x').Foo`(타입 위치의 import 타입)와 `typeof import('x')`는 type-only다. `await import('x')`·`import('x').then`은 런타임이다.
//  - 위반 문구는 .claude/rules/architecture.md 형식을 따른다.
//  - KNOWN_EXCEPTIONS는 "지금 존재하는 기존 위반"이다. 규칙을 느슨하게 만들지 않고 정확히 그 (파일 → 대상)만 허용하며,
//    더 이상 필요 없으면(=해소되면) 경고로 알려 목록에서 지우게 한다. 새 예외 추가는 tech-debt-tracker.md 기록과 함께.
// ════════════════════════════════════════════════════════════════════════════

function stripComments(content) {
  return content
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');
}

/** @returns {{spec: string, type: boolean}[]} */
function parseImports(content) {
  const code = stripComments(content);
  const found = [];
  let m;

  // import|export [type] <specifiers> from '...'  (여러 줄 가능)
  const fromRe = /\b(?:import|export)\s+(type\s+)?([^'";]*?)\s*from\s*['"]([^'"]+)['"]/g;
  while ((m = fromRe.exec(code)) !== null) {
    let type = Boolean(m[1]);
    const specifiers = m[2].trim();
    if (!type && /^\{[\s\S]*\}$/.test(specifiers)) {
      const items = specifiers.slice(1, -1).split(',').map(x => x.trim()).filter(Boolean);
      if (items.length > 0 && items.every(x => /^type\s/.test(x))) type = true;
    }
    found.push({ spec: m[3], type });
  }

  // import '...'  (side-effect)
  const bareRe = /\bimport\s*['"]([^'"]+)['"]/g;
  while ((m = bareRe.exec(code)) !== null) found.push({ spec: m[1], type: false });

  // import('...')  (동적 / 타입 위치)
  const dynRe = /(typeof\s+)?\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)(\s*\.\s*(\w+))?/g;
  while ((m = dynRe.exec(code)) !== null) {
    const member = m[4];
    const type = Boolean(m[1]) || (member !== undefined && !['then', 'catch', 'finally'].includes(member));
    found.push({ spec: m[2], type });
  }
  return found;
}

/** 파일 경로 → 영역 이름. src/<dir>/... → 'src/<dir>', src/App.tsx → 'src/App', electron/... → 'electron', 그 외 null */
function areaOf(absPath) {
  const electronDir = path.join(ROOT, 'electron');
  if (absPath.startsWith(SRC + path.sep)) {
    return 'src/' + path.relative(SRC, absPath).split(path.sep)[0].replace(/\.(ts|tsx)$/, '');
  }
  if (absPath.startsWith(electronDir + path.sep)) return 'electron';
  return null;
}

const isTestFile = (file) => /\.test\.tsx?$/.test(file);

/** src/·electron/ 비-테스트 파일의 상대경로 import를 해석해 순회한다. */
const boundaryEdges = [];
for (const dir of [SRC, path.join(ROOT, 'electron')]) {
  for (const file of collectFiles(dir)) {
    if (isTestFile(file)) continue;
    const fromArea = areaOf(file);
    for (const imp of parseImports(fs.readFileSync(file, 'utf8'))) {
      if (!imp.spec.startsWith('.')) continue; // 외부 패키지는 대상 아님
      const target = path.resolve(path.dirname(file), imp.spec);
      const toArea = areaOf(target);
      if (!toArea || toArea === fromArea) continue;
      boundaryEdges.push({
        file: path.relative(ROOT, file),
        from: fromArea,
        to: toArea,
        target: path.relative(ROOT, target),
        type: imp.type,
        spec: imp.spec,
      });
    }
  }
}

const usedExceptions = new Set();
/** KNOWN_EXCEPTIONS 항목: { file, targetPrefix } — 해당 파일이 해당 대상(경로 접두사)을 import하는 것만 허용 */
function isKnownException(list, edge) {
  const idx = list.findIndex(e => e.file === edge.file && edge.target.startsWith(e.targetPrefix));
  if (idx < 0) return false;
  usedExceptions.add(list[idx]);
  return true;
}
function reportStaleExceptions(list, label) {
  for (const e of list) {
    if (!usedExceptions.has(e)) {
      warn(`${label} 허용 목록 항목이 더 이상 필요 없습니다 (${e.file} → ${e.targetPrefix}) — scripts/harness/check-architecture.mjs에서 제거하세요.`);
    }
  }
}
const boundaryErr = (file, a, b, hint = 'store/ 또는 App.tsx를 통해 연결하세요.') =>
  `${file}: Error: [${a}]은 [${b}]를 직접 참조할 수 없습니다. ${hint} ARCHITECTURE.md#경계-규칙 참조.`;

// ── 규칙 6: share/ → 다른 도메인·UI 모듈 import 금지 ──
// share/는 store/·io/·types만 쓴다. electron은 'import type'(preload의 Api 타입)만 허용.
console.log('\n[6] share/ → 도메인·UI 모듈 import 검사');
const SHARE_FORBIDDEN_TARGETS = [
  'note', 'canvas', 'board', 'focus', 'sync', 'calendar', 'panes', 'menu', 'ui', 'sidebar', 'interactions',
  'search', 'inspector', 'App', 'main',
].map(m => `src/${m}`);
let shareViolations = 0;
for (const e of boundaryEdges) {
  if (e.from !== 'src/share') continue;
  if (SHARE_FORBIDDEN_TARGETS.includes(e.to)) {
    fail(boundaryErr(e.file, 'share', e.to.replace('src/', '') + '/'));
    shareViolations++;
  } else if (e.to === 'electron' && !e.type) {
    fail(`${e.file}: Error: [share]은 electron/을 런타임 import할 수 없습니다. 'import type ... from ../../electron/preload'만 허용됩니다. ARCHITECTURE.md#경계-규칙 참조.`);
    shareViolations++;
  }
}
if (shareViolations === 0) console.log('  ✓ 위반 없음');

// ── 규칙 7: 도메인·하위 계층 → share/ import 금지 ──
// share/를 참조해도 되는 곳: App.tsx(조립), ui/(공유 다이얼로그·패널), sidebar/(공유 폴더 표시). 그 외는 store/를 통한다.
console.log('\n[7] note·canvas·board·panes·menu 등 → share/ 직접 import 검사 (App·ui·sidebar 예외)');
const SHARE_FORBIDDEN_IMPORTERS = [
  'note', 'canvas', 'board', 'panes', 'menu', 'focus', 'sync', 'calendar', 'search', 'inspector',
  'store', 'io', 'layout', 'theme',
].map(m => `src/${m}`);
let shareImporterViolations = 0;
for (const e of boundaryEdges) {
  if (e.to !== 'src/share') continue;
  if (SHARE_FORBIDDEN_IMPORTERS.includes(e.from)) {
    fail(boundaryErr(e.file, e.from.replace('src/', '') + '/', 'share/'));
    shareImporterViolations++;
  }
}
if (shareImporterViolations === 0) console.log('  ✓ 위반 없음');

// ── 규칙 8: io/ → store/·도메인 모듈 import 금지 ──
// io/는 types·theme(팔레트 키)·shared·lib만 쓰는 순수 변환 계층이다 (types → io/theme → store).
console.log('\n[8] io/ → store·도메인 모듈 import 검사');
const IO_ALLOWED_TARGETS = ['src/types', 'src/theme', 'src/shared', 'src/lib'];
let ioViolations = 0;
for (const e of boundaryEdges) {
  if (e.from !== 'src/io') continue;
  if (e.to === 'electron' && e.type) continue;
  if (!IO_ALLOWED_TARGETS.includes(e.to)) {
    fail(boundaryErr(e.file, 'io', e.to.replace('src/', '') + '/', 'io/는 순수 변환 계층이라 상위 계층에 의존할 수 없습니다.'));
    ioViolations++;
  }
}
if (ioViolations === 0) console.log('  ✓ 위반 없음');

// ── 규칙 9: store/ → share·canvas·board·note import 금지 (기존 예외만 허용) ──
// (ui·sidebar·panes·menu 등은 규칙 2가 이미 막는다.)
console.log('\n[9] store/ → share·canvas·board·note import 검사');
const STORE_FORBIDDEN_TARGETS = ['src/share', 'src/canvas', 'src/board', 'src/note'];
const STORE_KNOWN_EXCEPTIONS = [
  // workspaceStore가 위키링크 대상 추출 순수 함수(wikiLinkText)를 쓴다. 기존 기술부채 — 순수 함수를 io/로 옮기면 해소.
  // (mapStore → layout/tidyOverlaps는 layout/이 순수 계산 유틸이라 애초에 금지 대상이 아니므로 예외가 필요 없다.)
  { file: 'src/store/workspaceStore.ts', targetPrefix: 'src/note/wikiLinkText' },
];
let storeBoundaryViolations = 0;
for (const e of boundaryEdges) {
  if (e.from !== 'src/store' || !STORE_FORBIDDEN_TARGETS.includes(e.to)) continue;
  if (isKnownException(STORE_KNOWN_EXCEPTIONS, e)) continue;
  fail(boundaryErr(e.file, 'store', e.to.replace('src/', '') + '/', 'store/는 렌더러·도메인 모듈에 의존할 수 없습니다.'));
  storeBoundaryViolations++;
}
reportStaleExceptions(STORE_KNOWN_EXCEPTIONS, 'store/');
if (storeBoundaryViolations === 0) console.log('  ✓ 위반 없음 (허용된 기존 예외: workspaceStore → note/wikiLinkText)');

// ── 규칙 10: electron/ → src/ 런타임 import는 io/·shared/만 ──
// electron/(main·preload)는 렌더러 코드에 의존하지 않는다. 포맷 파싱 같은 순수 공유 모듈(src/io/, src/shared/)만 런타임 import 가능.
// type-only import(src/types, preload의 Api 타입 등)는 어디서든 허용.
console.log('\n[10] electron/ → src/ 런타임 import 검사 (io/·shared/만 허용)');
const ELECTRON_ALLOWED_TARGETS = ['src/io', 'src/shared'];
const ELECTRON_KNOWN_EXCEPTIONS = [];
let electronViolations = 0;
for (const e of boundaryEdges) {
  if (e.from !== 'electron' || e.type) continue;
  if (!e.to.startsWith('src/') || ELECTRON_ALLOWED_TARGETS.includes(e.to)) continue;
  if (isKnownException(ELECTRON_KNOWN_EXCEPTIONS, e)) continue;
  fail(`${e.file}: Error: [electron]은 [${e.to.replace('src/', '')}/]를 런타임 import할 수 없습니다. 공유가 필요하면 src/io/ 또는 src/shared/의 순수 모듈로 옮기세요. ARCHITECTURE.md#경계-규칙 참조.`);
  electronViolations++;
}
reportStaleExceptions(ELECTRON_KNOWN_EXCEPTIONS, 'electron/');
if (electronViolations === 0) console.log('  ✓ 위반 없음 ');

// ── 결과 ──
console.log('\n══════════════════════════════════');
if (failures > 0) {
  console.error(`아키텍처 검사 실패: ${failures}건의 위반`);
  process.exit(1);
} else {
  console.log('아키텍처 검사 통과 ✓');
  process.exit(0);
}
