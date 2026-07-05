# AI API 키 설정 기능
날짜: 2026-07-05
상태: completed

## 목표
사용자가 Claude API 키를 앱 설정에 입력/저장/삭제할 수 있게 하여 AI 기능의 기반을 마련한다.

## 범위
포함:
- electron/main.ts — safeStorage 기반 키 저장/조회/삭제 IPC 핸들러 4개
- electron/preload.ts — window.api.ai.* 브리지
- src/ui/Settings.tsx — AI 섹션 UI (view/edit 모드)
- src/styles.css — AI 키 입력 스타일

제외:
- 실제 Claude API 호출 (태그 생성 등 AI 기능은 다음 단계)
- API 키 유효성 검증 (실제 API 호출 없이)

## 구현 단계
- [x] exec-plan 작성
- [ ] electron/main.ts — safeStorage 핸들러
- [ ] electron/preload.ts — ai.* 브리지
- [ ] src/ui/Settings.tsx — AI 섹션
- [ ] src/styles.css — 스타일
- [ ] make verify

## IPC 채널
- `ai:setKey(key: string): void`
- `ai:hasKey(): boolean`
- `ai:getMasked(): string | null`  — `sk-ant-••••abcd` 형태
- `ai:clearKey(): void`

## 검증 방법
1. make verify (typecheck + test)
2. make dev → 설정 열기 → 키 입력/저장/삭제 동작 확인
