# 색상 태그 범례
날짜: 2026-09-03
상태: completed

## 목표

`docs/product/specs/2026-09-03-color-tag-legend.md`를 구현한다: 맵마다 색상 키(8종)에 라벨을 붙이고, 경로 바 아래 같은 높이의 새 "태그 바"에 칩으로 보여준다. 칩 클릭 = 기존 색상 필터 토글. 하단 캔버스 툴바의 기존 색 점 필터는 제거하고 태그 바로 대체. 맵이 아닌 탭만 열려 있을 때는 태그 바 행 자체가 사라진다(높이 0).

## 범위 (포함 / 제외)

포함: `MindMapDoc.tagLabels` 필드, 기본 라벨 상수, `TagBar` 컴포넌트, `Pane.tsx`의 기존 필터 UI 제거, `App.tsx` 마운트, 스타일, E2E, 문서 갱신.
제외(스펙 4절과 동일): 다중 색 동시 필터, 색상 팔레트 확장/커스텀 hex, 라벨 문서 간 공유, 노드 색상 피커에 라벨 노출, 태그별 노드 개수 배지.

## 현재 상태

- 색상 필터: `src/store/mapStore.ts`의 `colorFilter: string | null` + `setColorFilter`, `src/layout/treeLayout.ts`가 forest 필터링, UI는 `src/panes/Pane.tsx`의 하단 `.toolbar` 안 `usedColors`/`filter-dots`(약 L44-64, L157-192).
- 경로 바: `src/panes/PathBar.tsx`, `.pathbar { height:22px }`(`src/styles.css` L339-345), `App.tsx:464`에서 `leftTab`/`rightTab`/`split` prop으로 마운트.
- 탭당 store 인스턴스: `src/store/sessionStore.ts`의 `Tab.store`(탭 열릴 때 1회 생성, 탭 닫힐 때까지 유지) — `Pane.tsx:24-35`가 `MapContext.Provider`로 감싸 하위에서 `useMap()` 사용. `App.tsx`가 아닌 위치(예: `TabBar.tsx`의 `TabDirty`, L11-15)는 Context 없이 `useStore(tab.store, selector)`(zustand vanilla)로 동일 인스턴스를 직접 구독하는 선례가 있음 — `TagBar`도 이 패턴을 따른다.
- 팔레트: `src/theme/palette.ts`의 `TAG_KEYS`(8종, 한국어 기본 이름 없음), `tagVar()`, `normalizeColor()`.

## 가정

- `tagLabels`는 옵션·가산 필드라 `MindMapDoc.version`(현재 `1`) 무범프로 추가 가능(선례: 결정 0012 `durationMin`).
- `TagBar`는 `tab.kind === 'map'`일 때만 `tab.store as MapStore`로 좁혀 구독하고, 그 외 kind에서는 훅을 무조건 호출하되(Hooks 규칙) 내부에서 null 가드한다.

## 위험

- `Pane.tsx`의 필터 UI 제거 시 `usedColors` 계산(`useMemo`)이 다른 곳에서도 쓰이는지 확인 필요 — 없으면 그대로 삭제, 있으면 `TagBar`로 로직 이동 후 `Pane.tsx`에서 참조 제거.
- `.filter-dot*` CSS가 다른 컴포넌트에서도 재사용 중일 수 있음 — 삭제 전 전체 검색.
- 분할 보기에서 태그 바 행 높이가 "한쪽만 맵이면 유지"인데, 레이아웃 높이 계산(App.tsx의 flex 구조)이 조건부 높이 변경에 자연스럽게 반응하는지 확인(조건부 렌더 자체로 flex 자식이 사라지면 되므로 대체로 문제 없을 것으로 예상).

## 구현 단계
<!-- 상태 마커: [ ] pending · [>] in-progress · [x] completed · [!] blocked · [e] error -->
- [x] 0. types-and-defaults — `src/types.ts`에 `tagLabels?: Partial<Record<TagKey, string>>` 추가, `src/theme/palette.ts`에 `TAG_DEFAULT_LABELS` 8종 추가 → implementation-worker 완료(2026-09-03)
- [x] 1. io-schema-validation — `src/io/formats.ts` deserialize에서 sanitize, `formats.test.ts` 4건 추가 → 완료
- [x] 2. store-actions — `mapStore.ts`에 `setTagLabel` 액션(undo 가능), `mapStore.test.ts` 4건 추가 → 완료
- [x] 3. tagbar-component — 신규 `src/panes/TagBar.tsx`(TagBar/TagBarSide/MapTagBarSide/TagChip/AddTagButton), TabDirty 선례 따라 zustand vanilla `useStore` 구독 → 완료
  - `tab.kind === 'map'`이면 `useStore(tab.store as MapStore, s => ({ doc: s.doc, colorFilter: s.colorFilter, filterAncestors: s.filterAncestors, filterDescendants: s.filterDescendants }))`로 구독(Context 우회, `TabDirty` 선례).
  - 칩 목록 = `doc.nodes`에서 실제 쓰인 색(usedColors) ∪ `Object.keys(doc.tagLabels ?? {})`, `TAG_KEYS` 순서로 정렬.
  - 칩 클릭(펜슬 아이콘 영역 제외) → `setColorFilter(colorFilter === key ? null : key)`. 활성 칩 옆에 기존 상위/하위 포함 토글(아이콘+텍스트, `Pane.tsx`의 기존 마크업을 그대로 이식).
  - hover 시 펜슬 아이콘 노출 → 클릭하면 칩 라벨이 인라인 `<input>`으로 전환, Enter/blur 저장(`setTagLabel`), Esc 취소.
  - "＋" 버튼(라벨 없는 나머지 키가 1개 이상일 때만 노출) → 작은 팔레트 팝오버(남은 키 목록) → 선택 시 인라인 텍스트 입력 → Enter 확정(`setTagLabel`).
  - **행 표시 로직**: `leftTab?.kind === 'map' || (split && rightTab?.kind === 'map')`이 false면 `TagBar`가 `null` 반환(행 자체가 렌더 안 됨 → 높이 0). true면 행을 렌더하고, 각 `TagBarSide`는 자신의 tab이 map이 아니면 빈 내용만 표시.
- [x] 4. wire-app — `App.tsx`에서 `<PathBar>` 바로 아래 `<TagBar leftTab rightTab split>` 마운트 → 완료
- [x] 5. remove-old-filter — `Pane.tsx`의 `usedColors`/`filter-dots`/상위·하위 토글 블록 제거, 미사용 import 정리 → 완료
- [x] 6. styles — `.tagbar*` 규칙 추가, 기존 `.filter-dot*` 완전 제거(`grep` 0건 확인) → 완료
- [x] 7. docs-sync — FEATURE-INVENTORY.md 5절, Manual.tsx 갱신 → 완료
- [x] 8. e2e-test — `e2e/tagbar-color-legend.spec.ts` 신규, `@map` 3개 시나리오(칩 표시·필터·상위포함·인라인수정 / ＋로 빈 맵 라벨 정의 / 비-맵 탭 행 소멸) → 완료. `make verify-feature tag=@map` 21/21 통과
- [x] 9. verify — Playwright(`_electron`)로 빌드된 앱을 직접 구동해 육안 확인(라이트+다크). **버그 2건 발견·수정**: (1) `.tagbar-side{overflow:hidden}`이 "＋" 팝오버(절대 위치)까지 클리핑해 안 보였음 → 칩만 감싸는 `.tagbar-chips`로 오버플로우 범위를 좁히고 "＋"는 그 밖에 둠. (2) 그 과정에서 `.tagbar-chips`에 `flex:1`을 주자 "＋"가 칩 바로 뒤가 아니라 행 맨 끝(화면 우측 끝)까지 밀려남 → `flex:0 1 auto`로 수정해 칩 바로 뒤에 위치하도록 고침. 수정 후 재빌드·재구동으로 라이트/다크 모두 정상 확인, `make verify`(298/298)·`make verify-feature tag=@map`(21/21, 신규 3건 포함) 재통과. 분할 보기 좌우 독립 동작은 육안으로는 미확인(단일 탭 전환만 실측) — 남은 위험으로 기록.

## 검증 방법

- `make verify` 종료 코드 0.
- `make verify-feature tag=@map` 통과(신규 E2E 포함).
- `make dev-safe`로 실제 앱에서: 맵 탭 열기 → 태그 바 노출 확인, 노트 탭으로 전환 → 태그 바 사라짐(높이 0) 확인, 분할 보기(맵+노트) → 맵 쪽만 노출 확인.
- 레거시 문서(`tagLabels` 필드 없는 기존 `.mind` 파일) 정상 로드 확인.

## 발견한 사실 (작업 중 갱신)

(구현 중 갱신)

## 결정 변경 이력

- 2026-09-03: 초안 작성. 사용자 지시로 "맵이 아닌 탭에서는 태그 바를 완전히 숨긴다(빈 22px 자리 유지 안 함)"로 스펙 2절 수정 후 계획 작성.
