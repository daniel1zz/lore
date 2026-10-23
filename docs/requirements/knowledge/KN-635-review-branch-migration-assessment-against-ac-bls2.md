---
id: KN-635
type: knowledge
role: knowledge
title: "Review-branch migration assessment against AC-BLS2-16"
status: archived
priority: medium
created: 2026-10-09
updated: 2026-10-23
tags: []
parent: PLAN-177
---
Review-branch migration assessment against AC-BLS2-16 (plan-baseline-review-branch-migration-the-first-branch-eligible), 2026-10-09. Owner choice B (2026-10-09). Every number below names the oracle that produced it; all oracles were run by the orchestrator on main.

## Verdict: FAIL (4 of 5 bars met). Stop rule applies; direction returned to the owner.

| Bar | Requirement | Measured | Source | Result |
|---|---|---|---|---|
| 1 | blind probe >= 9/10, 0 confident-wrong, probe frozen first, >= 6 review questions | 8.5/10, 0 confident-wrong; probe created 2026-10-09T02:45:01Z, branch 02:47:00Z; 8 review questions | scratchpad grader/bar1.sh (exit 1); separate grader agent; probe `knowledge-review-branch-frozen-probe-set-10-questions-for-the` | FAIL |
| 2 | coverage exits 0 | 5 leaves, 205 sites, 0 gaps, 0 not_measured | `bun run packages/lore/src/index.ts baseline coverage baseline-review` exit 0 | PASS |
| 3 | 0 established/observed rules without a live script-mode citing AC | 13 of 54 live rules established, each cited (red control: counting unconfirmed rules too -> 38 uncited, exit 1) | rb-draft/bar23.sh | PASS |
| 4 | 100% cited-or-exempt in specs placed in review; exemptions <= 10% | 3 specs, 26 criteria, 0 uncovered; 9 active exemptions of cap 102 (0.9%) (red control on execution: 175 uncovered, exit 1) | rb-draft/bar4.py (read-only sqlite, replicates placeSpecInBranch) | PASS |
| 5 | >= 90% faithful (criterion, rule) pairs | 19/20 (95%) | judge/bar5.sh over an independent judge's verdicts | PASS |

## Why bar 1 failed
No answer was wrong; all three half-scores are ABSENCES in the baseline:
- Q3, Q6 ask for exit codes; the review rules state outcomes (refused / accepted) but not the exit code. For a CLI whose callers are agents, the exit code is part of the observable outcome (the PRD distributes output-contract rules into leaves), so this is a format gap of method v2, not a reader error. Q3 also lacked a rule on approving after the deterministic check fails for a parentless decision record.
- Q7: "a tags-only change keeps approval" is stated only for specs (specification branch); the generic rule belongs to corpus (unpopulated), so a review-branch reader could only infer it for other types.

## Corrections made during the plan (bars not moved)
- BR-281: excavated as "suspected defect (#64)"; W2 found it is the accepted design of `adr-an-escalate-gates-every-doc-type-a-reject-stays-scoped-to`, locked by AC-ESC-2/7. Raised to established; #64 closed as filed in error; slice-2a retro finding 8 corrected.
- AC-ESC-5 cited BR-277; the fidelity judge (n=9) found BR-278 is the faithful rule. Repointed AFTER bar 5 was measured; bar 5 stays 19/20. Bars 2-4 re-run after the repair: still PASS.

## Structural finding for the owner
AC-BLS2-13 requires a probe frozen before a branch's FIRST document. A branch that fails its probe can therefore never be armed: any re-probe is written after the branch exists. With this result, review joins specification and execution as unarmable under the current wording. Either the exit wording changes, or every branch gets exactly one attempt.

## Issues filed in this plan
#65 #66 #67 #68 #69 (probe author), #70 #71 #72 (excavator; #72 claim-scoped worktrees cannot create leaves or set a branch body), #73 (map cannot point at another leaf's rule), #74 (AC-TIER-10 filter skips its positive half), #75 (spec-053 shared oracle), #76 (exemptions not addressable). #64 closed as not a defect.
