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
npm run test:e2e    # build + playwright test
```

E2E는 먼저 `npm run build`를 실행하므로 시간이 걸린다.

## 전체 검증

```bash
make verify         # typecheck + unit test (빠름, 완료 전 필수)
make verify-full    # typecheck + unit test + build (PR 전 필수)
```

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
