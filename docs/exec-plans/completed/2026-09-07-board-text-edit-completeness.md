# 보드 스티키 텍스트 편집 완성도 3건

날짜: 2026-09-07
상태: completed

## 목표

사용자가 보고한 "텍스트 편집 중 스크롤이 보드 전체를 같이 움직이는" 문제를 근본 원인부터
고치고, 같은 코드 경로를 감사하는 과정에서 발견한 두 건(실행취소 과다 기록, Escape 취소 불가)을
함께 고쳐 스티키 텍스트 편집의 완성도를 마인드맵 노드 편집 수준으로 맞춘다.

## 범위 (포함 / 제외)

포함: 스티키 메인 텍스트(`BoardElementView.tsx`의 `.board-el-input`, `editingField==='text'`)와
"텍스트 박스 추가"로 쌓는 `notes[]` 블록(같은 컴포넌트, `editingField==='note'`) — 이 두 텍스트
편집 표면에서 발견된 3건.

제외: 커넥터 라벨 입력(`board-label-input`)·외부 링크 입력(`st-link-input`) — 아래 "가정"에서
설명하듯 이번 3건과 무관(이미 blur 시 1회만 커밋).

## 현재 상태 · 원인 분석 (항목별)

### A. (사용자 보고) 텍스트 편집 중 스크롤이 보드 전체를 같이 움직임

- `BoardElementView.tsx:111-119`(메인 텍스트)와 `:245-253`(`notes[]` 블록) 두 `<textarea>`
  모두 `onPointerDown={(e) => e.stopPropagation()}`는 있지만 **`onWheel`은 없다.**
- `<textarea>`는 내용이 넘치면 브라우저 기본 동작으로 자체 스크롤한다(CSS `overflow` 지정과
  무관 — textarea 고유 동작). 그 안에서 휠을 굴리면 이벤트가 `.board-canvas`까지 버블링해
  `onWheel`(`BoardCanvasArea.tsx:267-281`, 조건 없이 항상 pan/zoom)이 캔버스를 같이 움직인다.
- **이전 두 라운드에서 이미 두 번 고친 것과 정확히 같은 버그 클래스**(피커의 pointerdown,
  피커의 keydown)의 세 번째 사례 — "이벤트 타입 하나만 막고 다른 타입은 안 막음"이 반복되는
  패턴. `styles.css`를 훑어봐도 board 관련 클래스 중 `overflow: auto/scroll`을 쓰는 곳은
  없음(전부 `overflow: hidden`이거나 미지정) — 이 두 `<textarea>`가 board 안에서 자체
  스크롤을 갖는 **유일한** 지점이라 다른 곳엔 같은 버그가 없음(감사 완료).
- 마인드맵 쪽은 노드 편집이 `contentEditable`(내용에 맞춰 박스가 늘어남, `NodeView.tsx:462`
  주석)이라 애초에 고정 높이 스크롤이 발생하지 않음 — 같은 문제가 구조적으로 없다.

### B. (감사 중 발견, 심각) 텍스트 편집이 키 입력마다 실행취소 기록을 하나씩 쌓음

- `BoardCanvasArea.tsx:818`(`onTextChange={(text) => updateElement(id, { text })}`)와
  `BoardElementView.tsx:250`(`onNoteChange`, 같은 경로) — **제어 컴포넌트**(`value={el.text}`)라
  `onChange`가 키 입력마다 발화하고, 그때마다 `updateElement`를 호출한다.
- 직전 라운드에서 추가한 `boardStore.ts`의 undo 히스토리는 `updateElement`가 트랜잭션
  (`beginDrag`/`endDrag`) 밖에서 호출되면 **호출마다** `past`에 스냅샷을 쌓는다(드래그처럼
  연속 호출을 하나로 묶는 장치가 텍스트 편집엔 없음). 즉 문장 하나를 타이핑하면 글자 수만큼
  undo 스텝이 생겨, `⌘Z`를 눌러도 한 글자씩만 되돌아간다 — **직전에 만든 실행취소 기능
  자체의 신뢰도를 깎는 문제**라 우선순위가 높다.
- 마인드맵 쪽은 정반대로 설계돼 있다: `NodeView.tsx`의 편집기는 `contentEditable`이라
  DOM에만 임시로 타이핑되고, `mapStore.ts:376`의 `commitText(id, text)`가 **blur/Enter
  시점에 한 번만** 호출돼 히스토리도 한 번만 쌓인다(`store/mapStore.ts` "commit" 패턴).
  스티키는 이 패턴을 안 따르고 제어 컴포넌트 + 매 키 입력 커밋 방식이라 undo 인프라와
  어긋난다.

### C. (감사 중 발견) 스티키 텍스트 편집 중 Escape로 취소가 안 됨

- 두 `<textarea>` 모두 `onKeyDown`이 아예 없다. Escape를 누르면 이벤트가
  `.board-canvas`의 전역 `onKeyDown`(`BoardCanvasArea.tsx:650`)까지 버블링하지만, 그
  핸들러 첫 줄이 `if (editingTarget || editingLabelId) return;`라 편집 중엔 아무것도 안
  한다 — **Escape가 정말 아무 일도 하지 않는다.** 편집을 취소하려면 클릭으로 포커스를
  빼는 수밖에 없는데, 그러면 `onBlur`가 그대로 커밋해버려 "취소"가 원천적으로 불가능하다.
- 마인드맵은 `NodeView.tsx:452,523`에서 Escape를 명시적으로 잡아 `cancelEdit`(원래 텍스트로
  복원)을 호출한다 — 스티키만 이 표준 편집 UX(Escape=취소)가 빠져 있다.

## 세 건이 하나의 인프라 수정으로 함께 풀리는 이유

B를 고치려면 "편집 세션 전체를 트랜잭션으로 묶어 커밋은 한 번만"이 필요하고, 이건 이미
`boardStore.ts`의 `beginDrag`/`endDrag`(드래그 제스처를 undo 한 스텝으로 묶던 바로 그 장치)와
**완전히 같은 메커니즘**이다. 이름만 드래그 전용처럼 돼 있을 뿐 구현은 이미 범용(진입 시
`board` 스냅샷을 클로저에 잡아두고, 종료 시 실제로 바뀌었으면 그 스냅샷 하나만 `past`에
push)이라, 텍스트 편집에도 그대로 재사용 가능하다.

C(Escape 취소)도 같은 장치로 거의 공짜로 풀린다 — `beginDrag`가 잡아둔 진입 시점 스냅샷을
그대로 복원하는 `cancelDrag()`(가칭)만 추가하면, Escape 시 "편집 시작 전 텍스트로 즉시 복원"이
된다(별도의 "원래 텍스트" 저장 로직을 새로 안 만들어도 됨).

**제안하는 인프라 변경**: `beginDrag`/`endDrag`를 `beginTransaction`/`endTransaction`으로
개명(드래그 전용이 아님을 이름에 반영)하고, 되돌리기 전용 `cancelTransaction()`을 추가한다
(진입 시점 스냅샷으로 즉시 복원, 히스토리에 아무것도 안 남김). 드래그 쪽 호출부는 이름만
바뀌고 동작은 그대로.

## 가정

- 커넥터 라벨 입력·외부 링크 입력은 이미 `onBlur`에서만 커밋(`onChange` 없음)이라 B의
  "키 입력마다 히스토리" 문제가 없다 — 확인 완료, 이번 수정 대상에서 제외.
- 두 입력 모두 Escape가 "취소"가 아니라 "현재 값으로 커밋"인 점(C와 유사한 아쉬움)은 있지만,
  한 줄짜리 짧은 값이라 되돌릴 게 사실상 없는 경우가 대부분 — 우선순위 낮음, 이번 범위에서
  제외(향후 필요하면 별도 계획).

## 위험

- `beginTransaction`/`cancelTransaction`을 텍스트 편집에 붙일 때, 편집 시작 시점을 정확히
  잡아야 한다(더블클릭으로 편집 진입하는 순간 1회만 `beginTransaction`, 이후 매 키 입력에서
  다시 부르면 안 됨 — 진입 시점에만 호출).
- Escape → `cancelTransaction()` → 프로그램적으로 `blur()` 흐름에서, 뒤이어 발생하는
  `onBlur`가 `endTransaction()`을 또 호출해도 안전해야 한다(이미 `inTransaction` 가드가
  false일 때 조용히 no-op이므로 안전 — 코드 변경 불필요, 확인만).
- `notes[]` 블록은 여러 개가 동시에 존재할 수 있어 편집 대상이 바뀔 때(한 블록 편집 종료 →
  다른 블록 편집 시작) 트랜잭션이 겹치지 않고 순서대로 열고 닫히는지 확인 필요.

## 구현 단계
<!-- 상태 마커: [ ] pending · [>] in-progress · [x] completed · [!] blocked · [e] error -->
- [x] 1. rename-transaction-api — boardStore.ts의 beginDrag/endDrag를 beginTransaction/endTransaction으로 개명, cancelTransaction() 추가(진입 스냅샷으로 즉시 복원, 히스토리 미기록). 드래그 호출부(BoardCanvasArea.tsx) 이름만 갱신 → 완료
- [x] 2. text-edit-one-history-step — 스티키 메인 텍스트 편집 진입 시 beginTransaction(), onFieldBlur에서 endTransaction() — notes[] 블록도 동일 → 완료 (beginEditingTarget/endEditingTarget 래퍼로 6개 진입 지점 통일)
- [x] 3. text-edit-escape-cancel — 두 textarea에 onKeyDown 추가: Escape → cancelTransaction() + blur() → 완료
- [x] 4. text-edit-wheel-fix — 두 textarea에 onWheel={(e) => e.stopPropagation()} 추가(사용자 보고 버그) → 완료, 되돌려서 회귀 재현 확인함
- [x] 5. verify — 유닛 테스트 4건 추가(플러딩 방지·undo 1스텝·cancelTransaction·이중 endTransaction 안전성), e2e 3건 추가(스크롤 미전파 ×2·Escape 취소), make verify-full, make e2e-tag tag=@board → 완료
- [x] 6. docs — FEATURE-INVENTORY.md/Manual.tsx 갱신(Escape 취소 언급 추가), 계획을 completed로 이동 → 완료

## 검증 방법

- 유닛: `updateElement`를 N번(타이핑 시뮬레이션) 호출 후 `past.length`가 편집 시작 전과
  비교해 정확히 1만 늘었는지, `undo()` 한 번으로 편집 시작 전 텍스트로 정확히 복귀하는지.
- 유닛: `cancelTransaction()` 호출 시 `board`가 진입 시점 스냅샷과 동일 참조로 복원되고
  `past`/`future`는 변화 없는지.
- E2E: 긴 텍스트를 스티키에 입력한 뒤 텍스트 영역 안에서 실제 마우스 휠 이벤트를 보내
  캔버스의 pan(`view.panY`/화면상 다른 요소 위치)이 변하지 않는지 좌표 기반으로 검증.
- E2E: 스티키를 더블클릭해 편집 진입 → 타이핑 → Escape → 원래 텍스트(또는 빈 텍스트, 신규
  스티키의 경우)로 복귀했는지, 그리고 그 조작이 undo 히스토리에 아무것도 안 남겼는지.
- `make dev-safe`로 실제 앱에서 긴 텍스트 스크롤·Escape 취소·undo 한 번에 문장 전체 복귀를
  육안 확인.

## 발견한 사실 (작업 중 갱신)
- `beginDrag`/`endDrag`를 텍스트 편집에도 그대로 재사용할 수 있었던 건, boardStore의
  트랜잭션 장치가 애초에 "드래그"라는 개념에 묶여 있지 않고 "진입 시점 스냅샷 → 종료 시
  변화 있으면 커밋"이라는 범용 로직으로 짜여 있었기 때문 — 이름만 드래그 전용처럼 보였을 뿐.
- 편집 진입 지점이 6곳(더블클릭·연결점 클릭·빈 캔버스 드롭·키보드 화살표로 생성·Enter·
  "텍스트 박스 추가")이나 흩어져 있어, 각각에 `beginTransaction()`을 개별로 추가하는 대신
  `beginEditingTarget`/`endEditingTarget` 래퍼로 한 곳에 모아 실수로 빠뜨릴 위험을 없앴다.
- E2E 작성 중 발견(버그 아님, 테스트 실수): "텍스트 박스 추가" 버튼은 클릭 즉시 새 블록을
  편집 모드로 연다(자동 focus) — 그 위에 다시 더블클릭하면 이미 포커스된 textarea가
  blur→재포커스 과정에서 사라지는 것처럼 보이는 현상 발생. 실제 사용자가 방금 자동으로
  열린 빈 편집창을 굳이 다시 더블클릭할 일은 없어 실사용 버그로 보진 않지만, 빈 텍스트
  블록의 클릭 판정 영역이 좁아 오클릭 여지가 있다는 점은 참고로 남겨둔다(이번 범위 밖).
- 항목 A(스크롤 버블링) 수정 검증: 픽스를 되돌려 `translate(0px, -300px)`로 실제 팬이
  발생함을 확인한 뒤 복구 — 거짓 통과가 아님을 검증.

## 결정 변경 이력
(없음 — 계획대로 3건 모두 구현, 인프라 개명 1건 포함)
