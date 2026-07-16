# 캘린더 강화 구현 — Phase 3 타임블로킹

날짜: 2026-07-15
상태: completed

명세: [docs/product/specs/2026-07-15-calendar-timeblocking.md](../../product/specs/2026-07-15-calendar-timeblocking.md)
ADR: [decisions/0012](../../decisions/0012-node-duration-field.md)
선행: [Phase 1+2 exec-plan](2026-07-15-calendar-execute-insight.md) — **주간 시간 그리드가 있어야 블록을 그린다. 순서 1→2→3.**

## 목표

`MindNode.durationMin`(선택)로 시간 블록을 만들어 주간 그리드에서 길이 표현 + 리사이즈. 스키마 version 무범프.

## 범위

**포함**: durationMin 필드, SchedulePopover 소요시간 컨트롤, 주간 블록 렌더 + 겹침 열분할, 블록 리사이즈.
**제외**: 멀티데이, 정교한 packing, 리마인더 duration 동기화, 반복(Phase 4).

## 현재 상태

- 스키마 결정 완료([0012]): 선택 필드, version 1 유지, 마이그레이션 없음.
- [io/formats.ts](../../../src/io/formats.ts) 확인: `serialize`=전체 JSON 덤프(화이트리스트 아님),
  `deserialize`=version 미검사 → 가산 필드 안전.
- **선행 의존**: Phase 1 주간 시간 그리드(아직 미구현). 이게 없으면 착수 불가.

## 가정

- store 뮤테이션이 노드를 화이트리스트로 재구성하지 않아 durationMin이 라운드트립에서 보존된다(구현 중 확인).
- 겹침 열 분할은 순수 함수로 계산 가능(입력: 그 날 timed items → 각 항목의 열 인덱스 + 총 열 수).

## 위험

- store 재구성으로 인한 필드 유실 → mapStore 뮤테이션 경로 검토.
- 겹침 레이아웃 복잡도 → v1은 단순 열 분할로 축소.
- Phase 1 미완 시 착수 불가(선행 의존).
- 00:00=종일 오버로드와 duration 상호작용(자정 시작 실이벤트 표현 불가 — 기존 한계 승계).

## 구현 단계

- [ ] (선행 게이트) Phase 1 주간 시간 그리드 완료 여부 확인
- [ ] [types.ts](../../../src/types.ts)에 `durationMin?: number` 추가 + JSDoc(로컬 전용, hasTime만)
- [ ] io 라운드트립 테스트: durationMin 있는 doc 저장→로드 보존, version 1 유지
- [ ] [mapStore](../../../src/store/mapStore.ts)에 `setDuration` 액션(`_pushHistory` 패턴, reminder 무관)
- [ ] SchedulePopover: 소요 시간 칩(시각 지정 시에만 노출), `setDuration` 연결 — `/design-ui` 선행
- [ ] calendarMath(또는 신규 모듈): 블록 위치/높이 + 겹침 열 배정 순수 함수 + 단위 테스트
- [ ] 주간 그리드: 블록 렌더(높이 ∝ duration), 겹침 열 분할
- [ ] 블록 하단 리사이즈 드래그 → `setDuration`, 본체 드래그 → `setScheduleAt`(Phase 1)
- [ ] 리마인더 무회귀 확인: duration 노드가 `scheduleAt`만 미러
- [ ] e2e: 소요시간 설정 → 블록 → 리사이즈

## 검증 방법

- 단위: io 라운드트립(durationMin 보존/version 1), 블록·겹침 레이아웃 순수 함수.
- E2E: 소요 시간 설정 → 블록 높이 → 리사이즈 → 저장 반영.
- 수동(`make dev-safe`): reminderOn+duration 노드가 리마인더에 정상(중복/오류 없이) 미러.

## 발견한 사실 (작업 중 갱신)

- 2026-07-15: `serialize`/`deserialize`가 필드 화이트리스트가 아니라 durationMin 가산이 하위호환
  (version 범프 불필요) — [ADR 0012]. io 라운드트립 테스트 2건으로 확인(version=1 유지).
- Phase 1 주간 그리드와 함께 구현 — 블록 높이 ∝ duration, 겹침 열 분할(`layoutDayBlocks`, 단위 테스트 5건),
  블록 하단 pointer 드래그 리사이즈 → `setDuration`. 리사이즈 중 HTML5 draggable을 끄는 `resizing` 상태로
  드래그-이동과 충돌 방지.
- `AgendaItem`에 `durationMin` 추가(collectAgenda가 노드에서 전달)해야 블록이 duration을 반영.

## 결정 변경 이력

- 2026-07-15: Phase 3를 "인간 승인 보류"에서 **"개발 승인"**(사용자: "3번도 개발해")으로. 스키마는 version
  무범프 선택 필드로 확정([0012]). 초기 "마이그레이션 필요" 판단은 `formats.ts` 확인 후 철회.
