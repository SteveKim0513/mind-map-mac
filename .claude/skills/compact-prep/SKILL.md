---
name: compact-prep
description: "컨텍스트가 길어질 때 압축 전에 세션 상태를 저장한다. 긴 작업 세션에서 /compact 전에 실행."
---

# /compact-prep

컨텍스트가 길어졌을 때 `/compact` 전에 실행해 세션 상태를 보존한다.

## 언제 사용하는가

- 메인 컨텍스트가 길어져 응답이 느려질 때
- 복잡한 작업 중간에 세션을 쉬었다 재개할 때
- 에이전트가 이전 결정을 잊을 것 같을 때

## 실행 순서

### Step 1: 현재 상태 파악

```bash
git status --short
git log --oneline -3
```

활성 exec-plan 확인:
```bash
ls docs/exec-plans/active/ 2>/dev/null
```

### Step 2: 세션 상태 파일 작성

`.claude/session-state.md`에 다음을 기록한다:

```markdown
# 세션 상태
저장 시각: [현재 시각]

## 현재 작업
[작업 목표 1-2 문장]

## 완료된 것
- [완료 항목]

## 진행 중
- [현재 단계]

## 다음 할 일
- [구체적 다음 단계]

## 핵심 결정
- [이 세션에서 내린 중요한 결정]

## 알려진 위험
- [주의사항]

## 관련 파일
- [작업 중인 주요 파일 경로]
```

### Step 3: 검증

```bash
cat .claude/session-state.md
```

내용이 충분한지 확인. 압축 후 이 파일만으로 작업을 재개할 수 있어야 한다.

### Step 4: 컴팩션 실행

사용자에게 `/compact` 실행을 안내한다.

## 압축 후 재개 방법

압축 후 Claude에게:
> `.claude/session-state.md`를 읽고 작업을 재개해줘

## 완료 기준

- `.claude/session-state.md`가 존재하고 현재 상태를 정확히 반영한다
- 이 파일만 읽어도 작업 재개가 가능하다
