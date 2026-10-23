---
id: KN-756
type: knowledge
role: knowledge
title: "Assessment: Land-recorded archival and one unlanded task per working copy (2026-10-19)"
status: archived
priority: medium
created: 2026-10-19
updated: 2026-10-23
tags: []
parent: PLAN-220
links:
  - {id: PLAN-220, type: informs}
---
# Assessment: met (83/100)

Scope: plan `01M5A1TERBPHM7225NM2SRCRH2`

## AC Scores

| AC | Score | Reasoning | Evidence |
|---|---|---|---|
| AC-LRD-1 | 88 | Red-first capture shows the old unmerged-branch floor firing. Four attested passes of the verify command, the last two from the shared checkout. In the diff, findNotLandedFloor refuses with no landing, no probe or commits after the landing (no fail-open). Exit-4 mapping and the set --status path ar… | 01M5A1TT4FT3WZ3P029CFG4JZX (evidence [1],[4],[15],[19],[21]) |
| AC-LRD-2 | 84 | Red-first, then passes: 4 tests, later 6. The already-integrated path now records a landing with base_from_claim instead of walking history. The recorder skips archived tasks and any task already holding this branch head. How base_from_claim is consumed, and the 'names no task' message, sit in the … | 01M5A1TT4FT3WZ3P029CFG4JZX (evidence [2],[5],[16],[22]), 01M5A65CSF2YY659XCNWWZBKMA (evidence [2],[4],[11],[14]) |
| AC-LRD-3 | 82 | refuseWhileWorkingCopyHoldsUnlandedTask is wired before the claim writes anything. One attested fail from the shared checkout: the actor fell back to the OS username and tripped the identity collision. A follow-up task pinned explicit identities, and the cases now pass with identity env vars stripp… | 01M5A1TT4FT3WZ3P029CFG4JZX (fail [17], pass [6],[23]), 01M5A56NTMGVDC55QXKY46EXCE (identity-pinning fix), 01M5A65CSF2YY659XCNWWZBKMA (evidence [5],[12],[15]) |
| AC-LRD-4 | 88 | The diff deletes findLandingInMainLog, firstParentLog, landing_unresolved, resolveLanding and the assess merge-commit backfill. The full-pattern grep passes ([12],[20],[24]). However, the done floor for removed anchor files still measures the claimed worktree head, which goes against the AC's inten… | 01M5A1TT4FT3WZ3P029CFG4JZX (evidence [12],[20],[24]) |

## Gaps

- There is no evidence for the P2 corpus phase (lore verify of the plan, rule apply, archive re-review, landing the deprecation branch).
- The comments in packages/lore/src/service/integrate-service.ts leave two contradictory 'reason: BR-1336' blocks on the already-integrated path.

## Recommendations

- State whether every done floor (including the anchor-removal exception) is barred from reading the claimed working copy's head, or only the landing decision is.
- Require verify commands to run with identity env vars stripped by default.

## Judgment

- Provider: claude-cli
- Prompt version: 8
- Reproducible: yes (this prompt_version's rendering is guaranteed byte-identical)
- Duration: 38150ms
- Retried: false
- Truncated sections: diff:packages/lore/tests/integration/claim-one-unlanded-task-per-worktree.bun.test.ts, diff:packages/lore/tests/integration/integrate-records-landing-on-claimants.test.ts, diff:packages/lore/tests/integration/landing-record-decides-done.bun.test.ts, diff:packages/lore/tests/e2e/bootstrap-seat-injection-compiled.bun.test.ts, diff:packages/lore/tests/e2e/done-worktree-cleanup-compiled.bun.test.ts, diff:packages/lore/tests/e2e/worktree-check-sweep-compiled.bun.test.ts, diff:packages/lore/tests/integration/cli/capture-stamps-and-init-arms.bun.test.ts, diff:packages/lore/tests/integration/cli/done-worktree-cleanup.bun.test.ts, diff:packages/lore/tests/integration/cli/session-trail-review-helper-scope.test.ts, diff:packages/lore/tests/integration/cli/write-unattested.bun.test.ts, diff:packages/lore/tests/integration/commit-range-from-landing.bun.test.ts, diff:packages/lore/tests/integration/done-floors-landed-real-runs.bun.test.ts, diff:packages/lore/tests/integration/feature-branch-blocks.bun.test.ts, diff:packages/lore/tests/integration/landing-lookup-integrate-naming.bun.test.ts, diff:packages/lore/tests/unit/adapters/plan-close-render-provenance.test.ts, diff:packages/lore/tests/unit/service/active-sessions-branches.bun.test.ts, diff:packages/lore/tests/unit/service/actor-identity-guard.bun.test.ts, diff:packages/lore/tests/unit/service/done-floor-anchored-test-file-the-task-deleted.test.ts, diff:packages/lore/tests/unit/service/task-done-commit-range.test.ts, diff:packages/lore/tests/integration/cli/capture-stamps-and-init-arms.bun.test.ts, diff:packages/lore/tests/integration/claim-one-unlanded-task-per-worktree.bun.test.ts, diff:packages/lore/tests/integration/integrate-records-landing-on-claimants.test.ts, diff:packages/lore/tests/unit/adapters/assess-recorded-commit-range.test.ts, diff:packages/lore/src/service/task-workflow-service.ts, diff:packages/lore/tests/integration/claim-one-unlanded-task-per-worktree.bun.test.ts, diff:packages/lore/tests/integration/cli/assess-commit-derivation-archived-mismatch.bun.test.ts, diff:packages/lore/tests/integration/cli/assess-diff-source-wiring.test.ts, diff:packages/lore/tests/integration/cli/assess-plan-diff-excludes-merged-main.bun.test.ts, diff:packages/lore/tests/integration/integrate-records-landing-on-claimants.test.ts, diff:packages/lore/tests/unit/adapters/assess-commit-derivation.test.ts, diff:packages/lore/tests/unit/adapters/mcp-tools-assess.test.ts, diff:packages/lore/tests/unit/adapters/assess-commit-derivation.test.ts, diff:packages/lore/tests/integration/integrate-records-landing-on-claimants.test.ts
- Reasoning clipped for: AC-LRD-1, AC-LRD-2, AC-LRD-3, AC-LRD-4

## Dimension Scores

| Dimension | Score | Confidence (self-reported, uncalibrated) | Based On | Reasoning |
|---|---|---|---|---|
| outcome | 84 | 0.7 | evidence | All four ACs pass as attested and the core mechanisms show in the diff. A residual worktree-head read remains in a done floor, and P2 corpus work is unevidenced. |
| evidence_integrity | 85 | 0.75 | evidence | Every record is attested, red-first captured, and re-run from the shared checkout. The env-dependent fail was caught and fixed. Early AC-LRD-4 greps used a narrower pattern. |
| scope_fidelity | 80 | 0.65 | evidence | Removing assess slug-matching and the history walk followed explicitly from the assessment follow-up task. The seat.ts wording edits only avoid a grep hit. P2 is not shown. |

## Typed Gaps

| Dimension | Severity | AC Ref | Statement |
|---|---|---|---|
| scope_fidelity | minor | — | There is no evidence for the P2 corpus phase (lore verify of the plan, rule apply, archive re-review, landing the deprecation branch). |
| outcome | minor | — | The comments in packages/lore/src/service/integrate-service.ts leave two contradictory 'reason: BR-1336' blocks on the already-integrated path. |

## Typed Recommendations

| Target | Action | Rationale |
|---|---|---|
| spec | State whether every done floor (including the anchor-removal exception) is barred from reading the claimed working copy's head, or only the landing decision is. | AC-LRD-4's grep cannot detect the remaining worktree-head reads. |
| process | Require verify commands to run with identity env vars stripped by default. | The AC-LRD-3 fail showed that an agent identity in the environment hid an env-dependent test. |

## Unverifiable Materials

- packages/lore/src/service/task-workflow-service.ts (final state): Omitted from the diff. The recorder's handling of base_from_claim, exit-code mapping and the set --status refusal cannot be seen.
- AC-DCL-1 (a) spec revision: No corpus diff or evidence shows the AC text was revised.

## Finding Path Verification

- Checked (confirmed present at the assessed commit): 1
- Unverifiable (confirmed absent — finding withdrawn): 0
- Not shown to the judge (omitted from the diff by truncation — finding withdrawn, NOT judged): 2
- Unchecked (NO assessed-commit referent — NOT verified; do not read as "fine"): 0

## Withdrawn Findings (Path Verification)

2 finding(s) below were EXCLUDED from ac_scores/typed_gaps/gaps because a path they declared was never shown to the judge or does not exist at the assessed commit. overall_score above is NOT recomputed to account for their removal.

- [major] In packages/lore/src/service/task-workflow-service.ts, the anchor-removal verdicts for the unfiltered-test-file floor are still measured from the claim's recorded worktree or branch head. That reads the claimed working copy to help decide whether a task archives, contrary to the AC's intent. — "packages/lore/src/service/task-workflow-service.ts" was never shown to the judge (omitted from the truncated diff)
- [minor] How base_from_claim is consumed in the recorder (taking the range start from the claim's base_sha) is in the omitted production file, so the commit range of an already-integrated landing cannot be checked here. — "packages/lore/src/service/task-workflow-service.ts" was never shown to the judge (omitted from the truncated diff)

## Facts Summary

- AC coverage: 4 declared criteria
- Task evidence: 3 tasks
- AC scope: 0 scoped, 0 dangling
- Knowledge capture: 2 docs (bundle)
- Regression: tests_touched=true, attested_evidence_ratio=1.00
