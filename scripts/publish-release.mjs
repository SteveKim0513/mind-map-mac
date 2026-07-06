#!/usr/bin/env node
/**
 * publish-release.mjs — GitHub Release 생성 · 자산 업로드
 *
 * `npm run dist` (빌드+서명+공증+검증) 직후 실행한다.
 * 기존 release가 있으면 자산만 덮어쓴다 (--clobber).
 *
 * 사용법: node scripts/publish-release.mjs
 *        make release        (bump + dist + publish 전체 흐름)
 *
 * 전제:
 *   - release/ 디렉터리에 dist 산출물이 있어야 함
 *   - gh CLI가 SteveKim0513 계정으로 활성화돼 있어야 함
 *     (gh auth switch --user SteveKim0513)
 */
import { execSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const REPO = 'SteveKim0513/mind-map-mac';

function run(cmd, opts = {}) {
  return execSync(cmd, { cwd: ROOT, encoding: 'utf8', ...opts }).trim();
}

function fail(msg) { console.error('✗', msg); process.exit(1); }

// ── 버전 ──────────────────────────────────────────────────────────────────
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
const version = pkg.version;
const tag = `v${version}`;

console.log(`릴리즈 준비: ${tag}`);

// ── gh 계정 확인 ───────────────────────────────────────────────────────────
let ghStatus = '';
try { ghStatus = run('gh auth status 2>&1'); } catch { fail('gh CLI를 찾을 수 없습니다. brew install gh'); }

if (!ghStatus.includes('SteveKim0513')) {
  console.warn('⚠  gh 활성 계정이 SteveKim0513이 아닙니다.');
  console.warn('   gh auth switch --user SteveKim0513');
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const proceed = await new Promise(resolve => {
    rl.question('계속하시겠습니까? (y/N) ', resolve);
  });
  rl.close();
  if (proceed.trim().toLowerCase() !== 'y') { console.log('취소.'); process.exit(0); }
}

// ── 자산 확인 ─────────────────────────────────────────────────────────────
const assetGlobs = [
  `release/MindMap-${version}-arm64.dmg`,
  `release/MindMap-${version}-arm64.dmg.blockmap`,
  `release/MindMap-${version}-arm64-mac.zip`,
  `release/MindMap-${version}-arm64-mac.zip.blockmap`,
  `release/latest-mac.yml`,
];

const missing = assetGlobs.filter(p => !existsSync(join(ROOT, p)));
if (missing.length > 0) {
  fail(`다음 자산이 없습니다 — 먼저 npm run dist 실행:\n${missing.map(p => '  ' + p).join('\n')}`);
}
console.log('✓ 5개 자산 확인 완료');

// ── release notes 경로 ────────────────────────────────────────────────────
const notesPath = `docs/release/notes/${tag}.md`;
const notesFlag = existsSync(join(ROOT, notesPath)) ? `--notes-file "${notesPath}"` : '--generate-notes';

// ── Release 생성 또는 업로드 ──────────────────────────────────────────────
const assets = assetGlobs.join(' ');

let exists = false;
try { run(`gh release view ${tag} --repo ${REPO} 2>/dev/null`); exists = true; } catch { /* not found */ }

if (exists) {
  console.log(`기존 릴리즈 ${tag} 에 자산 덮어쓰기 중…`);
  run(`gh release upload ${tag} --repo ${REPO} --clobber ${assets}`, { stdio: 'inherit' });
} else {
  console.log(`릴리즈 ${tag} 생성 중…`);
  run(
    `gh release create ${tag} --repo ${REPO} --title "${version}" ${notesFlag} ${assets}`,
    { stdio: 'inherit' },
  );
}

console.log(`\n✓ 릴리즈 완료: https://github.com/${REPO}/releases/tag/${tag}`);
console.log('\n퍼블리시된 자산:');
run(`gh release view ${tag} --repo ${REPO} --json assets -q '.assets[].name'`, { stdio: 'inherit' });

console.log('\n정리 (Spotlight 중복 방지):');
console.log('  rm -rf release/mac-arm64 release-dev/mac-arm64');
