# e2e 미커버 Journey QA 발견 일괄 수정
날짜: 2026-07-17
상태: completed

## 목표
e2e에 커버되지 않은 43개 사용 journey를 실제 앱 구동으로 탐색해 발견한 47건(데이터손실 3 · 버그 12 · 불편 21 · 개선 11)을 수정하고, 회귀 그물망이 필요한 시나리오를 e2e/단위 테스트에 반영한다.

## 범위 (포함)
- 명확한 버그·불편·개선 수정 (아래 배치)
- 우선 시나리오 e2e 추가: 버전 복원, 표 편집, 복사/붙여넣기/복제 불변조건, 노트 외부변경
- NL 파싱은 단위 테스트로 커버

## 범위 (제외 / 결정)
- **복제 리마인더**: 복사와 동일하게 4개 필드 전부 제거 (사용자 승인). ADR 0016 기록.
- **내보내기 충실도**: 표준 포맷 유지 + 손실 경고만 (사용자 승인). 비표준 확장 안 함.
- **E6 (@/# 지시어 제목 잔존)**: `nl-parsing.spec.ts`가 검증하는 의도된 동작 — 표시 변경은 별도 제품 결정. 이번 범위 제외(문서화).
- **A8 (F2/Space 편집 시 전체선택)**: 이름변경 UX상 의도된 동작. 제외(문서화).
- **B5 (중첩 집중 스택)**: focus-history 스택 도입 필요한 설계 변경, 저가치. 제외(문서화).
- **E7 (리마인더 삭제 fire-and-forget)**: 이론적·self-heal. 제외(문서화).
- **F5 (⌥숫자 퀵키는 팔레트 열렸을 때만)**: F2 안정화로 가치 회복, 전역화는 별도. 제외(문서화).

## 배치 (파일-분리 병렬)
- **STORE** `src/store/mapStore.ts` — A1(복제 4필드 제거) A2/A3(clip todo·durationMin) A4(deleteSelected 이웃선택) A5(생성 히스토리 병합) A6(undo 재선택) A7(접기 선택 이동) B4(setColorFilter 리셋) E2(subtree scheduleAt 전파)
- **VIEW** `src/canvas/Canvas.tsx` `src/layout/treeLayout.ts` `src/ui/Breadcrumb.tsx` `src/panes/Pane.tsx` — B1(필터 focus 스코프) B2(휠 getState) B3(드래그팬 선택유지) B6(Z 경계) B7(선툴바 LOD) B8(재배치 라벨)
- **NOTES** `src/note/NoteEditor.tsx` `src/note/tableMarkdown.ts` `src/note/NotePane.tsx` — C1(표 Tab) C2(파이프 이스케이프) C3(위키링크 peek) C4(제목 stale 피드백) C6(이미지 경로 인코딩)
- **MAIN** `electron/main.ts` — D1(복원 강제스냅샷) D3(rename 히스토리 이동) D4(workspace 설정 병합) D6(외부변경 clobber 전 강제스냅샷)
- **SHELL** `src/App.tsx` `src/store/sessionStore.ts` `src/store/workspaceStore.ts` `src/sidebar/Sidebar.tsx` — D2(노트 외부변경) D5(recent rename) D7(workspace 탭 정리) D8(export 경고) D9(빈 import 경고) D10(폴더 다중선택) D11(reloadIfOpen 노트) F3(URL catch)
- **MISC** `src/store/parseNodeText.ts` `src/focus/agenda.ts` `src/focus/report.ts` `src/inspector/SchedulePopover.tsx` `src/search/GlobalSearch.tsx` `src/ui/commandUsage.ts` `src/ui/Manual.tsx` `src/menu/ContextMenu.tsx` — E1(N시간) E3(주 시작 통일) E4(주말칩) E5(자정) F1(전역검색 메모/링크) F2(퀵키 안정) F4(Manual 문서) A10(아이콘 네이밍) E2-UI(ContextMenu 게이팅)
- **E2E** `e2e/*.spec.ts` (신규) — 구현 완료 후: version-restore, table-edit, clipboard-invariant, note-external-change

## 검증 방법
1. 배치별 자체 단위테스트 추가/갱신
2. 통합 후 `make verify` (typecheck + unit) 종료코드 0
3. `make verify-full` (+build)
4. e2e 신규 스펙 green
5. UI 변경 `make dev-safe` 시각 확인
6. `make pre-release` 통과 후에만 배포(배포는 사용자 승인)

## 발견한 사실 (작업 중 갱신)
- 외부변경 감지: main `seenMtime` + `fs:externalChange`; App.tsx focus 핸들러가 맵 탭만 검사(D2), atomicWrite는 snapshotVersion 호출하나 5분 스로틀(main.ts:388)이 D1/D6 공통 원인.
- **통합 회귀**: D7(workspaceStore→sessionStore import)이 markdown.tsx→workspaceStore 체인을 통해 uiStore의 모듈 로드 시 localStorage 접근을 node 테스트에 노출 → uiStore DOM 접근을 `typeof window` 가드로 감쌈(기존 matchMedia 가드 관례와 동일).
- **C2 2차 회귀(전체 e2e가 포착)**: 최초 C2 수정이 `state.write`를 래핑했으나 prosemirror-markdown의 `text()`는 텍스트를 `state.out`에 직접 추가하고 인자 없는 `write()`로 구분자만 flush → `undefined.replace` 크래시 + 텍스트 미이스케이프로 **모든 표가 빈 그리드로 저장**되는 데이터 손실. `state.out` 슬라이스 방식으로 재구현하고 단위 테스트 목을 실제 동작(텍스트를 out에 직접 추가)에 맞춰 이 부류를 잡도록 강화. 단위 테스트만으로는 못 잡고 실제 앱 e2e가 잡음 → 표 편집 e2e를 그물망으로 추가한 이유를 실증.

## 이월 잠재 위험 → 완전 해소 (2차 작업, 사용자 승인 "완전 해소")
- **C6/R7 해소**: 이미지 참조를 표준 뷰어 이식 가능하도록 인코딩. `NoteEditor` 멱등 `encodeAssetRef`(decode-first로 이중인코딩 방지) → serialize 적용; `electron/main.ts` `images:read` `decodeURIComponent`(양 리더 커버); `relocateAssetsDir` raw+encoded 이중 매칭. `note-rename-image-paths.spec` 갱신 + `note-image-portable.spec`(신규) 2개. e2e로 앱내 렌더(data: img)·디스크 %20 실증.
- **E5/R6 해소**: `MindNode.allDay?` 선택 가산 필드(무 version 범프, ADR 0017). `parseSchedule(scheduleAt, allDay?)` — 미지정 시 기존 파생 폴백(회귀 0). NL 명시적 자정만 `allDay:false`; `setScheduleAt`는 allDay 초기화(팝오버/피커/드래그 무수정). copy/paste·capture 전파.

## 이월 (문서화만 — 저가치/설계·의도 동작)
- **E6** @/# 지시어 제목 잔존(테스트된 의도 동작), **A8** F2/Space 전체선택(이름변경 UX), **B5** 중첩 집중 스택, **E7** 리마인더 삭제 fire-and-forget(self-heal), **F5** ⌥숫자 전역화.
- **note-external-change / invisible-features IF-04**: blur/focus 기반이라 헤드리스에서 타이밍 취약. note-external-change는 blur/focus 재시도로 하드닝(안정). IF-04(사전 존재)는 셋업 단계 flaky, 재시도 통과 — 별도 하드닝 여지.
- **D6 통지 토스트**(선택): 외부변경 강제 스냅샷 시 렌더러에 알림 — preload 채널+UI 필요.
- **note-external-change.spec**: 포커스 이벤트 타이밍에 민감(1회 재시도 후 통과) — 하드닝 여지.

## 검증 결과 (최종)
- `make verify`(typecheck + unit): 통과, 252 테스트.
- 빌드: 성공 → `make verify-full` 그린.
- e2e: 신규 4개(clipboard-reminder-invariant, table-editing[C1/C2], version-restore, note-external-change) 통과, 전체 스위트 기존 스펙 회귀 0.
- 드라이버 시각 확인: B8 라벨, 콘솔 에러 0.

## 결정 변경 이력
- 2026-07-17: 복제 리마인더=4필드 제거, 내보내기=표준+경고 (사용자 승인)
