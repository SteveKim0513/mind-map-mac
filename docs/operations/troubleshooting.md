# 문제 해결

## 빌드 문제

### TypeScript 오류

```bash
npm run typecheck 2>&1 | head -50
```

- `noUnusedLocals`, `noUnusedParameters` 위반이 많으면 관련 파일만 확인한다.
- `strict: true` 관련 오류는 `unknown` 타입과 타입 가드로 해결한다.

### Vite 빌드 실패

```bash
npm run build 2>&1
```

- `electron-log` 관련 오류: `vite.config.ts`의 `external` 설정 확인.
- `dist/`, `dist-electron/` 파일이 오래된 경우: `rm -rf dist dist-electron` 후 재빌드.

## 테스트 문제

### 테스트 실패

```bash
npm test -- --reporter=verbose 2>&1
```

- 특정 파일만 실행: `npm test -- src/io/formats.test.ts`
- watch 모드: `npm run test:watch`

### Vitest jsdom 오류

`vitest.config.ts`의 환경이 `node`임을 확인한다. 브라우저 API가 필요하면 `jsdom`을 명시한다.

## Electron 문제

### 앱 실행 안 됨

```bash
make dev-safe  # 로그에서 오류 확인 (격리 환경)
```

- 포트 충돌: `lsof -i :5173` 확인
- 이전 Electron 프로세스: `pkill -f "electron"` 후 재시작

### macOS Reminders 동작 안 함

1. 시스템 설정 → 개인 정보 보호 및 보안 → 자동화 → MindMap 확인
2. 시스템 설정 → 개인 정보 보호 및 보안 → 미리 알림 → MindMap 확인
3. 앱 재시작

### IPC 응답 없음

`electron/main.ts`에서 해당 `ipcMain.handle` 등록 여부 확인.

## Claude Code / Harness 문제

### Hook 오류

```bash
# 직접 테스트
echo '{"tool":"Bash","input":{"command":"rm -rf /"}}' | bash .claude/hooks/block-destructive-command.sh
echo $?
```

### `make harness-check` 실패

```bash
node scripts/harness/check-architecture.mjs
node scripts/harness/check-docs.mjs
```

각 스크립트의 출력에서 실패 원인을 확인한다.

## 배포 문제

→ `docs/release/DEPLOY-UPDATE-SPEC.md` 참조
→ `docs/operations/deployment.md` 참조
