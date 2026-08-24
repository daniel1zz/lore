---
id: KN-532
type: knowledge
role: knowledge
title: "Assessment: Retire SPEC-146's split debt — repoint the eight stale claude-md-check references, one of them a live error message (2026-08-24)"
status: approved
priority: medium
created: 2026-08-24
updated: 2026-08-24
tags: []
parent: PLAN-141
links:
  - {id: PLAN-141, type: informs}
---
> ⚠ INVALIDATED 2026-08-24T10:07:54.257Z — superseded by knowledge-assessment-retire-spec-146-s-split-debt-repoint-the-2; scope_fidelity 45 rested on a machine-checked FALSE indictment: it charged the diff with rewriting two CLAUDE.md files and four export-index entries, but the task's only commit a199d386 touches ZERO of either (git show --name-only). Cause: the diff was derived from 2 commits INCLUDING the --no-ff merge, whose other-parent diff sweeps in everything main gained since the branch point. Re-run with --diff-file scoped to a199d386: scope_fidelity 92, outcome 86.

# Assessment: inconclusive (N/A (fully truncated))

Scope: plan `01M0SJ54XVV9SFNNJZZ8NMCMP0`

## AC Scores

| AC | Score | Reasoning | Evidence |
|---|---|---|---|
| AC-SPLITDEBT-1 | 92 | Measured red first (unmarked=8 marked=4, exit 1), green after (unmarked=0 marked=4), plus an attested falsifier mutating claude-md-budget.ts back to red. Diff shows all 8 sites repointed and the 4 provenance markers intact. Typecheck green. | 01M0SJCHR5EQK4NHA90S3YE14T (evidence [1][2][5][11][12][13]) |
| AC-PURE-1 | 55 | Not a declared oracle run for this AC: purity script runs are recorded with ac_ref=(none), so coverage facts show 0 pass. Script did exit 0 after the edit ([10]) and a falsification run ([4]) confirmed the guard still fails on a missing target, but the AC is unlinked. | 01M0SJCHR5EQK4NHA90S3YE14T (evidence [3][4][10], ac_ref none) |
| AC-WIRE-1 | 0 | 0 pass / 0 fail. No evidence in this plan; out of the task's stated scope (comment/message-only repointing). | — |
| AC-WIRE-2 | 0 | 0 pass / 0 fail. No oracle run recorded. | — |
| AC-COMPOSE-1 | 0 | 0 pass / 0 fail. No oracle run recorded. | — |
| AC-SLUG-1 | 0 | 0 pass / 0 fail. No oracle run recorded. | — |
| AC-SLUG-2 | 0 | 0 pass / 0 fail. No oracle run recorded. | — |
| AC-EMPH-1 | 0 | 0 pass / 0 fail. No oracle run recorded. | — |
| AC-EMPH-2 | 0 | 0 pass / 0 fail. No oracle run recorded. | — |
| AC-GRAM-1 | 0 | 0 pass / 0 fail. No oracle run recorded. | — |
| AC-RULES-1 | 0 | 0 pass / 0 fail. No oracle run recorded. | — |
| AC-CONTRACT-1 | 0 | 0 pass / 0 fail. No oracle run recorded. | — |
| AC-ADV-1 | 0 | 0 pass / 0 fail. No oracle run recorded. | — |
| AC-TEMPLATE-1 | 0 | 0 pass / 0 fail. No oracle run recorded. | — |

## Gaps

- The diff carries edits far outside the plan's declared scope ('comments and one error-message string only'): extensive prose rewrites to CLAUDE.md and packages/core/src/CLAUDE.md (eviction pointer, new 'lore phase add|rm' governance finding, reworded invariants) plus four new .lore/export-index.json entries for unrelated docs (SPEC-147, KN-529, PLAN-140). None are explained by any evidence row.
- The plan names re-running AC-PURE-1's oracle as a required risk control after editing its message, and evidence [10] shows scripts/check-claude-md-purity.ts exiting 0 plus a falsification at [4]. Both rows are recorded with ac_ref=(none), so AC-PURE-1 shows 0 pass / 0 fail in coverage. The work was done; the linkage was not.
- The task table routes packages/lore/src/service/context-facts.ts:65 to claude-md-budget.ts, but the diff repoints it to claude-md-admission.ts. The admission target is the semantically correct one (the 'misses acceptable, false alarms are not' stance is an admission concern), so this is a documented-plan/implementation divergence resolved in the right direction — unexplained in the evidence trail.
- Evidence [6] ('bun run typecheck') and [9] ('typecheck:lore') are recorded result=fail, while [13] later records the same full typecheck as pass. No evidence row explains what changed between them, so a reader cannot tell whether the failure was pre-existing, transient, or fixed by an unrecorded edit.

## Recommendations

- Declare extra.ac_scope = [AC-SPLITDEBT-1, AC-PURE-1] on this plan. The plan prose already says AC-SPLITDEBT-1 is 'the single gate'; leaving ac_scope empty makes all 14 spec ACs formally in scope and produces 12 zero-evidence criteria that misrepresent delivery.
- Require every oracle run named in a task's 'Oracles to run' list to carry an ac_ref. The purity-script runs at [3]/[4]/[10] discharge a stated risk control but credit no criterion.
- Keep unrelated memory-file prose rewrites and .lore/export-index.json regenerations out of a task whose scope is 'comments and one error-message string only', or record them as a separate evidenced task.

## Judgment

- Provider: claude-cli
- Prompt version: 8
- Reproducible: yes (this prompt_version's rendering is guaranteed byte-identical)
- Duration: 123080ms
- Retried: true
- Truncated sections: spec, task:task-skill-implement-repoint-the-8-stale-claude-md-check
- Overall confidence: low (degraded by truncation)

## Dimension Scores

| Dimension | Score | Confidence (self-reported, uncalibrated) | Based On | Reasoning |
|---|---|---|---|---|
| outcome | 72 | 0.8 | evidence | The single declared gate AC-SPLITDEBT-1 is fully delivered and falsified. All 8 sites repointed correctly in the diff; the other 13 ACs carry no evidence at all. |
| evidence_integrity | 78 | 0.75 | evidence | Red-then-green with an attested falsifier is strong. Weakened by purity-script runs carrying ac_ref=(none) and an unexplained typecheck fail→pass transition at [6]/[9]→[13]. |
| scope_fidelity | 45 | 0.8 | evidence | Source edits match the 8 declared sites exactly. But the diff also rewrites two CLAUDE.md files and adds four export-index entries, none of which the plan authorises. |

## Typed Gaps

| Dimension | Severity | AC Ref | Statement |
|---|---|---|---|
| scope_fidelity | major | AC-SPLITDEBT-1 | The diff carries edits far outside the plan's declared scope ('comments and one error-message string only'): extensive prose rewrites to CLAUDE.md and packages/core/src/CLAUDE.md (eviction pointer, new 'lore phase add\|rm' governance finding, reworded invariants) plus four new .lore/export-index.json entries for unrelated docs (SPEC-147, KN-529, PLAN-140). None are explained by any evidence row. |
| evidence_integrity | major | AC-PURE-1 | The plan names re-running AC-PURE-1's oracle as a required risk control after editing its message, and evidence [10] shows scripts/check-claude-md-purity.ts exiting 0 plus a falsification at [4]. Both rows are recorded with ac_ref=(none), so AC-PURE-1 shows 0 pass / 0 fail in coverage. The work was done; the linkage was not. |
| outcome | minor | AC-SPLITDEBT-1 | The task table routes packages/lore/src/service/context-facts.ts:65 to claude-md-budget.ts, but the diff repoints it to claude-md-admission.ts. The admission target is the semantically correct one (the 'misses acceptable, false alarms are not' stance is an admission concern), so this is a documented-plan/implementation divergence resolved in the right direction — unexplained in the evidence trail. |
| evidence_integrity | minor | AC-SPLITDEBT-1 | Evidence [6] ('bun run typecheck') and [9] ('typecheck:lore') are recorded result=fail, while [13] later records the same full typecheck as pass. No evidence row explains what changed between them, so a reader cannot tell whether the failure was pre-existing, transient, or fixed by an unrecorded edit. |

## Typed Recommendations

| Target | Action | Rationale |
|---|---|---|
| plan | Declare extra.ac_scope = [AC-SPLITDEBT-1, AC-PURE-1] on this plan. The plan prose already says AC-SPLITDEBT-1 is 'the single gate'; leaving ac_scope empty makes all 14 spec ACs formally in scope and produces 12 zero-evidence criteria that misrepresent delivery. | Coverage facts show 12 ACs at 0/0 solely from a missing scope declaration, not from missing work. |
| process | Require every oracle run named in a task's 'Oracles to run' list to carry an ac_ref. The purity-script runs at [3]/[4]/[10] discharge a stated risk control but credit no criterion. | An unreferenced oracle run is invisible to computeAcCoverage — the risk control passes but the record does not show it. |
| process | Keep unrelated memory-file prose rewrites and .lore/export-index.json regenerations out of a task whose scope is 'comments and one error-message string only', or record them as a separate evidenced task. | Unexplained diff surface in a comment-only task defeats the auditability that made this AC cheap to verify. |

## Unverifiable Materials

- The current contents of packages/lore/src/service/claude-md-budget.ts, claude-md-admission.ts, claude-md-findings.ts: Not in the diff; the correctness of each repointed target rests on the grep-verified symbol map asserted in the task, which is not shown as a run.
- Full stdout of evidence [3], [4], [6], [9], [10], [13]: Only tail_bytes lengths are given for these rows, so the failure text at [6]/[9] and the new PurityCheckError wording at [4] cannot be read.

## Finding Path Verification

- Checked (confirmed present at the assessed commit): 5
- Unverifiable (confirmed absent — finding withdrawn): 0
- Unchecked (NO assessed-commit referent — NOT verified; do not read as "fine"): 0

## Facts Summary

- AC coverage: 14 declared criteria
- Task evidence: 1 tasks
- AC scope: 0 scoped, 0 dangling
- Knowledge capture: 0 docs (bundle)
- Regression: tests_touched=false, attested_evidence_ratio=0.85
