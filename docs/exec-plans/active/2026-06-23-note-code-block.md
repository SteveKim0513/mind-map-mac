# 노트 코드블록 + 문법 강조 (v0.7.12)

> TipTap 확장 추가 기록 (frontend 규칙: 새 확장은 exec-plan에 기록).

## 결정
- StarterKit 기본 `codeBlock`(단색)을 `@tiptap/extension-code-block-lowlight`로 교체. lowlight v3 + highlight.js.
- 흔한 언어 18종만 등록(번들 절감, +~37KB gzip). 별칭(js/ts/html/sh/yml…)은 grammar에서 자동.
- React NodeView(`src/note/CodeBlock.tsx`): 언어 드롭다운 + 자동 감지(`highlightAuto`) + 코드 복사.
- 진입점: `/` 슬래시 메뉴 '코드블록', 툴바 `{ }` 버튼, 백틱3 입력룰.
- 토큰 색은 `--code-*` CSS 변수(다크/라이트) — 3계층 UI 시스템과 분리된 코드 전용 팔레트.
- 직렬화: tiptap-markdown이 ```lang 펜스로 라운드트립(StarterKit codeBlock 비활성 → 노드명 충돌 방지).

## 검증
- e2e(file-management.spec.ts): 슬래시→코드블록→언어선택→입력 시 `.hljs-keyword` 렌더 + 저장 .md에 ```javascript 보존.
- typecheck/unit/e2e/release-gate 통과 후 배포.

## 후속(선택)
- 언어 더 추가, 줄번호, 코드블록 접기.
