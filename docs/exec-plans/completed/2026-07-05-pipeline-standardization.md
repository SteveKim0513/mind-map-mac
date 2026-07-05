# 파이프라인 표준화
날짜: 2026-07-05
상태: completed

## 목표
개발 → 테스트 → 배포 파이프라인을 표준화해 버그가 배포 전에 잡히도록 한다.

## 범위
1. playwright.config.ts 정비 (타임아웃, 설정)
2. Makefile — test:e2e, smoke, bump 타겟 추가
3. scripts/smoke.mjs — 핵심 화면 스크린샷 자동화
4. scripts/bump-version.mjs — 버전 범프 원스텝
5. .github/workflows/release.yml — E2E 스텝 추가
6. docs/release/notes/TEMPLATE.md — 릴리즈 노트 템플릿

## 구현 단계
- [x] exec-plan 작성
- [ ] playwright.config.ts 정비
- [ ] Makefile 타겟 추가
- [ ] scripts/smoke.mjs
- [ ] scripts/bump-version.mjs
- [ ] release.yml E2E 스텝
- [ ] docs/release/notes/TEMPLATE.md
- [ ] make verify

## 최종 표준 흐름
```
make dev                   # 개발
make verify                # 커밋 전
make verify-full           # PR 전
make test:e2e              # E2E 통과 확인
make smoke                 # 핵심 화면 눈으로 확인
make bump version=X.Y.Z   # 릴리즈 준비
git push origin main --tags # 배포 (CI 자동 실행)
```
