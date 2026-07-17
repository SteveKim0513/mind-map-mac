.PHONY: setup dev-safe build test typecheck verify verify-full pre-release dist harness-check e2e e2e-tag verify-feature smoke bump tag release

# Install dependencies
setup:
	npm ci

# Development server — isolated temp userData + workspace (real data untouched)
dev-safe:
	MINDMAP_USER_DATA="$$(mktemp -d)" MINDMAP_WORKSPACE="$$(mktemp -d)" npm run dev

# TypeScript type check (no emit)
typecheck:
	npm run typecheck

# Unit tests (Vitest)
test:
	npm test

# Build production bundle
build:
	npm run build

# Fast verify: typecheck + unit tests (required before every completion claim)
verify:
	npm run typecheck && npm test

# Full verify: typecheck + unit tests + production build
verify-full:
	npm run typecheck && npm test && npm run build

# Pre-release gate: verify-full + E2E — must pass before make bump
# 새 기능·UI 변경이 포함된 릴리즈는 반드시 이 타겟을 통과한 뒤 bump한다.
pre-release:
	npm run typecheck && npm test && npm run build && npm run test:e2e

# Harness structure checks (architecture + doc integrity + design + e2e 태그)
harness-check:
	node scripts/harness/check-architecture.mjs && node scripts/harness/check-docs.mjs && node scripts/harness/check-design.mjs && node scripts/harness/check-e2e-tags.mjs

# Full release build (build + sign + notarize + verify artifact)
dist:
	npm run dist

# E2E 테스트 — 전체 (빌드 → Playwright 실행). 배포 게이트/전체 회귀용.
e2e:
	npm run test:e2e

# E2E 부분 실행 — 도메인 태그로 필터 (빌드 → 해당 태그 spec만, 병렬 → @serial 직렬)
# 사용: make e2e-tag tag=@calendar   (여러 도메인: tag="@calendar|@focus")
# 태그 어휘: @map @calendar @schedule @focus @todo @note @capture @command @nav @view
e2e-tag:
	@[ "$(tag)" ] || { echo 'Usage: make e2e-tag tag=@<domain>  (예: @calendar)'; exit 1; }
	npm run build && node scripts/e2e-run.mjs "$(tag)"

# 기능 단위 검증 — 개발 루프용 계층: typecheck + unit 전체 + 해당 도메인 E2E만.
# 매 기능 완료 시 이것으로 빠르게 검증하고, 배포 지시를 받으면 make pre-release(전체 E2E)로 게이트.
# 사용: make verify-feature tag=@calendar
verify-feature:
	@[ "$(tag)" ] || { echo 'Usage: make verify-feature tag=@<domain>  (예: @calendar)'; exit 1; }
	npm run typecheck && npm test && npm run build && node scripts/e2e-run.mjs "$(tag)"

# 핵심 화면 스크린샷 (빌드 → 앱 실행 → 5개 화면 캡처 → /tmp/smoke/)
smoke:
	npm run build && node scripts/smoke.mjs

# 버전 범프: make bump version=X.Y.Z  (태그 없음 — CHANGELOG 커밋 후 make tag)
bump:
	@[ "$(version)" ] || { echo "Usage: make bump version=X.Y.Z"; exit 1; }
	node scripts/bump-version.mjs $(version)

# 릴리즈 태그 생성 + 푸시: make tag version=X.Y.Z
# CHANGELOG·릴리즈 노트 커밋을 모두 마친 뒤 실행한다 → CI 트리거
tag:
	@[ "$(version)" ] || { echo "Usage: make tag version=X.Y.Z"; exit 1; }
	git tag v$(version)
	git push origin main
	git push origin v$(version)
	@echo "✓ v$(version) 태그 푸시 완료 — CI가 시작됩니다"

# 로컬 릴리즈: 빌드(서명·공증·검증) + GitHub Release 퍼블리시
# CI가 서명 시크릿 문제로 실패할 때 이 Mac에서 직접 배포하는 경로.
# gh CLI가 SteveKim0513 계정으로 활성화돼 있어야 한다.
release:
	APPLE_KEYCHAIN_PROFILE=mindmap-notary npm run dist
	node scripts/publish-release.mjs
