#!/usr/bin/env node
/**
 * 문서 무결성 검사 — 깨진 내부 링크, 오래된 명령어, 충돌 규칙 탐지
 * make harness-check 또는 node scripts/harness/check-docs.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '../..');

let failures = 0;
let warnings = 0;

function fail(msg) {
  console.error(`  ✗ ${msg}`);
  failures++;
}

function warn(msg) {
  console.warn(`  ⚠ ${msg}`);
  warnings++;
}

// Markdown 파일 수집
function collectMarkdown(dir) {
  const results = [];
  if (!fs.existsSync(dir)) return results;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory() && !['node_modules', '.git', 'dist', 'dist-electron', 'release'].includes(entry.name)) {
      results.push(...collectMarkdown(full));
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      results.push(full);
    }
  }
  return results;
}

// ── 검사 1: 내부 마크다운 링크 유효성 ──
console.log('\n[1] 내부 링크 유효성 검사');
const mdFiles = collectMarkdown(ROOT);
let brokenLinks = 0;
for (const file of mdFiles) {
  const content = fs.readFileSync(file, 'utf8');
  const dir = path.dirname(file);
  // [text](path) 패턴에서 상대 경로만
  const linkRe = /\[([^\]]+)\]\(([^)#]+)(?:#[^)]*)?\)/g;
  let m;
  while ((m = linkRe.exec(content)) !== null) {
    const linkPath = m[2];
    if (linkPath.startsWith('http') || linkPath.startsWith('mailto:')) continue;
    const resolved = path.resolve(dir, linkPath);
    if (!fs.existsSync(resolved)) {
      warn(`깨진 링크 — ${path.relative(ROOT, file)}: [${m[1]}](${linkPath})`);
      brokenLinks++;
    }
  }
}
if (brokenLinks === 0) console.log('  ✓ 깨진 링크 없음');

// ── 검사 2: CLAUDE.md가 @AGENTS.md를 포함하는지 ──
console.log('\n[2] CLAUDE.md → @AGENTS.md import 확인');
const claudeMd = path.join(ROOT, 'CLAUDE.md');
if (fs.existsSync(claudeMd)) {
  const content = fs.readFileSync(claudeMd, 'utf8');
  if (!content.includes('@AGENTS.md')) {
    fail('CLAUDE.md에 @AGENTS.md import가 없습니다.');
  } else {
    console.log('  ✓ @AGENTS.md 포함됨');
  }
}

// ── 검사 3: 명령어 일관성 — CLAUDE.md와 AGENTS.md가 같은 make 명령을 쓰는지 ──
console.log('\n[3] 명령어 일관성 검사');
const agentsMd = path.join(ROOT, 'AGENTS.md');
if (fs.existsSync(claudeMd) && fs.existsSync(agentsMd)) {
  const claudeContent = fs.readFileSync(claudeMd, 'utf8');
  const agentsContent = fs.readFileSync(agentsMd, 'utf8');
  const makeRe = /make\s+\w+/g;
  const claudeCmds = new Set(claudeContent.match(makeRe) || []);
  const agentsCmds = new Set(agentsContent.match(makeRe) || []);
  // CLAUDE.md에 있는 명령이 AGENTS.md에도 있어야 함 (핵심 명령)
  for (const cmd of ['make verify', 'make setup', 'make dev']) {
    if (!claudeCmds.has(cmd)) warn(`CLAUDE.md에 '${cmd}' 명령이 없습니다.`);
    if (!agentsCmds.has(cmd)) warn(`AGENTS.md에 '${cmd}' 명령이 없습니다.`);
  }
  console.log('  ✓ 핵심 명령 일관성 확인 완료');
}

// ── 검사 4: exec-plans/active 에 오래된 계획이 있는지 ──
console.log('\n[4] 실행 계획 상태 확인');
const activePlansDir = path.join(ROOT, 'docs/exec-plans/active');
if (fs.existsSync(activePlansDir)) {
  const plans = fs.readdirSync(activePlansDir).filter(f => f.endsWith('.md') && f !== '.gitkeep');
  if (plans.length > 5) {
    warn(`docs/exec-plans/active/에 ${plans.length}개의 계획이 있습니다. 완료된 것은 completed/로 이동하세요.`);
  } else {
    console.log(`  ✓ 활성 계획: ${plans.length}개`);
  }
}

// ── 검사 5: decisions/ 번호 중복 ──
console.log('\n[5] decisions/ 번호 중복 검사');
const decisionsDir = path.join(ROOT, 'docs/decisions');
if (fs.existsSync(decisionsDir)) {
  const files = fs.readdirSync(decisionsDir).filter(f => /^\d{4}/.test(f));
  const nums = files.map(f => f.match(/^(\d{4})/)?.[1]).filter(Boolean);
  const seen = new Set();
  for (const n of nums) {
    if (seen.has(n)) fail(`decisions/ 번호 중복: ${n}`);
    seen.add(n);
  }
  if (failures === 0) console.log(`  ✓ decisions/ ${nums.length}개 번호 중복 없음`);
}

// ── 결과 ──
console.log('\n══════════════════════════════════');
if (failures > 0) {
  console.error(`문서 검사 실패: ${failures}건의 오류 (경고: ${warnings}건)`);
  process.exit(1);
} else {
  console.log(`문서 검사 통과 ✓ (경고: ${warnings}건)`);
  process.exit(0);
}
