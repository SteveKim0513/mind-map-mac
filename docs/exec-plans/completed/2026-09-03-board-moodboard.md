# 보드(무드보드) — 세 번째 파일 타입 구현
날짜: 2026-09-03
상태: completed

## 목표

`.board` 확장자를 가진 자유배치 무드보드를 `.mind`/`.md`와 나란한 세 번째 파일 타입으로
구현한다. 텍스트 블록/스티키노트/이미지/도형(사각형·타원)/연결선을 절대좌표로 배치·이동·
리사이즈·삭제·z-order 조정할 수 있고, 로컬 파일로 저장·재로드된다.
명세: [docs/product/specs/2026-09-03-board-moodboard.md](../../product/specs/2026-09-03-board-moodboard.md)
결정: [docs/decisions/0020-board-file-type.md](../../decisions/0020-board-file-type.md)

## 범위 (포함 / 제외)

포함: 타입/포맷/스토어, `src/board/` 도메인 모듈(렌더링·드래그·리사이즈·선택·툴바), 사이드바·탭·
App.tsx 통합, 이미지 자산(기존 IPC 재사용), electron/main.ts 확장자 분기 확장, 하네스 `@board`
도메인 태그 등록, E2E 핵심 시나리오, 문서 갱신(FEATURE-INVENTORY/ARCHITECTURE/Manual).

제외: 실시간 협업, 프레임/프레젠테이션 모드, 손글씨, 노드↔보드 링크, 정교한 커넥터 라우팅
(명세 §3 그대로).

## 현재 상태

명세·ADR 작성 완료. 코드베이스 컨벤션 조사 완료(io 포맷/store/도메인모듈/사이드바/탭관리/
electron IPC/문서 템플릿/하네스 태그). 구현 착수 전.

## 가정

- 이미지는 노트와 동일하게 `.{stem}.assets/` 히든 폴더 + `images:write`/`images:read` IPC를
  그대로 재사용한다(새 IPC 불필요).
- undo는 이번 v1에서 도메인 전용 스택 없이 브라우저 네이티브 되돌리기 수준을 넘지 않아도 되며,
  필요 시 후속 작업으로 store 액션 기반 undo를 추가한다(명세 4번 항목의 "구현 단계에서 판단"에
  따름 — 이번 계획에서는 최소 삭제 확인 다이얼로그로 실수 방지만 다룬다).
- 스냅 가이드는 단순 임계값 기반(다른 요소의 가장자리/중심과 N px 이내면 흡수)으로 충분하다.

## 위험

- `electron/main.ts`의 `.mind`/`.md` 하드코딩 지점이 많아(버전 검증, 트리 워커, rename,
  trash/restore 컴패니언 폴더) 일부 놓치면 보드 파일의 trash/restore나 rename 시 자산 폴더가
  고아가 될 수 있다 → 각 지점을 grep으로 재확인 후 수정.
- `sessionStore.ts`/`TabBar.tsx`의 기존 2-way 삼항연산자를 3-way로 바꾸는 과정에서 기존
  맵/노트 동작을 깨뜨릴 위험 → 각 단계 후 `make verify` + 기존 E2E(@map, @note) 회귀 확인.
- 하네스 `check-e2e-tags.mjs`의 `DOMAIN` 갱신을 빼먹으면 `@board` E2E가 `make harness-check`에서
  거부됨 → 태그 추가를 E2E 작성보다 먼저 수행.

## 구현 단계

<!-- 상태 마커: [ ] pending · [>] in-progress · [x] completed · [!] blocked · [e] error -->

- [x] 0. types-and-io — `src/types.ts`에 `BoardDoc`/`BoardElement`(text/sticky/image/shape/
  connector 유니언, version:1) 추가. `src/io/boardFormat.ts` 신설: `emptyBoard()`,
  `serializeBoard()`, `parseBoard()`(구조 검증 + 결손 필드 backfill, `formats.ts`의
  deserialize 패턴 그대로). `src/io/boardFormat.test.ts` 단위 테스트(빈 보드 round-trip,
  손상 JSON 에러, 구버전 필드 backfill). → order는 z-order 배열(back→front), element별 `z`
  필드 없이 배열 인덱스로 관리. 7/7 테스트 통과
- [x] 1. board-store — `src/store/boardStore.ts` 신설: `createBoardStore()`(Zustand vanilla
  `createStore`), `BoardContext`/`useBoardStore`/`useBoard`(noteStore.ts와 동일 shape:
  `board`, `filePath`, `dirty`, `loadBoard`, `markSaved`, `setFilePath` + 요소 CRUD 액션
  `addElement/updateElement/removeElement/reorderElement/setSelection`). `boardStore.test.ts`
  단위 테스트(액션별 dirty 플래그, 불변성). → `BoardElementPatch` 플랫 유니언 타입으로
  `Partial<BoardElement>` keyof 교집합 함정 회피. selection은 store 상태이나 dirty 미설정
  (ephemeral). 18/18 테스트 통과, typecheck 통과
- [x] 2. session-wiring — `src/store/sessionStore.ts`: `TabKind`에 `'board'` 추가, `Tab.store`
  유니언에 `BoardStore` 추가, `isBoardPath(path)`(`.board` 체크) export, `makeTab()`에 board
  분기 추가, `flushTab()`에 board 분기 추가, `activeBoardStore()` 추가.
  → `reloadIfOpen`/`base()`/`closeTab` dirty 체크도 board 인식하도록 갱신. 타입 전파로
  `TabBar.tsx`(`TabDirty` 유니언, 아이콘/제목 헬퍼함수화)와 `Icon.tsx`(`board` 아이콘 추가)도
  함께 수정 — 계획 5단계 일부 선반영. typecheck 통과, 290/290 테스트 통과(회귀 없음)
- [x] 3. board-domain-ui — `src/board/` 신설: `BoardPane.tsx`(NotePane.tsx 구조 복제 — Context
  Provider, 1초 디바운스 autosave, 삭제 레이스 가드), `BoardCanvasArea.tsx`(요소 렌더링, 드래그
  이동, 리사이즈 핸들, 다중 선택 러버밴드, z-order, connector 엔드포인트 드래그),
  `BoardElementView.tsx`(타입별 렌더 — text/sticky/image/shape; connector는 별도 SVG 오버레이),
  `BoardToolbar.tsx`(요소 추가 버튼, 맨앞/맨뒤, 삭제, 줌/맞춤), `boardGeometry.ts`(bbox 공유
  유틸). "canvas"라는 컴포넌트/파일명은 기존 `src/canvas/`와 겹쳐서 피함. `styles.css`에 보드
  섹션 추가(`--state-board` 토큰, 신규 `board/rectShape/ellipseShape/connector` 아이콘 3종).
  스냅 가이드는 시간 제약으로 v1 범위에서 제외(마퀴 선택·리사이즈·커넥터로 핵심 조작 충분).
  → 디자인 하네스 통과(경고 10건은 기존 pre-existing), typecheck·전체 단위테스트 통과
- [x] 4. image-assets — 보드에 이미지 삽입(파일 선택) 시 기존 `images:write` IPC로
  `.{stem}.assets/`에 저장하고 상대경로를 `image` 요소에 기록, 렌더 시 `images:read`로 data URI
  변환(BoardCanvasArea의 캐시 effect). `note/imageInsert.ts`를 `io/imageAssets.ts`로 이동해
  note/board 공용 유틸로 승격(아키텍처 경계 규칙 준수 — 도메인 모듈 간 직접 참조 방지),
  `note/EditorToolbar.tsx`·`NoteEditor.tsx`의 import 경로 갱신. 드래그앤드롭/붙여넣기는 v1
  범위에서 제외(파일 선택 버튼으로 충분 — 명세에 없던 축소, "발견한 사실"에 기록).
- [x] 5. tabbar-app-wiring — `src/panes/TabBar.tsx`: `TabDirty`의 스토어 유니언에 `BoardStore`
  추가, 아이콘/제목 삼항연산자를 board 분기 포함 switch로 전환. `src/App.tsx`: `tab.kind`
  렌더 분기에 `'board'` arm 추가(`<BoardPane .../>`). → 2단계에서 대부분 선반영, App.tsx의
  `renderPane` switch에 board arm만 추가로 완료
- [x] 6. sidebar-wiring — `src/sidebar/Sidebar.tsx`: `isBoardFile(node)`, `displayName()`의
  확장자 strip 정규식에 `board` 추가, 아이콘 렌더 삼항을 3-way로, `newBoard()`(newNote() 복제,
  `.board` 확장자), 빈 워크스페이스 CTA에 "새 보드" 버튼 추가, `revealPathReq` 확장자 체크에
  `.board` 추가. `src/store/workspaceStore.ts`의 `expandAncestors` 확장자 체크도 갱신.
  → 루트 레벨 "마인드맵/노트" 2-section 구조를 "마인드맵/보드/노트" 3-section으로 확장
  (`folded` 상태·`sectionHeader`·`renderTree` 필터). **버그 발견 및 수정**: `commitRename`이
  파일 타입 불문 `${trimmed}.mind`로 하드코딩되어 있어 보드 파일을 리네임하면 확장자가
  `.mind`로 바뀌어 파일이 깨질 뻔함 — `isBoardFile` 분기로 원래 확장자 유지하도록 수정.
  typecheck·전체 단위테스트 통과
- [x] 7. electron-main-wiring — `electron/main.ts`: 버전검증(`snapshotVersion`)/외부변경감지
  (`recordSeen`) 게이트에 `.board` 추가, 워크스페이스 트리 워커(`walk()`)에 `.board` 추가,
  `fs:rename`/`fs:move`의 확장자 보존 로직에 `.board` 추가, trash 5개 핸들러(`purgeExpiredTrash`,
  `trash:move`, `trash:restore`, `trash:deleteOne`, `trash:empty`)의 컴패니언 자산 폴더 로직
  (`findAssetsDir`/`relocateAssetsDir` 호출부) 전부 `.board`도 인식하도록 확장.
  `electron/preload.ts`의 `createFile(dir,name,content,ext?: string)`는 이미 확장자 무관 —
  타입 변경 불필요 확인. `images:write`/`images:read`도 param명(`notePath`)만 note-특정이고
  로직은 확장자 무관 — 변경 없이 재사용 가능 확인. `templates:list`/`attached:list`는 note
  전용 기능이라 의도적으로 변경 안 함. → `npm run build`(tsc + vite ×3) 통과로 electron 컴파일
  확인, typecheck·전체 단위테스트 통과(main.ts는 E2E로만 커버되는 기존 컨벤션 — 단위테스트 없음)
- [x] 8. harness-tags — `scripts/harness/check-e2e-tags.mjs`의 `DOMAIN` Set에 `@board` 추가,
  `.claude/rules/testing.md`의 도메인 태그 표에 `@board` 반영. → check-e2e-tags.mjs 통과 확인
  (44개 spec, 기존 회귀 없음)
- [x] 9. e2e-tests — `e2e/board-basics.spec.ts`(`@board` 태그, 5 tests): 보드 생성→열기(사이드바
  타입 구분 포함), 텍스트/스티키/도형/커넥터 추가, 드래그 이동 + 리사이즈 핸들, 삭제,
  저장 후 재오픈 시 내용 보존(디스크 JSON 직접 검증 + 탭 닫기·사이드바 재오픈 round-trip).
  이미지 업로드는 파일 선택 다이얼로그가 필요해 E2E 자동화 범위에서 제외(수동 확인으로 커버).
  → `make verify-feature tag=@board` 5/5 통과, exit 0
- [x] 10. docs-update — `docs/product/FEATURE-INVENTORY.md`에 `## 17. 보드(무드보드)` 절
  추가(무엇/진입점/핵심 규칙/알려진 한계), §8의 "폴더·.mind·.md만 표시" 서술도 `.board` 반영해
  갱신. `ARCHITECTURE.md` 계층 다이어그램·모듈 책임 표·핵심 설계 결정 표에 board/ADR 0020
  반영, `docs/decisions/README.md` 인덱스도 동기화. `docs/product/specs/README.md`에 스펙
  색인 추가(harness `[8] 인덱스 완전성` 게이트). `src/ui/Manual.tsx`에 board 섹션 추가
  (`Icon.tsx`의 `board` 아이콘 재사용). **부수 수정**: `io/imageAssets.ts`로 파일 이동 때문에
  깨진 `docs/product/INVISIBLE-FEATURES-2026-07.md`의 구 경로 링크 갱신.
  → `make harness-check` 전 항목 통과(exit 0), 경고 4~10건은 전부 기존 pre-existing
- [x] 11. verify — `make harness-check` 통과, `make verify-feature tag=@board` 통과,
  `make dev-safe`로 실제 앱에서 보드 생성·요소 추가·저장·재오픈 수동 확인, 계획 파일을
  `docs/exec-plans/completed/`로 이동.
  → **버그 발견 및 수정(런타임 검증 중)**: 빌드된 앱을 Playwright로 직접 구동해 스티키/텍스트
  더블클릭 편집을 시각 확인하던 중, 더블클릭이 편집 모드로 전혀 진입하지 않는 실제 버그를
  발견. 원인: 드래그 가능한 요소의 pointerdown에서 `setPointerCapture`를 거는 것과 브라우저의
  기본 마우스다운 포커스 처리가 충돌 — 두 번째 클릭에서 React가 동기 리렌더로 div를
  autoFocus textarea로 교체한 직후, 브라우저가 (이미 사라진 원래 target 기준으로) "포커스
  불가능한 요소였다"며 기본 동작으로 새로 포커스된 textarea를 도로 blur시킴. 네이티브
  `dblclick` DOM 이벤트 자체도 캡처 리타게팅 때문에 요소가 아닌 캔버스 컨테이너에서 발화되어
  애초에 신뢰할 수 없었음 → `BoardCanvasArea.tsx`에 pointerdown 타이밍 기반 수동 더블클릭
  감지로 교체 + `e.preventDefault()`로 브라우저 기본 포커스 처리 억제. 회귀 테스트
  (`board-basics.spec.ts`)에 더블클릭 편집 + 저장 round-trip 텍스트 검증 추가(6번째 테스트).
  `make verify-feature tag=@board` 6/6 통과, `make verify-full`(typecheck+test 298/298+build)
  exit 0, `make harness-check` exit 0. 빌드된 앱을 Playwright로 구동해 라이트/다크 모드 스크린샷
  확인(사이드바 보드 섹션·탭 아이콘 색상·캔버스 요소 렌더링·다크모드 CSS 변수 전환 정상).

## 검증 방법

- 각 단계 후 `make verify`(typecheck + 단위 테스트 전체) 통과.
- 4~9단계 완료 후 `make verify-feature tag=@board`(단위 전체 + `@board` E2E).
- 최종 `make harness-check` + `make dev-safe` 수동 시나리오 확인.

## 발견한 사실 (작업 중 갱신)

- `Sidebar.tsx`의 `commitRename`이 파일 타입 불문 `${trimmed}.mind`로 하드코딩되어 있었다 —
  보드 파일을 리네임하면 확장자가 `.mind`로 바뀌어 파일이 깨질 뻔한 기존 코드 경로. 확장자
  보존 분기로 수정(6단계).
- pointer capture(`setPointerCapture`)를 쓰는 드래그 가능 요소는 네이티브 `click`/`dblclick`
  DOM 이벤트가 신뢰할 수 없다 — capture가 compat 마우스 이벤트를 캡처 요소로 리타게팅하기
  때문. pointerdown 타이밍 기반 수동 감지 + `preventDefault()`로 우회(11단계, 런타임 검증 중
  발견).
- `note/imageInsert.ts`는 노트 전용이 아니라 순수 이미지 처리 유틸이었다 — `io/imageAssets.ts`로
  옮겨 board와 공유해도 도메인 경계 규칙과 충돌하지 않음(4단계).
- 이미지 삽입 드래그앤드롭/붙여넣기, 스냅 가이드는 명세 대비 v1에서 실제로 축소한 항목 —
  파일 선택 버튼과 자유 배치만으로 핵심 가치는 충분히 검증됨.

## 결정 변경 이력

- (없음)
