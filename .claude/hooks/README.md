# Hooks

Claude Code가 실행하는 이벤트 기반 스크립트. `.claude/settings.json`에서 등록한다.

## 등록된 Hooks

| 이벤트 | 스크립트 | 목적 |
|---|---|---|
| `PreToolUse` (Bash) | `block-destructive-command.sh` | 파괴적 명령 차단 |
| `PreToolUse` (Bash) | `check-docs-before-commit.sh` | `git commit` 전 `make harness-check` 실행 — 문서 구조 무결성(폴더 지도·결정 표·인덱스 동기화) 깨지면 커밋 차단 |
| `PreToolUse` (Edit/Write) | `protect-sensitive-files.sh` | 민감 파일 보호 |
| `PostToolUse` (Edit/Write) | `format-changed-files.sh` | 변경 파일 빠른 타입 검사 |
| `PostToolUse` (Write) | `remind-doc-index.sh` | 새 결정/명세/리포트 문서 생성 시 인덱스 갱신 안내 (advisory) |
| `Stop` | `verify-before-stop.sh` | 종료 전 검증 상태 확인 |

## Hook 개발 원칙

- 모든 스크립트는 실행 권한(`chmod +x`)이 필요하다.
- 입력 JSON은 stdin으로 받는다.
- 차단 시 `exit 2`와 이유를 stderr에 출력한다 (Claude에게 전달됨).
- 경고 시 `exit 1`과 메시지를 출력한다.
- 통과 시 `exit 0`.
- 타임아웃은 스크립트 내에서 처리한다 (Claude Code 기본 타임아웃에 의존하지 않음).
- 셸 인젝션을 방지한다 — 입력을 `eval`하거나 직접 보간하지 않는다.

## 테스트 방법

각 hook은 다음과 같이 직접 테스트할 수 있다:

```bash
# PreToolUse hook 테스트 (Bash 도구)
echo '{"tool":"Bash","input":{"command":"rm -rf /"}}' | .claude/hooks/block-destructive-command.sh
echo $?  # 2 = 차단, 0 = 통과

# Edit hook 테스트
echo '{"tool":"Edit","input":{"file_path":"/Users/me/.ssh/id_rsa"}}' | .claude/hooks/protect-sensitive-files.sh
echo $?  # 2 = 차단

# 문서 무결성 게이트 테스트 (git commit이 아니면 즉시 통과)
echo '{"tool":"Bash","input":{"command":"git commit -m \"x\""}}' | .claude/hooks/check-docs-before-commit.sh
echo $?  # 0 = make harness-check 통과, 2 = 차단(원인은 stderr)

# 인덱스 갱신 안내 테스트
echo '{"tool":"Write","input":{"file_path":"docs/product/specs/2026-07-14-example.md"}}' | .claude/hooks/remind-doc-index.sh
echo $?  # 항상 0 — advisory
```

## 실패 시 안전 방향

Hook이 예상치 못한 입력으로 오류가 나면 `exit 0`으로 안전하게 통과시킨다
(차단이 더 위험한 경우 — Hook 오류로 Claude Code 세션이 망가지지 않도록).
`block-destructive-command.sh`, `check-docs-before-commit.sh` 두 Hook만 예외적으로,
**의도된 검사 결과가 실패일 때** 차단하도록 설계한다(입력 파싱 실패 등 예상치 못한 오류는 이 둘도 `exit 0`).
