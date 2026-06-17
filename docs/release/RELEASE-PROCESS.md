# 릴리즈 프로세스

> 목표: 가볍게, 그러나 매번 같은 방식으로. 한 사람이 30분 안에 끝낼 수 있어야 한다.

## 절차

1. **버전 결정** — `package.json`의 `version` 갱신 (semver: 기능 추가 = minor, 버그만 = patch)
2. **QA 1회전** — [QA-CHECKLIST.md](QA-CHECKLIST.md)를 처음부터 끝까지. 실패 항목은 고치거나, 알려진 이슈로 릴리즈 노트에 명시
3. **릴리즈 노트 작성** — `release/notes/vX.Y.Z.md` (아래 형식) **+ 두 changelog 최상단에 `## [X.Y.Z] - YYYY-MM-DD` 항목 추가**:
   - **`CHANGELOG.user.md`** (앱에 노출) — **고객 언어로 간결하게**, 효용 중심. **앱의 "업데이트 내역" + "새로운 점" 카드**가 이 파일을 번들해 보여주므로, 최상단 버전이 빌드 버전과 일치해야 한다(`CURRENT_VERSION`이 여기서 나옴).
   - **`CHANGELOG.md`** (개발용) — 기술적 상세(회귀·내부 변경 등). 저장소 기록용, 앱엔 안 보임.
4. **태그** — `git tag vX.Y.Z && git push --tags`
5. **패키징** — `APPLE_KEYCHAIN_PROFILE=mindmap-notary npm run dist` → dmg + zip + `latest-mac.yml` 산출 (서명·공증). 새 기기에서 설치 후 스모크 테스트
6. **퍼블리시 (자동 업데이트 필수)** — dmg·zip·blockmap·`latest-mac.yml`을 GitHub Release(태그 vX.Y.Z)에 업로드. 구버전 앱이 이 피드를 보고 업데이트한다.
   - electron-builder로 한 번에: `APPLE_KEYCHAIN_PROFILE=mindmap-notary GH_TOKEN=<토큰> npm run dist -- --publish always`
   - 또는 수동: `gh release create vX.Y.Z release/MindMap-*.dmg release/MindMap-*-mac.zip release/MindMap-*.blockmap release/latest-mac.yml -t vX.Y.Z -F docs/release/notes/vX.Y.Z.md`
   - **`latest-mac.yml`을 빼먹으면 자동 업데이트가 동작하지 않는다** (앱이 이 파일로 최신 버전을 판단)
7. **정리** — 압축 전 부산물 삭제: `rm -rf release/mac-arm64 release-dev/mac-arm64`. 안 지우면 Spotlight 검색에 설치본과 똑같은 "MindMap"이 하나 더 잡힌다

## 릴리즈 노트 형식 (`notes/vX.Y.Z.md`)

```markdown
# vX.Y.Z — YYYY-MM-DD

## 새 기능
## 개선
## 버그 수정
## 알려진 이슈
```

## 패키징 전 점검 (코드)

- [x] DevTools 메뉴가 배포 빌드에서 숨겨지는가 (`app.isPackaged` 분기) — 2026-06-11 구현, 패키지 빌드에서 검증
- [ ] 로그 레벨이 배포에 적절한가 (electron-log)
- [ ] `npm run typecheck && npm test` 통과

## 외부 배포 전 추가 과제 (v0.2.0 기준 미해결 — 내부 배포는 무관)

- [x] **앱 아이콘** — `scripts/make-icon.py`가 코드로 생성 (팔레트 변경 시 재실행 → `build/icon.icns`). 2026-06-11 v0.2.0에 포함
- [x] **코드 서명·공증** — 2026-06-11 완료. Developer ID 인증서(팀 493CJL5C9A) + 공증 프로필 `mindmap-notary`가 이 Mac 키체인에 설치됨. v0.2.1부터 서명·공증 빌드 (`spctl: accepted, source=Notarized Developer ID`, 앱 스테이플 ✓).
  **증상 (2026-06-11 실확인)**: 미서명 dmg를 다른 Mac에 전송·설치하면 격리 속성 때문에 *"손상되었기 때문에 휴지통으로 이동"* 팝업. 임시 우회: `xattr -cr /Applications/MindMap.app` (우클릭→열기로는 안 풀림). 격리가 안 붙는 exFAT USB 전달도 가능.

### 서명·공증 1회 설정 (Apple ID 필요 — 계정 주인이 직접)

1. **CSR 생성**: 키체인 접근 → 메뉴 "키체인 접근 › 인증서 지원 › 인증 기관에서 인증서 요청" → 이메일 입력, "디스크에 저장됨" 선택 → `.certSigningRequest` 저장
2. **인증서 발급**: developer.apple.com → Certificates → **+** → **"Developer ID Application"** → CSR 업로드 → `.cer` 다운로드 → 더블클릭(키체인에 설치). ※ 법인 계정이면 Account Holder 권한 필요
3. **공증 자격 저장**: appleid.apple.com → 로그인 및 보안 → **앱 암호** 생성. Team ID는 developer.apple.com → Membership에서 확인. 그 후:
   ```bash
   xcrun notarytool store-credentials "mindmap-notary" \
     --apple-id "본인@이메일" --team-id "TEAMID" --password "앱암호"
   ```
4. **이후 모든 릴리즈 빌드**:
   ```bash
   APPLE_KEYCHAIN_PROFILE=mindmap-notary npm run dist
   ```
   인증서는 키체인에서 자동 감지, 공증은 Apple 서버 확인으로 빌드당 수 분 추가. 자격 증명 env 없이 돌리면 기존처럼 미서명 빌드(경고만 출력).

확인 방법: 빌드 로그에 `signing`·`notarization successful`이 보이고, `spctl -a -vv release/mac-arm64/MindMap.app` → `accepted, source=Notarized Developer ID`.

## 테스트용 빌드 — `npm run dist:dev`

배포본과 헷갈리지 않도록 테스트 패키지는 **별도 정체성**으로 빌드한다:
- 이름 "MindMap Dev" + 다크 아이콘 (`build/icon-dev.icns`) → Spotlight·독에서 즉시 구분
- appId `co.imaginefutures.mindmap.dev`, 산출물은 `release-dev/`
- **데이터 완전 분리**: userData `~/Library/Application Support/MindMap Dev`, 기본 워크스페이스 `~/Documents/MindMaps Dev`

세 실행 형태의 정체성 (extraMetadata가 asar의 package.json에 productName을 기록해야 `app.getName()`이 따라온다 — dist 스크립트에 포함됨):

| 형태 | 이름 | userData | 기본 워크스페이스 |
|---|---|---|---|
| 설치본 (`dist`) | MindMap | `…/MindMap` | `~/Documents/MindMaps` |
| 테스트 (`dist:dev`) | MindMap Dev | `…/MindMap Dev` | `~/Documents/MindMaps Dev` |
| 개발 (`npm run dev`) | mind-map | `…/mind-map` | settings.json 따름 |

## 자동화 스모크 (선택)

패키징된 앱도 드라이버로 검증 가능: `MINDMAP_USER_DATA`로 격리하고 실행 파일을 `release/mac-arm64/MindMap.app/Contents/MacOS/MindMap`으로 지정. v0.2.0에서 검증한 항목: 실행/홈, isPackaged, DevTools 메뉴 부재, 키보드 트리 작성, 자동 명명, ⌘K, 세션 복원.
