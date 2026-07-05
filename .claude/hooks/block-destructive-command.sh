#!/usr/bin/env bash
# PreToolUse hook (Bash tool) — 파괴적 명령 차단
# 입력: JSON via stdin {"tool":"Bash","input":{"command":"..."}}
# 차단 → exit 2, 경고 → exit 1, 통과 → exit 0

set -euo pipefail

# stdin에서 JSON 읽기 (타임아웃 5초)
INPUT=$(cat - 2>/dev/null || echo '{}')

# Bash 도구가 아니면 통과
TOOL=$(echo "$INPUT" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('tool',''))" 2>/dev/null || echo '')
if [ "$TOOL" != "Bash" ]; then
  exit 0
fi

# 명령 추출
CMD=$(echo "$INPUT" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('input',{}).get('command',''))" 2>/dev/null || echo '')

if [ -z "$CMD" ]; then
  exit 0
fi

block() {
  echo "BLOCKED: $1" >&2
  echo "명령: $CMD" >&2
  echo "승인이 필요합니다. 인간에게 확인을 요청하세요." >&2
  exit 2
}

# ── 파괴적 Git 명령 ──
if echo "$CMD" | grep -qE 'git\s+reset\s+--hard'; then
  block "git reset --hard는 명시적 승인 없이 실행할 수 없습니다."
fi
if echo "$CMD" | grep -qE 'git\s+push\s+.*--force|git\s+push\s+.*-f\b'; then
  block "git push --force는 명시적 승인 없이 실행할 수 없습니다."
fi
if echo "$CMD" | grep -qE 'git\s+branch\s+.*-[Dd]\b'; then
  block "git branch -d/-D는 명시적 승인 없이 실행할 수 없습니다."
fi
if echo "$CMD" | grep -qE 'git\s+tag\s+.*-d\b'; then
  block "git tag -d는 명시적 승인 없이 실행할 수 없습니다."
fi
if echo "$CMD" | grep -qE 'git\s+checkout\s+--\s+\.'; then
  block "git checkout -- .는 사용자 변경사항을 제거합니다. 명시적 승인 필요."
fi
if echo "$CMD" | grep -qE 'git\s+restore\s+--staged\s+\.'; then
  block "git restore --staged . 는 명시적 승인 없이 실행할 수 없습니다."
fi

# ── 위험한 rm ──
if echo "$CMD" | grep -qE 'rm\s+.*-[a-zA-Z]*r[a-zA-Z]*f|rm\s+.*-[a-zA-Z]*f[a-zA-Z]*r'; then
  # rm -rf 패턴 — 특정 안전한 경로만 허용
  # dist/, dist-electron/, node_modules/, release/, test-results/ 등은 허용
  if echo "$CMD" | grep -qE 'rm\s+.*-rf\s+/(Users|home|root|etc|var|tmp|System)'; then
    block "시스템·홈 디렉터리에 대한 rm -rf는 실행할 수 없습니다."
  fi
  if echo "$CMD" | grep -qE 'rm\s+.*-rf\s+\.\s*$|rm\s+.*-rf\s+\.\/$'; then
    block "현재 디렉터리 전체 rm -rf는 실행할 수 없습니다."
  fi
  if echo "$CMD" | grep -qE 'rm\s+.*-rf\s+~'; then
    block "홈 디렉터리에 대한 rm -rf는 실행할 수 없습니다."
  fi
fi

# ── 운영 배포 ──
if echo "$CMD" | grep -qE 'npm\s+run\s+dist\b'; then
  block "npm run dist (운영 배포)는 명시적 승인 없이 실행할 수 없습니다."
fi

# ── 비밀정보 출력 ──
if echo "$CMD" | grep -qE 'cat\s+.*\.env|echo\s+.*PASSWORD|echo\s+.*SECRET|echo\s+.*API_KEY'; then
  block "비밀정보를 출력하는 명령은 차단됩니다."
fi

# 통과
exit 0
