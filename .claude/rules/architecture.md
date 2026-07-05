---
description: "계층 경계 및 의존성 방향 규칙 — ARCHITECTURE.md와 함께 읽는다"
---

# Architecture Rules

## 의존성 방향

아래 방향으로만 의존한다. 역방향은 금지.

```
types.ts → io/ · theme/ → store/ → domain/* → ui/* → App.tsx
```

- `src/`에서 `electron/` 직접 import 금지. `window.api`만 사용.
- `canvas/`, `note/`, `focus/`, `sync/` 등 도메인 모듈은 서로 직접 참조하지 않는다.
  - 공유가 필요하면 `store/`를 통하거나 `App.tsx`에서 props로 연결한다.
- `store/`는 `ui/`, `canvas/` 등 렌더러 모듈을 import하지 않는다.

**위반 시**: "Error: [도메인A]은 [도메인B]를 직접 참조할 수 없습니다. store/ 또는 App.tsx를 통해 연결하세요. ARCHITECTURE.md#경계-규칙 참조."

## 외부 입력 경계

- 파일에서 읽은 JSON은 반드시 `src/io/formats.ts`의 parse 함수를 통과시킨다.
- IPC 응답은 `electron/preload.ts`의 타입 선언(`Api` 타입)에 의해 검증된다.
- 검증되지 않은 `any` 캐스팅으로 외부 데이터를 내부 타입으로 변환하지 않는다.

## reminder 불변 조건

- `reminderOn: true`이면 `reminderId`가 반드시 존재해야 한다 (또는 생성 중).
- `reminderId`를 제거할 때 `reminderOn`도 함께 제거한다.
- 복사·붙여넣기·duplicateNode는 `reminderOn`, `reminderId`, `reminderSyncedAt`, `reminderBase`를 반드시 제거한다.
- 이 불변 조건을 변경하는 PR은 `docs/decisions/`에 결정 기록이 필요하다.

## 새 도메인 모듈 추가 조건

1. `docs/exec-plans/active/`에 계획 파일 작성
2. `docs/product/FEATURE-INVENTORY.md` 갱신
3. 해당 모듈에 대한 핵심 로직 단위 테스트 추가
4. `ARCHITECTURE.md` 모듈 책임 표 갱신

## 금지 패턴

```typescript
// ❌ 도메인 간 직접 참조
import { useNote } from '../note/NoteEditor';   // canvas/에서
import { useCanvas } from '../canvas/Canvas';   // note/에서

// ❌ 외부 데이터 무검증 캐스팅
const doc = JSON.parse(raw) as MindMapDoc;  // parse() 함수를 사용할 것

// ❌ Electron 직접 import
import { ipcRenderer } from 'electron';  // preload.ts → window.api 사용
```

```typescript
// ✅ store를 통한 도메인 간 통신
const selectedId = useMap(s => s.selectedId);

// ✅ 경계 검증
const doc = parseDoc(JSON.parse(raw));  // io/formats.ts의 parse 함수

// ✅ IPC 브리지
const result = await window.api.readFile(path);
```
