# 기술부채 추적기

> 갱신 방법: 부채 발견 시 항목 추가, 해결 시 완료 처리. 에이전트도 읽고 갱신한다.

## 진행 중

| # | 영역 | 설명 | 발견일 | 심각도 | 담당 |
|---|---|---|---|---|---|
| TD-001 | docs | `docs/product/FEATURE-INVENTORY.md` 검증 미완료 항목 (⚠️ 표시) | 2026-06-10 | Medium | - |
| TD-002 | arch | `src/store/workspaceStore.ts`가 `note/wikiLinkText` 런타임 import — store→domain 경계 위반. 해결: `src/io/`로 이동 또는 유틸 분리 | 2026-06-23 | Low | - |
| TD-003 | arch | (공유 폴더 검토 2026-09-21) `src/share/index.ts` 배럴이 공개 API가 아님 — 약 85개 export 중 앱이 실제로 쓰는 것은 약 20개. 죽은 코드·테스트 전용 export: `rooms.getCommentSync`/`getSession`, `shareStore.roleForPath`, `commentStore.commentTargetForNote`, `manifest.markManifestSeeded`, `docKeys.parseDocName`/`DocKind`, `sharedFile.sharedContentHash`, `notificationStore.setNotificationStorage`/`resetNotificationsForTest`, `readOnlyGuard.isGuardedAction`. 해결: 배럴을 실사용 API만 남기도록 줄이고 테스트 전용은 테스트에서 직접 import | 2026-09-21 | Low | - |
| TD-004 | arch | `src/App.tsx`가 공유 폴더 배선으로 765→932줄로 커짐. 해결: 공유 배선을 `shareWiring.ts`(훅)로 분리 | 2026-09-21 | Medium | - |
| TD-005 | arch | `src/share/replica.ts`(973줄)·`fileReplica.ts`(865줄)가 크고, 둘 사이에 직렬 큐·삭제 유예 로직이 중복. 해결: 공통 유틸로 추출 후 파일 분할 | 2026-09-21 | Medium | - |
| TD-006 | arch | `src/share/rooms.ts`의 `start*` 3개가 거의 복붙이고 `ShareRuntimeDeps`가 3벌로 나열됨. 해결: 공통 시작 함수 + 의존성 타입 1벌 | 2026-09-21 | Low | - |
| TD-007 | perf | 공유 폴더를 안 쓰는 사용자의 번들에도 yjs·hocuspocus 프로바이더가 포함됨. 해결: 공유 폴더를 처음 쓸 때 동적 `import()` | 2026-09-21 | Low | - |
| TD-008 | arch | 도메인(`note/` 등)에서 `ui/CommentThread`로 향하는 역방향 의존(계층 방향 위반). 해결: 코멘트 스레드 컴포넌트를 도메인 중립 위치로 옮기거나 App에서 주입 | 2026-09-21 | Low | - |
| TD-009 | product | 참가자의 캘린더·집중·아젠다 화면이 뷰어 미러(소유자 파일의 사본)의 할 일을 자기 할 일처럼 섞어 보여 줌. 해결: 뷰어 미러 출처를 구분하거나 집계에서 제외 | 2026-09-21 | Medium | - |
| TD-010 | ui | `src/menu/ContextMenu.tsx`의 뷰어(보기 전용) 분기 메뉴가 일반 메뉴와 복제됨. 해결: 메뉴 항목 정의에 `readOnlyHidden` 같은 속성을 두고 한 벌로 | 2026-09-21 | Low | - |
| TD-011 | perf | `CommentThread`가 위치 추적에 `requestAnimationFrame` 루프를 돎. 해결: `ResizeObserver`/이벤트 기반으로 | 2026-09-21 | Low | - |
| TD-012 | reliability | 앱 종료 시 `stopAllRooms`의 마지막 flush(사이드카·`.md` 저장)가 끝났음을 보장하지 않음. 해결: `before-quit`에서 flush 완료를 기다림 | 2026-09-21 | Medium | - |
| TD-013 | security | (이번 기능 이전 코드) 기존 IPC `file:save`·`fs:read`·`trash:move`에 `assertInsideWorkspace` 검사가 없음 — 렌더러가 침해되면 워크스페이스 밖 경로를 읽고 쓸 수 있음. 해결: 세 핸들러에 워크스페이스 경계 검사 추가 | 2026-09-21 | High | - |
| TD-014 | security | 렌더러 CSP가 `connect-src`만 제한하고 `img-src`는 제한하지 않음 — 원격 노트의 외부 이미지 URL이 열람 시 요청으로 나갈 수 있음. 해결: `img-src` 제한 또는 원격 이미지 차단 | 2026-09-21 | Medium | - |
| TD-015 | test | 렌더러 CSP를 패키지 빌드(`file://` + `app.isPackaged`)에서 검증하지 못함 — E2E는 비패키지 빌드라 localhost 임의 포트를 허용하는 분기(`allowLocalhost`)가 켜져 있다. 해결: 패키지 빌드 스모크에서 CSP 위반 이벤트 확인 | 2026-09-21 | Medium | - |
| TD-016 | release | `.github/workflows/release.yml`이 `server/`를 설치·빌드하지 않아 공유 통합 테스트(`npm --prefix server test`)와 `@share` E2E(`server/dist/relay.js` 필요)가 CI에서 실패할 수 있음. E2E 스텝 `timeout-minutes: 10`도 `@share` 추가분으로 재산정 필요. **해소(2026-09-21 사용자 승인): release.yml에 server 설치·빌드·테스트 단계와 E2E 20분 제한을 추가 — CI 실행 결과는 첫 태그 배포에서 확인** | 2026-09-21 | High | - |
| TD-017 | test | `@share` E2E 15건(각 2~3개 Electron + 릴레이)의 CI 소요 시간과 `retries: 1` 재시도 부하 위험. 해결: 병렬도·재시도 정책 재검토, 느린 시나리오 분리 | 2026-09-21 | Medium | - |
| TD-018 | arch | `electron/share.ts`가 `src/share/docKeys`(`SIDECAR_ID_RE`)·`src/share/limits`(`SHARE_MAX_*`)를 런타임 import — `electron/`→`src/`는 `io/`·`shared/`만 허용하는 규칙의 기존 위반(`scripts/harness/check-architecture.mjs`의 `ELECTRON_KNOWN_EXCEPTIONS`에 등록). 해결: 두 상수를 `src/io/` 또는 `src/shared/`로 옮기고 예외 항목 삭제 | 2026-09-21 | Low | - |
| TD-019 | server | 릴레이의 인증 전 프레임 상한이 `ws`의 내부 필드(`_receiver._maxPayload`)를 조정해 구현됨(공개 API 없음). `ws`/`crossws` 업그레이드로 필드가 바뀌면 조용히 전역 상한만 남는다 — 서버 테스트(`limits.test.ts` "1009")가 회귀를 잡고 `relay.receiver_limit_unavailable` 로그로 알린다. 해결: Hocuspocus/crossws가 소켓별 `maxPayload` 설정을 공개하면 교체 | 2026-09-21 | Low | - |

## 완료

| # | 영역 | 설명 | 해결일 | PR |
|---|---|---|---|---|
| - | - | - | - | - |

## 정기 정리 항목 (주기적으로 에이전트가 스캔)

- `TODO`, `FIXME`, `HACK` 주석 누적
- `docs/decisions/` 없이 번복된 설계
- 테스트 없는 순수 함수 (`src/io/`, `src/focus/`, `src/layout/`)
- `docs/product/FEATURE-INVENTORY.md`의 ⚠️ 미검증 항목
- `package.json` 의존성 노후화 (6개월 이상)
- 사용되지 않는 `src/` 파일
