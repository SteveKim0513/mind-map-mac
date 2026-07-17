# 0017. 명시적 자정 vs 종일 구분을 위한 `allDay` 필드
날짜: 2026-07-17
상태: accepted

## 컨텍스트
일정 노드의 all-day/timed 여부는 `scheduleAt` 문자열에서 파생되었다 — `parseSchedule`가 시각 성분이 `00:00`이면 종일로 간주. 그런데 종일 항목과 "사용자가 명시적으로 입력한 자정"(`@오전 12시`)이 둘 다 `...T00:00:00`으로 저장되어 **문자열상 구분 불가**했다. 그 결과 `@오전 12시 심야회의`가 조용히 종일 항목으로 강등되어 시간표에 뜨지 않았다(QA 발견 E5).

## 결정
`MindNode`에 **선택적 가산 필드 `allDay?: boolean`**을 추가한다.

- `allDay === true` → 종일, `allDay === false` → 시각 있음(00:00이어도 timed), `allDay === undefined` → **기존과 동일하게** 시각 성분에서 파생.
- `parseSchedule(scheduleAt, allDay?)`가 이 우선순위로 `hasTime`을 계산.
- NL 파싱(`parseScheduleText`)은 명시적 자정일 때만 `allDay:false`를 세팅. 그 외에는 미설정.
- `setScheduleAt`(팝오버·피커·드래그 리스케줄 공통 경로)는 `allDay`를 **초기화**(undefined)해 새 시각에서 파생하게 한다 → 팝오버/피커/드래그는 별도 수정 불필요, 모든 종일 지정이 자동으로 올바르게 동작.
- 복사/붙여넣기(`ClipNode`)는 `allDay`를 함께 운반.

## 결과
- 장점: `@오전 12시` 등 명시적 자정이 시각 이벤트로 유지. **기존 문서(allDay 없음)는 100% 무변경**(파생 폴백). 스키마 `version`은 그대로 `1` — durationMin(0012)과 동일한 "선택적 가산 필드=무범프" 선례를 따른다.
- 단점: 종일/timed 판정이 파생 + 필드 두 경로가 되어 개념이 하나 늘었다. `parseSchedule`를 우회해 `scheduleAt`만 보고 판단하는 신규 코드는 `allDay`를 놓칠 수 있으므로 항상 `parseSchedule`를 경유해야 한다.

## 대안
- 종일을 `"YYYY-MM-DD"`(날짜만) 문자열로 표현: `rescheduleToDay`가 다시 `T00:00:00`을 붙이고, Reminders 동기화의 `new Date("YYYY-MM-DD")`가 UTC 자정으로 파싱돼 타임존 시프트를 유발 → 회귀 위험이 커 기각.
