# 오버레이 스택 도입 — 닫기/Esc의 단계 복귀

날짜: 2026-07-19
상태: completed

## 목표

관리형 오버레이(설정·최근 수정·사용 안내·휴지통 등 9개)에 **열린 순서 스택**을 도입해,

1. 닫기/Esc/배경 클릭이 **최상단 레이어 하나만** 닫는다 (한 단계 복귀).
2. 나중에 연 오버레이가 항상 **위에** 보인다 (DOM 렌더 순서가 아닌 스택 순서로 z-index 결정).
3. 목적 달성(파일 열기 등)으로 화면을 떠날 때는 **스택 전체를 해소**한다.

원 보고 문제: 설정 → "최근 수정" 진입 시 `closeSettings()`로 설정을 닫아버려 복귀 불가.
감사로 확인된 동류 문제: 설정 → "사용 안내"에서 Esc 1회에 둘 다 닫힘(모든 오버레이가 각자 window 캡처 keydown 리스너), 커맨드 팔레트로 오버레이 위에 다른 오버레이를 열면 아래에 깔림(정적 DOM 순서 z-order).

## 범위

**포함**: `uiStore` 스택 상태 + 9개 관리형 오버레이(`history`·`trash`·`versions`·`templates`·`recent`·`favorites`·`updates`·`settings`·`manual`)의 Esc/닫기/z-index, RecentView·FavoritesView "열기"의 전체 해소, 설정 "최근 수정" 링크의 `closeSettings()` 제거.

**제외**:
- 팔레트류(`quickOpen`/`cmdkOpen`/`globalSearch`/인맵 검색)는 스택에 넣지 않는다 — 자체 Esc 처리(입력창 타깃) 유지, z-index만 관리형 위로 보장. 단, 관리형 오버레이의 Esc 훅은 팔레트가 열려 있으면 무시한다(팔레트가 먼저 닫히는 게 한 단계 복귀).
- WhatsNew 카드(`whatsNew`, 일회성): "전체 내역" 클릭 시 카드 소멸은 목적 달성 이동(내용이 전체 내역의 부분집합)으로 판단, 현행 유지. ADR에 기록.
- NotePopup(transient peek), 사이드바·캘린더 등 base 위에서만 열리는 UI.

## 현재 상태

- `src/store/uiStore.ts:404-431` — 오버레이 9개가 독립 boolean, 상호 배타·스택 없음.
- `src/App.tsx:546-556` — 정적 DOM 렌더 순서가 겹침 순서를 결정 (전부 `.wh-backdrop` z-88).
- 9개 컴포넌트 각자 `window.addEventListener('keydown', k, true)`로 Esc 처리 → 겹치면 동시 발화.
- `src/ui/Settings.tsx:364-373` — 최근 수정 링크가 `closeSettings(); openRecent();` (z-order 회피 목적, e2e/smart-views.spec.ts:19-21이 이 동작을 고정 중).
- 설정 내부 서브페이지(view state)와 WorkHistory 3단계 Esc는 이미 올바른 단계 복귀 — 유지.

## 가정

- 스택 최대 깊이는 실사용상 2~3 (설정→사용 안내, 팔레트로 오버레이 위 오버레이).
- boolean 유지 + 스택 병행(이중 상태)은 store 액션 안에서만 동기화하므로 위험 통제 가능. boolean을 파생 상태로 바꾸는 전면 리팩터는 하지 않는다.

## 위험

- 리스너 등록/해제 순서·캡처 단계 상호작용 — 훅이 스택 최상단 여부를 store에서 직접 조회하므로 등록 순서 무관하게 결정적.
- 기존 E2E가 현재(잘못된) 동작을 고정: `e2e/smart-views.spec.ts:19-21` 갱신 필요. `@view`·`@nav`·`@command` 태그 스위트로 회귀 확인.
- z-index 동적화로 팔레트(z-90)와 충돌 가능 → 팔레트 z를 관리형 최대치 위로 상향.

## 구현 단계

- [x] `uiStore`: `OverlayId` 타입, `overlayStack: OverlayId[]`, 순수 헬퍼 `pushOverlay`/`removeOverlay`(export, 테스트 대상), 각 `open*`/`close*`가 boolean+스택 동기 갱신, `closeAllOverlays()` 추가
- [x] 공용 훅 `useOverlayEsc(id, onEsc)`: Esc 시 팔레트 열림이면 무시 → 스택 최상단 === id일 때만 `onEsc()` 실행
- [x] 9개 오버레이 컴포넌트의 자체 Esc 리스너를 훅으로 교체 (Settings는 서브페이지 단계 복귀, WorkHistory는 3단계 복귀를 콜백 안에 유지)
- [x] 백드롭 z-index를 스택 위치 기반으로 동적 적용, 팔레트 z 상향 (`.qo-backdrop` 90→100, `.focus-done-backdrop` 90→98)
- [x] `Settings.tsx` 최근 수정 링크에서 `closeSettings()` 제거
- [x] RecentView·FavoritesView "열기" → `closeAllOverlays()` 후 파일 열기
- [x] 단위 테스트: 스택 헬퍼·store 뮤테이션 (`src/store/uiStore.overlays.test.ts`)
- [x] E2E: smart-views.spec.ts 갱신(최근 수정 Esc → 설정 복귀) + 설정→사용 안내 Esc 단계 복귀 + ⌘K 휴지통 z-order (`e2e/overlay-navigation.spec.ts`, `@view`,`@nav`)
- [x] 문서: ADR `0018-overlay-esc-stack.md`, `UI-DESIGN-PRINCIPLES.md`에 레이어 복귀 원칙 추가, `FEATURE-INVENTORY.md` 갱신, `Manual.tsx` Esc 행 한 줄 갱신

## 검증 방법

1. `make verify` (typecheck + 단위 전체)
2. `make verify-feature tag=@view` + `make e2e-tag tag=@nav` + `make e2e-tag tag=@command`
3. `make harness-check`
4. 런타임: 설정→최근 수정→Esc→설정 복귀 / 설정→사용 안내→Esc→설정 유지 / 설정 위 ⌘K→휴지통 열기→휴지통이 위에 표시

## 발견한 사실 (작업 중 갱신)

- 설정이 "최근 수정"을 닫고 열었던 이유는 UX 의도가 아니라 z-order 제약(RecentView가 DOM상 먼저 렌더)이었다.
- `stopPropagation()`은 같은 타깃(window)의 다른 리스너를 막지 못한다 — 동시 발화의 직접 원인.
- 팔레트류(⌘P/⌘K/전체 검색)는 Esc를 input의 target-phase `onKeyDown`으로 처리한다 — window 캡처인 `useOverlayEsc`가 항상 먼저 실행되므로, "팔레트 열림이면 무시" 가드는 store 조회 시점에 팔레트가 아직 열려 있어 등록 순서와 무관하게 결정적으로 동작한다.
- `.node.dragging`(z-100)은 transform된 캔버스 레이어 안의 자체 스태킹 컨텍스트라 팔레트 z-100 상향과 충돌하지 않는다. 88~100 사이 z는 `.qo-backdrop`·`.focus-done-backdrop`(각 90)뿐이었다.
- `UpdateStatus` 팝업(transient, 스택 밖)은 여전히 자체 window 캡처 Esc라 최상단 관리형 오버레이와 동시 발화할 수 있다 — 기존 동작과 동일해 이번 범위에서 제외, ADR 단점에 기록.
- `docs/decisions/README.md` 목록이 0016·0017을 누락하고 있었다 — 0018 추가하며 함께 보수.

## 결정 변경 이력

- (없음)
