# 결정 기록 (Decisions)

"왜 이렇게 했더라"를 재논의하지 않기 위한 경량 기록. **번복 가능성이 있는 결정이면 3줄이라도 남긴다.**

## 형식

파일명: `NNNN-kebab-case-제목.md` (번호는 순번)

```markdown
# NNNN. 결정 제목

날짜: YYYY-MM-DD · 상태: 채택 | 대체됨(→NNNN) | 폐기

## 맥락 — 어떤 문제/선택지가 있었나 (2~3줄)
## 결정 — 무엇을 택했나
## 결과 — 감수한 트레이드오프, 다시 볼 조건
```

## 목록

- [0001 — 노드 색은 hex가 아닌 시맨틱 키로 저장](0001-semantic-color-keys.md)
- [0002 — 리마인더 AppleScript 호출 직렬화 + 본문 태그 소유권](0002-reminder-osascript-serialization.md)
- [0003 — 노트는 독립 Markdown 파일 + 명시적 노드 링크](0003-notes-as-standalone-files.md)
- [0004 — 진입점 매트릭스 채택 + 우클릭 메뉴 그룹 구분선](0004-entrypoint-matrix.md)
- [0005 — 복사 의미론: 내용은 전부, 미리알림 연동 정체성은 제외](0005-copy-semantics.md)
- [0006 — 집중 세션 도입 + "이 노드만 보기" 개명](0006-focus-session-and-rename.md)
- [0007 — 집중/대시보드의 위치: "사적인 거울 + 의도된 보고서"](0007-focus-positioning.md)
- [0008 — 집중 세션: 목표·과정·결과를 프로세스에서 구조화 포착 (노트 템플릿 폐기)](0008-focus-goal-process-result.md)
- [0009 — 노드에서 만든 노트는 그 노드 맵과 같은 폴더에 (숨김 .notes/ 폐기)](0009-node-note-location.md)
- [0010 — 노트 이미지 첨부 폴더를 진짜 숨김 폴더로 (`notename.assets/` → `.notename.assets/`)](0010-note-image-assets-hidden-folder.md)
- [0011 — 기능의 3가지 축: 정리·실행·통찰 (0007 G3 보강)](0011-three-axis-thinking-model.md)
- [0012 — 노드 지속시간 필드(durationMin) — version 범프 없는 선택 필드](0012-node-duration-field.md)
- [0013 — 온보딩(첫 실행 코치)은 기능이 안정된 뒤에 도입한다](0013-onboarding-after-features-stable.md)
- [0014 — 완료·일정·집중은 할 일(todo) 노드 전용 (0011 §4 실행 그룹 개정)](0014-todo-node.md)
- [0015 — 집중 게이트 해제 — 일정과 집중은 독립 기능 (0011 §3 완화)](0015-focus-independent-of-schedule.md)
