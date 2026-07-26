---
id: TASK-198
type: task
role: plan
title: "[T2] VerificationProjectionService + evidence-panel/telemetry HTTP routes"
status: archived
priority: critical
phase: "Phase 1: Implementation"
created: 2026-07-24
updated: 2026-07-24
tags: []
parent: PLAN-042
plan: PLAN-042
links:
  - {id: TASK-196, type: blocks}
---
Implement VerificationProjectionService(store): evidencePanel(idOrSlug) assembling the union via core SSOT fns ONLY (computeAcCoverage, buildTaskAttestationInfos, deriveAttestationSummary — zero local derivation math, AC-075-10). resolvePlanTasks named fn with D9 fail-loud (plan with phase children + zero task children -> VALIDATION_ERROR). Routes: GET /api/evidence-panel/:idOrSlug (cookie OR bearer, SPEC-033 read family) + POST /api/dashboard/telemetry/route-view (cookie-only + Origin allowlist, zod body route_id<=200 + doc_type enum, enabled->1 TelemetryEvent source:dashboard method:route_view, disabled->204 zero writes, sink failure via injectable telemetry param -> 204 + server log). Wire service into app.ts. Tests: vitest via InMemoryStore (AC-075-2/3 titles) + NEW .bun.test.ts HTTP tests (real App+SQLiteStore; tests/http/evidence-panel.bun.test.ts + tests/http/telemetry-route.bun.test.ts covering AC-075-8 server side + AC-075-9 auth matrix; throwing-writer double for the failure branch). Scoped oracles: typecheck + the named test files. Spec: SPEC-075; D1/D3/D4/D8/D9 binding. Depends on T1 (core fns must exist).
