---
name: update-docs
description: "코드 변경에 맞게 관련 문서를 갱신한다. 기능 변경 후 또는 문서-구현 불일치 발견 시 사용."
---

# /update-docs

## 목적

코드와 문서의 불일치를 탐지하고 수정한다.
문서를 먼저 읽고 실제 코드 상태와 비교해 갱신한다.

## 실행 순서

### Step 1: 갱신 대상 파악

변경된 코드 기준으로 필요한 문서를 식별한다 (`.claude/rules/documentation.md` 갱신 트리거 참조):

```bash
git diff --name-only  # 어떤 파일이 바뀌었나
```

### Step 2: 현재 문서 읽기

- `docs/product/FEATURE-INVENTORY.md` — 기능 목록
- 관련 `docs/decisions/` — 설계 결정
- `ARCHITECTURE.md` — 모듈 책임, 의존성
- `docs/operations/` — 개발·배포 절차

### Step 3: 실제 코드와 비교

각 문서 항목이 현재 코드를 정확히 설명하는지 확인한다.

### Step 4: 갱신

불일치 항목을 수정한다:
- 없어진 기능 → 문서에서 제거 또는 `deprecated` 표시
- 새 기능 → 문서에 추가
- 명령어 변경 → 새 명령으로 교체
- 경로 변경 → 새 경로로 업데이트

### Step 5: 새 결정 기록 (해당 시)

번복 가능한 설계 결정이 있으면 `docs/decisions/NNNN-title.md`를 추가한다.

다음 번호 확인:
```bash
ls docs/decisions/ | grep -E '^[0-9]+' | sort -n | tail -1
```

## 완료 기준

- 갱신된 문서가 현재 코드를 정확히 설명한다.
- `make harness-check`가 통과한다.

## 완료 보고 형식

```
갱신한 문서: [목록]
추가한 내용: [요약]
제거한 내용: [요약]
새 결정 기록: [있다면 파일명]
make harness-check: 통과 / 실패 ([실패 시 이유])
```
