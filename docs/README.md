# MindMap 문서 체계

> 원칙: **어떤 결정이 어디에 적히는지 모두가 안다.** 문서가 많은 것보다 찾을 수 있는 것이 중요하다.

## 폴더 구조

| 폴더 | 무엇이 들어가나 | 대표 문서 |
|---|---|---|
| `product/` | 제품 정의, 기능 명세(인벤토리), 신규 기능 스펙, 리서치 | [PRODUCT-DEFINITION.md](product/PRODUCT-DEFINITION.md), [FEATURE-INVENTORY.md](product/FEATURE-INVENTORY.md) |
| `design/` | 디자인 시스템, 색상 체계, 디자인 철학 | [COLOR-SYSTEM.md](design/COLOR-SYSTEM.md), [DESIGN-notion.md](design/DESIGN-notion.md) |
| `decisions/` | "왜 이렇게 했나" 결정 기록 (경량 ADR) | [decisions/README.md](decisions/README.md) |
| `release/` | 릴리즈 프로세스, QA 체크리스트, 버전별 릴리즈 노트 | [RELEASE-PROCESS.md](release/RELEASE-PROCESS.md) |

루트의 `design-reference/`는 외부 디자인 시스템 벤치마킹 자료(75개)로, `design/` 문서의 참고 출처다.

## 운영 규칙 (2가지만 강제)

1. **새 기능은 명세 1페이지 없이 개발을 시작하지 않는다.**
   거창한 PRD가 아니라 `product/TEMPLATE-feature-spec.md`의 4개 항목(문제 / 해결 / 범위에서 뺀 것 / 완료 기준)이면 충분하다. 작성한 명세는 `product/specs/`에 둔다.
2. **번복 가능성이 있는 결정은 `decisions/`에 3줄이라도 남긴다.**
   "이거 왜 이렇게 했더라"를 재논의하는 시간이 팀이 가장 많이 잃는 시간이다.

## 문서 갱신 책임

- 기능이 바뀌면 같은 PR에서 `FEATURE-INVENTORY.md`의 해당 절을 갱신한다.
- 릴리즈마다 `release/` 아래에 릴리즈 노트를 남긴다 (프로세스는 RELEASE-PROCESS.md 참고).

전체 계획과 배경은 [product/OPERATING-PLAN.md](product/OPERATING-PLAN.md) 참고.
