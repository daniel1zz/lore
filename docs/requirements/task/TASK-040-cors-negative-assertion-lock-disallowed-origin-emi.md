---
id: TASK-040
type: task
role: plan
title: "CORS negative assertion lock: disallowed origin emits no allow-origin header (AC-DH-13)"
status: archived
priority: medium
phase: hardening
created: 2026-07-03
updated: 2026-07-03
tags: [spec-027, round-2, test]
parent: PLAN-008
plan: PLAN-008
links:
  - {id: TASK-037, type: blocks}
---
Test-only. packages/lore/tests/unit/adapters/http/cors.bun.test.ts: explicit assertions that non-allowlisted Origin yields NO Access-Control-Allow-Origin header (not *, not echo) on read and write surfaces incl. preflight.
