# 0019. exec-plan step 상태 머신 + 위임 명세 표준

날짜: 2026-08-26 · 상태: 채택

## 맥락 — 어떤 문제/선택지가 있었나

exec-plan의 구현 단계는 순수 체크박스라 "어디까지 됐고 왜 멈췄는지"를 기계가 판독할 수
없었고, 사람 개입이 필요해 멈춘 상태(blocked)를 표현할 방법이 없었다. 외부 하네스
프레임워크(harness_framework repo — step별 status/summary를 JSON 상태 머신으로 추적,
blocked 시 즉시 중단, step 파일은 자기완결적 지시서)를 벤치마크했다. 별도 JSON 파일
(`steps.json`) 방식과 마크다운 내 마커 방식 중 선택지가 있었다.

## 결정 — 무엇을 택했나

1. **마크다운 내 상태 마커** (단일 소스 유지, 사람·기계 겸용):
   `[ ]` pending · `[>]` in-progress · `[x]` completed(+`→ 산출물 요약`) ·
   `[!]` blocked(+`→ blocked: 사유`, 즉시 중단) · `[e]` error(+`→ error: 요약`).
   계획 상태 어휘에 `blocked` 추가. check-docs.mjs가 active/ 계획의 마커 어휘·사유·정합성을
   검증(경고 수준 — 기존 completed/ 계획 21개 소급 실패 방지).
2. **implementation-worker 위임 명세 표준 5요소**: 작업 목표 / 자기완결적 컨텍스트(외부 대화
   참조 금지) / 파일 범위+시그니처 수준 지시 / AC는 실행 가능한 커맨드 / 금지는
   "X를 하지 마라. 이유: Y" 형식.

## 결과 — 감수한 트레이드오프, 다시 볼 조건

- 마커는 JSON보다 파싱이 느슨하다(정규식 의존). 무인 실행기(execute.py 상당)를 도입하게 되면
  그 시점에 JSON 사이드카 병행을 재검토한다.
- 완료 요약(`→ ...`) 작성이 단계마다 한 줄씩 추가 비용 — 세션 단절 시 이어받기 컨텍스트로
  회수된다.
- 첫 적용 사례: `docs/exec-plans/completed/2026-08-26-harness-hook-schema-and-step-state.md`.
