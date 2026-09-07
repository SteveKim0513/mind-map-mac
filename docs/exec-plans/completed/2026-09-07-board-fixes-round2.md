# 보드 오류 2차 개선 — 커넥터 구분·텍스트 겹침·백스페이스 삭제·실행취소·역참조

날짜: 2026-09-07
상태: completed

## 목표

사용자가 실사용 스크린샷 2건과 함께 보고한 5건(+자체 발견분)을 근본 원인부터 고친다.
v0.13.2에서 고친 11건과 이어지는 후속 라운드.

## 범위 (포함 / 제외)

포함: 아래 5건 + 코드 탐색으로 발견한 동일 클래스 버그(연결 라벨 입력 백스페이스 안전 확인,
커넥터 재연결 시 중복 방지).
제외: 커넥터에 색을 지정하는 UI(탐색 중 발견한 미완성 기능이지만 이번 요청과 무관 — 별도 결정),
`setTagLabel`을 호출하는 UI 배선(마찬가지로 무관, 기록만 남김).

## 현재 상태 · 원인 분석 (항목별)

### 1. 커넥터 경로가 겹쳐서 어느 연결인지 구분 안 됨

- `src/board/boardRouting.ts`의 `routeWaypoints()`는 (요소, 앵커사이드) 4개 입력에 대해
  순수 함수라, 같은 두 앵커를 잇는 커넥터가 둘 이상이면 경로가 **완전히 겹친다**.
- `BoardCanvasArea.tsx`의 드래그 연결 생성(`onPointerUp`의 `connect` 분기, 541-556행)과
  재연결(`reattach` 분기, 576-584행) 모두 **두 요소 사이에 이미 커넥터가 있는지 검사하지
  않는다** — 키보드 화살표 흐름(622-627행, `existing` 검사)만 기존 커넥터를 재사용한다.
- hover 시 강조하는 CSS도 없다(`styles.css:7062-7070`은 `.selected`만 강조).
- **수정 방향**: (a) 드래그 연결/재연결 시 같은 두 요소 사이에 커넥터가 이미 있으면 새로
  만들지 않고 기존 것을 선택(키보드 흐름과 동일하게 통일), (b) 커넥터 hover 시 시각적으로
  강조(`.selected`와 유사하되 더 약하게)해 마우스를 올려 어떤 연결인지 바로 알 수 있게 함.
  둘 다 board 도메인 내부 파일만 건드림 — 경계 이슈 없음.

### 2. 긴 텍스트가 노드/노트/링크 칩과 겹침

- `styles.css:6872-6878` `.board-el-text { flex: none; ...; overflow: hidden }` —
  `flex: none`(=flex-shrink:0)이라 텍스트 박스가 **절대 축소되지 않고** 항상 내용 높이
  그대로 커진다. `overflow: hidden`은 높이 제약이 없으니 아무것도 자르지 못한다. 그 결과
  아래 형제 `.board-sticky-links`(6898-6904행, 칩 행)와 시각적으로 겹친다.
- **수정 방향**: `.board-el-text`를 `flex: 0 1 auto; min-height: 0;`으로 변경 — 짧은
  텍스트는 지금처럼 내용 높이만 차지해(valign-top/middle/bottom 그대로 동작), 텍스트가
  칩 행을 포함한 사용 가능 공간을 넘어설 때만 축소되고 `overflow: hidden`이 실제로
  넘치는 줄을 잘라낸다. CSS 한 줄 수준의 국소 수정.

### 3. 백스페이스가 (링크 연결 중) 스티키 자체를 삭제

- `BoardCanvasArea.tsx:607-613`의 전역 `onKeyDown`(캔버스에 바인딩)이
  `if (editingTarget || editingLabelId) return;`만 가드하고, 그 뒤 `Backspace`/`Delete` +
  `selection.length`면 `removeElements(selection)`을 실행한다. 이 가드는 **링크 피커가
  열려 있는 상태(`linkPicker` state)를 전혀 모른다.**
- `BoardNodePicker.tsx:61-74`, `BoardNoteLinkPicker.tsx:65-77`의 검색 `<input>`은
  `onKeyDown`이 Escape/ArrowUp/ArrowDown/Enter만 처리하고 **다른 키(Backspace 포함)는
  `stopPropagation` 없이 그대로 버블링**한다 — 이전 세션에서 고친 pointerdown 버그와
  같은 클래스, 이번엔 keydown 버전.
- `BoardSelectionToolbar.tsx:201-214`의 외부 링크 입력(`.st-link-input`)도 동일 패턴 —
  Enter/Escape만 처리, stopPropagation 없음. 이 입력은 캔버스 가드가 아는 어떤 state와도
  연결돼 있지 않아 가장 취약하다.
- 링크 연결 시도 중이면 `selection.length`는 항상 1(피커가 열리는 조건 자체가
  `selection.length === 1`)이라 세 입력 표면(노드 피커·노트 피커·외부 링크 입력) 모두
  검색어에서 Backspace를 누르면 캔버스까지 버블링해 스티키가 삭제된다.
- **수정 방향**: 세 입력 모두 `onKeyDown` 최상단에서 `e.stopPropagation()` 호출(원래
  처리하던 Escape/ArrowUp/Down/Enter 로직은 그대로 유지, 그 앞에 추가). 이전 세션의
  pointerdown 수정과 정확히 같은 자리·같은 형태의 수정.
- 부가 발견: 커넥터 라벨 입력(`board-label-input`, `BoardCanvasArea.tsx:806-809`)은
  `editingLabelId`가 캔버스 가드에 걸려 우연히 안전하지만, 일관성을 위해 같은
  stopPropagation을 추가해 방어적으로 통일한다.

### 4. 보드에서 실행 취소(Undo)가 안 됨

- `src/store/boardStore.ts`에 `past`/`future`/`undo`/`redo`가 전혀 없다 — 모든 뮤테이션이
  스냅샷 없이 바로 `set()`.
- `App.tsx:242-281`(네이티브 메뉴 Cmd+Z → `onMenu('undo')`)의 `st = sess.activeStore()?.getState()`는
  **맵 탭에서만** 값을 반환하도록 고정돼 있어(`sessionStore.ts:278-281` `activeStore()`),
  보드 탭이 활성이면 `st`가 `undefined` → `st?.undo()`가 조용히 아무 일도 안 한다.
  `sessionStore.ts:288-291`에 이미 `activeBoardStore()`가 존재하므로 이걸 쓰면 된다.
- `src/store/mapStore.ts:245-256,1090-1140`의 기존 undo 구현(스냅샷 배열 + 되돌릴 때
  선택 복원)을 참고하되, 그대로 재사용은 불가 — **보드는 자유 드래그 캔버스라 위치 이동·
  리사이즈가 `onPointerMove`마다(초당 수십 번) `moveElements`/`updateElement`를 호출한다.**
  맵은 이런 연속 드래그 뮤테이션이 아예 없어(트리 레이아웃이라 자유 드래그 없음) 매
  액션마다 스냅샷을 찍어도 문제없지만, 보드에서 그대로 하면 드래그 한 번에 undo 스텝
  수십 개가 쌓인다.
- **설계**: `boardStore.ts`에 `past: BoardDoc[]`, `future: BoardDoc[]` 추가.
  - **한 번에 끝나는 액션**(`addElements`, `removeElements`, `updateElements`,
    `setElementPositions`, `bringToFront`, `sendToBack`, `setTagLabel`, `setNodeLink`,
    `setNoteLink`, 그리고 드래그 밖에서 호출되는 `updateElement`/`moveElements`)은
    자기 자신이 뮤테이션 직전 `get().board`를 `past`에 밀어넣고 `future`를 비운다 —
    이미 각 액션이 최상단에서 `const { board } = get()`로 이 스냅샷을 들고 있으므로
    (boardStore는 불변 스프레드로 새 객체를 만들기 때문에 이 참조 자체가 안전한
    스냅샷 — mapStore처럼 별도 `structuredClone` 불필요) 추가 비용이 거의 없다.
  - **연속 드래그**(이동·리사이즈)는 클로저 변수 `inTransaction`/`dragBaseline`으로
    감싼다: `beginDrag()`를 드래그 시작 시 1회 호출해 `dragBaseline = get().board`를
    잡고 `inTransaction = true`로 전환 — 이 동안 `moveElements`/`updateElement` 호출은
    (위 가드 덕분에) 자기 히스토리를 안 찍는다. `endDrag()`를 `onPointerUp`에서 1회
    호출 — `get().board !== dragBaseline`(실제로 뭔가 바뀐 경우만)일 때 `dragBaseline`을
    `past`에 밀어넣는다. 아무것도 안 움직인 클릭(드래그 없이 뗀 경우)은 히스토리에
    빈 스텝을 안 남긴다.
  - `BoardCanvasArea.tsx`에서 `beginDrag()`를 move 드래그 시작 지점(`onElementPointerDown`,
    현재 380행 부근에서 `dragRef.current = { mode: 'move', ... }` 대입 직전)과
    `beginResize()`(383-396행) 안에 추가. `onPointerUp`(527행)에 `d?.mode === 'move'`
    또는 `'resize'`일 때 `endDrag()`를 호출하는 분기를 새로 추가(현재 이 두 모드는
    onPointerUp에 아무 분기가 없다).
  - `undo`/`redo`는 mapStore 패턴을 단순화해 이식 — 되돌리며 사라졌던 요소가 복구되면
    그 요소들을 재선택(mapStore의 A6과 같은 느낌), 그 외엔 살아있는 선택만 유지.
  - `App.tsx:276-281`을 `st?.undo() ?? sess.activeBoardStore()?.getState().undo();`
    (redo도 동일)로 확장 — `sess.activeStore()`의 맵 전용 타입은 그대로 두고 이 두
    case만 국소적으로 확장(저장/찾기 등 다른 case는 맵 전용 필드(`doc`)에 의존하므로
    건드리지 않는다).

### 5. 보드 스티키 ↔ 노드/노트 역참조(backlink) 표시 없음

- 현재 `BoardStickyElement.nodeLink`/`noteLink`(스티키 → 노드/노트)는 단방향. 반대
  방향("이 노드/노트가 어느 보드에서 참조되는지")을 계산하는 인프라가 전혀 없다.
- 기존 유사 메커니즘(그대로 본뜬다): `src/store/workspaceStore.ts`의
  `noteIndex: NoteMeta[]`(8-11행 필드, `buildNoteIndex()`로 워크스페이스 스캔 시 구축,
  `refresh()`가 호출) + `notesForNode(mapId, nodeId)`(122-123행, 인덱스 필터링만) +
  `reindexNote()`(154행 부근, 노트 저장 시 upsert) — 노트→노드 backlink가 정확히 이
  패턴으로 이미 동작 중이다.
- **설계**: `workspaceStore.ts`에 병렬로 추가:
  - `boardIndex: BoardMeta[]` 필드. `BoardMeta = { path: string; nodeLinks: {mapId, nodeId}[]; noteLinks: string[] }`
    (새 타입, `types.ts`에 추가).
  - `buildBoardIndex(tree)` — `collectMdPaths`와 병렬로 `.board` 확장자 파일을 모아
    `io/boardFormat.ts`의 parse 함수로 읽고, 모든 sticky의 `nodeLink`/`noteLink`를 추출.
  - `refresh()`가 `noteIndex`와 같은 타이밍에 `boardIndex`도 함께 채운다.
  - `boardsForNode(mapId, nodeId)` / `boardsForNote(notePath)` 셀렉터 — `noteIndex`
    필터링과 같은 모양.
  - `reindexBoard(meta)` — 보드 저장 시 upsert. 호출 지점은 `note/noteLinks.ts`의
    `reindexFromNote`가 노트 저장 흐름에서 불리는 것과 같은 자리를 보드 저장 흐름에서
    찾아 대응(`board/boardLinks.ts` 또는 보드 자동저장 훅 — 구현 단계에서 정확한 호출
    지점 확인).
  - **역참조 열람 후 원래 보드로 이동하는 액션**: `board/boardLinks.ts`에 이미
    `openBoardSticky(boardPath, stickyId)`(88-106행)가 존재해 "보드를 열고 특정
    스티키를 선택"하는 로직을 완비하고 있다. 이 함수는 `useSession`/`useUi`/
    `window.api`/`BoardStore` 타입만 참조하고 board 도메인 UI에 의존하지 않으므로,
    **`board/boardLinks.ts`에서 `store/workspaceStore.ts`(혹은 신설 `store/boardBacklinks.ts`)로
    옮겨** canvas/note 양쪽에서 도메인 경계 위반 없이 재사용한다(`board/`가 이 함수를
    쓰던 기존 호출부는 import 경로만 store/로 바꾸면 됨 — 로직 변경 없음).
  - UI: `src/canvas/NodeView.tsx`의 기존 `gchip note`(297행 부근, "이 노드에 연결된
    노트" 칩) 옆에 `gchip board`를 추가 — `boardsForNode`가 1개 이상 반환하면 노출,
    클릭 시 (옮긴) `openBoardSticky` 호출. `src/note/NotePane.tsx`의 `.note-backlinks`
    섹션(84-88, 316-325행 부근)에 같은 방식으로 보드 역참조 항목을 추가.
  - **동기화**: 스티키 쪽에서 링크를 걸거나 해제하면(`setNodeLink`/`setNoteLink`) 다음
    보드 저장 시 `reindexBoard`가 다시 돌아 인덱스가 갱신된다 — 노트 인덱스와 동일한
    "저장 시점 갱신" 신선도(실시간 아님, 기존 관례와 동일).

## 가정

- 5번의 역참조 인덱스는 노트 인덱스와 같은 신선도(워크스페이스 refresh + 저장 시
  갱신)로 충분하다 — 보드가 열려 있는 동안 실시간 반영까지는 요구하지 않는다.
- 1번은 "완전히 같은 두 앵커 사이 중복 커넥터 방지 + hover 강조"로 충분하다고 가정 —
  스크린샷의 증상(두 커넥터를 구분하기 어려움)이 대부분 이 케이스에서 발생한다고 보고,
  일반적인 다중 커넥터 오프셋 라우팅 알고리즘까지는 만들지 않는다(과설계 방지).

## 위험

- 4번(undo)은 `BoardCanvasArea.tsx`의 드래그 상태 기계에 `beginDrag`/`endDrag` 호출을
  정확한 지점에 넣어야 한다 — 놓치면 "드래그 한 번에 undo 스텝 수십 개" 또는 "undo가
  드래그를 전혀 못 되돌림" 둘 중 하나로 조용히 회귀한다. 유닛 테스트로 "드래그(연속
  moveElements 호출) 후 undo 1번으로 드래그 시작 위치까지 정확히 복귀"를 반드시 검증.
- 5번은 새 인덱스 필드 + 저장 훅 확장이라 AGENTS.md 기준 "새 store 구조 변경"에 해당 —
  이 계획 문서가 그 사전 승인 역할을 한다.
- 3번 수정(각 입력에 stopPropagation 추가)이 피커의 다른 정상 동작(Enter로 선택,
  Escape로 닫기)과 충돌하지 않는지 확인 — stopPropagation은 버블링만 막고 그 입력
  자신의 핸들러 실행은 그대로이므로 충돌 위험 낮음.

## 구현 단계
<!-- 상태 마커: [ ] pending · [>] in-progress · [x] completed · [!] blocked · [e] error -->
- [x] 1. sticky-text-overflow-fix — `.board-el-text`를 `flex: 0 1 auto; min-height: 0`으로 (styles.css) → 완료
- [x] 2. link-input-backspace-fix — BoardNodePicker/BoardNoteLinkPicker/BoardSelectionToolbar(.st-link-input)/board-label-input의 onKeyDown에 stopPropagation 추가 → 완료, 픽스 되돌려서 회귀 실제 재현 확인함
- [x] 3. connector-dedupe-and-hover — 드래그 연결·재연결 시 기존 커넥터 재사용(중복 방지), hover 강조 CSS 추가 → 완료 (`findConnectorBetween` 헬퍼)
- [x] 4. board-undo-redo — boardStore.ts에 past/future + undo/redo + beginDrag/endDrag, BoardCanvasArea.tsx에 배선, App.tsx undo/redo case를 activeBoardStore로 확장 → 완료, 드래그 한 번 = undo 한 스텝 유닛 테스트로 검증
- [x] 5. board-backlinks — types.ts에 BoardMeta 추가, workspaceStore.ts에 boardIndex/boardsForNode/boardsForNote/reindexBoard, openBoardSticky를 store/로 이동, NodeView.tsx·NotePane.tsx에 역참조 칩 추가 → 완료
- [x] 6. verify — make verify-full 통과(typecheck+test 337건+build), 신규 유닛 테스트(undo 드래그 시나리오 7건, backlink 인덱스 5건), e2e 신규 6건(board-fixes-round2.spec.ts), make e2e-tag tag=@board 전체 통과 → 완료
- [x] 7. docs — FEATURE-INVENTORY.md(§17 보드, undo/역참조/버그수정 5건 반영, "undo 대상 아님" 문구 제거)/Manual.tsx(보드·노트 섹션) 갱신, 계획을 completed로 이동 → 완료

## 검증 방법

- `make verify`(typecheck+test) 각 단계마다, 마지막에 `make verify-full`.
- undo는 특히 **드래그(연속 이동) 후 undo 1번으로 시작 위치 정확히 복귀** 유닛/E2E 테스트로
  좌표 레벨 검증(맵스토어의 실수 방지 교훈 재사용).
- 백스페이스 버그는 실제 좌표 클릭으로 피커를 연 뒤 검색어 입력 중 Backspace를 눌러
  스티키가 안 삭제되는지 E2E로 검증(이전 세션 pointerdown 버그와 같은 방식 — 키보드
  단축키 우회 경로 말고 실제 상호작용 경로로).
- 역참조는 스티키에서 노드/노트 연결 → 저장 → 그 노드/노트 쪽 UI에 칩이 뜨는지, 칩
  클릭 시 보드로 돌아가 해당 스티키가 선택되는지, 연결 해제 후 저장하면 칩이 사라지는지
  E2E로 검증.
- `make dev-safe`로 5건 전부 실제 앱에서 육안 확인(라이트/다크 모두).

## 발견한 사실 (작업 중 갱신)
- boardStore.ts는 이미 각 액션이 `const { board } = get()`로 뮤테이션 직전 상태를
  들고 있고 모든 뮤테이션이 불변 스프레드라, mapStore처럼 `structuredClone`으로 별도
  스냅샷을 뜰 필요가 없었다 — 그 참조 자체가 안전한 히스토리 항목이었다.
- undo/redo는 이 프로젝트에 E2E 커버리지 선례가 전혀 없었다(mapStore도 유닛 테스트로만
  검증) — 같은 관례를 따라 board의 드래그-트랜잭션 undo도 유닛 테스트로 검증하고 별도
  E2E는 추가하지 않았다.
- `openBoardSticky`를 `board/boardLinks.ts`에서 `store/workspaceStore.ts`로 옮기는
  과정에서 기존 함수를 지우지 않고 재-export만 추가해 "exported variable 재선언" 타입
  오류가 났다 — 원본 정의를 실제로 삭제해야 했다.
- 백스페이스 버그 수정 E2E는 되돌린 뒤 실제로 타임아웃(스티키가 삭제되며 피커도 함께
  사라져 이후 단언이 절대 안 풀림)으로 재현을 확인한 뒤 복구 — 거짓 통과가 아님을 검증.
- Manual.tsx에서 JSX 속성 문자열 안에 이스케이프한 큰따옴표(`\"...\"`)를 쓰면 안 됨 —
  이 파일의 기존 관례대로 작은따옴표를 썼다(타입체크가 아니라 vite/tsc 파서 에러로
  잡혔다 — `npm run build`가 typecheck보다 이런 문법 오류를 더 먼저 잡아준 사례).

## 결정 변경 이력
(없음 — 계획대로 5건 모두 구현)
