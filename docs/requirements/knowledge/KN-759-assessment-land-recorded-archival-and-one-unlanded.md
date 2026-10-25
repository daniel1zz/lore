---
id: KN-759
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
| AC-LRD-1 | 88 | Red-first fail [1] showed the old unmerged-branch floor; passes at [4] and [15] from the shared checkout. findNotLandedFloor requires extra.landing, refuses when unmeasurable (no fail-open), and checks commits after the landing. Test cases (a)-(e) match the AC. | 01M5A1TT4FT3WZ3P029CFG4JZX (evidence [1],[4],[15]) |
| AC-LRD-2 | 87 | Red [2], then green at [5] and [16]. Integrate on an already-integrated branch now calls recordLanding through locateExistingLanding. The recorder skips archived/deprecated tasks and tasks that already hold the same head. Tests cover first and second claimant, no claimant, and archived. | 01M5A1TT4FT3WZ3P029CFG4JZX (evidence [2],[5],[16]) |
| AC-LRD-3 | 76 | Failed from the shared checkout at [17]: case (4) hit ACTOR_IDENTITY_COLLISION. The follow-up task fixed this by pinning the session ID, and [5] passes from the shared checkout. Pinning a default session makes cases (1) and (2) the same session, so the separate same-actor check is now weaker. | 01M5A1TT4FT3WZ3P029CFG4JZX (evidence [3],[6],[17] fail), 01M5A56NTMGVDC55QXKY46EXCE (evidence [1] expected-fail, [5] pass from shared checkout) |
| AC-LRD-4 | 82 | The grep passes at [7], [12] and [18], and the diff removes findLandingInMainLog, findUnlandedWorkFloor, firstParentLog and landing_unresolved. Weak point: the help text in seat.ts was reworded only so the grep would pass. locateExistingLanding also reads main's history at integrate time, though no… | 01M5A1TT4FT3WZ3P029CFG4JZX (evidence [7],[12],[18]) |

## Gaps

- After the fix, every call in packages/lore/tests/integration/claim-one-unlanded-task-per-worktree.bun.test.ts uses the same CLAUDE_CODE_SESSION_ID, so the same-actor case (1) and the same-session case (2) are no longer independent checks.
- packages/lore/src/adapters/cli/assess-commit-derivation.ts no longer handles not_measured entries, and packages/lore/src/service/task-commit-range.ts stops emitting them. A task with no landing may now be attributed by slug match instead of being reported as not measured.
- The help text in packages/lore/src/adapters/cli/commands/seat.ts and a comment in packages/lore/src/service/seat-service.ts were reworded to avoid the literal 'unmerged-branch'. These strings describe an unrelated seat refusal, so the change only serves to pass the grep.
- locateExistingLanding in packages/lore/src/service/integrate-service.ts runs rev-list --ancestry-path --first-parent over main to rebuild a landing for an already-integrated branch. It is used at integrate time, not for archival, but it is a form of history reconstruction.

## Recommendations

- Tighten the AC-LRD-4 check to the removed symbols (findLandingInMainLog, findUnlandedWorkFloor, firstParentLog, the 'not-landed' floor-id union) instead of a bare 'unmerged-branch' substring.
- Run AC verify commands from the shared checkout, not only inside the implementer's worktree, before marking a task done.
- Add an AC or test proving that assess reports a not-landed task as not_measured after the not_measured handling was removed.

## Judgment

- Provider: claude-cli
- Prompt version: 8
- Reproducible: yes (this prompt_version's rendering is guaranteed byte-identical)
- Duration: 38309ms
- Retried: false
- Truncated sections: diff:packages/lore/tests/e2e/done-worktree-cleanup-compiled.bun.test.ts, diff:packages/lore/tests/e2e/worktree-check-sweep-compiled.bun.test.ts, diff:packages/lore/tests/integration/cli/capture-stamps-and-init-arms.bun.test.ts, diff:packages/lore/tests/integration/cli/done-worktree-cleanup.bun.test.ts, diff:packages/lore/tests/integration/cli/session-trail-review-helper-scope.test.ts, diff:packages/lore/tests/integration/cli/write-unattested.bun.test.ts, diff:packages/lore/tests/integration/commit-range-from-landing.bun.test.ts, diff:packages/lore/tests/integration/dc2-tdd-red-pairing.bun.test.ts, diff:packages/lore/tests/integration/done-floors-landed-real-runs.bun.test.ts, diff:packages/lore/tests/integration/feature-branch-blocks.bun.test.ts, diff:packages/lore/tests/integration/landing-lookup-integrate-naming.bun.test.ts, diff:packages/lore/tests/unit/adapters/plan-close-render-provenance.test.ts, diff:packages/lore/tests/unit/service/active-sessions-branches.bun.test.ts, diff:packages/lore/tests/unit/service/actor-identity-guard.bun.test.ts, diff:packages/lore/tests/unit/service/done-floor-anchored-test-file-the-task-deleted.test.ts, diff:packages/lore/tests/unit/service/task-done-commit-range.test.ts
- Reasoning clipped for: AC-LRD-4

## Dimension Scores

| Dimension | Score | Confidence (self-reported, uncalibrated) | Based On | Reasoning |
|---|---|---|---|---|
| outcome | 84 | 0.7 | evidence | All four ACs pass from the shared checkout. The core floor, the claimant recorder and the claim refusal are implemented as specified. Minor risk of an assess attribution regression. |
| evidence_integrity | 80 | 0.7 | evidence | Red-first captures are present and all runs are attested. AC-LRD-3 failed from the shared checkout and needed a follow-up task. Some runs ended with a 'close timed out' warning. |
| scope_fidelity | 78 | 0.6 | evidence | Changes stay mostly on the landing and claim paths. Extra work: assess not_measured removal, seat.ts wording changed to pass the grep, test-budget and bootstrap test edits. |

## Typed Gaps

| Dimension | Severity | AC Ref | Statement |
|---|---|---|---|
| evidence_integrity | minor | AC-LRD-3 | After the fix, every call in packages/lore/tests/integration/claim-one-unlanded-task-per-worktree.bun.test.ts uses the same CLAUDE_CODE_SESSION_ID, so the same-actor case (1) and the same-session case (2) are no longer independent checks. |
| outcome | minor | — | packages/lore/src/adapters/cli/assess-commit-derivation.ts no longer handles not_measured entries, and packages/lore/src/service/task-commit-range.ts stops emitting them. A task with no landing may now be attributed by slug match instead of being reported as not measured. |
| scope_fidelity | minor | AC-LRD-4 | The help text in packages/lore/src/adapters/cli/commands/seat.ts and a comment in packages/lore/src/service/seat-service.ts were reworded to avoid the literal 'unmerged-branch'. These strings describe an unrelated seat refusal, so the change only serves to pass the grep. |
| scope_fidelity | minor | AC-LRD-4 | locateExistingLanding in packages/lore/src/service/integrate-service.ts runs rev-list --ancestry-path --first-parent over main to rebuild a landing for an already-integrated branch. It is used at integrate time, not for archival, but it is a form of history reconstruction. |

## Typed Recommendations

| Target | Action | Rationale |
|---|---|---|
| spec | Tighten the AC-LRD-4 check to the removed symbols (findLandingInMainLog, findUnlandedWorkFloor, firstParentLog, the 'not-landed' floor-id union) instead of a bare 'unmerged-branch' substring. | The bare substring forced unrelated text to be reworded. |
| process | Run AC verify commands from the shared checkout, not only inside the implementer's worktree, before marking a task done. | Environment identity hid the AC-LRD-3 failure inside the worktree. |
| plan | Add an AC or test proving that assess reports a not-landed task as not_measured after the not_measured handling was removed. | Removing that path could silently change attribution. |

## Unverifiable Materials

- Revision of AC-DCL-1 (a) on spec-defect-clusters-round-1-done-floors-judge-real-runs-on: Not in the diff or evidence; the updated test file is omitted.
- P2 corpus steps (lore verify, rule apply, archive approval, deprecation branch landing): No evidence records for these steps.
- Omitted test files, e.g. done-floors-landed-real-runs.bun.test.ts: Listed in the truncation manifest; contents not visible.

## Finding Path Verification

- Checked (confirmed present at the assessed commit): 6
- Unverifiable (confirmed absent — finding withdrawn): 0
- Unchecked (NO assessed-commit referent — NOT verified; do not read as "fine"): 0

## Facts Summary

- AC coverage: 4 declared criteria
- Task evidence: 2 tasks
- AC scope: 0 scoped, 0 dangling
- Knowledge capture: 0 docs (bundle)
- Regression: tests_touched=true, attested_evidence_ratio=1.00
