# Smart Views (오늘 · 최근 수정 · 즐겨찾기)
날짜: 2026-07-10
상태: completed

> REDESIGN-VISION-2026-07.md §3-3. Apple Notes의 Smart Folder 패턴 — 특수 UI를 새로 만들지 않고
> 사이드바 트리와 시각적으로 같은 평범한 행으로 보여준다.

## 목표

사이드바 상단 `.sb-nav` 블록(현재 "오늘"/"집중 기록")에 "최근 수정"과 "즐겨찾기" 두 행을 추가해
가벼운 탐색 진입점을 늘린다. 새 UI 패턴을 만들지 않고 기존 오버레이 패널(TodayView/HistoryView)
스타일을 그대로 재사용한다.

## 범위 (포함)

1. **최근 수정**: `TreeNode`에 `mtimeMs?: number` 추가(`workspace:tree` 응답 확장, 기존 채널 유지) →
   파일만 모아 mtime 내림차순 상위 20개를 보여주는 `RecentView` 오버레이.
2. **즐겨찾기**: 새 hidden 워크스페이스 파일 `.pins.json`(`.trash/.trashmeta.json`과 동일한 전례) +
   새 IPC 채널 `pins.list`/`pins.toggle` + 새 store `src/store/pinStore.ts` + 사이드바 행의
   `row-actions`에 별 아이콘 토글 버튼 + `FavoritesView` 오버레이.
3. `.sb-nav`에 두 행 추가. 기존 "오늘"/"집중 기록" 행은 이미 트리와 시각적으로 동일한
   평범한 행(`sb-nav-item`)이라 재스킨이 필요 없음 — 확인됨(`src/styles.css:605-627`).

## 범위 (제외)

- 사용자 정의 스마트 폴더(저장된 쿼리) — v1은 고정 3개 뷰만.
- 폴더 즐겨찾기 — 파일(노트·맵)만 대상.
- 휴지통 이동/삭제된 파일의 핀 자동 정리는 에러 없이 조용히 필터링(다음 `pins:list` 시 죽은 경로 제외).

## 아키텍처 결정

### IPC (nested 컨벤션 — `templates.*`와 동일 스타일)
```ts
// preload.ts
pins: {
  list: (): Promise<string[]> => ipcRenderer.invoke('pins:list'),
  toggle: (path: string): Promise<string[]> => ipcRenderer.invoke('pins:toggle', path),
}
```
- `pins:toggle`은 `assertInsideWorkspace()`로 경로를 검증한 뒤 `.pins.json`의 `paths` 배열에서
  추가/제거하고 갱신된 전체 목록을 반환한다(트래시의 `.trashmeta.json` 패턴과 동일).
- `pins:list`는 저장된 경로 중 현재 존재하지 않는 파일을 걸러내고 반환한다(고아 핀 자동 정리).

### mtime
- `walk()`에서 파일 엔트리에 한해 `fs.stat`으로 `mtimeMs`를 채운다(디렉터리는 불필요 — 제외).
- 기존 `workspace:tree` 채널의 응답 필드 추가이므로 새 채널이 아니다. 프런트는
  `workspaceStore.tree`를 그대로 쓰고, "최근 수정" 계산은 파생 헬퍼(`recentFiles(tree, n)`,
  `src/sidebar/smartViews.ts`)로 처리 — 별도 store 불필요.

### 즐겨찾기 store
```ts
// src/store/pinStore.ts — templateStore.ts와 동일한 얕은 zustand 패턴
usePins: { paths: string[]; refresh(): Promise<void>; toggle(path: string): Promise<void> }
```

## 검증 방법

- 단위: `smartViews.ts`의 `recentFiles()` 순수 함수 테스트(정렬·상위 N·디렉터리 제외).
- E2E: 파일 수정 → "최근 수정"에 상위 노출, 별 토글 → "즐겨찾기"에 노출/해제, 재시작 후 핀 유지.
- `make verify` (typecheck + unit), `make dev-safe` 라이트/다크 육안 확인.

## 발견한 사실 (작업 중 갱신)

- 계획대로 `.sb-nav-item`은 이미 트리와 시각적으로 동일해 재스킨 작업이 불필요했다 — 두 행만 추가.
- 즐겨찾기/최근 수정 패널은 `TemplatePanel`/`TrashPanel`이 쓰는 `.wh-backdrop`/`.trash-panel`/`.trash-row`
  셸을 그대로 재사용해 새 CSS 없이 완성 — §3-5(통합 시트)가 의도한 결과를 부분적으로 이미 달성.
- 별표 아이콘 pinned 상태는 새 hue 대신 `fill: currentColor`(윤곽선→채움)로 표현해 상태색 7개
  하드 예약 규칙과 충돌을 피함.

## 검증 결과

- `npm test` — smartViews.test.ts 3건 포함 전체 통과.
- `npx playwright test` — smart-views.spec.ts 3건 포함 21건 전체 통과.
- `make dev-safe` 실행 앱에서 라이트/다크 모드 스크린샷으로 별표 토글·최근 수정·즐겨찾기 패널 육안 확인.

## 결정 변경 이력

- (없음)
