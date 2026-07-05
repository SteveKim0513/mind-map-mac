---
description: "문서 갱신 규칙 — 어떤 변경이 어떤 문서를 요구하는가"
---

# Documentation Rules

## 갱신 트리거

| 변경 | 갱신 필요한 문서 |
|---|---|
| 기능 추가·변경·삭제 | `docs/product/FEATURE-INVENTORY.md` (같은 PR) |
| 번복 가능한 설계 결정 | `docs/decisions/NNNN-title.md` 추가 |
| 새 기능 구현 시작 | `docs/product/specs/` 명세 먼저 작성 |
| 빌드·실행·테스트 명령 변경 | `AGENTS.md`, `CLAUDE.md`, `Makefile`, `docs/operations/` |
| 아키텍처 경계 변경 | `ARCHITECTURE.md` |
| IPC 채널 추가·삭제 | `ARCHITECTURE.md`, `electron/preload.ts` JSDoc |
| 릴리즈 파이프라인 변경 | `docs/release/DEPLOY-UPDATE-SPEC.md` |
| Claude 규칙·Skills·Hooks 변경 | 해당 `.claude/` 파일 |

## docs/ 구조 규칙

- `docs/product/specs/` — 기능 명세 (템플릿: `TEMPLATE-feature-spec.md`)
- `docs/decisions/` — 경량 ADR (`NNNN-title.md` 형식, 번호 순서)
- `docs/design/` — 디자인 시스템, 색상 체계
- `docs/release/` — 릴리즈 프로세스, QA 체크리스트, 배포 명세
- `docs/exec-plans/active/` — 진행 중인 복잡한 작업 계획
- `docs/exec-plans/completed/` — 완료된 계획 (이력 보존)
- `docs/operations/` — 로컬 개발, 테스트, 배포, 문제 해결
- `docs/exec-plans/tech-debt-tracker.md` — 기술부채 추적

## 실행 계획 형식

`docs/exec-plans/active/YYYY-MM-DD-title.md`에 다음을 포함한다.

```markdown
# [작업명]
날짜: YYYY-MM-DD
상태: active | completed | abandoned

## 목표
## 범위 (포함 / 제외)
## 현재 상태
## 가정
## 위험
## 구현 단계
- [ ] 단계 1
## 검증 방법
## 발견한 사실 (작업 중 갱신)
## 결정 변경 이력
```

완료 후 `docs/exec-plans/completed/`로 이동.

## 결정 기록 형식

`docs/decisions/NNNN-title.md`:

```markdown
# NNNN. 결정 제목
날짜: YYYY-MM-DD
상태: proposed | accepted | deprecated | superseded

## 컨텍스트
## 결정
## 결과 (장단점)
## 대안
```

## 깨진 링크 방지

- 문서에서 `src/` 파일을 경로로 참조할 때 파일이 실제로 존재하는지 확인한다.
- 파일을 이동하거나 이름을 바꾸면 해당 파일을 참조하는 문서도 갱신한다.
- `make harness-check`가 `docs/` 링크 무결성을 검사한다.
