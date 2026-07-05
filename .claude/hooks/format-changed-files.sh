#!/usr/bin/env bash
# PostToolUse hook (Edit/Write) — TypeScript 파일 변경 후 빠른 타입 검사 안내
# 무거운 전체 typecheck 대신 가벼운 안내만 제공 (루프 방지)
# 통과 → exit 0 (항상)

set -euo pipefail

INPUT=$(cat - 2>/dev/null || echo '{}')

TOOL=$(echo "$INPUT" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('tool',''))" 2>/dev/null || echo '')

if [[ "$TOOL" != "Edit" && "$TOOL" != "Write" ]]; then
  exit 0
fi

FILE_PATH=$(echo "$INPUT" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('input',{}).get('file_path',''))" 2>/dev/null || echo '')

# TypeScript 파일만
if ! echo "$FILE_PATH" | grep -qE '\.(ts|tsx)$'; then
  exit 0
fi

# node_modules 내부는 무시
if echo "$FILE_PATH" | grep -q 'node_modules'; then
  exit 0
fi

# 안내 출력 (차단하지 않음 — 정보 제공만)
echo "TypeScript 파일 변경됨: $FILE_PATH" >&2
echo "작업 완료 후 make verify 실행을 잊지 마세요." >&2

exit 0
