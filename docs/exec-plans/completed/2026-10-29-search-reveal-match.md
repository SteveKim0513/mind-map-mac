# 검색 결과 위치로 이동 (노트 찾기 바 · 맵 찾기 이어받기)
날짜: 2026-10-29
상태: completed

## 목표
전체 검색에서 결과를 고르면 연 파일 안에서 검색어를 강조·스크롤하고, 일치가 여러 개면 다음/이전으로 이동할 수 있게 한다. 명세: [2026-10-29-search-reveal-match.md](../../product/specs/2026-10-29-search-reveal-match.md)

## 범위 (포함 / 제외)
포함: 노트 찾기 바(새 Tiptap 확장 `SearchHighlight`), 노트 ⌘F → 노트 찾기, 맵 결과 → 맵 찾기 바 이어받기, 접힌 조상 펼치기.
제외: 보드 찾기, 바꾸기, 정규식·대소문자 옵션.

## 현재 상태
구현 완료(2026-10-29). 명세 결정 6절 두 항목 모두 권장안 채택.

## 가정
- 노트 일치는 에디터 문서의 텍스트 블록 단위로 계산한다(블록을 넘는 일치는 없음).
- 맵 강조 상태(`uiStore.matchIds`)는 전역 하나 — 분할 화면 동시 찾기는 지원하지 않는다(기존과 같음).

## 위험
- 노트 스크롤 위치 복원(마운트 시·이미지 치환 후)이 검색 이동을 덮어쓸 수 있다 → 찾기 바를 열 때 그 노트의 저장된 스크롤 위치를 지운다.
- 공유 노트는 내용이 늦게 도착한다 → 일치가 0에서 처음 생기는 순간 한 번 스크롤한다.
- 맵 탭이 활성화되기 전에 찾기 바를 열면 이전 맵 기준으로 찾는다 → `revealNode` 완료 후, 활성 맵이 대상 맵일 때만 연다.

## 구현 단계
<!-- 상태 마커: [ ] pending · [>] in-progress · [x] completed · [!] blocked · [e] error -->
- [x] 1. note-search-highlight — `src/note/searchHighlight.ts`: 순수 함수 `findTextMatches(doc, query)` + ProseMirror 플러그인(질의·현재 인덱스 상태, Decoration). 단위 테스트. → searchHighlight.ts + .test.ts(9건). 문단 단위로 서식 경계를 넘어 일치, 인라인 리프는 1글자로 취급해 위치 보존
- [x] 2. note-find-bar — `src/note/NoteFindBar.tsx`: `n/m`, Enter/⇧Enter/↑↓, Esc(현재 일치 선택 후 닫기). NotePane에서 렌더, NoteEditor `extras`에 확장 추가, 스크롤 위치 충돌 처리. → NoteFindBar.tsx, NoteEditor `overlay` 슬롯(본문 안 0높이 sticky 앵커)·`forgetNoteScroll`, NotePane `find` 상태
- [x] 3. ui-requests — `uiStore`에 `noteFindReq`(경로·질의, 소비 후 비움)와 `mapSearchInit`(질의·현재 노드). App ⌘F 분기에 노트 추가, GlobalSearch `choose`에서 요청 설정. → uiStore `mapSearchInit/openMapSearch`, `noteFindReq/requestNoteFind/takeNoteFind`; App ⌘F 노트 분기
- [x] 4. map-handoff — `Search`가 `mapSearchInit`을 받아 질의를 채우고 고른 노드를 현재 일치로. `mapStore.expandTo(id)`(접힌 조상 펼치기, 뷰어 허용) → `revealNode`·`Search` 이동에서 호출. → mapStore.expandTo(+MAP_VIEWER_ALLOWED) + mapStore.expandTo.test.ts(3건). Search 효과 의존성을 일치 id 목록으로 좁혀 편집 때마다 첫 일치로 튀던 동작도 없앰
- [x] 5. e2e — `e2e/search-reveal.spec.ts` (`@note @nav`, `@map @nav`). → 3건, 파일을 실행 전에 써 두고 `reuse`로 띄워 타이밍 의존 없음
- [x] 6. docs — FEATURE-INVENTORY 9절, `src/ui/Manual.tsx`, 명세 상태. → specs/README 색인 포함

## 검증 방법
`make verify`, `make verify-feature tag=@nav`, `make harness-check`, `make dev-safe quiet=1`로 라이트·다크 스크린샷 확인.

## 발견한 사실 (작업 중 갱신)
- 맵 노드가 접힌 가지 아래 있으면 `focusReq`가 레이아웃에서 노드를 못 찾아 조용히 실패한다(`Canvas.tsx` focusReq 소비부).

## 결정 변경 이력
