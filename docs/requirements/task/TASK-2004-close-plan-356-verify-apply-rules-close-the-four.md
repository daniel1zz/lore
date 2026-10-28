---
id: TASK-2004
type: task
role: plan
title: "Close plan 356: verify, apply rules, close the four commitless evaluation experiments"
status: archived
priority: high
phase: "P3 Wiring and close"
created: 2026-10-26
updated: 2026-10-26
tags: []
parent: PLAN-250
plan: PLAN-250
links:
  - {id: TASK-1975, type: blocks}
  - {id: TASK-2000, type: blocks}
---
Covers: none (orchestrator close; AC-ND-1..8 attested by lore verify)
Steps (after the wiring task lands and bun run build has run on main):
1. lore verify plan-no-change-landing-for-commitless-tasks-356.
2. lore rule apply spec-lore-done-closes-a-commitless-task-through-an-audited-no (BR-1423 live; BR-1291, BR-159, BR-1179 rewritten).
3. Close the four read-only experiments of plan-evaluation-1. This is the authoritative closing route: their bodies are locked records (they hold evidence), so the route recorded there ('lore evidence ... then lore done, attestation floor route 2') is superseded by this step and cannot be edited in place. For each task:
   a. lore get <task> --json and confirm verification_evidence holds a runner-attested pass with attestation.worktree_dirty false and a head_sha reachable from main. On 2026-10-26: the ai-decision-labels, delivery-and-concurrency and overhead-cost tasks each have one clean pass at e5c9a8c3 (main). The honesty task's only pass was captured DIRTY at e5c9a8c3: re-claim it from a clean checkout, re-run the same capture command with --capture, then lore release.
   b. lore done <task> --declare-no-new-tests "read-only experiment; findings recorded in the plan's experiment record". The landing is derived as no-change; no integrate record is needed. Tasks: task-experiment-honesty-of-the-evaluation-data-o1-s1-o1-s2-o1-s3, task-experiment-ai-decision-labels-auc-and-audit-cost-o2-s1-o2, task-experiment-delivery-and-concurrency-measures-o3-s1-o4-s1, task-experiment-overhead-cost-reuse-and-safety-sources-o5-o6-o7.
   c. A refusal is reported with its floor name and fixed, never bypassed with lore bulk deprecate.
4. lore ready plan-evaluation-1-experiments-and-honest-metric-envelope --json: report counts.ready. The four implementation tasks the experiments block become ready, but claiming them still requires the revised S-A spec approved: the task-claim gate refuses claims under an unapproved spec (UPSTREAM_NOT_APPROVED), so no extra link is needed for that precondition.
5. lore anchor add the spec packages/core/src/landing.ts#landingOf and the two test files; lore assess.

## Must resolve before evidence

Gap left by the wiring task: lore claim --worktree <path> where the worktree has no readable branch (detached HEAD, or an unreadable ref) still claims, so it never gets a start_head check.
Decision (2026-10-26): REFUSE it. Such a claim exits 4 (worktree-without-branch), nothing written, naming the fix: check out a branch in that worktree, or claim without --worktree when the task anchors no file (corpus-only, BR-1468). Implement it in the claim path of task-workflow-service.ts with one AC case (exit 4 exactly, no claim written) before this plan closes; it cannot measure start_head, so admitting it would be a silent path. Rejected option: record it as a follow-up issue, which leaves that silent path open in the meantime. A detached verification worktree used for corpus-only work (#304) claims without --worktree instead.
When it lands: record it in the spec as an audited correction to BR-1468 (lore rule propose ... amend --correction) and its D-table.
