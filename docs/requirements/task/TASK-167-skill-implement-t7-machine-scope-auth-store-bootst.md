---
id: TASK-167
type: task
role: plan
title: "[Skill:implement] T7 machine-scope auth store + bootstrap re-point (D1 unconditional)"
status: archived
priority: high
phase: "Phase 2: Server wave"
created: 2026-07-25
updated: 2026-07-25
tags: []
parent: PLAN-038
plan: PLAN-038
links:
  - {id: TASK-166, type: blocks}
---
Estimate: M
Approach: Machine-scope SQLite (reuse SessionStore/ApiKeyStore classes over a new Database handle at XDG state dir, 0600 via chmod after create); re-point handleLocalBootstrap + ensureLocalApiKey + authenticateRequest cookie branch to the machine stores UNCONDITIONALLY (both modes, D1); bearer branch keeps per-corpus app.apiKeyStore. Files: adapters/http/auth.ts, sessions.ts, dashboard-routes.ts (bootstrap), cli/commands/dashboard.ts, app.ts (only if the App type needs the machine handle threaded — prefer passing stores to startHttpServer options instead).
Source: spec-078 D1 (unanimous); resolveGlobalConfigPath XDG precedent (app.ts:646-653); T6 RED tests.
Dimensions: D-FUNC, D-CODE
Scope-Alt: 0600 enforcement on non-POSIX platforms degrades to best-effort with a stderr note.
Covers: AC-078-4

AC:
- Given T6's RED suite, When implementation lands, Then tests/unit/http/machine-auth.bun.test.ts GREEN, all cases matched.
- Given registry-less mode e2e login flow, When run, Then it passes unchanged (same routes, same cookie semantics) — observable R-15 behavior.
- Integration: `lore dashboard` in the lore repo boots, login works, corpus-DB sessions table is no longer written for new logins (vestigial rows tolerated).
