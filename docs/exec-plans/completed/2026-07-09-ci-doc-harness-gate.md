# CI에 문서 정합성 검사(harness-check) 게이트 추가

날짜: 2026-07-09
상태: completed

## 목표

`make harness-check`(문서 링크·상태 필드·번호 중복 검사)가 지금까지 로컬에서만 수동 실행되어, exec-plan이 완료된 뒤에도 `active/`에 방치되거나 `FEATURE-INVENTORY.md`가 갱신 없이 방치되는 문제가 실제로 발생했다(2026-07-09 조사에서 4건 발견). 배포 파이프라인(`release.yml`)에 이 검사를 추가해, 문서 불일치가 있는 상태로 배포되는 것을 자동으로 막는다.

## 범위 (포함 / 제외)

- 포함: `.github/workflows/release.yml`의 "Gate" 스텝 뒤에 `make harness-check` 실행 스텝 추가.
- 제외: 로컬 git pre-commit hook(husky 등) 도입 — 사용자가 CI만 적용하기로 결정함. PR 단위 CI 워크플로우 신설도 제외(현재 CI는 release 트리거 하나뿐이며, 이번 범위는 그 안에 검사를 추가하는 것으로 한정).

## 현재 상태

- `release.yml`은 태그 push 또는 수동 실행 시 `npm ci` → typecheck+test → e2e → 서명 확인 → 빌드/서명/공증/검증 → GitHub Release 퍼블리시 순으로 진행한다.
- `make harness-check`(`scripts/harness/check-docs.mjs` + 디자인 검사)는 CI에 없고 로컬에서만 수동 실행된다.

## 가정

- `make harness-check`는 macOS 러너(현재 CI 러너: `macos-14`)에서 추가 의존성 설치 없이 실행 가능하다 (Node 스크립트 기반).
- 문서 검사 실패는 배포를 막을 만큼 중요하다 — 실패 시 `exit 1`로 잡 실패 처리.

## 위험

- 검사가 너무 엄격하면(예: 기존 경고성 항목이 fail로 격상되면) 정상 배포가 막힐 수 있음 → 현재 `check-docs.mjs`는 fail/warn을 구분하고 있고, warn은 종료 코드에 영향 없음을 확인했음.
- 이번 작업은 CI 스텝 추가만이며 `check-docs.mjs` 검사 로직 자체는 변경하지 않는다(로직 변경은 별도 작업에서 이미 완료: 상태-위치 정합성 검사 추가).

## 구현 단계

- [x] `.github/workflows/release.yml`의 "Gate (typecheck + unit test)" 스텝 다음에 "Gate (docs harness)" 스텝 추가, `make harness-check` 실행.
- [x] 로컬에서 `make harness-check` 실행해 현재 통과 상태 재확인 (CI에서도 동일하게 통과할 것으로 예상).
- [x] `docs/release/DEPLOY-UPDATE-SPEC.md`에 게이트 목록 갱신(문서 검사 게이트 추가 언급).

## 검증 방법

- 로컬: `make harness-check` 종료 코드 0 확인.
- CI: 다음 배포(태그 push 또는 workflow_dispatch) 시 새 스텝이 실행되고 통과하는지 Actions 로그로 확인 (이번 작업에서는 실제 CI 실행까지는 트리거하지 않음 — 다음 정식 배포에서 자연히 검증됨).

## 발견한 사실 (작업 중 갱신)

- CI는 release.yml 하나뿐이며 PR/push 단위 CI는 존재하지 않는다. 따라서 "커밋마다" 검사는 로컬 hook 없이는 불가능하고, 이번 변경은 "배포마다" 검사하는 것으로 범위가 한정된다.

## 결정 변경 이력

- 2026-07-09: 사용자가 "로컬 pre-commit + CI 둘 다" 대신 "CI(release.yml)에만 추가"를 선택. 이유: 로컬 hook은 팀원별 설치가 필요하고 `--no-verify`로 우회 가능해 완전한 강제가 안 됨.
