# 기술부채 추적기

> 갱신 방법: 부채 발견 시 항목 추가, 해결 시 완료 처리. 에이전트도 읽고 갱신한다.

## 진행 중

| # | 영역 | 설명 | 발견일 | 심각도 | 담당 |
|---|---|---|---|---|---|
| TD-001 | docs | `docs/product/FEATURE-INVENTORY.md` 검증 미완료 항목 (⚠️ 표시) | 2026-06-10 | Medium | - |
| TD-002 | arch | `src/store/workspaceStore.ts`가 `note/wikiLinkText` 런타임 import — store→domain 경계 위반. 해결: `src/io/`로 이동 또는 유틸 분리 | 2026-06-23 | Low | - |

## 완료

| # | 영역 | 설명 | 해결일 | PR |
|---|---|---|---|---|
| - | - | - | - | - |

## 정기 정리 항목 (주기적으로 에이전트가 스캔)

- `TODO`, `FIXME`, `HACK` 주석 누적
- `docs/decisions/` 없이 번복된 설계
- 테스트 없는 순수 함수 (`src/io/`, `src/focus/`, `src/layout/`)
- `docs/product/FEATURE-INVENTORY.md`의 ⚠️ 미검증 항목
- `package.json` 의존성 노후화 (6개월 이상)
- 사용되지 않는 `src/` 파일
