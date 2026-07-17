# Architecture

MindMap은 **Electron + React + TypeScript** macOS 데스크탑 앱이다.
렌더러(src/)와 메인 프로세스(electron/)는 `window.api` IPC 브리지로만 통신한다.

## 계층 구조 (의존성 방향 →)

```
┌─────────────────────────────────────────────────────┐
│  Electron Main Process (electron/)                   │
│  main.ts → reminders.ts · updater.ts · logger.ts    │
│                  ↕ contextBridge (IPC)              │
│  preload.ts → window.api (타입 안전 브리지)          │
└─────────────────────────────────────────────────────┘
                        ↕ window.api
┌─────────────────────────────────────────────────────┐
│  Renderer Process (src/)                             │
│                                                      │
│  types.ts           (공유 타입, 의존성 없음)          │
│       ↓                                              │
│  io/  · theme/      (포맷 변환 · 색상 시스템)        │
│       ↓                                              │
│  store/             (Zustand 상태 — mapStore 등)     │
│       ↓                                              │
│  Domain Modules:                                     │
│    canvas/  note/  focus/  sync/  search/  layout/  │
│       ↓                                              │
│  UI Modules:                                         │
│    ui/  sidebar/  panes/  inspector/  menu/          │
│    interactions/                                     │
│       ↓                                              │
│  App.tsx            (합성 루트)                      │
└─────────────────────────────────────────────────────┘
```

## 모듈 책임

| 모듈 | 책임 | 핵심 파일 |
|---|---|---|
| `types.ts` | 공유 인터페이스 (MindNode, MindMapDoc, NoteDoc …) | `src/types.ts` |
| `io/` | 직렬화·역직렬화, Markdown/OPML 변환, 자동 이름 생성 | `formats.ts`, `noteFormat.ts` |
| `theme/` | 색상 팔레트 (시맨틱 키 → CSS 값) | `palette.ts` |
| `store/mapStore` | 노드 트리, 선택, 히스토리(undo/redo) | `mapStore.ts` |
| `store/noteStore` | 노트 인덱스, 워크스페이스 스캔 | `noteStore.ts` |
| `store/sessionStore` | 탭, 분할 패널, 세션 영속성 | `sessionStore.ts` |
| `store/uiStore` | 모달, 토스트, 업데이트 상태 | `uiStore.ts` |
| `canvas/` | SVG 엣지 + React 노드 뷰, 캔버스 오버레이 | `Canvas.tsx`, `NodeView.tsx` |
| `note/` | Tiptap 에디터, 마크다운 변환, 노드 링크 | `NoteEditor.tsx`, `markdown.tsx` |
| `focus/` | 포커스 세션 기록, 대시보드, 집계 | `FocusWidget.tsx`, `agenda.ts` |
| `sync/` | macOS Reminders 양방향 동기화 | `reminderSync.ts`, `resolveReminder.ts` |
| `layout/` | d3-hierarchy 트리 레이아웃 계산 | `treeLayout.ts`, `measure.ts` |
| `search/` | 전역 검색, Quick Open | `Search.tsx`, `GlobalSearch.tsx` |
| `electron/main.ts` | IPC 핸들러, 파일시스템, 네이티브 메뉴 | `main.ts` |
| `electron/reminders.ts` | AppleScript 드라이버 (osascript) | `reminders.ts` |
| `electron/preload.ts` | `window.api` 정의 (contextBridge) | `preload.ts` |

## 핵심 설계 결정

전체 목록·최신 상태는 [docs/decisions/README.md](docs/decisions/README.md)가 원본이다 (아래 표는 요약이며, `make harness-check`가 두 목록의 번호 일치를 강제한다).

| 결정 | 문서 |
|---|---|
| 색상 시맨틱 키 시스템 | `docs/decisions/0001-semantic-color-keys.md` |
| Reminders osascript 직렬화 | `docs/decisions/0002-reminder-osascript-serialization.md` |
| 노트 독립 파일 방식 | `docs/decisions/0003-notes-as-standalone-files.md` |
| 진입점 매트릭스 (홈·탭·분할) | `docs/decisions/0004-entrypoint-matrix.md` |
| 복사 시 reminder id 제외 | `docs/decisions/0005-copy-semantics.md` |
| 포커스 세션과 노트 이름 변경 | `docs/decisions/0006-focus-session-and-rename.md` |
| 포커스/대시보드의 위치 ("사적인 거울 + 의도된 보고서") | `docs/decisions/0007-focus-positioning.md` |
| 포커스 세션 목표·과정·결과 구조화 (노트 템플릿 폐기) | `docs/decisions/0008-focus-goal-process-result.md` |
| 노드 노트는 노드 맵과 같은 폴더에 (숨김 .notes/ 폐기) | `docs/decisions/0009-node-note-location.md` |
| 노트 이미지 첨부 폴더를 진짜 숨김 폴더로 | `docs/decisions/0010-note-image-assets-hidden-folder.md` |
| 기능의 3가지 축: 정리·실행·통찰 | `docs/decisions/0011-three-axis-thinking-model.md` |
| 노드 지속시간 필드(durationMin) — version 무범프 선택 필드 | `docs/decisions/0012-node-duration-field.md` |
| 온보딩은 기능 안정화 후 도입 (조기 코치 제거) | `docs/decisions/0013-onboarding-after-features-stable.md` |
| 완료·일정·집중은 할 일(todo) 노드 전용 (0011 실행 그룹 개정) | `docs/decisions/0014-todo-node.md` |
| 집중 게이트 해제 — 일정과 집중은 독립 기능 (0011 §3 완화) | `docs/decisions/0015-focus-independent-of-schedule.md` |

## 경계 규칙 (기계적으로 강제)

1. **IPC 전용 통신**: `src/`는 `electron/`을 직접 import하지 않는다. `window.api`만 사용.
2. **Store 직접 참조 금지**: 다른 도메인의 store를 직접 import하지 않는다. `App.tsx` 조합 지점만 예외.
3. **외부 입력 경계 검증**: IPC 응답·파일 내용은 `io/` 또는 `preload.ts` 타입 경계에서 검증.
4. **reminder 불변 조건**: `reminderOn/reminderId`는 항상 함께 설정·제거한다.

## 데이터 플로우

```
파일 (.mind) ──읽기──▶ electron/main.ts (fs.readFile)
                              ↓ IPC
                    preload.ts → window.api.readFile
                              ↓
                    src/io/formats.ts (parse)
                              ↓
                    mapStore.loadDoc()
                              ↓
                    canvas/ + sidebar/ + note/ 렌더링

사용자 편집 ──────▶ mapStore (mutations)
                              ↓
                    dirty = true → App.tsx 자동 저장
                              ↓
                    io/formats.ts (serialize)
                              ↓
                    window.api.save() → electron/main.ts (fs.writeFile)
```

## 비고

- **E2E 격리**: `MINDMAP_USER_DATA` 환경변수로 userData 경로를 오버라이드해 실제 사용자 데이터와 분리.
- **로컬 파일 중심**: iCloud Drive 등 폴더 동기화는 사용자 몫. 앱은 서버 통신 없음.
- **단일 arch**: 현재 macOS arm64 전용 (electron-builder 설정 기준).
