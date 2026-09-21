# 배포 가이드

> 자세한 배포 프로세스: `docs/release/DEPLOY-UPDATE-SPEC.md`
> 릴리즈 체크리스트: `docs/release/RELEASE-PROCESS.md`

## 배포 개요

GitHub Actions (`release.yml`)가 다음을 자동으로 수행한다:
1. `npm run typecheck && npm test` (게이트)
2. `npm run dist` (빌드 → 서명 → 공증 → 아티팩트 검증)
3. GitHub Release 퍼블리시 (`SteveKim0513/mind-map-mac`)

## 트리거

- `v*` 태그 push: `git tag v0.8.0 && git push origin v0.8.0`
- 수동: GitHub Actions → Release workflow → Run workflow

## 필요한 GitHub Secrets

| Secret | 설명 |
|---|---|
| `MAC_CSC_LINK` | Apple Developer 인증서 (base64) |
| `MAC_CSC_KEY_PASSWORD` | 인증서 비밀번호 |
| `APPLE_ID` | Apple ID |
| `APPLE_APP_SPECIFIC_PASSWORD` | 앱 전용 비밀번호 |
| `APPLE_TEAM_ID` | Apple Team ID |

## 로컬 배포 빌드 (테스트용)

```bash
make dist           # npm run dist (서명·공증 포함, Secrets 필요)
npm run dist:dev    # 개발 빌드 (MindMap Dev, 별도 App ID)
```

**주의**: `make dist`는 운영 배포다. 명시적 승인 없이 실행하지 않는다.

## gh 계정 확인

배포 전 GitHub 활성 계정이 `SteveKim0513`인지 확인한다 (`docs/release/DEPLOY-UPDATE-SPEC.md` 참조):

```bash
gh auth status
```

## 재배포 (같은 버전)

```bash
gh release upload vX.Y.Z --clobber release/MindMap-*
```

## 아티팩트 검증

```bash
node scripts/verify-release.mjs
```

## 릴레이 서버 (공유 폴더) — 앱 배포와 별개

공유 폴더 기능은 앱과 **별도로 배포되는** 릴레이 서버(`server/`)를 쓴다 (결정 [0021](../decisions/0021-shared-folder-relay.md)). 위 GitHub Actions 릴리즈(앱 `.dmg`)는 릴레이를 배포하지 않는다 — 절차·환경변수·운영 제약·문제 해결은 **[relay-server.md](relay-server.md)**.

- 릴레이는 Railway에 `cd server && railway up`(CLI)으로 올린다. 사람의 승인 후에만 실행한다(AGENTS.md "인간 승인이 필요한 작업").
- 앱이 바라보는 릴레이 주소는 `electron/shareConfig.ts`의 `DEFAULT_RELAY_URL`이다(현재 배포된 Railway 릴레이, 2026-09-21 승인). 릴리즈 전에 이 값이 살아 있는 릴레이의 `https://` URL인지(`curl <URL>/health`) 확인한다. 이 값을 바꾸면 모든 사용자의 공유 트래픽 목적지가 바뀌고 옛 버전 앱은 옛 주소를 계속 쓰므로 인간 승인 사항이다.
- 릴레이를 재배포하면 모든 WebSocket 연결이 끊겼다 자동 재접속한다(로컬 사이드카로 데이터 손실 없음) — 사용이 적은 시간에 한다.
- **릴리즈 워크플로**: `.github/workflows/release.yml`은 `npm ci && npm --prefix server ci`로 server를 설치하고, 게이트에서 `npm --prefix server run build`를 루트 테스트보다 먼저 실행한다(루트 통합 테스트·`@share` E2E가 `server/dist/relay.js`를 요구). E2E 스텝 제한시간은 20분(공유 E2E 추가분 반영). 2026-09-21 사용자 승인으로 추가했으며 아직 CI에서 실행해 보지 않았다 — 첫 태그 배포에서 게이트 결과를 확인한다.
