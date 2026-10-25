---
id: KN-612
type: knowledge
role: knowledge
title: "Assessment: Land #106: lore done removes the task's recorded worktree; lore worktree sweep (2026-10-10)"
status: archived
priority: medium
created: 2026-10-10
updated: 2026-10-23
tags: []
parent: PLAN-170
links:
  - {id: PLAN-170, type: informs}
---
# Assessment: partially_met (78/100)

Scope: plan `01M4HVAXF2CHZQQGSEVVRHP1ZY`

## AC Scores

| AC | Score | Reasoning | Evidence |
|---|---|---|---|
| AC-WTC-1 | 88 | 12/12 tests pass, attested. The run includes the AC echo line and follows a recorded RED failure. Tests cover removal and branch deletion, each keep reason (no-own-commits, uncommitted tracked/untracked, unmerged, recent, locked), the unclaimed worktree, the sibling and archival when the worktree i… | task-implement-106-make-ac-wtc-1-ac-wtc-2-ac-wtc-3-green (evidence [1],[3] pass; [6] expected-fail), task-red-for-106-ac-wtc-1-ac-wtc-2-ac-wtc-3 (evidence [1] RED, [3] pass) |
| AC-WTC-2 | 82 | 14/14 pass, attested, after RED. Tests check that a report-only run leaves the porcelain list byte-identical, that --apply removes exactly the remove rows, that unrecorded and active worktrees are not listed, and that a plain directory is not-measured. The `gone` decision on an already-removed work… | task-implement-106-make-ac-wtc-1-ac-wtc-2-ac-wtc-3-green (evidence [2],[4] pass), task-red-for-106-ac-wtc-1-ac-wtc-2-ac-wtc-3 (evidence [2] RED, [4] pass) |
| AC-WTC-3 | 62 | Two attested passes, but the 4000-byte tail shows only a site listing, not the echo line or a gap count. The diff adds no census mapping entries for the new sites, such as the parseQuietMinutes VALIDATION_ERROR or sweep. The plan defers mapping to the orchestrator on main (#72), and the branch the … | task-implement-106-make-ac-wtc-1-ac-wtc-2-ac-wtc-3-green (evidence [5] other, tail truncated), task-red-for-106-ac-wtc-1-ac-wtc-2-ac-wtc-3 (evidence [5] same command) |

## Gaps

- AC-WTC-3 evidence tail shows only a site listing, not the PASS echo or a zero-gap summary. No census mapping for new sites in packages/lore/src/service/worktree-cleanup.ts appears in the diff.
- gatherWorktreeFacts hard-codes `main..<branch>` for the merged check, and deleteBranch uses `git branch -d` from repoRoot, which checks merge status against that checkout's HEAD, not main (packages/lore/src/service/worktree-cleanup.ts).
- sweepWorktrees in packages/lore/src/service/task-workflow-service.ts aborts with an error if an audit append fails after removals already happened, so the remaining rows are lost. A concurrent removal yields remove-failed with exit 1, not `gone` as the risk register claims.
- No assertion of a `gone` decision in packages/lore/tests/integration/cli/worktree-sweep.bun.test.ts, although the plan's RED coverage lists it.

## Recommendations

- Require baseline-coverage evidence to capture the final summary lines (gap count and PASS echo), e.g. by tailing the last N lines rather than the last 4000 bytes.
- Make the census mapping for new sites an explicit task deliverable with its own evidence, rather than deferring it to the orchestrator on main.

## Judgment

- Provider: claude-cli
- Prompt version: 8
- Reproducible: yes (this prompt_version's rendering is guaranteed byte-identical)
- Duration: 43593ms
- Retried: false
- Truncated sections: diff:packages/lore/tests/unit/service/worktree-cleanup.test.ts
- Reasoning clipped for: AC-WTC-1, AC-WTC-2, AC-WTC-3

## Dimension Scores

| Dimension | Score | Confidence (self-reported, uncalibrated) | Based On | Reasoning |
|---|---|---|---|---|
| outcome | 80 | 0.7 | evidence | AC-WTC-1/2 behaviour implemented and tested end-to-end. AC-WTC-3 census mapping not visible in the diff. |
| evidence_integrity | 74 | 0.6 | evidence | Attested passes with RED-first failures recorded. AC-WTC-3 tail truncated, with no PASS line or gap count visible; evidence is mixed across tester/implementer tasks. |
| scope_fidelity | 85 | 0.7 | evidence | Changes stay on done hook, sweep command, predicate module and tests. Claim audit gaining worktree/base_sha is a justified addition. |

## Typed Gaps

| Dimension | Severity | AC Ref | Statement |
|---|---|---|---|
| evidence_integrity | major | AC-WTC-3 | AC-WTC-3 evidence tail shows only a site listing, not the PASS echo or a zero-gap summary. No census mapping for new sites in packages/lore/src/service/worktree-cleanup.ts appears in the diff. |
| outcome | minor | AC-WTC-1 | gatherWorktreeFacts hard-codes `main..<branch>` for the merged check, and deleteBranch uses `git branch -d` from repoRoot, which checks merge status against that checkout's HEAD, not main (packages/lore/src/service/worktree-cleanup.ts). |
| outcome | minor | AC-WTC-2 | sweepWorktrees in packages/lore/src/service/task-workflow-service.ts aborts with an error if an audit append fails after removals already happened, so the remaining rows are lost. A concurrent removal yields remove-failed with exit 1, not `gone` as the risk register claims. |
| outcome | minor | AC-WTC-2 | No assertion of a `gone` decision in packages/lore/tests/integration/cli/worktree-sweep.bun.test.ts, although the plan's RED coverage lists it. |

## Typed Recommendations

| Target | Action | Rationale |
|---|---|---|
| process | Require baseline-coverage evidence to capture the final summary lines (gap count and PASS echo), e.g. by tailing the last N lines rather than the last 4000 bytes. | Truncated tails hide whether AC-WTC-3 actually reported 0 gaps. |
| plan | Make the census mapping for new sites an explicit task deliverable with its own evidence, rather than deferring it to the orchestrator on main. | The mapping is invisible in this diff, so AC-WTC-3 cannot be verified from the bundle. |

## Unverifiable Materials

- packages/lore/tests/unit/service/worktree-cleanup.test.ts: Omitted from the diff; its coverage of the pure decision and probe failures is unseen.
- census mapping list / baseline-execution coverage summary: Not in the diff, and the evidence tail is truncated before any summary.
- test-assertion immutability by implementer: No per-commit history is shown, so it cannot be confirmed that the implementer left the assertions unchanged.

## Finding Path Verification

- Checked (confirmed present at the assessed commit): 4
- Unverifiable (confirmed absent — finding withdrawn): 0
- Unchecked (NO assessed-commit referent — NOT verified; do not read as "fine"): 0

## Facts Summary

- AC coverage: 3 declared criteria
- Task evidence: 2 tasks
- AC scope: 0 scoped, 0 dangling
- Knowledge capture: 0 docs (bundle)
- Regression: tests_touched=true, attested_evidence_ratio=0.73
