---
id: TASK-171
type: task
role: plan
title: "[Skill:test] T6 machine-auth RED scenarios"
status: archived
priority: high
phase: "Phase 2: Server wave"
created: 2026-07-25
updated: 2026-07-25
tags: []
parent: PLAN-038
plan: PLAN-038
links:
  - {id: TASK-167, type: blocks}
---
Estimate: S
Source: AC of task t7 (machine auth store); spec-078 D1 + AC-078-4.
TDD-Role: red | Paired-Impl: T7 machine auth + bootstrap re-point
Dimensions: D-FUNC

Scenarios:
- Given no machine auth DB exists, When the auth store initializes, Then dashboard-auth.db is created with file mode 0600 at the XDG state path.
- Given a session minted via the machine store, When a cookie-authenticated request hits registry-less mode AND multi-project mode, Then both authenticate against the SAME store instance (one code path).
- Given logout, When any project's cookie-gated route is called, Then 401 on all projects.
- Given a bearer API key in a corpus DB, When lore serve authenticates it, Then per-corpus ApiKeyStore still answers (bearer path untouched).

AC:
- Scenarios as executable bun tests in packages/lore/tests/unit/http/machine-auth.bun.test.ts; all RED; failure = missing implementation.
