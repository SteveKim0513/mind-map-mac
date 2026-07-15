# 캘린더 뷰 구현 (탭 신설 + 일/주/월)
날짜: 2026-07-15
상태: completed

## 목표

[specs/2026-07-15-calendar-view.md](../../product/specs/2026-07-15-calendar-view.md) 구현. "오늘"
오버레이를 캘린더 탭으로 승격하고, 사이드바·집중 게이트·SchedulePopover 변경까지 이번 세션의
기능 계층 재편([FEATURE-HIERARCHY-VISION](../../product/FEATURE-HIERARCHY-VISION-2026-07.md))을
함께 마무리한다.

## 범위 (포함 / 제외)

**포함**:
1. 우클릭 메뉴 4그룹 재편(구조/정리/실행/통찰), 완료를 실행 그룹으로.
2. 선택 툴바 순서 재정렬 + 집중 버튼 조건부 렌더링(`node.scheduled`일 때만).
3. 우클릭 메뉴 "집중 세션 시작" 비활성+안내(일정 없을 때).
4. SchedulePopover에 "지금 집중 시작" 버튼.
5. **`Tab.kind`에 `'calendar'` 추가** — `store: MapStore | NoteStore | null`로 완화, 싱글턴 캘린더
   탭(`sessionStore.openCalendar()`), 고정 sentinel 경로(`isCalendarPath()` 헬퍼).
6. `src/calendar/` 새 도메인: 날짜 그리드 순수 함수(`calendarMath.ts`) + `CalendarView.tsx`(일/주/월).
7. 사이드바: "오늘"→"캘린더" 교체, "집중 기록"·"최근 수정" 상단에서 제거.
8. "집중 기록" 접근 경로: 캘린더 탭 헤더 아이콘 + 사이드바 맨 아래.
9. "최근 수정": 설정(⌘,) 내부로 이동.
10. `⌘K` "오늘 열기" → "캘린더 열기"로 이름 변경, 캘린더 탭을 열거나 활성화.

**제외**: 캘린더 드래그 재일정, 반복 일정, 월간 뷰 성능 캐시(스펙 §3 참고).

## 현재 상태

- 데이터 계층 재사용 확정: `src/focus/collectAgenda.ts`(워크스페이스 전체 스캔), `src/focus/agenda.ts`
  (순수 그룹핑 — day/overdue/upcoming7). 기존 "오늘" 뷰(`src/focus/TodayView.tsx`)의 행 렌더링(집중·
  완료·클릭 이동)을 그대로 재사용/일반화.
- `sessionStore.ts`의 `Tab { kind: 'map' | 'note'; store: MapStore | NoteStore }` — calendar 추가 시
  `store: MapStore | NoteStore | null`로 타입 완화 필요. `flushTab`(닫을 때 저장), `TabDirty`(더티
  표시)가 이 타입을 분기하는 지점 — calendar는 항상 "저장할 것 없음"으로 처리.

## 가정

- 캘린더 탭은 **디스크에 파일이 없는 유사-탭**이다. `path`는 실제 파일 경로가 아니라 sentinel 문자열
  (`'calendar://agenda'`) — `isNotePath`/`isTemplatePath`와 같은 위치에 `isCalendarPath()` 추가.
- `App.tsx`의 탭 렌더 분기(`t.kind === 'note' ? <NotePane> : <Pane>`)에 `t.kind === 'calendar' ?
  <CalendarView> : ...` 분기 추가.
- 새 도메인 `src/calendar/`는 `store/`(sessionStore, mapStore)와 `focus/`(collectAgenda, agenda, 
  controller의 requestFocusStart)만 참조 — `architecture.md` 경계 규칙 준수(도메인 간 직접 참조
  금지, 필요한 건 store 경유 이미 되어 있음).

## 위험

- **Tab.store 타입 완화(null 허용)가 기존 코드 곳곳에 영향** — `TabDirty`, `flushTab`,
  `sessionStore.test.ts`의 여러 테스트가 `t.store as MapStore`를 가정. 컴파일 에러로 전부 드러날
  것(TypeScript strict) — 하나씩 null 가드 추가.
- **사이드바 "오늘" 제거가 기존 E2E를 깬다** — `smart-views.spec.ts` 등 "오늘" 버튼을 참조하는 테스트
  업데이트 필요.
- **캘린더 싱글턴 탭 로직**이 기존 `openPath`(경로 dedup)와 다른 경로(kind 기반 dedup)라 별도 액션으로
  분리— `openPath` 재사용 시도하다 sentinel 경로 처리가 오염되는 걸 피하기 위함.

## 구현 단계

- [x] 노드 우클릭 메뉴 4그룹 재편 + 집중 조건부(비활성+안내)
- [x] 선택 툴바 재정렬 + 집중 버튼 조건부 렌더링
- [x] SchedulePopover "지금 집중 시작" 버튼
- [x] `sessionStore.ts`: `TabKind`에 `'calendar'`, `Tab.store` null 허용, `openCalendar()`,
      `isCalendarPath()`, `flushTab`/`TabDirty` null 가드
- [x] `src/calendar/calendarMath.ts`: 순수 함수(주 시작일, 월 그리드 셀 배열, 날짜별 그룹핑) + 단위
      테스트
- [x] `src/calendar/CalendarView.tsx`: 헤더(일/주/월 토글 + 기간 이동 + 오늘 버튼 + 돌아보기 아이콘)
      + 세 보기 렌더링. `TodayView.tsx`는 완전히 퇴역시키고 Row 로직을 `src/focus/AgendaRow.tsx`
      공유 모듈로 추출해 재사용.
- [x] `App.tsx`: calendar 탭 렌더 분기 추가
- [x] `TabBar.tsx`: calendar 탭 아이콘·타이틀 (`.tab-ic--calendar`, `state-scheduled` 색)
- [x] `Sidebar.tsx`: "오늘"→"캘린더" 교체, "집중 기록"·"최근 수정" 상단 제거, 하단 바에 "집중 기록"
      추가
- [x] `Settings.tsx`: "최근 수정" 진입점 추가 (클릭 시 설정 오버레이도 함께 닫음 — 아래 발견 참고)
- [x] `App.tsx`의 `buildCommands`: "오늘 열기" → "캘린더 열기"
- [x] E2E: 캘린더 탭 열기/오늘 항목 표시/일·주·월 전환/칸 클릭→일간 전환/집중 시작, 집중 게이트
      (일정 없으면 비활성), SchedulePopover 집중 버튼 (`e2e/calendar-view.spec.ts`,
      `e2e/focus-schedule-gate.spec.ts`)
- [x] 기존 E2E(smart-views 등 "오늘" 참조) 업데이트
- [x] `make pre-release` 전체 통과 확인 (59 e2e + 159 unit, harness-check 통과)

## 검증 방법

각 단계마다 `make verify` → 관련 유닛/E2E. 전체 완료 후 `make pre-release`. 추가로 Playwright로
실제 빌드된 앱을 구동해 라이트/다크 모드에서 일·주·월 세 뷰를 스크린샷으로 육안 확인함(임시 스크립트,
커밋 대상 아님).

## 발견한 사실 (작업 중 갱신)

- **겹친 두 오버레이 문제(실제 버그, 수정함)**: Settings(⌘,)에서 "최근 수정"을 누르면 RecentView가
  뜨는데, `App.tsx`에서 RecentView가 Settings보다 DOM에 먼저 오는 바람에(같은 `z-index: 88`의
  `.wh-backdrop`) Settings가 항상 위에 그려져 RecentView의 버튼을 가로챘다. 두 오버레이를 동시에
  띄우는 조합은 이번에 처음 생겼다(예전엔 "최근 수정"이 사이드바에서 단독으로만 열렸다). 고쳐야 할
  근본 원인은 "임의의 두 `.wh-backdrop` 오버레이가 겹칠 수 있다"이지만, 이번 스코프에서는 "최근
  수정"을 열 때 Settings를 먼저 닫는 것으로 충분히 해결(`Settings.tsx`의 온클릭이
  `closeSettings()` 후 `openRecent()` 호출). 다른 조합(예: "사용 안내"도 Settings 위에서 Manual을
  띄움)은 같은 잠재 버그가 있을 수 있으나 이번 작업 범위 밖이라 손대지 않음 — 필요하면 후속 작업으로.
- **CSS 클래스 이름 재사용 충돌(실제 버그, 수정함)**: `CalendarView.tsx`의 주간/월간 뷰에서 "오늘"
  표시에 `.today`(bare class, compound 아님)를 재사용했는데, 퇴역시킨 `TodayView.tsx`가 쓰던 낡은
  `.today { width: 560px; ... }` 규칙이 `styles.css`에 그대로 남아있어 `.cal-week-col.today`/
  `.cal-month-cell.today`에 그 속성들이 그대로 새어 들어와 주간 뷰 오늘 칸만 560px로 부풀어 보이는
  버그가 생겼다. TodayView.tsx를 지울 때 그 전용 CSS도 함께 지워야 했던 것 — 컴포넌트를 퇴역시킬 때
  전용 클래스 CSS 규칙까지 같이 지우는 걸 잊지 않을 것. 죽은 `.today` 규칙 삭제로 해결.
- 위 두 항목 모두 `make verify`(typecheck+unit)만으로는 잡히지 않았고, 실제 빌드를 Playwright로
  구동해 육안 확인하는 과정에서 발견됨 — [[feedback-ui-verify-before-deploy]] 메모리의 교훈이 다시
  한번 확인됨.

## 결정 변경 이력

- 2026-07-15: 캘린더를 오버레이가 아닌 진짜 탭으로 만들기 위해 `Tab.kind`에 `'calendar'`를 추가하고
  `store`를 null 허용으로 타입 완화하기로 결정(사용자 지시 "캘린더가 탭으로 나오게"). 구현해보니 이
  타입 완화가 우려했던 것만큼 파급 범위가 크지 않았다 — 기존 코드는 대부분 `t.kind === 'map'`/`'note'`
  로 먼저 필터링한 뒤 `as MapStore`/`as NoteStore` 캐스팅을 쓰고 있어서, `store` 타입에 `null`이
  추가돼도 캐스팅 자체는 그대로 컴파일됐다. 실제로 고쳐야 했던 곳은 `flushTab`/`closeTab`의 dirty
  판정, `renamePath`, `TabBar.tsx`의 `TabDirty` 렌더링, `hydrate`의 세션 복원 정도로 국한됨.
