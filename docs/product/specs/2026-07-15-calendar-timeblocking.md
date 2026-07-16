# 캘린더 강화 Phase 3 — 타임블로킹 (언제 + 얼마나)

> 작성: 2026-07-15 · 상태: **구현 완료** (Phase 1+2 이후) · 출처: 사용자 요청("3번도 개발해").
>
> **구현 노트**: `durationMin` 선택 필드 + `version` 무범프(io 라운드트립 테스트로 확인), `mapStore.setDuration`, SchedulePopover "소요 시간" 칩(시각 지정 시), 주간 블록 높이 ∝ duration, 겹침 단순 열 분할(`layoutDayBlocks`), 블록 하단 리사이즈 드래그 → setDuration. 리마인더 무동기화 유지.
> 스키마 결정: [decisions/0012](../../decisions/0012-node-duration-field.md)(`durationMin` 선택 필드, version 무범프).
> 선행 의존: [2026-07-15-calendar-execute-insight.md](2026-07-15-calendar-execute-insight.md)의 **주간 시간 그리드**
> — 블록을 그릴 표면이 먼저 있어야 한다. 구현 순서는 1 → 2 → 3.

## 1. 문제

Phase 1+2로 캘린더에서 "언제"는 옮길 수 있게 됐지만, 노드는 여전히 시간 축에서 **점(point)**이다. "이 일은
2시간 걸린다", "이건 15분"을 표현할 수 없어 주간 시간 그리드에서 모든 항목이 같은 크기로 보인다. 하루의 실제
밀도(무엇이 얼마나 차지하나)를 계획할 수 없다.

## 2. 해결

`scheduleAt`(시작) + `durationMin`(소요 시간, 선택)으로 **시간 블록**을 만든다. 주간 시간 그리드에서 블록
높이 ∝ 지속시간.

### 데이터 (스키마) — [0012](../../decisions/0012-node-duration-field.md)
- `MindNode.durationMin?: number`(분). 선택 필드, **version 무범프·마이그레이션 없음**.
- 시각지정(`hasTime`) 이벤트에만 적용. 종일·미지정은 기존 동작 유지.
- **로컬 전용** — 리마인더 미동기화(리마인더엔 duration 개념 없음). `scheduleAt`만 계속 미러.

### 편집 (SchedulePopover)
- 기존 [SchedulePopover](../../../src/inspector/SchedulePopover.tsx)에 "소요 시간" 컨트롤 추가: 없음(기본) /
  15분 / 30분 / 1시간 / 2시간 칩 + 커스텀.
- **Progressive disclosure** — 시각을 지정한 경우에만 노출(종일이면 숨김). 원칙 3.
- 카피는 사용자 언어("소요 시간")로 — 축 용어(실행 등) 노출 금지([no-framework-terms-in-ui] 방향, 카피 감사
  [COPY-AND-FLOW-AUDIT](../reports/COPY-AND-FLOW-AUDIT-2026-07-15.md)와 정합).

### 표시 (주간 시간 그리드)
- 시각지정+durationMin → `[scheduleAt, scheduleAt+durationMin]` 블록, 높이로 길이 표현.
- durationMin 없는 시각지정 항목 → 기본 최소 높이 블록(예: 30분 시각 슬롯).
- **겹침 처리**: 같은 시간대 겹치는 블록은 나란히 열 분할(캘린더 관례). v1은 단순 열 분할 — 정교한 packing은 후속.
- 종일 항목은 Phase 1의 상단 종일 띠 유지(블록 아님).

### 상호작용
- 블록 하단 모서리 드래그 → durationMin 변경(리사이즈). 블록 본체 드래그 → `scheduleAt` 이동(Phase 1 재사용).
- 리사이즈·이동 모두 **mapStore 액션 경유**.

## 3. 범위에서 뺀 것
- 종일 멀티데이(여러 날 걸치는 블록) — durationMin은 단일 날 시각 이벤트에만.
- 정교한 겹침 packing 알고리즘 — v1은 단순 열 분할.
- 리마인더로 duration 동기화 — 개념 없음, 로컬 전용 고정.
- 반복(Phase 4 — `version` 스키마 변경, 인간 승인 트랙).

## 4. 가드레일 정합성
- **스키마**: version 무범프·마이그레이션 없음([0012]). 순수 가산 선택 필드.
- **reminder 불변조건**: duration은 리마인더 무관, `scheduleAt`만 계속 미러 → 무영향.
- **"todo앱 아님"**: duration은 "얼마나 걸리나"라는 계획 정보이지 우선순위/등급이 아니다. 실행(시간 계획) 강화.
- **원칙 1(제거해도 잃는 것 없어야)**: 기본은 duration 없음 = 기존 경험 그대로. 완전 opt-in.
- **원칙 3(첫인상 심플)**: 시각 지정 시에만 소요 시간 노출.
- **색 억제**: 새 색 없음.
- **로컬 시간**: durationMin은 분 단위 스칼라라 TZ 무관. `scheduleAt` 계산은 여전히 로컬 Date.

## 5. 완료 기준
- [ ] `MindNode`에 durationMin 선택 필드 추가, version 1 유지, 기존 파일 정상 로드/저장(라운드트립 테스트).
- [ ] SchedulePopover에서 시각 지정 시 소요 시간 설정 가능(종일이면 숨김).
- [ ] 주간 시간 그리드에서 블록 높이가 durationMin에 비례, 겹침 시 열 분할.
- [ ] 블록 하단 드래그로 durationMin 변경(mapStore 경유).
- [ ] duration 있는 노드가 리마인더에 duration 없이(`scheduleAt`만) 정상 미러(무회귀).
- [ ] 블록 레이아웃·겹침 열 배정을 순수 함수로 분리해 단위 테스트.
- [ ] e2e에 소요 시간 설정 → 블록 렌더 → 리사이즈 시나리오 추가.
- [ ] `make verify` + `make dev-safe`(블록/리사이즈 실동작) 통과.

## 6. 열린 질문
- duration 없는 시각 이벤트의 기본 블록 높이(최소 슬롯 vs 얇은 마커).
- 겹침 3개 이상일 때 열 폭 하한(가독성).
- 블록 리사이즈 스냅 단위(5분/15분).
