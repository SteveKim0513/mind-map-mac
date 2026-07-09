# MindMap — Agent Operating Contract

macOS용 키보드 중심 마인드맵 앱. 생각(맵), 기록(노트), 할 일(리마인더)을 로컬 파일 기반으로 통합한다.
핵심 제약: 로컬 파일이 원본, 서버 없음, Electron + React + TypeScript.

## 가장 중요한 불변 조건

- 사용자 데이터(`.mind`, `.md`)는 절대 서버로 전송하지 않는다.
- 노드 ID는 생성 후 변경하지 않는다 — note↔node 링크의 안정 키다.
- `MindMapDoc.version`은 현재 `1`이다. 스키마 변경 시 마이그레이션 필요.
- `reminderOn/reminderId`는 항상 함께 관리한다 — 분리되면 Reminders 고아가 생긴다.
- 복사/붙여넣기는 `reminderOn/reminderId`를 제거하고 나머지 필드를 복사한다.

## 저장소 지도

```
src/types.ts             핵심 타입 (MindNode, MindMapDoc, NoteDoc …)
src/io/                  포맷 변환 (직렬화·역직렬화, Markdown/OPML)
src/theme/palette.ts     색상 팔레트 (시맨틱 키 시스템)
src/store/               Zustand 상태 관리 (mapStore, noteStore, sessionStore …)
src/canvas/              캔버스 렌더링 (SVG edge + React node)
src/note/                Tiptap 노트 에디터 + 마크다운 변환
src/focus/               포커스 모드 / 작업 세션 대시보드
src/sync/                macOS Reminders 양방향 동기화
src/layout/              트리 레이아웃 계산 (d3-hierarchy)
src/ui/                  공용 UI 컴포넌트
src/sidebar/             사이드바 (파일 트리)
src/panes/               탭·분할 패널 관리
src/interactions/        키보드 인터랙션
src/search/              전역 검색 · Quick Open
electron/main.ts         Electron 메인 프로세스 (IPC 핸들러)
electron/preload.ts      window.api 브리지 (contextBridge)
electron/reminders.ts    AppleScript Reminders 드라이버
docs/                    → 아래 참조
.claude/                 Claude Code 설정 (rules, skills, agents, hooks)
```

## 작업 유형별 필독 문서

| 작업 | 읽어야 할 문서 |
|---|---|
| 새 기능 구현 | `ARCHITECTURE.md`, `docs/product/FEATURE-INVENTORY.md`, `docs/product/specs/` |
| 버그 수정 | `ARCHITECTURE.md`, 관련 `src/` 모듈, `src/**/*.test.ts` |
| **UI·컴포넌트 변경** | **`docs/design/UI-DESIGN-PRINCIPLES.md` (필수)**, `docs/design/COLOR-SYSTEM.md`, `/design-ui` 스킬 사용 |
| 스타일·색상 변경 | `docs/design/UI-DESIGN-PRINCIPLES.md`, `docs/design/COLOR-SYSTEM.md`, `src/theme/palette.ts` |
| Reminders 동기화 | `docs/decisions/0002-reminder-osascript-serialization.md`, `src/sync/`, `electron/reminders.ts` |
| 노트 시스템 | `docs/decisions/0003-notes-as-standalone-files.md`, `src/note/`, `src/io/noteFormat.ts` |
| 릴리즈·배포 | `docs/release/DEPLOY-UPDATE-SPEC.md`, `docs/release/RELEASE-PROCESS.md` |
| 아키텍처 결정 | `docs/decisions/`, `ARCHITECTURE.md` |
| 복잡한 신규 작업 | `docs/exec-plans/active/` (계획 작성 후 구현) |

## 필수 개발 명령

```bash
make setup       # npm ci (최초 또는 package.json 변경 후)
make dev-safe    # Electron + Vite 개발 서버 (격리된 임시 환경)
make verify      # typecheck + unit test (완료 전 필수)
make verify-full # typecheck + unit test + build (PR 전 필수)
make test        # 단위 테스트만
make typecheck   # 타입 검사만
make harness-check # 아키텍처 + 문서 무결성 검사
```

## 변경 전후 검증 절차

1. `make verify` 실행 → 종료 코드 0 확인
2. UI 변경 → 앱을 실제로 실행해 동작 확인 (`make dev-safe`)
3. Reminders 관련 → macOS 리마인더 앱에서 직접 확인
4. 릴리즈 관련 → `make verify-full` 후 `docs/release/QA-CHECKLIST.md` 체크

## 금지된 작업 (명시적 승인 없이)

- 기존 사용자 변경사항 삭제 또는 덮어쓰기
- `git reset --hard`, `git push --force`, 브랜치/태그 삭제
- `npm run dist` (운영 배포) 실행
- `reminderOn/reminderId` 로직 단독 변경 (Reminders 고아 위험)
- 비밀정보(API 키, 인증서) 저장소 기록
- `.claude/settings.json` 권한 확대

## 인간 승인이 필요한 작업

- 운영 배포 (`npm run dist` → GitHub Release)
- `package.json` 버전 범프
- `MindMapDoc.version` 스키마 변경 (마이그레이션 포함)
- GitHub Secrets 변경
- 새 의존성 추가 (라이선스·번들 크기 검토 필요)
- `.claude/settings.json`의 권한 `deny` 제거

## 실행 계획 작성 조건

다음 작업은 `docs/exec-plans/active/` 에 계획 파일을 먼저 작성한다.

- 새 store 추가 또는 기존 store 구조 변경
- Electron IPC 채널 추가 또는 제거
- 새 도메인 모듈 생성
- Tiptap 확장 추가
- 릴리즈 파이프라인 변경
- macOS 시스템 권한(Reminders, 파일시스템) 변경

## 문서 갱신 규칙

- 기능 변경 → 같은 PR에서 `docs/product/FEATURE-INVENTORY.md` 갱신
- 번복 가능한 설계 결정 → `docs/decisions/NNNN-title.md` 추가
- 신규 기능 → `docs/product/specs/` 에 명세 먼저
- 빌드·실행·테스트 명령 변경 → `AGENTS.md`, `CLAUDE.md`, `docs/operations/` 동시 갱신
- Claude 규칙·Skills·Hooks 변경 → `.claude/rules/`, `.claude/skills/`, `.claude/hooks/` 갱신
