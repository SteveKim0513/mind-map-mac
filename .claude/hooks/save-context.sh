#!/usr/bin/env bash
# PreCompact hook — 컨텍스트 압축 전 세션 상태를 파일에 저장
# 압축 후 Claude가 이 파일을 읽어 상태를 복원한다
# 항상 exit 0 (압축을 막지 않음)

set -euo pipefail

INPUT=$(cat - 2>/dev/null || echo '{}')

# PreCompact 이벤트인지 확인
HOOK_EVENT=$(echo "$INPUT" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('hook_event_name',''))" 2>/dev/null || echo '')
if [ "$HOOK_EVENT" != "PreCompact" ]; then
  exit 0
fi

SESSION_FILE=".claude/session-state.md"
TIMESTAMP=$(date '+%Y-%m-%d %H:%M:%S')

# Git 상태 수집
GIT_STATUS=$(git status --short 2>/dev/null || echo '(git 상태 확인 불가)')
GIT_BRANCH=$(git branch --show-current 2>/dev/null || echo 'unknown')
LAST_COMMIT=$(git log --oneline -1 2>/dev/null || echo '(없음)')

# 활성 exec-plan 확인
ACTIVE_PLANS=$(find docs/exec-plans/active -name "*.md" ! -name ".gitkeep" 2>/dev/null | sort || echo '')

# 세션 상태 파일 작성
cat > "$SESSION_FILE" << STATEFILE
# 세션 상태 (컴팩션 전 자동 저장)
> 저장 시각: $TIMESTAMP
> 이 파일은 컨텍스트 압축 전 자동 생성됩니다. 압축 후 이 파일을 읽어 작업을 재개하세요.

## Git 상태
브랜치: $GIT_BRANCH
마지막 커밋: $LAST_COMMIT

### 변경된 파일
\`\`\`
$GIT_STATUS
\`\`\`

## 활성 실행 계획
STATEFILE

if [ -n "$ACTIVE_PLANS" ]; then
  echo "$ACTIVE_PLANS" >> "$SESSION_FILE"
else
  echo "(활성 계획 없음)" >> "$SESSION_FILE"
fi

cat >> "$SESSION_FILE" << STATEFILE

## 재개 체크리스트
압축 후 다음 순서로 상태를 복원한다:
- [ ] 이 파일 확인
- [ ] \`git status --short\` 실행
- [ ] 활성 exec-plan 파일 읽기 (위 경로)
- [ ] \`ARCHITECTURE.md\` 의존성 방향 재확인
- [ ] 중단된 작업 재개

## 메모 (작업 중 에이전트가 추가 가능)
<!-- 에이전트가 중요한 컨텍스트를 여기에 추가 -->
STATEFILE

echo "세션 상태 저장됨: $SESSION_FILE" >&2

# PreCompact hook의 stdout은 compact summary에 포함됨
# 상태 파일 경로를 알려줘 압축 후 재로드할 수 있게 함
cat << 'SUMMARY'
[컨텍스트 압축] .claude/session-state.md에 세션 상태가 저장되었습니다.
압축 후 반드시 이 파일을 읽어 작업 상태를 복원하세요.
SUMMARY

exit 0
