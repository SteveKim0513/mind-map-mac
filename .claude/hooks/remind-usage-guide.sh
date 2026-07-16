#!/usr/bin/env bash
# PreToolUse hook (Bash) — git commit 시 "사용 안내(사용법)" 동기화 리마인더.
# 사용자 대면 기능 코드가 스테이징됐는데 사용 안내(src/ui/Manual.tsx)가 함께 바뀌지
# 않았으면 알린다. 차단하지 않음(advisory) — "기능이 추가/변경되면 사용 안내도 같이
# 갱신"을 매 기능 커밋마다 상기시키는 용도. 내부 리팩터·버그 수정이면 그대로 진행하면 된다.

set -euo pipefail

INPUT=$(cat - 2>/dev/null || echo '{}')

COMMAND=$(echo "$INPUT" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('input',{}).get('command',''))" 2>/dev/null || echo '')
[ -z "$COMMAND" ] && exit 0
echo "$COMMAND" | grep -qE '(^|&&|;|\|)\s*git commit(\s|$)' || exit 0

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$SCRIPT_DIR/../.."
cd "$REPO_ROOT"

STAGED=$(git diff --cached --name-only 2>/dev/null || echo '')
[ -z "$STAGED" ] && exit 0

# 사용자 대면 기능 코드가 바뀌었나 (테스트·타입 정의는 제외)
FEATURE=$(echo "$STAGED" | grep -E '^src/.*\.(ts|tsx)$' | grep -vE '\.test\.(ts|tsx)$|(^|/)types\.ts$' || true)
[ -z "$FEATURE" ] && exit 0

# 사용 안내가 함께 스테이징됐으면 통과
echo "$STAGED" | grep -qE '^src/ui/Manual\.tsx$' && exit 0

echo "사용 안내 동기화 확인 — 기능 코드가 바뀌었는데 src/ui/Manual.tsx가 스테이징에 없습니다." >&2
echo "→ 사용자 대면 기능을 추가/변경했다면 src/ui/Manual.tsx(설정 › 사용 안내)와" >&2
echo "  docs/product/FEATURE-INVENTORY.md도 같은 커밋에서 갱신하세요." >&2
echo "  (내부 리팩터·버그 수정이라 안내 변경이 불필요하면 그대로 진행)" >&2
exit 0
