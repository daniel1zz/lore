---
id: TASK-1236
type: task
role: plan
title: "[Skill:implement] Claim-scoped corpus intent on the lease (fixes #39)"
status: archived
priority: critical
phase: "Phase 1: Write paths"
created: 2026-10-08
updated: 2026-10-25
tags: []
parent: PLAN-178
plan: PLAN-178
links:
  - {id: TASK-1233, type: blocks}
  - {id: TASK-1231, type: blocks}
  - {id: TASK-1217, type: blocks}
  - {id: TASK-1216, type: blocks}
---
Estimate: L
Approach: widen the existing lease-fact intent in ForeignCorpusWriteGuard: lore claim --worktree <wt> --corpus-scope <baseline-branch> stores the scope as a new optional field of the claim object at task.extra.claim (core taskClaimSchema in packages/core/src/task-workflow.ts; no store column, no migration); the MCP claim tool accepts the same field; baseline/rule/ac-cite/baseline-map writes from a worktree consult the holder's lease and allow only docs under that branch (resolved through baseline parent chain); every write carries the claim's actor/session/worktree
Source: spec C8; foreign-corpus-write-guard.ts header (intent is a lease fact); cost/dx/ops reviews
Covers: AC-BLS2-8
AC:
- Before editing: record expected-fail of AC-BLS2-8's command on THIS task
- cd packages/lore && bun test tests/integration/cli/corpus-scope-lease.bun.test.ts passes
- Existing foreign-corpus-write guard tests stay green (scoped oracle incl. every importer of foreign-corpus-write-guard.ts)
- Issue #39 referenced in the commit message
