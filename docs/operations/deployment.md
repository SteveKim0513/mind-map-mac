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
