#!/usr/bin/env bash
# PreToolUse hook (Edit/Write/Read) — 민감 파일 보호
# 입력: JSON via stdin
# 차단 → exit 2, 통과 → exit 0

set -euo pipefail

INPUT=$(cat - 2>/dev/null || echo '{}')

TOOL=$(echo "$INPUT" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('tool',''))" 2>/dev/null || echo '')

# Edit, Write 도구만 검사
if [[ "$TOOL" != "Edit" && "$TOOL" != "Write" ]]; then
  exit 0
fi

FILE_PATH=$(echo "$INPUT" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('input',{}).get('file_path',''))" 2>/dev/null || echo '')

if [ -z "$FILE_PATH" ]; then
  exit 0
fi

block() {
  echo "BLOCKED: 민감 파일 보호" >&2
  echo "파일: $FILE_PATH" >&2
  echo "이유: $1" >&2
  exit 2
}

# ── 비밀정보 파일 ──
if echo "$FILE_PATH" | grep -qE '\.env$|\.env\.(local|production|staging)$'; then
  # .env.example은 허용
  if ! echo "$FILE_PATH" | grep -q '\.example'; then
    block ".env 파일은 저장소에 기록하지 않습니다. .env.example만 허용됩니다."
  fi
fi

# 개인 키
if echo "$FILE_PATH" | grep -qE '\.pem$|\.p12$|\.pfx$|\.key$|id_rsa|id_ecdsa|id_ed25519'; then
  block "개인 키 파일은 저장소에 포함할 수 없습니다."
fi

# AWS/GCP/Azure 자격증명
if echo "$FILE_PATH" | grep -qE '\.aws/credentials|\.config/gcloud|azure/credentials'; then
  block "클라우드 자격증명 파일은 수정할 수 없습니다."
fi

# SSH
if echo "$FILE_PATH" | grep -qE '^/Users/.+/\.ssh/|^/home/.+/\.ssh/'; then
  block "SSH 디렉터리 파일은 수정할 수 없습니다."
fi

# GitHub Actions secrets (실제 값 — settings.json 제외)
if echo "$FILE_PATH" | grep -qE '\.github/secrets'; then
  block "GitHub Secrets 파일은 수정할 수 없습니다."
fi

# .claude/settings.local.json
if echo "$FILE_PATH" | grep -qE '\.claude/settings\.local\.json$'; then
  block ".claude/settings.local.json은 개인 설정 파일입니다. 직접 수정보다 사용자에게 안내하세요."
fi

# 통과
exit 0
