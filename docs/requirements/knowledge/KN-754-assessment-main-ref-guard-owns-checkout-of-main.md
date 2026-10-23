---
id: KN-754
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
# Assessment: partially_met (76/100)

Scope: plan `01M5A33JVQ2CS3F6TFVAAVHSRZ`

## AC Scores

| AC | Score | Reasoning | Evidence |
|---|---|---|---|
| AC-MG-1 | 87 | Red on base 79571711 [1]. A mutation (mainX) is caught [5]. Green runs [9][22][36] passed 12/12, including a re-verify in a separate worktree. The hook source and test body are not in the diff, so I can't confirm the exact 128 exit code or that worktree add leaves no entry. | task-the-main-ref-guard-refuses-checkout-of-main-integrate (evidence [1],[5],[9],[22],[36]) |
| AC-MG-2 | 86 | Red on base [2]. The byte-identity mutation is caught [6]. A further red [14] showed the guard ran after the fetch. That was fixed, and [15][37] passed 5/5. integrate-service.ts is not in the diff, so the injected version reader can't be inspected. | task-the-main-ref-guard-refuses-checkout-of-main-integrate (evidence [2],[6],[14],[15],[37]) |
| AC-MG-3 | 85 | Red on base [3]. A mutation that swaps the detach command is caught [7]. Green runs [11][23][38] passed 4/4. Neither the setup implementation nor the test body is in the diff, so I can't confirm the byte-identical-edits and no-file-change claims. | task-the-main-ref-guard-refuses-checkout-of-main-integrate (evidence [3],[7],[11],[23],[38]) |
| AC-MG-4 | 90 | The grep failed on base [4]. A drifted-copy mutation is caught by cmp [8]. The full cmp+grep chain passed in [12][24][39]. This is a direct, deterministic check of the shipped artefacts. | task-the-main-ref-guard-refuses-checkout-of-main-integrate (evidence [4],[8],[12],[24],[39]) |

## Gaps

- The P2 task task-retire-superseded-integrate-criteria-apply-the-main-guard is approved but has no evidence. Rewording AC-INT-2 part (4), lore verify, lore rule apply and archiving task-checking-out-main-in-a-nested-worktree-blocks-every are all unproven.

## Recommendations

- Before closing the plan, require P2 evidence: lore verify output, rule apply output, and an attested setup --project rerun.
- Assemble the audit diff from the plan's base commit (79571711) so implementation files are included.

## Judgment

- Provider: claude-cli
- Prompt version: 8
- Reproducible: yes (this prompt_version's rendering is guaranteed byte-identical)
- Duration: 27182ms
- Retried: false
- Truncated sections: (none)

## Dimension Scores

| Dimension | Score | Confidence (self-reported, uncalibrated) | Based On | Reasoning |
|---|---|---|---|---|
| outcome | 78 | 0.7 | evidence | All four ACs have red-then-green and mutation evidence. The P2 corpus phase has not been delivered or evidenced. |
| evidence_integrity | 85 | 0.75 | evidence | Strong trail: red on base, mutations caught, repeated green runs including a separate verify worktree. Two runs log 'close timed out'. The P2 task has no evidence. |

## Typed Gaps

| Dimension | Severity | AC Ref | Statement |
|---|---|---|---|
| outcome | major | — | The P2 task task-retire-superseded-integrate-criteria-apply-the-main-guard is approved but has no evidence. Rewording AC-INT-2 part (4), lore verify, lore rule apply and archiving task-checking-out-main-in-a-nested-worktree-blocks-every are all unproven. |

## Typed Recommendations

| Target | Action | Rationale |
|---|---|---|
| process | Before closing the plan, require P2 evidence: lore verify output, rule apply output, and an attested setup --project rerun. | Plan phases with no evidence cannot be audited. |
| process | Assemble the audit diff from the plan's base commit (79571711) so implementation files are included. | The current diff shows only incidental test edits. |

## Unverifiable Materials

- assets/project/reference-transaction, integrate-service.ts and setup implementation diffs: Not in the supplied diff. Implementation quality can only be inferred from the test evidence.
- P2 corpus changes and the archive of the nested-worktree task: No evidence or diff was provided for the P2 task.
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
- Knowledge capture: 1 docs (bundle)
- Regression: tests_touched=true, attested_evidence_ratio=0.77
