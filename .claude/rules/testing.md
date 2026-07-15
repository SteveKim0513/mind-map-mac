---
description: "테스트 작성 규칙 — Vitest(단위) + Playwright(E2E)"
---

# Testing Rules

## 테스트 도구

- **단위 테스트**: Vitest (`npm test`, `src/**/*.test.ts`)
  - 환경: node (jsdom 아님)
  - 설정: `vitest.config.ts`
- **E2E 테스트**: Playwright (`npm run test:e2e`, `e2e/**/*.spec.ts` 또는 `tests/`)
  - 앱을 실제로 빌드하고 Electron으로 실행
  - `MINDMAP_USER_DATA` 환경변수로 userData 격리 필수

## 단위 테스트 규칙

- 순수 함수와 변환 로직은 단위 테스트로 커버한다 (`io/`, `focus/`, `layout/`, `sync/` 등).
- Store 뮤테이션은 단위 테스트로 검증한다 (`store/*.test.ts` 패턴 참조).
- React 컴포넌트는 단위 테스트보다 E2E나 실제 앱 확인을 우선한다.
- 테스트 파일은 테스트 대상 파일 옆에 `*.test.ts`로 둔다.

## 버그 수정 계약

1. 실패를 재현하는 테스트를 **먼저** 추가한다.
2. `npm test`로 새 테스트가 실패하는지 확인한다.
3. 수정을 구현한다.
4. `npm test`로 새 테스트가 통과하는지 확인한다.
5. 기존 테스트가 모두 통과하는지 확인한다.

재현 불가능한 경우 이유를 명시하고 수집한 증거를 기록한다.

## E2E 규칙

- **새 기능·UI 변경 시 E2E 추가 의무**: 기능이 배포될 때 `e2e/*.spec.ts`에 해당 기능의 핵심 시나리오가 반드시 있어야 한다. E2E 없이 배포하면 다음 릴리즈에서 회귀를 잡을 그물망이 없다.
- E2E는 핵심 사용자 여정(노드 생성, 저장, 노트 연결)을 커버한다.
- `MINDMAP_USER_DATA`와 `MINDMAP_WORKSPACE` 환경변수로 실제 데이터와 격리한다 (`e2e/helpers.ts`의 `launchApp()` 사용).
- `launchApp()`은 `MINDMAP_E2E_QUIET=1`도 함께 설정 — Electron 창을 화면 밖(off-screen)에 비활성 상태로 띄워 실행 중 포커스를 뺏지 않는다(Playwright는 CDP로 제어하므로 창이 실제로 보이거나 활성화될 필요가 없다). `make dev-safe`는 이 값을 설정하지 않는다 — 사람이 직접 보고 조작해야 하므로 창이 정상적으로 뜨고 포커스를 받아야 한다.
- 시간 기반 `sleep` 대기 대신 명시적인 준비 상태 확인(`waitForSelector` 등)을 사용한다.
- VSCode 환경에서는 `ELECTRON_RUN_AS_NODE`를 반드시 제거한다 (`e2e/helpers.ts` 참조).

## 배포 전 게이트

```bash
make pre-release  # = verify-full + E2E
```

`make bump` 전에 반드시 통과해야 한다. E2E가 없는 기능은 커버리지가 없는 것으로 간주한다.

## 테스트 금지 패턴

```typescript
// ❌ 실제 macOS Reminders API를 테스트에서 직접 호출
// ❌ 실제 사용자 워크스페이스 경로를 하드코딩
// ❌ sleep으로 비동기 대기
await new Promise(r => setTimeout(r, 1000)); // 금지

// ✅ vitest의 vi.useFakeTimers() 또는 조건 대기
await waitFor(() => expect(element).toBeVisible());
```

## 테스트가 없어도 되는 경우

- React 렌더링 전용 컴포넌트 (E2E가 더 효과적)
- Electron IPC 핸들러 (통합 테스트 또는 E2E로 커버)
- 단순 타입 재수출

## `make verify` = `npm run typecheck && npm test`

- `make verify`가 통과하지 않으면 작업을 완료 처리하지 않는다.
