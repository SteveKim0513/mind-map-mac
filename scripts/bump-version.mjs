#!/usr/bin/env node
/**
 * bump-version.mjs — 버전 범프 (태그 없음)
 *
 * 사용법: node scripts/bump-version.mjs X.Y.Z
 *        make bump version=X.Y.Z
 *
 * 하는 일:
 *   1. 버전 형식 검증 (semver X.Y.Z)
 *   2. 현재 버전보다 큰지 확인
 *   3. docs/release/notes/vX.Y.Z.md 없으면 템플릿 생성 + 경고
 *   4. package.json version 수정
 *   5. git add + commit "chore: bump to vX.Y.Z"
 *   6. 완료 메시지 안내 (태그는 make tag로 별도 생성)
 *
 * 태그는 CHANGELOG·릴리즈 노트 등 후속 커밋을 모두 마친 뒤
 * `make tag version=X.Y.Z`로 찍어야 CI가 올바른 커밋을 빌드한다.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

function run(cmd, args, opts = {}) {
  return execFileSync(cmd, args, { cwd: ROOT, encoding: 'utf8', ...opts }).trim();
}

function fail(msg) {
  console.error('✗', msg);
  process.exit(1);
}

// ── 인수 검증 ──────────────────────────────────────────────────────────────
const newVersion = process.argv[2];
if (!newVersion) fail('버전을 지정하세요: node scripts/bump-version.mjs X.Y.Z');
if (!/^\d+\.\d+\.\d+$/.test(newVersion)) fail(`유효하지 않은 semver: "${newVersion}" (X.Y.Z 형식 필요)`);

// ── 현재 버전 확인 ──────────────────────────────────────────────────────────
const pkgPath = join(ROOT, 'package.json');
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
const currentVersion = pkg.version;

const [cMaj, cMin, cPat] = currentVersion.split('.').map(Number);
const [nMaj, nMin, nPat] = newVersion.split('.').map(Number);
const isGreater =
  nMaj > cMaj ||
  (nMaj === cMaj && nMin > cMin) ||
  (nMaj === cMaj && nMin === cMin && nPat > cPat);

if (!isGreater) fail(`새 버전(${newVersion})이 현재 버전(${currentVersion})보다 크지 않습니다.`);

// ── 브랜치 확인 (main에서만 허용) ─────────────────────────────────────────
const currentBranch = run('git', ['rev-parse', '--abbrev-ref', 'HEAD']);
if (currentBranch !== 'main') {
  fail(`브랜치가 main이 아닙니다 (현재: ${currentBranch}).\n  git checkout main 후 다시 실행하세요.`);
}

// ── 원격 동기화 확인 ───────────────────────────────────────────────────────
try {
  run('git', ['fetch', 'origin', 'main', '--quiet']);
  const behind = run('git', ['rev-list', '--count', 'HEAD..origin/main']);
  if (parseInt(behind) > 0) {
    fail(`로컬 main이 origin/main보다 ${behind}개 커밋 뒤처져 있습니다.\n  git pull 후 다시 실행하세요.`);
  }
} catch {
  console.warn('⚠  원격 동기화 확인 실패 (오프라인?). 계속 진행합니다.');
}

// ── 워킹트리 상태 확인 ──────────────────────────────────────────────────────
const status = run('git', ['status', '--porcelain']);
const dirtyFiles = status.split('\n').filter((l) => l.trim() && !l.startsWith('??'));
if (dirtyFiles.length > 0) {
  fail(`커밋되지 않은 변경이 있습니다. 먼저 커밋 후 bump 하세요:\n${dirtyFiles.join('\n')}`);
}

// ── 릴리즈 노트 확인 ──────────────────────────────────────────────────────
const notesDir = join(ROOT, 'docs/release/notes');
const notesPath = join(notesDir, `v${newVersion}.md`);
const templatePath = join(notesDir, 'TEMPLATE.md');

let notesCreated = false;
if (!existsSync(notesPath)) {
  const template = existsSync(templatePath)
    ? readFileSync(templatePath, 'utf8').replace(/vX\.Y\.Z/g, `v${newVersion}`).replace(/YYYY-MM-DD/g, new Date().toISOString().slice(0, 10))
    : `# v${newVersion} — ${new Date().toISOString().slice(0, 10)}\n\n## 새 기능\n-\n\n## 수정\n-\n\n## 주의\n-\n`;
  writeFileSync(notesPath, template);
  notesCreated = true;
  console.warn(`⚠  릴리즈 노트를 생성했습니다: docs/release/notes/v${newVersion}.md`);
  console.warn('   내용을 작성한 뒤 계속하세요. (이미 git에 포함됩니다)\n');
}

// ── package.json 버전 수정 ──────────────────────────────────────────────────
pkg.version = newVersion;
writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
console.log(`✓ package.json: ${currentVersion} → ${newVersion}`);

// ── git commit + tag ───────────────────────────────────────────────────────
const filesToAdd = ['package.json'];
if (notesCreated) filesToAdd.push(`docs/release/notes/v${newVersion}.md`);

run('git', ['add', ...filesToAdd]);
run('git', ['commit', '-m', `chore: bump to v${newVersion}`]);

console.log(`✓ git commit: chore: bump to v${newVersion}`);
console.log(`\nCHANGELOG·릴리즈 노트 커밋을 마친 뒤 태그를 찍어 CI를 시작하세요:`);
console.log(`  make tag version=${newVersion}`);
