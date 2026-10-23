---
id: KN-687
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
# Assessment: met (80/100)

Scope: plan `01M4ZZ4TBZK3AHVXM4MH45ZZSY`

## AC Scores

| AC | Score | Reasoning | Evidence |
|---|---|---|---|
| AC-RW-1 | 92 | In the close-out task, attested run [4] shows `lore fragments check` ok and 246/246 assets-ssot tests passing, with the PASS line. The 7 failures were all earlier rules_drift renders and were fixed in the same tasks by `lore context refresh`. | task-close-out-keep-the-three-borderline-clauses-and-fix-the (evidence [3],[4]), task-traceability-pass-over-the-ten-fragments-classify-every (fails [2],[5] then pass [6],[9]) |
| AC-RW-2 | 85 | The final measurement is 11571 B, under the 14328 B baseline (about 19% smaller), and the value is reported. The ceiling was lowered from 10000 to the baseline by a user-sanctioned audited correction, so the AC now only checks that the rules did not grow. | task-close-out-keep-the-three-borderline-clauses-and-fix-the (evidence [5] 11571 B), task-restore-the-remaining-clauses-the-assessment-named-and (ceiling-yield decision) |
| AC-RW-4 | 90 | The grep oracle passes in every task, and the red run in the reword task found the measured/incident lines before the change. Its scope is regex-limited: it only catches the listed patterns, not every kind of narrative. | task-reword-the-ten-always-loaded-fragments-to-the-rule-only (red [3], green [6]), task-close-out-keep-the-three-borderline-clauses-and-fix-the (evidence [6]) |
| AC-RW-3 | 82 | Final run: 166 items, 10 files, ok. Mangled and empty-table red runs were recorded. A known limit is acknowledged: a KEPT phrase only has to be present, not cover the whole clause. ac-1h's parenthetical slipped through this way and was caught only by assessment -6. | task-close-out-keep-the-three-borderline-clauses-and-fix-the (evidence [7]), task-drop-the-explanation-the-traceability-pass-over-restored (red [1], green [2]) |
| AC-RW-5 | 70 | A blind grader on a different model (opus vs sonnet editor), run via `claude -p`, was captured and attested as PASS, with a planted red control. Gaps: grade_prompt's EXPLANATION class is wider than the AC rubric (it adds consequence and second reason). The control only checks for no exact PASS line… | task-close-out-keep-the-three-borderline-clauses-and-fix-the (evidence [8] pass, [9] expected-fail control), task-reword-the-ten-always-loaded-fragments-to-the-rule-only (refuted manual pass [19]) |

## Gaps

- The AC-RW-5 grader prompt widens EXPLANATION beyond the spec rubric by adding 'consequence (why something happens)' and 'a second reason beyond one scope-setting reason'. A dropped condition worded as a reason could therefore pass.
- The red control is judged expected-fail only because the output lacks an exact 'AC-RW-5 PASS' line. A grader crash or formatting drift would also produce that result. Nothing asserts that 'AC-RW-5 FAIL: wd-ctrl' was emitted for the planted needle in assets/context/worktree-dispatch.md.
- A KEPT status needs only a substring match. A clause shortened under KEPT, like ac-1h in assets/context/ac-design.md, escapes both AC-RW-3 and the AC-RW-5 grader.
- The execute and close RE-BASELINE comments in packages/lore/tests/unit/assets-ssot.test.ts still claim 'every instruction, condition and qualifier is kept'. That is the same self-assertion that proved false for feed and had to be corrected there.

## Recommendations

- Bring the AC-RW-5 rubric and the grader prompt's EXPLANATION definition into exact agreement, by an audited correction or by changing the prompt.
- Red controls for AI-rubric ACs must grep for the exact expected FAIL line naming the planted id, not just for the absence of PASS.
- Keep grader scripts in the repo, or record their sha256 in the evidence command.

## Judgment

- Provider: claude-cli
- Prompt version: 8
- Reproducible: yes (this prompt_version's rendering is guaranteed byte-identical)
- Duration: 58672ms
- Retried: false
- Truncated sections: diff:.claude/rules/lore-ac-design.md, diff:.claude/rules/lore-corpus-workflow-feed.md, diff:assets/context/ac-design.md, diff:assets/context/corpus-workflow-1-feed.md, diff:.claude/rules/lore-ac-design.md, diff:.claude/rules/lore-corpus-workflow-close.md, diff:.claude/rules/lore-corpus-workflow-execute.md, diff:.claude/rules/lore-corpus-workflow-feed.md, diff:.claude/rules/lore-project-scoped-oracles-in-worktrees.md, diff:.claude/rules/lore-worktree-dispatch.md, diff:.lore/context/scoped-oracles-in-worktrees.md, diff:assets/context/ac-design.md, diff:assets/context/corpus-workflow-1-feed.md, diff:assets/context/corpus-workflow-3-execute.md, diff:assets/context/corpus-workflow-4-close.md, diff:assets/context/worktree-dispatch.md, diff:.claude/rules/lore-ac-design.md, diff:.claude/rules/lore-corpus-workflow-close.md, diff:.claude/rules/lore-corpus-workflow-execute.md, diff:.claude/rules/lore-corpus-workflow-feed.md, diff:.claude/rules/lore-corpus-workflow-overview.md, diff:.claude/rules/lore-corpus-workflow-produce.md, diff:.claude/rules/lore-project-scoped-oracles-in-worktrees.md, diff:.claude/rules/lore-worktree-dispatch.md, diff:.lore/context/scoped-oracles-in-worktrees.md, diff:assets/context/ac-design.md, diff:assets/context/corpus-workflow-0-overview.md, diff:assets/context/corpus-workflow-1-feed.md, diff:assets/context/corpus-workflow-2-produce.md, diff:assets/context/corpus-workflow-3-execute.md, diff:assets/context/corpus-workflow-4-close.md, diff:assets/context/worktree-dispatch.md, diff:.claude/rules/lore-ac-design.md, diff:.claude/rules/lore-corpus-workflow-close.md, diff:.claude/rules/lore-corpus-workflow-execute.md, diff:.claude/rules/lore-corpus-workflow-feed.md, diff:.claude/rules/lore-corpus-workflow-overview.md, diff:.claude/rules/lore-corpus-workflow-produce.md, diff:.claude/rules/lore-evidence-attestation.md, diff:.claude/rules/lore-project-scoped-oracles-in-worktrees.md, diff:.claude/rules/lore-worktree-dispatch.md, diff:.lore/context/scoped-oracles-in-worktrees.md, diff:assets/context/ac-design.md, diff:assets/context/corpus-workflow-0-overview.md, diff:assets/context/corpus-workflow-1-feed.md, diff:assets/context/corpus-workflow-2-produce.md, diff:assets/context/corpus-workflow-3-execute.md, diff:assets/context/corpus-workflow-4-close.md, diff:assets/context/evidence-attestation.md, diff:assets/context/worktree-dispatch.md, diff:packages/lore/tests/fixtures/context-variables/pre-change-rules/corpus-workflow-close.md, diff:packages/lore/tests/fixtures/context-variables/pre-change-rules/corpus-workflow-execute.md, diff:packages/lore/tests/fixtures/context-variables/pre-change-rules/corpus-workflow-feed.md, diff:packages/lore/tests/fixtures/context-variables/pre-change-rules/corpus-workflow-overview.md, diff:packages/lore/tests/fixtures/context-variables/pre-change-rules/corpus-workflow-produce.md, diff:packages/lore/tests/fixtures/context-variables/pre-change-rules/evidence-attestation.md, diff:packages/lore/tests/fixtures/context-variables/pre-change-rules/worktree-dispatch.md, diff:packages/lore/tests/unit/assets-ssot.test.ts, diff:.claude/rules/lore-corpus-workflow-close.md, diff:.claude/rules/lore-corpus-workflow-feed.md, diff:.claude/rules/lore-corpus-workflow-overview.md, diff:.claude/rules/lore-corpus-workflow-produce.md, diff:.claude/rules/lore-evidence-attestation.md, diff:assets/context/corpus-workflow-0-overview.md, diff:assets/context/corpus-workflow-1-feed.md, diff:assets/context/corpus-workflow-2-produce.md, diff:assets/context/corpus-workflow-4-close.md, diff:assets/context/evidence-attestation.md, diff:packages/lore/tests/fixtures/context-variables/pre-change-rules/corpus-workflow-close.md, diff:packages/lore/tests/fixtures/context-variables/pre-change-rules/corpus-workflow-feed.md, diff:packages/lore/tests/fixtures/context-variables/pre-change-rules/corpus-workflow-overview.md, diff:packages/lore/tests/fixtures/context-variables/pre-change-rules/corpus-workflow-produce.md, diff:packages/lore/tests/fixtures/context-variables/pre-change-rules/evidence-attestation.md, diff:packages/lore/tests/unit/assets-ssot.test.ts, diff:.claude/rules/lore-ac-design.md, diff:.claude/rules/lore-corpus-workflow-close.md, diff:.claude/rules/lore-corpus-workflow-execute.md, diff:.claude/rules/lore-corpus-workflow-feed.md, diff:.claude/rules/lore-corpus-workflow-produce.md, diff:.claude/rules/lore-evidence-attestation.md, diff:assets/context/ac-design.md, diff:assets/context/corpus-workflow-1-feed.md, diff:assets/context/corpus-workflow-2-produce.md, diff:assets/context/corpus-workflow-3-execute.md, diff:assets/context/corpus-workflow-4-close.md, diff:assets/context/evidence-attestation.md, diff:packages/lore/tests/fixtures/context-variables/pre-change-rules/ac-design.md, diff:packages/lore/tests/fixtures/context-variables/pre-change-rules/corpus-workflow-close.md, diff:packages/lore/tests/fixtures/context-variables/pre-change-rules/corpus-workflow-execute.md, diff:packages/lore/tests/fixtures/context-variables/pre-change-rules/corpus-workflow-feed.md, diff:packages/lore/tests/fixtures/context-variables/pre-change-rules/corpus-workflow-produce.md, diff:packages/lore/tests/fixtures/context-variables/pre-change-rules/evidence-attestation.md, diff:packages/lore/tests/unit/assets-ssot.test.ts
- Reasoning clipped for: AC-RW-5

## Dimension Scores

| Dimension | Score | Confidence (self-reported, uncalibrated) | Based On | Reasoning |
|---|---|---|---|---|
| outcome | 82 | 0.65 | evidence | All five ACs have attested passes on the final state; the fragments shrank about 19% and all lore commands survive. Six rounds of rework show early drops lost real rules, and the last ones were resto… |
| evidence_integrity | 72 | 0.6 | evidence | The grader runs were captured and the red runs recorded. But the control does not assert wd-ctrl, the grader rubric is looser than the AC, the scripts are unhashed and in /tmp, and a refuted manual p… |
| scope_fidelity | 86 | 0.7 | evidence | Changes are limited to the ten fragments, rendered rules, manifest, fixtures and re-baseline comments. The ceiling change went through an audited correction with user approval. |

## Typed Gaps

| Dimension | Severity | AC Ref | Statement |
|---|---|---|---|
| evidence_integrity | major | AC-RW-5 | The AC-RW-5 grader prompt widens EXPLANATION beyond the spec rubric by adding 'consequence (why something happens)' and 'a second reason beyond one scope-setting reason'. A dropped condition worded as a reason could therefore pass. |
| evidence_integrity | minor | AC-RW-5 | The red control is judged expected-fail only because the output lacks an exact 'AC-RW-5 PASS' line. A grader crash or formatting drift would also produce that result. Nothing asserts that 'AC-RW-5 FAIL: wd-ctrl' was emitted for the planted needle in assets/context/worktree-dispatch.md. |
| outcome | minor | AC-RW-3 | A KEPT status needs only a substring match. A clause shortened under KEPT, like ac-1h in assets/context/ac-design.md, escapes both AC-RW-3 and the AC-RW-5 grader. |
| evidence_integrity | minor | — | The execute and close RE-BASELINE comments in packages/lore/tests/unit/assets-ssot.test.ts still claim 'every instruction, condition and qualifier is kept'. That is the same self-assertion that proved false for feed and had to be corrected there. |

## Typed Recommendations

| Target | Action | Rationale |
|---|---|---|
| spec | Bring the AC-RW-5 rubric and the grader prompt's EXPLANATION definition into exact agreement, by an audited correction or by changing the prompt. | If the grader is more lenient than the criterion, its PASS does not establish the criterion. |
| process | Red controls for AI-rubric ACs must grep for the exact expected FAIL line naming the planted id, not just for the absence of PASS. | Missing PASS cannot be told apart from a grader error. |
| process | Keep grader scripts in the repo, or record their sha256 in the evidence command. | Without that, the evidence cannot be tied to the exact grader input that ran. |

## Unverifiable Materials

- Full output of the red-control grader run (close-out evidence [9]): The tail shown is truncated at the start, so the 'wd-ctrl' and final AC-RW-5 verdict lines are not visible.
- Current text of the ten fragments and the traceability table: They are omitted from the diff, so drop classifications can only be judged through the grader output.

## Finding Path Verification

- Checked (confirmed present at the assessed commit): 3
- Unverifiable (confirmed absent — finding withdrawn): 0
- Unchecked (NO assessed-commit referent — NOT verified; do not read as "fine"): 0

## Facts Summary

- AC coverage: 5 declared criteria
- Task evidence: 6 tasks
- AC scope: 0 scoped, 0 dangling
- Knowledge capture: 6 docs (bundle)
- Regression: tests_touched=true, attested_evidence_ratio=0.96
