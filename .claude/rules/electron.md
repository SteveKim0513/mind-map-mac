---
paths:
  - "electron/**"
  - "src/store/**"
  - "src/sync/**"
description: "Electron IPC, 메인 프로세스, Reminders 동기화 규칙"
---

# Electron Rules

## IPC 설계 원칙

- 새 IPC 채널은 `electron/preload.ts`의 `api` 객체에 먼저 타입을 선언한다.
- `ipcMain.handle(채널, handler)` 등록은 `electron/main.ts`에만 한다.
- 채널 이름은 `도메인:동사` 형식 (`file:save`, `reminders:query`).
- handler 반환값은 직렬화 가능한 타입이어야 한다 (클래스 인스턴스, 함수 금지).

## Reminders 동기화

- osascript 호출은 반드시 `electron/reminders.ts`를 통한다.
- `electron/reminders.ts`의 함수를 직접 `src/`에서 import하지 않는다 — IPC 브리지 사용.
- `resolveReminder.ts`의 conflict-resolution 로직을 변경하면 `docs/decisions/0002-reminder-osascript-serialization.md`와 테스트(`resolveReminder.test.ts`)를 함께 갱신한다.
- Reminders 고아 방지: 노드 삭제 시 `reminderDeleteHook`이 호출되는지 확인한다 (`mapStore.ts` 참조).

## 자동 업데이트

- 업데이트 로직은 `electron/updater.ts`에만 있다.
- 업데이트 상태는 `update:status` IPC 채널로 렌더러에 push한다 (`uiStore.ts`).
- 새 버전 릴리즈 전에 `scripts/verify-release.mjs`가 아티팩트를 검증한다.

## 로깅

- `electron/logger.ts`의 `logEvent()`만 사용한다. `console.log`는 개발 중에만.
- 로그에 사용자 파일 내용·개인정보를 포함하지 않는다.
- 로그 레벨: `error`(앱 중단 위험), `warn`(예상치 못한 상태), `info`(중요 이벤트), `debug`(개발 중).

## 빌드

- `npm run build` = `tsc --noEmit && vite build` — 타입 오류는 빌드를 중단시킨다.
- `electron-log`, `electron-log/main`은 `vite.config.ts`의 `external`에 유지한다 (번들링 금지).
- `dist-electron/`, `dist/`는 생성 파일 — 절대 수동 편집하지 않는다.
