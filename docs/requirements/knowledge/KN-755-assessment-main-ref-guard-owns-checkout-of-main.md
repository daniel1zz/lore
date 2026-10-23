---
id: KN-755
type: knowledge
role: knowledge
title: "Assessment: Main-ref guard owns checkout of main; integrate requires the guard (2026-10-19)"
status: archived
priority: medium
created: 2026-10-19
updated: 2026-10-23
tags: []
parent: PLAN-223
links:
  - {id: PLAN-223, type: informs}
---
# Assessment: partially_met (78/100)

Scope: plan `01M5A33JVQ2CS3F6TFVAAVHSRZ`

## AC Scores

| AC | Score | Reasoning | Evidence |
|---|---|---|---|
| AC-MG-1 | 87 | Red against base 79571711 [1], a mutation red (mainX) [5], then three greens [9][22][36]. The final runs show 12/12 tests. Weaknesses: the hook code is not in the diff shown, and the last run logs 'close timed out after 10000ms'. | task-the-main-ref-guard-refuses-checkout-of-main-integrate (evidence [1],[5],[9],[22],[36]) |
| AC-MG-2 | 88 | Red on base [2], mutation red with the byte-identity check disabled [6], an extra red when the guard ran after the fetch [14], then greens [10][15][37] (5/5). The integrate-service change is not visible in the diff. | task-the-main-ref-guard-refuses-checkout-of-main-integrate (evidence [2],[6],[14],[15],[37]) |
| AC-MG-3 | 86 | Red on base [3], mutation red with detach replaced by git status [7], then greens [11][23][38] (4/4). The setup detach code and the version-reader injection are not visible in the diff. | task-the-main-ref-guard-refuses-checkout-of-main-integrate (evidence [3],[7],[11],[23],[38]) |
| AC-MG-4 | 88 | The exact AC command fails on base [4] and on a drifted-copy mutation [8], then passes three times [12][24][39]. These are structural checks only. The behaviour is covered by MG-1/2. | task-the-main-ref-guard-refuses-checkout-of-main-integrate (evidence [4],[8],[12],[24],[39]) |

## Gaps

- The plan's P2 task (task-retire-superseded-integrate-criteria-apply-the-main-guard) is approved but has no evidence. AC-INT-2 part (4) has not been retired, and lore verify, lore rule apply, the setup re-run and the archiving of task-checking-out-main-in-a-nested-worktree-blocks-every are all unproven.
- The final verification runs ([36]-[38]) log 'close timed out after 10000ms' after the tests pass, which points to a teardown or handle-leak problem in the test runner.

## Recommendations

- Do not close the plan until the P2 corpus task records evidence for lore verify, lore rule apply, the setup --project re-run and the archive.
- Make assessment bundles include the full implementation diff, not just the last commit.

## Judgment

- Provider: claude-cli
- Prompt version: 8
- Reproducible: yes (this prompt_version's rendering is guaranteed byte-identical)
- Duration: 27231ms
- Retried: false
- Truncated sections: (none)

## Dimension Scores

| Dimension | Score | Confidence (self-reported, uncalibrated) | Based On | Reasoning |
|---|---|---|---|---|
| outcome | 78 | 0.7 | evidence | All four ACs are evidenced red→green with mutations. P2 corpus work is undelivered, and the implementation is not visible in the diff. |
| evidence_integrity | 85 | 0.75 | evidence | Strong trail: base reds, targeted mutation reds, repeated greens, typecheck and regression suites. 77% attested. Minor teardown timeout warnings. |

## Typed Gaps

| Dimension | Severity | AC Ref | Statement |
|---|---|---|---|
| outcome | major | — | The plan's P2 task (task-retire-superseded-integrate-criteria-apply-the-main-guard) is approved but has no evidence. AC-INT-2 part (4) has not been retired, and lore verify, lore rule apply, the setup re-run and the archiving of task-checking-out-main-in-a-nested-worktree-blocks-every are all unproven. |
| evidence_integrity | minor | AC-MG-1 | The final verification runs ([36]-[38]) log 'close timed out after 10000ms' after the tests pass, which points to a teardown or handle-leak problem in the test runner. |

## Typed Recommendations

| Target | Action | Rationale |
|---|---|---|
| process | Do not close the plan until the P2 corpus task records evidence for lore verify, lore rule apply, the setup --project re-run and the archive. | Plan scope includes P2. Its absence leaves stale criteria pinning integrate steps that were removed. |
| process | Make assessment bundles include the full implementation diff, not just the last commit. | Auditors cannot inspect the hook, integrate or setup code that was judged. |

## Unverifiable Materials

- Implementation diff for assets/project/reference-transaction, hooks/reference-transaction, integrate-service.ts and setup: Not included in the provided diff, so code quality cannot be judged directly.
- P2 corpus task outputs: No evidence was recorded for the task.
- scope_fidelity dimension score: based_on="absence" cited no matching unverifiable[]/judgment.truncated[] entry — suppressed as ungrounded rather than published as a finding.

## Finding Path Verification

- Checked (confirmed present at the assessed commit): 0
- Unverifiable (confirmed absent — finding withdrawn): 0
- Unchecked (NO assessed-commit referent — NOT verified; do not read as "fine"): 0

## Rubric Warnings

- Dimension "scope_fidelity" scored based_on="absence" but no matching entry was found in unverifiable[] or judgment.truncated[] — the absence claim is ungrounded.

## Facts Summary

- AC coverage: 4 declared criteria
- Task evidence: 2 tasks
- AC scope: 0 scoped, 0 dangling
- Knowledge capture: 0 docs (bundle)
- Regression: tests_touched=true, attested_evidence_ratio=0.77
