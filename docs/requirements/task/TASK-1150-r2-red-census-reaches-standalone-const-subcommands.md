---
id: TASK-1150
type: task
role: plan
title: "R2 RED census reaches standalone-const subcommands and refuses unresolved imports"
status: archived
priority: medium
phase: "P4-Remediate"
created: 2026-10-09
updated: 2026-10-09
tags: []
parent: PLAN-176
plan: PLAN-176
links:
  - {id: TASK-1151, type: blocks}
---
Tester in a worktree adds failing cases to site-census-fidelity.test.ts: (1) a command whose subcommand run sits on a standalone const (pattern of uat.ts:122, eval.ts:406, sync.ts:492-497, agent.ts:171-175) yields that subcommand sites; (2) a subcommand-only command (issue) resolves; (3) when a cross-package import cannot be resolved (no node_modules), the census reports not measured instead of silently dropping sites. Record expected-fail on the spot. Typecheck stays clean (dynamic imports). Estimate: M
