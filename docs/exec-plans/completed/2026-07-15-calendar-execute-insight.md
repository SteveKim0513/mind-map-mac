# 캘린더 강화 구현 — 실행하는 캘린더 + 계획↔실행 대조 (Phase 1+2)

날짜: 2026-07-15
상태: completed

명세: [docs/product/specs/2026-07-15-calendar-execute-insight.md](../../product/specs/2026-07-15-calendar-execute-insight.md)

## 목표

캘린더 v1(읽기 전용 투영)을 **편집·통찰 표면**으로 확장한다. 스키마 변경 없이 기존 노드 필드
(`scheduleAt`)와 집중 세션 데이터(`FocusSession`)만으로, (1) 캘린더에서 직접 일정을 옮기고(실행)
(2) 계획과 실제 집중 시간을 한 화면에서 대조한다(통찰).

## 범위

**포함 (Phase 1+2)**
- 드래그 리스케줄(월/주), 빈 셀 클릭 캡처, 주간 시간 그리드, 주/월 인라인 집중·완료
- 셀에 실제 집중 시간 오버레이, overdue+집중0 가시화 → 재계획 동선

**제외 (별도 트랙)**
- `durationMin` 타임블로킹(Phase 3), 반복(Phase 4) — `MindMapDoc.version` 변경 → 인간 승인
- 닫힌 맵 노드의 캘린더 내 편집(열린 맵만), 외부 캘린더/EventKit, 월간 성능 캐시

## 현재 상태

- 캘린더 v1 구현됨: [CalendarView.tsx](../../../src/calendar/CalendarView.tsx)(일/주/월 셸),
  [calendarMath.ts](../../../src/calendar/calendarMath.ts)(순수 날짜 그리드, 테스트 있음).
- 셀 데이터는 [focus/collectAgenda.ts](../../../src/focus/collectAgenda.ts) → `AgendaItem` 재사용.
- 일정 뮤테이션: [mapStore.ts](../../../src/store/mapStore.ts) `setScheduleAt`/`setScheduled`
  (reminder 동반 처리 내장). 집중 집계: [focus/aggregate.ts](../../../src/focus/aggregate.ts) `dailyTotals`.

## 가정

- `dailyTotals`(dayKey→집중초)로 셀 오버레이가 순수 계산 가능하다(신규 IPC 불필요).
- `setScheduleAt` 경유 시 `reminderOn` 노드의 리마인더 due가 기존 sync 파이프라인으로 자동 이동한다.
- 주간 시간 그리드는 업무시간대 압축 + 접기로 정보 밀도 원칙을 만족한다(0–24h 전체 나열 안 함).

## 위험

- **reminder 고아**: 캘린더가 `scheduleAt`을 직접 쓰면 불변조건 깨짐 → 반드시 `mapStore` 액션 경유.
- **UTC 혼입**: 드래그 날짜 산술에서 `Date` UTC 메서드 쓰면 로컬 벽시계 `scheduleAt`과 어긋남.
- **드래그 히트테스트 회귀**: 기존 셀 클릭(→일간 점프)과 드래그 제스처 충돌 → threshold로 구분.
- **월간 성능**: 오버레이가 `collectAgenda` 전체 스캔에 집계를 더함 → 대형 워크스페이스 측정 필요.

## 구현 단계

**Phase 1 — 실행하는 캘린더**
- [ ] `calendarMath`에 드래그 날짜 재계산 순수 함수 추가(`rescheduleTo(item, targetDay)` — 시각·종일 유지) + 단위 테스트
- [ ] 월간 셀 간 드래그 → `mapStore.setScheduleAt` 호출(열린 맵 노드만; 닫힌 맵은 안내 토스트)
- [ ] 주간 시간 그리드: 시간대 세로축 레이아웃(종일 상단 띠 / 시각지정 세로 위치), `hasTime` 재사용
- [ ] 주간 세로 드래그 → 시각 변경, 가로 드래그 → 날짜 변경
- [ ] 빈 셀 클릭 → 인라인 입력 → 활성 맵 탭에 일정 노드 생성(선택 노드 아래/루트), 활성 맵 없으면 안내
- [ ] 주·월 항목에 집중 시작(`requestFocusStart`)·완료 토글 인라인 노출
- [ ] `/design-ui` 스킬로 그리드·드래그 시각 원칙 확인(새 색 금지)

**Phase 2 — 계획↔실행 대조**
- [ ] `dayKey → 집중초` 매핑을 캘린더용으로 노출하는 순수 셀렉터 + 단위 테스트
- [ ] 월간 셀: 계획 개수 배지 + 그 날 총 집중 시간
- [ ] 주간: 각 날 하단 집중 총량 미니 막대
- [ ] 일간 헤더: "계획 N · 집중 Xh · 완료 M" 한 줄 요약
- [ ] overdue+집중0 항목 시각 구분(scheduleInfo `over` 재사용, 새 색 없음) → 드래그로 재계획
- [ ] 헤더 "돌아보기"에서 현재 기간 대시보드로 연결(범위 파라미터 전달)

**검증·마무리**
- [ ] `make verify`(typecheck + unit) 통과
- [ ] `e2e/calendar-*.spec.ts`: (a) 드래그 → `scheduleAt` 변경, (b) 계획vs실행 표시 시나리오 추가
- [ ] `make dev-safe`로 드래그·빈셀 생성·오버레이 실제 동작 확인(런타임 증거)
- [ ] diff로 `MindMapDoc.version`·types.ts 필드 변경 없음 확인
- [ ] `make harness-check`, spec 완료 기준 체크리스트 대조

## 검증 방법

- 단위: `calendarMath` 재계산 함수, 날짜↔집중 매핑 셀렉터.
- E2E: 드래그 리스케줄 → 파일 저장된 `scheduleAt` 반영, 계획/실집중 표시.
- 수동(`make dev-safe`): reminderOn 노드 드래그 시 리마인더 앱에서 due 이동 확인.

## 발견한 사실 (작업 중 갱신)

- **E2E는 자동 빌드하지 않는다** — `dist-electron/main.js`를 구동하므로 렌더러 변경 후 `npm run build` 없이 E2E를 돌리면 구 번들이 실행된다(한 번 낚였음). E2E 전 반드시 빌드.
- **캘린더 탭이 활성이면 `activeStore()`가 null** — 캡처가 항상 "맵 먼저 열기"만 떴다. 첫 열린 맵 탭으로 폴백해 해결(`targetMapStore`).
- 월간 셀 클릭은 v1 계약(일간 이동)을 유지해야 E2E가 통과 — 캡처는 주간 그리드 빈 슬롯 전용으로 한정.
- 리스케줄/캡처/집중/완료 모두 기존 `mapStore` 액션 경유로 리마인더 불변조건 자동 보존. `MindMapDoc.version` 변경 없음.
- 최종: 단위 175 통과, E2E 전체 68 통과(calendar-execute 5 신규 + calendar-view 6), harness-check 통과, 주/월 시각 스크린샷 확인.

## 결정 변경 이력

- 2026-07-15: 사용자가 Phase 1+2로 범위 확정(타임블로킹·반복은 스키마·승인 트랙으로 분리).
