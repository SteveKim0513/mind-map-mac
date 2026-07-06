# 배포 & 업그레이드 시스템 명세 (Deploy / Auto-Update)

> 이 문서가 **단일 기준**입니다. 배포·업데이트 작업 전에 먼저 읽으세요.
> - 빠른 절차(매 릴리즈 30분 런북) → [RELEASE-PROCESS.md](RELEASE-PROCESS.md)
> - 자동 업데이트 제품 명세 → [../product/specs/2026-06-11-auto-update.md](../product/specs/2026-06-11-auto-update.md)
> - 이 문서 = **시스템 전체 그림 + 불변식 + 고장 모드 진단**(왜 안 되는지).

---

## 0. 한눈에 — 파이프라인

```
package.json version ↑  →  CHANGELOG.user.md 항목 ↑  →  git tag vX.Y.Z
   →  npm run dist (서명+공증)  →  dmg · zip · blockmap · latest-mac.yml
   →  GitHub Release (SteveKim0513/mind-map-mac, 태그 vX.Y.Z) 에 4종 업로드
   →  구버전 앱이 latest-mac.yml 피드 감지 → zip 백그라운드 다운로드 → 서명검증 → 재시동
```

도구: **electron-builder 25**(패키징) + **electron-updater 6 / Squirrel.Mac**(자동 업데이트), 피드 = **GitHub Releases**.

---

## 1. 세 가지 정체성 (절대 혼동 금지)

| 빌드 | 명령 | 이름(`app.getName()`) | appId | 산출물 | 업데이트 |
|---|---|---|---|---|---|
| **배포본** | `npm run dist` | `MindMap` | `co.imaginefutures.mindmap` | `release/` | **켜짐** |
| **테스트** | `npm run dist:dev` | `MindMap Dev` | `…mindmap.dev` | `release-dev/` | 꺼짐 |
| **개발** | `npm run dev` | `mind-map` | — | — | 꺼짐 |

> 자동 업데이트는 **`app.isPackaged && app.getName()==='MindMap'`** 일 때만 동작(`electron/updater.ts` `isUpdateEnabled`). 그래서 `extraMetadata.productName`이 asar의 package.json에 박혀야 함 → `dist` 스크립트에 이미 포함.

---

## 2. 동작에 필요한 불변식 (이 중 하나라도 깨지면 "안 됨")

배포·업데이트가 동작하려면 **모두** 참이어야 합니다. 고장나면 §6에서 해당 항목을 찾으세요.

1. **버전 일치**: `package.json.version` == git 태그(`vX.Y.Z`) == GitHub Release 태그 == `CHANGELOG.user.md` 최상단 `## [X.Y.Z]`.
   - 인앱 `CURRENT_VERSION`은 `CHANGELOG.user.md` 최상단에서 나옴(`src/ui/changelog.ts`). 빌드 버전과 다르면 "새로운 점" 카드가 어긋남.
2. **서명+공증된 빌드**: Squirrel.Mac은 zip의 **코드 서명을 검증**함. 미서명/미공증 zip은 **업데이트가 조용히 실패**하고, 미서명 dmg는 다른 Mac에서 *"손상되어 휴지통으로"* 가 뜸. → `APPLE_KEYCHAIN_PROFILE=mindmap-notary` 로 빌드해야 함.
3. **피드 4종이 Release에 모두 업로드**: `latest-mac.yml`(필수 — 버전 판단), `*-mac.zip`(업데이트 본체), `*.blockmap`(차등), `*.dmg`(수동 다운로드).
   - **`latest-mac.yml` 누락 = 자동 업데이트 0% 동작.**
4. **Release가 올바른 repo·태그에**: `publish` 대상 = `SteveKim0513/mind-map-mac`. origin도 동일 repo(✓). Release는 **공개**여야 앱이 토큰 없이 피드를 읽음.
5. **아키텍처 매칭**: `latest-mac.yml`에 적힌 zip의 arch가 사용자 Mac과 맞아야 함. 현재 빌드는 **호스트 arch만**(arm64). → §5 참고.
6. **버전이 더 높아야 함**: 사용자 설치본 버전 < Release 버전이라야 업데이트가 뜸. 같거나 낮으면 "최신입니다".

---

## 3. 자동 업데이트 동작 (런타임)

`electron/updater.ts` (`initAutoUpdate` / `checkForUpdatesManually` / `installUpdate`):

- **주기**: 앱 시작 **10초 후 1회** + 이후 **4시간마다**. `autoDownload=true`, `autoInstallOnAppQuit=true`.
- **UX(친절 원칙)**: 다운로드 **완료 시에만** 사용자에게 노출(`지금 재시동 / 나중에`). 확인·다운로드 **실패는 침묵**(로그만). 메뉴바 *"업데이트 확인…"* 수동 확인만 결과(최신/실패)를 표시.
- **피드**: package.json `build.publish`(github owner/repo)에서 electron-updater가 자동 파생.
- **테스트 훅**: `MINDMAP_UPDATE_URL` env → generic 피드로 대체(E2E).
- IPC: `update:check`, `update:install`. 메뉴: MindMap → "업데이트 확인…".

---

## 4. 릴리즈 런북 (정식 절차)

> 자격증명 1회 설정(인증서·공증 프로필)은 [RELEASE-PROCESS.md](RELEASE-PROCESS.md) §서명·공증 1회 설정 참고.

```bash
# 1) 버전 올리기 (semver: 기능=minor, 버그=patch)
#    package.json "version" 수정

# 2) 변경 기록 (둘 다 최상단에 ## [X.Y.Z] - YYYY-MM-DD 추가)
#    - CHANGELOG.user.md  (앱 노출 · 고객 언어 · CURRENT_VERSION의 출처)
#    - CHANGELOG.md        (개발용 상세)
#    - (선택) docs/release/notes/vX.Y.Z.md

# 3) 게이트
npm run typecheck && npm test

# 4) 태그
git tag vX.Y.Z && git push --tags

# 5) 패키징 + 퍼블리시 (서명·공증 + GitHub Release 업로드 한 번에)
APPLE_KEYCHAIN_PROFILE=mindmap-notary GH_TOKEN=<repo 쓰기 토큰> \
  npm run dist -- --publish always

#    --publish 없이 만들었다면 수동 업로드(4종 전부!):
#    gh release create vX.Y.Z \
#      release/MindMap-*.dmg release/MindMap-*-mac.zip \
#      release/MindMap-*.blockmap release/latest-mac.yml \
#      -t vX.Y.Z -F docs/release/notes/vX.Y.Z.md

# 6) 검증 (§7)
# 7) 정리: rm -rf release/mac-arm64 release-dev/mac-arm64  (Spotlight 중복 방지)
```

### 같은 버전 재배포 (이미 published 릴리즈가 있을 때)

`--publish always` 는 draft 로 올리려다 기존 published 릴리즈와 충돌해 **전부 skip** 한다.
빌드(서명·공증)는 하되, 업로드는 **소유자 계정으로 clobber**:

```bash
# 1) 서명·공증 빌드 (퍼블리시 실패는 무시 — 자산은 release/ 에 생성됨)
APPLE_KEYCHAIN_PROFILE=mindmap-notary npm run dist
# 2) gh 활성 계정을 repo 소유자로 전환 (imaginefutures 는 쓰기 불가)
gh auth switch --user SteveKim0513
# 3) 5종 자산을 기존 릴리즈에 덮어쓰기
gh release upload vX.Y.Z -R SteveKim0513/mind-map-mac --clobber \
  release/MindMap-X.Y.Z-arm64.dmg release/MindMap-X.Y.Z-arm64.dmg.blockmap \
  release/MindMap-X.Y.Z-arm64-mac.zip release/MindMap-X.Y.Z-arm64-mac.zip.blockmap \
  release/latest-mac.yml
# 4) 계정 복구
gh auth switch --user imaginefutures
```

---

## 5. 아키텍처 커버리지 (지금의 약점)

- 현재 `build.mac`에 `arch` 미지정 → **빌드 머신의 arch만** 산출(이 Mac = arm64). `latest-mac.yml`도 arm64 zip만 가리킴.
- **결과**: Intel(x64) Mac 사용자는 설치/업데이트 불가(피드에 맞는 zip이 없음).
- **선택지(배포 범위 정할 때 결정)**:
  - arm64만 공식 지원(현재). README/다운로드 페이지에 명시.
  - 또는 universal 빌드: `electron-builder --mac --universal` (용량↑, Rosetta 불필요). `latest-mac.yml`이 universal zip을 가리키게 됨.
  - 또는 arm64+x64 두 zip을 같은 Release에 — electron-updater가 사용자 arch에 맞는 걸 고름.
- **권장**: 외부 배포 전 universal 또는 2-arch로 전환(미정 시 arm64 전용임을 문서화).

---

## 6. 고장 모드 & 진단 (왜 "안 되는지")

| 증상 | 가장 흔한 원인 | 진단/조치 |
|---|---|---|
| **업데이트가 전혀 안 뜸** | `latest-mac.yml` 미업로드 / Release가 private / 잘못된 repo·태그 | Release 자산에 `latest-mac.yml` 있는지, repo=`mind-map-mac`·**public**·태그=`vX.Y.Z` 확인. 앱 로그(`electron-log`) `[updater]` 줄 확인 |
| **"최신입니다"만 나옴** | Release 버전 ≤ 설치본 버전 / `package.json` 버전 안 올림 | 세 버전(pkg·태그·release) 일치 + Release가 더 높은지 |
| **다운로드 후 설치 실패 / 조용히 실패** | zip **미서명·미공증** (Squirrel 서명검증 실패) | `APPLE_KEYCHAIN_PROFILE` 로 재빌드. 로그에 `signing`·`notarization successful` 보이는지. `spctl -a -vv release/mac-arm64/MindMap.app` → `Notarized Developer ID` |
| **다른 Mac에서 "손상되어 휴지통으로"** | 미서명 dmg + 격리 속성 | 서명·공증 빌드로 배포. 임시 우회 `xattr -cr /Applications/MindMap.app` |
| **Intel Mac에서 설치/업데이트 안 됨** | arm64 전용 빌드 | §5 — universal/2-arch 빌드 |
| **인앱 "새로운 점"이 안 뜸/버전 어긋남** | `CHANGELOG.user.md` 최상단 버전 ≠ 빌드 버전 | 최상단 `## [X.Y.Z]`를 빌드 버전과 맞춤 (`CURRENT_VERSION` 출처) |
| **공증 실패/멈춤** | 앱 암호 만료 / Team ID 불일치 / 네트워크 | `xcrun notarytool history --keychain-profile mindmap-notary` 로 상태 확인, 자격 재저장 |
| **`--publish` 가 401/403/404 (자산 업로드·삭제 실패)** | `gh` **활성 계정이 `imaginefutures`** — 이 repo(소유자 `SteveKim0513`)에 **쓰기 권한 없음**. git push는 SSH 키(stevekim)로 되지만 `gh` API는 활성 계정 토큰을 씀 | `gh auth switch --user SteveKim0513` 로 전환 후 업로드. 끝나면 `--user imaginefutures` 로 복구. (`GH_TOKEN=$(gh auth token)` 도 활성 계정 토큰이라 같은 함정) |
| **`--publish always` 인데 아무것도 안 올라감 / "skipped, existing type not compatible"** | electron-builder는 **draft**로 publish하려는데 이미 **published 릴리즈**가 같은 버전으로 존재 → 전부 skip | **같은 버전 재배포**는 `gh release upload vX.Y.Z --clobber <자산들>` 로 직접 덮어쓰기(§4 재배포 레시피). 또는 새 버전으로 올림 |
| **Spotlight에 MindMap 두 개** | 빌드 부산물 `release/mac-arm64/` 미삭제 | §4 step7 정리 |
| **정식 설치본인데 "개발 빌드예요 / 자동 업데이트 꺼짐"** (한 번 업데이트 후 영구히) | **asar의 package.json에 `productName` 누락** → `app.getName()`이 lowercase `'mind-map'`으로 떨어짐 → 옛 `isUpdateEnabled`의 `=== 'MindMap'`가 false. 자기 자신을 못 고침 (v0.7.5–0.7.7 실제 발생) | 로그가 `~/Library/Logs/mind-map/`에 쌓이고 `[updater] disabled (packaged=true, name=mind-map)` 찍힘. **고침(v0.7.9)**: ① `build.extraMetadata.productName` 영구 박기 ② 가드를 `isPackaged && !getName().endsWith('Dev')`로 fail-open. **이미 막힌 설치본은 자동 업데이트 불가 → 0.7.9 dmg로 1회 수동 재설치 필요** |
| **dev/dev-dist에서 업데이트가 뜸(원치 않게)** | 이름/패키지 분기 깨짐 | `isUpdateEnabled` = `isPackaged && !getName().endsWith('Dev')`. Dev는 `extraMetadata.productName='MindMap Dev'`로 구분 |

---

## 7. 릴리즈 검증 (반드시)

```bash
# 서명·공증
spctl -a -vv "release/mac-arm64/MindMap.app"      # → accepted, source=Notarized Developer ID
codesign --verify --deep --strict "release/mac-arm64/MindMap.app"

# 피드 자산 4종이 Release에 있는지
gh release view vX.Y.Z -R SteveKim0513/mind-map-mac --json assets -q '.assets[].name'
#   → dmg, *-mac.zip, *.blockmap, latest-mac.yml 가 모두 보여야 함

# latest-mac.yml 의 버전/파일/sha512 가 zip 과 일치하는지 육안 확인
```

업데이트 경로 E2E: 구버전 앱을 `MINDMAP_UPDATE_URL`로 로컬 피드에 붙여 감지→다운로드→재시동을 확인(자동 업데이트 명세 §완료기준 참고).

---

## 8. 자격증명 / 환경 (요약)

| 무엇 | 어디 | 비고 |
|---|---|---|
| Developer ID Application 인증서 | 이 Mac 키체인 (팀 `493CJL5C9A`) | 빌드 시 자동 감지 |
| 공증 프로필 `mindmap-notary` | `xcrun notarytool store-credentials` | `APPLE_KEYCHAIN_PROFILE` 로 지정 |
| `GH_TOKEN` | 셸 env (릴리즈 시) | `mind-map-mac` 쓰기 권한 |
| `MINDMAP_UPDATE_URL` | (테스트만) | generic 피드 override |

> 자격증명 env 없이 `npm run dist` 하면 **미서명 빌드**(경고만) — 배포 금지(업데이트·격리 문제).

---

## 9. CI 릴리즈 워크플로 (`.github/workflows/release.yml`)

태그 `vX.Y.Z` push **또는** 수동 실행(Actions → Release → Run workflow)으로
빌드·서명·공증·퍼블리시를 한 번에. 러너 `macos-14`(arm64).

```
git tag vX.Y.Z && git push --tags     # → 워크플로가 자동으로 빌드·서명·공증·publish
#   또는 재배포: gh workflow run release.yml -R SteveKim0513/mind-map-mac
```

### 최초 1회 — 시크릿 5개 등록 (이것 없으면 CI 빌드가 서명 단계에서 실패)

`GITHUB_TOKEN`은 Actions가 자동 제공하므로 별도 등록 불필요. 나머지 5개는
**값이 민감**하므로 계정 주인이 직접 등록한다(서명 개인키·Apple 자격).

1. **인증서 .p12 내보내기** — 키체인 접근 → "내 인증서" → *Developer ID Application: …(493CJL5C9A)* 우클릭 → **항목 내보내기** → `.p12` 저장(내보내기 암호 지정).
2. **시크릿 등록** (값은 본인이 입력 — 이 명령들을 터미널에서 `! ` 로 직접):
   ```bash
   base64 -i DeveloperID.p12 | gh secret set MAC_CSC_LINK -R SteveKim0513/mind-map-mac
   gh secret set MAC_CSC_KEY_PASSWORD -R SteveKim0513/mind-map-mac   # 위 내보내기 암호
   gh secret set APPLE_ID                     -R SteveKim0513/mind-map-mac   # Apple ID 이메일
   gh secret set APPLE_APP_SPECIFIC_PASSWORD  -R SteveKim0513/mind-map-mac   # appleid.apple.com 앱암호
   gh secret set APPLE_TEAM_ID                -R SteveKim0513/mind-map-mac   # 493CJL5C9A
   rm DeveloperID.p12   # 등록 후 .p12 삭제(개인키)
   ```
3. 확인: `gh secret list -R SteveKim0513/mind-map-mac` → 5개 보이면 끝.

> 로컬 빌드(이 Mac)는 키체인 인증서 + `mindmap-notary` 프로필을 그대로 쓰므로 시크릿 불필요.
> CI는 키체인이 없어 `CSC_LINK`/`APPLE_*` 로 매 실행 임시 키체인을 만든다.

### CI 서명 시크릿 갱신 (`MAC_CSC_LINK` 만료·분실 시)

증상: CI에서 `MAC_CSC_LINK GitHub Secret이 비어 있습니다` 오류가 나거나 `not a file` 같은 불명확한 electron-builder 오류.

**자동 갱신 스크립트 (권장)**:
```bash
node scripts/refresh-ci-secrets.mjs
# → 로컬 키체인에서 Developer ID 인증서를 p12로 내보내
#    MAC_CSC_LINK · MAC_CSC_KEY_PASSWORD 시크릿을 자동 갱신
```

수동 갱신:
1. 키체인 접근 → Developer ID Application: Imagine Furtures (493CJL5C9A) 내보내기
2. `base64 -i cert.p12 | gh secret set MAC_CSC_LINK -R SteveKim0513/mind-map-mac`
3. `gh secret set MAC_CSC_KEY_PASSWORD -R SteveKim0513/mind-map-mac`

> `APPLE_APP_SPECIFIC_PASSWORD`는 만료되지 않지만 Apple ID 비밀번호를 바꾸면 재생성 필요.
> 갱신 후 `gh workflow run release.yml -R SteveKim0513/mind-map-mac` 로 재실행.

### CI 실패 시 로컬 배포 대체 경로

CI가 서명 문제로 막혔을 때, 이 Mac에서 직접 빌드·배포한다:

```bash
make release   # APPLE_KEYCHAIN_PROFILE=mindmap-notary npm run dist + gh release 업로드
```

`make release`는 다음 순서로 동작한다:
1. `APPLE_KEYCHAIN_PROFILE=mindmap-notary npm run dist` → 로컬 키체인으로 서명·공증·검증
2. `node scripts/publish-release.mjs` → SteveKim0513 계정으로 GitHub Release 생성/업로드

> `make release` 전에 `make bump version=X.Y.Z && git push origin main --tags`로 버전 범프와 태그를 먼저 올린다.

---

## 11. 릴리즈 검증 게이트 (`scripts/verify-release.mjs`) — 재발 방지

`npm run dist`는 **빌드 직후 자동으로** 이 게이트를 돌리고, 하나라도 깨지면
**0이 아닌 코드로 종료해 그 자리에서 배포를 막는다**(`npm run verify:release`로 단독 실행도 가능).
각 검사는 실제로 겪은 사고에 1:1로 대응한다(§6):

| 검사 | 막는 사고 |
|---|---|
| asar `productName == "MindMap"` | **v0.7.5–0.7.7 자동 업데이트 영구 비활성** (이번 건) |
| Info.plist 버전 == package.json | 버전 드리프트 |
| spctl `Notarized Developer ID` | 미서명·미공증 배포 (격리 "손상" / 업데이트 실패) |
| `CHANGELOG.user.md` 최상단 == 버전 | 인앱 "새로운 점" 어긋남 |
| `latest-mac.yml` 버전 + zip sha512 일치 | 피드 손상 → 업데이트 안 됨 |

추가 방어선:
- **단위 테스트** `src/shared/updateGate.test.ts` — 업데이트 가드 로직을 박제(특히 `name='mind-map'`로 떨어져도 prod는 enabled = fail-open). `npm test`/CI에서 회귀 즉시 검출.
- **빌드 설정** `build.extraMetadata.productName` — 모든 electron-builder 빌드가 asar에 productName을 주입(CLI 플래그·빌드 명령에 의존하지 않음).
- **CI**(`release.yml`) — `npm run dist`(빌드+검증)와 **publish 단계를 분리**해, 검증 실패 시 절대 publish되지 않음. publish는 repo 자체 `GITHUB_TOKEN`을 써서 계정 전환 함정도 없음.

> 즉, productName 누락·버전 드리프트·미서명·피드 불일치는 이제 **사람이 빠뜨려도 릴리즈가 안 나간다.**

---

## 10. 향후 개선 (백로그)

- [x] **CI 릴리즈 워크플로** — `.github/workflows/release.yml`(§9). 빌드+검증 후 분리 publish. 시크릿 등록 후 동작.
- [x] **릴리즈 검증 게이트** — `scripts/verify-release.mjs`(§11) + `updateGate` 단위 테스트.
- [ ] **universal/2-arch** 빌드로 Intel 커버(외부 배포 전).
- [ ] `docs/release/notes/` 과거분 메우기(현재 v0.7.9·v0.2~0.7.4; v0.7.5–0.7.8 사후 기록 누락).
- [ ] 업데이트 채널(beta/stable) 분리 — 지금은 단일.
```
