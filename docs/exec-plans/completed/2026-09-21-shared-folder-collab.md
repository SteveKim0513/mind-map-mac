# 공유 폴더 (릴레이 서버 + 노트 공동편집 + 코멘트/알림 센터)

날짜: 2026-09-21
상태: completed

## 목표

초대 코드로 폴더를 공유하고, 공유 폴더 안에서 (1) 노트는 실시간 공동편집, (2) 마인드맵·보드는
소유자만 편집하고 참가자는 보기+코멘트, (3) 코멘트는 즉시 알림 + 사이드바 하단 알림 센터에서
읽음 관리. 명세: `docs/product/specs/2026-09-21-shared-folder-collab.md`, 결정:
`docs/decisions/0021-shared-folder-relay.md`.

## 범위 (포함 / 제외)

**포함**: 릴레이 서버(Hocuspocus, 콘텐츠 영속 저장 없음), `src/share/` 도메인 + `shareStore`,
`share:*` IPC, 공유 노트 공동편집, 맵/보드 뷰어 모드, 코멘트, 알림 센터, 초대 코드·강퇴 UI.

**제외**: 맵/보드 동시편집, 오프라인 푸시/이메일, 참가자별 세분 권한, 서버 관리자 웹 콘솔,
종단간 암호화, 다중 기기 읽음 동기화 (명세 §5).

## 현재 상태

- 노트: Tiptap 3.26, `NoteEditor.tsx`가 타이핑마다 PM→마크다운 변환 후 `onChange`(마크다운 문자열이
  진실). 렌더러 CSP 없음. IPC 62개, `window.api` 단일 진입점.
- 서버·네트워크 계층 없음. `MindMapDoc`/`BoardDoc` `version: 1` — 공유 메타데이터는 문서 스키마를
  건드리지 않는 별도 파일로 두어 버전 범프를 피한다(설계 시 확정, 범프가 필요해지면 즉시 중단·승인).

## 가정

- 신원은 표시 이름 + 토큰(계정 없음). 소유자 1명, 참가자 N명, 권한은 소유자/참가자 2종.
- 공유 폴더는 워크스페이스 안의 폴더 하나이며 폴더 단위로만 opt-in 된다.
- 앱이 켜져 있고 소켓이 연결된 동안만 실시간 알림(오프라인 알림 제외).

## 위험

- **시드 중복(가장 큼)**: 같은 `.md`에서 각자 Y.Doc을 만들면 병합 시 내용이 중복된다 → 단계 2 스파이크.
- 외부 에디터로 `.md`를 수정했을 때 사이드카(`.{stem}.yjs`)와 불일치.
- `NoteEditor.tsx` 재구조화 회귀 → 공유 노트에만 적용, 일반 노트 경로 불변 + 기존 `@note` E2E 유지.
- 상시 서버 운영 부담(비용·가동·패치), 초대 코드 유출, 렌더러 네트워크 경계(CSP 신설).
- reminder 불변 조건: 공유로 받은 노드/노트 복사 시 기존 규칙(4개 필드 제거) 그대로 적용됨을 검증.

## 설계 계약 (서버·클라이언트가 공유하는 프로토콜)

- **방(room) = 공유 폴더 하나.** Hocuspocus 문서 이름 `${roomId}/${docKey}`. docKey: `manifest`(폴더 파일
  목록, 모두 쓰기) · `note:<noteId>`(공동편집, 모두 쓰기) · `file:<fileId>`(소유자의 맵/보드 스냅샷,
  **소유자만 쓰기 — 서버가 비소유자 연결을 readOnly로 강제**) · `comments`(append 로그, 모두 쓰기).
- REST: `POST /rooms`, `POST /rooms/:id/invites`, `POST /join`, `GET /rooms/:id/participants`,
  `DELETE /rooms/:id/participants/:pid`(강퇴 시 라이브 연결 즉시 종료), `GET /health`. 인증은
  Bearer 토큰(opaque, 서버는 sha256 해시만 저장). 초대 코드 8자·10분·1회용.
- 알림은 별도 채널이 아니라 `comments` 문서 관찰로 만든다 — 클라이언트가 새 코멘트(작성자≠나)를
  관찰하면 로컬 `notificationStore`에 알림을 만들고, 읽음 상태는 로컬(코멘트 id 기준 dedupe).
- 공유 폴더 표식·사이드카: 폴더 안 숨김 디렉터리 `.mindshare/` — `room.json`(`roomId`, `relayUrl`, `role`,
  `participantId`, 폴더명, 표시 이름)과 `<noteId>.yjs`(노트 id 기반 이름 — 제목 변경 rename에 안 끌려감).
  토큰은 파일이 아니라 `safeStorage`에 roomId 키로 보관. 문서 스키마(`version`)는 건드리지 않는다.
- 클라이언트 구조: `src/share/`(도메인: 연결·프로바이더 관리)가 Y.Doc/프로바이더를 만들어
  `store/shareStore`에 등록하고, `note/`·`board/`·`canvas/`는 store를 통해서만 읽는다(직접 import 금지).
- **가용성 규칙**: 서버가 상태를 폐기하므로 각 참가자는 공유 폴더의 모든 노트를 항상 로컬 복제(eager
  replica)하고 사이드카(`.mindshare/<noteId>.yjs`)에 보존한다. 신규 참가자는 다른 피어가 1명 이상 온라인일 때만
  기존 내용이 내려온다(스파이크 단계 2에서 확인, 제품 한계로 문서화).

## 구현 단계

<!-- 상태 마커: [ ] pending · [>] in-progress · [x] completed · [!] blocked · [e] error -->
- [x] 0. adr-and-plan — ADR 초안·이 계획 작성 → `docs/decisions/0021-shared-folder-relay.md`(제안), `docs/product/specs/2026-09-21-shared-folder-collab.md`, decisions/README·ARCHITECTURE 결정 표 등록
- [x] 1. human-approvals — 사용자 승인 완료(2026-09-21 "모두 실행해") → ADR 0021 채택, 의존성 5종+커서 확장 승인, 호스팅 Railway·서버 코드 위치 `server/`(독립 패키지, `railway up`로 배포)
- [x] 2. spike-yjs-seed-and-sidecar — 스파이크 완료(33건 중 32건, 1건은 기대값 오류) → 시드 중복 재현·채택 규칙 확정, 가용성 한계 확인, 헤드리스 md 파생 가능(렌더러 장수명 직렬화 호스트), 외부 수정은 3-way 흡수(아래 "발견한 사실")
- [x] 3. relay-server — `server/` 독립 패키지(TS, Hocuspocus v4 + REST 한 포트, `better-sqlite3` 메타데이터만, `startRelay()` API), 테스트 32개 통과(코드 TTL·1회용·브루트포스 제한·강퇴 시 라이브 연결 종료·`file:*` 서버측 readOnly·비영속·로그 무페이로드), 운영 문서 `docs/operations/relay-server.md`. Makefile `setup/verify/verify-full/pre-release/verify-feature`에 server 테스트 편입
- [x] 4. share-core — 타입(`ShareMarker` 등)·`io/shareFormat.ts`·`electron/share.ts`(DI 구조, `share:*` IPC 15개)·`connect-src` 전용 CSP·`src/share/`(shareClient·manifest·sidecar·rooms·docKeys)·`store/shareStore.ts`, 신규 단위 테스트 127건, `make verify` 0(루트 505+server 32)·`harness-check` 0, 실제 릴레이+프로바이더 연동·CSP 실측(빌드 앱 `file://`)·IPC 왕복 확인. `DEFAULT_RELAY_URL`은 미반영(아래 발견한 사실)
- [x] 5. share-ui-create-join — 만들기·참가·공유 설정 패널(초대 코드·참가자·내보내기·나가기/공유 해제)·트리 표식·⌘K 명령·파일 메뉴, `src/share/flows.ts`·`messages.ts`, `src/ui/SharePanel.tsx`·`ShareDialogs.tsx`·`ShareStatus.tsx`, 서버 `folderName` 확장(Railway 재배포·스모크 확인), `@share` E2E 5건 통과(라이트/다크 스크린샷 확인), `make verify` 0(루트 546+server 37)·`harness-check` 0. 미실시: `make dev-safe` 직접 조작
- [x] 6a. note-replica-engine — `note/extensions.ts`(확장 목록·`finalizeMarkdown` 추출, 동작 불변)·`note/collabCodec.ts`(`createNoteCodec`)·`io/noteCodec.ts`·`io/noteEnvelope.ts`·`share/replica.ts`(ReplicaManager)·`replicaFs.ts`·`replicaUtil.ts`, `App.tsx` 주입·외부 변경 라우팅. 신규 테스트 88건(실제 릴레이 통합 10건: 소유자 시드→참가자 물질화, 3자 동시 수렴, 오프라인 병합, 서버 상태 폐기 후 재접속 중복 없음, 사이드카 유실 시 재시드 안 함, 신규 참가자 피어 온라인 시에만 수신, 생성·제목·삭제(휴지통) 전파, 3-way 흡수·충돌 사본), `make verify` 0(루트 634+server 37)·`harness-check` 0·`@note`/`@share` E2E 통과. Makefile verify 계열이 server 빌드를 먼저 수행하도록 수정
- [x] 6b. note-collab-editor — `NoteEditor` collab 모드(`note/collabCaret.ts`, `extensions.ts`의 `collab` 옵션)·`NotePane` 단일 쓰기 주체(공유 노트는 본문을 쓰지 않고 `saveSharedNote`가 프론트매터 `links`·`_meta`·제목만 갱신)·캐럿+이름 라벨·헤더 참가자 칩·"공유됨" 표식(`CollabPresence.tsx`, `presenceKey`, COLOR-SYSTEM 절 추가)·이미지 제한(툴바·붙여넣기 차단+토스트)·강퇴/공유 종료 시 읽기 전용, `@share @note` E2E 3건(동시 타이핑 수렴·undo 자기 편집만·디스크 일치·이미지 차단·제목 전파·강퇴 읽기 전용), `make verify` 0(루트 660+server 37)·`harness-check` 0·`@share` 9/9·`@note` 무회귀. 미검증: `make dev-safe` 직접 조작
- [x] 7. readonly-map-board — 소유자 발행(`share/fileReplica.ts`, `file:<fileId>`의 Y.Map `file`에 content/rev/kind, manifest `files` 맵)·참가자 읽기 전용 미러·소유자 파일 바이트 불변·`store/readOnlyGuard.ts` 중앙 가드(허용 목록 외 전 액션 차단, 액션 전수 검사 테스트, 뷰어 문서 저장 제외)·`ViewerBadge`("보기 전용 · 소유자만 편집할 수 있어요")·포커스 없이 실시간 반영, 실제 릴레이 통합 13건·`@share` E2E 12건(신규 3), `make verify` 0(루트 727+server 37)·`harness-check` 0·`@map` 23·`@board` 61·`@todo` 8·`@nav` 23 통과. 미검증: `make dev-safe` 직접 조작, 뷰어 프레즌스는 범위 제외
- [x] 8. comments-and-notification-center — `comments` 문서(Y.Map<commentId, Comment>, 사이드카 `_comments`)·`share/commentSync.ts`·`commentRules.ts`·`store/commentStore.ts`·`notificationStore.ts`·`electron/notifications.ts`(IPC `notifications:load/save`, userData JSON, 최근 500건)·`ui/CommentThread.tsx`(노드·요소·노트 코멘트, 뷰어 포함)·`ui/NotificationCenter.tsx`·사이드바 맨 아래 종 버튼(숫자 뱃지, 공유 폴더 있거나 알림 남았을 때만 표시)·즉시 토스트. 알림 규칙: 방 소유자는 전부, 참가자는 참여한 스레드만, 새 기기 기준선. 실제 릴레이 통합 5건·`@share` E2E 15건(신규 3), `make verify` 0(루트 813+server 37)·`harness-check` 0·`@nav`/`@map`/`@board`/`@note` 통과. 미검증: `make dev-safe` 직접 조작
- [x] 9. docs-and-manual — `FEATURE-INVENTORY.md`(18. 공유 폴더 절·"실시간 협업 없음" 한계 개정)·`Manual.tsx`("공유 폴더" 절)·`ARCHITECTURE.md`(모듈·IPC 그룹·데이터 플로우)·`AGENTS.md` 불변 조건 1번 재정의·`security.md`/`architecture.md`/`testing.md` 규칙·운영 문서·결정 0004/0020 주석·진입점 명세·`PRODUCT-DEFINITION.md` 2줄 부분 개정, `make harness-check` 0·`make verify` 0. 발견: `.github/workflows/release.yml`이 server를 빌드하지 않아 CI 게이트에서 공유 통합 테스트·`@share` E2E가 실패할 수 있음(릴리즈 파이프라인 변경 — 인간 승인 필요, 미수정)
- [x] 10. review-and-release-gate — 보안·아키텍처·테스트 독립 검토 3건 완료(치명 0, 높음: 원격 링크 스킴·폴더 이동 시 옛 경로·깊이 5+ 무연결·테스트 공백) → 수정 3라운드 반영(F1a 클라이언트 코어 19항목, F1b 링크·미러 검증·테스트, F2 서버·하네스·E2E 인프라·문서), 서버 재배포(방 삭제 API·자원 상한·`room_full` 구분) 후 스모크 통과, `make verify` 0(루트 1112+server 69)·`harness-check` 0. `make pre-release` 종료 코드 0(단위 1112+server 69, E2E 병렬 184+`@serial` 6 통과, 2026-09-21). 인간 결정 4건 확정(2026-09-21): (a) `DEFAULT_RELAY_URL`을 배포된 Railway 릴레이 주소로 채움 (b) `.github/workflows/release.yml`에 server 설치·빌드·테스트와 E2E 20분 제한 추가(CI 실행 결과는 첫 태그 배포에서 확인) (c) 링크 허용 스킴 http·https·mailto 유지 (d) 공유 보드 노트 링크는 **노트 id 기반**으로 전환(ADR 0022 — 참가자 칩 작동·이름 변경에 강함). 배포(`make bump`)와 커밋·푸시는 이 계획 범위 밖(별도 인간 지시)

## 검증 방법

- 단계별: `make verify`, 도메인 E2E는 `make verify-feature tag=@note` 등, 공유 시나리오는 격리된 두
  인스턴스(`MINDMAP_USER_DATA`·`MINDMAP_WORKSPACE` 분리)로 실행. 병렬 안전(각 test가 자체 릴레이/포트).
- UI는 `make dev-safe quiet=1`로 직접 확인. 릴레이 서버 콘텐츠 비영속은 서버 테스트로 보증.
- 배포 전 `make pre-release`(전체 E2E)는 부분집합으로 낮추지 않는다.

## 발견한 사실 (작업 중 갱신)

- Tiptap v3 커서 확장은 `@tiptap/extension-collaboration-caret`(v2의 `-cursor`는 3.x 없음). 협업 확장은 `@tiptap/core`와 **정확히 같은 버전**을 peer로 요구 → 설치된 3.26.0에 맞춰 `--save-exact 3.26.0`으로 고정(최신 3.31.3은 peer 불일치). `yjs` 13.6.32, `y-protocols` 1.0.7, `@hocuspocus/provider`/`server` 4.7.0, 전부 MIT.
- 서버 구현 사실: **Node >=22 필수**(`@hocuspocus/server@4.7`·`better-sqlite3@13` engines), `server/.npmrc`의 `ignore-scripts=true` 필수(루트 node-gyp v9 PATH 충돌), 응답 규약 성공 200(DELETE 204)·시각 epoch ms·`/join` 실패는 사유 무구분 404 `invalid_code`, 강퇴 시 소켓 close 4403 `revoked` → **클라이언트는 `permission-denied`/4403에서 재접속 중단**, 앱 E2E는 `npm --prefix server run build` 후 `server/dist/relay.js`의 `startRelay`(dbPath 생략=메모리 DB)를 import. 미검증: Railway 실제 배포·`X-Forwarded-For` 신뢰 단수(배포 후 확인), 인증~문서 로딩 사이 강퇴 레이스.
- 단계 4 사실: (1) 공유 소켓 위 프로바이더는 `provider.attach()` 필수. (2) Hocuspocus 소켓은 close 뒤 무조건 `setTimeout(connect)`라 `shouldConnect=false`만으로는 강퇴 후 되살아남 → 세션이 `connect`를 가드로 덮어 `denied` 이후 재접속 차단. (3) 표식 `relayUrl` origin ≠ 설정된 릴레이면 연결·토큰 인출 안 함(`relay_mismatch`), REST `redirect:'error'`, 평문 http는 loopback만, 표식·사이드카·토큰 경로는 워크스페이스 realpath 경계·비숨김·심볼릭 링크 불추적. (4) `electron/**/*.test.ts`를 vitest include에 추가(main 로직을 `electron/share.ts`에 의존성 주입으로 분리). (5) 사이드카 id 규칙: `manifest`→`_manifest`, `comments`→`_comments`, `note:<id>`→`<id>`, `file:<id>`→`_file_<id>`; `attachSidecarPersistence`는 원시 `encodeStateAsUpdate`, 노트는 `{update, baseUpdate, mdHash}` 봉투를 단계 6에서 read/writeSidecar로 직접 관리. (6) `@note` E2E 2건 실패(`file-management.spec.ts:124`, `note-external-change.spec.ts:14`) — 둘 다 `@serial` `win.focus()` 테스트로 testing.md에 기록된 macOS 26 quiet 모드 증상과 동일, 변경 전 기준선 비교는 미실시(릴리즈 게이트에서 확인). (7) server 테스트 간헐 실패 1회("rejects tokens for a different room" 15s 타임아웃) — 병렬 작업 부하 중 발생, 단독 6회 재실행은 전부 통과.
- **미결(사용자 확인 필요)**: `electron/shareConfig.ts`의 `DEFAULT_RELAY_URL`을 배포된 `https://mindmap-relay-production.up.railway.app`로 채우는 것 — 자동 모드 분류기가 에이전트의 트래픽 리다이렉션 편집을 거부해 미반영. 개발·E2E는 `MINDMAP_RELAY_URL`로 동작, 릴리즈 전 필수.
- 단계 6a 사실: (1) 3-way 흡수는 base를 전진시키지 않으면 "1차 수정 1차 수정"식 중복이 실측됨 → `applyExternalMarkdown3Way`는 `{changed, nextBase}`를 반환하고 매니저가 흡수 직후 base·mdHash를 갱신·저장. (2) 통합 테스트는 vitest jsdom 환경에서 못 돈다(Event/WebSocket 전역 교체) → `@vitest-environment node` + `replicaDomSetup.ts`로 코덱용 DOM 전역만 채움. (3) `make verify`가 `server/dist`를 빌드하지 않으면 새 체크아웃에서 통합 테스트가 실패 → Makefile verify 계열에 `npm --prefix server run build` 선행. (4) 로컬 삭제는 연속 2회 스캔에서 사라져야 삭제로 판정, 원격 삭제는 로컬 휴지통 이동. (5) 시작 시점에 이미 있던 참가자 로컬 파일(manifest에 없는 id)은 시드하지 않음(중복 방지), 충돌 사본도 공유 폴더 안 새 노트라 전원에게 공유됨. (6) 이미지는 v1 제외 — 피어에는 깨진 링크. 미해결(6b 대상): 6b 이전에는 공유 노트를 NotePane 탭으로 열면 자동저장이 매니저의 외부 수정 흡수와 경쟁할 수 있음.
- 단계 6b 사실: (1) 공유 노트의 `links`·`_meta`는 Y에 없는 기기 전용 값이라 NotePane이 프론트매터만 병합 저장한다(`saveSharedNote`) — 본문을 `note.body`로 쓰면 타인 편집을 덮어씀(**공유 노트를 저장하는 새 경로는 반드시 `saveSharedNote` 또는 매니저의 외부 수정 흡수 경유**). (2) 원격 제목 변경은 반영하되 위키링크 일괄 치환은 로컬 변경일 때만(참가자마다 치환하면 CRDT가 `[[새]][[새]]`로 중복). (3) 동시 타이핑 E2E의 첫 글자 유실은 Tiptap `commands.focus`의 DOM 포커스 지연 때문(테스트에서 `toBeFocused()` 대기). (4) awareness의 "함께 보는 사람"은 `viewing: true` 필드로만 구분. 좁은 경쟁 위험(미실측): NotePane 프론트매터 병합 쓰기와 매니저 쓰기의 동시 발생, 늦게 도착한 옛 제목의 화면 되돌림.
- 단계 7 사실: (1) 소유자 발행 사본과 참가자 수신 시 모두 `reminderOn/reminderId/reminderSyncedAt/reminderBase`를 제거하고, `reminderSync`가 readOnly 스토어를 동기화 대상에서 제외(사본에는 신원이 없어 "원치 않음"으로 오해해 같은 Apple ID 소유자의 리마인더를 삭제할 수 있었음). (2) 뷰어는 `room.files`에 등록된 미러 파일만 — 참가자가 공유 폴더 안에 직접 만든 맵·보드는 로컬 전용(방마다 한 번 토스트 안내). (3) manifest는 모두 쓰기 가능하므로 소유자를 권위로 삼음: 소유자가 원격이 바꾼 `files` 항목을 되돌리고, 참가자는 원격 삭제를 2.5초 유예 후 반영. (4) 접힘 상태는 소유자 갱신 때 초기화, 팬/줌·선택은 유지. (5) 파일 4MB·동시 복제 300개 상한. (6) 보드 이미지 자산은 동기화되지 않음(placeholder). (7) 코멘트 앵커: 맵 `node.id`, 보드 `board.elements[id]`(`.board-el`에 `data-element-id` 추가 필요), 파일 식별 `getFileReplica(roomId).fileIdForPath(path)`.
- 단계 8 사실: (1) 알림 기준선 = 저장된 기준선 → (사이드카 있음 ? 0 : 지금), createdAt이 기준선−60초보다 오래된 코멘트는 알림 없음(시계 어긋남 여유). (2) 앵커에 `label`(대상 글자 스냅샷, 선택 필드) 추가 — 소유자 기기가 노드를 열지 않아도 알림에 대상을 표시. (3) 뱃지는 점이 아니라 숫자(1개와 9개는 다른 정보, 10+는 "9+"). (4) **위조 가능(남은 위험)**: `comments`는 모두 쓰기 가능이라 서버가 작성자를 검증하지 못함 — "내 코멘트만 삭제"는 UI 규칙일 뿐 악성 참가자의 위조·덮어쓰기는 프로토콜로 막지 못함, 방당 5000 상한도 클라이언트 쪽만. (5) 코멘트 진입점은 우클릭 메뉴·노트 헤더 버튼·기존 칩(키보드 단축키 없음). (6) 스레드 팝오버는 ADR 0018 스택이 아닌 노드 팝오버 계열, 알림 센터는 스택 편입. (7) `e2e/helpers.ts` `launchApp({ reuse })`로 같은 userData 재기동 시뮬레이션.
- 검토·수정 라운드 사실: (1) 원격이 채우는 링크가 `window.open`→`shell.openExternal`까지 무검증이었음(맵·보드 칩·노트 미리보기·main 핸들러) → main `setWindowOpenHandler`를 http·https·mailto 허용 목록으로 제한(부작용: `tel:`/`sms:`/`ftp:` 링크가 열리지 않음, 보드 공유 사본에서 노트 링크 칩이 사라짐 — 인간 판단 필요). (2) 공유 폴더 이름 변경·이동 시 런타임이 옛 경로를 붙잡아 원격 편집 미반영·뷰어 가드 해제·좀비 폴더 재생성 → 방 재시작+`relocateFolder`. (3) 노트 사이드카는 `n_`+id 소문자 hex(시스템 문서와 네임스페이스 분리, 대소문자 무시 FS 충돌 방지). (4) 서버가 `room_full`을 `permission-denied`와 다른 reason으로 보내도록 수정(문서 1개 거부가 세션 전체 "접근 해제됨"이 되던 문제). (5) 하네스에 `share/` 경계 규칙 5종 추가, `electron`→`src/io` 예외 명시. (6) `replica.integration.test.ts`가 수정 중 0바이트로 손상됐다가 에이전트 기록에서 복원(미확인 구간 약 381~469행이 원본과 미세하게 다를 수 있음, 12건 통과). (7) 후속 과제는 `docs/exec-plans/tech-debt-tracker.md` TD-003~019.
- 결정 4-C 사실: (1) 이름 변경 시 소유자 보드의 `notePath`는 옛 경로로 남는다(자동 갱신 훅 없음) — 경로 방식은 조용히 깨지고 있었고 id 우선 해석으로 해소. (2) 링크 생성 즉시 발행되면 대상 노트가 아직 manifest에 없을 수 있어 `refreshNoteLinks`가 공유 노트 경로 맵 변경 시 노트 링크 있는 보드만 재발행(사본이 같으면 쓰지 않음, 소유자 파일은 읽기만). (3) 옛 보드(noteId 없음)는 자동 마이그레이션 없음 — 사용자가 다시 링크하기 전까지 경로 기반, 공유 발행 시점에만 사본에서 경로→id 해석. (4) 프론트매터 id 없는 노트는 피커가 저장한 id와 파일에 스탬프되는 id가 다를 수 있음(경로 폴백 의존, E2E 없음). (5) 이미지 요소 `noteLink`는 단위 테스트만.
- 설계 분석(스파이크로 확인 완료): 서버 비영속 + 방 상태 폐기 모델에서는 "모든 피어 오프라인 상태에서 신규 참가"가 불가능 — 가용성은 피어 복제본에 의존한다.
- 공유 메타데이터를 `MindMapDoc.version` 범프 없이 표현할 수 있는지는 단계 4 설계에서 확정.

### 스파이크 결과 (2026-09-21, 코드: 세션 scratchpad `spike/`, 프로덕션 코드 무수정)

- **시드 중복 재현됨**: 같은 md를 두 Y.Doc에 각자 시드하면 문서가 2배. `Editor({Collaboration, content})`는 `content`를 조용히 무시하고, `setContent`로 시드하면 Y 연산이 생겨 똑같이 중복.
- **채택 규칙**: (1) 시드는 소유자가 공유 시작 시 노트당 1회, 비소유자는 시드 금지·원격 채택 (2) manifest에 노트별 `seeded` 마커 — 마커 있으면 사이드카 없어도 재시드 금지 (3) 사이드카는 `{update, baseUpdate, mdHash}`, 저장 순서 사이드카→md→base (4) Y.Doc은 세션마다 새로 생성, clientID 저장·재사용 금지 (5) 로드 시점에는 md 파생 안 함(md→Y→md는 손실 변환) — 편집·수신 후에만 파생 (6) manifest는 `Y.Map<noteId,{path,title,rev,seeded}>`(키별 LWW), 제목도 manifest에 두어 참가자별 rename 충돌 방지.
- **가용성**: 사이드카 없는 신규 참가자는 다른 피어 1명 이상 온라인일 때만 내용을 받는다(확인). eager replica는 실용적(노트 200개 md 714KB → Y 850KB, 시드+apply ~30ms; 4,500회 편집 후 사이드카 3KB). 200룸 동시 attach 비용은 미검증 → 대안: manifest+열린 노트만 상시 연결, 나머지는 시작·포커스 시 배치 catch-up 후 detach(manifest `rev`가 변경 힌트).
- **헤드리스 md 파생**: 렌더러에서 가능. 장수명 비-collab Editor 하나를 직렬화 호스트로 두고 `yXmlFragmentToProseMirrorRootNode(frag, schema)` → `editor.storage.markdown.serializer.serialize(node)`(Editor 파생과 바이트 동일, 200회 19ms). 순수 Node에서는 `new Editor`가 실패 → main 프로세스 파생 비추천. 테스트는 파일 상단 `// @vitest-environment jsdom`(jsdom 설치됨).
- **외부 수정(사용자가 다른 에디터로 .md 수정)**: 3-way 흡수 — 마지막 md 쓰기 시점의 Y 상태(`baseUpdate`) 대비 diff를 `updateYFragment`(`@tiptap/y-tiptap`)로 만들어 그 update만 적용. 2-way·replace-all은 피어 편집을 지움(재현됨, 금지). 판정: ①자기 쓰기 해시 동일→무시 ②canonical 동일→무시 ③다르면 3-way 흡수. base 없음·빈 파일·대량 교체는 충돌 사본 보존 + 토스트. (md→PM→md는 60개 코퍼스 59/60 멱등, `linkify`가 비멱등 원인.)
- **NoteEditor 최소 침습 분기(파일·행은 스파이크 시점)**: Props에 `collab?: {ydoc, awareness, user}`(`NoteEditor.tsx:60-79,103`), collab일 때만 `StarterKit.configure({undoRedo:false})`+Collaboration+CollaborationCaret(`:318-338`), `onUpdate`는 collab이면 즉시 `onChange` 대신 디바운스 파생(`:449-470`, `NotePane.tsx:166` 800ms와 통합), wikilink 언이스케이프·태스크 tight화 정규식은 `finalizeMarkdown(md)` 순수 함수로 추출해 공유(누락 시 `\[\[..\]\]`로 깨짐, 재현됨), 이미지 `setContent`/`pendingContent`(`:482-513,543-548`)는 collab에서 건너뜀(`setContent`가 Y를 덮어씀), 공유 노트는 replica 매니저 하나만 쓰기(`NotePane.tsx:163-178` 자동저장과 경쟁 방지, 프론트매터 보존·body만 교체), 외부 변경 감지(`App.tsx:150-164`)에서 공유 노트만 흡수 함수로 라우팅.
- **API 메모**: yjs 13.6.32, y-protocols 1.0.7, `@hocuspocus/provider` 4.7.0(서버도 v4), `@tiptap/y-tiptap` 3.0.9(`prosemirrorJSONToYXmlFragment`, `yXmlFragmentToProseMirrorRootNode`, `updateYFragment`), 기본 fragment 이름 `'default'`, StarterKit 옵션 `undoRedo:false`, 커서 사용자 갱신 `updateUser`. 사이드카 바이너리 IPC 필요(`window.api.save`는 텍스트용).
- **제품 한계로 기록**: 이미지는 현재 data URL이 에디터 내용에 들어가 Y에 넣으면 상태가 커지고 자산 파일은 동기화되지 않음 → v1 공유 노트에서 이미지 제외. macOS에서 창을 닫아도 앱은 살아 있지만 렌더러가 없으면 복제가 멈춘다(`electron/main.ts:321`). Hocuspocus 서버·프로바이더 실연동은 스파이크에서 미검증(서버 단계에서 검증).

## 결정 변경 이력

- 2026-09-21: 릴리즈 게이트 인간 결정 4건 확정 후 단계 10 완료, 계획 completed로 이동.

- 2026-09-21: 승인 완료 후 단계 1 [x], 계획 상태 active로 복귀. Railway 관례(sibling 프로젝트): 독립 서버 디렉터리, SQLite는 볼륨 `/data`(`DB_PATH`), Nixpacks `npm start`.
- 2026-09-21: 최초 작성. 사용자 "시작해" 지시에 따라 ADR·계획까지 작성하고, 의존성·호스팅·불변 조건 재정의는 인간 승인 대기(단계 1 blocked).
