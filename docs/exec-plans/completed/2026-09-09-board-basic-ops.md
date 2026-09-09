# 보드 기본 조작 4종 — 잘라내기 · 전체선택 · 우클릭 복제 · 다중 z-order

날짜: 2026-09-09
상태: completed

## 목표

보드(Board) 캔버스에 아직 없는 4가지 기본 조작을 추가한다: ⌘/Ctrl+X(잘라내기),
⌘/Ctrl+A(전체 선택), 우클릭 컨텍스트 메뉴의 "복제", 다중 선택 상태에서의 z-order(맨 앞으로/맨
뒤로). 방향키 넛지(미세 이동)는 명시적으로 범위 밖 — 기존 방향키가 "연결된 이웃으로
이동/자식 생성"이라는 그래프 탐색 단축키로 이미 쓰이고 있어 충돌한다. 이미 구현된 ⌘C/⌘V
복사/붙여넣기(`docs/exec-plans/completed/2026-09-09-board-copy-paste.md`)의 패턴(모듈 레벨
클립보드, 새 id 재발급, 연결된 커넥터 포함, undo/redo 자동 편입)을 최대한 재사용한다.

## 범위 (포함 / 제외)

**포함**
- `src/store/boardStore.ts`: `cutElements`(copyElements+removeElements 재사용),
  `selectAll`(스티키/이미지 전체 선택, 커넥터 제외), `duplicateElements`(copyElements+
  pasteElements 재사용) 액션 추가. `bringToFront`/`sendToBack` 시그니처를 `string[]`로
  바꿔 다중 선택을 상대 순서 보존하며 함께 이동.
- `src/board/BoardCanvasArea.tsx`의 `onKeyDown`에 ⌘/Ctrl+X, ⌘/Ctrl+A 분기 추가(기존
  `editingTarget || editingLabelId` 가드 재사용).
- 신규 `src/board/BoardContextMenu.tsx` — 보드 엘리먼트 우클릭 메뉴(복제 + 삭제). 기존
  `src/menu/ContextMenu.tsx`(마인드맵 전용, addChild/setTodo/schedule 등 마인드맵에만
  있는 액션 다수)를 일반화하는 대신 board 도메인 전용의 얇은 컴포넌트로 분리 — 공유는
  `useDismissablePosition`(ui/)과 전역 CSS 클래스(`.ctx-menu`/`.ctx-item`, styles.css)
  수준에서만 한다. `panes/TabBar.tsx`의 로컬 상태 우클릭 메뉴 패턴(useState + 동일 훅)을
  그대로 따른다.
- `src/board/BoardElementView.tsx`에 `onContextMenu` prop 추가, 루트 `.board-el` div에 연결.
- `src/board/BoardToolbar.tsx`의 z-order 버튼 `disabled` 조건을 `selection.length !== 1`
  → `selection.length === 0`으로 완화.
- `src/store/boardStore.test.ts`, `e2e/board-basics.spec.ts`에 4개 기능 각각 최소 1건.
- `docs/product/FEATURE-INVENTORY.md` §17, `src/ui/Manual.tsx` 보드 섹션 갱신.

**제외**
- 방향키 nudge(미세 이동) — 사용자 명시적 제외.
- `electron/main.ts`의 Edit 메뉴(`role: 'cut'`/`role: 'selectAll'`) 변경 — 1차 시도는
  렌더러 로컬 keydown만으로 진행(⌘C/⌘V가 role: 'copy'/'paste'와 이미 공존 검증됨). 실제
  `make dev-safe quiet=1` 검증 중 네이티브 동작과의 충돌이 관찰되면 그때 변경하고 이유를
  기록한다.
- OS 클립보드 연동, 다른 앱 인스턴스 간 잘라내기/붙여넣기.
- 커넥터(화살표) 자체의 우클릭 복제 — "보드 엘리먼트(스티키/이미지)"로 범위 한정.

## 현재 상태

- `boardStore.ts`에 `copyElements`/`pasteElements`/`hasClipboard`(모듈 레벨 클립보드)가
  이미 구현되어 있음(완료된 계획 참고). `removeElements`는 커넥터 cascade 삭제를 이미 처리.
  `bringToFront`/`sendToBack`은 단일 id만 받음(275-293행).
- `BoardCanvasArea.tsx`의 `onKeyDown`(674-719행)은 Delete/Backspace/Escape/⌘C/⌘V/방향키
  /Enter만 처리. 우클릭 핸들러 없음.
- `BoardToolbar.tsx`(118-123행)의 z-order 버튼은 `selection.length !== 1`일 때 비활성화.
- `src/menu/ContextMenu.tsx`는 `useMap`/`mapStore` 전용 — board와 공유하려면 모든 액션을
  kind 체크로 감싸야 해서 이득 없이 복잡도만 늘어남. `panes/TabBar.tsx`가 이미 로컬
  `useState` + `useDismissablePosition` 패턴으로 독립 우클릭 메뉴를 구현한 선례가 있음.
- `electron/main.ts`(112-120행): Edit 메뉴에 undo/redo/find는 커스텀 `send('menu', ...)`
  패턴, cut/copy/paste/selectAll은 `role:` 방식. copy/paste(role)가 렌더러의 자체 keydown
  핸들러와 공존해 정상 동작한 전례가 있음(이미 완료된 복사/붙여넣기 작업에서 E2E로 검증).

## 가정

- `copyElements()`는 `set()`을 호출하지 않아(클립보드는 store state가 아닌 모듈 변수) history
  에 전혀 관여하지 않는다 — 따라서 `cutElements = () => { copyElements(); removeElements(sel) }`
  는 `removeElements`의 단일 history push만으로 자동으로 "undo 한 스텝"이 된다. 별도
  `beginTransaction`/`endTransaction` 없이도 요구사항(가능하면 한 스텝)을 충족.
- `selectAll`은 커넥터를 제외한 박스 엘리먼트(스티키/이미지)만 선택한다 — 선택 툴바/z-order
  등 기존 UI가 "선택 = 박스 엘리먼트" 가정을 곳곳에서 하고 있어(예: `toolbarElements` 계산)
  커넥터까지 섞으면 그 UI들이 깨진다.
- `duplicateElements`는 새 클론 로직을 만들지 않고 기존 `copyElements`+`pasteElements`를
  그대로 호출 — 부작용으로 사용자의 기존 클립보드(⌘C로 복사해둔 것)를 덮어쓰지만, 이는
  위임 명세가 명시적으로 지시한 동작("copyElements + pasteElements와 동일하면 된다")이라
  허용.

## 위험

- `bringToFront`/`sendToBack`의 시그니처를 `string`→`string[]`로 바꾸면 기존 호출부
  (BoardToolbar.tsx 2곳)와 기존 단위 테스트(2건)가 타입 에러 — 모두 함께 갱신해야 `make
  verify` 통과.
- ⌘A/⌘X가 `electron/main.ts`의 `role: 'selectAll'`/`role: 'cut'`과 충돌해 텍스트 필드가
  아닌 곳에서도 네이티브 동작(페이지 텍스트 하이라이트 등)이 겹쳐 발생할 가능성 — 렌더러
  가드(`editingTarget || editingLabelId`)는 보드 캔버스에 포커스가 있을 때만 적용되므로,
  노트 에디터/제목 입력 등 다른 포커스 컨텍스트에서는 원래 네이티브 동작이 그대로 유지됨을
  별도로 확인해야 함.
- 우클릭 컨텍스트 메뉴가 뜬 상태에서 배경 클릭/Escape로 닫히는 기존 `useDismissablePosition`
  동작이 보드 캔버스의 자체 pointerdown(마퀴 선택 시작 등)과 충돌하지 않는지 확인 필요.

## 구현 단계

<!-- 상태 마커: [ ] pending · [>] in-progress · [x] completed · [!] blocked · [e] error -->
- [x] 0. research — boardStore.ts/BoardCanvasArea.tsx/BoardToolbar.tsx/BoardElementView.tsx/
      ContextMenu.tsx/TabBar.tsx/electron main.ts 확인. → 위 "현재 상태"에 기록.
- [x] 1. store-actions — `boardStore.ts`에 `cutElements`/`selectAll`/`duplicateElements`
      추가, `bringToFront`/`sendToBack`을 `string[]`로 변경. → 구현 완료, 아래 "발견한 사실"
      참고.
- [x] 2. keyboard — `BoardCanvasArea.tsx`의 `onKeyDown`에 ⌘/Ctrl+X, ⌘/Ctrl+A 분기 추가.
      → 구현 완료.
- [x] 3. context-menu — `BoardContextMenu.tsx` 신설, `BoardElementView.tsx`에 `onContextMenu`
      prop 추가, `BoardCanvasArea.tsx`에 우클릭 핸들러 + 로컬 상태 + 렌더 배선. → 구현 완료.
- [x] 4. toolbar-zorder — `BoardToolbar.tsx` disabled 조건 완화 + 다중 id 전달. → 구현 완료.
- [x] 5. unit-tests — `boardStore.test.ts`에 cut/selectAll/duplicate/다중 z-order 테스트
      추가. → 구현 완료.
- [x] 6. e2e-tests — `e2e/board-basics.spec.ts`에 `@board` 태그 E2E 4건 추가. → 구현 완료.
- [x] 7. docs — FEATURE-INVENTORY.md §17, Manual.tsx 보드 섹션 갱신. → 구현 완료.
- [x] 8. verify — `make verify`, `make verify-feature tag=@board`, `make dev-safe quiet=1`
      런타임 확인(⌘A/⌘X가 텍스트 필드의 네이티브 동작을 깨지 않는지 포함), `make
      harness-check`. → 결과를 "발견한 사실"에 기록.

## 검증 방법

1. `make verify` 종료 코드 0.
2. `make verify-feature tag=@board` 종료 코드 0.
3. `make dev-safe quiet=1` — 격리된 인스턴스에서 4개 기능 실제 동작 확인, 특히 노트
   에디터/제목 입력에서 기존 ⌘A/⌘X 네이티브 동작이 그대로인지 확인.
4. `make harness-check` 종료 코드 0.

## 발견한 사실 (작업 중 갱신)

(작업 진행하며 갱신)

## 결정 변경 이력

(없음)
