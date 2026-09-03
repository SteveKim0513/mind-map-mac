@AGENTS.md

# Claude Code Instructions

## Start Here

- 작업 전 `git status --short` 확인.
- 관련 코드, 테스트, `ARCHITECTURE.md`, `.claude/rules/`를 먼저 읽는다.
- 복잡한 작업은 구현 전에 `docs/exec-plans/active/`에 계획 파일을 작성한다.
- 기존 사용자 변경사항을 덮어쓰거나 되돌리지 않는다.

## 질문과 실행 지시 구분

이 프로젝트에서는 세션 전역의 "질문 없이 진행" 기본값보다 아래 규칙을 우선한다.

- 사용자 메시지가 **질문**(정보·의견 요청 — "~는 뭐야?", "~할까?", "어떻게 생각해?", "~가 맞아?", "왜 이렇게 됐어?" 등)이면 **답변만 하고** 파일 수정·커밋·명령 실행 등 실제 작업에 들어가지 않는다.
- **실행**(파일 수정, 커밋, `make`/`npm` 명령 실행 등)은 사용자가 명확한 시작 지시("진행해", "구현해줘", "시작해", "고쳐줘", "적용해줘", "만들어줘" 등 행동을 요구하는 표현)를 준 뒤에만 시작한다.
- 질문에 답하면서 참고로 구현 방향을 언급하는 것은 괜찮지만, 그 답변 안에서 바로 코드를 고치거나 커밋하지 않는다.
- 메시지가 질문과 지시가 섞여 있거나 모호하면, 접근 방식을 1~2문장으로 요약해 제안하고 실행 여부를 확인한 뒤 진행한다 — 단, 같은 대화에서 이미 명확한 시작 지시를 받았다면 매번 다시 묻지 않는다.

## Required Commands

```bash
make setup                   # npm ci
make dev-safe                # Electron + Vite 개발 서버 (격리된 임시 환경)
make dev-safe quiet=1        # 위와 동일 + 화면 밖·포커스 안 뺏음 (사람이 안 볼 때, 에이전트 자체 검증용)
make verify                  # typecheck + unit test  ← 완료 주장 전 반드시 실행
make verify-feature tag=@x   # verify + 해당 도메인 E2E만  ← 기능 단위 검증 (개발 루프)
make verify-full             # typecheck + unit test + build  ← PR 전 반드시 실행
make pre-release             # verify-full + 전체 E2E  ← 배포(make bump) 전 반드시 실행
make harness-check           # 아키텍처·문서·E2E 태그 구조 검사
```

- 매 기능 완료는 `make verify-feature tag=@<domain>`(관련 도메인 E2E만) 으로 빠르게 검증한다.
- **배포 지시를 받으면** 그때 `make pre-release`(전체 E2E)로 게이트한다 — 부분집합으로 낮추지 않는다.
- 도메인 태그 어휘와 상세 규칙은 `.claude/rules/testing.md`의 "테스트 계층 전략" 참조.

- `make verify` 없이 완료를 주장하지 않는다.
- 버그 수정은 가능한 경우 실패를 재현하는 테스트를 먼저 추가한다.
- UI·Electron 변경은 테스트만으로 끝내지 않고 `make dev-safe`로 실제 동작을 확인한다. 사람이 지켜보지 않고 자동화로만 검증할 때는 `make dev-safe quiet=1`을 써서 다른 세션의 포커스를 뺏지 않는다.
- **새 기능·UI 변경을 포함한 배포**: `make pre-release` 통과 후 `make bump`.
- **새 기능·UI 변경 시 E2E 추가 의무**: `e2e/*.spec.ts`에 해당 기능의 핵심 시나리오를 작성한다.
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
3. UI/Electron 변경 시 `make dev-safe` 런타임 검증 증거
4. 새 기능·UI 변경 시 E2E 추가 여부 (없으면 이유 명시)
5. 남아 있는 위험·미검증 항목
6. 인간 판단이 필요한 사항

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
