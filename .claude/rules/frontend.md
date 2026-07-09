---
paths:
  - "src/**/*.tsx"
  - "src/**/*.ts"
  - "src/styles.css"
description: "React, Tiptap, Zustand, 색상 시스템 규칙"
---

# Frontend Rules

## React

- 함수형 컴포넌트와 hooks만 사용한다. 클래스 컴포넌트 금지.
- `useEffect` 의존성 배열을 생략하지 않는다.
- 불필요한 리렌더링 방지를 위해 Zustand selector를 최소 단위로 구독한다.
  ```typescript
  // ✅ 좁은 selector
  const selectedId = useMap(s => s.selectedId);
  // ❌ 전체 state 구독
  const { selectedId } = useMap(s => s);
  ```

## UI·컴포넌트 변경 시 필수 절차

**UI 컴포넌트·CSS를 변경할 때는 `/design-ui` 스킬을 먼저 실행한다.**

1. `/design-ui` 스킬 실행 — `docs/design/UI-DESIGN-PRINCIPLES.md` + `docs/design/COLOR-SYSTEM.md` 로드
2. 설계 의도 확인 후 구현
3. `make harness-check`로 디자인 하네스 통과 확인 (`scripts/harness/check-design.mjs`)
4. `make dev-safe`로 다크/라이트 모드 시각 확인

## 색상 시스템

- 색상 값을 컴포넌트에 직접 하드코딩하지 않는다.
- `src/theme/palette.ts`의 시맨틱 키를 사용하거나 CSS 변수를 사용한다.
- 새 색상을 추가할 때 `docs/design/COLOR-SYSTEM.md`의 3계층 규칙을 따른다.
  - Layer 1: neutral (배경·텍스트)
  - Layer 2: state (선택·포커스·호버)
  - Layer 3: tag (노드 태그 색상 팔레트)
- 색상 관련 결정은 `docs/decisions/0001-semantic-color-keys.md` 참조.
- raw hex 허용 목록 (이 두 값만): `#34c759` (활성 초록), `#ff3b30` (위험 빨강).

## Tiptap 에디터

- Tiptap 확장은 `src/note/`에 캡슐화한다.
- 새 Tiptap 확장 추가는 `docs/exec-plans/active/`에 계획 후 진행.
- 마크다운 직렬화/역직렬화는 `src/note/markdown.tsx`의 함수를 사용한다.
- 테이블 마크다운은 `src/note/tableMarkdown.ts`를 통한다 (GFM 호환성 이슈 있음).

## Zustand Store

- `createStore` + `StoreApi`를 사용한다 (컨텍스트 기반 다중 인스턴스 패턴).
- Store 내부 상태를 컴포넌트에서 직접 변조하지 않는다 — store의 action만 사용.
- History(undo/redo)가 필요한 뮤테이션은 `mapStore.ts`의 `_pushHistory` 패턴을 따른다.

## 캔버스 렌더링

- 캔버스는 SVG (엣지) + absolute-positioned div (노드) 혼합 방식.
- 위치 계산은 `src/layout/treeLayout.ts`에서만 수행한다.
- 노드 크기 측정은 `src/layout/measure.ts`를 통한다.
- 캔버스 Pan/Zoom 상태는 `MindMapDoc.view`에 저장하고 자동 저장된다.

## TypeScript

- `tsconfig.json`의 `strict: true`, `noUnusedLocals`, `noUnusedParameters`를 준수한다.
- `any` 타입은 `unknown`으로 대체하고 타입 가드를 사용한다.
- `as` 캐스팅은 외부 데이터 경계(`io/`)에서만 허용하고, 이유를 주석으로 남긴다.
