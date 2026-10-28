---
id: TASK-1999
type: task
role: plan
title: "A claim ends with its run: claim conflict and release read the holder run's state (#457)"
status: approved
priority: high
phase: "P3 Callers"
created: 2026-10-26
updated: 2026-10-27
tags: []
parent: PLAN-253
plan: PLAN-253
links:
  - {id: TASK-2003, type: blocks}
---
Covers: AC-RV-10
Resolves: #457 (a claim held by an ended run blocks re-claim until its lease expires).

Mechanism, restated against main 9bb6b4f9:
- `resolveEffectiveClaimStaleness` (task-workflow-service.ts:1056-1086) already reads the holder run's end (`getRunEnd`). It calls core `isClaimStaleForRun` (packages/core/src/task-workflow.ts:1032-1040), which counts an ended run's claim as stale only when its worktree is MEASURED clean (BR-1057).
- Gap (a): when the worktree is gone or cannot be read, `measureWorktreeCleanliness` (task-workflow-service.ts:2260) returns `not-measured-*`. Cleanliness is then `null`, and the claim falls back to the lease TTL (:1075-1083). This is the case in #457: the harness had already removed the subagents' worktrees.
- Gap (b): `release()` builds the holder with `buildClaimHolder(existingClaim, false)` (:3676) and never consults staleness, so the ended run's own session, or another run, cannot release without --force.

Fix, inside AC-RV-10 (no spec change to its statement):
1. `measureWorktreeCleanliness` gains the status `not-measured-gone`: the recorded path does not exist, or is not a directory (statSync). A path that exists but is unreadable stays `not-measured-not-a-repo`, which is still unmeasurable.
2. `ClaimRunLiveness` gains `worktreeGone: boolean`. It is true for `not-measured-gone`, and for a claim that recorded no worktree (a no-branch claim has nothing to protect). Core `isClaimStaleForRun` becomes:
   - orphaned_dirty claim: stale iff `worktreeClean === true || worktreeGone === true` (the dirty work is gone with its directory);
   - otherwise: `if (liveness.runEnded && (liveness.worktreeClean === true || liveness.worktreeGone === true)) return true;` This literal appears verbatim once and is this task's falsifier.
   BR-1057 is kept: an ended run's worktree that still exists and is dirty, or exists but is unreadable, stays protected (not stale).
3. `release()` uses the same effective staleness: `buildClaimHolder(existingClaim, stale)`, with stale from `resolveEffectiveClaimStaleness`. A stale holder (ended run, clean or gone worktree) can be released by any run without --force. The history names the ended holder run, in the same shape as a stale takeover. A fresh live holder still needs --force, and a claim refused by conflict exits 5.
4. Output: a claim or release that takes over an ended run's claim names that run as ended (AC-RV-10).
5. Legacy runs without a harness pid that never ended keep the normal lease. The 81 unended legacy test runs are ended by plan-evaluation-1's repair, not here.

Falsifier note: AC-RV-10's STORED falsifier literal in the approved spec is still `if (holderRun?.ended_at != null) return staleBecauseRunEnded(`. That literal would override BR-1057, so this task must not write it. Correcting the stored falsifier to the literal in step 2 (path packages/core/src/task-workflow.ts, replacement `if (liveness.runEnded && liveness.worktreeClean === true) return true;`, exit 1: the gone-worktree case goes red) is a spec-level audited correction (`lore ac set ... --correction`). It is left to the spec owner and must be done before `lore verify` attests AC-RV-10.

Test design (claim-of-ended-run.bun.test.ts), all within one lease TTL:
- R ends with its worktree removed: another run claims without --steal (exit 0, R named as ended).
- R ends with its worktree removed: R's session releases without --force (exit 0).
- R ends with a dirty worktree still present: still protected; a claim exits 5.
- A live R: a claim exits 5.

Branching: lands ON ITS OWN, not on integration/run-identity-418; plan I5 does not apply. This change reads `runs.ended_at` and worktree facts, which exist on main today. It touches none of the carrier, verification, flag or helper files that I5 chains (its anchors are task-workflow-service.ts, core task-workflow.ts and its own test). Its test registers runs through the current test helpers; if it passes --harness-run, the move-hook task's residual grep covers it when the chain lands.
Ordering: plan 356's close blocks this plan's red task; task-workflow-service.ts was also anchored by plan 356's archived tasks.
