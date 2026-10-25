---
id: KN-689
type: knowledge
role: knowledge
title: "Assessment: Always-loaded lore fragments state the rule only (2026-10-16)"
status: archived
priority: medium
created: 2026-10-16
updated: 2026-10-23
tags: []
parent: PLAN-187
links:
  - {id: PLAN-187, type: informs}
---
# Assessment: partially_met (78/100)

Scope: plan `01M4ZZ4TBZK3AHVXM4MH45ZZSY`

## AC Scores

| AC | Score | Reasoning | Evidence |
|---|---|---|---|
| AC-RW-1 | 88 | Final task (drop-explanation) records attested pass: fragments check ok, assets-ssot 246/246. The 7 attested fails are earlier worktree rules_drift and the first reword's 5 failing tests; each was fixed and re-run green. | task-drop-the-explanation-the-traceability-pass-over-restored (evidence [4],[5]), task-traceability-pass-over-the-ten-fragments-classify-every (fails [2],[5] then pass [6]) |
| AC-RW-2 | 85 | Measured 11391 B, under the 14328 B b049f0ab baseline, and the value is printed. The ceiling moved 10000 → 10400 → baseline over the plan. The move was a user decision via an audited correction (not shown here), so I accept it. | task-drop-the-explanation-the-traceability-pass-over-restored (evidence [6]: 11391 B), task-restore-the-remaining-clauses-the-assessment-named-and (user decision on ceiling) |
| AC-RW-4 | 92 | Attested grep pass on all ten fragments. A red run on the original text caught the dated measurement in feed and worktree-dispatch (reword task [3]), so the regex is proven able to fail. | task-drop-the-explanation-the-traceability-pass-over-restored (evidence [7]), task-reword-the-ten-always-loaded-fragments-to-the-rule-only (expected-fail [3]) |
| AC-RW-3 | 86 | Attested pass: 166 items, 10 files, ok. A mangled-table red control exited non-zero. Limit: the oracle does not check that DROPPED text is actually absent, or that the table covers every clause at b049f0ab rather than a chosen subset. | task-drop-the-explanation-the-traceability-pass-over-restored (evidence [1] red, [2],[8] pass) |
| AC-RW-5 | 68 | Independent opus grader via captured claude -p (the editor was sonnet), plus a planted red control: a real step forward. But the prompt feeds the editor's drop_reason to the grader, the red input file is unseen, and some drops are borderline (user-is-router, 'weaken the rule, build a tie'). | task-drop-the-explanation-the-traceability-pass-over-restored (evidence [9] pass, [10],[12] red control), task-traceability-pass-over-the-ten-fragments-classify-every (manual transcription [13], weaker) |

## Gaps

- The red control's validity depends on gp-red-in.txt having 'Run `lore done` BEFORE `git branch -d`' removed from the current worktree-dispatch text; that construction is not shown, and the captured tails do not show the wd-ctrl verdict or the final FAIL line.
- Borderline drops in assets/context/corpus-workflow-1-feed.md ('the user is the router', 'rendering your own outgoing ticket does not charge you with its next-steps') and assets/context/ac-design.md ('(weaken the rule, build a tie)') carry routing, scope or method content.
- packages/lore/tests/unit/assets-ssot.test.ts RE-BASELINE comments for the feed fragment say the traceability pass restored the user-is-router rule, then claim every instruction is kept while that clause is dropped.

## Recommendations

- For AI-rubric ACs graded by an independent model, give the grader only the before/current text and the dropped span, without the editor's drop_reason; compare reasons afterward.
- Extend AC-RW-3 to assert that each DROPPED phrase is absent from the current fragment and that table coverage is derived mechanically from b049f0ab clauses.
- Version the red-control builder script with the green builder, and require the captured tail to include the planted id's verdict line.

## Judgment

- Provider: claude-cli
- Prompt version: 8
- Reproducible: yes (this prompt_version's rendering is guaranteed byte-identical)
- Duration: 54801ms
- Retried: false
- Truncated sections: diff:.claude/rules/lore-ac-design.md, diff:.claude/rules/lore-corpus-workflow-close.md, diff:.claude/rules/lore-corpus-workflow-execute.md, diff:.claude/rules/lore-corpus-workflow-feed.md, diff:.claude/rules/lore-project-scoped-oracles-in-worktrees.md, diff:.claude/rules/lore-worktree-dispatch.md, diff:.lore/context/scoped-oracles-in-worktrees.md, diff:assets/context/ac-design.md, diff:assets/context/corpus-workflow-1-feed.md, diff:assets/context/corpus-workflow-3-execute.md, diff:assets/context/corpus-workflow-4-close.md, diff:assets/context/worktree-dispatch.md, diff:.claude/rules/lore-ac-design.md, diff:.claude/rules/lore-corpus-workflow-close.md, diff:.claude/rules/lore-corpus-workflow-execute.md, diff:.claude/rules/lore-corpus-workflow-feed.md, diff:.claude/rules/lore-corpus-workflow-overview.md, diff:.claude/rules/lore-corpus-workflow-produce.md, diff:.claude/rules/lore-project-scoped-oracles-in-worktrees.md, diff:.claude/rules/lore-worktree-dispatch.md, diff:.lore/context/scoped-oracles-in-worktrees.md, diff:assets/context/ac-design.md, diff:assets/context/corpus-workflow-0-overview.md, diff:assets/context/corpus-workflow-1-feed.md, diff:assets/context/corpus-workflow-2-produce.md, diff:assets/context/corpus-workflow-3-execute.md, diff:assets/context/corpus-workflow-4-close.md, diff:assets/context/worktree-dispatch.md, diff:.claude/rules/lore-ac-design.md, diff:.claude/rules/lore-corpus-workflow-close.md, diff:.claude/rules/lore-corpus-workflow-execute.md, diff:.claude/rules/lore-corpus-workflow-feed.md, diff:.claude/rules/lore-corpus-workflow-overview.md, diff:.claude/rules/lore-corpus-workflow-produce.md, diff:.claude/rules/lore-evidence-attestation.md, diff:.claude/rules/lore-project-scoped-oracles-in-worktrees.md, diff:.claude/rules/lore-worktree-dispatch.md, diff:.lore/context/scoped-oracles-in-worktrees.md, diff:assets/context/ac-design.md, diff:assets/context/corpus-workflow-0-overview.md, diff:assets/context/corpus-workflow-1-feed.md, diff:assets/context/corpus-workflow-2-produce.md, diff:assets/context/corpus-workflow-3-execute.md, diff:assets/context/corpus-workflow-4-close.md, diff:assets/context/evidence-attestation.md, diff:assets/context/worktree-dispatch.md, diff:packages/lore/tests/fixtures/context-variables/pre-change-rules/corpus-workflow-feed.md, diff:packages/lore/tests/fixtures/context-variables/pre-change-rules/corpus-workflow-produce.md, diff:packages/lore/tests/fixtures/context-variables/pre-change-rules/evidence-attestation.md, diff:packages/lore/tests/fixtures/context-variables/pre-change-rules/worktree-dispatch.md, diff:packages/lore/tests/unit/assets-ssot.test.ts, diff:.claude/rules/lore-corpus-workflow-close.md, diff:.claude/rules/lore-corpus-workflow-feed.md, diff:.claude/rules/lore-corpus-workflow-overview.md, diff:.claude/rules/lore-corpus-workflow-produce.md, diff:.claude/rules/lore-evidence-attestation.md, diff:assets/context/corpus-workflow-0-overview.md, diff:assets/context/corpus-workflow-1-feed.md, diff:assets/context/corpus-workflow-2-produce.md, diff:assets/context/corpus-workflow-4-close.md, diff:assets/context/evidence-attestation.md, diff:packages/lore/tests/fixtures/context-variables/pre-change-rules/corpus-workflow-close.md, diff:packages/lore/tests/fixtures/context-variables/pre-change-rules/corpus-workflow-feed.md, diff:packages/lore/tests/fixtures/context-variables/pre-change-rules/corpus-workflow-overview.md, diff:packages/lore/tests/fixtures/context-variables/pre-change-rules/corpus-workflow-produce.md, diff:packages/lore/tests/fixtures/context-variables/pre-change-rules/evidence-attestation.md, diff:packages/lore/tests/unit/assets-ssot.test.ts, diff:.claude/rules/lore-ac-design.md, diff:.claude/rules/lore-corpus-workflow-close.md, diff:.claude/rules/lore-corpus-workflow-execute.md, diff:.claude/rules/lore-corpus-workflow-feed.md, diff:.claude/rules/lore-corpus-workflow-produce.md, diff:.claude/rules/lore-evidence-attestation.md, diff:assets/context/ac-design.md, diff:assets/context/corpus-workflow-1-feed.md, diff:assets/context/corpus-workflow-2-produce.md, diff:assets/context/corpus-workflow-3-execute.md, diff:assets/context/corpus-workflow-4-close.md, diff:assets/context/evidence-attestation.md, diff:packages/lore/tests/fixtures/context-variables/pre-change-rules/ac-design.md, diff:packages/lore/tests/fixtures/context-variables/pre-change-rules/corpus-workflow-close.md, diff:packages/lore/tests/fixtures/context-variables/pre-change-rules/corpus-workflow-execute.md, diff:packages/lore/tests/fixtures/context-variables/pre-change-rules/corpus-workflow-feed.md, diff:packages/lore/tests/fixtures/context-variables/pre-change-rules/corpus-workflow-produce.md, diff:packages/lore/tests/fixtures/context-variables/pre-change-rules/evidence-attestation.md, diff:packages/lore/tests/unit/assets-ssot.test.ts

## Dimension Scores

| Dimension | Score | Confidence (self-reported, uncalibrated) | Based On | Reasoning |
|---|---|---|---|---|
| outcome | 78 | 0.6 | evidence | Script ACs green with red controls. AC-RW-5 passes with an independent grader, but a few drops remain arguable instruction/qualifier content. |
| evidence_integrity | 72 | 0.6 | evidence | 96% attested and the grader output is captured, but the grader is primed with drop_reason, the red input is unseen, and earlier manual AC-RW-5 passes were refuted. |
| scope_fidelity | 86 | 0.7 | evidence | Changes are confined to the ten fragments, rendered rules, manifest, fixtures and SSOT hashes. The criterion correction was user-decided and logged. |

## Typed Gaps

| Dimension | Severity | AC Ref | Statement |
|---|---|---|---|
| evidence_integrity | minor | AC-RW-5 | The red control's validity depends on gp-red-in.txt having 'Run `lore done` BEFORE `git branch -d`' removed from the current worktree-dispatch text; that construction is not shown, and the captured tails do not show the wd-ctrl verdict or the final FAIL line. |
| outcome | minor | AC-RW-5 | Borderline drops in assets/context/corpus-workflow-1-feed.md ('the user is the router', 'rendering your own outgoing ticket does not charge you with its next-steps') and assets/context/ac-design.md ('(weaken the rule, build a tie)') carry routing, scope or method content. |
| scope_fidelity | minor | — | packages/lore/tests/unit/assets-ssot.test.ts RE-BASELINE comments for the feed fragment say the traceability pass restored the user-is-router rule, then claim every instruction is kept while that clause is dropped. |

## Typed Recommendations

| Target | Action | Rationale |
|---|---|---|
| process | For AI-rubric ACs graded by an independent model, give the grader only the before/current text and the dropped span, without the editor's drop_reason; compare reasons afterward. | Removes the anchoring bias that weakens independence. |
| spec | Extend AC-RW-3 to assert that each DROPPED phrase is absent from the current fragment and that table coverage is derived mechanically from b049f0ab clauses. | The current oracle cannot detect an incomplete or mislabeled table. |
| process | Version the red-control builder script with the green builder, and require the captured tail to include the planted id's verdict line. | Makes the red control auditable instead of inferred from a grep exit code. |

## Unverifiable Materials

- gp-red-in.txt construction: Not shown; can't confirm the planted instruction was removed from the current text given to the grader.
- knowledge-traceability-table-always-loaded-lore-fragments v3 content: Table JSON not provided; per-item DROPPED classifications can't be independently re-graded.
- Final fragment files (assets/context/*, .lore/context/scoped-oracles-in-worktrees.md): Omitted from diff; judged via fixture mirrors only.

## Finding Path Verification

- Checked (confirmed present at the assessed commit): 4
- Unverifiable (confirmed absent — finding withdrawn): 1
- Unchecked (NO assessed-commit referent — NOT verified; do not read as "fine"): 0

## Withdrawn Findings (Path Verification)

1 finding(s) below were EXCLUDED from ac_scores/typed_gaps/gaps because a path they declared does not exist at the assessed commit. overall_score above is NOT recomputed to account for their removal.

- [major] grade_prompt.py serializes each DROPPED item including the editor's drop_reason, so the 'independent' grader sees the editor's argument for EXPLANATION before judging, which biases the verdict. — "grade_prompt.py" not found at commit 8f065f43f8869589af8be6d69bb663ca25c39966

## Facts Summary

- AC coverage: 5 declared criteria
- Task evidence: 5 tasks
- AC scope: 0 scoped, 0 dangling
- Knowledge capture: 5 docs (bundle)
- Regression: tests_touched=true, attested_evidence_ratio=0.96
