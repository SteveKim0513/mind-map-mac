# Architecture

MindMap은 **Electron + React + TypeScript** macOS 데스크탑 앱이다.
렌더러(src/)와 메인 프로세스(electron/)는 `window.api` IPC 브리지로만 통신한다.
공유 폴더 기능에 한해 별도 패키지 `server/`(릴레이 서버)와 WebSocket/REST로 통신한다 ([결정 0021](docs/decisions/0021-shared-folder-relay.md)).

## 계층 구조 (의존성 방향 →)

```
┌─────────────────────────────────────────────────────┐
│  Electron Main Process (electron/)                   │
│  main.ts → reminders.ts · updater.ts · logger.ts    │
│          share.ts · notifications.ts (공유 폴더)     │
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
│    canvas/  note/  board/  focus/  sync/  search/    │
│    layout/  share/ (공유 폴더: 릴레이 연결·복제)      │
│       ↓                                              │
│  UI Modules:                                         │
│    ui/  sidebar/  panes/  inspector/  menu/          │
│    interactions/                                     │
│       ↓                                              │
│  App.tsx            (합성 루트)                      │
└─────────────────────────────────────────────────────┘
                        ↕ WebSocket(Yjs) · REST — 공유 폴더에 한함
┌─────────────────────────────────────────────────────┐
│  server/  (독립 패키지 — 앱 의존성과 완전히 분리)    │
│  릴레이: 초대 코드·참가자 REST + Hocuspocus 중계     │
│  콘텐츠 비영속 (SQLite는 메타데이터만)               │
└─────────────────────────────────────────────────────┘
```

## 모듈 책임

| 모듈 | 책임 | 핵심 파일 |
|---|---|---|
| `types.ts` | 공유 인터페이스 (MindNode, MindMapDoc, NoteDoc …) | `src/types.ts` |
| `io/` | 직렬화·역직렬화, Markdown/OPML 변환, 자동 이름 생성, 이미지 자산 처리. 공유 폴더: 표식·릴레이 응답 검증(`shareFormat`), 노트 md ⇄ Y 변환기 인터페이스(`noteCodec`)·사이드카 봉투(`noteEnvelope`), 공유 맵/보드 콘텐츠 정제(`sharedFile`), 코멘트·알림 파일 검증(`commentFormat`, `notificationFormat`) | `formats.ts`, `noteFormat.ts`, `boardFormat.ts`, `imageAssets.ts`, `shareFormat.ts`, `noteCodec.ts`, `noteEnvelope.ts`, `sharedFile.ts`, `commentFormat.ts`, `notificationFormat.ts` |
| `theme/` | 색상 팔레트 (시맨틱 키 → CSS 값) | `palette.ts` |
| `store/mapStore` | 노드 트리, 선택, 히스토리(undo/redo) | `mapStore.ts` |
| `store/noteStore` | 노트 인덱스, 워크스페이스 스캔 | `noteStore.ts` |
| `store/boardStore` | 보드 요소(text/sticky/image/shape/connector) CRUD, 선택, z-order | `boardStore.ts` |
| `store/sessionStore` | 탭, 분할 패널, 세션 영속성 | `sessionStore.ts` |
| `store/shareStore` | 공유 방 목록·연결 상태·참가자, 경로 → 방/역할 조회(뷰어 판정) | `shareStore.ts` |
| `store/commentStore` | 방별 코멘트 목록·앵커별 개수 (공유 폴더) | `commentStore.ts` |
| `store/notificationStore` | 코멘트 알림 목록·읽음 상태(이 기기 로컬, `notifications:*` IPC로 영속) | `notificationStore.ts` |
| `store/` 공유 보조 | 공유 맵·보드(뷰어) 읽기 전용 중앙 가드, 공유 노트 저장 경로(본문은 쓰지 않음) | `readOnlyGuard.ts`, `sharedNoteSave.ts` |
| `store/uiStore` | 모달, 토스트, 업데이트 상태 | `uiStore.ts` |
| `canvas/` | SVG 엣지 + React 노드 뷰, 캔버스 오버레이 | `Canvas.tsx`, `NodeView.tsx` |
| `note/` | Tiptap 에디터, 마크다운 변환, 노드 링크. 공유 노트: 협업 모드(Collaboration+커서 확장), md ⇄ Y 변환기 구현, 함께 보는 사람 표시 | `NoteEditor.tsx`, `markdown.tsx`, `extensions.ts`, `collabCodec.ts`, `collabCaret.ts`, `CollabPresence.tsx` |
| `board/` | 무드보드 캔버스(자유배치·드래그·리사이즈), 툴바 | `BoardPane.tsx`, `BoardCanvasArea.tsx` |
| `share/` | 공유 폴더 도메인: 릴레이 연결(Hocuspocus 프로바이더 세션), 방 런타임, 노트 복제(md ⇄ Y.Doc), 맵·보드 발행/미러, 코멘트 동기화·알림 규칙, 만들기·참가·나가기 흐름과 사용자 문구. 결과는 `store/shareStore`로만 노출하고 note/·canvas/·board/는 이 폴더를 import하지 않는다 | `rooms.ts`, `shareClient.ts`, `replica.ts`, `fileReplica.ts`, `commentSync.ts`, `commentRules.ts`, `flows.ts`, `manifest.ts`, `sidecar.ts`, `docKeys.ts`, `messages.ts` |
| `focus/` | 포커스 세션 기록, 대시보드, 집계 | `FocusWidget.tsx`, `agenda.ts` |
| `sync/` | macOS Reminders 양방향 동기화 | `reminderSync.ts`, `resolveReminder.ts` |
| `layout/` | d3-hierarchy 트리 레이아웃 계산 | `treeLayout.ts`, `measure.ts` |
| `search/` | 전역 검색, Quick Open | `Search.tsx`, `GlobalSearch.tsx` |
| `electron/main.ts` | IPC 핸들러, 파일시스템, 네이티브 메뉴 | `main.ts` |
| `electron/reminders.ts` | AppleScript 드라이버 (osascript) | `reminders.ts` |
| `electron/preload.ts` | `window.api` 정의 (contextBridge) | `preload.ts` |
| `electron/share.ts` | 공유 폴더 main 로직(의존성 주입 구조): 릴레이 URL·CSP 계산, 릴레이 REST 호출(main에서만), 표식(`.mindshare/room.json`)·사이드카(`.mindshare/n_<hex(noteId)>.yjs` 등 — 노트는 `n_`+id의 소문자 hex, 시스템 문서는 `_manifest`·`_comments`·`_file_`+hex) 파일 I/O(워크스페이스 경계 검증), 토큰(`safeStorage`). `shareConfig.ts`는 기본 릴레이 URL 상수 | `share.ts`, `shareConfig.ts` |
| `electron/notifications.ts` | 코멘트 알림 저장소(`userData/notifications.json`, 최근 500건) | `notifications.ts` |
| `server/` | **별도 패키지**(루트 `package.json`·`tsconfig`와 무관, Node ≥ 22): 릴레이 서버 — 초대 코드·참가자 REST, Hocuspocus WebSocket 중계, `file:*` 문서 서버측 읽기 전용 강제, SQLite 메타데이터. 운영: [relay-server.md](docs/operations/relay-server.md) | `server/src/relay.ts`, `http.ts`, `store.ts` |
| `ui/` 공유 UI | 공유 설정 패널·만들기/참가 다이얼로그·연결 상태 아이콘, 보기 전용 표식, 코멘트 스레드, 알림 센터 | `SharePanel.tsx`, `ShareDialogs.tsx`, `ShareStatus.tsx`, `ViewerBadge.tsx`, `CommentThread.tsx`, `NotificationCenter.tsx` |

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
| 노드 복제는 리마인더 4개 필드를 모두 제거 (0005 확장) | `docs/decisions/0016-duplicate-strips-all-reminder-fields.md` |
| 명시적 자정 vs 종일 구분을 위한 allDay 필드 | `docs/decisions/0017-allday-field-explicit-midnight.md` |
| 관리형 오버레이 스택 — 닫기/Esc의 한 단계 복귀 | `docs/decisions/0018-overlay-esc-stack.md` |
| exec-plan step 상태 머신 + 위임 명세 표준 | `docs/decisions/0019-exec-plan-step-state-machine.md` |
| 보드는 절대좌표 자유배치 문서를 가진 세 번째 독립 파일 타입 | `docs/decisions/0020-board-file-type.md` |
| 공유 폴더: 자체 호스팅 릴레이 서버 도입과 "서버 없음" 불변 조건의 재정의 | `docs/decisions/0021-shared-folder-relay.md` |
| 보드의 노트 링크는 노트 id로 건다 (version 무범프 선택 필드, 공유 참가자에게도 칩 작동) | `docs/decisions/0022-board-note-link-noteid.md` |

## 경계 규칙 (기계적으로 강제)

1. **IPC 전용 통신**: `src/`는 `electron/`을 직접 import하지 않는다. `window.api`만 사용.
2. **Store 직접 참조 금지**: 다른 도메인의 store를 직접 import하지 않는다. `App.tsx` 조합 지점만 예외.
3. **외부 입력 경계 검증**: IPC 응답·파일 내용은 `io/` 또는 `preload.ts` 타입 경계에서 검증.
4. **reminder 불변 조건**: `reminderOn/reminderId`는 항상 함께 설정·제거한다.
5. **공유 폴더 도메인 경계**: `share/`는 `note/`·`canvas/`·`board/`를 import하지 않고(변환기·토스트·이동 훅은 `App.tsx`가 주입), 이들도 `share/`를 import하지 않는다 — `store/shareStore`·`commentStore`를 통해서만 읽는다. `share/`를 참조할 수 있는 곳은 `App.tsx`(조립)·`ui/`(공유 다이얼로그·패널)·`sidebar/`(공유 폴더 표시)뿐이다. 하네스 규칙 [6][7]이 강제한다.
6. **공유 네트워크 경계**: 렌더러의 네트워크 접근은 CSP `connect-src`로 설정된 릴레이 origin 하나에 묶인다(Yjs WebSocket 프로바이더 전용). 릴레이 REST는 `electron/share.ts`(main)에서만 호출하고 렌더러는 `share:*` IPC만 쓴다. 토큰은 `safeStorage`에만 두고 로그·파일에 남기지 않는다. 공유 폴더가 아닌 경로의 내용은 어떤 경로로도 릴레이로 나가지 않는다.
7. **순수 계층과 `electron/`의 예외**: `io/`는 `store/`·도메인 모듈을 import하지 않고(`types`·`theme`·`shared`만), `store/`는 `share/`·`canvas/`·`board/`·`note/`를 import하지 않는다(기존 예외: `workspaceStore` → `note/wikiLinkText`). `src/`가 `electron/`을 import하지 못하는 것의 반대편 예외로, **`electron/`은 `src/io/`(포맷 파싱 같은 공유 순수 모듈)와 `src/shared/`만 런타임 import할 수 있다**(type-only import는 어디서든 허용). 현재 이 규칙의 기존 위반: `electron/share.ts` → `src/share/docKeys`·`src/share/limits`(기술부채 — 하네스 `KNOWN_EXCEPTIONS`, `docs/exec-plans/tech-debt-tracker.md`). 하네스 규칙 [8][9][10]이 강제한다.

## IPC 채널 그룹 (공유 폴더)

`electron/main.ts` 등록 · `electron/preload.ts`의 `window.api.share`/`window.api.notifications` 노출. 모든 인자는 main에서 신뢰하지 않는 입력으로 검증한다.

| 그룹 | 채널 | 용도 |
|---|---|---|
| `share:*` (16) | `relayUrl` · `readMarker` `writeMarker` `removeMarker` `listMarkers` · `tokenGet` `tokenSet` `tokenDelete` · `createRoom` `join` `invite` `participants` `revoke` `deleteRoom` · `sidecarRead` `sidecarWrite` | 릴레이 설정 조회, 폴더 표식, 토큰(safeStorage), 릴레이 REST(방 만들기·참가·초대·참가자·내보내기·방 삭제), 사이드카 바이너리 I/O |
| `notifications:*` (2) | `load` `save` | 알림·읽음·기준선 영속(`userData/notifications.json`) |

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

### 공유 폴더 (로컬 파일 ↔ Y.Doc ↔ 릴레이)

공유 폴더 안의 파일에만 적용된다 — 그 밖의 파일은 위 로컬 흐름 그대로이고 어떤 것도 릴레이로 나가지 않는다. 방(room) = 공유 폴더 하나이고 문서 이름은 `${roomId}/${docKey}`이다(`docKey`: `manifest` · `note:<noteId>` · `file:<fileId>` · `comments`).

```
[노트]   로컬 .md ⇄ share/replica (note/collabCodec가 md ⇄ Y 변환)
                    ⇄ Y.Doc(note:<id>) ⇄ Hocuspocus 프로바이더(share/shareClient) ⇄ 릴레이 ⇄ 다른 참가자
         Y.Doc 상태는 .mindshare/n_<hex(noteId)>.yjs 사이드카에 로컬 보존(서버는 콘텐츠를 버린다),
         .md는 Y.Doc에서 디바운스로 파생 · 외부 수정은 3-way 흡수 (공유 노트의 쓰기 주체 = replica)

[맵·보드] 소유자 저장 → share/fileReplica가 file:<id> 문서로 발행(소유자만 쓰기, 서버가 강제)
          → 참가자: 읽기 전용 미러 파일 + store/readOnlyGuard (편집·저장 차단)

[코멘트]  comments 문서(Y.Map) ⇄ share/commentSync → store/commentStore
          → commentRules(누가 알림 대상인가) → store/notificationStore → notifications:* IPC(로컬 JSON)

[REST]    렌더러 share/flows → window.api.share.* → electron/share.ts(fetch, main에서만) → 릴레이
          (방 만들기 · 초대 코드 · 참가 · 참가자 조회 · 내보내기). 토큰은 safeStorage.
```

## 비고

- **E2E 격리**: `MINDMAP_USER_DATA` 환경변수로 userData 경로를 오버라이드해 실제 사용자 데이터와 분리.
- **로컬 파일 중심**: iCloud Drive 등 폴더 동기화는 사용자 몫. 로컬 파일이 항상 원본이며, 공유하지 않는 폴더는 서버 통신이 전혀 없다. 사용자가 명시적으로 공유 폴더로 지정한 폴더의 내용만 릴레이(`server/`)를 거쳐 참가자에게 전달되고 릴레이는 콘텐츠를 영속 저장하지 않는다 ([결정 0021](docs/decisions/0021-shared-folder-relay.md)).
- **릴레이 주소**: 환경변수 `MINDMAP_RELAY_URL` > `electron/shareConfig.ts`의 `DEFAULT_RELAY_URL`(현재 `https://mindmap-relay-production.up.railway.app` — 2026-09-21 승인, 바꾸려면 앱 재배포 필요). E2E·`make dev-safe`에서 공유를 쓰려면 릴레이(로컬 `startRelay()` 또는 배포본)를 가리켜야 한다 — [relay-server.md](docs/operations/relay-server.md).
- **단일 arch**: 현재 macOS arm64 전용 (electron-builder 설정 기준).
