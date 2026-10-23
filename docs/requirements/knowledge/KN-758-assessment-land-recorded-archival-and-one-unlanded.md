---
id: KN-758
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
| AC-LRD-1 | 90 | Red-first capture shows the old unmerged-branch floor firing where not-landed was expected. There are three attested passes, the last from the shared checkout at 22:23. The diff replaces findUnlandedWorkFloor with findNotLandedFloor, which reads extra.landing only and refuses when anything is unmea… | 01M5A1TT4FT3WZ3P029CFG4JZX (evidence [1] expected-fail; [4], [15], [19] pass) |
| AC-LRD-2 | 85 | Red-first, then passes. The already-integrated path calls recordLanding, and the follow-up removed the locateExistingLanding history walk in favour of base_from_claim. The base_from_claim handling sits in the omitted task-workflow-service.ts, so it is unseen. Final pass is from the shared checkout … | 01M5A1TT4FT3WZ3P029CFG4JZX ([2] expected-fail; [5], [16] pass), 01M5A65CSF2YY659XCNWWZBKMA ([2] expected-fail; [4], [11], [14] pass) |
| AC-LRD-3 | 80 | The one attested fail ([17], case 4): with no identity set, the actor fell back to the OS username and hit an actor-identity collision instead of the claim refusal. A follow-up task fixed the test, and the later shared-checkout passes ([5] in that task, [15] in the next) supersede the fail. isSameW… | 01M5A1TT4FT3WZ3P029CFG4JZX ([3] expected-fail; [6] pass; [17] fail), 01M5A56NTMGVDC55QXKY46EXCE (identity pin fix; [5] shared-checkout pass), 01M5A65CSF2YY659XCNWWZBKMA ([15] pass after the same-actor and same-session cases were split) |
| AC-LRD-4 | 86 | The full-pattern grep passes ([12], [20]). The diff removes findLandingInMainLog, firstParentLog, landing_unresolved, the main-log backfill in assess, and locateExistingLanding. A JSDoc comment still names resolveLanding (not in the grep pattern). resolveClaimHead remains, but only in blocker readi… | 01M5A1TT4FT3WZ3P029CFG4JZX ([12], [20] full-pattern grep pass) |

## Gaps

(none)

## Recommendations

- Attach evidence for each P2 corpus step, or split P2 into its own task with an AC.
- Extend the AC-LRD-4 grep to also match resolveLanding and locateExistingLanding.
- Run identity-sensitive integration tests from the shared checkout with identity variables stripped before closing a task.

## Judgment

- Provider: claude-cli
- Prompt version: 8
- Reproducible: yes (this prompt_version's rendering is guaranteed byte-identical)
- Duration: 35176ms
- Retried: false
- Truncated sections: diff:packages/lore/tests/integration/claim-one-unlanded-task-per-worktree.bun.test.ts, diff:packages/lore/tests/integration/integrate-records-landing-on-claimants.test.ts, diff:packages/lore/tests/integration/landing-record-decides-done.bun.test.ts, diff:packages/lore/tests/e2e/bootstrap-seat-injection-compiled.bun.test.ts, diff:packages/lore/tests/e2e/done-worktree-cleanup-compiled.bun.test.ts, diff:packages/lore/tests/e2e/worktree-check-sweep-compiled.bun.test.ts, diff:packages/lore/tests/integration/cli/capture-stamps-and-init-arms.bun.test.ts, diff:packages/lore/tests/integration/cli/done-worktree-cleanup.bun.test.ts, diff:packages/lore/tests/integration/cli/session-trail-review-helper-scope.test.ts, diff:packages/lore/tests/integration/cli/write-unattested.bun.test.ts, diff:packages/lore/tests/integration/commit-range-from-landing.bun.test.ts, diff:packages/lore/tests/integration/done-floors-landed-real-runs.bun.test.ts, diff:packages/lore/tests/integration/feature-branch-blocks.bun.test.ts, diff:packages/lore/tests/integration/landing-lookup-integrate-naming.bun.test.ts, diff:packages/lore/tests/unit/adapters/plan-close-render-provenance.test.ts, diff:packages/lore/tests/unit/service/active-sessions-branches.bun.test.ts, diff:packages/lore/tests/unit/service/actor-identity-guard.bun.test.ts, diff:packages/lore/tests/unit/service/done-floor-anchored-test-file-the-task-deleted.test.ts, diff:packages/lore/tests/unit/service/task-done-commit-range.test.ts, diff:packages/lore/tests/integration/cli/capture-stamps-and-init-arms.bun.test.ts, diff:packages/lore/tests/integration/integrate-records-landing-on-claimants.test.ts, diff:packages/lore/tests/unit/adapters/assess-recorded-commit-range.test.ts, diff:packages/lore/src/service/task-workflow-service.ts, diff:packages/lore/tests/integration/claim-one-unlanded-task-per-worktree.bun.test.ts, diff:packages/lore/tests/integration/cli/assess-commit-derivation-archived-mismatch.bun.test.ts, diff:packages/lore/tests/integration/cli/assess-diff-source-wiring.test.ts, diff:packages/lore/tests/integration/cli/assess-plan-diff-excludes-merged-main.bun.test.ts, diff:packages/lore/tests/integration/integrate-records-landing-on-claimants.test.ts, diff:packages/lore/tests/unit/adapters/assess-commit-derivation.test.ts, diff:packages/lore/tests/unit/adapters/mcp-tools-assess.test.ts, diff:packages/lore/tests/unit/adapters/assess-commit-derivation.test.ts, diff:packages/lore/tests/integration/integrate-records-landing-on-claimants.test.ts, diff:packages/lore/tests/integration/claim-one-unlanded-task-per-worktree.bun.test.ts
- Reasoning clipped for: AC-LRD-1, AC-LRD-2, AC-LRD-3, AC-LRD-4

## Dimension Scores

| Dimension | Score | Confidence (self-reported, uncalibrated) | Based On | Reasoning |
|---|---|---|---|---|
| outcome | 85 | 0.7 | evidence | All four ACs pass from the shared checkout. The diff matches the spec end state: recorded landing only, claim refusal, no history walk. |
| evidence_integrity | 82 | 0.7 | evidence | All evidence is attested with red-first captures. The AC-LRD-3 fail was surfaced and fixed. One oracle is mislabelled (lint). |

## Typed Recommendations

| Target | Action | Rationale |
|---|---|---|
| plan | Attach evidence for each P2 corpus step, or split P2 into its own task with an AC. | Phase P2 currently cannot be audited. |
| spec | Extend the AC-LRD-4 grep to also match resolveLanding and locateExistingLanding. | locateExistingLanding was added and later removed, which shows the current grep misses history walks under new names. |
| process | Run identity-sensitive integration tests from the shared checkout with identity variables stripped before closing a task. | The AC-LRD-3 env-dependence was only caught later, by lore verify. |

## Unverifiable Materials

- packages/lore/src/service/task-workflow-service.ts (final full version): Omitted from the diff; base_from_claim recorder logic is unseen.
- P2 corpus actions and the AC-DCL-1 (a) spec revision: No evidence records or diff for corpus writes.
- New test file contents (three AC test files): Omitted; test assertions cannot be checked against the AC wording.
- scope_fidelity dimension score: based_on="absence" cited no matching unverifiable[]/judgment.truncated[] entry — suppressed as ungrounded rather than published as a finding.

## Finding Path Verification

- Checked (confirmed present at the assessed commit): 0
- Unverifiable (confirmed absent — finding withdrawn): 0
- Not shown to the judge (omitted from the diff by truncation — finding withdrawn, NOT judged): 2
- Unchecked (NO assessed-commit referent — NOT verified; do not read as "fine"): 0

## Withdrawn Findings (Path Verification)

2 finding(s) below were EXCLUDED from ac_scores/typed_gaps/gaps because a path they declared was never shown to the judge or does not exist at the assessed commit. overall_score above is NOT recomputed to account for their removal.

- [minor] A JSDoc in packages/lore/src/service/task-workflow-service.ts still describes resolveLanding (done time), which no longer exists. The AC grep does not catch it. — "packages/lore/src/service/task-workflow-service.ts" was never shown to the judge (omitted from the truncated diff)
- [minor] Follow-up task evidence [9] is labelled oracle=lint, but its command runs packages/lore/tests/unit/adapters/assess-commit-derivation.test.ts. — "packages/lore/tests/unit/adapters/assess-commit-derivation.test.ts" was never shown to the judge (omitted from the truncated diff)

## Rubric Warnings

- Dimension "scope_fidelity" scored based_on="absence" but no matching entry was found in unverifiable[] or judgment.truncated[] — the absence claim is ungrounded.

## Facts Summary

- AC coverage: 4 declared criteria
- Task evidence: 3 tasks
- AC scope: 0 scoped, 0 dangling
- Knowledge capture: 1 docs (bundle)
- Regression: tests_touched=true, attested_evidence_ratio=1.00
