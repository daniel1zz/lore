---
id: TASK-585
type: task
role: plan
title: "[Skill:implement] F5a static serving, nonce endpoint and allowlist threading"
status: archived
priority: critical
phase: "Phase 2: HTTP serving & auth"
created: 2026-07-28
updated: 2026-07-28
tags: []
parent: PLAN-112
plan: PLAN-112
links:
  - {id: TASK-581, type: blocks}
---
Estimate: M
Size-Risk: audited as 4-concern bundle kept atomic (shared index.ts anchor makes splitting churn-negative) — implementer MUST commit per concern (static-serving / nonce / allowlist / degradation) inside the worktree, not one squash at the end.
Approach: New module packages/lore/src/adapters/http/static-serving.ts consuming dashboard-assets-loader (DI seam for tests: accept a manifest provider). Dispatch order in index.ts fetch handler per DD-4: existing /api/* (incl. /api/p/:name/*) → /auth/bootstrap nonce endpoint → exact static matches → GET SPA fallback (non-/api only). Nonce store: in-memory Map, crypto.randomUUID-grade randomness, single-use, 60s TTL, mint API exported for the CLI; endpoint validates Sec-Fetch-Site/Mode when present (navigate/none), consumes, mints lore_sid via existing machine-scope sessionStore.create with identical cookie attributes to handleLocalBootstrap, 302 → /. Allowlist: thread HttpConfig.allowedOrigins from actual ports via buildAllowedOrigins (packaged: api origin only; dev adds real --dashboard-port). Guard every machine-auth touch: static pages never 500 on store failure; nonce endpoint answers 503 with actionable message.
Source: spec DD-2/DD-3/DD-4 + existing routes.ts handleLocalBootstrap + auth.ts buildAllowedOrigins
Dimensions: D-FUNC, D-SEC
Scope-Alt: Sec-Fetch guard may degrade to Origin-absent-tolerant navigation check if header absence in target browsers proves noisy — recorded as evidence note if taken
Covers: AC-F5A-3, AC-F5A-4, AC-F5A-7

AC:
- Given the paired RED integration suite, When run after implementation, Then all scenarios GREEN with matched-count > 0 (route priority, secret-free, nonce lifecycle, degradation).
- Given existing two-runner suites, When bun run test:changed <base> runs in the worktree, Then no regression in touched-file reverse-deps.
- Integration: the module is registered in index.ts dispatch (no orphan module) — a served GET / through startHttpServer with a fixture manifest returns index.html, proving reachability end-to-end, not just unit-level.
