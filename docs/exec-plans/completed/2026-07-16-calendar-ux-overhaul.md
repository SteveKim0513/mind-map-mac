# 캘린더 UX 개선 구현
날짜: 2026-07-16
상태: completed

> 명세: [docs/product/specs/2026-07-16-calendar-ux-overhaul.md](../../product/specs/2026-07-16-calendar-ux-overhaul.md) (설계 결정 5건 확정).
> 사용자 지시: "모두 개발해줘." 명세 §9 순서로 구현.

## 목표

명세의 7개 개선 + 주간 정렬 버그(§3.8)를 모두 구현한다. 스키마 무변경(version=1), 모든 일정 변경 `mapStore` 경유.

## 범위 (포함)

- 요청 1 일간 버튼 통일 / 요청 2 클릭→미리보기→우측분할 / 요청 3·4·5 통합 생성 / 요청 6 종일·시간 UX / 요청 7 월간 스크롤 / 요청 8 주간 정렬 버그.
- 신규 컴포넌트 `SubtreeMiniView`(공유 읽기전용), `SchedulePicker`.
- E2E, FEATURE-INVENTORY, Manual 갱신.

## 범위 (제외)

- 반복 일정(Phase 4), 외부 캘린더, `allDay` 전용 필드(자정 관례 유지), 정교한 겹침 packing, 월간 성능 캐시.

## 현재 상태

- 명세·색상·디자인 원칙 로드 완료. 코드 조사 완료(CalendarView/calendarMath/mapStore/sessionStore/treeLayout/styles).

## 가정

- 종일=자정(00:00) 관례 유지 → 신규 필드 없음, version 1 유지, 인간 승인 불필요.
- 닫힌 맵 일정 지정 = 백그라운드 로드 후 store 액션 적용(`revealNode` 오픈 경로 재사용, 캔버스 포커스 생략).

## 위험

- CalendarView.tsx(839줄) 단일 파일에 대부분 집중 → 순차 편집으로 충돌 회피.
- `SubtreeMiniView`가 `layout()`(layout/) 재사용: 도메인 경계상 `ui/`에 두고 `layout/`(하위 순수계층)만 참조.
- 노드 검색: `search/` 직접 import 금지 → `collectAgendaCached` 스캔 캐시 공유.
- E2E는 자동 빌드 안 함 — 렌더러 변경 후 `npm run build` 먼저.

## 구현 단계 (명세 §9)

- [x] 1. 요청 8 주간 정렬 버그: `PX_PER_MIN`/`WEEK_GRID_HOUR_PX` 고정 스케일, 블록·캡처·클릭 px 배치, 리사이즈 역산 통일 + `minutesToPx`/`pxToMinutes`/`gridHourPx` 순수함수 + 재현 테스트 3건. CSS `align-content:start`로 컬럼 stretch 차단.
- [x] 2. 요청 1 일간 버튼 통일: `cal-daycard-act` 베이스 + 집중/완료 라벨 pill(hover 색만 분기).
- [x] 3. 요청 7 월간 스크롤: `slice(0,3)`/`+N` 제거, `.cal-month-chips overflow-y:auto`, 셀 `height:120px`.
- [x] 4. `SubtreeMiniView`(calendar/): doc+rootId → `layout()` → 정적 SVG 읽기전용(bezier 인라인).
- [x] 5. 요청 2: 전체 클릭 → 미리보기(일간 서랍/월간 하단 패널/주간 팝업+✕) → 스케줄 노드/‘오른쪽에 열기’ 재클릭 시 `openInRight`. 닫힌 맵 `readFile`+`deserialize` 미리보기.
- [x] 6. `SchedulePicker`: `collectNodesCached` 검색 목록 + index-0 "새로 만들기→오늘의 생각" + 종일/시간(HH:mm) 토글. 닫힌 맵 `openPath`→적용→`openCalendar` 복귀.
- [x] 7. 요청 3·4·5: 주(빈슬롯·종일)/일(일정 추가)/월(hover +) 생성 배선. 기존 인라인 캡처 제거.
- [x] 8. E2E `e2e/calendar-ux-overhaul.spec.ts`(5) + `calendar-execute` 캡처 테스트 재작성 + FEATURE-INVENTORY + Manual.
- [x] 9. `make verify`(typecheck+219 unit)·`harness-check` 통과, E2E 83 전체 통과, `build` 성공. `make dev-safe` 육안은 사용자 몫.

## 검증 방법 (결과)

- 단위 219 통과(정렬 분↔px 재현 3건 포함), typecheck 0, harness-check 통과, build 성공, E2E 83 통과.
- `make dev-safe`: 서랍/팝업/피커/스크롤/정렬 다크·라이트 육안 — **사용자 확인 필요**.

## 발견한 사실 (작업 중 갱신)

- 정렬 버그 근본 원인은 box-sizing이 아니라 **블록 `top:%`가 stretch된 컬럼 높이에 매핑**된 것 — px 고정 스케일 + `align-content:start`로 해결. 클릭→시각 매핑(`minuteFromClick`)도 같은 버그가 있어 함께 고침.
- "오늘의 생각"은 파일 관례(`오늘의 생각.mind`, `capture:targetPath`). 새 파일이면 `useWorkspace.refresh()`를 호출해야 디스크 스캔이 찾는다.
- 닫힌 맵 일정 지정은 `openPath`로 열고(스토어 생성) `openCalendar()`로 복귀 — sync 우회 없이 `mapStore` 경유(불변조건 보존).

## 결정 변경 이력

- `SubtreeMiniView` 위치: 명세는 `ui/` 예시였으나 아키텍처상 calendar(domain)→ui(reverse)가 금지 → **calendar/에 배치**(하위 `layout/`만 참조, canvas/ 미참조로 실제 제약 충족).
- 자연어 시각 파싱은 SchedulePicker에서 **채택하지 않음** — 명시적 종일/시간 컨트롤이 단일 진실원(클릭 날짜와 자연어 날짜 충돌 방지). 자연어는 `@`-입력·⌥Space 캡처에 그대로 유지.
- 기존 주간 인라인 텍스트 캡처(`captureCtl`/`CaptureCtl`/`.cal-wk-capture`·`.cal-wk-hint`)는 `SchedulePicker`로 대체·제거.
