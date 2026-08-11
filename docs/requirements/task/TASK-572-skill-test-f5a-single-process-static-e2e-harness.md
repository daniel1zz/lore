---
id: TASK-572
type: task
role: plan
title: "[Skill:test] F5a single-process static e2e harness"
status: archived
priority: critical
phase: "Phase 4: E2E & docs"
created: 2026-07-28
updated: 2026-07-28
tags: []
parent: PLAN-112
plan: PLAN-112
links:
  - {id: TASK-578, type: blocks}
---
Estimate: M
Approach: New pair packages/dashboard/tests/e2e/playwright.static.config.ts + global-setup-static.ts: build binary path (reuse digest short-circuit), spawn packaged server against mkdtemp throwaway corpus (repo-corpus write ban), parse nonce URL from stdout handshake, baseURL http://localhost:8787, workers 1, reuse assertPortFree/assertServerIsOurs. Specs: (a) "packaged serve" — GET / 200 HTML + hashed asset immutable + /api/health dashboard stamp + NO vite process (process-list assert); (b) "nonce" — 302+Set-Cookie then 410 replay, authenticated /api read; (c) "allowlist|freshness" — origin behavior + served stamp digest equals freshly computed digest (stale bundle fails, never passes). npm script test:e2e:static in packages/dashboard/package.json; CI wiring note in config comment (serial with existing e2e job).
Source: spec DD-6 + AC-F5A-1/2/8 + existing global-setup.ts patterns
Dimensions: D-FUNC, D-E2E
Scope-Alt: process-list no-vite assert may reduce to port-5173-unbound assert if process enumeration is flaky cross-platform
Covers: AC-F5A-1, AC-F5A-2, AC-F5A-8

AC:
- Given a built checkout, When `bun run --filter '@lore/dashboard' test:e2e:static` (or cd + bunx playwright test --config) runs, Then all three spec groups pass with matched test-count > 0 — exact commands MUST equal the spec AC commands (AC-F5A-1/2/8) so lore verify attests them unchanged.
- Given the existing two-process e2e config, When it runs after this task, Then it still passes (no shared-fixture contamination).
- Integration: the new config is invocable via the named npm script (not only by absolute path) — a cold-start operator can run it from the repo README-level commands.
