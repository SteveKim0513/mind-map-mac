# 노트 드래그 핸들 (Notion 스타일 행 재정렬)
날짜: 2026-07-02
상태: completed

## 목표

노트 에디터에서 마우스로 블록(단락·헤더·목록·인용 등)을 드래그해 위아래로 순서를 바꾼다.  
Notion처럼 각 블록 왼쪽에 ⠿ 핸들이 hover 시 나타나고, 드래그하면 위치 인디케이터가 보인다.

## 범위

**포함:**
- 최상위 블록 단위 재정렬 (paragraph, heading, blockquote, bullet/ordered list, task list, code block)
- hover 시 ⠿ 핸들 표시
- 드래그 중 드롭 위치 인디케이터 (horizontal line)
- ProseMirror 트랜잭션으로 블록 이동 (undo 가능)

**제외:**
- 목록 아이템 개별 재정렬 (블록 단위만)
- 헤더와 그 하위 내용 묶어서 이동
- 테이블 행 재정렬
- 모바일/터치 지원

## 구현 방식

**Custom ProseMirror Plugin** (`src/note/DragHandle.ts`)
- `@tiptap/extension-drag-handle` (v3.27.1)은 collaboration 패키지 의존성 → 사용 안 함
- ProseMirror decoration widget으로 각 최상위 노드 위에 ⠿ 버튼 삽입
- mousedown 시 HTML5 drag API 초기화 (draggable div + ghost image)
- dragover 시 `posAtCoords`로 드롭 위치 계산 → decoration으로 인디케이터 표시
- drop 시 ProseMirror transaction으로 노드 이동

**파일 구성:**
- `src/note/DragHandle.ts` — Tiptap Extension (ProseMirror plugin 래핑)
- `src/note/NoteEditor.tsx` — extensions 배열에 추가
- `src/styles.css` — 핸들 · 인디케이터 스타일

## 구현 단계

- [x] `src/note/DragHandle.ts` — Tiptap Extension 골격 + ProseMirror plugin
  - hover decoration (⠿ widget) 
  - mousedown → drag state 시작
  - dragover → drop indicator decoration
  - drop → transaction (delete source, insert at target)
- [x] `src/styles.css` — `.drag-handle` / `.drop-indicator` 스타일
- [x] `src/note/NoteEditor.tsx` — `DragHandle` import 및 extensions 추가
- [x] `make verify` 통과 확인
- [x] `make dev`로 실제 동작 확인 (커밋 7acd9f2로 v0.7.21 배포, e401888에서 Tab indent 안정화 후속 수정)

## 위험

- 목록 전체(ul/ol)가 하나의 최상위 블록 → 목록 안 아이템 개별 이동 불가 (범위 제외로 합의)
- `posAtCoords`는 에디터 경계 좌표가 필요 — view.dom.getBoundingClientRect() 기준 계산
- 드래그 ghost image: 기본 ghost 대신 커스텀 ghost element 생성 필요 (setDragImage)
- Undo: ProseMirror의 history 플러그인이 트랜잭션을 기록하므로 Ctrl+Z로 복구 가능

## 검증 방법

1. 단락 두 개를 드래그로 순서 바꾸기
2. 불릿 목록(전체)를 헤더 위로 이동
3. Ctrl+Z로 복구 확인
4. 코드블록 이동 확인
