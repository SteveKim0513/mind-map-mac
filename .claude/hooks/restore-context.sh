#!/usr/bin/env bash
# PostCompact hook — 컨텍스트 압축 후 상태 파일 재로드 안내
# 항상 exit 0

set -euo pipefail

INPUT=$(cat - 2>/dev/null || echo '{}')

HOOK_EVENT=$(echo "$INPUT" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('hook_event_name',''))" 2>/dev/null || echo '')
if [ "$HOOK_EVENT" != "PostCompact" ]; then
  exit 0
fi

SESSION_FILE=".claude/session-state.md"

if [ -f "$SESSION_FILE" ]; then
  echo "" >&2
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" >&2
  echo "컨텍스트 압축 완료." >&2
  echo "세션 상태 복원을 위해 다음을 실행하세요:" >&2
  echo "  Read: $SESSION_FILE" >&2
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" >&2
else
  echo "세션 상태 파일 없음. git status --short 로 현재 상태를 확인하세요." >&2
fi

exit 0
