# 테스트 가이드

## 테스트 구조

```
단위 테스트 (Vitest)
  src/**/*.test.ts
  - 순수 함수, 포맷 변환, store 뮤테이션, 비즈니스 로직

E2E 테스트 (Playwright)
  tests/ 또는 e2e/
  - Electron 앱 전체 실행, 핵심 사용자 여정
```

## 단위 테스트 실행

```bash
make test           # vitest run (한 번 실행)
npm run test:watch  # vitest watch 모드
```

## E2E 테스트 실행

```bash
npm run test:e2e              # build + playwright test (전체)
make e2e                      # 위와 동일 (전체)
make e2e-tag tag=@calendar    # build + 해당 도메인 태그 spec만
```

E2E는 먼저 `npm run build`를 실행하므로 시간이 걸린다. 실행은 `scripts/e2e-run.mjs`가 **2단계**로 처리한다: 대부분의 spec을 병렬(`playwright.config.ts`의 `workers`, 기본 로컬 4)로 돌린 뒤, frontmost(앱 활성화)에 의존해 병렬이 불가능한 `@serial` 테스트만 `workers=1`로 직렬 실행한다. 그래도 빌드+전체 실행은 비싸므로 개발 중에는 도메인 태그로 부분 실행한다.

**도메인 태그 어휘 (10개)**: `@map` `@calendar` `@schedule` `@focus` `@todo` `@note` `@capture` `@command` `@nav` `@view`. 모든 `test(...)`가 태그를 가지며(`{ tag: ['@x'] }`), 한 spec이 여러 태그를 가질 수 있다. 여러 도메인 동시 실행은 `tag="@calendar|@focus"`. 규칙·태깅 상세는 `.claude/rules/testing.md`.

## 전체 검증

```bash
make verify                   # typecheck + unit test (빠름, 완료 전 필수)
make verify-feature tag=@x    # verify + 해당 도메인 E2E만 (기능 단위 검증)
make verify-full              # typecheck + unit test + build (PR 전 필수)
make pre-release              # verify-full + 전체 E2E (배포 게이트 — make bump 전 필수)
```

**계층 전략**: 매 기능 완료는 `make verify-feature tag=@x`(부분), 배포 지시를 받으면 `make pre-release`(전체 E2E)로 게이트. 배포 게이트는 부분집합으로 낮추지 않는다.

## E2E 격리

E2E 테스트는 반드시 실제 사용자 데이터와 격리한다:

```bash
# playwright.config.ts에서 환경 변수 설정 확인
MINDMAP_USER_DATA=/tmp/mindmap-e2e-data MINDMAP_WORKSPACE=/tmp/mindmap-e2e-ws npm run test:e2e
```

## 테스트 추가 가이드

- **단위 테스트**: `src/io/foo.ts` → `src/io/foo.test.ts`
- **버그 수정**: 실패 재현 테스트 먼저, 그 다음 수정 (`/fix-bug` Skill 참조)
- **새 순수 함수**: 경계 값, 빈 입력, 오류 케이스를 테스트

## 결과 아티팩트

- 단위 테스트: stdout 출력
- E2E 실패: `test-results/`, `playwright-report/` (gitignore됨)
