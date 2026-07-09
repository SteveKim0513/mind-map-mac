# 노트 메타 블록 기능
날짜: 2026-07-08
상태: completed

## 목표

노트 상단에 구조화된 속성(메타) 블록을 추가하는 기능.
사용자가 전역 템플릿을 만들고, 노트에서 선택해 최상단에 자동 삽입한다.
템플릿이 바뀌면 그 템플릿을 사용 중인 모든 노트에 자동 반영된다.

---

## 핵심 아키텍처 결정

### 스키마-값 분리 원칙

> 노트 파일에는 "어떤 템플릿인지(ID) + 현재 값"만 저장한다.
> 필드 이름, 타입, 옵션 등 스키마는 항상 현재 `meta-templates.json`에서 읽는다.

```
meta-templates.json (전역)      note.md frontmatter (노트별)
───────────────────────────     ───────────────────────────
templateId: "proj-info"         templateId: "proj-info"
fields:                         values:
  - name: "담당자"                 담당자: "김지호"
    type: text                   시작일: "2026-07-08"
  - name: "시작일"                 상태: "진행 중"
    type: date
  - name: "상태"
    type: select
    options: [진행 중, 완료, 보류]
```

**자동 반영 원리**: 템플릿에 필드 추가 → 해당 templateId 사용 중인 모든 노트가 다음 로드 시 새 필드 표시 (값 없음). 별도 마이그레이션 없이 스키마를 참조하기만 하면 된다.

### 서식(타입)은 노트에서 변경 불가

- 필드 타입은 설정의 템플릿 편집에서만 변경 가능
- 노트 내 메타 블록에서는 **값만 편집** — 타입 변경 UI 없음
- 타입이 date이면 항상 날짜 피커, select이면 항상 드롭다운, text이면 항상 텍스트 입력

---

## 사용자 여정

### A. 템플릿 만들기 (설정)
```
설정(⌘,) → "메타 템플릿" 탭
→ "+ 새 템플릿" → 이름 입력 (예: "프로젝트 정보")
→ 필드 추가: 라벨 + 타입 선택 (타입은 저장 후 고정)
→ 저장
```

**필드 타입 5종**
| 타입 | 입력 UI | 예시 |
|---|---|---|
| text | 한 줄 텍스트 입력 | 담당자, 브랜드명 |
| date | 날짜 피커 (네이티브 `<input type="date">`) | 시작일, 마감일 |
| select | 드롭다운 `<select>` (옵션 목록 설정에서 정의) | 상태: 진행 중/완료/보류 |
| url | URL 입력 + 클릭 시 외부 열기 | 참고 링크 |
| number | 숫자 입력 | 우선순위, 예산 |

**select 타입 설정 UI**:
```
필드 타입: [select ▾]
옵션 목록:  진행 중  ×
            완료    ×
            보류    ×
            + 옵션 추가
```

### B. 노트에 삽입
```
노트 편집 중 → 툴바 "메타 +" 버튼 클릭
→ 등록된 템플릿 목록 드롭다운 표시
→ 클릭 → 노트 최상단에 메타 블록 삽입
   (커서 위치 무관, 기존 내용 아래로 밀림)
```

### C. 메타 값 편집 (노트 내)
```
필드 값 클릭 → 타입에 맞는 입력 UI 활성화
  text   → 텍스트 입력란
  date   → 날짜 피커 팝업
  select → 드롭다운 메뉴
  url    → 텍스트 입력란 (저장 후 링크로 렌더)
  number → 숫자 입력란

Tab: 다음 필드, Shift-Tab: 이전 필드
Enter / 포커스 아웃: 저장
Esc: 취소
```

### D. 템플릿 변경 시 자동 반영
```
설정 → 메타 템플릿 → "프로젝트 정보"에 "담당팀" 필드 추가
→ 저장
→ 이 템플릿을 쓰는 모든 노트: 다음 열 때 "담당팀" 행 자동 추가 (값 없음)
```
- 필드 제거: 화면에서 숨겨지나, frontmatter의 값은 보존 (복구 가능)
- 템플릿 삭제: 메타 블록이 "(삭제된 템플릿)" 경고로 표시, 값 유지

### E. 메타 블록 삭제
```
메타 블록 우측 상단 "×" 버튼 → 블록 삭제
(노트 본문은 유지, frontmatter에서 해당 _meta 항목 제거)
```

---

## UI 설계

```
┌─────────────────────────────────────────┐
│ ▪ 프로젝트 정보                   [×]  │  ← 템플릿명 + 닫기
├──────────────┬──────────────────────────┤
│ 담당자       │ 김지호                   │  ← text: 클릭 시 입력
│ 시작일       │ 2026-07-08          📅  │  ← date: 클릭 시 날짜 피커
│ 상태         │ 진행 중               ▾ │  ← select: 클릭 시 드롭다운
│ 참고 링크    │ notion.so/...       ↗  │  ← url: 클릭 시 열기
│ 담당팀       │ 입력하세요…              │  ← 빈 값: 흐릿한 placeholder
└──────────────┴──────────────────────────┘
```

**디자인 원칙**
1. **최상단 고정** — 메타 블록은 항상 노트 제일 위. 이동 불가.
2. **타입별 시각 단서** — date에 📅 아이콘, select에 ▾, url에 ↗ 외부 링크 아이콘
3. **빈 값** — `var(--ink-faint)` 색의 placeholder ("입력하세요…")
4. **편집 중** — 해당 행에만 테두리 포커스 표시
5. **본문과 구분** — `var(--canvas-soft)` 배경 + 하단 `var(--hairline)` 구분선
6. **여러 블록** — 템플릿이 다르면 여러 개 추가 가능. 중복 시 확인 토스트.

---

## 저장 구조

### meta-templates.json (userData/)
```json
[
  {
    "id": "proj-info",
    "name": "프로젝트 정보",
    "fields": [
      { "key": "assignee", "label": "담당자", "type": "text" },
      { "key": "start",    "label": "시작일", "type": "date" },
      { "key": "status",   "label": "상태",   "type": "select",
        "options": ["진행 중", "완료", "보류"] },
      { "key": "ref",      "label": "참고 링크", "type": "url" }
    ]
  }
]
```

### note.md frontmatter
```markdown
---
_meta:
  - templateId: proj-info
    values:
      assignee: 김지호
      start: "2026-07-08"
      status: 진행 중
      ref: "https://notion.so/..."
---

(노트 본문)
```

`values`에는 `key`로 저장 → 라벨이 변경돼도 값 유지.

---

## 범위 (포함)

- [x] 메타 템플릿 CRUD (설정 화면) — 5가지 타입, select 옵션 편집
- [x] 노트 툴바 "메타 +" 버튼 + 드롭다운
- [x] MetaBlock Tiptap 커스텀 노드 (최상단 고정)
- [x] 타입별 인라인 편집 (text/date/select/url/number)
- [x] select → `<select>` 드롭다운 UI
- [x] YAML frontmatter 저장/로드 (templateId + values만)
- [x] 자동 반영 (스키마는 항상 현재 템플릿 참조)
- [x] 템플릿 삭제 시 경고 표시
- [x] 블록 삭제

## 범위 (제외)

- 메타 기반 검색/필터 (2차)
- 메타 값 연동 리마인더 (2차)
- 마크다운 내보내기 시 메타 테이블 렌더링 (2차)
- 필드 타입 변경 후 기존 값 마이그레이션 (타입 변경 자체를 제한으로 해결)

---

## 가정

- 템플릿 `id`는 생성 시 UUID로 고정 (라벨·필드 변경해도 ID 불변)
- 필드 `key`도 생성 시 고정 (라벨 변경해도 저장된 값 유지)
- 템플릿은 앱 전역 공유 (워크스페이스별 분리 없음 — 1차)

---

## 위험

| 위험 | 대응 |
|---|---|
| 기존 frontmatter가 있는 `.md` 충돌 | `_meta` 키만 파싱, 나머지 보존 |
| 파싱 실패 시 노트 손상 | 실패 → 원본 그대로, 에러 토스트 |
| 템플릿 삭제 시 노트 데이터 고아 | 삭제된 templateId → "(삭제된 템플릿)" 경고 + 값 유지 |
| Tiptap 최상단 고정 복잡도 | `MetaBlock`을 doc의 first-child-only 노드로 제한 |
| `select` 옵션 삭제 시 기존 선택값 | 옵션에 없는 값은 이탤릭+경고 색으로 표시 ("보류 ⚠") |

---

## 구현 단계

- [x] 1. `electron/main.ts` — `meta:getTemplates` / `meta:saveTemplates` IPC
- [x] 2. `src/store/metaStore.ts` — 템플릿 CRUD + subscribe (변경 시 노트에 알림)
- [x] 3. `src/io/noteFormat.ts` — YAML frontmatter `_meta` 파싱/직렬화
- [x] 4. Tiptap 커스텀 노드 (attrs: templateId, values) — 계획은 `MetaBlock.ts`/`MetaBlockView.tsx` 분리였으나 실제로는 `src/note/NoteMetaBlock.tsx` 단일 파일로 노드+React NodeView 통합 구현
- [x] 5. React NodeView (타입별 편집 UI) — 위 `NoteMetaBlock.tsx`에 포함
- [x] 6. "메타 +" 버튼 + 드롭다운 — 계획은 별도 `EditorToolbar.tsx` 대상이었으나 실제로는 `src/note/NoteEditor.tsx`에 직접 통합
- [x] 7. `src/ui/Settings.tsx` — 메타 템플릿 관리 탭 (`MetaTemplatesSection`, select 옵션 편집 포함)
- [x] 8. `src/io/noteFormat.test.ts` — frontmatter 왕복 테스트 (`describe('noteFormat _meta roundtrip')`)

---

## 검증 방법

1. 템플릿 생성 → `userData/meta-templates.json` 저장 확인
2. 노트 중간 커서 → "메타 +" → 블록이 **최상단**에 삽입
3. select 필드 → 드롭다운 동작 확인
4. 저장 → 재열기 → 모든 값 유지
5. 설정에서 템플릿에 필드 추가 → 해당 노트 재열기 → 새 필드 자동 표시
6. 설정에서 템플릿 삭제 → 해당 노트에 경고 표시
7. 기존 frontmatter 있는 노트에 메타 추가 → 기존 키 보존
8. `make verify` 통과

---

## 발견한 사실
- 실제 구현은 계획의 파일 분리(`MetaBlock.ts` + `MetaBlockView.tsx`, `EditorToolbar.tsx`)를 따르지 않고 `src/note/NoteMetaBlock.tsx`(노드+뷰 통합) 및 `NoteEditor.tsx`(툴바 버튼 통합)로 단순화됨 — 기능 범위는 계획과 동일.
- 커밋 `a3fc7bd feat: 노트 메타 블록 기능 (v1)`로 v1 범위 전체 구현·병합 완료.

## 결정 변경 이력
- 2026-07-08: 초안 작성
- 2026-07-08: 스키마-값 분리 원칙 확정 (자동 반영), 타입 5종 확정, select 드롭다운 추가
- 2026-07-09: v1 구현 완료 확인, completed/로 이동 (커밋 a3fc7bd)
