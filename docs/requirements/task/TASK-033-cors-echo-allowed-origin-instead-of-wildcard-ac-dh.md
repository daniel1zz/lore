---
id: TASK-033
type: task
role: plan
title: "CORS: echo allowed Origin instead of wildcard (AC-DH-5)"
status: archived
priority: medium
phase: hardening
created: 2026-07-03
updated: 2026-07-03
tags: [spec-027, security]
parent: PLAN-006
plan: PLAN-006
links:
  - {id: TASK-029, type: blocks}
---
packages/lore/src/adapters/http/middleware.ts:73-83 — match request Origin against ALLOWED_ORIGINS (auth.ts:77-82), echo the specific origin (+Vary: Origin) or omit the header; never * on write surfaces. Add tests for allowed vs disallowed origin; existing http tests must stay green. Oracles: typecheck + vitest + bun test.
