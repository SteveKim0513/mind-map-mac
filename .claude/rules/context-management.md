---
description: "메인 컨텍스트 최적화 규칙 — 무거운 작업은 sub-agent에 위임, 결과만 수신한다"
---

# Context Management Rules

## 핵심 원칙

**메인 컨텍스트는 계획·결정·현재 상태만 보유한다.**
파일 내용·검색 결과·구현 세부사항은 sub-agent가 처리하고 요약만 반환한다.

```
메인 컨텍스트 (항상 보유)     sub-agent (격리 실행)
─────────────────────        ──────────────────────────
현재 작업 목표               파일 읽기 (5개 이상)
활성 exec-plan 경로          코드베이스 탐색·검색
핵심 결정 (3개 이하)         구현 작업
남은 위험                    코드 리뷰
                             문서 생성
```

## Sub-agent 위임 기준

다음 중 하나라도 해당하면 sub-agent를 사용한다:

- 읽어야 할 파일이 5개 이상
- `grep`, `find`로 전체 코드베이스를 탐색
- 독립적으로 완결 가능한 구현 작업
- 리뷰·감사·검사 (결과만 필요하고 과정은 불필요)
- 문서 생성 (내용은 파일에, 경로만 반환)

## 메인 컨텍스트에 넣지 않는 것

- 파일 전체 내용 (경로·핵심 사항만)
- 검색 결과 원본 (요약만)
- 구현 중 발생한 중간 오류 로그 (해결책만)
- 이미 완료된 단계의 상세 내용
- `git diff` 전체 (변경 파일 목록 + 핵심 변경만)

## Sub-agent 결과 수신 형식

sub-agent는 다음 형식으로만 반환한다:

```
작업: [한 줄]
결과: [성공/실패 + 핵심 수치]
변경 파일: [목록]
핵심 발견: [3개 이하 bullet]
남은 위험: [있다면]
참조 파일: [더 읽어야 할 경우만]
```

## 컴팩션 전 준비 (컨텍스트가 길어질 때)

1. `/compact-prep` Skill 실행 → `.claude/session-state.md` 생성
2. Claude가 `/compact` 실행
3. 압축 후 Claude가 `.claude/session-state.md`를 읽어 상태 복원

## 세션 시작 시

새 세션 또는 컴팩션 후:
1. `.claude/session-state.md` 존재 여부 확인
2. 있으면 읽어 이전 세션 컨텍스트 복원
3. `git status --short`로 현재 상태 확인
4. 활성 exec-plan 파일 확인 (`docs/exec-plans/active/`)

## Sub-agent 선택 가이드

| 필요한 것 | 사용할 Sub-agent |
|---|---|
| 코드베이스 조사·탐색 | `codebase-explorer` |
| 기능 구현 | `implementation-worker` |
| 아키텍처 검토 | `architecture-reviewer` |
| 보안 검토 | `security-reviewer` |
| 테스트 검토 | `test-reviewer` |
| UX/UI 감사 | `ux-audit` |
