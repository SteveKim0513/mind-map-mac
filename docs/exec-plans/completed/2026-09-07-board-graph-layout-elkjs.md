# 보드 "정리"를 elkjs 그래프 레이아웃으로 교체

날짜: 2026-09-07
상태: completed

## 목표

"자동 정렬이 노드끼리 가까운 곳에 붙이기만 해서 관계도(교차 연결이 많은 진짜 그래프)가
오히려 더 안 보인다"는 피드백에 따라, 트리 전용이던 "정리"를 실제 그래프 레이아웃
알고리즘(elkjs의 layered/Sugiyama)으로 교체한다. 사용자 확인 완료(2026-09-07): 이
보드는 실제로 교차 연결이 많은 관계도이고, elkjs 도입 + 상업적 사용 가능 여부 확인 후
"적용해보자"로 진행 승인받음.

## 왜 지난 라운드(2026-09-07, 방향 인식 재설계)로는 부족한가

지난 라운드는 "각 자식이 연결 방향을 따라간다"는 **트리 전용** 개선이었다 — 선택한
루트에서 BFS로 각 요소를 **한 번만** 방문하고(첫 번째로 도달한 경로만 인정), 그 외
간선(다중 부모, 교차 연결)은 위치 계산에 전혀 반영하지 않았다. 실제로 한 스티키가
여러 스티키와 동시에 연결되는 진짜 관계도에서는 이 "무시된 간선"들이 재배치 후에도
아무 데나 이어져 서로 겹치고 꼬인다 — 애초에 "간선 교차 최소화"가 목표에 없는
알고리즘이라 어떻게 손봐도 이 문제는 못 푼다.

## 조사 결과

- **elkjs**(Eclipse Layout Kernel의 JS 포트) — `layered`(Sugiyama) 알고리즘이 정확히
  이 문제(방향 그래프의 계층화 + 교차 최소화)를 위해 설계됨. Cycle Breaking → Layer
  Assignment → **Crossing Minimization** → Node Placement → Edge Routing 5단계.
- **라이선스**: `EPL-2.0 OR GPL-3.0-or-later` — 라이브러리를 그대로 가져다 쓰는(수정
  없이 의존성으로 import) 경우 이 앱을 오픈소스로 공개할 의무 없음. 카피레프트는
  elkjs 자체 소스를 수정해 배포할 때만 적용. 상업적 폐쇄소스 배포에 흔히 쓰이는
  라이선스(Eclipse 계열)라 승인 완료.
- **의존성**: `npm view elkjs`로 확인 — **transitive dependency 0개**(`deps: none`).
  `npm install` 후 `npm audit`에서 elkjs 자체는 취약점 0건(기존 59건은 다른 653개
  패키지에 이미 있던 것 — 이번 설치로 새로 생긴 게 아님, lockfile diff로 확인).
- **번들 크기**: `elk.bundled.js` 실측 약 1.5MB(gzip 약 458KB) — 이 앱 현재 메인
  번들(1.3MB/420KB gzip)과 맞먹는 크기. 데스크톱(Electron) 앱이라 네트워크 다운로드가
  아니라 로컬 디스크 읽기지만, 앱 시작 속도에 영향 없도록 **"정리" 클릭 시에만
  `await import('elkjs/lib/elk.bundled.js')`로 지연 로드**(Vite가 자동으로 별도
  청크로 code-split).
- **동작 환경**: Node(CLI로 직접 실행) + 브라우저 어느 쪽에서도 Worker 없이 동작 확인
  (번들 빌드가 동기적으로 in-process 실행됨 — Electron 렌더러/Vitest 둘 다 안전).

## 설계

- `boardLayout.ts`의 기존 `autoLayoutPositions`(방향 인식 BFS 트리 알고리즘)를
  **삭제하고** 새 `layoutConnectedCluster(rootId, elements): Promise<{id,x,y}[]>`로
  교체.
- **클러스터 판별**: 선택한 요소에서 커넥터를 **양방향**(들어오는·나가는 모두)으로
  타고 도달 가능한 모든 박스 요소를 하나의 클러스터로 묶는다(관계도는 화살표 방향과
  무관하게 "관련된 모든 것"을 보고 싶어함 — 기존의 "나가는 방향만" 제한을 없앰).
- 클러스터 안의 모든 박스를 elkjs 그래프의 `children`으로, 클러스터 안 양 끝이 모두
  포함된 모든 커넥터를 `edges`로 넘긴다(무시되는 간선 없음 — 이번 개선의 핵심).
- `layoutOptions`: `elk.algorithm: 'layered'`, `elk.direction: 'RIGHT'`,
  `elk.edgeRouting: 'ORTHOGONAL'`(보드의 기존 직각 화살표 렌더링과 시각적으로 맞춤),
  간격은 기존 상수(`PRIMARY_GAP`=96, `CROSS_GAP`=32) 재사용.
- 결과 좌표는 elkjs 자체 좌표계이므로, **선택한 루트의 결과 위치가 루트의 현재 실제
  위치와 일치하도록 오프셋을 계산**해 전체를 평행 이동(기존처럼 루트 자신의 위치는
  고정된 것처럼 보이게).
- `BoardCanvasArea.tsx`의 `tidySelected()`는 내부적으로 비동기 처리(elkjs가
  Promise 반환) — 외부 인터페이스(`BoardCanvasHandle.tidySelected: () => void`)는
  그대로 두고 내부에서 `void (async () => {...})()`로 감싼다.

## 범위 (포함 / 제외)

포함: `boardLayout.ts`의 `autoLayoutPositions` → `layoutConnectedCluster` 전면 교체,
클러스터 판별을 양방향으로 확장, elkjs 지연 로드 배선.

제외: 라우팅 스타일(직각) 자체는 유지(직전 라운드에서 이미 확정). 필터 그리드
(`filterGridPositions`)는 무관 — 그대로 유지.

## 위험

- `boardLayout.test.ts`의 기존 `autoLayoutPositions` 테스트 16건은 삭제되는 함수를
  테스트하므로 전부 새 함수 기준으로 재작성 필요 — 비동기 함수라 `await` 필요.
- elkjs 레이아웃 결과가 결정적(deterministic)인지 확인 필요 — 같은 입력에 같은 출력이
  나와야 테스트가 안정적. (같은 그래프·같은 옵션이면 elkjs는 결정적 — 무작위성 없는
  휴리스틱이라 안전할 것으로 예상, 테스트로 검증)
- "정리" 버튼이 이제 비동기라 매우 큰 그래프에서 UI가 잠깐 멈출 수 있음 — 이번
  범위에서는 로딩 인디케이터 없이 진행(사용자 보드 규모상 체감 지연 위험 낮다고 판단,
  필요시 후속 과제로 남김).

## 구현 단계
<!-- 상태 마커: [ ] pending · [>] in-progress · [x] completed · [!] blocked · [e] error -->
- [x] 1. install-elkjs — npm install elkjs, package.json/lockfile 반영 확인 → 완료, deps:0, 취약점 0건(lockfile diff로 확인)
- [x] 2. layout-connected-cluster — boardLayout.ts에 layoutConnectedCluster 구현, autoLayoutPositions 삭제 → 완료, 지연 로드(dynamic import) 확인 — 빌드 산출물에 elk.bundled 청크 별도 분리됨
- [x] 3. wire-async-tidy — BoardCanvasArea.tsx의 tidySelected를 비동기 처리로 배선 → 완료
- [x] 4. tests — boardLayout.test.ts를 새 함수 기준으로 재작성(교차 연결 케이스 포함) → 완료, 12건(다이아몬드·결정성·양방향 도달성 포함)
- [x] 5. verify — make verify-full, e2e(교차 연결 있는 그래프를 정리했을 때 겹치는 화살표가 줄어드는지), make e2e-tag tag=@board → 완료, 51/51
- [x] 6. docs — FEATURE-INVENTORY.md/Manual.tsx 갱신, 계획을 completed로 이동 → 완료

## 검증 방법

- 유닛: 간단한 트리 케이스(기존 동작 유지 확인) + 다이아몬드/교차 연결 케이스(여러
  간선이 실제로 layoutOptions에 반영되는지 — elkjs 반환 그래프의 edges 배열 길이로
  확인) + 결정성(같은 입력 두 번 호출 시 같은 좌표).
- E2E: 스티키 3개 이상을 서로 교차 연결한 뒤 "정리"를 눌러 화면상 겹침이 줄었는지
  (정확한 "교차 0"을 E2E로 검증하긴 어려우니, 최소한 "모든 요소가 서로 다른 위치로
  이동했고 화면 밖으로 튀지 않았는지" 정도로 회귀 방지선을 긋는다).
- `make dev-safe`로 실제 관계도(교차 연결 여러 개)를 만들어 "정리" 결과를 육안 확인.

## 발견한 사실 (작업 중 갱신)
- elk.bundled.js는 Node(CLI 직접 실행)와 브라우저 어느 쪽에서도 Worker 없이 동기적으로
  in-process 실행됨을 실제로 확인 — Vitest(Node 환경)에서 별도 폴리필/설정 없이 바로
  동작했다.
- 기존 E2E 도우미(`addAndNameSticky` 패턴)를 여러 스티키에 반복 사용하면 새 스티키가
  이전 스티키와 겹치는 위치에 스폰돼(뷰포트 중앙 지터) 이름으로 특정 스티키를 클릭하는
  게 불가능해진다는 걸 새로 발견 — 생성 직후 명시적 좌표로 드래그해 흩어놓는
  `addStickyAt` 헬퍼로 교체해 해결(`board-graph-layout-elkjs.spec.ts`).
- "정리"가 비동기가 되면서 기존 `board-power-features.spec.ts`의 정리 테스트가
  클릭 직후 바로 위치를 읽어 우연히(Playwright 자체 오버헤드로 타이밍이 맞아떨어져)
  통과하고 있었다 — 실제로는 잠재적 flaky였음, `waitForTimeout(500)` 추가로 안정화.
- 직전 라운드(같은 날, 방향 인식 재설계)의 두 E2E 테스트는 이번 알고리즘 교체로
  가정 자체가 깨져(더 이상 방향을 보존하지 않음) 삭제 — 새 파일
  `board-graph-layout-elkjs.spec.ts`로 관련 검증을 이전.

## 결정 변경 이력
- 2026-09-07: 지난 라운드의 "방향 인식 트리 레이아웃"(`autoLayoutPositions`)을
  이번 라운드에서 완전히 대체(삭제)하기로 결정 — 실제 요구사항이 트리가 아닌 일반
  그래프의 교차 최소화임이 확인되어, 손으로 짠 트리 알고리즘으로는 근본적으로 풀 수
  없는 문제였음.
