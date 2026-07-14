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
const completedPlansDir = path.join(ROOT, 'docs/exec-plans/completed');
if (fs.existsSync(activePlansDir)) {
  const plans = fs.readdirSync(activePlansDir).filter(f => f.endsWith('.md') && f !== '.gitkeep');
  if (plans.length > 5) {
    warn(`docs/exec-plans/active/에 ${plans.length}개의 계획이 있습니다. 완료된 것은 completed/로 이동하세요.`);
  } else {
    console.log(`  ✓ 활성 계획: ${plans.length}개`);
  }

  // 상태-위치 정합성: active/에 있는 계획인데 상태가 completed/abandoned면 이동 누락
  let staleActive = 0;
  for (const plan of plans) {
    const content = fs.readFileSync(path.join(activePlansDir, plan), 'utf8');
    const m = content.match(/상태[:：]\s*(\S+)/);
    if (m && /^(completed|abandoned)$/i.test(m[1])) {
      fail(`docs/exec-plans/active/${plan}은 상태가 '${m[1]}'인데 completed/로 이동되지 않았습니다.`);
      staleActive++;
    }
  }
  if (staleActive === 0) console.log('  ✓ active/ 상태-위치 정합성 확인 완료');

  // 필수 필드: active/와 completed/의 모든 계획에 '날짜:'와 '상태:'가 있는지
  let missingFields = 0;
  for (const [label, dir] of [['active', activePlansDir], ['completed', completedPlansDir]]) {
    if (!fs.existsSync(dir)) continue;
    const files = fs.readdirSync(dir).filter(f => f.endsWith('.md') && f !== '.gitkeep');
    for (const f of files) {
      const content = fs.readFileSync(path.join(dir, f), 'utf8');
      const hasDate = /날짜[:：]/.test(content);
      const hasStatus = /상태[:：]/.test(content);
      if (!hasDate || !hasStatus) {
        warn(`docs/exec-plans/${label}/${f}에 '날짜:' 또는 '상태:' 필드가 없습니다.`);
        missingFields++;
      }
    }
  }
  if (missingFields === 0) console.log('  ✓ 필수 필드(날짜·상태) 확인 완료');
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

// ── 검사 6: docs/README.md 폴더 지도가 실제 docs/ 하위 폴더와 일치하는지 ──
console.log('\n[6] docs/README.md 폴더 지도 정합성 검사');
const docsReadme = path.join(ROOT, 'docs/README.md');
if (fs.existsSync(docsReadme)) {
  const content = fs.readFileSync(docsReadme, 'utf8');
  const dirs = fs
    .readdirSync(path.join(ROOT, 'docs'), { withFileTypes: true })
    .filter(e => e.isDirectory())
    .map(e => e.name);
  let missing = 0;
  for (const dir of dirs) {
    if (!content.includes(`\`${dir}/\``)) {
      fail(`docs/README.md 폴더 표에 'docs/${dir}/'가 없습니다. 새 폴더를 추가했다면 지도도 갱신하세요.`);
      missing++;
    }
  }
  if (missing === 0) console.log(`  ✓ docs/ 하위 ${dirs.length}개 폴더 모두 지도에 반영됨`);
}

// ── 검사 7: ARCHITECTURE.md 결정 표가 decisions/README.md와 번호 일치하는지 ──
console.log('\n[7] ARCHITECTURE.md ↔ decisions/README.md 결정 목록 동기화 검사');
const architectureMd = path.join(ROOT, 'ARCHITECTURE.md');
const decisionsReadme = path.join(ROOT, 'docs/decisions/README.md');
if (fs.existsSync(architectureMd) && fs.existsSync(decisionsReadme)) {
  const archContent = fs.readFileSync(architectureMd, 'utf8');
  const decContent = fs.readFileSync(decisionsReadme, 'utf8');
  const decNums = new Set([...decContent.matchAll(/\[(\d{4})\s*—/g)].map(m => m[1]));
  const archNums = new Set([...archContent.matchAll(/docs\/decisions\/(\d{4})-/g)].map(m => m[1]));
  let outOfSync = 0;
  for (const n of decNums) {
    if (!archNums.has(n)) {
      fail(`ARCHITECTURE.md 결정 표에 docs/decisions/${n}-*.md가 없습니다. decisions/README.md에는 있습니다 — 표를 갱신하세요.`);
      outOfSync++;
    }
  }
  if (outOfSync === 0) console.log(`  ✓ 결정 ${decNums.size}건 모두 ARCHITECTURE.md에 반영됨`);
}

// ── 검사 8: docs/product/specs·reports 폴더의 모든 파일이 각 README 인덱스에 있는지 ──
console.log('\n[8] product/specs·reports 인덱스 완전성 검사');
for (const sub of ['specs', 'reports']) {
  const dir = path.join(ROOT, 'docs/product', sub);
  if (!fs.existsSync(dir)) continue;
  const readme = path.join(dir, 'README.md');
  if (!fs.existsSync(readme)) {
    fail(`docs/product/${sub}/README.md가 없습니다 — 인덱스 없이는 이 폴더의 문서를 찾을 수 없습니다.`);
    continue;
  }
  const readmeContent = fs.readFileSync(readme, 'utf8');
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.md') && f !== 'README.md');
  let missing = 0;
  for (const f of files) {
    if (!readmeContent.includes(`(${f})`)) {
      fail(`docs/product/${sub}/README.md에 ${f}가 색인되어 있지 않습니다.`);
      missing++;
    }
  }
  if (missing === 0) console.log(`  ✓ docs/product/${sub}/ ${files.length}개 파일 모두 색인됨`);
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
