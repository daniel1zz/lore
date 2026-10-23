---
id: KN-690
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
# Assessment: met (81/100)

Scope: plan `01M4ZZ4TBZK3AHVXM4MH45ZZSY`

## AC Scores

| AC | Score | Reasoning | Evidence |
|---|---|---|---|
| AC-RW-1 | 90 | The final runs of the AC command passed: fragments check ok and assets-ssot 246 passed. Seven earlier fails were rules_drift in worktrees before `lore context refresh`, and each was fixed and re-run green. The final task's manifest and fixture diffs are consistent with each other. | task-drop-the-explanation-the-traceability-pass-over-restored (evidence [5] AC-RW-1 PASS, 246 passed), task-traceability-pass-over-the-ten-fragments-classify-every ([2],[5] drift fails, then [6] pass) |
| AC-RW-2 | 85 | Measured 11391 B against the 14328 B ceiling at b049f0ab, so the total shrank by about 2.9 KB and the value was reported. The ceiling was relaxed from 10000 under a recorded user decision. Red was attested in the reword task at exactly 14328 B. The AC only forbids growth, so it is a weak target. | task-drop-the-explanation-the-traceability-pass-over-restored (evidence [6] 11391 B), task-reword-the-ten-always-loaded-fragments-to-the-rule-only ([2] expected-fail at 14328 B) |
| AC-RW-4 | 92 | A red run was attested on the original text (dated measurement lines matched), and every later run passes, including in the final task. The grep is narrow, but it matches the statement exactly. | task-reword-the-ten-always-loaded-fragments-to-the-rule-only ([3] expected-fail, [6] pass), task-drop-the-explanation-the-traceability-pass-over-restored ([7] pass) |
| AC-RW-3 | 88 | The AC command, run against the corpus table, reports 166 items, 10 files, ok. A red run on a mangled table was recorded as expected-fail. The check is mechanical: it confirms each KEPT phrase is present, but it cannot judge whether the table is complete for every clause at b049f0ab. | task-drop-the-explanation-the-traceability-pass-over-restored ([1] expected-fail mangled table, [8] AC command pass) |
| AC-RW-5 | 72 | An independent `claude -p --model opus` grader returned PASS, and a red-input run was recorded as expected-fail. Weaknesses: the main agent wrote the grader prompt (grade_prompt.py, not shown); the grader is likely the same model family as the editor; and an earlier manual PASS was later shown wron… | task-drop-the-explanation-the-traceability-pass-over-restored ([9] grader PASS, [10] red-input expected-fail), task-reword-the-ten-always-loaded-fragments-to-the-rule-only ([19] manual PASS later disproved by assessment -1) |

## Gaps

- assets/context/ac-design.md drops '(weaken the rule, build a tie)' after 'Make every oracle go red once'. That parenthetical tells the reader how to produce a red run, so it is arguably an instruction, not pure explanation. The task allowed dropping it only if it was pure explanation.
- assets/context/corpus-workflow-1-feed.md drops 'the user is the router' and '(rendering your own outgoing ticket does not charge you with its next-steps)'. Both are scope rules that are only partly covered by other text.
- The AC-RW-5 grader was claude -p --model opus fed a prompt built by the main agent's scratchpad grade_prompt.py, which is not in the materials. The spec prefers a different model. The red-input run's output is cut off before any INSTRUCTION verdict.
- The reword task's manual AC-RW-5 PASS was disproved by assessment -1 but still counts in the AC-RW-5 pass total (3 pass, 1 attested).

## Recommendations

- For ai-rubric ACs, use a grader from a different model family than the editor, and store the exact grader prompt as evidence next to the verdict.
- When a later assessment disproves an earlier manual evidence row, mark that row superseded so AC coverage counts only valid passes.
- Add 'example of how to perform a rule' to AC-RW-5's INSTRUCTION category, so method examples like '(weaken the rule, build a tie)' are classified consistently.

## Judgment

- Provider: claude-cli
- Prompt version: 8
- Reproducible: yes (this prompt_version's rendering is guaranteed byte-identical)
- Duration: 53362ms
- Retried: false
- Truncated sections: diff:.claude/rules/lore-ac-design.md, diff:.claude/rules/lore-corpus-workflow-close.md, diff:.claude/rules/lore-corpus-workflow-execute.md, diff:.claude/rules/lore-corpus-workflow-feed.md, diff:.claude/rules/lore-project-scoped-oracles-in-worktrees.md, diff:.claude/rules/lore-worktree-dispatch.md, diff:.lore/context/scoped-oracles-in-worktrees.md, diff:assets/context/ac-design.md, diff:assets/context/corpus-workflow-1-feed.md, diff:assets/context/corpus-workflow-3-execute.md, diff:assets/context/corpus-workflow-4-close.md, diff:assets/context/worktree-dispatch.md, diff:.claude/rules/lore-ac-design.md, diff:.claude/rules/lore-corpus-workflow-close.md, diff:.claude/rules/lore-corpus-workflow-execute.md, diff:.claude/rules/lore-corpus-workflow-feed.md, diff:.claude/rules/lore-corpus-workflow-overview.md, diff:.claude/rules/lore-corpus-workflow-produce.md, diff:.claude/rules/lore-project-scoped-oracles-in-worktrees.md, diff:.claude/rules/lore-worktree-dispatch.md, diff:.lore/context/scoped-oracles-in-worktrees.md, diff:assets/context/ac-design.md, diff:assets/context/corpus-workflow-0-overview.md, diff:assets/context/corpus-workflow-1-feed.md, diff:assets/context/corpus-workflow-2-produce.md, diff:assets/context/corpus-workflow-3-execute.md, diff:assets/context/corpus-workflow-4-close.md, diff:assets/context/worktree-dispatch.md, diff:.claude/rules/lore-ac-design.md, diff:.claude/rules/lore-corpus-workflow-close.md, diff:.claude/rules/lore-corpus-workflow-execute.md, diff:.claude/rules/lore-corpus-workflow-feed.md, diff:.claude/rules/lore-corpus-workflow-overview.md, diff:.claude/rules/lore-corpus-workflow-produce.md, diff:.claude/rules/lore-evidence-attestation.md, diff:.claude/rules/lore-project-scoped-oracles-in-worktrees.md, diff:.claude/rules/lore-worktree-dispatch.md, diff:.lore/context/scoped-oracles-in-worktrees.md, diff:assets/context/ac-design.md, diff:assets/context/corpus-workflow-0-overview.md, diff:assets/context/corpus-workflow-1-feed.md, diff:assets/context/corpus-workflow-2-produce.md, diff:assets/context/corpus-workflow-3-execute.md, diff:assets/context/corpus-workflow-4-close.md, diff:assets/context/evidence-attestation.md, diff:assets/context/worktree-dispatch.md, diff:packages/lore/tests/fixtures/context-variables/pre-change-rules/corpus-workflow-feed.md, diff:packages/lore/tests/fixtures/context-variables/pre-change-rules/corpus-workflow-produce.md, diff:packages/lore/tests/fixtures/context-variables/pre-change-rules/evidence-attestation.md, diff:packages/lore/tests/fixtures/context-variables/pre-change-rules/worktree-dispatch.md, diff:packages/lore/tests/unit/assets-ssot.test.ts, diff:.claude/rules/lore-corpus-workflow-close.md, diff:.claude/rules/lore-corpus-workflow-feed.md, diff:.claude/rules/lore-corpus-workflow-overview.md, diff:.claude/rules/lore-corpus-workflow-produce.md, diff:.claude/rules/lore-evidence-attestation.md, diff:assets/context/corpus-workflow-0-overview.md, diff:assets/context/corpus-workflow-1-feed.md, diff:assets/context/corpus-workflow-2-produce.md, diff:assets/context/corpus-workflow-4-close.md, diff:assets/context/evidence-attestation.md, diff:packages/lore/tests/fixtures/context-variables/pre-change-rules/corpus-workflow-close.md, diff:packages/lore/tests/fixtures/context-variables/pre-change-rules/corpus-workflow-feed.md, diff:packages/lore/tests/fixtures/context-variables/pre-change-rules/corpus-workflow-overview.md, diff:packages/lore/tests/fixtures/context-variables/pre-change-rules/corpus-workflow-produce.md, diff:packages/lore/tests/fixtures/context-variables/pre-change-rules/evidence-attestation.md, diff:packages/lore/tests/unit/assets-ssot.test.ts, diff:.claude/rules/lore-ac-design.md, diff:.claude/rules/lore-corpus-workflow-close.md, diff:.claude/rules/lore-corpus-workflow-execute.md, diff:.claude/rules/lore-corpus-workflow-feed.md, diff:.claude/rules/lore-corpus-workflow-produce.md, diff:.claude/rules/lore-evidence-attestation.md, diff:assets/context/ac-design.md, diff:assets/context/corpus-workflow-1-feed.md, diff:assets/context/corpus-workflow-2-produce.md, diff:assets/context/corpus-workflow-3-execute.md, diff:assets/context/corpus-workflow-4-close.md, diff:assets/context/evidence-attestation.md, diff:packages/lore/tests/fixtures/context-variables/pre-change-rules/ac-design.md, diff:packages/lore/tests/fixtures/context-variables/pre-change-rules/corpus-workflow-close.md, diff:packages/lore/tests/fixtures/context-variables/pre-change-rules/corpus-workflow-execute.md, diff:packages/lore/tests/fixtures/context-variables/pre-change-rules/corpus-workflow-feed.md, diff:packages/lore/tests/fixtures/context-variables/pre-change-rules/corpus-workflow-produce.md, diff:packages/lore/tests/fixtures/context-variables/pre-change-rules/evidence-attestation.md, diff:packages/lore/tests/unit/assets-ssot.test.ts
- Reasoning clipped for: AC-RW-5

## Dimension Scores

| Dimension | Score | Confidence (self-reported, uncalibrated) | Based On | Reasoning |
|---|---|---|---|---|
| outcome | 82 | 0.65 | evidence | The final fragments are rule-only and about 2.9 KB smaller. In the diff, almost every drop is a reason or consequence. One how-to example ('weaken the rule, build a tie') may be lost. |
| evidence_integrity | 75 | 0.6 | evidence | Script ACs have attested red/green records. AC-RW-5 depends on a grader prompt the main agent wrote, likely from the same model family, and a manual pass that was later disproved still counts. |
| scope_fidelity | 88 | 0.7 | evidence | Changes are confined to the ten fragments, the manifest, the fixtures and the re-baseline comments. Each follow-up task is traced to an assessment. Criterion changes are listed in the spec's Revision… |

## Typed Gaps

| Dimension | Severity | AC Ref | Statement |
|---|---|---|---|
| outcome | minor | AC-RW-5 | assets/context/ac-design.md drops '(weaken the rule, build a tie)' after 'Make every oracle go red once'. That parenthetical tells the reader how to produce a red run, so it is arguably an instruction, not pure explanation. The task allowed dropping it only if it was pure explanation. |
| outcome | minor | AC-RW-5 | assets/context/corpus-workflow-1-feed.md drops 'the user is the router' and '(rendering your own outgoing ticket does not charge you with its next-steps)'. Both are scope rules that are only partly covered by other text. |
| evidence_integrity | major | AC-RW-5 | The AC-RW-5 grader was claude -p --model opus fed a prompt built by the main agent's scratchpad grade_prompt.py, which is not in the materials. The spec prefers a different model. The red-input run's output is cut off before any INSTRUCTION verdict. |
| evidence_integrity | minor | AC-RW-5 | The reword task's manual AC-RW-5 PASS was disproved by assessment -1 but still counts in the AC-RW-5 pass total (3 pass, 1 attested). |

## Typed Recommendations

| Target | Action | Rationale |
|---|---|---|
| process | For ai-rubric ACs, use a grader from a different model family than the editor, and store the exact grader prompt as evidence next to the verdict. | Removes the risk of shared bias or prompt framing in a pass/fail decision that otherwise rests on a single run. |
| process | When a later assessment disproves an earlier manual evidence row, mark that row superseded so AC coverage counts only valid passes. | Disproved pass rows inflate coverage totals. |
| spec | Add 'example of how to perform a rule' to AC-RW-5's INSTRUCTION category, so method examples like '(weaken the rule, build a tie)' are classified consistently. | The current categories leave how-to examples ambiguous. |

## Unverifiable Materials

- grade_prompt.py / gp-in.txt / gp-red-in.txt: The grader prompt and the red-input content are not shown, so neutral framing and the planted item cannot be checked.
- knowledge-traceability-table-always-loaded-lore-fragments v3 content: The DROPPED reasons and the completeness of the table against b049f0ab are not shown.
- .lore/context/scoped-oracles-in-worktrees.md diff: The so-2b drop is not visible in the materials.

## Finding Path Verification

- Checked (confirmed present at the assessed commit): 2
- Unverifiable (confirmed absent — finding withdrawn): 0
- Unchecked (NO assessed-commit referent — NOT verified; do not read as "fine"): 0

## Facts Summary

- AC coverage: 5 declared criteria
- Task evidence: 5 tasks
- AC scope: 0 scoped, 0 dangling
- Knowledge capture: 4 docs (bundle)
- Regression: tests_touched=true, attested_evidence_ratio=0.96
