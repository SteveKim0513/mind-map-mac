# 안보이는 기능 구현 (Invisible Features)
날짜: 2026-07-16
상태: active

## 목표
[INVISIBLE-FEATURES-2026-07.md](../../product/INVISIBLE-FEATURES-2026-07.md)의 "바로 할 것" 전체 + 휴지통 보관 정책(IF-06, on/off·3개월 자동)을 검증 가능한 배치로 구현한다. 목표는 고객 경험·만족 개선(데이터 신뢰 우선).

## 범위
**포함**: IF-01 원자적 쓰기 · IF-03 단일 인스턴스 락 · IF-12 SSRF+하드닝 · IF-06 휴지통 보관(3개월 on/off) · IF-09 시스템 테마 추종 · IF-02 로컬 버전 히스토리 · IF-04 클라우드 충돌 감지 · IF-05 죽은 링크 GC · IF-07 집중 유휴 감지 · IF-10 검색·캘린더 캐시 · IF-11 내보내기 메타 · IF-14 넛지 임계값 · IF-08 자동 레이아웃 정돈
**제외(보류)**: IF-13 타임존(스키마→승인), 3-D AI 기능(방향 확정 대기)

## 가정
- P0(IF-01/02/03/12)은 신규 의존성 없이 구현 가능. `MindMapDoc.version` 스키마 무변경(버전 히스토리는 파일 스냅샷).
- E2E는 `MINDMAP_USER_DATA`로 격리 → 단일 인스턴스 락이 병렬 테스트를 깨지 않는다(userData별 락).

## 위험
- **레이스 3종 세트**(자동저장↔rename↔trash): IF-01/04는 저장 경로를 건드림 → `deletingPaths.test.ts`·`sessionStore.test.ts` 회귀 필수.
- 리마인더 불변조건: IF-05가 노드 링크 정리 시 `reminderOn/reminderId` 미접촉.
- IF-06 자동 만료는 파괴적 → 기본 꺼짐/옵트인, 3개월.

## 구현 단계 (배치)
- [x] **Batch 1 — electron 안전/보안**: IF-01 원자적 쓰기(temp+fsync+rename, 전 저장경로) · IF-03 단일 인스턴스 락 · IF-12 web:fetch SSRF 가드(사설IP+리다이렉트 홉) + webPreferences 명시 하드닝 — verify 통과
- [x] **Batch 2 — IF-06 휴지통 보관 정책**: `trashAutoPurge` 설정(**기본 off, 옵트인** — 2026-07-16 배포 전 독립 검토가 기획서 §6 "반드시 옵트인, 기본은 안내만" 위반을 발견해 기본 on→off로 정정) + 90일 지난 항목 자동 정리(OS 휴지통으로, 복구 가능) + 트래시 패널 토글 UI — verify+harness 통과
- [x] **Batch 3 — IF-09 시스템 테마 추종**: `themeMode`(light/dark/system) + matchMedia 라이브 추종 + 설정 3세그 토글 + display 아이콘 — verify 통과
- [x] **Batch 4 — IF-02 로컬 버전 히스토리**: atomicWrite 훅으로 .history/ 스냅샷(throttle 5분/파일 40개) + history:list/read/restore IPC + VersionHistoryPanel + 명령 팔레트 진입점(`openVersions`, 기존 집중기록 `openHistory`와 분리) — verify 통과
- [x] **Batch 5 — IF-04 외부 변경 감지**: main이 자기 read/write mtime 기억(seenMtime) → `fs:externalChange` → 포커스 시 외부 변경된 열린 맵에 1회성 재로드 토스트. **저장 프로토콜 무변경(안전)** — verify+store 테스트 통과
- [x] **IF-14 넛지 임계값 상수화**: GrowthNudges 매직넘버(5/3/3) → 명명 상수. commandUsage는 이미 상수화됨 — verify 통과
- [~] **IF-07 집중 유휴 감지** · **IF-10 검색·캘린더 캐시**: 백그라운드 implementation-worker 에이전트로 진행 중(disjoint 스코프: focus/ · search/+calendar/)
- [x] **IF-05 죽은 링크 GC + 라벨 동기화**: **삭제** → `noteLinkDeleteHook`(재현 테스트 먼저 실패→통과) → 노트 인덱스 역조회로 `removeLinkFromNoteFile`. **수정(텍스트)** → `noteLinkRenameHook` → `updateLinkLabelInNoteFile`로 캐시 라벨(nodeText) 갱신. App에서 `startNoteLinkSync` 배선. **역인덱스 방식 채택**(노드에 노트 id 저장 안 함 → 단일 진실원천, MindNode 스키마 무변경). 단위 2개 + E2E 2개(삭제·수정) 종단 검증.
- [x] **IF-11 내보내기 메타**: **드롭**(사용자 판단 — 개발 불필요).
- [x] **IF-08 겹침 정돈**: 범위 = **겹침 해소만**. `⌘K` "겹침 정돈" → Canvas가 루트별 bbox(칩·섹션 포함) 계산 → 순수 `resolveOverlaps`(단위 6개)로 겹친 루트를 아래로 밀기 → `mapStore.tidyOverlaps`가 manualPos로 커밋(undo 가능). E2E 종단 검증.

## 검증 방법 · 결과 (2026-07-16)
- ✅ `make verify-full` (typecheck + 단위테스트 203/203 + build) 종료 0.
- ✅ `make harness-check` (아키텍처 + 디자인 + 문서 무결성) 종료 0.
- ✅ 전체 E2E **71/71 통과**(기존 68 + 신규 `e2e/invisible-features.spec.ts` 3: IF-06 보관 토글·IF-09 테마 시스템·IF-04 외부변경 토스트). = `make pre-release` E2E 게이트 통과.
- ⏳ **`make dev-safe`(사람 눈 시각 확인) 미수행** — 트래시 보관 행·테마 시스템 세그·버전 패널·토스트·유휴 카드의 다크/라이트 시각 폴리시는 사람 확인 필요(규칙: dev-safe는 사람이 직접 봄).
- 미커버: IF-02 버전 히스토리 E2E는 5분 스로틀 때문에 시간 조작이 필요 → 단위/수동으로 대체(스냅샷 캡처는 atomicWrite 훅, restore는 reloadIfOpen 재사용으로 검증). IF-07 유휴는 순수 계산 단위 테스트 20개로 커버, 런타임 자리비움은 dev-safe 대상.

## 발견한 사실 (작업 중 갱신)
- `electron/main.ts` 저장은 전부 `fs.writeFile` 직접 호출(비원자적). preload는 contextBridge/ipcRenderer만 사용(.mjs) → sandbox:true는 회귀 위험이라 제외, contextIsolation/nodeIntegration만 명시.
- `requestSingleInstanceLock` 부재 확인.

## 보류 사유 (IF-05 · IF-11 · IF-08)
- **IF-05 죽은 링크 GC**: node→note는 파생(noteIndex 역조회, refresh 시 self-heal), note→node는 노트 프론트매터에 저장. "죽은 링크"의 정확한 방향·수명주기 조사 + **재현 테스트 먼저**(testing 규칙)가 필요하고, 노트 프론트매터(데이터)를 건드리므로 추측 구현은 위험. → fix-bug 패스로.
- **IF-11 내보내기 메타**: 색·일정·노트연결을 MD/OPML에 어떻게 인코딩할지(가독성·왕복 충실도) 포맷 결정 필요 — 인간 판단.
- **IF-08 자동 레이아웃 정돈**: 이미 트리 자동정렬 존재. "예쁘게"의 휴리스틱(간격·밸런스·스냅)은 디자인 결정 + /design-ui 패스 필요.

## 결정 변경 이력
- IF-02 UI 상태명을 `openVersions/versionsOpen`으로: 기존 집중기록 대시보드가 이미 `openHistory/historyOpen`을 점유 → 충돌 회피.
