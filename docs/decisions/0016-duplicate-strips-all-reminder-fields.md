# 0016. 노드 복제는 리마인더 4개 필드를 모두 제거한다
날짜: 2026-07-17
상태: accepted

## 컨텍스트
탐색 QA에서 `duplicateNode`(`src/store/mapStore.ts`)가 복제 시 `reminderId`·`reminderSyncedAt`만 제거하고 `reminderOn`·`reminderBase`는 유지한다는 사실을 확인했다. 코드 주석은 "reminderOn을 유지하면 동기화가 새 리마인더를 만든다"는 이유로 이를 의도로 설명했으나:

- `AGENTS.md`·`.claude/rules/architecture.md`의 불변 조건은 "복사·붙여넣기·duplicateNode는 `reminderOn`, `reminderId`, `reminderSyncedAt`, `reminderBase`를 반드시 제거한다"고 명시한다.
- 복사/붙여넣기(⌘C/⌘V)는 이미 4개 전부 제거한다(`ClipNode` allowlist). 복제만 다르게 동작해 표면 간 불일치가 있었다.
- reminderOn 유지는 복제할 때마다 macOS 리마인더를 **중복 생성**(double-booking)하고, `reminderBase` 잔존은 충돌 해결(resolveReminder) 로직을 오염시킨다.

## 결정
`duplicateNode`는 복사/붙여넣기와 동일하게 `reminderOn`, `reminderId`, `reminderSyncedAt`, `reminderBase` **4개 필드를 모두 제거**한다. 복제된 노드는 리마인더 비활성 상태로 시작하며, 필요하면 사용자가 다시 켠다.

## 결과
- 장점: 불변 조건과 일치, 복사/복제 동작 통일, 중복 예약·충돌 오염 제거.
- 단점: "복제하면 리마인더도 함께 걸린다"를 기대하던 사용자는 복제 후 수동으로 다시 켜야 한다. (복사와 동일한 기대치이므로 일관적.)

## 대안
- reminderOn 유지 + reminderBase만 제거: 중복 예약 문제가 남아 기각.
