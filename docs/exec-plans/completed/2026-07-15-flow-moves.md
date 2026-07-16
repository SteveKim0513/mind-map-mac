# 플로우 이동 구현 — "물 흐르듯" 접근점 조정 (카피 감사 Part 2)
날짜: 2026-07-15
상태: completed · 2026-07-16 **검증 완료 + v0.10.0 배포**(단위 175 + E2E 68 통과, 캘린더 작업과 함께 릴리즈). 초기 "tsc 차단"은 캘린더 타임블로킹 완성으로 해소됨.

> **후속 변경 (2026-07-16, [결정 0013](../../decisions/0013-onboarding-after-features-stable.md))**: 이 계획의 #3
> 첫 실행 코치(`FirstRunCoach`)는 사용자 지시로 **제거**됐다 — 온보딩은 핵심 기능 안정화 후에 도입한다.
> 나머지 이동(⌘L, ⌘⇧N, 미리알림 진입점, 카피 정리)은 유지된다.

## 목표

[COPY-AND-FLOW-AUDIT-2026-07-15.md](../../product/reports/COPY-AND-FLOW-AUDIT-2026-07-15.md) §4의
depth/위치/접근점 이동을 구현한다 — 핵심 기능을 흐름 위로 끌어올려, 사용자가 메뉴를 뒤지지 않고
"다음 걸음"으로 자연스럽게 넘어가게 한다.

## 범위 (포함 / 제외)

포함(감사 §4의 6개 이동):
1. 리마인더 동기화 진입점 — 설정에 상태/권한 행 신설 + ⌘K 명령
2. 노드↔노트 연결 접근성 — ⌘L 단축키 신설
5. 키보드 대칭 — 새 노트 ⌘⇧N 신설
6. ⌘K 완성 — 확인 결과 openRecent/openFavorites 이미 존재(App.tsx:522-523), 리마인더 명령만 추가
3. 집중 빠른 길 노출 — 첫 실행 코치(스팟라이트형, 1회성, 건너뛰기 가능)

제외/판단:
- 4. 푸터 아이콘 라벨 — **현행 유지**. 아이콘 전용은 IA-STRATEGY §5-2의 의도된 계층 구분(1차 내비=라벨,
  관리형=아이콘). 강제 라벨은 그 결정과 충돌하고 사이드바 하단을 붐비게 함 → 검토 후 변경 안 함.
- 2(b) 노드 호버 노트 어포던스 — ⌘L 단축키 + 기존 ⌘K/우클릭으로 접근성 충분. 캔버스 렌더 리스크 대비
  가치 낮아 이번 제외(칩은 연결 후 이미 표시됨).
- 리마인더 "마스터 on/off 토글" — 현재 sync는 tracked 노드 있으면 자동. 마스터 스위치는 새 settings IPC가
  필요하고 동작 의미가 바뀌므로 이번 범위 밖(상태 표시 + 권한 유도까지만).

## 가정

- 새 IPC 채널 불필요 (조사로 확인). 새 Zustand store 불필요. macOS 권한 로직 무변경.
- 첫 실행 코치는 새 도메인 모듈이 아니라 `src/ui/`의 단일 컴포넌트 + localStorage 플래그.

## 키 배정 (충돌 조사 완료)

- `⌘⇧N` 새 노트 — 자유. electron 메뉴 accelerator → `send('menu','new-note')` → App.tsx onMenu(⌘N 패턴 동일)
- `⌘L` 노트 연결 — 자유(맵 컨텍스트). useKeyboard.ts에 추가(편집 중 bail). 선택 노드 없으면 무동작

## 구현 단계

- [x] 1. `electron/main.ts` 파일 메뉴에 "새 노트" (⌘⇧N) 추가 → `App.tsx` onMenu `case 'new-note'`
- [x] 2. `src/interactions/useKeyboard.ts` ⌘L → 선택 노드 openLinkNote
- [x] 3. `src/ui/Settings.tsx` ReminderSyncRow 신설(syncStatus + 권한 유도 + 재확인) — CaptureStatusRow 선례. 용어는 OS와 동일한 "미리알림"으로(GrowthNudges의 "리마인더"도 통일)
- [x] 4. `src/App.tsx` buildCommands에 ⌘K "미리알림 동기화 설정" (설정 열기)
- [x] 5. `src/ui/FirstRunCoach.tsx` 신설 + `Pane.tsx` 빈 상태에 마운트 + styles.css + localStorage 'onboardingSeen'
- [x] 6. `src/ui/Manual.tsx`에 새 단축키(⌘⇧N, ⌘L) 반영
- [~] 7. E2E `e2e/flow-moves.spec.ts` 작성 완료 — 단, build(tsc)가 캘린더 동시작업에 막혀 **아직 실행 못 함**

## 검증 방법

- `make verify` (typecheck + unit) 종료 0
- 영향/신규 E2E 통과
- `make harness-check` 통과
- (권장) `make dev-safe`로 코치·리마인더 행 시각 확인

## 발견한 사실 (작업 중 갱신)

- 단축키는 3곳 분산 등록(useKeyboard / App.tsx 전역 keydown / electron 메뉴). 새 노트는 메뉴 경로가
  ⌘N과 대칭이라 자연스럽고, 노트 연결은 노드 컨텍스트가 필요해 useKeyboard가 맞다.
- 리마인더 상태는 uiStore.syncStatus로 이미 렌더러에서 실시간 구독 가능 — 설정 UI에 IPC 불필요.

## 결정 변경 이력

- 2026-07-15: #4(푸터 라벨) 구현 안 함으로 결정 — 의도된 IA 계층과 충돌.
