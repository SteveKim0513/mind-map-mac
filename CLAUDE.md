@AGENTS.md

# Claude Code Instructions

## Start Here

- 작업 전 `git status --short` 확인.
- 관련 코드, 테스트, `ARCHITECTURE.md`, `.claude/rules/`를 먼저 읽는다.
- 복잡한 작업은 구현 전에 `docs/exec-plans/active/`에 계획 파일을 작성한다.
- 기존 사용자 변경사항을 덮어쓰거나 되돌리지 않는다.

## Required Commands

```bash
make setup        # npm ci
make dev-safe     # Electron + Vite 개발 서버 (격리된 임시 환경)
make verify       # typecheck + unit test  ← 완료 주장 전 반드시 실행
make verify-full  # typecheck + unit test + build  ← PR 전 반드시 실행
make harness-check # 아키텍처·문서 구조 검사
```

- `make verify` 없이 완료를 주장하지 않는다.
- 버그 수정은 가능한 경우 실패를 재현하는 테스트를 먼저 추가한다.
- UI·Electron 변경은 테스트만으로 끝내지 않고 `make dev-safe`로 실제 동작을 확인한다.
- 패키지 관리자는 `npm`만 사용한다. `yarn`·`pnpm`·`bun` 금지.

## Architecture

아키텍처 기준은 `ARCHITECTURE.md`를 따른다. 의존성 방향:

```
types.ts → io/ · theme/ → store/ → domain/* → ui/* → App.tsx
electron/(main.ts) ← IPC → electron/preload.ts → window.api → src/
```

- 외부 입력(파일, IPC 응답)은 `src/io/`나 `electron/preload.ts` 경계에서 검증한다.
- 도메인 경계를 우회해 다른 도메인의 내부 파일을 직접 import하지 않는다.
- 새 의존성 추가 전에 기존 도구로 해결 가능한지 확인한다.

## Working Rules

- `.claude/rules/architecture.md` — 계층 경계 상세 규칙
- `.claude/rules/testing.md` — 테스트 작성 규칙
- `.claude/rules/security.md` — 보안 경계 규칙
- `.claude/rules/electron.md` — IPC·Electron 규칙
- `.claude/rules/frontend.md` — React·Tiptap 규칙 **(UI 작업 시 `/design-ui` 스킬 필수)**

## Design

UI·CSS 작업 시 **반드시** 먼저 읽는다:

- `docs/design/UI-DESIGN-PRINCIPLES.md` — 핵심 디자인 원칙 (simple · powerful · intuitive)
- `docs/design/COLOR-SYSTEM.md` — 색상 3계층 규칙

**UI 변경 절차**: `/design-ui` 스킬 실행 → 원칙 확인 → 구현 → `make harness-check` → `make dev-safe` 확인.

## Approval Boundaries

명시적 승인 없이 수행하지 않는다:

- `git push --force`, `git reset --hard`, 브랜치·태그 삭제
- `npm run dist` (운영 배포)
- `MindMapDoc.version` 스키마 변경
- GitHub Secrets 변경
- `.claude/settings.json`의 `deny` 규칙 제거

## Definition of Done

완료 보고에 반드시 포함한다:

1. 변경한 파일 목록
2. `make verify` 실행 결과 (종료 코드 포함)
3. UI/Electron 변경 시 런타임 검증 증거
4. 남아 있는 위험·미검증 항목
5. 인간 판단이 필요한 사항

검증하지 않은 내용을 검증했다고 주장하지 않는다.

## Context Management

**세션 시작 시**: `.claude/session-state.md` 존재 확인 → 있으면 읽어 이전 상태 복원.

**Sub-agent 위임 기준** (메인 컨텍스트 보호):
- 읽을 파일 5개 이상 → `codebase-explorer` sub-agent
- 독립 구현 작업 → `implementation-worker` sub-agent
- 코드 리뷰·감사 → `architecture-reviewer` / `security-reviewer` sub-agent

**컨텍스트가 길어질 때**: `/compact-prep` 실행 후 `/compact`.

상세 규칙: `.claude/rules/context-management.md`

## Personal Overrides

개인·장비별 설정은 `.claude/settings.local.json`과 `CLAUDE.local.md`에 작성한다 (gitignore됨).
