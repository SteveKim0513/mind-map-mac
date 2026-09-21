# 로컬 개발 가이드

## 환경 요구사항

- macOS (arm64 권장 — 빌드 타겟과 동일)
- Node.js 20+ (`node --version`)
- npm 10+ (`npm --version`)
- Xcode Command Line Tools (`xcode-select --install`)

## 초기 설정

```bash
git clone <repo>
cd mind-map
make setup          # npm ci (앱 + 공유 폴더 릴레이 server/, Node 22 필요 — 릴레이: docs/operations/relay-server.md)
```

## 개발 서버 실행

```bash
make dev-safe       # 격리된 임시 userData + workspace로 실행
```

Electron 창이 열리고 Vite HMR이 활성화된다. 렌더러 변경은 즉시 반영된다.
`electron/` 변경은 앱 재시작이 필요하다.

실제 사용자 데이터(`~/.config/mind-map`, 기본 워크스페이스)는 건드리지 않는다.

## 환경 변수

| 변수 | 설명 | 기본값 |
|---|---|---|
| `MINDMAP_USER_DATA` | userData 경로 오버라이드 (E2E 격리용) | Electron 기본값 |
| `MINDMAP_WORKSPACE` | 워크스페이스 경로 오버라이드 (E2E용) | null |
| `VITE_DEV_SERVER_URL` | Vite 개발 서버 URL (자동 설정) | - |
| `MINDMAP_RELAY_URL` | 공유 폴더 릴레이 서버 주소 — 설정하면 `electron/shareConfig.ts`의 `DEFAULT_RELAY_URL`보다 우선 (개발·E2E 격리용). 평문 `http://`는 loopback(localhost)만 허용 | 없음(`DEFAULT_RELAY_URL` = 배포된 Railway 릴레이) |

## 공유 폴더(릴레이) 로컬에서 써보기

공유 폴더는 릴레이 서버가 있어야 동작한다. 릴레이 코드는 `server/`(독립 패키지)이며 실행·환경변수·프로토콜·배포는 [relay-server.md](relay-server.md)에 있다.

```bash
# 터미널 1 — 로컬 릴레이 (http://localhost:8787)
cd server && npm ci && npm run dev

# 터미널 2 — 앱이 그 릴레이를 가리키도록 지정 (make dev-safe는 환경변수를 그대로 넘긴다)
MINDMAP_RELAY_URL=http://localhost:8787 make dev-safe
```

- `MINDMAP_RELAY_URL`을 주지 않으면 공유 폴더 만들기·참가가 "공유 서버가 설정되지 않아 지금은 사용할 수 없어요"로 막힌다(`make dev-safe`는 이 값을 설정하지 않는다). 배포된 릴레이를 쓰려면 그 `https://` 주소를 넣는다 (현재 배포: relay-server.md "현재 배포").
- `make dev-safe`는 실행마다 임시 userData·워크스페이스를 만들므로, 이 실행에서 만든 공유 폴더의 토큰(`userData`)과 폴더는 그 임시 디렉터리에 남고 다음 `make dev-safe`로는 이어지지 않는다(실제 데이터는 그대로).
- 개발(비패키지) 빌드는 렌더러 CSP `connect-src`에 localhost가 허용된다. 패키지 빌드는 설정된 릴레이 origin 하나만 허용한다.
- 사람이 참가자 역할까지 직접 확인하려면 인스턴스가 둘 필요하다 — 자동화 검증은 E2E(`make e2e-tag tag=@share`)가 테스트마다 자체 릴레이와 두 인스턴스를 띄운다([testing.md](testing.md)).

## 개인 설정

`.claude/settings.local.json.example`을 `.claude/settings.local.json`으로 복사해 개인 Claude Code 설정을 추가한다 (gitignore됨).

## 자주 발생하는 문제

| 증상 | 원인 | 해결 |
|---|---|---|
| `node_modules not found` | npm ci 미실행 | `make setup` |
| Electron 창 안 열림 | 포트 충돌 | 기존 프로세스 종료 후 재시작 |
| macOS Reminders 오류 | 시스템 권한 미부여 | 시스템 설정 → 개인 정보 보호 → 미리 알림 |
| 빌드 타입 오류 | TypeScript 버전 불일치 | `npm ci` 재실행 |
