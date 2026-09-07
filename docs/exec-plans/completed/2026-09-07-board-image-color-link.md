# 보드 이미지 요소에 색·연동(노드/노트/외부 링크) 추가
날짜: 2026-09-07
상태: completed

## 목표
보드(무드보드)의 이미지 요소가 스티키 노트와 동일하게 (1) 색 지정, (2) 마인드맵 노드/노트/외부
링크 연동 기능을 갖도록 하고, (3) 이미지 테두리를 그 색으로 아주 얇게 표시해 시각적으로
구분되게 한다. 기본 색은 스티키와 동일한 'yellow'.

## 범위 (포함 / 제외)
- 포함: `BoardImageElement` 타입에 `color`/`nodeLink`/`noteLink`/`link` 필드 추가, 스토어
  `setNodeLink`/`setNoteLink` 가드를 image까지 허용, `BoardElementView`의 링크 칩 UI를
  이미지에도 렌더링(칩 로직은 공용 헬퍼로 추출해 중복 최소화), `BoardSelectionToolbar`를
  이미지 선택에도 대응하도록 일반화(색·연동만 노출, 모양/정렬/서식/텍스트박스는 스티키 전용
  유지), 이미지에 얇은 색 테두리 CSS, 신규 이미지 생성 시 기본 `color:'yellow'`, 문서
  갱신(FEATURE-INVENTORY.md §17, Manual.tsx).
- 제외: 스티키의 `notes[]`(카드 아래 텍스트 블록), 모양/정렬/서식 등 텍스트 전용 기능을
  이미지로 확장하는 것. 이미지와 스티키를 섞은 다중 선택 일괄 편집(기존처럼 동일 종류만
  전체 선택됐을 때만 플로팅 메뉴 노출, 기존 sticky-only 패턴 유지).

## 현재 상태
- `BoardImageElement`(src/types.ts:248-252)는 `src`/`alt`만 가짐 — 색·링크 필드 없음.
- `boardStore.ts`의 `setNodeLink`/`setNoteLink`는 `el.kind !== 'sticky'`면 즉시 return.
- `BoardElementView.tsx`의 링크 칩 JSX는 `el.kind === 'sticky'` 분기 안에서만 렌더링.
- `BoardSelectionToolbar.tsx`는 `stickies: BoardStickyElement[]` prop 타입 고정.
- `.board-image`(styles.css:7019)는 상시 border 없음(로딩 placeholder만 예외).

## 가정
- `BoardElementPatch`(store/boardStore.ts)는 이미 모든 kind 필드의 합집합이라 `color`/`link`
  패치는 타입 변경 없이 이미지에도 적용 가능 — `BoardImageElement`에 필드만 추가하면 됨.
- `revealBoardNodeLink`/`revealBoardNoteLink`(board/boardLinks.ts), `BoardNodePicker`/
  `BoardNoteLinkPicker`는 kind에 무관하게 동작 — 변경 불필요.
- `io/boardFormat.ts`의 `parseBoard`는 필드별 검증을 하지 않으므로(스티키 필드도 마찬가지)
  변경 불필요.

## 위험
- `BoardSelectionToolbar`의 discriminated union 좁히기(`primary.kind === 'sticky'`)가
  TS strict 모드에서 원하는 대로 좁혀지는지 확인 필요(컴파일 타임에 `make verify`로 검증).
- 링크 칩을 이미지 쪽에서는 `.board-el-body` 바깥(스티키의 `notes[]`와 같은 normal-flow
  형제)으로 배치해야 이미지 높이를 침범하지 않음 — 배치 실수 시 칩이 사진 위에 겹칠 위험.

## 구현 단계
- [x] 1. types-and-store — `BoardImageElement`에 `color?/nodeLink?/noteLink?/link?` 추가,
      `setNodeLink`/`setNoteLink` 가드를 `'sticky'|'image'` 허용으로 확장, 새 이미지 생성 시
      `color:'yellow'` 기본값(BoardToolbar.tsx의 addImages) → 타입·스토어·생성 기본값 변경 완료
- [x] 2. link-chips-shared — BoardElementView.tsx에 링크 칩 JSX를 공용 `LinkChips` 헬퍼로
      추출, 이미지 분기에서도 사용(칩은 `.board-el-body` 바깥 normal-flow 형제로 배치, 신규
      `.board-image-links` 래퍼 클래스) → 완료
- [x] 3. thin-border-css — `.board-image`/`.board-image--loading`에 얇은 테두리(box-sizing:
      border-box + border) 추가, 색은 인라인 style로 `tagVar(el.color) ?? 'var(--tag-yellow)'`
      → 완료
- [x] 4. toolbar-generalize — BoardSelectionToolbar.tsx의 `stickies` prop을
      `elements: (BoardStickyElement|BoardImageElement)[]`로 일반화, 모양/정렬/서식/텍스트박스
      추가 버튼만 `primary.kind === 'sticky'`로 감싸고 색·연동은 공용화. BoardCanvasArea.tsx의
      선택 계산을 "전체 스티키 선택" 또는 "전체 이미지 선택" 둘 다 지원하도록 확장 → 완료
- [x] 5. verify-and-docs — `make verify` 통과 확인, `make dev-safe`로 이미지 색·연동·테두리
      실제 동작 확인, FEATURE-INVENTORY.md §17과 Manual.tsx 갱신 → 완료

## 검증 방법
- `make verify` (typecheck + unit test)
- `make dev-safe`로 보드에서 이미지 추가 → 색 변경 → 노드/노트/외부 링크 연동 → 테두리 색
  반영 확인 (사람이 보지 않는 자동 검증이므로 `quiet=1`)
- 기존 스티키 관련 동작(색·모양·정렬·서식·연동)이 회귀하지 않았는지 육안 확인

## 발견한 사실 (작업 중 갱신)
- `primary.kind === 'sticky'`를 `const isSticky`에 담아 재사용해도 TypeScript가 이후
  블록에서 `primary`를 `BoardStickyElement`로 정상 좁혀줬다(aliased condition narrowing) —
  `make verify`(typecheck)로 확인 완료, 추가 캐스팅 불필요.
- `fileToImageData`(io/imageAssets.ts)는 canvas로 실제 디코딩하므로 E2E에서 이미지 업로드를
  검증하려면 진짜 디코딩 가능한 PNG 바이트가 필요했다 — 1×1 최소 PNG를 base64로 임베드해
  임시 파일로 써서 `page.setInputFiles`로 통과시킴(기존 e2e에는 이 흐름 자체가 없었음).
- `e2e/board-image-color-link.spec.ts` 신규 작성, 2건 모두 통과(`make verify-feature
  tag=@board` — 기존 45건 + 신규 2건 = 47건 전체 통과).

## 결정 변경 이력
(없음)
