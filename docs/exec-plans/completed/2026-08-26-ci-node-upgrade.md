# CI 릴리즈 워크플로우 Node 20 지원 중단 해소
날짜: 2026-08-26
상태: completed

## 목표
v0.11.6 릴리즈 CI에서 발생한 GitHub Actions 어노테이션 해소:
"Node.js 20 is deprecated. The following actions target Node.js 20 but are being
forced to run on Node.js 24: actions/checkout@v4, actions/setup-node@v4."

## 범위
- 포함: `.github/workflows/release.yml`의 actions 메이저 버전 업(v4→v5),
  빌드 Node 버전 20→22 (Node 20 LTS는 2026-04 EOL, 로컬 개발 환경은 v22.22.3).
- 제외: 빌드·서명·공증·퍼블리시 로직 일체 (변경 없음), package.json engines 핀
  (기존에 없음 — 이번에도 도입하지 않음, 로컬은 이미 22).

## 현재 상태
- 워크플로우는 release.yml 하나뿐. Node 버전 선언도 이 파일이 유일
  (.nvmrc·engines 없음).
- docs/release/DEPLOY-UPDATE-SPEC.md는 흐름·불변식·시크릿만 다루고 도구
  버전은 기록하지 않음 → 문서 갱신 불필요 (검색으로 확인).

## 가정
- checkout@v5·setup-node@v5는 Node 24 기반 (2025년 릴리즈된 안정 메이저) —
  워크플로우 입력 인터페이스는 기존 사용 범위(cache: npm, node-version)에서 동일.
- 로컬 make pre-release가 Node v22.22.3에서 전체 통과했으므로(v0.11.6 게이트)
  빌드 Node 22는 검증된 것과 동일 환경.

## 위험
- CI 러너에서만 재현되는 차이는 다음 릴리즈 태그에서 최종 검증됨.
  workflow_dispatch로 선검증하는 방법은 실제 재배포(재서명·재업로드)를
  일으키므로 채택하지 않음.

## 구현 단계
- [x] release.yml: checkout v4→v5, setup-node v4→v5, node-version 20→22
- [x] make verify (typecheck + unit) 통과 확인
- [x] make harness-check 통과 확인

## 검증 방법
- YAML 구조 유지 확인 (diff 3줄), make verify·harness-check 통과.
- 최종 검증은 다음 릴리즈 태그의 CI 실행에서 어노테이션 부재로 확인.

## 발견한 사실 (작업 중 갱신)
- v0.11.6은 CI에서 빌드돼 로컬 release/ 산출물이 없음 — 사후 정리
  (rm -rf release/mac-arm64) 불필요했음.

## 결정 변경 이력
- 없음.
