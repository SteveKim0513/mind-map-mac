# 릴리즈 프로세스

> 목표: 가볍게, 그러나 매번 같은 방식으로. 한 사람이 30분 안에 끝낼 수 있어야 한다.

## 절차

1. **버전 결정** — `package.json`의 `version` 갱신 (semver: 기능 추가 = minor, 버그만 = patch)
2. **QA 1회전** — [QA-CHECKLIST.md](QA-CHECKLIST.md)를 처음부터 끝까지. 실패 항목은 고치거나, 알려진 이슈로 릴리즈 노트에 명시
3. **릴리즈 노트 작성** — `release/notes/vX.Y.Z.md` (아래 형식)
4. **태그** — `git tag vX.Y.Z && git push --tags`
5. **패키징** — `npm run dist` → .dmg 산출, 새 기기(또는 새 사용자 계정)에서 설치 후 스모크 테스트

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

- [ ] **앱 아이콘** — 현재 기본 Electron 아이콘 (electron-builder `mac.icon` 미설정)
- [ ] **코드 서명·공증** — Developer ID 인증서 없음 → 서명 생략됨. 외부 배포 시 Gatekeeper 경고 발생. Apple Developer Program 가입 + `notarize` 설정 필요

## 자동화 스모크 (선택)

패키징된 앱도 드라이버로 검증 가능: `MINDMAP_USER_DATA`로 격리하고 실행 파일을 `release/mac-arm64/MindMap.app/Contents/MacOS/MindMap`으로 지정. v0.2.0에서 검증한 항목: 실행/홈, isPackaged, DevTools 메뉴 부재, 키보드 트리 작성, 자동 명명, ⌘K, 세션 복원.
