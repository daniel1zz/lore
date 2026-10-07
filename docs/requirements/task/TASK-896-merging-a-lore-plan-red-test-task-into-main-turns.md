---
id: TASK-896
type: task
role: plan
title: "Merging a lore-plan RED test task into main turns bun run typecheck red for every concurrent session until the paired impl lands"
status: draft
priority: medium
created: 2026-10-07
updated: 2026-10-07
tags: []
parent: PRD-001
---
---
{"severity":"medium","category":"workflow-concurrency","tags":[],"reporter_corpus":"~/Projects/zz/lore","reporter_root_prd":"prd-lore-internal-first-ai-team-knowledge-platform","idempotency_key":"928a3462-1f85-4b2d-b3c8-84da18fbcb13"}
---

lore-plan TDD injection pairs a [Skill:test] RED task with its impl. The RED test file imports a module that does not exist yet, so once the RED branch merges into main (required so the impl worktree, built from HEAD, sees the test), tsc reports TS2307/TS7006 for that file and bun run typecheck exits 2 on main. Observed 2026-10-07 in plan-context-fragments-config-driven-layered-rule-injection: three RED files merged produced 10 tsc errors; any concurrent session whose worktree is created from main now fails its typecheck oracle for reasons unrelated to its own change. Nothing in lore-plan/autopilot or the pre-push hook flags this state.

**Expected:** RED tests reach the impl worktree without making main's shared typecheck oracle red (e.g. RED+impl land as one merge, or RED files are excluded from typecheck while marked red-first)
**Actual:** main typecheck exits 2 between the RED merge and the impl merge
**Repro command:** `bun run typecheck (after merging a RED test task whose module is not yet implemented)`

Reported by: agent:main-orchestrator
