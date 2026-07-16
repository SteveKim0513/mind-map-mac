# 리포트 (지난 감사·리서치 스냅샷)

특정 시점에 실시한 감사·리뷰·리서치 결과물. **작성 시점의 스냅샷**이며 이후 코드 변경으로 내용이 낡을 수 있다.
지금 맞는 기준 문서가 필요하면 [FEATURE-INVENTORY.md](../FEATURE-INVENTORY.md), [PRODUCT-DEFINITION.md](../PRODUCT-DEFINITION.md), [decisions/](../../decisions/README.md)를 본다.

## 목록

- [RESEARCH-mindmap-competitors.md](RESEARCH-mindmap-competitors.md) — 2026-06-10 · 경쟁 마인드맵 앱 5종 + 사용자 불만 분석. [PRODUCT-DEFINITION.md](../PRODUCT-DEFINITION.md)의 근거 자료.
- [UX-AUDIT-2026-06.md](UX-AUDIT-2026-06.md) — 2026-06-11 · 빌드 앱을 Playwright로 직접 구동한 수동 UX 여정 감사(맵 작성·리마인더·노트 연결). P1 버그 다수 발견·수정.
- [AUDIT-2026-06-12-uxaudit.md](AUDIT-2026-06-12-uxaudit.md) — 2026-06-12 · `ux-audit` 스킬 기반 자동화 감사(axe-core a11y + Performance API 포함). 캔버스·집중 세션·대시보드·노트 4개 플로우.
- [REVIEW-2026-06-focus-and-dashboard.md](REVIEW-2026-06-focus-and-dashboard.md) — 2026-06-12 · 집중 세션/작업 기록 대시보드 진단 보고. [decisions/0007](../../decisions/0007-focus-positioning.md)의 근거 자료.
- [COPY-AND-FLOW-AUDIT-2026-07-15.md](COPY-AND-FLOW-AUDIT-2026-07-15.md) — 2026-07-15 · 메뉴/컨트롤 카피 + 플로우 전수 감사("정리/실행/통찰" 축 이름 라벨 노출 재검토, 무의식적으로 흐르는 접근점 조정). 초안 — 방향 합의 필요.

## 새 리포트 추가 시

1. 파일명은 `TYPE-YYYY-MM-title.md` 형식으로 이 폴더에 작성한다 (예: `AUDIT-2026-07-note-search.md`).
2. 위 목록에 한 줄(날짜 + 범위 + 후속 문서 링크)을 추가한다 — `make harness-check`가 누락을 감지해 커밋을 막는다.
