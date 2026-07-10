# 노트 템플릿 — 실행 계획
날짜: 2026-07-09
상태: completed

## 목표

`docs/product/specs/2026-07-09-note-templates.md`의 기획을 구현한다. 코드베이스 조사 결과 스펙 작성 시점의 가정 중 하나가 실제 아키텍처와 달라 아래에서 보정한다.

## 스펙 대비 보정 사항

- **사이드바 UI**: 스펙은 "인라인 아코디언 섹션"으로 그렸지만, 실제 휴지통(Trash)은 **사이드바 트리에 없고 푸터 아이콘 버튼(뱃지) + 별도 오버레이 패널**(`TrashPanel.tsx`, `wh-backdrop`) 구조다. Note Template도 동일 패턴(푸터 버튼 + `TemplatePanel.tsx`)으로 구현한다 — 트리에 섞이지 않는다는 스펙의 안전성 요구는 동일하게 충족.
- **설정 토글 스타일**: 스펙 목업은 iOS 스타일 스위치였지만, 실제 코드에는 `seg`/`seg-btn`(두 버튼 세그먼트, 테마 선택에 사용 중)만 존재. 일관성을 위해 세그먼트 컨트롤(켜짐/꺼짐 두 버튼)로 구현.
- **메타+와의 관계**: 코드 확인 결과 메타+(`MetaAddButton`)는 Tiptap 에디터에 아무것도 삽입하지 않고 `note.metaBlocks`라는 별도 구조화 배열에 추가한다. 템플릿+는 반드시 `editor.chain().focus().insertContent(markdown).run()`으로 에디터 본문에 직접 삽입 — 두 기능은 완전히 다른 삽입 경로를 쓴다(스펙 §0 결정과 일치, 코드로도 확인됨).

## 데이터 흐름

```
electron/main.ts
  settings.json { workspace?, templatesEnabled? }         (widen type)
  ensureTemplatesDir(ws)                                   (getWorkspace() 내부에서 호출)
  IPC: settings:getTemplatesEnabled / settings:setTemplatesEnabled / templates:list
       (create/read/delete는 신규 핸들러를 만들지 않고 기존 범용 fs:createFile·fs:read·fs:delete를
        렌더러에서 `.templates` 절대경로로 호출해 재사용 — 구현 중 발견한 단순화, 아래 참고)
        ↓
electron/preload.ts
  window.api.templates.{list,isEnabled,setEnabled}  (meta.* 중첩 패턴 재사용)
  + 기존 window.api.{createFile,readFile,remove} 재사용
        ↓
src/store/templateStore.ts   (trashStore.ts 패턴 — plain create() 싱글턴)
  { enabled, items: TemplateSummary[], refresh(), setEnabled(), create(), remove() }
        ↓                                   ↓                              ↓
src/sidebar/Sidebar.tsx            src/note/EditorToolbar.tsx      src/ui/Settings.tsx
  푸터 버튼(뱃지) — TrashPanel        TemplateAddButton(검색)         seg/seg-btn 토글
  과 동일 위치에 추가                  + MetaAddButton 검색 리트로핏
        ↓
src/ui/TemplatePanel.tsx (신규, TrashPanel.tsx 1:1 모델)
        ↓
src/note/NoteEditor.tsx — handleInsertTemplate: templates.read → parseNote().body → chain().insertContent()
```

## 구현 단계

- [x] 1. `electron/main.ts`: settings 타입 확장, `ensureTemplatesDir`, `settings:getTemplatesEnabled`/`settings:setTemplatesEnabled`/`templates:list` IPC
- [x] 2. `electron/preload.ts`: `TemplateSummary` 타입 + `window.api.templates.{isEnabled,setEnabled,list}`
- [x] 3. `src/store/templateStore.ts` 신규 (trashStore 패턴)
- [x] 4. `src/store/uiStore.ts`: `templatesOpen/openTemplates/closeTemplates` 추가
- [x] 5. `src/ui/TemplatePanel.tsx` 신규 (TrashPanel 1:1 모델 — 목록, 새 템플릿, 삭제)
- [x] 6. `src/sidebar/Sidebar.tsx`: 푸터에 Note Template 버튼(뱃지) 추가, `templatesEnabled=false`면 렌더 안 함
- [x] 7. `src/ui/Icon.tsx`: `template` 아이콘 추가
- [x] 8. `src/note/EditorToolbar.tsx`: `MetaAddButton`에 검색 인풋 리트로핏, `TemplateAddButton` 신규(검색 + 삽입 + 새 템플릿)
- [x] 9. `src/note/NoteEditor.tsx`: 템플릿 목록 구독 + `insertTemplate`/`createTemplate` 연결
- [x] 10. `src/ui/Settings.tsx`: 노트 템플릿 온오프 세그먼트 컨트롤 행 추가
- [x] 11. `src/App.tsx`: `{templatesOpen && <TemplatePanel/>}` 마운트
- [x] 12. 단위 테스트: `src/store/templateStore.test.ts` (5개)
- [x] 13. E2E: `e2e/note-templates.spec.ts` (meta-template-delete.spec.ts 패턴 — 사전 시딩)
- [x] 14. `make verify` → 스크린샷으로 라이트/다크 육안 확인 → `docs/product/FEATURE-INVENTORY.md` 갱신

## 검증 방법

- `make verify` (typecheck + unit) 통과 — 118 tests
- 라이트/다크 모드 스크린샷으로: 툴바 템플릿+ 삽입, 사이드바 패널, 설정 토글 UI 확인 (Playwright로 실제 프로덕션 빌드 구동 — `make dev-safe` 수동 조작은 별도로 하지 않음, 아래 참고)
- `make harness-check` (디자인 하네스 — raw hex 없음, 폰트 크기 확인) 통과
- E2E 전체 스위트(12개) 그린 — 회귀 없음

## 발견한 사실 (작업 중 갱신)

- `fs:createFile`/`fs:rename`/`fs:delete`는 워크스페이스 경계 검증이 없는 기존 핸들러(보안 규칙 위반이지만 기존 코드 — 이번 작업 범위 밖). **범위 축소 결정**: 신규 `templates:create`/`templates:read`/`templates:delete` 핸들러를 따로 만드는 대신, 렌더러(`templateStore.ts`)에서 워크스페이스 루트 + `.templates`를 조합한 절대경로로 기존 `createFile`/`readFile`/`remove`를 그대로 호출 — 새 IPC 표면을 최소화(신규 핸들러는 `templates:list`, `settings:getTemplatesEnabled`, `settings:setTemplatesEnabled` 세 개뿐).
- 두 가지 IPC 네이밍 컨벤션이 공존(`trashMove` 플랫 스타일 vs `meta.getTemplates` 중첩 스타일) — 신규 기능은 최신 컨벤션인 중첩 스타일(`templates.*`)을 따랐다.
- `MetaAddButton`과 신규 `TemplateAddButton`이 처음엔 같은 `.meta-add-wrap` 클래스를 썼다가, 기존 `e2e/responsive-toolbar.spec.ts`가 `.meta-add-wrap`을 단일 요소로 가정하고 있어 strict-mode 충돌로 실패 — `TemplateAddButton`을 `.tpl-add-wrap`으로 분리해 해결(회귀 없음, 12개 E2E 전부 그린 재확인).
- 초기 CSS에 `.meta-add-date { font-size: 10.5px }`를 추가했다가 디자인 하네스의 11px 최소 폰트 규칙에 걸려 11px로 수정.

## 남은 위험 / 후속 과제

- 기존 노트를 "템플릿으로 저장"하는 단축 경로 없음(스펙 §6에서 명시적으로 범위 제외 — 사용자 확인 완료, 필요 없음).

### 2026-07-09 후속: 워크스페이스 경계 미검증 IPC 핸들러 하드닝 (해결됨)

`fs:createFile`/`fs:createFolder`/`fs:rename`/`fs:delete`/`fs:move`/`images:write`/`images:read`가 입력 경로를 검증하지 않던 기존 기술부채를 이번에 함께 해결했다(`.claude/rules/security.md`의 "새 IPC 핸들러는 입력 경로를 검증하고 허용된 디렉터리 외부 접근을 차단한다" 요구를 기존 핸들러에도 소급 적용).

- `assertInsideWorkspace(p)` 공용 헬퍼 추가(`electron/main.ts`) — `path.resolve` 후 워크스페이스 루트 안인지 확인, 벗어나면 throw. 위 7개 핸들러 전부에 적용.
- **실제로 재현 가능한 취약점이었다**: 노트/맵 제목은 사용자가 자유롭게 입력하는 텍스트이고 그대로 `fs:createFile`의 `name`/`fs:rename`의 `newName`으로 전달된다 — 예를 들어 노트 제목을 `../../../../tmp/evil`로 바꾸면 워크스페이스 밖에 파일을 쓸 수 있었다. 지금은 `assertInsideWorkspace`가 이를 차단한다.
- 기존 `images:write`/`images:read`의 검증 로직도 `resolved.startsWith(ws)`라는 미묘한 버그가 있었다(구분자 없이 접두어만 비교 — `/ws-evil`이 `/ws`를 통과시킴). `assertInsideWorkspace`로 교체하며 함께 수정.
- 검증: `make verify`(118 테스트) 통과, `make harness-check` 통과(신규 경고 없음), E2E 12개 전부 통과.

### 2026-07-10 후속: `file-management.spec.ts` 플레이키 테스트 수정 (해결됨)

"외부 파일 추가 후 포커스 복귀 시 사이드바 갱신" 테스트가 간헐적으로 실패하는 근본 원인을 찾아 고쳤다.

- 원인은 앱 로직이 아니라 테스트 자체: `win.blur()`/`win.focus()` 호출 후 고정된 `page.waitForTimeout(200)`/`(500)`으로만 기다렸는데, 디바운스된 트리 리프레시가 시스템 부하가 높을 때 500ms를 넘길 수 있어 타이밍 레이스였다(진단 스크립트로 단독 실행 시 3/5 통과, 빌드·다른 테스트 직후 연속 실행 시 재현 실패 — 부하에 비례해 실패 확률이 오른다는 것을 확인).
- `.claude/rules/testing.md`의 "시간 기반 sleep 대기 대신 명시적인 준비 상태 확인을 사용한다" 규칙대로, 고정 `waitForTimeout`을 `expect.poll(...)`(blur 완료 확인 + 사이드바 라벨 등장 확인, 최대 5초)로 교체.
- 검증: 연속 5회 단독 실행 전부 통과(개선 전엔 부하 상황에서 재현 실패), 전체 E2E 스위트(12개) 재실행 전부 통과, 실행 시간도 오히려 단축(조건 충족 즉시 반환).
