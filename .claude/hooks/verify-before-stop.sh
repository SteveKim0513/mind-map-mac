#!/usr/bin/env bash
# Stop hook — 종료 전 검증 상태 확인
# make verify가 실행되었는지 확인할 방법이 없으므로 경고만 출력
# 무한 재실행 방지: exit 0으로 항상 통과 (차단하면 세션이 종료 불가)

set -euo pipefail

INPUT=$(cat - 2>/dev/null || echo '{}')

# Stop 이벤트가 아니면 통과
HOOK_EVENT=$(echo "$INPUT" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('hook_event_name',''))" 2>/dev/null || echo '')
if [ "$HOOK_EVENT" != "Stop" ]; then
  exit 0
fi

# 미추적 TypeScript 파일이 있으면 경고
DIRTY_TS=$(git status --short 2>/dev/null | grep -E '\.(ts|tsx)$' | head -5 || echo '')
if [ -n "$DIRTY_TS" ]; then
  echo "주의: 변경된 TypeScript 파일이 있습니다." >&2
  echo "$DIRTY_TS" >&2
  echo "make verify를 실행해 typecheck + test를 확인하세요." >&2
fi

# 항상 통과 (세션 종료를 막지 않음)
exit 0
