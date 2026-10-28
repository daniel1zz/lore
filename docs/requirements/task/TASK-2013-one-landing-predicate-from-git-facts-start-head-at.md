---
id: TASK-2013
type: task
role: plan
title: "One landing predicate from git facts: start_head at claim, evidence counting, floors, oracle files in main"
status: archived
priority: critical
phase: "P2 Landing predicate"
created: 2026-10-26
updated: 2026-10-26
tags: []
parent: PLAN-250
plan: PLAN-250
links:
  - {id: TASK-2011, type: blocks}
  - {id: TASK-2107, type: blocks}
---
Covers: AC-ND-1, AC-ND-2, AC-ND-3, AC-ND-4, AC-ND-5, AC-ND-6, AC-ND-9, AC-ND-10
Resolves: #304 (evidence and done share one predicate; a no-working-copy claim records from the shared checkout), #329 (oracle files resolved in main's tree).
Approach: spec End state 1-7 and Public interface; every falsifier literal verbatim once. landingOf is pure in @lore/core and takes a GitFacts port; real-git-port.ts implements it (the one adapter TaskWorkflowService may import). Claim: a task with file anchors is refused a claim without --worktree (literal refuseClaim("work-needs-branch"), BR-1468); a branch claim uses its base_sha as start_head; every evidence capture on a branch claim records end_tip (literal recordClaimTip(claim, attestation.head_sha)), and release and endRunClaims record it again; the newest wins, so a branch removed by the harness without any release still has its tip. Evidence: only rows after the latest claim count (afterLatestClaim); a no-branch claim records main_head in the attestation and its pass counts only as evidence recorded at main's head, with the task's own anchored files clean (head_sha == main_head), with no dirty check of the shared checkout. Tip: ref tip, else newest recorded end_tip, else unmeasurable (never start_head or an evidence head). Reachability relies on integrate's merge-commit landing (BR-1245), asserted by AC-ND-6. The not-landed and missing-oracle-file floors call landingOf / existsInTree; done writes extra.landing in the CAS-guarded first archive step. Scoped-oracle floor: every importer of task-workflow.ts and task-workflow-service.ts.

## Must resolve before evidence

Two review findings stayed open when the spec was approved with an audited override. Decide each before recording any evidence on this task. When the task lands, record each decision in the spec (a corrective rule change through lore rule propose, then a re-review).
1. BR-199's counting condition "captured on a clean worktree" duplicates BR-159, which already refuses to record a pass while the claimed worktree is dirty. Keep exactly one of the two, and state which one and why.
2. The clause "the task's own anchored files clean" is vacuous for no-branch claims: BR-1468 allows a no-branch claim only for a task with no anchors, so the landedWithoutBranch falsifier proves nothing. Either drop the clause, or replace it with a check that can actually fail (for example, a no-branch pass whose head_sha differs from main_head).
