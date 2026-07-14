# 기능 명세 (Specs)

새 기능은 `TEMPLATE-feature-spec.md`의 4개 항목(문제 / 해결 / 범위에서 뺀 것 / 완료 기준)으로 여기에 먼저 쓴다.
파일명: `YYYY-MM-DD-title.md`. 구현 후에도 지우지 않고 상태만 갱신한다 — "왜 이렇게 만들었나"의 기록이다.

## 구현 완료

- [2026-06-11-auto-update.md](2026-06-11-auto-update.md) — 자동 업데이트 (Squirrel.Mac, 로컬 피드)
- [2026-06-11-entrypoint-matrix.md](2026-06-11-entrypoint-matrix.md) — 동작별 표준 진입점 매트릭스 ([decisions/0004](../../decisions/0004-entrypoint-matrix.md))
- [2026-06-11-untitled-autoname.md](2026-06-11-untitled-autoname.md) — "제목 없음" 자동 이름
- [2026-06-12-focus-session.md](2026-06-12-focus-session.md) — 집중 세션 v1 (타이머·로그·완료 카드)
- [2026-06-12-note-images.md](2026-06-12-note-images.md) — 노트 이미지 삽입
- [2026-06-12-note-tables.md](2026-06-12-note-tables.md) — 노트 표 (GFM)
- [2026-06-12-note-title-filename-sync.md](2026-06-12-note-title-filename-sync.md) — 노트 제목 ↔ 파일명 동기화
- [2026-06-12-reminder-field-level-sync.md](2026-06-12-reminder-field-level-sync.md) — 리마인더 필드 단위 충돌 해소
- [2026-06-15-note-meta-header.md](2026-06-15-note-meta-header.md) — 노트 상단 메타 영역 (목차·연결·백링크)
- [2026-06-15-note-to-note-links.md](2026-06-15-note-to-note-links.md) — 노트 ↔ 노트 연결 (`[[제목]]`, 백링크)
- [2026-07-09-note-templates.md](2026-07-09-note-templates.md) — 노트 템플릿 v1

## 명세만 완료 · 구현 예정 / 아이디어 단계

- [2026-06-12-dashboard-v2-day-week.md](2026-06-12-dashboard-v2-day-week.md) — 돌아보기 v2 (오늘 ↔ 이번 주 단일 스코프)
- [2026-06-12-work-dashboard-redesign.md](2026-06-12-work-dashboard-redesign.md) — 작업 기록 대시보드 재기획 (아이디어 단계)
- [2026-06-12-today-view.md](2026-06-12-today-view.md) — "오늘" 뷰
- [2026-06-15-release-history.md](2026-06-15-release-history.md) — 배포 내역 기록 + 사용자 가시성

## 폐기 (기록용, 대체 문서 참고)

- [2026-06-12-session-note-placeholders.md](2026-06-12-session-note-placeholders.md) — 세션 노트 자리표시자 → [decisions/0008](../../decisions/0008-focus-goal-process-result.md)로 대체

## 새 스펙 추가 시

파일 작성 후 위 목록(구현 완료 / 예정·아이디어 / 폐기 중 해당 절)에 한 줄을 추가한다 — `make harness-check`가 누락을 감지해 커밋을 막는다.
