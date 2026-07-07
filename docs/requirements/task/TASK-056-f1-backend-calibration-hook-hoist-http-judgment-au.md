---
id: TASK-056
type: task
role: plan
title: "F1 backend: calibration-hook hoist + HTTP judgment/audit/calibration routes + dashboard api client"
status: archived
priority: high
created: 2026-07-06
updated: 2026-07-06
tags: []
parent: PLAN-013
plan: PLAN-013
---
SPEC-033 §2.1/§2.3-routes/§3. Hoist adapters/cli/calibration-hook.ts → src/flows/calibration-hook.ts (surface-neutral; CLI imports update; behavior identical — REGRESSION tests must stay green unmodified except import paths). Wire into HTTP dashboard approve/reject write routes (routes.ts SPEC-022 section): after ReviewService ok → hook; failure → warnings[] in response envelope, never 5xx; optional calibration_note in request body. Check MCP tools for any adjudication tool (lore approve equivalents) — if present wire same hook, if absent note it. New read routes: GET /api/judgments/:docId (latest + list), GET /api/audit/:docId, GET /api/audit/verify, GET /api/calibration/stats — cookie-auth for /api/dashboard/* parity, follow routes.ts auth patterns exactly. Add typed fetchers + response types to packages/dashboard/src api layer (single-writer contract — find the existing api client file). Tests: hoisted-hook unit (import from new path), route tests (mirroring routes.test.ts patterns incl. 401), calibration-capture-via-HTTP end-to-end (bun.test w/ SQLiteStore, seed judgment via store, POST approve, assert calibration row + warnings[] on forced failure). Anchors: src/flows/(new), adapters/cli/approve.ts+reject.ts (imports), adapters/http/routes.ts, packages/dashboard/src/lib or api dir, tests.
