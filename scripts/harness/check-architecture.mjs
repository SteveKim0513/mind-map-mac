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
const UI_MODULES = ['canvas', 'ui', 'sidebar', 'panes', 'inspector', 'menu'];
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
const DOMAIN_MODULES = ['canvas', 'note', 'focus', 'sync', 'search'];
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

// ── 결과 ──
console.log('\n══════════════════════════════════');
if (failures > 0) {
  console.error(`아키텍처 검사 실패: ${failures}건의 위반`);
  process.exit(1);
} else {
  console.log('아키텍처 검사 통과 ✓');
  process.exit(0);
}
