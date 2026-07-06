---
name: design-ui
description: UI 컴포넌트 디자인 작업 시작 전 설계 원칙을 로드하고 검토 기준을 제시한다.
---

# /design-ui 스킬

UI·CSS·컴포넌트 변경 작업을 시작할 때 실행한다.

## 실행 순서

1. `docs/design/UI-DESIGN-PRINCIPLES.md` 읽기 — 디자인 원칙 로드
2. `docs/design/COLOR-SYSTEM.md` 읽기 — 색상 시스템 확인
3. 변경 대상 컴포넌트의 현재 CSS 클래스 파악 (`src/styles.css`)
4. 작업 전 설계 의도 요약 출력 (무엇을, 왜, 어떻게)

## 작업 중 규칙

- 모든 색상 값은 CSS 변수 (`var(--primary)` 등) 사용. raw hex는 허용 목록에 있는 것만.
- 폰트 사이즈 11px 미만 금지.
- 새 컴포넌트는 UI-DESIGN-PRINCIPLES.md의 체크리스트를 완료 전 확인.
- `make dev`로 다크/라이트 모드 양쪽 시각 확인 후 완료 선언.

## 완료 후 검증

아래 항목을 확인하고 결과를 보고한다:

```
[ ] 색상: CSS 변수 사용, raw hex 없음 (허용 목록 제외)
[ ] 폰트: 최소 11px 이상
[ ] 상태 표시: 활성/비활성이 색+텍스트/아이콘으로 구분됨
[ ] 키보드: Tab으로 모든 인터랙티브 요소 접근 가능
[ ] 다크 모드: CSS 변수 덕분에 자동 대응 확인
[ ] 빌드: make verify 통과
```

## 디자인 하네스

`make harness-check`에 디자인 검사가 포함되어 있다:
- `scripts/harness/check-design.mjs` — raw hex 색상, 폰트 크기, 원칙 파일 존재 확인

디자인 하네스 경고가 있으면 수정 후 완료 보고한다.
