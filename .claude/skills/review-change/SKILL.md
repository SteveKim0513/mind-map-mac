---
name: review-change
description: "변경된 코드를 정확성·아키텍처·보안·테스트 충분성 관점으로 독립 검토한다. 구현 후, PR 전에 사용."
---

# /review-change

## 목적

구현 에이전트와 독립적인 관점으로 변경을 검토한다.
스타일 취향보다 정확성·보안·아키텍처 경계를 우선한다.

## 입력

- 검토할 파일 목록 (없으면 `git diff --name-only` 기준)

## 실행 순서

### Step 1: 변경 범위 파악

```bash
git diff --stat
git diff --name-only
```

### Step 2: 각 파일 검토

다음 기준으로 검토한다:

**정확성**
- 요구사항을 실제로 충족하는가?
- 엣지 케이스(빈 배열, null, 대용량 데이터)를 처리하는가?
- 비동기 오류를 적절히 처리하는가?

**아키텍처** (`.claude/rules/architecture.md` 기준)
- 의존성 방향이 올바른가? (types → io → store → domain → ui)
- 도메인 경계를 우회하지 않는가?
- `window.api`를 통해서만 IPC를 사용하는가?
- reminder 불변 조건을 지키는가?

**보안** (`.claude/rules/security.md` 기준)
- 외부 입력(파일, IPC)을 경계에서 검증하는가?
- 비밀정보가 코드에 포함되지 않았는가?
- Path traversal 가능성이 없는가?

**테스트 충분성** (`.claude/rules/testing.md` 기준)
- 핵심 로직 변경에 테스트가 있는가?
- 버그 수정에 재현 테스트가 있는가?

**문서** (`.claude/rules/documentation.md` 기준)
- 관련 문서가 함께 갱신되었는가?

### Step 3: 검토 결과 작성

각 발견사항에 다음을 포함한다:
- 심각도: Critical / High / Medium / Low
- 파일 위치 (파일명:줄번호)
- 문제 설명
- 수정 방법

Critical/High가 있으면 수정 전 완료 처리하지 않는다.

## 완료 기준

- Critical, High 발견사항 없음
- Medium 이하는 기록하고 판단 위임 가능

## 완료 보고 형식

```
검토 파일: [목록]
Critical: 0
High: 0
Medium: [수] — [목록]
Low: [수] — [목록]
권고 사항: [있다면 설명]
```
