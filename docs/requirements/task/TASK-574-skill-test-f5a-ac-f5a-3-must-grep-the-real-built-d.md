---
id: TASK-574
type: task
role: plan
title: "[Skill:test] F5a AC-F5A-3 must grep the REAL built dist, not only a fixture manifest"
status: archived
priority: high
phase: "Phase 4: E2E & docs"
created: 2026-07-28
updated: 2026-07-28
tags: []
parent: PLAN-112
plan: PLAN-112
---
## Overview

`lore assess` on plan-implementation-dashboard-production-packaging-f5a-one found:
"AC-F5A-3 names two oracles (grep over packages/dashboard/dist and a curl of GET /).
Only the bun integration test using a fixture manifest is evidenced; no run greps the
actual built bundle, so 'built artifact is secret-free' rests on a fixture, not the
shipped dist."

## Goal

Add a real-artifact secret-free assertion to
`packages/dashboard/tests/e2e/static-serving.static.ts`, inside the existing
"packaged serve" describe group (name unchanged — AC-F5A-1's `-g` filter depends on it).
The new case walks the REAL `packages/dashboard/dist/**` produced by the harness's own
`bun run build`, plus the live server's `GET /` and a deep SPA-fallback route, asserting
no injected bootstrap-token mechanism and no local-key-shaped material — and proves the
matcher is not vacuous via a negative control against a throwaway copy of dist (never
the real dist directory).

## Scope

In: `packages/dashboard/tests/e2e/static-serving.static.ts` only.
Out: production code, other test files.

## Acceptance Criteria

- `cd packages/dashboard && bunx playwright test --config=tests/e2e/playwright.static.config.ts -g "packaged serve"` exits 0, matched count 5.
- Full static config exits 0, all tests pass.
- `bun run typecheck` exits 0.
- Negative control demonstrably fails when fed a synthetic secret (proven via a temporary fail-first break-and-revert of the matcher regexes).
