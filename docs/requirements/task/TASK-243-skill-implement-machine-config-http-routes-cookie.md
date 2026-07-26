---
id: TASK-243
type: task
role: plan
title: "[Skill:implement] machine-config HTTP routes (cookie-only)"
status: archived
priority: high
phase: "Phase 1: Foundation + machine backend"
created: 2026-07-22
updated: 2026-07-22
tags: []
parent: PLAN-059
plan: PLAN-059
links:
  - {id: TASK-242, type: blocks}
---
Estimate: M
Approach: mirror SPEC-062 config-routes (GET /api/config cookie-or-bearer, PATCH /api/dashboard/config cookie-only + If-Match) for the machine scope; wire GlobalConfigService from T2.
Source: SPEC-064 D6; packages/lore/src/adapters/http/config-routes.ts (the SPEC-062 pattern), routes.ts (registration)
Dimensions: D-FUNC, D-CODE
Covers: AC-064-4

Add machine-config HTTP routes: GET (read, redacted, cookie or bearer) + PATCH machine config (cookie-ONLY — bearer → 403; If-Match required, missing If-Match → 400, mirroring SPEC-062's stricter-than-doc-PATCH stance because config governs corpus/machine-wide behaviour). CSRF-Origin inherited from the dashboard route group. Register in routes.ts. Route paths distinct from the team-config routes (e.g. /api/config/machine + /api/dashboard/config/machine, or a scope query param — pick one, document it). Depends on T2's GlobalConfigService.

AC:
- The machine PATCH route returns 403 for a bearer token with no cookie and writes 0 bytes; a stale If-Match returns 409 with the current hash; a missing If-Match returns 400 (covered by extending the config-routes test suite).
- Covers AC-064-4 (route-half): bunx vitest run packages/lore/tests/unit/adapters/http/config-routes.test.ts
