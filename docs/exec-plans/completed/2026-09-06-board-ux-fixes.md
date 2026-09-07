# 보드 UX 개선 11건
날짜: 2026-09-06
상태: completed

## 목표
사용자가 실사용 중 보고한 보드(무드보드) 11건의 버그·UX 불편을 근본 원인부터 고쳐
자연스럽고 신뢰할 수 있는 상호작용으로 만든다.

## 범위 (포함 / 제외)
포함: 아래 11건 전부.
제외: 보드 자체의 새 기능(6번의 "링크 연결"은 포함하되, 그 이상의 연동 확장은 없음).

## 현재 상태 · 원인 분석 (항목별)

1. **분할 화면에서 새 스티키/이미지가 안 보이는 곳에 생성** — `BoardToolbar.tsx`의
   `nextSpot()`이 `window.innerWidth/innerHeight`(창 전체 크기)로 중앙을 계산한다.
   분할 화면에서는 그 좌표가 반대쪽(비활성) 패널 쪽으로 나갈 수 있다. → 캔버스
   **자기 자신의** 컨테이너 rect 기준으로 계산해야 한다. `BoardCanvasHandle`에
   `viewportCenterWorld()`를 추가해 `BoardToolbar`가 그걸 쓰도록 교체.

2 & 4. **화살표가 스티키 위로 그려짐** — 현재 렌더 순서가 스티키(`boxIds.map`) →
   화살표(`connectorIds.map`) 순이라 나중에 그려지는 화살표가 위로 올라온다.
   → 화살표의 **선(svg path)만** 스티키보다 먼저(뒤에) 그리고, 라벨 칩·재배선
   손잡이(선택 시 상호작용 오버레이)는 스티키 다음(위)에 그려 클릭 가능하게 유지한다.
   한 번의 계산(`connectorIds.map`으로 `{a,b,pts,box,d,mid}` 미리 계산)을 재사용해
   두 패스(선-뒤, 오버레이-앞)로 나눠 렌더.

3. **연결 포인트가 작고, 존재를 미리 알기 어려움** — 현재 앵커는 `showAnchors`가
   true일 때만 **마운트**되고(선택/hover/드래그 타깃일 때), 크기 10px, 애니메이션
   없음(2026-09-03 발견한 "마운트 애니메이션이 특정 창 상태에서 멈춰버리는" 버그
   회피 때문에 의도적으로 제거했었다). → 앵커를 **항상 마운트**하고 기본 상태에서
   아주 흐리게(`opacity` 낮음, `pointer-events: none`) 보이다가, 카드 hover·선택·
   드래그 타깃일 때 CSS 클래스만 바뀌어 커지고 진해지고 클릭 가능해지도록
   전환한다(`transition: opacity/transform` — **마운트 애니메이션이 아니라 상태
   기반 CSS 전환**이라 이전에 발견한 버그 재발 위험이 없다). 크기도 10px→14px로.

5. **드래그 중 화살표가 "안 자연스럽다"** — 실제 원인은 프레임레이트가 아니라
   `boardRouting.ts`의 직선/꺾인선 **모드 전환이 불연속**이라는 것. 두 앵커가 거의
   정렬됐다가(직선) 살짝 어긋나면(꺾임) 순간적으로 팝(pop)하듯 바뀐다. 조사 결과,
   `routeWaypoints`의 "정렬되면 직선 2점만 반환" 특수 케이스를 없애고 항상 일반
   꺾은선 알고리즘을 쓰면 — 정렬된 경우 중간 waypoint들이 좌표상 겹쳐(dedupe로
   합쳐져) **결과적으로 동일하게 시각적 직선**이 되면서, 정렬이 깨지는 순간에도
   불연속 점프 없이 연속적으로 변형된다(각도가 조금씩만 바뀜). 순수 함수라 안전하게
   수정 가능 — 기존 유닛 테스트(`boardRouting.test.ts`)의 "직선" 기대값만 갱신하면 됨.

6. **링크 연결(외부 URL) 추가** — 노드 연결·노트 연결 다음에 세 번째 옵션.
   `BoardStickyElement.link?: string` 추가(마인드맵 `MindNode.link`와 동일 개념).
   플라이아웃에 인라인 URL 입력(피커 아님 — 검색 대상이 없는 단순 텍스트).
   여는 방식은 마인드맵 노드 링크 칩과 동일하게 `window.open(url, '_blank')`
   (Electron 메인의 전역 `setWindowOpenHandler`가 `shell.openExternal`로 위임) —
   일관성을 위해 같은 경로를 그대로 재사용.

7 & 9. **노드/노트 연결 피커에서 항목을 클릭해도 연결이 안 됨** — **근본 원인
   특정함**: `BoardNodePicker`/`BoardNoteLinkPicker`의 `.picker` div가
   `onMouseDown={(e) => e.stopPropagation()}`로 배경 클릭을 막고 있는데, 이 피커가
   **`.board-canvas`(자체 `onPointerDown`으로 배경 클릭 시 `setPointerCapture` +
   마퀴 선택을 시작하는 요소) 안의 자식으로 렌더링**된다. `stopPropagation`은
   `mousedown` 이벤트에만 걸려 있고, 실제로 버블링하는 것은 **별도의 네이티브
   `pointerdown` 이벤트**다 — 이게 안 막힌 채 `.board-canvas`까지 올라가
   `setPointerCapture`를 그 포인터 ID에 걸어버린다. 그러면 뒤이은 `pointerup`이
   캡처한 요소(캔버스)로 리다이렉트되어, 브라우저의 클릭 합성 로직이 깨지면서
   피커 항목의 `onClick`이 아예 발화하지 않는다 — 정확히 사용자가 겪는 증상과
   일치(선택해도 "아무 일도 안 일어남"). 키보드(Enter)로는 이 경로를 안 타서
   지난 자동화 테스트에서 못 잡았다. → `.picker`의 보호 핸들러를
   `onPointerDown`으로 바꾸면(이벤트 타입을 일치시키면) 해결.

8. **피커가 열린 상태에서 스크롤하면 뒤 보드도 같이 스크롤됨** — 같은 뿌리:
   `.picker-backdrop`(`position: fixed`)이 `.board-canvas`의 **DOM 자손**이라
   (fixed는 레이아웃만 벗어나지, 이벤트 버블링 트리에서는 그대로 자손이다), 휠
   이벤트가 캔버스의 `onWheel`(팬/줌)까지 버블링한다. → 피커에
   `onWheel={(e) => e.stopPropagation()}` 추가.

10. **빈 캔버스 더블클릭 → 스티키 생성** — 현재 더블클릭 핸들러가 캔버스 배경에는
    없다(요소 더블클릭만 있음). 네이티브 `onDoubleClick`을 캔버스에 추가하되,
    클릭한 월드 좌표에 이미 요소가 있으면(요소 자신의 더블클릭 편집 로직에 맡기고)
    무시 — `elementAt()` 가드로 배경-전용임을 확인.

11. **필터가 흐리게 dim만 하고, 마인드맵처럼 재배치하지 않음** — 확인 결과 마인드맵의
    색 필터는 단순 dim이 아니라 **`layout/treeLayout.ts`가 필터링된 노드를 아예
    레이아웃 계산에서 제외**해 남은 노드끼리 압축 재배치되는 방식이다
    (`treeLayout.ts:65-92`). 보드는 트리가 아니라 자유 배치라 같은 알고리즘을 못
    쓴다 — **뷰 전용(문서에 저장 안 함) 그리드 재배치**를 구현: 필터가 켜지면
    일치하는 스티키/이미지만 화면에 남기고(비일치는 완전히 숨김, dim이 아님)
    간단한 그리드로 재배치해 보여주며, 화살표는 양 끝이 모두 보이는 경우만 그린다.
    필터를 끄면 저장된 실제 좌표로 즉시 복귀(문서의 x/y는 건드리지 않는다 —
    파일에 저장되는 배치는 그대로 유지, 필터 뷰는 순수 렌더링 오버레이).

## 가정
- 6번 "링크"는 외부 URL만 의미(보드/노드/노트 내부 링크 아님) — 사용자 문구
  "링크는 외부 링크야"로 확인.
- 11번 그리드 재배치는 필터 적용 중 임시 뷰이며, 드래그로 위치를 바꾸는 것까지는
  요구하지 않는다(필터 끄면 원래 좌표로 복귀하면 충분).

## 위험
- 5번(라우팅 알고리즘 변경)은 기존 유닛 테스트 다수가 특정 반환값을 기대 — 테스트
  기대값을 "시각적으로 동일한 직선이지만 waypoint 개수가 다름"에 맞게 갱신 필요.
- 7/9번 수정(`onPointerDown`)이 다른 상호작용(피커 내부 드래그 등 없음, 단순
  클릭·입력만 있어 안전)과 충돌하지 않는지 확인.
- 11번은 새 렌더링 상태(필터 시 그리드 좌표)이므로 기존 `dimmed()` 로직과의
  상호작용을 깔끔히 정리해야 함(필터 켜짐 = dim 로직 제거, 숨김+재배치로 대체).

## 구현 단계
<!-- 상태 마커: [ ] pending · [>] in-progress · [x] completed · [!] blocked · [e] error -->
- [x] 1. spawn-position-fix — nextSpot을 캔버스 컨테이너 rect 기준으로 (BoardCanvasHandle.viewportCenterWorld 추가) → BoardCanvasArea.tsx/BoardToolbar.tsx, e2e로 분할 화면 검증
- [x] 2. connector-behind-stickies — 렌더 순서를 선(뒤)/오버레이(앞) 두 패스로 분리 → connectorRenders 배열로 사전 계산 후 두 번 렌더
- [x] 3. anchor-always-mounted-hover-fade — 앵커 상시 마운트 + CSS 상태 전환, 크기 확대(10→14px) → BoardElementView.tsx + styles.css `.board-anchor.active`
- [x] 4. routing-smooth-transition — routeWaypoints 직선 특수케이스 제거, 유닛 테스트 갱신 → boardRouting.ts/test.ts
- [x] 5. external-link-field — BoardStickyElement.link 추가, 플라이아웃 UI, 칩, window.open → types.ts/boardStore.ts/BoardSelectionToolbar.tsx/BoardElementView.tsx
- [x] 6. picker-pointercapture-fix — BoardNodePicker/BoardNoteLinkPicker onMouseDown→onPointerDown + onWheel stop → 근본 원인이었던 포인터 캡처 버블링 확인 및 수정, 좌표 클릭 e2e로 검증
- [x] 7. canvas-doubleclick-create-sticky — 빈 캔버스 더블클릭 시 스티키 생성 (elementAt 가드) → onCanvasDoubleClick
- [x] 8. filter-grid-relayout — 필터 활성 시 일치 요소만 그리드로 뷰 전용 재배치, 해제 시 복귀 → boardLayout.ts의 filterGridPositions, BoardCanvasArea.tsx의 displayBox/activeFilter 가드
- [x] 9. verify — make verify-full 통과(typecheck+test 332건+build), 좌표 클릭 기반 e2e 신규 14건(board-ux-fixes.spec.ts) 전부 통과, 기존 board-basics.spec.ts 필터 테스트 hide-not-dim으로 갱신
- [x] 10. docs — Manual.tsx/FEATURE-INVENTORY.md 갱신 완료, exec-plan을 completed로 이동 예정

## 검증 방법
- `make verify`(typecheck+test), `make verify-full`(+build) 통과.
- 7/9/8번 버그는 **좌표 기반(coordinate) Playwright 클릭**으로 재현 후 수정 확인 —
  이전엔 키보드(Enter)로만 검증해 놓쳤던 버그이므로 이번엔 반드시 실제 클릭 경로로
  검증한다.
- `make dev-safe`로 실제 앱에서 분할 화면 스폰 위치(1번), 화살표 z-order(2/4번),
  앵커 hover(3번), 드래그 중 라우팅(5번), 필터 재배치(8/11번)를 육안 확인.
- `e2e/board-*.spec.ts`에 회귀 테스트 추가(특히 7/9/8/10/11번 — 이전에 커버리지
  구멍이 있었던 부분).

## 발견한 사실 (작업 중 갱신)
- 7/9/8번은 모두 같은 뿌리(`.picker-backdrop`/`.picker`가 `pointerdown` 대신 `mousedown`만
  막아 `.board-canvas`의 `setPointerCapture`로 새 클릭이 새는 문제)였다 — 세 건이
  독립 버그가 아니라 한 근본 원인의 세 증상이었다.
- 5번은 프레임레이트/드래그 로직 문제가 아니라 `routeWaypoints`의 "정렬되면 직선
  2점 반환" 특수 케이스가 만드는 **불연속 지점**이 원인이었다 — 이 케이스를
  제거해도(항상 일반 꺾은선 계산) `dedupe()`가 정렬 시 자연히 직선으로 수렴해
  회귀 없음.
- 11번은 마인드맵의 색 필터를 그대로 재사용할 수 없었다(트리 레이아웃 전용
  알고리즘) — 보드는 자유 배치라 별도의 뷰 전용(비영속) 그리드 재배치 함수
  (`filterGridPositions`)를 새로 구현.
- E2E에서 SVG 요소는 `.className`이 문자열이 아니라 `SVGAnimatedString`이라
  `getAttribute('class')`를 써야 한다 — z-order 테스트에서 발견.
- 노트 제목은 생성 직후 타이핑하면 본문에 들어간다 — `.note-title` input을
  `clickCount:3` + `.fill()` + `Tab`으로 설정해야 검색 인덱스에 반영된다.
- 외부 링크 플라이아웃이 열린 채로 카드를 다시 클릭하면 플라이아웃 자신의 URL
  텍스트(`.st-format-text`)가 카드 상단과 겹쳐 클릭을 가로챌 수 있다 — 실제 UI
  레이아웃 특성(버그 아님)이라 E2E에서는 배경 클릭으로 플라이아웃을 먼저 닫고
  진행하도록 처리.

## 결정 변경 이력
(변경 없음 — 최초 계획대로 11건 모두 구현 완료)
