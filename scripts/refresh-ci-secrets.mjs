#!/usr/bin/env node
/**
 * refresh-ci-secrets.mjs — CI 서명 인증서 시크릿 갱신
 *
 * 로컬 키체인의 Developer ID 인증서를 GitHub Secrets에 재등록한다.
 * CI 빌드에서 "MAC_CSC_LINK is empty" 오류가 날 때 이 스크립트를 실행한다.
 *
 * 사용법: node scripts/refresh-ci-secrets.mjs
 * 전제: gh CLI 로그인 (소유자 계정 SteveKim0513 또는 권한 있는 계정)
 *
 * 하는 일:
 *   1. 로컬 키체인에서 Developer ID 인증서를 p12로 내보냄
 *   2. base64 인코딩 후 MAC_CSC_LINK 시크릿 갱신
 *   3. 내보내기 비밀번호를 MAC_CSC_KEY_PASSWORD 시크릿 갱신
 *   4. 임시 파일 삭제
 */
import { execFileSync, execSync } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir, homedir } from 'node:os';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

const CERT_SHA   = '70A89D6C17287C41A05E7A9F628D311C25327E3F'; // Developer ID Application: Imagine Furtures
const REPO       = 'SteveKim0513/mind-map-mac';
const KEYCHAIN   = join(homedir(), 'Library/Keychains/login.keychain-db');

function fail(msg) { console.error('✗', msg); process.exit(1); }

// ── gh 계정 확인 ───────────────────────────────────────────────────────────
console.log('gh 계정 확인 중…');
try {
  const status = execSync('gh auth status 2>&1', { encoding: 'utf8' });
  if (!status.includes('SteveKim0513') && !status.includes('Active account: true')) {
    console.warn('⚠  gh 활성 계정을 확인하세요. repo 쓰기 권한이 필요합니다.');
    console.warn('   gh auth switch --user SteveKim0513');
  }
} catch { /* gh not in PATH */ fail('gh CLI를 찾을 수 없습니다. brew install gh'); }

if (!existsSync(KEYCHAIN)) fail(`키체인 없음: ${KEYCHAIN}`);

// ── 비밀번호 입력 ──────────────────────────────────────────────────────────
const rl = createInterface({ input: process.stdin, output: process.stdout });
const password = await new Promise((resolve) => {
  process.stdout.write('p12 내보내기 비밀번호 (새로 설정할 값, 빈 칸도 가능): ');
  rl.once('line', resolve);
});
rl.close();

// ── p12 내보내기 ───────────────────────────────────────────────────────────
const tmp = mkdtempSync(join(tmpdir(), 'mindmap-ci-cert-'));
const p12 = join(tmp, 'cert.p12');

try {
  console.log('\n키체인에서 인증서 내보내는 중…');
  execFileSync('security', [
    'export',
    '-k', KEYCHAIN,
    '-t', 'identities', // 개인키 + 인증서 쌍
    '-f', 'pkcs12',
    '-P', password,
    '-o', p12,
    '-i', CERT_SHA,
  ], { stdio: ['ignore', 'pipe', 'pipe'] });

  if (!existsSync(p12)) fail('p12 내보내기 실패 — 비밀번호가 틀렸거나 인증서가 없습니다.');

  // ── base64 인코딩 + 시크릿 등록 ─────────────────────────────────────────
  const b64 = readFileSync(p12).toString('base64');

  console.log('MAC_CSC_LINK 갱신 중…');
  execSync(
    `gh secret set MAC_CSC_LINK --repo ${REPO}`,
    { input: b64, stdio: ['pipe', 'inherit', 'inherit'], encoding: 'utf8' },
  );

  console.log('MAC_CSC_KEY_PASSWORD 갱신 중…');
  execSync(
    `gh secret set MAC_CSC_KEY_PASSWORD --repo ${REPO}`,
    { input: password, stdio: ['pipe', 'inherit', 'inherit'], encoding: 'utf8' },
  );

  console.log('\n✓ 시크릿 갱신 완료');
  console.log('  다음 CI 실행에서 서명이 정상 동작합니다.');
  console.log('  확인: gh secret list --repo', REPO);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
