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

## 테스트 계층 전략 (비용 최적화)

테스트 비용은 사실상 **E2E**(Electron 빌드 + 인스턴스별 실행)에서 나온다. 단위·타입검사는 초 단위라 항상 전부 돌린다. 따라서 "어느 기능이냐"가 아니라 "어느 계층이냐"로 실행 범위를 나눈다. E2E는 병렬로 돈다(각 test가 격리된 userData·workspace로 자체 Electron을 띄우므로 안전) — 전체 스위트 벽시계가 크게 줄지만, 비싼 계층인 건 변함없어 개발 루프에서는 도메인 태그로 부분 실행한다.

| 시점 | 명령 | 범위 | 비용 |
|---|---|---|---|
| 매 기능 완료 | `make verify-feature tag=@<domain>` | typecheck + 단위 **전체** + 그 도메인 E2E만 | 낮음 |
| E2E 부분만 다시 | `make e2e-tag tag=@<domain>` | 해당 도메인 E2E만 | 낮음 |
| **배포 지시 받을 때** | `make pre-release` | verify-full + **전체 E2E** | 높음, 1회 |

- **개발 루프에서는 전체 E2E를 돌리지 않는다.** 여러 기능을 누적해 배포할 때 같은 전체 스위트를 반복 실행하던 낭비를 없앤다.
- **단위 테스트 전체는 항상 실행한다** (공짜에 가깝고, 도메인 경계를 넘는 회귀를 초 단위로 잡는 1차 안전망).
- **배포 게이트(`make pre-release`)는 절대 부분집합으로 낮추지 않는다.** 개발 루프에서 놓친 교차 회귀를 잡는 최종 안전망이므로, 여기서 타협하면 게이트가 게이트이길 멈춘다.
- 누적 폭이 커져 게이트 실패 시 원인 추적이 어려워지는 걸 막으려면 커밋을 작게 유지하고, 배포가 없어도 주 1회 정도 `make pre-release`를 선제적으로 돌린다.

## E2E 도메인 태그

모든 `test(...)`는 도메인 태그를 가진다 — `make verify-feature`/`e2e-tag`의 `--grep` 필터 기준이다.

```typescript
test('제목', { tag: ['@calendar', '@schedule'] }, async () => { /* ... */ });
```

- **고정 어휘 (10개)**: `@map` `@calendar` `@schedule` `@focus` `@todo` `@note` `@capture` `@command` `@nav` `@view`
- 한 spec은 여러 태그를 가질 수 있다 → `tag=@todo`로 돌리면 `@todo @map`인 `todo-node`, `@focus @todo`인 `focus-lifecycle`까지 함께 실행돼 "연관 기능"이 자연스럽게 딸려온다.
- **새 spec·새 test는 반드시 도메인 태그를 단다.** 태그 없는 test는 어떤 부분 실행에도 안 잡혀 개발 루프의 회귀 그물에 구멍이 난다(전체 `pre-release`에는 잡히지만 늦다). `make harness-check`의 `check-e2e-tags.mjs`가 미태깅·도메인 태그 누락·어휘 밖 태그를 실패 처리한다.
- 새 도메인이 필요하면 `scripts/harness/check-e2e-tags.mjs`의 `DOMAIN`과 이 표를 **먼저** 갱신한다.
- **수식 태그 `@serial`**: 도메인과 직교. frontmost(앱 활성화) 같은 OS 전역 자원에 의존해 병렬 실행이 불가능한 test에 도메인 태그와 **함께** 단다 (예: `{ tag: ['@view', '@serial'] }`). `scripts/e2e-run.mjs`가 나머지를 병렬로 돌린 뒤 `@serial`만 `workers=1`로 직렬 실행한다. `win.focus()`/`win.blur()`로 외부변경 새로고침을 트리거하는 테스트가 대표적.

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
- **병렬 실행이 기본이다.** `scripts/e2e-run.mjs`가 병렬(`workers` 기본 로컬 4/CI 2) → `@serial` 직렬 꼬리 2단계로 돌린다. 새 test는 병렬 안전해야 한다 — 파일 내 `test` 간 상태 공유 금지(각자 `launchApp()`으로 격리된 인스턴스를 띄운다), OS 전역 자원(전역 단축키·frontmost·클립보드) 의존 금지.
- **OS 전역 단축키는 E2E에서 기본 비활성**이다(`MINDMAP_DISABLE_GLOBAL_SHORTCUT`). 병렬 인스턴스가 `Alt+Space` 하나를 두고 경쟁하기 때문. 등록 자체를 검증해야 하는 test만 `launchApp({ globalShortcut: true })`로 opt-in하고, 그런 test는 유일해야 한다(둘 이상이면 서로 경쟁).
- `MINDMAP_USER_DATA`와 `MINDMAP_WORKSPACE` 환경변수로 실제 데이터와 격리한다 (`e2e/helpers.ts`의 `launchApp()` 사용).
- `launchApp()`은 `MINDMAP_E2E_QUIET=1`도 함께 설정 — Electron 창을 화면 밖(off-screen, x/y만 이동) 위치에 띄워 실행 중 화면을 가리지 않는다. `showInactive()`/포커스 불가 같은 트릭은 쓰지 않는다 — `win.focus()`가 실제로 창을 포커스시켜야 하는 `file-management.spec.ts`의 "regains focus" 테스트가 깨졌었다(CI에서 실제로 겪음). `CI` 환경변수가 있으면(GitHub Actions) 이 값을 끈다 — CI 러너에서는 어차피 화면을 가릴 사람이 없다. `make dev-safe`는 이 값을 설정하지 않는다 — 사람이 직접 보고 조작해야 한다.
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
