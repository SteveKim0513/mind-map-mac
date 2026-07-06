#!/usr/bin/env node
/**
 * check-design.mjs — UI 디자인 일관성 자동 검사
 *
 * 검사 항목:
 *   [1] 필수 디자인 문서 존재 확인
 *   [2] .tsx 파일에서 인라인 style에 raw hex 색상 사용 탐지
 *   [3] styles.css에서 허용 목록 외 raw hex 경고 (정보용)
 *   [4] 폰트 사이즈 10px 이하 사용 탐지
 */
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '../..');

let warnings = 0;
let errors = 0;

function pass(msg) { console.log('  ✓', msg); }
function warn(msg) { console.warn('  ⚠', msg); warnings++; }
function fail(msg) { console.error('  ✗', msg); errors++; }

// ── 허용된 raw hex (UI-DESIGN-PRINCIPLES.md 명시) ────────────────────────────
const ALLOWED_HEX = new Set(['#34c759', '#ff3b30', '#34C759', '#FF3B30']);

// ── 유틸 ─────────────────────────────────────────────────────────────────────
function walk(dir, ext, results = []) {
  for (const entry of readdirSync(dir)) {
    if (entry.startsWith('.') || entry === 'node_modules' || entry === 'dist' || entry === 'dist-electron') continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, ext, results);
    else if (full.endsWith(ext)) results.push(full);
  }
  return results;
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[1] 필수 디자인 문서 존재 확인');
const requiredDocs = [
  'docs/design/UI-DESIGN-PRINCIPLES.md',
  'docs/design/COLOR-SYSTEM.md',
  '.claude/skills/design-ui.md',
];
for (const doc of requiredDocs) {
  if (existsSync(join(ROOT, doc))) pass(doc);
  else fail(`필수 파일 없음: ${doc}`);
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[2] .tsx 인라인 style에서 raw hex 탐지');
const tsxFiles = walk(join(ROOT, 'src'), '.tsx');
const inlineHexRe = /style=\{[^}]*#([0-9a-fA-F]{3,8})[^}]*\}/g;
let hexInTsx = 0;

for (const file of tsxFiles) {
  const src = readFileSync(file, 'utf-8');
  let m;
  while ((m = inlineHexRe.exec(src)) !== null) {
    const hex = `#${m[1]}`;
    if (!ALLOWED_HEX.has(hex)) {
      const line = src.slice(0, m.index).split('\n').length;
      warn(`${relative(ROOT, file)}:${line} — style에 raw hex "${hex}" (CSS 변수 사용 권장)`);
      hexInTsx++;
    }
  }
}
if (hexInTsx === 0) pass('.tsx 파일에 허용 목록 외 인라인 hex 없음');

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[3] styles.css raw hex 현황 (정보용)');
const cssPath = join(ROOT, 'src/styles.css');
if (existsSync(cssPath)) {
  const css = readFileSync(cssPath, 'utf-8');
  const cssHexRe = /#([0-9a-fA-F]{3,8})\b/g;
  const hexSet = new Set();
  let m;
  while ((m = cssHexRe.exec(css)) !== null) {
    const hex = `#${m[1]}`;
    if (!ALLOWED_HEX.has(hex) && !hex.startsWith('#0') /* opacity shorthands */) {
      hexSet.add(hex);
    }
  }
  if (hexSet.size > 0) {
    warn(`styles.css에 허용 목록 외 raw hex ${hexSet.size}개 — CSS 변수 전환 권장: ${[...hexSet].slice(0, 5).join(', ')}${hexSet.size > 5 ? '…' : ''}`);
  } else {
    pass('styles.css: 허용 목록 외 raw hex 없음');
  }
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[4] 폰트 사이즈 10px 이하 탐지');
const smallFontRe = /font-size:\s*(([0-9]+(?:\.[0-9]+)?)\s*px)/g;
const cssFiles = walk(join(ROOT, 'src'), '.css');
let smallFonts = 0;

for (const file of cssFiles) {
  const src = readFileSync(file, 'utf-8');
  let m;
  while ((m = smallFontRe.exec(src)) !== null) {
    const size = parseFloat(m[2]);
    if (size < 11) {
      const line = src.slice(0, m.index).split('\n').length;
      warn(`${relative(ROOT, file)}:${line} — font-size: ${m[1]} (최소 11px 권장)`);
      smallFonts++;
    }
  }
}
if (smallFonts === 0) pass('모든 CSS 폰트 사이즈 11px 이상');

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n══════════════════════════════════════');
if (errors > 0) {
  console.error(`디자인 검사 실패 ✗ (오류: ${errors}, 경고: ${warnings})`);
  process.exit(1);
} else if (warnings > 0) {
  console.log(`디자인 검사 통과 ✓ (경고: ${warnings}건)`);
} else {
  console.log('디자인 검사 통과 ✓');
}
