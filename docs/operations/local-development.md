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
make setup          # npm ci
```

## 개발 서버 실행

```bash
make dev            # npm run dev
```

Electron 창이 열리고 Vite HMR이 활성화된다. 렌더러 변경은 즉시 반영된다.
`electron/` 변경은 앱 재시작이 필요하다.

## E2E 격리 실행

실제 사용자 데이터와 격리해 테스트하려면:

```bash
MINDMAP_USER_DATA=/tmp/mindmap-test-data MINDMAP_WORKSPACE=/tmp/mindmap-test-workspace make dev
```

## 환경 변수

| 변수 | 설명 | 기본값 |
|---|---|---|
| `MINDMAP_USER_DATA` | userData 경로 오버라이드 (E2E 격리용) | Electron 기본값 |
| `MINDMAP_WORKSPACE` | 워크스페이스 경로 오버라이드 (E2E용) | null |
| `VITE_DEV_SERVER_URL` | Vite 개발 서버 URL (자동 설정) | - |

## 개인 설정

`.claude/settings.local.json.example`을 `.claude/settings.local.json`으로 복사해 개인 Claude Code 설정을 추가한다 (gitignore됨).

## 자주 발생하는 문제

| 증상 | 원인 | 해결 |
|---|---|---|
| `node_modules not found` | npm ci 미실행 | `make setup` |
| Electron 창 안 열림 | 포트 충돌 | 기존 프로세스 종료 후 재시작 |
| macOS Reminders 오류 | 시스템 권한 미부여 | 시스템 설정 → 개인 정보 보호 → 미리 알림 |
| 빌드 타입 오류 | TypeScript 버전 불일치 | `npm ci` 재실행 |
