# 0012. 노드 지속시간 필드(durationMin) — version 범프 없는 선택 필드

날짜: 2026-07-15 · 상태: 채택

## 맥락 — 어떤 문제/선택지가 있었나

캘린더 Phase 3(타임블로킹)에서 노드가 "언제(`scheduleAt`)"에 더해 "얼마나(소요 시간)"를 표현해야 한다.
`MindNode`에 지속시간 필드가 필요하다. AGENTS.md는 `MindMapDoc.version` 스키마 변경을 인간 승인·마이그레이션
대상으로 규정한다. 처음엔 이 변경도 version 범프가 필요하다고 봤으나 [src/io/formats.ts](../../src/io/formats.ts)
확인 후 재평가했다: `serialize`는 `JSON.stringify(doc)` 전체 덤프(필드 화이트리스트 아님), `deserialize`는
`version`을 읽지 않고 방어적 backfill만 한다(version 게이트 마이그레이션 로직 자체가 없음).

## 결정 — 무엇을 택했나

`MindNode`에 **선택 필드 `durationMin?: number`**(분)를 추가하고, **`MindMapDoc.version`은 1로 유지**하며
마이그레이션을 두지 않는다.

- 순수 가산·하위호환: 구버전 파일(필드 없음)은 정상 파싱(undefined), 신버전 파일은 구버전 앱에서도 JSON
  라운드트립으로 필드 보존(직렬화가 화이트리스트가 아님 → 데이터 손실 없음).
- durationMin은 **로컬 전용** — macOS 미리알림에 지속시간 개념이 없어 동기화하지 않는다. 리마인더는 계속
  `scheduleAt`(시작)만 due로 미러 → **reminder 불변조건 무변경**.
- durationMin은 **시각지정(`hasTime`) 이벤트에만** 의미. 종일(00:00)·멀티데이는 범위 밖.

## 결과 — 트레이드오프, 다시 볼 조건

- 장점: 마이그레이션·version 범프 없이 타임블로킹 가능. 구/신버전 상호 안전. 리마인더 로직 무영향.
- 트레이드오프: version(=1)이 스키마 실제 형태와 1:1로 안 맞는다. 단 이 저장소는 version을 "마이그레이션
  트리거"로만 쓰고 "형태 버전"으로 쓰지 않는다(deserialize가 version 미검사). 미래에 진짜 breaking 변경이
  오면 그때 version=2 + 마이그레이션을 도입한다.
- 다시 볼 조건: store 뮤테이션이 노드를 화이트리스트로 재구성해 durationMin을 떨어뜨리면 라운드트립 보존이
  깨진다 — 구현 시 확인. 구버전 앱은 duration을 못 읽어 점 이벤트로 표시(graceful degradation).
- 기각한 대안: (a) version=2 + 마이그레이션 — 실행할 변환이 없어 불필요한 의식. (b) `scheduleAt`을
  `[start,end]` 범위로 변경 — 기존 필드 의미 breaking → version 범프 필요, 과함. (c) 별도 사이드카 파일 —
  노드 응집성·note↔node 안정 키 패턴과 불일치.
