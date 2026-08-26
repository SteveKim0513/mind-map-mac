# 하네스 개선: hook 스키마 수정 + exec-plan step 상태 머신

날짜: 2026-08-26
상태: completed

## 목표

1. Hook 스키마 버그 수정 — PreToolUse/PostToolUse hook 6종이 stdin JSON에서 `tool`/`input` 키를
   파싱하지만 실제 Claude Code 스키마는 `tool_name`/`tool_input`이라 fail-open으로 무력화되어 있음.
   `PostCompact`는 존재하지 않는 이벤트명이라 `SessionStart`(matcher `compact`)로 교체.
2. exec-plan에 기계 판독 가능한 step 상태 머신 도입 — `pending/in-progress/completed/blocked/error`
   마커 + `blocked` 상태 개념 (harness_framework repo 벤치마크).
3. implementation-worker 위임 명세 표준화 — 자기완결성, 실행 가능한 AC, "X를 하지 마라. 이유: Y"
   금지 형식, 시그니처 수준 지시 (harness_framework step 설계 원칙 흡수).

## 범위

포함: `.claude/hooks/*.sh` 6종, `.claude/settings.json`, `.claude/hooks/README.md`,
`.claude/rules/documentation.md`, `scripts/harness/check-docs.mjs`,
`.claude/agents/implementation-worker.md`, ADR 1건 + 인덱스 갱신.

제외: 무인 실행기(execute.py 상당) — 상태 머신 사용 경험 축적 후 별도 판단.
`verify-before-stop.sh` 강제력 부여 — 별도 논의 필요.

## 현재 상태

조사 완료. `block-destructive-command.sh:12-18` 등에서 잘못된 키 파싱 직접 확인.
harness_framework repo 전체 분석 완료 (스크래치패드에 클론).

## 가정

- Claude Code hook 입력 스키마: PreToolUse/PostToolUse는 `tool_name`/`tool_input`,
  압축 후 재개는 `SessionStart` + matcher `compact`.
- 기존 fail-open 설계 원칙(hooks/README.md)은 유지한다.

## 위험

- hook 수정 직후부터 이 세션의 Bash/Edit/Write 호출에 hook이 실제 발화하기 시작함 —
  차단 로직 오류 시 정상 명령이 막힐 수 있음 → 파이프 테스트로 정상/차단 케이스 모두 검증.
- check-docs.mjs 검증 추가가 기존 completed/ 계획 21개를 소급 실패시키면 안 됨 →
  검사는 active/ 만 대상, 신규 마커는 경고 수준으로 시작.

## 구현 단계

<!-- 상태 마커: [ ] pending · [>] in-progress · [x] completed · [!] blocked · [e] error -->

- [x] 0. hook-schema-fix — hook 6종 `tool`→`tool_name`, `input`→`tool_input` 수정,
  settings.json `PostCompact`→`SessionStart`(matcher `compact`), hooks/README.md 스키마 갱신
  → hook 6종 + restore-context.sh + settings.json + README 수정 완료
- [x] 1. hook-tests — 수정된 hook 전수 파이프 테스트 (차단 케이스 exit 2 / 통과 케이스 exit 0 /
  advisory 케이스 exit 0 + stderr 메시지)
  → 23/23 통과 (차단 9, 통과 11, advisory 3). 구스키마 fail-open으로 과거 버그도 재현 확인
- [x] 2. step-state-convention — rules/documentation.md 실행 계획 형식에 step 상태 마커·blocked
  상태 추가, check-docs.mjs에 active/ 계획의 마커 어휘 검증 추가
  → 마커 5종 표 + 상태 머신 규칙 문서화, check-docs.mjs 검증 추가 (위반 4종 탐지 확인)
- [x] 3. worker-spec-standard — implementation-worker.md 전제 조건에 자기완결성·실행 가능 AC·
  금지 형식·시그니처 수준 지시 4원칙 반영
  → 전제 조건 4개 → 위임 명세 표준 5요소로 개정
- [x] 4. adr-and-index — ADR 0019 작성 + docs/decisions/README.md + ARCHITECTURE.md 결정 표 갱신
  → 0019-exec-plan-step-state-machine.md 생성, 인덱스 2곳 갱신
- [x] 5. verify — make harness-check + make verify 통과 확인, 계획 파일 completed/ 이동
  → harness-check exit 0 (경고 10건은 기존 디자인 soft-gate), verify exit 0 (272/272 테스트)

## 검증 방법

- 각 hook: 올바른 스키마 JSON 파이프 → 차단 명령 exit 2, 정상 명령 exit 0 확인
- `python3 -c "json.load(...)"` 로 settings.json 유효성 확인
- `make harness-check` exit 0 (check-docs.mjs 변경 포함)
- `make verify` exit 0

## 발견한 사실 (작업 중 갱신)

- 6종 hook 모두 동일한 잘못된 키(`tool`/`input`) 사용, `hook_event_name`을 쓰는
  Stop/PreCompact 계열 3종은 정상 — hook 간 스키마 인식 비일관.
- hooks/README.md의 테스트 예시도 잘못된 스키마로 작성되어 있어 테스트조차 버그를 못 잡았음.

## 결정 변경 이력

- (없음)
