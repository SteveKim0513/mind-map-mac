# 문제 해결

## 빌드 문제

### TypeScript 오류

```bash
npm run typecheck 2>&1 | head -50
```

- `noUnusedLocals`, `noUnusedParameters` 위반이 많으면 관련 파일만 확인한다.
- `strict: true` 관련 오류는 `unknown` 타입과 타입 가드로 해결한다.

### Vite 빌드 실패

```bash
npm run build 2>&1
```

- `electron-log` 관련 오류: `vite.config.ts`의 `external` 설정 확인.
- `dist/`, `dist-electron/` 파일이 오래된 경우: `rm -rf dist dist-electron` 후 재빌드.

## 테스트 문제

### 테스트 실패

```bash
npm test -- --reporter=verbose 2>&1
```

- 특정 파일만 실행: `npm test -- src/io/formats.test.ts`
- watch 모드: `npm run test:watch`

### Vitest jsdom 오류

`vitest.config.ts`의 환경이 `node`임을 확인한다. 브라우저 API가 필요하면 `jsdom`을 명시한다.

## Electron 문제

### 앱 실행 안 됨

```bash
make dev-safe  # 로그에서 오류 확인 (격리 환경)
```

- 포트 충돌: `lsof -i :5173` 확인
- 이전 Electron 프로세스: `pkill -f "electron"` 후 재시작

### macOS Reminders 동작 안 함

1. 시스템 설정 → 개인 정보 보호 및 보안 → 자동화 → MindMap 확인
2. 시스템 설정 → 개인 정보 보호 및 보안 → 미리 알림 → MindMap 확인
3. 앱 재시작

### IPC 응답 없음

`electron/main.ts`에서 해당 `ipcMain.handle` 등록 여부 확인.

## 공유 폴더 문제 진단

공유 폴더에서 문제가 생기면 **앱 로그의 `[share]` 줄**과 (서버 쪽이 의심되면) 릴레이 서버 로그를 본다.
서버 로그 읽는 법·이벤트 카탈로그는 `docs/operations/relay-server.md`의 "로그 읽는 법".

### 앱 로그 위치

- 설치한 앱: `~/Library/Logs/MindMap/main.log` — 메뉴 **보기 → 로그 폴더 열기**로 바로 연다. 1MB를 넘으면 `main.old.log`로 넘어가고 그보다 오래된 것은 사라진다(info 이상만 기록).
- 개발 실행(`make dev-safe`)·E2E: 앱 이름이 달라 `~/Library/Logs/Electron/main.log`(또는 `~/Library/Logs/mind-map/main.log`)에 남는다.
- 로그는 이 기기의 파일일 뿐 서버로 자동 전송되지 않는다. 사용자가 문제를 보고할 때 직접 보내 준 것만 본다.

### 줄 읽는 법

```
[2026-09-21 22:34:06.345] [info]  [share] conn room=MAwvxRZF idle->connecting
 └ 시각(로컬)              └ 레벨   └ 스코프  └ 메시지(이벤트 + key=value 코드)
```

스코프: `[share]` 공유 폴더(연결·흐름·복제·코멘트), `[renderer]` 화면(렌더러) 오류, `[notifications]` 알림 저장소.
`[share] [replica ab12cd34]`·`[files ab12cd34]`·`[comments ab12cd34]`는 그 방의 노트 복제·맵/보드 복제·코멘트 동기화다. 방 id는 **앞 8자만** 나오므로 서버 로그와는 `grep`으로 잇는다(서버는 전체 id를 남긴다).
서버 로그의 시각은 UTC(ISO), 앱 로그는 로컬 시각이다.

| 줄 | 뜻 |
|---|---|
| `conn room=… A->B [reason=코드]` | 방의 연결 상태 전이. 상태: `idle`(끊김/미연결) · `connecting` · `connected` · `disconnected`(끊겼고 자동 재접속 중) · `denied`(접근 해제 — 재접속 안 함). 같은 (방, 상태, 사유)는 60초에 한 번만 남고 그 사이 반복은 다음 줄 끝에 ` (+N)`로 요약된다 |
| `socket closed room=… code=N [reason=…]` | WebSocket이 닫힘(정상 1000/1001은 안 남김). `4403 revoked`(내보내짐) · `4403 room_deleted`(소유자가 공유 해제) · `4408 auth_timeout` · `4429`(`rate_limited`·`too_many_connections` — 자동으로 늘려 가며 재접속) · `1006`(서버·네트워크가 사라짐) |
| `doc failed room=… doc=note:ab12cd34 reason=…` | **문서 하나**만 실패했다(방 연결은 살아 있다). `room_full`(방당 문서 수 상한) · `doc_too_large` · `room_over_budget`. 같은 (방, 문서 종류, 사유)는 60초에 한 번. `doc recovered`는 다시 붙었다는 뜻, `doc gave up … (retries exhausted)`(error)는 재시도를 다 써서 포기했다는 뜻. 문서 종류는 `note`·`file`·`comments`·`manifest`, id는 앞 8자만 |
| `flow create\|join\|invite\|remove-participant\|forget\|unshare start` → `ok` / `failed error=코드` | 만들기·참가·초대 발급·내보내기·나가기(로컬 정리)·공유 해제. 오류 코드는 사용자에게 보인 문구의 원인(`invalid_code`, `expired`, `rate_limited`, `network`, `timeout`, `denied`, `too_deep`, `token_restore_failed` …, 표는 `src/share/messages.ts`). 코드·이름·폴더 이름은 남기지 않는다 |
| `flow rollback …` · `flow … step failed step=…` · `flow server room delete failed/threw … error=…` | 만들기·참가가 중간에 실패해 되돌리는 중. 서버 방 삭제가 실패하면 서버에 빈 방이 남을 수 있다(TTL로 정리) |
| `flow unshare falling back to participant revoke` · `flow unshare serverLeftover` | 서버 방 삭제가 안 돼 참가자를 하나씩 내보내는 폴백을 썼다 / 로컬 정리는 끝났지만 서버에 방 정보가 남았다(사용자에게도 안내됨) |
| `markers scan failed` · `marker gone room=…` · `restart room=… reason=folder_moved\|role_changed` · `role corrected …` | 표식(`.mindshare/room.json`) 스캔 실패(기존 방 유지) / 표식이 사라져 연결 정리 / 폴더 이동·역할 변경으로 방 재시작 / 서버가 알려 준 역할로 표식 보정 |
| `[comments …] notification baseline initialized reason=first_sync\|no_baseline\|recovered` | 코멘트 알림 기준선 설정. `recovered`(warn)는 쓰던 방인데 저장된 알림 상태가 손상·소실돼 기준선이 초기화된 것 — 그 방의 옛 코멘트는 알림이 되지 않는다 |
| `[comments …] remote comments rejected by validation count=N` | 원격이 보낸 코멘트 항목 N개가 형식·크기 검사에 걸려 무시됨(내용은 남기지 않는다). 계속 나오면 악성·버그 클라이언트 |
| `comments\|note replica\|file replica start failed room=… error=이름` | 그 기능만 시작에 실패(연결·다른 기능은 살아 있다). 오류 **이름**만 남고 메시지는 없다 |
| `[notifications] notifications:load recovered (corrupt\|empty\|oversize\|bad_version\|read_error:…)` · `notifications:save failed (…)` | 알림 저장 파일(`userData/notifications.json`) 읽기·쓰기 문제. 첫 실행(파일 없음)은 정상이라 남지 않는다 |
| `[renderer] uncaught Error: 메시지 \| at 함수 (파일:줄:열) …` · `unhandled rejection …` | 화면에서 잡히지 않은 오류. 스택은 앞 3프레임, 파일명:줄:열만. 던진 값이 Error가 아니면 `non-Error (string(len=N))`처럼 **길이만**. 같은 메시지는 60초에 한 번, 전체 분당 20건. (main이 남기는 `Uncaught …` 줄은 같은 오류의 요약이다) |

### 예시: 자주 만나는 상황

```
# 소유자가 참가자를 내보냄 → 참가자 기기
[info]  [share] conn room=P5t0ti55 connected->disconnected
[warn]  [share] socket closed room=P5t0ti55 code=4403 reason=revoked
[warn]  [share] conn room=P5t0ti55 disconnected->denied reason=revoked

# 서버가 사라짐(재배포·장애) → 재접속을 시도하는 동안 같은 줄은 (+N)로 요약
[info]  [share] conn room=MAwvxRZF connected->disconnected
[info]  [share] socket closed room=MAwvxRZF code=1006
[info]  [share] conn room=MAwvxRZF connected->disconnected (+11)
```

- **초대 코드가 안 먹는다**: `flow join failed error=invalid_code`(틀렸거나 만료·이미 사용) / `rate_limited`(시도가 너무 많다) / `network`·`timeout`(서버에 못 닿음 — `curl <서버>/health`). 서버 로그에는 `join.rejected`가 대응한다.
- **"참가 필요"로 보인다**: `conn … connecting->denied reason=no_token` — 표식은 있는데 이 기기에 토큰이 없다(다른 기기에서 복사한 폴더 등). 다시 초대 코드로 참가해야 한다.
- **"오프라인"에서 안 돌아온다**: `conn … idle reason=relay_mismatch`(표식의 서버 주소가 설정된 서버와 다름 — `MINDMAP_RELAY_URL` 확인) 또는 `relay_not_configured`/`relay_invalid`.
- **특정 노트·파일만 안 온다**: `doc failed … reason=room_full|doc_too_large|room_over_budget` → 한도 문제. `doc gave up`이면 앱을 다시 켜야 재시도한다.
- **화면이 멈추거나 깨졌다**: `[renderer] uncaught …`의 파일:줄이 단서. 그 직전 `[share]` 줄로 공유 이벤트와의 관계를 본다.

### 사용자에게 로그를 받을 때

1. **`main.log`와 `main.old.log` 둘 다** 요청한다(문제 시각이 오래됐으면 `.old`에 있다). 문제가 난 대략의 **시각**과 앱 **버전**을 함께 받는다.
2. 방 id 앞 8자(`room=…`)로 서버 로그를 대조한다(시각은 UTC ↔ 로컬 변환 주의).
3. **로그에 없는 것**을 안다 — 없다고 원인이 없는 게 아니다: 노트·맵·보드·코멘트 **내용**, 토큰, 초대 코드, 표시 이름, 폴더 이름, 공유 흐름·연결 줄의 파일 경로. 내용이 필요한 재현은 사용자가 직접 설명하거나 화면을 보내 줘야 한다(로그로는 복원할 수 없다).
4. 로그는 이벤트·코드만 담도록 만들었지만 보내기 전에 사용자가 열어 볼 수 있음을 알려 준다(라이브러리 경고 같은 `[renderer]` 원문 줄은 예외적으로 파일 경로·메시지를 포함할 수 있다).

## Claude Code / Harness 문제

### Hook 오류

```bash
# 직접 테스트
echo '{"tool":"Bash","input":{"command":"rm -rf /"}}' | bash .claude/hooks/block-destructive-command.sh
echo $?
```

### `make harness-check` 실패

```bash
node scripts/harness/check-architecture.mjs
node scripts/harness/check-docs.mjs
```

각 스크립트의 출력에서 실패 원인을 확인한다.

## 배포 문제

→ `docs/release/DEPLOY-UPDATE-SPEC.md` 참조
→ `docs/operations/deployment.md` 참조
