#!/usr/bin/env bash
# PreToolUse hook (Bash) — git commit 전 문서 무결성 게이트
# make harness-check(아키텍처·문서·디자인 구조 검사)가 실패하면 커밋을 차단한다.
# git commit이 아닌 명령이거나 입력 파싱에 실패하면 즉시 통과(exit 0).

set -euo pipefail

INPUT=$(cat - 2>/dev/null || echo '{}')

COMMAND=$(echo "$INPUT" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('input',{}).get('command',''))" 2>/dev/null || echo '')

if [ -z "$COMMAND" ]; then
  exit 0
fi

if ! echo "$COMMAND" | grep -qE '(^|&&|;|\|)\s*git commit(\s|$)'; then
  exit 0
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$SCRIPT_DIR/../.."

if ! OUTPUT=$(cd "$REPO_ROOT" && make harness-check 2>&1); then
  echo "문서/아키텍처 무결성 검사(make harness-check) 실패 — 커밋 전에 고쳐야 합니다:" >&2
  echo "$OUTPUT" | tail -40 >&2
  exit 2
fi

exit 0
