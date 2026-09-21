# 릴레이 서버 (공유 폴더)

> 결정: `docs/decisions/0021-shared-folder-relay.md` · 명세: `docs/product/specs/2026-09-21-shared-folder-collab.md`
> 코드: `server/` (앱과 의존성이 완전히 분리된 독립 패키지 — 루트 `package.json`·`tsconfig.json`과 무관)

공유 폴더의 초대 코드 발급·참가자 관리(REST)와 노트 실시간 공동편집 중계(WebSocket, Hocuspocus/Yjs)를
한 포트에서 서빙하는 Node 서버다. **콘텐츠를 디스크에 저장하지 않는다** — SQLite에는 메타데이터만 둔다.

## 로컬 실행

```bash
cd server
npm ci
npm run dev        # tsx watch, http://localhost:8787
npm run build      # tsc -> dist/
npm start          # node dist/index.js
npm test           # vitest (실제 서버를 임의 포트로 띄워 WebSocket까지 통합 테스트)
npm run typecheck  # src·test·vitest 설정 모두 타입 검사
```

- Node >= 22 필요 (`@hocuspocus/server`, `better-sqlite3` 13의 요구 사항).
- `server/.npmrc`의 `ignore-scripts=true`는 의도된 것이다. `better-sqlite3` 13은 플랫폼별 prebuilt 바이너리(`prebuilds/`)를
  동봉하므로 `node-gyp` 빌드가 필요 없고, 이 설정이 없으면 npm이 `node-gyp rebuild`를 암묵 실행해 조상 디렉터리(앱 저장소 루트)의
  `node_modules/.bin/node-gyp`에 가로막혀 실패할 수 있다.
- 앱 E2E는 `server/dist/relay.js`의 `startRelay({ port: 0, dbPath?, silent? })`를 import해 테스트마다 임의 포트로 띄운다
  (`npm --prefix server run build` 선행). 반환값: `{ port, url, wsUrl, stats(), close() }`. `dbPath`를 생략하면 메모리 DB라 병렬 안전하다.

## 환경변수

| 변수 | 기본값 | 설명 |
|---|---|---|
| `PORT` | `8787` | 리슨 포트 (Railway가 주입) |
| `DB_PATH` | `./data/relay.db` | SQLite 파일. Railway에서는 볼륨 경로 `/data/relay.db` |
| `INVITE_TTL_MS` | `600000` | 초대 코드 유효 시간(10분). 테스트용 |
| `TRUST_PROXY_HOPS` | `0` (`RAILWAY_ENVIRONMENT`가 있으면 `1`) | 신뢰하는 프록시 단수(0~10 정수). `X-Forwarded-For`의 오른쪽에서 N번째를 클라이언트 IP로 삼아 `/join`·방 생성·소켓 수 제한 키로 쓴다. 0이면 소켓 IP. **정수가 아니면 기동을 거부한다**(`relay.config_error` 로그 후 종료 — 조용히 "프록시 0단"이 되어 전 사용자가 한 IP로 집계되는 것을 막는다) |
| `ROOM_TTL_DAYS` | `90` | 마지막 활동 후 이 일수가 지난 방을 삭제(시작 시 + 6시간마다). `0`이면 정리하지 않음. 접속자가 있는 방은 건너뛰고 활동으로 갱신한다 |
| `MAX_ROOMS` | `5000` | 서버가 보관하는 방의 총 개수. 넘으면 방 생성 `503 capacity_reached` |
| `MAX_SOCKETS` | `2000` | 동시 WebSocket 소켓 총수(업그레이드 시점 검사). 넘으면 `503` |
| `LOG_LEVEL` | `info` | `debug`·`info`·`warn`·`error`. 이 수준 미만의 로그는 버린다. 기본(`info`)에서는 정상 소켓 종료(`ws.closed` code 1000/1001/1005)와 문서 단위 종료(`ws.disconnected`)가 숨겨진다 — 연결 문제를 추적할 때만 `debug`로 켠다. 잘못된 값이면 기동을 거부한다(`relay.config_error`) |

SIGTERM/SIGINT를 받으면 연결과 DB를 닫고 종료한다(10초 안에 못 끝나면 강제 종료).

## 프로토콜 요약

**방(room) = 공유 폴더 하나.** 시각 값은 모두 epoch 밀리초. 오류는 `{ "error": "<code>" }` + 4xx/5xx.

### REST (JSON)

| 요청 | 인증 | 응답 |
|---|---|---|
| `GET /health` | - | `200 {ok:true}` |
| `POST /rooms` `{ownerName, folderName?}` | - | `{roomId, ownerId, ownerToken, inviteCode, inviteExpiresAt}` |
| `POST /rooms/:roomId/invites` | Bearer, 소유자만 | `{inviteCode, inviteExpiresAt}` |
| `POST /join` `{code, displayName}` | - | `{roomId, participantId, token, role:'participant', folderName}` (코드 1회용, 성공 즉시 소진. `folderName`은 방 생성 시 저장된 폴더 이름 — 없으면 `null`) |
| `GET /rooms/:roomId/participants` | Bearer, 방 구성원 | `[{participantId, displayName, role, joinedAt, online}]` |
| `DELETE /rooms/:roomId/participants/:participantId` | Bearer, 소유자만 | `204` — 토큰 폐기 + 라이브 WebSocket 즉시 종료. 소유자 자신은 `400` |
| `DELETE /rooms/:roomId` | Bearer, 소유자만 | `204` — 방·참가자·미사용 초대·폴더 이름을 모두 삭제하고, 그 방의 모든 라이브 WebSocket을 종료(close 4403 reason `room_deleted`). 이후 그 방의 어떤 토큰도 REST·WebSocket 인증에 실패(`401`/`permission-denied`)하고 남은 초대 코드는 `404`. 되돌릴 수 없다 |

오류 코드: `400`(형식 오류: `invalid_json`, `invalid_owner_name`, `invalid_folder_name`, `invalid_display_name`, `invalid_code_format`, `cannot_remove_owner`),
`401 unauthorized`(토큰 없음·무효·강퇴됨), `403 forbidden`(다른 방이거나 소유자 전용), `404`(`invalid_code`는 잘못됨·만료·이미 사용을 구분하지 않는다),
`413 payload_too_large`, `429 rate_limited`(`Retry-After` 헤더 — IP별·전역 `/join` 실패, 방 생성 한도), `429 too_many_open_invites`,
`503 capacity_reached`(방 총량 상한, `Retry-After: 3600`).
CORS는 `*`로 열려 있다(쿠키 인증이 없고 Bearer 토큰만 쓴다).

### WebSocket (Hocuspocus)

- 같은 포트, 경로 무관. 클라이언트는 `@hocuspocus/provider`에 `url`(= `wss://<host>`), `name`, `token`(발급된 opaque 토큰)을 준다.
- 문서 이름 `${roomId}/${docKey}`:

| docKey | 쓰기 권한 |
|---|---|
| `manifest` | 소유자·참가자 |
| `note:<noteId>` | 소유자·참가자 (공동편집) |
| `file:<fileId>` | **소유자만.** 참가자는 서버가 `readOnly`로 강제 (`provider.authorizedScope === 'readonly'`), 쓰기는 서버가 버린다 |
| `comments` | 소유자·참가자 |

- 인증 실패(토큰 무효, 다른 방, 형식 오류 docKey, 강퇴됨)는 `onAuthenticationFailed({reason: 'permission-denied'})`.
- 강퇴되면 서버가 해당 참가자의 모든 문서 연결과 소켓을 close code `4403`(reason `revoked`)로 즉시 끊는다.
  클라이언트는 이 코드나 `permission-denied`를 받으면 자동 재접속을 멈추고 "공유에서 제외됨"으로 처리해야 한다.

**close code 표** (소켓 단위 close는 클라이언트가 실제 code를 받는다. 문서 단위 close 메시지는 `@hocuspocus/provider`가 code를 항상 `1000`으로 바꿔 전달하므로 **reason으로 구분**한다):

| code / reason | 언제 | 단위 | 클라이언트 동작 |
|---|---|---|---|
| `4403` `revoked` | 참가자 강퇴 | 소켓+문서 | 재접속 중단 — "접근 해제됨" |
| `4403` `room_deleted` | 소유자가 방을 삭제 | 소켓+문서 | 재접속 중단 — 방이 사라짐 |
| `4408` `auth_timeout` | 소켓이 열린 뒤 15초 안에 인증하지 못함 | 소켓 | 정상 재접속 |
| `4413` `doc_too_large` / `room_over_budget` | 문서가 크기 상한을 넘거나 방·전체 메모리 예산 초과 | **문서**(reason만 전달) | 그 문서의 서버 상태는 폐기됨. 로컬 사이드카가 원본이므로 내용은 유지, 크기를 줄여야 다시 동기화됨 |
| `4429` `rate_limited` | 소켓의 메시지 속도 상한 초과 | 소켓 | 백오프 후 재접속 |
| `4429` `too_many_connections` | 참가자·방당 동시 소켓 상한 초과 | 소켓 | 백오프 후 재접속(다른 소켓이 닫히면 성공) |
| `1009` | 인증 전 프레임 64KiB 초과 등 프레임 상한 | 소켓 | — (정상 클라이언트는 발생하지 않음) |
| HTTP `503`/`429` 업그레이드 거절 | 전체 소켓 수·IP당 소켓 수 상한 | 핸드셰이크 | 백오프 후 재시도 |
- 초대 코드: 8자, Crockford base32(`0-9A-Z`에서 `I L O U` 제외), TTL 10분, 1회용. 입력은 대소문자·하이픈·`I/L→1`·`O→0`을 너그럽게 받는다.

### 제한값

값은 "수 명이 노트 수십~수백 개를 다루는 공유 폴더"를 기준으로 정상 사용이 절대 걸리지 않게 잡았고, 코드의 `server/src/limits.ts`(`DEFAULT_LIMITS`)가 원본이다. 테스트·운영 튜닝은 `startRelay({ limits })`로 덮어쓴다.

| 항목 | 값 | 근거 |
|---|---|---|
| JSON body | 8 KiB | REST 요청은 이름·코드뿐 |
| **인증 전** WebSocket 프레임 | 64 KiB | 인증 메시지(문서 이름 ≤256B + 토큰 ≤256B)는 수백 바이트. ws는 프레임을 통째로 버퍼링하므로 인증 전 소켓이 큰 프레임으로 메모리를 잡지 못하게 수신기 단계에서 낮춘다 |
| 인증 후 WebSocket 프레임 | 문서 상한 + 1 MiB = 9 MiB | 전체 문서 동기화 한 번이 한 프레임에 들어와야 함 |
| 인증 제한 시간 | 15초 | 소켓이 열린 뒤 첫 인증 성공까지 |
| 인증 전 대기 메시지 | 5 MiB·1000개·문서 100개(Hocuspocus 기본값) | 소켓 하나가 인증 전에 쌓는 메시지 |
| 문서 하나의 Yjs 상태 | 8 MiB | 노트·맵 스냅샷은 수십~수백 KiB. 초과하면 그 문서의 연결을 끊고 상태 폐기 |
| 방당 문서 상태 합계 | 64 MiB | 방 하나가 인스턴스 메모리를 독점하지 못하게 |
| 전체 문서 상태 합계 | 512 MiB | 인스턴스 전체 예산(Railway 메모리 한도보다 작게 유지) |
| 방당 동시에 메모리에 올라온 문서 | 1000 | |
| 전체 WebSocket 소켓 | 2000 | |
| IP(IPv6는 /64)당 소켓 | 200 | 같은 사무실 NAT를 감안 |
| 방당 소켓 / 참가자당 소켓 | 100 / 10 | 참가자 × 기기. 공유 소켓 하나에 문서 여러 개가 붙으므로 문서 수와 무관 |
| 소켓당 메시지 속도 | 버스트 10000, 지속 200/초 | 문서 1000개가 한 소켓에 동시에 붙는 초기 동기화를 허용하고 폭주만 차단 |
| 방당 미사용·미만료 초대 | 20 | 사용·만료된 코드는 세지 않음 |
| 표시 이름 | 1~40자, 제어문자·줄/문단 구분자·`<`·`>` 불가 | |
| 폴더 이름 | 1~80자(코드포인트), NFC, 경로 구분자·제어문자·줄/문단 구분자·선행 `.` 불가 | |
| `/join` 실패(IP별) | IP당 10분에 10회, 초과 시 올바른 코드도 429 | IPv6는 /64를 한 키로 |
| `/join` 실패(전역) | 전 IP 합계 분당 60회 → 30초 차단, 1시간 안에 반복되면 2배(최대 10분) | 코드 공간 2^40에서 분당 60회 추측의 성공 확률은 열린 초대가 수천 개여도 하루 1e-4 미만. IP를 바꿔가며 IP별 제한을 우회하는 시도를 전체 속도로 잡는다. 대가: 차단 중에는 정상 참가도 429 |
| `POST /rooms` | IP당 시간당 30회, 전 IP 합계 시간당 300회, 총 5000개 | |
| 비활동 방 | 90일(`ROOM_TTL_DAYS`) | |

**클라이언트 IP 키.** `TRUST_PROXY_HOPS`>0이면 `X-Forwarded-For`의 **오른쪽에서 N번째** 항목을 쓴다(왼쪽 항목은 클라이언트가 위조 가능). 항목이 없거나 IP가 아니면 소켓 IP로 대체하고 `xff.fallback` 이벤트(reason: `missing`/`short_chain`/`invalid_entry`, IP 원문 없음, 분당 1회)를 남긴다 —
이 이벤트가 보이면 프록시 단수 설정이 틀렸거나 프록시를 우회한 접속이다.

## 데이터·로그 정책 (테스트로 강제)

- **콘텐츠 비영속.** Yjs 문서 상태는 메모리에만 있고 문서에 접속자가 0이 되면 폐기된다(`onStoreDocument`는 아무것도 저장하지 않는다).
  방 접속자가 0이 되면 모든 문서가 폐기되므로 재접속 시 서버 상태는 비어 있다 — 각 클라이언트의 로컬 Y.Doc 사이드카가 원본이다.
- **SQLite는 메타데이터만**: `rooms`(id, 생성 시각, 폴더 이름 `folder_name` — 표시용 이름이며 로그에는 남기지 않는다, 마지막 활동 시각 `last_active_at` — 비활동 방 정리 기준. 기존 DB는 시작 시 `ALTER TABLE`로 컬럼을 추가하고 기존 방의 활동 시각은 시작 시각으로 둔다), `participants`(id, 표시 이름, 역할, 토큰 sha256, joinedAt, revokedAt), `invites`(코드 sha256, 만료, 사용 여부).
  토큰과 초대 코드는 평문으로 저장하지 않는다(코드는 40비트라 TTL·1회용·시도 제한에 의존한다).
- **로그에는 이벤트 이름·roomId·participantId·문서 종류·상태 코드·오류 코드만** 남긴다. 토큰, 초대 코드, 문서 페이로드, 표시 이름, 폴더 이름, IP 원문은 남기지 않는다.
  `/health`는 로그하지 않는다. 자세한 필드·이벤트는 아래 "로그 읽는 법".
- 재시작해도 참가 관계·강퇴 상태는 SQLite에서 복원된다.
- 방 삭제(`DELETE /rooms/:roomId`)와 비활동 정리는 그 방의 행을 모두 지운다(콘텐츠는 원래 서버에 없다). 삭제·정리·축출·거부 이벤트(`room.deleted`, `room.expired`, `ws.evicted`, `ws.denied`)는 roomId·이유만 로그한다.

## 로그 읽는 법

서버는 stdout/stderr에 **JSON 한 줄**씩 로그를 낸다(Railway가 그대로 수집). 모든 줄에 `t`(ISO 시각)·`level`(`debug`/`info`/`warn`/`error`)·`event`가 있고,
나머지 필드는 아래 화이트리스트(`server/src/logger.ts`)에 있는 것만 나간다 — 호출 코드가 다른 키를 넘겨도 버려진다.

```json
{"t":"2026-09-21T13:15:35.650Z","level":"info","event":"http","method":"POST","route":"/join","status":404,"reason":"invalid_code"}
```

### 필드

| 필드 | 뜻 |
|---|---|
| `roomId` · `participantId` | 방·참가자 id(서버가 만든 무작위 id — 비밀이 아니다). 앱 로그의 `[share]` 줄은 방 id 앞 8자만 남기므로 `grep <앞 8자>`로 잇는다 |
| `docKind` | `manifest` · `comments` · `note` · `file` (문서 id는 남기지 않는다) |
| `method` · `route` · `status` | HTTP 요청. `route`는 **URL 패턴 이름**(`/rooms/:roomId/invites` …) — id 값은 넣지 않는다. 어느 패턴에도 안 맞는 경로만 `unmatched`(스캐너·오타) |
| `reason` | 사유 **코드**(자유 문장 아님). HTTP 4xx·5xx에서는 오류 코드(`invalid_code`, `rate_limited`, `forbidden`, `unauthorized` …) |
| `code` | WebSocket close code(4403/4408/4413/4429/1009 …) |
| `errorName` · `message` | 예기치 못한 오류(`http.error`, `relay.crash`)의 클래스 이름과 다듬은 메시지(≤200자) |
| `port` | 리슨 포트 |

### 이벤트 카탈로그

| event | level | 필드 | 뜻 |
|---|---|---|---|
| `relay.listening` / `relay.closed` | info | `port` / — | 기동 / 정상 종료 완료 |
| `relay.shutdown` | info | `reason`(SIGTERM·SIGINT) | 종료 신호를 받음(재배포·재시작 때 정상) |
| `relay.config_error` | error | `message` | 환경변수 오류 — **기동하지 않고 종료 코드 1** |
| `relay.crash` | error | `reason`(`uncaughtException`·`unhandledRejection`), `errorName`, `message` | 처리되지 않은 예외/거부 — 로그를 남기고 **종료 코드 1**(Railway가 재시작). 삼키지 않는다 |
| `relay.receiver_limit_unavailable` | info | — | `ws` 내부 필드가 바뀌어 인증 전 프레임 상한을 못 걸었다(라이브러리 업그레이드 뒤에만) |
| `xff.fallback` | info | `reason` | `X-Forwarded-For`가 없거나 짧아 소켓 IP로 대체(프록시 단수 설정 확인) |
| `http` | info (5xx는 error) | `method`, `route`, `status`, `reason`(4xx·5xx) | 요청 1건. `/health`는 남기지 않는다 |
| `http.error` | error | `route`, `errorName`, `message` | 핸들러의 **예기치 못한 오류**(500) — 서버 버그 신호 |
| `room.created` · `room.deleted` · `room.expired` | info | `roomId`, `participantId`(생성·삭제) | 방 생성 / 소유자가 삭제 / 비활동 TTL 정리 |
| `invite.created` | info | `roomId`, `participantId` | 초대 코드 발급 |
| `join.accepted` / `join.rejected` | info | `roomId`, `participantId` / `reason=invalid_code` | 참가 성공 / 코드 오류·만료·사용됨 |
| `participant.revoked` | info | `roomId`, `participantId` | 소유자가 참가자를 내보냄 |
| `ws.authenticated` | info | `roomId`, `participantId`, `docKind` | 문서 하나의 WebSocket 인증 성공 |
| `ws.denied` | info | `reason`, (`roomId`, `docKind`, `participantId`, `code`) | 연결·인증 거부. `reason`: `bad_request`(문서 이름·토큰 형식) · `not_member`(토큰이 이 방 것이 아님 — 강퇴·방 삭제 뒤 재접속 등) · `room_full`(방당 문서 수 상한) · `server_busy` · `too_many_sockets_ip` · `too_many_connections`(4429) · `rate_limited`(4429) · `auth_timeout`(4408) |
| `ws.evicted` | info | `roomId`, `docKind`, `reason`, `code=4413` | 문서가 크기 상한(`doc_too_large`)·방 예산(`room_over_budget`)을 넘어 서버가 그 문서를 닫음 |
| `ws.closing` | info | `roomId`, (`participantId`), `code=4403`, `reason`(`revoked`·`room_deleted`) | **서버가** 살아 있는 소켓을 닫는 지점(강퇴·방 삭제·인증 직후 강퇴 경합) |
| `ws.closed` | info (정상 종료 1000/1001/1005는 **debug**, 1009는 warn) | `code`, `reason`, (`roomId`, `participantId`) | 소켓이 실제로 닫힘. 서버가 닫은 소켓은 서버가 보낸 code·reason, 그 밖에는 받은 code. 인증 전에 끊긴 소켓은 id가 없다. **상대가 보낸 close 사유 문자열은 옮기지 않는다**(`other`로 뭉갠다) |
| `ws.error` | warn(1009) · debug(그 밖) | `reason`(`WS_ERR_*` 등 오류 코드), (`code=1009`, `roomId`, `participantId`) | `ws` 수신기·소켓 오류. 프레임이 상한을 넘으면(`WS_ERR_UNSUPPORTED_MESSAGE_LENGTH`) `ws`가 1009로 닫지만 이때 `ws.closed`는 1006으로만 오므로 1009는 이 이벤트로 본다 |
| `ws.disconnected` | debug | `roomId`, `participantId`, `docKind` | 문서 단위 연결 종료(Hocuspocus `onDisconnect` — close code는 이 훅에 없다) |

종료(SIGTERM·`relay.close()`)가 시작되면 연결 단위 로그(`ws.*`)는 남기지 않고 마지막 `relay.closed`만 남긴다 — 재배포 때 소켓 수천 줄이 쏟아지는 것을 막고, 이미 닫힌 서버의 늦은 소켓 이벤트가 뒤에 섞이지 않게 한다. 그래서 재배포 직전의 `ws.closed` 급증은 로그에 안 보인다(재배포 자체는 `relay.shutdown`으로 확인).

### 조회 예

```bash
cd server
railway logs --since 1h                       # 최근 1시간 (옵션은 CLI 버전에 따라 다르다 — `railway logs --help`)
railway logs --since 24h | grep '"level":"error"'          # 오류만
railway logs --since 1h | grep '"event":"ws.denied"'         # 거부 이유별로 세기: | grep -o '"reason":"[a-z_-]*"' | sort | uniq -c
railway logs --since 1h | grep '^{' | jq -c 'select(.event=="http" and .status>=400)'   # 실패한 요청(jq가 있으면)
railway logs --since 1h | grep 'eleHI6Wb'                   # 앱 로그의 방 id 앞 8자로 그 방의 서버 쪽 기록 찾기
```

### 자주 보는 패턴

| 보이는 것 | 해석 · 다음 행동 |
|---|---|
| `join.rejected` / `http route=/join status=404 reason=invalid_code`가 갑자기 많다 → 이어서 `status=429 reason=rate_limited` | **초대 코드 무차별 대입 시도**. 서버가 IP별 10회·전역 분당 60회에서 막고 있다(코드 40비트 + 10분·1회용). 429가 계속 이어지면 `xff.fallback`도 확인(프록시 단수가 틀리면 전 사용자가 한 IP로 집계된다) |
| `http route=/rooms/:roomId/… status=401 reason=unauthorized` 반복 | 토큰이 폐기됐다(강퇴·방 삭제·DB 초기화). 재시작 뒤 전부 401이면 `DB_PATH`/볼륨 확인 |
| `ws.denied reason=not_member` | 토큰과 방이 안 맞는다 — 강퇴·삭제된 방에 옛 클라이언트가 재접속. 특정 roomId에 몰리면 정상 정리 과정, roomId 없이 폭증하면 스캐너 |
| `ws.denied reason=room_full` | 그 방의 열린 문서가 1000개 — 노트가 매우 많은 공유 폴더. 앱은 그 문서만 재시도하다 멈춘다(`doc failed … reason=room_full`) |
| `ws.closed code=4403 reason=revoked` / `room_deleted` | 정상(강퇴·공유 해제). 앞에 `ws.closing`이 짝으로 있다 |
| `ws.closed code=4429` (`too_many_connections`·`rate_limited`) 반복 | 한 참가자가 소켓 10개 초과 또는 메시지 폭주. 앱 버그(문서를 한꺼번에 너무 많이 붙임)나 악의적 클라이언트 |
| `ws.evicted … code=4413` | 문서 8MiB·방 64MiB 예산 초과. 같은 방에서 반복되면 그 방 노트가 비정상적으로 크다 |
| `ws.error reason=WS_ERR_UNSUPPORTED_MESSAGE_LENGTH code=1009` | 프레임이 상한 초과(인증 전 64KiB·인증 후 문서 상한+여유). 인증 전(roomId 없음)이면 스캐너 |
| `ws.closed code=1006` 다수 | 네트워크 끊김·노트북 덮개 닫힘 등 비정상 종료. 특정 시각에 몰리면 재배포·플랫폼 이슈(`relay.shutdown`·Railway 배포 기록과 대조) |
| `http.error` (+ `http status=500`) | **서버 버그**. `errorName`·`message`·`route`로 재현. 같은 시각에 `relay.crash`가 있으면 프로세스가 재시작된 것 |
| `relay.crash` | 처리되지 않은 예외 → 종료 코드 1 → Railway 재시작. 직후 `relay.listening`이 다시 보이는지, 사용자 소켓이 끊겼다 재접속했는지 확인. 반복되면 즉시 조사 |

### 개인정보 — 로그에 없는 것

- **없다**: 토큰, 초대 코드, 문서·노트·코멘트 내용(서버는 어차피 비영속), 표시 이름, 폴더 이름, 요청 본문·헤더, **IP 원문**, 클라이언트가 보낸 close 사유 문자열.
- **있다**: 이벤트 이름, roomId·participantId(무작위 id), 문서 종류, HTTP 상태·패턴 이름, 오류 코드, close code, (예기치 못한 오류의) 오류 이름·짧은 메시지.
- 오류 메시지는 다듬는다: 제어문자 제거, 200자 상한, 토큰·초대 코드처럼 생긴 조각은 `[redacted]`, `SyntaxError`(JSON 파서 메시지는 입력 조각을 인용한다)는 **이름만**. 다만 이름·폴더 이름은 모양으로 가려낼 수 없으므로 1차 방어는 "코드가 사용자 입력을 `Error` 메시지에 넣지 않는다"이다 — 새 코드를 쓸 때 지킨다.
- 이 정책은 `server/test/policy.test.ts`(debug 수준까지 켜고 토큰·코드·이름·본문 조각·클라이언트 close 사유가 새지 않는지)와 `server/test/logging.test.ts`(route 분류·오류 메시지·close 진단·process 오류)가 강제한다.

### 보관 기간 주의

Railway의 로그 보관 기간은 **요금제에 따라 다르고 바뀔 수 있다.** 사고 뒤에 로그가 이미 사라져 있을 수 있으니, 지금 요금제의 보관 기간을 Railway 대시보드에서 확인해 두고(필요하면 로그를 외부로 내보내는 드레인을 검토), 중요한 사건은 그 자리에서 발췌해 저장한다. 앱 쪽 로그는 사용자 기기에 있고(`docs/operations/troubleshooting.md`의 "공유 폴더 문제 진단") 1MB를 넘으면 `main.old.log` 한 개만 남긴다.

## Railway 배포 절차

> 배포는 사람이 승인한 뒤 실행한다. 이 절차를 에이전트가 임의로 실행하지 않는다.
> 서버 코드는 GitHub 자동 배포가 아니라 CLI로 올린다(이 저장소의 원격이 다른 GitHub 계정이라 자동 배포에 기대지 않음, ADR 0021).

1. **서비스 생성** — Railway 대시보드에서 기존 프로젝트(또는 새 프로젝트)에 빈 서비스를 추가한다. 이름 예: `mindmap-relay`.
2. **볼륨** — 서비스에 Volume을 추가하고 mount path를 `/data`로 지정한다.
3. **변수** — `DB_PATH=/data/relay.db`. `PORT`는 Railway가 주입한다. `TRUST_PROXY_HOPS`는 Railway 환경에서 자동으로 `1`이 되지만,
   명시하려면 `TRUST_PROXY_HOPS=1`로 둔다.
4. **리전** — Settings에서 Singapore(asia-southeast)를 권장한다(한국에서 지연이 가장 낮다).
5. **인스턴스 수** — Replicas를 **1**로 고정한다(아래 제약 참고).
6. **헬스체크** — Healthcheck Path를 `/health`로 지정한다.
7. **도메인** — Networking에서 public domain을 생성한다. 클라이언트는 `https://<도메인>`(REST)과 `wss://<도메인>`(WebSocket)을 쓴다.
8. **업로드** —
   ```bash
   cd server
   railway link        # 프로젝트·서비스 선택 (최초 1회)
   railway up          # server/ 디렉터리만 업로드 → Nixpacks가 npm ci && npm run build && npm start
   ```
   빌드에 필요한 `typescript`와 `@types/*`는 `dependencies`에 두었다(프로덕션 설치 모드에서도 `npm run build`가 실패하지 않도록).
9. **검증** — `curl https://<도메인>/health` → `{"ok":true}`. 그다음 앱에서 방 생성 → 초대 코드로 다른 인스턴스 참가.

### 운영 제약

- **인스턴스는 1개만.** 방 상태(Yjs 문서, 접속 목록)가 프로세스 메모리에 있어 수평 확장하면 같은 방이 인스턴스별로 갈라진다.
  확장이 필요해지면 Hocuspocus Redis 확장 등을 그때 재검토한다.
- **재배포 = 연결 끊김.** 볼륨을 붙인 서비스는 무중단 배포가 안 된다. 재배포·재시작 때 모든 WebSocket이 끊기고 메모리 문서는 사라진다.
  클라이언트는 자동 재접속하고, 각자의 로컬 Y.Doc 사이드카(`.mindshare/n_<hex(noteId)>.yjs` 등)로 병합하므로 데이터는 손실되지 않는다. 배포는 사용 빈도가 낮은 시간에 한다.
- **DB 백업**은 Railway 볼륨 백업 기능에 맡긴다. 잃어도 콘텐츠는 잃지 않지만 참가 관계·강퇴 상태가 초기화되어 모든 방을 다시 초대해야 한다.
- **호스팅 업체 관점**: Railway는 엣지에서 TLS를 종단한다. "콘텐츠를 저장하지 않는다"는 이 서버 코드의 보증이지 호스팅 인프라에 대한 보증이 아니다(ADR 0021).
- 배포 후 실제 요청에서 `X-Forwarded-For`가 기대대로(클라이언트 IP가 오른쪽 끝) 오는지 한 번 확인한다. 프록시가 여러 단이면 `TRUST_PROXY_HOPS`를
  조정하지 않을 경우 모든 사용자가 한 IP로 집계되어 `/join` 실패 제한이 사실상 전역 제한이 된다.

## 문제 해결

| 증상 | 확인 |
|---|---|
| `npm ci`가 `node-gyp rebuild`에서 실패 | `server/.npmrc`(`ignore-scripts=true`)가 있는지, `server/`에서 실행했는지 |
| 클라이언트가 계속 `permission-denied` | 토큰이 강퇴·재발급으로 폐기됐는지, `roomId`가 토큰의 방과 같은지 |
| `/join`이 429 | IP별 실패 10회 초과 또는 전역 실패 상한(분당 60회). `Retry-After` 초 후 재시도. 프록시 뒤라면 `TRUST_PROXY_HOPS` 확인, `xff.fallback` 로그가 있으면 단수가 틀린 것 |
| 서버가 기동하지 않고 `relay.config_error` | `TRUST_PROXY_HOPS`·`PORT` 등 환경변수가 정수가 아니거나 범위 밖, `LOG_LEVEL`이 `debug`/`info`/`warn`/`error`가 아님 |
| 서버가 자꾸 재시작 | `relay.crash`(예외 이름·메시지) → 위 "로그 읽는 법" |
| 클라이언트가 `4413`/`4429`로 끊김 | 위 close code 표. 문서가 8MiB를 넘었거나 메시지 폭주·소켓 수 상한 |
| 재시작 후 참가자가 전부 401 | `DB_PATH`가 볼륨 경로가 아니거나 볼륨이 마운트되지 않은 것 |

## 현재 배포 (2026-09-21)

- Railway 프로젝트 `mind-map-relay` → 서비스 `mindmap-relay` (환경 `production`), 볼륨 `/data`, `DB_PATH=/data/relay.db`.
- 공개 URL: `https://mindmap-relay-production.up.railway.app` (앱 기본 릴레이 URL은 `electron/shareConfig.ts`의 `DEFAULT_RELAY_URL`).
- 리전: `railway scale southeast-asia=1 eu-west=0`로 Singapore(asia-southeast1)에 고정. 인스턴스 1개.
- 배포: `cd server && railway up --ci` (저장소 원격이 다른 GitHub 계정이라 GitHub 자동 배포는 쓰지 않는다).
- 스모크 확인(2026-09-21): `/health` 200, `POST /rooms`, 두 클라이언트 WebSocket 노트 동기화, 비소유자의 `file:*` 쓰기가 서버에서 차단됨.
- 배포 스모크로 만든 테스트 방 몇 개(`deploy-check`, `ws-check-*`)가 메타데이터에 남아 있을 수 있다(무해 — 리전 이동 시 볼륨이 초기화됐다면 없다. 방 삭제 API·`ROOM_TTL_DAYS` 정리가 배포되면 소유자 토큰이 없는 이 방들은 TTL로 정리된다).
- 공유 소켓(`HocuspocusProviderWebsocket`) 위에 프로바이더를 얹을 때는 `provider.attach()`를 호출해야 동기화가 시작된다(호출하지 않으면 연결 타임아웃).
