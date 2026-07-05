.PHONY: setup dev build test typecheck verify verify-full dist harness-check e2e smoke bump

# Install dependencies
setup:
	npm ci

# Start development server (Electron + Vite hot-reload)
dev:
	npm run dev

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

# Harness structure checks (architecture + doc integrity)
harness-check:
	node scripts/harness/check-architecture.mjs && node scripts/harness/check-docs.mjs

# Full release build (build + sign + notarize + verify artifact)
dist:
	npm run dist

# E2E 테스트 (빌드 → Playwright 실행)
e2e:
	npm run test:e2e

# 핵심 화면 스크린샷 (빌드 → 앱 실행 → 5개 화면 캡처 → /tmp/smoke/)
smoke:
	npm run build && node scripts/smoke.mjs

# 버전 범프: make bump version=X.Y.Z
bump:
	@[ "$(version)" ] || { echo "Usage: make bump version=X.Y.Z"; exit 1; }
	node scripts/bump-version.mjs $(version)
