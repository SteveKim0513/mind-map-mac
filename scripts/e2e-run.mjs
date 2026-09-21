#!/usr/bin/env node
/**
 * 2단계 E2E 실행기.
 *
 * 대부분의 spec은 격리된 userData·workspace로 자체 Electron 인스턴스를 띄우므로
 * 병렬 실행이 안전하다. 그러나 일부 테스트는 win.focus()로 외부변경 새로고침을
 * 트리거하는 등 macOS **frontmost(앱 활성화)** 같은 OS 전역 자원에 의존한다 —
 * 병렬 인스턴스들이 frontmost를 두고 경쟁하면 포커스가 실제로 안 잡혀 깨진다.
 * 이런 테스트는 `@serial` 태그를 달고, 여기서 나머지를 병렬로 돌린 뒤 마지막에
 * workers=1로 직렬 실행한다.
 *
 * 사용:
 *   node scripts/e2e-run.mjs               # 전체 (병렬 → @serial 직렬)
 *   node scripts/e2e-run.mjs @calendar     # 도메인 필터
 *   node scripts/e2e-run.mjs "@view|@nav"  # 여러 도메인
 *
 * 빌드는 호출 측(npm run test:e2e / make)에서 먼저 수행한다.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const domain = process.argv[2]; // 선택적 도메인 grep (없으면 전체)

// 공유 폴더 E2E(@share)는 각 테스트가 server/dist/relay.js의 startRelay()로 자체 릴레이를 띄운다.
// dist가 없거나 소스보다 오래됐으면 여기서 한 번 빌드한다(병렬 워커가 동시에 빌드하지 않게 시작 전에).
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
function newestMtime(dir) {
  let newest = 0;
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, ent.name);
    newest = Math.max(newest, ent.isDirectory() ? newestMtime(full) : statSync(full).mtimeMs);
  }
  return newest;
}
function ensureRelayBuilt() {
  const entry = join(root, 'server/dist/relay.js');
  if (!existsSync(join(root, 'server/node_modules'))) {
    // @share 이외의 도메인은 릴레이가 필요 없으므로 막지 않고 알리기만 한다(@share spec이 명확한 오류를 낸다).
    console.warn('⚠ server/node_modules 없음 — 릴레이 빌드를 건너뜁니다. @share E2E는 `make setup`(npm --prefix server ci) 뒤에 실행하세요.');
    return;
  }
  if (existsSync(entry) && statSync(entry).mtimeMs >= newestMtime(join(root, 'server/src'))) return;
  console.log('\n▶ 릴레이 서버 빌드 (server/dist가 없거나 오래됨)\n');
  const r = spawnSync('npm', ['--prefix', 'server', 'run', 'build'], { stdio: 'inherit', cwd: root });
  if (r.status !== 0) process.exit(r.status ?? 1);
}
ensureRelayBuilt();

function play(args, label) {
  console.log(`\n▶ ${label}\n`);
  const r = spawnSync('npx', ['playwright', 'test', ...args], { stdio: 'inherit' });
  return r.status ?? 1;
}

// Phase 1 — 병렬 (playwright.config.ts의 workers/fullyParallel), @serial 제외.
const p1args = ['--grep-invert', '@serial'];
if (domain) p1args.unshift('--grep', domain);
const p1 = play(p1args, `E2E 1/2 · 병렬 (${domain ?? '전체'}, @serial 제외)`);

// Phase 2 — 직렬 (@serial만; 도메인 필터가 있으면 교집합). 매칭 없으면 통과.
// 제목 문자열에 태그가 포함되므로 lookahead로 AND를 표현한다.
const serialGrep = domain ? `(?=.*@serial)(?=.*(?:${domain}))` : '@serial';
const p2 = play(
  ['--grep', serialGrep, '--workers=1', '--pass-with-no-tests'],
  `E2E 2/2 · 직렬 workers=1 (@serial${domain ? ` ∩ ${domain}` : ''})`,
);

process.exit(p1 || p2);
