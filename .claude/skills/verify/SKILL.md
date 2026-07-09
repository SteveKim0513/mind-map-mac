---
name: verify
description: "변경 후 전체 검증을 실행한다 — typecheck + unit test, 필요시 build. 모든 작업 완료 전 필수."
---

# /verify

작업이 끝났다고 주장하기 전에 이 Skill을 실행한다.

## 사전 조건

- `make setup` 이 완료된 상태 (`node_modules/` 존재)

## 실행 순서

### Step 1: 빠른 검증 (항상 실행)

```bash
make verify
# = npm run typecheck && npm test
```

결과 기록:
- 종료 코드
- 타입 오류 수
- 테스트 통과/실패 수

### Step 2: 빌드 검증 (PR 전, 또는 Electron 관련 변경 시)

```bash
make verify-full
# = npm run typecheck && npm test && npm run build
```

### Step 3: 하네스 구조 검사 (CLAUDE.md·rules·docs 변경 시)

```bash
make harness-check
```

### Step 4: UI/Electron 변경 시 런타임 확인

```bash
make dev-safe
```

격리된 임시 환경에서 앱을 실행하고 변경된 기능을 실제로 동작시킨다. **E2E 시나리오도 함께 작성한다** (`e2e/*.spec.ts`).

### Step 5: 배포 전 게이트 (make bump 전 필수)

```bash
make pre-release
# = verify-full + E2E 전체
```

새 기능·UI 변경이 포함된 릴리즈는 이 타겟이 통과한 뒤 `make bump`를 실행한다.

## 실패 처리

- 타입 오류: 원인 파일과 줄을 찾아 수정 후 재실행.
- 테스트 실패: 실패 이유 분석 후 수정. 동일 실패가 2회 이상 반복되면 테스트 격리 문제인지 확인.
- 빌드 실패: `tsc --noEmit` 결과와 Vite 빌드 오류를 분리해 처리.

## 완료 조건

- `make verify` 종료 코드 0
- 타입 오류 0, 테스트 실패 0

## 완료 보고 형식

```
make verify 결과: 종료 코드 0
- 타입 오류: 0
- 테스트: X passed, 0 failed
- [optional] make verify-full: 종료 코드 0
- [optional] 런타임 검증: [스크린샷/로그 링크 또는 설명]
```
