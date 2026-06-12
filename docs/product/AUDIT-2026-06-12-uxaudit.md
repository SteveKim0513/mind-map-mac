# 자동화 UX 감사 — 2026-06-12 (ux-audit 스킬)

> 방법: `ux-audit` 스킬(jezweb) + Playwright `_electron`로 격리 빌드를 **사용자처럼 구동**(실 타이핑·클릭·스샷) + axe-core a11y + Performance API. 격리 userData(`/tmp/mindmap-audit/udata`), 실데이터 미접촉.
> 범위: 4개 핵심 플로우 — 캔버스(키보드 노드 편집) · 집중 세션(시작 팝업→목표→로그→종료→완료 카드→결과) · 작업 기록 대시보드 · 노트 편집. + 사이드바 · 760px 반응형 · 최초 사용자 렌즈.
> 산출물(JSON·스샷): `/tmp/mindmap-audit/audit-report.json`, `audit-shots/`.

## 판정: FAIL → **Pass** (수정 후 재검증 완료)

| 하드 게이트 | 감사 시 | 수정 후 |
|---|---|---|
| console errors | 0 | 0 |
| console warnings | 1 (Electron CSP — **dev 전용**, 패키지 빌드엔 없음 → allowlist) | 동일 |
| axe **critical** | 0 | 0 |
| axe **serious** | **2** (양 화면) | **0** |
| color-contrast 위반 | 다수(2 색쌍) | **0** |
| layout collapse (760px) | 0 (2열→1열, 오버플로 없음) | 0 |

**성능(기준선, 캔버스):** FCP **0.27s** · INP proxy **~15ms** · CLS 무관찰 — 예산(4.0s/500ms/0.25) 대비 큰 여유. *다음 감사 비교 기준으로 사용.*

자기비판 패스(서브에이전트): Drafted 5 · **Kept 2** · Generic 3 · Duplicate 0.

## 수정한 결함 (커밋 `b95e946`)

- **[High] aria-input-field-name** — tiptap contenteditable에 접근성 이름 없음 → `role=textbox`+`aria-label`(세션=작업 기록/일반=노트 본문). `src/note/NoteEditor.tsx`.
- **[High] color-contrast** —
  - 선택 사이드바 라벨 `#0075de`→`#0064c4`(라이트만). `.row.open` (styles.css).
  - `--ink-faint` `#a39e98`(2.65)→`#767069`(~4.7), 다크 `#6f6c67`→`#9a9792`(~4.9). **유지 확정**(2026-06-12) — 위계 보존, 가독성 개선.

## 보류(서브에이전트 GENERIC 판정 — 하드게이트 아님)

- `<main>`/`<h1>`/region landmark 부재 — 단일 창 데스크탑 앱엔 영향 작음.
- Electron CSP 경고 — 패키지 빌드에서 사라짐. 보안 위생상 CSP 추가는 백로그.

## 메모

- 감사 실행 시 진입점은 **선택 툴바의 집중 버튼**(`title="집중 세션 시작"`)이 우클릭 메뉴보다 자동화·발견성 모두 안정적이었음.
- 전 플로우 콘솔 0 에러, 흐름 막힘 없음 — 최초 사용자 렌즈로도 문구 자명(결함 없음).
