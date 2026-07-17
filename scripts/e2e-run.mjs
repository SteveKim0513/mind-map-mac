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

const domain = process.argv[2]; // 선택적 도메인 grep (없으면 전체)

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
