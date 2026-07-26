---
id: TASK-197
type: task
role: plan
title: "Fix pre-existing dashboard e2e regression: browse-ux spec-seed blocked by spec-create gate, review-loop home render"
status: archived
priority: medium
created: 2026-07-24
updated: 2026-07-24
tags: []
parent: PRD-001
---
Estimate: M
Two dashboard e2e tests fail on main, PRE-DATING SPEC-072/073/074 (bisect-verified at a6d2afa, 2026-07-24): (1) browse-ux.pw.ts breadcrumb seed — POST /api/dashboard/docs type=spec with NO content is denied by the service-layer spec-create gate (MISSING_SKELETON; PRD create succeeds, spec create 4xx at browse-ux.pw.ts:84). (2) review-loop.pw.ts:112 home PRD-title toBeVisible fails (possibly same seed-class root cause — verify independently). Suspect window: SPEC-069 attestationFloor merge or gate-skeleton predicate tightening. Fix direction: e2e seeds must create GATE-CONFORMANT specs (content with Overview/Scope/Acceptance Criteria headings) — the gate is correct, the fixtures are stale.
AC:
- cd packages/dashboard && bunx playwright test tests/e2e/browse-ux.pw.ts exits 0 (all tests, no skip cascade).
- cd packages/dashboard && bunx playwright test tests/e2e/review-loop.pw.ts exits 0.
- Full dashboard suite exit 0.
