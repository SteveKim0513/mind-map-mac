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

- [x] DevTools 메뉴가 배포 빌드에서 숨겨지는가 (`app.isPackaged` 분기) — 2026-06-11 구현
- [ ] 로그 레벨이 배포에 적절한가 (electron-log)
- [ ] `npm run typecheck && npm test` 통과
