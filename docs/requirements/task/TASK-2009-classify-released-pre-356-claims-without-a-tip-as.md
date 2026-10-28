---
id: TASK-2009
type: task
role: plan
title: "Classify released pre-#356 claims without a tip as unrecoverable once; landing measures only measurable claims (resolves #473)"
status: archived
priority: critical
phase: "P1 Fix"
created: 2026-10-26
updated: 2026-10-26
tags: []
parent: PLAN-251
plan: PLAN-251
links:
  - {id: TASK-2004, type: blocks}
---
Covers: AC-UC-1
Resolves: #473
TDD-Role: red then green. Write landing-unrecoverable-claims.bun.test.ts first (cases a-d of AC-UC-1, throwaway corpus + git repo, never the repo's .lore/), capture it red, then implement.
Approach: migration-040.ts runs in the store migration chain under the write lock, like migration-039.ts, but reads NO git: it selects released claims that named a branch and hold neither start_head nor end_tip (selection literal claim.start_head === undefined && claim.end_tip === undefined && claim.branch !== undefined && isReleased(claim)), marks each unrecoverable with the literal reason: "released before tips were recorded" (falsifier) and one claim-unrecoverable audit entry; idempotent; no refusal path (it must never block later store use, including a Turso replica with no checkout). Register it in sqlite-store.ts, turso-store.ts and schema-version.ts (take the next free number at rebase; the evaluation plans also add migrations). measureLanding filters candidates with the literal '.filter((claim) => claim.unrecoverable === undefined)' (falsifier) and lists unrecoverable claims with their count; for each unrecoverable claim it checks the branch ref: gone or tip reachable from main -> excluded, tip NOT reachable from main -> exit 4 [floor: not-landed] unrecoverable-claim-branch-unlanded naming the branch (literal if (ref !== undefined && !ref.reachableFromMain) return notLanded("unrecoverable-claim-branch-unlanded"), AC-UC-1 (f)); no measurable claim left means exit 4 [floor: not-landed] no-measurable-claim. A claim under the current schema always has start_head (task-workflow.ts:850-853), so it is never selected and a tipless one still refuses unmeasurable.
Close steps (orchestrator): lore verify plan-unrecoverable-pre-356-claims-classified-once-473; lore rule apply spec-claims-released-before-tips-were-recorded-are-classified (BR-1423 rewritten); lore done this task; then task-close-plan-356-verify-apply-rules-close-the-four resumes step 3.
