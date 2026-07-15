# 캘린더 뷰 구현 (탭 신설 + 일/주/월)
날짜: 2026-07-15
상태: active

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

- [ ] 노드 우클릭 메뉴 4그룹 재편 + 집중 조건부(비활성+안내)
- [ ] 선택 툴바 재정렬 + 집중 버튼 조건부 렌더링
- [ ] SchedulePopover "지금 집중 시작" 버튼
- [ ] `sessionStore.ts`: `TabKind`에 `'calendar'`, `Tab.store` null 허용, `openCalendar()`,
      `isCalendarPath()`, `flushTab`/`TabDirty` null 가드
- [ ] `src/calendar/calendarMath.ts`: 순수 함수(주 시작일, 월 그리드 셀 배열, 날짜별 그룹핑) + 단위
      테스트
- [ ] `src/calendar/CalendarView.tsx`: 헤더(일/주/월 토글 + 기간 이동 + 오늘 버튼 + 돌아보기 아이콘)
      + 세 보기 렌더링, `TodayView.tsx`의 Row 컴포넌트/로직 재사용(가능하면 공유 함수로 추출)
- [ ] `App.tsx`: calendar 탭 렌더 분기 추가
- [ ] `TabBar.tsx`: calendar 탭 아이콘·타이틀
- [ ] `Sidebar.tsx`: "오늘"→"캘린더" 교체, "집중 기록"·"최근 수정" 상단 제거, 하단 바에 "집중 기록"
      추가
- [ ] `Settings.tsx`: "최근 수정" 진입점 추가
- [ ] `App.tsx`의 `buildCommands`: "오늘 열기" → "캘린더 열기"
- [ ] E2E: 캘린더 탭 열기/오늘 항목 표시/일·주·월 전환/칸 클릭→일간 전환/집중 시작, 집중 게이트
      (일정 없으면 비활성), SchedulePopover 집중 버튼
- [ ] 기존 E2E(smart-views 등 "오늘" 참조) 업데이트
- [ ] `make pre-release` 전체 통과 확인

## 검증 방법

각 단계마다 `make verify` → 관련 유닛/E2E. 전체 완료 후 `make pre-release`.

## 발견한 사실 (작업 중 갱신)

(작업 진행하며 갱신)

## 결정 변경 이력

- 2026-07-15: 캘린더를 오버레이가 아닌 진짜 탭으로 만들기 위해 `Tab.kind`에 `'calendar'`를 추가하고
  `store`를 null 허용으로 타입 완화하기로 결정(사용자 지시 "캘린더가 탭으로 나오게").
