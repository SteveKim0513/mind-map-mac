#!/usr/bin/env bash
# PostToolUse hook (Write) — 새 decisions/specs/reports 문서 생성 시 인덱스 갱신 안내
# 차단하지 않음(advisory) — 실제 강제는 check-docs-before-commit.sh(make harness-check)가 한다.

set -euo pipefail

INPUT=$(cat - 2>/dev/null || echo '{}')

TOOL=$(echo "$INPUT" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('tool',''))" 2>/dev/null || echo '')
if [ "$TOOL" != "Write" ]; then
  exit 0
fi

FILE_PATH=$(echo "$INPUT" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('input',{}).get('file_path',''))" 2>/dev/null || echo '')

BASENAME=$(basename "$FILE_PATH" 2>/dev/null || echo '')
if [ "$BASENAME" = "README.md" ]; then
  exit 0
fi

if echo "$FILE_PATH" | grep -qE 'docs/decisions/[0-9]{4}-.*\.md$'; then
  echo "새 결정 기록 감지: $FILE_PATH" >&2
  echo "→ docs/decisions/README.md 목록에 추가하고, ARCHITECTURE.md '핵심 설계 결정' 표도 갱신하세요 (make harness-check가 누락을 잡습니다)." >&2
elif echo "$FILE_PATH" | grep -qE 'docs/product/specs/.*\.md$'; then
  echo "새 기능 명세 감지: $FILE_PATH" >&2
  echo "→ docs/product/specs/README.md 목록에 추가하세요 (make harness-check가 누락을 잡습니다)." >&2
elif echo "$FILE_PATH" | grep -qE 'docs/product/reports/.*\.md$'; then
  echo "새 리포트 감지: $FILE_PATH" >&2
  echo "→ docs/product/reports/README.md 목록에 추가하세요 (make harness-check가 누락을 잡습니다)." >&2
fi

exit 0
