# 보드 스티키/엘리먼트 복사·붙여넣기

날짜: 2026-09-09
상태: completed

## 목표

보드(Board) 캔버스에서 선택한 스티키노트·이미지·화살표(커넥터)를 ⌘/Ctrl+C로 복사하고
⌘/Ctrl+V로 붙여넣을 수 있게 한다. 현재 전역 키보드 핸들러(`src/interactions/useKeyboard.ts`)는
마인드맵 store에만 연결돼 있어 보드 탭에서는 복사/붙여넣기가 아예 동작하지 않는다(처음부터
미구현 — 회귀 아님). 마인드맵 노드의 기존 복사/붙여넣기(`mapStore.ts`의 `copyNode`/`pasteNode`)
패턴을 참고하되, 보드는 트리가 아닌 절대좌표 자유배치 캔버스이므로 오프셋 배치 방식을 새로
설계한다.

## 범위 (포함 / 제외)

**포함**
- `src/store/boardStore.ts`에 클립보드 상태(모듈 레벨, 탭 간 공유) + `copyElements()` /
  `pasteElements()` 액션.
- `src/board/BoardCanvasArea.tsx`의 `onKeyDown`에 ⌘/Ctrl+C, ⌘/Ctrl+V 분기 추가 — 텍스트 편집
  중(`editingTarget`/`editingLabelId`)에는 가로채지 않음(기존 가드 재사용).
- 선택된 엘리먼트 + 양끝 모두 선택된 커넥터를 함께 복사.
- 붙여넣기는 새 id 발급 + 오프셋 배치 + 새 선택 상태로 설정, undo/redo에 기록.
- `src/store/boardStore.test.ts` 단위 테스트.
- `e2e/*.spec.ts`에 `@board` 태그 E2E 1건 이상.
- `docs/product/FEATURE-INVENTORY.md` §17, `src/ui/Manual.tsx` 보드 섹션 갱신.

**제외**
- 마인드맵 노드(`mapStore.ts`)의 기존 복사/붙여넣기 로직 변경 — 참고만 함.
- OS 클립보드(시스템 클립보드) 연동 — 마인드맵과 동일하게 앱 내부 모듈 변수로만 유지.
- 보드 엘리먼트에 리마인더 연동 필드 신설 — 원래 없으므로 추가하지 않음(아래 "발견한 사실"
  참고).
- 다른 보드/다른 앱 인스턴스 간 복사·붙여넣기.

## 현재 상태

- `useKeyboard.ts`(31-44행)는 `useSession.activeStore()`가 `null`이면(보드/노트 탭) 즉시
  return — 마인드맵 전용.
- `BoardCanvasArea.tsx`의 `onKeyDown`(671-698행)은 Delete/Backspace/Escape/방향키/Enter만
  처리, ⌘/Ctrl+C/V는 없음.
- `boardStore.ts`(369줄)에 클립보드 관련 상태·액션 없음.
- `mapStore.ts`는 모듈 레벨 `let clipboard: ClipNode | null`(42행)에 subtree를 저장하고,
  `copyNode`/`pasteNode`(795-858행)로 트리 구조를 순회. 오프셋 개념 없음(트리 paste는 대상
  노드의 자식으로 삽입).

## 가정

- 보드 엘리먼트는 절대좌표라 붙여넣기는 "원본 대비 오프셋 배치"가 자연스럽다(트리 paste와
  다른 UX). 첫 붙여넣기는 +20,+20, 같은 클립보드로 연속 붙여넣기하면 오프셋이 20px씩
  누적(디자인 도구의 일반적인 relative-paste 관례) — 겹쳐 붙는 것을 방지.
- 클립보드는 마인드맵과 동일하게 모듈 레벨 변수로 보드 탭 간(멀티 보드 탭) 공유한다 — 한
  보드에서 복사해 다른 보드에 붙여넣기가 가능해야 자연스러움.

## 위험

- `addElements`는 마지막 엘리먼트 1개만 선택 상태로 만드는 기존 동작이라, 붙여넣기는 여러
  엘리먼트를 모두 선택 상태로 만들어야 하므로 `addElements`를 재사용하지 않고 유사 로직을
  직접 구현 — 기존 `addElements` 동작(단일 선택)에 영향 없어야 함.
- 커넥터의 `fromId`/`toId`가 복사 시점의 id를 그대로 들고 있으면 붙여넣기 후 원본 엘리먼트를
  가리키게 되는 버그 — id 리매핑 필수.
- undo 히스토리 스택(`historyPatch`)이 트랜잭션 중(`inTransaction`)에는 스킵되는데, paste는
  트랜잭션 밖에서 호출되므로 기존 `addElements`/`removeElements`와 동일하게 자동으로 undo
  스텝이 쌓여야 함 — 확인 필요.

## 구현 단계

- [x] 0. research — boardStore.ts, types.ts(BoardElement), mapStore.ts copy/paste 패턴,
      BoardCanvasArea.tsx onKeyDown/selection 확인. 리마인더 필드는 MindNode 전용(`reminderOn`
      등, types.ts 33-39행)이고 BoardStickyElement/BoardImageElement/BoardConnectorElement에는
      없음을 확인 → 제거 로직 불필요, 근거를 최종 보고에 남김.
- [x] 1. board-store-clipboard — `boardStore.ts`에 모듈 레벨 클립보드 변수 +
      `copyElements`/`pasteElements`/`hasClipboard` 액션 추가, `BoardState` 인터페이스에
      타입 선언. → `PASTE_OFFSET_STEP=20`, id 리매핑용 `Map`, 커넥터는 양끝 id가 모두
      클립보드에 있을 때만 리매핑해 포함.
- [x] 2. board-canvas-keydown — `BoardCanvasArea.tsx`의 `onKeyDown`에 ⌘/Ctrl+C, ⌘/Ctrl+V
      분기 추가 (텍스트 편집 가드 재사용, 토스트로 피드백). → 기존
      `editingTarget || editingLabelId` 가드 아래에 추가해 인라인 편집 중엔 네이티브 복사/
      붙여넣기를 가로채지 않음. `hasClipboard()`로 빈 클립보드 붙여넣기 방지.
- [x] 3. unit-tests — `boardStore.test.ts`에 copy/paste 단위 테스트(신규 id, 오프셋 누적,
      커넥터 포함/제외, undo). → 6개 테스트 추가(33/33 통과). 모듈 레벨 클립보드가 파일 내
      테스트 간 공유되는 문제를 발견해 "빈 선택 no-op" 테스트를 describe 블록 맨 앞으로
      재배치해 해결(주석으로 이유 남김).
- [x] 4. e2e-test — `@board` 태그 E2E 2건: 단일 스티키 복사/붙여넣기(오프셋·선택·연속 붙여넣기),
      연결된 두 스티키 함께 복사(커넥터 포함) → `e2e/board-basics.spec.ts`에 추가. 구현 중
      스티키 재선택 클릭이 400ms 더블클릭 감지 창 안에 들어가 편집 모드로 오인식되는 기존
      패턴(`board-power-features.spec.ts`의 "clear the 400ms double-click window" 관례)을
      그대로 적용해 해결.
- [x] 5. docs — FEATURE-INVENTORY.md §17, Manual.tsx 보드 섹션 갱신. → 두 파일 모두 반영.
- [x] 6. verify — `make verify`(0), `make verify-feature tag=@board` 자체는 무관한 동시
      작업 파일(`e2e/_repro-scratch.spec.ts`, 아래 참고)로 인해 실패했으나 그 파일을 제외하면
      54/54 통과 확인. `make dev-safe quiet=1` 방식 런타임 확인은 vite-plugin-electron이
      자체적으로 Electron을 기동해 외부 Playwright가 CDP로 붙일 표준 경로가 없어, 같은 live
      dev 서버(`VITE_DEV_SERVER_URL`)를 가리키는 별도 격리 Electron 인스턴스를 직접 띄워
      동일 효과로 검증(스크린샷 확보, 콘솔 에러 0건, 오프셋 정확히 +20/+20, 토스트 2건 확인).
      `make harness-check`(0).

## 검증 방법

1. `make verify` (typecheck + 단위 테스트 전체) 종료 코드 0.
2. `make verify-feature tag=@board` 종료 코드 0.
3. `make dev-safe quiet=1` — Playwright로 보드 탭에서 스티키 선택 → ⌘C → ⌘V 실제 동작 확인.
4. `make harness-check` 종료 코드 0.

## 발견한 사실 (작업 중 갱신)

- `types.ts`를 확인한 결과 `reminderOn`/`reminderId`/`reminderSyncedAt`/`reminderBase`는
  `MindNode`(11-39행)에만 존재하고, `BoardStickyElement`/`BoardImageElement`/
  `BoardConnectorElement`(213-279행)에는 그런 필드가 전혀 없다. 따라서 AGENTS.md의
  reminder 불변조건(복사·붙여넣기 시 reminder 필드 제거)은 보드 엘리먼트에는 적용 대상이
  아니며, 새로 그런 로직을 추가하지 않는다(작업 지시의 금지 사항과도 일치).
- `mapStore.ts`의 클립보드는 모듈 레벨 `let clipboard`(리액트 상태 밖) — 보드도 동일 패턴을
  따르면 여러 보드 탭(`createBoardStore()`로 인스턴스화되는 store) 사이에서 클립보드를
  공유할 수 있다. `boardStore.ts`의 `inTransaction`/`transactionBaseline`은 반대로
  `createBoardStore()` 클로저 내부(인스턴스별)라 이 패턴과 구분해서 유지.
- `BoardCanvasArea.tsx`의 `onKeyDown`은 이미 `editingTarget || editingLabelId` 가드로 인라인
  텍스트 편집 중 키를 캔버스 단축키로 가로채지 않는 패턴을 갖고 있음 — 새 C/V 분기도 이 가드
  아래에 추가하면 됨.

- `make verify-feature tag=@board` 실행 시 워킹트리에 이 작업과 무관한 `e2e/_repro-scratch.spec.ts`
  (임시 디버그 스펙, `@board` 태그, 30초 타임아웃으로 실패)와 `e2e/board-text-edit-completeness.spec.ts`
  수정본이 이미 존재했다 — 다른(동시 진행 중인) 작업의 산물로 보이며 이 위임 범위 밖이라 건드리지
  않았다. `--grep-invert "scratch repro"`로 그 파일만 제외하고 돌리면 54/54 전부 통과 — 이 작업의
  구현·테스트 자체는 정상이라는 근거.
- 보드 스티키를 재선택하는 자동화 클릭이 직전 더블클릭(텍스트 편집 진입)의 400ms 감지 창 안에서
  발생하면 편집 모드로 오인식된다 — 실제 사용자에게는 자연스러운 동작(빠른 두 번 클릭은 진짜
  더블클릭)이지만, 헤드리스 자동화는 타이핑·클릭 사이 지연이 사람보다 훨씬 짧아 우연히 그 창에
  걸린다. `board-power-features.spec.ts`가 이미 `waitForTimeout(450)`으로 이 문제를 우회하는
  기존 관례를 갖고 있어 그대로 재사용.

## 결정 변경 이력

(없음)
