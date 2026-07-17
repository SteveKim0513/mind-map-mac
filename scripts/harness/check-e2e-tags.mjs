#!/usr/bin/env node
/**
 * E2E 도메인 태그 무결성 검사.
 * 모든 e2e/*.spec.ts의 각 test(...) 호출은 아래 고정 어휘 중 1개 이상의
 * 도메인 태그(`{ tag: ['@x'] }`)를 가져야 한다. 태그 없는 test는 어떤
 * `make verify-feature tag=@x` 부분 실행에서도 누락되어 회귀 그물에 구멍을 낸다.
 * (배포 게이트 make pre-release는 전체를 돌리므로 최종 안전망은 유지되지만,
 *  개발 루프의 빠른 피드백에서 빠진다.)
 *
 * make harness-check 또는 node scripts/harness/check-e2e-tags.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '../..');
const E2E = path.join(ROOT, 'e2e');

// 고정 도메인 태그 어휘. 새 도메인이 필요하면 여기에 먼저 추가하고
// .claude/rules/testing.md 의 태그 표도 함께 갱신한다.
const DOMAIN = new Set([
  '@map', '@calendar', '@schedule', '@focus', '@todo',
  '@note', '@capture', '@command', '@nav', '@view',
]);

// 실행 방식을 나타내는 수식 태그 (도메인과 직교). @serial: 포커스/frontmost 같은
// OS 전역 자원에 의존해 병렬 실행이 불가능한 테스트 — scripts/e2e-run.mjs가
// 나머지를 병렬로 돌린 뒤 이 태그만 workers=1로 직렬 실행한다.
const MODIFIER = new Set(['@serial']);

let failures = 0;
function fail(msg) {
  console.error(`  ✗ ${msg}`);
  failures++;
}

console.log('\n[e2e-tags] E2E 도메인 태그 무결성 검사');

if (!fs.existsSync(E2E)) {
  console.log('  ⚠ e2e/ 디렉터리 없음 — 건너뜀');
  process.exit(0);
}

const specs = fs
  .readdirSync(E2E)
  .filter((f) => f.endsWith('.spec.ts'))
  .sort();

// test('title', { tag: [...] }, ...) 형태를 매칭. 태그 블록이 없으면 미매칭.
const TAGGED = /test\(\s*(?:'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"|`(?:[^`\\]|\\.)*`)\s*,\s*\{\s*tag:\s*\[([^\]]*)\]/g;
// 모든 test( 호출 (태그 유무 무관) 개수 — 미태깅 개수 산출용.
const ANY_TEST = /(^|[^.\w])test\(\s*(?:'|"|`)/g;

for (const spec of specs) {
  const src = fs.readFileSync(path.join(E2E, spec), 'utf8');

  const total = (src.match(ANY_TEST) || []).length;
  const tagBlocks = [...src.matchAll(TAGGED)];
  const tagged = tagBlocks.length;

  if (total === 0) continue; // 헬퍼 전용 파일 등

  if (tagged < total) {
    fail(`${spec}: test ${total}개 중 ${total - tagged}개가 도메인 태그 없음. ` +
      `test('...', { tag: ['@<domain>'] }, async ...) 형태로 태그하라.`);
  }

  // 각 test는 도메인 태그 1개 이상 + 어휘 밖 태그 금지
  for (const m of tagBlocks) {
    const tags = m[1]
      .split(',')
      .map((t) => t.trim().replace(/^['"`]|['"`]$/g, ''))
      .filter(Boolean);
    for (const t of tags) {
      if (!DOMAIN.has(t) && !MODIFIER.has(t)) {
        fail(`${spec}: 알 수 없는 태그 ${t}. 도메인: ${[...DOMAIN].join(' ')} / 수식: ${[...MODIFIER].join(' ')}. ` +
          `새 도메인이면 check-e2e-tags.mjs DOMAIN과 rules/testing.md를 먼저 갱신하라.`);
      }
    }
    if (!tags.some((t) => DOMAIN.has(t))) {
      fail(`${spec}: test에 도메인 태그가 없음 (수식 태그만 있음: ${tags.join(' ')}). 도메인 1개 이상 필수.`);
    }
  }
}

console.log('\n══════════════════════════════════');
if (failures > 0) {
  console.error(`E2E 태그 검사 실패: ${failures}건`);
  process.exit(1);
} else {
  console.log(`E2E 태그 검사 통과 ✓ (${specs.length}개 spec)`);
  process.exit(0);
}
