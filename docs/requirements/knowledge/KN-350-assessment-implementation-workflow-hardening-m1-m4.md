---
id: KN-350
type: knowledge
role: knowledge
title: "Assessment: Implementation — workflow hardening (M1-M4 from 2026-07-27 session review) (2026-07-29)"
status: approved
priority: medium
created: 2026-07-29
updated: 2026-07-29
tags: []
parent: PLAN-106
links:
  - {id: PLAN-106, type: informs}
---
# Assessment: met (81/100)

Scope: plan `01KYHRF83AQFRMEGZF1FJQZ3TN`

## AC Scores

| AC | Score | Reasoning | Evidence |
|---|---|---|---|
| AC-WH-1B | 88 | 2/2 attested passes at the exact bun-runner oracle; output tails name the actual assertions (RENDER-N1 distinct-glyph, RENDER-REG1/REG2 byte-identical pass/fail rendering). Strongest tail-level substantiation of any AC here. | task-t5-close-ac-wh-1-rendering-clause-oracle-coverage-assess (evidence [2],[8] name the render tests) |
| AC-WH-2 | 82 | 8 pass / 0 fail, 7 attested at the declared oracle; suite grew 41→48 tests at M2, consistent with new whitespace/empty cases. But no tail names a VALIDATION_ERROR or flag-naming assertion, so the clause text is unverified — only counts are visible. | task-m2-claim-worktree-empty-string-validation-ac-wh-2 (evidence [1]-[4]; tails show counts only) |
| AC-WH-3 | 79 | 5 pass / 0 fail, 4 attested; done-command suite appears (8 tests, later 13) and service suite grows 48→62. No tail evidences the dependent-task ready:true flip, audit-row-per-step, or idempotent second call — the AC's hardest clauses are count-only. | task-m3-lore-done-verb-atomic-evidence-validated-lifecycle-walk (evidence [1],[5]) |
| AC-WH-4 | 80 | 6 attested passes with tails naming HAPPY (git-common-dir, no symlinks) and REGRESSION (primary checkout) tests. One attested fail on record (T6 [5]) — a stale-binary guard, i.e. tooling not behavior — superseded by a pass in the same task ([9]). | task-m4-worktree-corpus-resolution-via-git-common-dir-fallback (evidence [1],[6]), task-t6-formatworkflowbadge-non-fail-is-green-classification (evidence [5] fail (stale binary), [9] pass) |
| AC-WH-1 | 80 | 7 pass / 0 fail, 6 attested across all four enumerated read-site suites. M1 alone missed the rendering clause and shipped a non-fail-is-green badge bug; assessment + T5/T6 closed both. Now evidenced, but tails show counts only for the classification suites. | task-m1-evidence-result-vocabulary-expected-fail-ac-wh-1 (initial close was incomplete), task-t6-formatworkflowbadge-non-fail-is-green-classification (real classification bug found and fixed), task-t5-close-ac-wh-1-rendering-clause-oracle-coverage-assess (evidence [7] four-suite run, 116 tests) |

## Gaps

- The AC-WH-3 oracle names two test files but earlier runs (M1/M2/M4 evidence [5]) show only task-workflow-service.test.ts executing, yet the runner reported green. A missing suite path produced a passing run; only orchestrator judgment marked it inconclusive. Any AC whose oracle spans multiple paths can be silently under-run.
- For AC-WH-2, AC-WH-3 and AC-WH-1 the captured output_tail is the vitest summary block (file/test counts) with no assertion names. Clause-level claims — flag-naming VALIDATION_ERROR, per-step audit rows, dependent ready:true, idempotent no-op, non-green at each read site — cannot be confirmed from the record; only that N tests passed.
- M1 was archived with AC-WH-1 claimed while the distinct-rendering clause was unimplemented and formatWorkflowBadge classified expected-fail/inconclusive as green. T5 and T6 closed both, so the AC is now evidenced, but the original close was premature relative to the AC text.
- One attested e2e fail remains in the corpus (T6 evidence [5]): stale-binary guard tripped because the binary was not rebuilt after source changes. Behaviourally benign and superseded by a pass ([9]), but the failing record is unannotated and skews the AC's pass/fail ledger.
- No diff and tests_touched=false: implementation quality (e.g. that M3's walk reuses VALID_TRANSITIONS, that M4 adds no symlink path beyond the e2e's assertion) is asserted by task descriptions only, not verified from source.

## Recommendations

- Fail an oracle run when the test runner resolves fewer files than the command lists, instead of reporting green. Treat a zero-match path as a red result, not a pass.
- Capture AC-tagged test names in output_tail (grep the runner output for the AC id) rather than the trailing summary block, so each clause maps to a named passing assertion.
- For enum/vocabulary widening, make the RED phase emit the grep-derived consumer list as an artifact and require one assertion per listed consumer before the task may be closed.
- Gate compiled-binary e2e oracles behind an automatic rebuild (or record the guard failure as environmental) so tooling failures do not enter the AC pass/fail ledger.

## Judgment

- Provider: claude-cli
- Prompt version: 6
- Duration: 75849ms
- Retried: false
- Truncated sections: (none)

## Dimension Scores

| Dimension | Score | Confidence (self-reported, uncalibrated) | Based On | Reasoning |
|---|---|---|---|---|
| outcome | 83 | 0.7 | evidence | All five ACs have attested passes at their exact declared oracles; the one recorded fail is a build-staleness guard later superseded by a pass on the same suite. |
| evidence_integrity | 76 | 0.72 | evidence | 0.70 attested ratio, orchestrator-recorded not self-reported, and inconclusive/fail runs honestly logged. Weakened by count-only tails and a green run over a missing test file. |
| scope_fidelity | 88 | 0.75 | evidence | Six tasks map to the four planned mechanizations plus two assessment-driven AC-WH-1 closures. Anchor-overlap sequencing respected; AC-WH-1B added but declared on spec. |

## Typed Gaps

| Dimension | Severity | AC Ref | Statement |
|---|---|---|---|
| evidence_integrity | major | AC-WH-3 | The AC-WH-3 oracle names two test files but earlier runs (M1/M2/M4 evidence [5]) show only task-workflow-service.test.ts executing, yet the runner reported green. A missing suite path produced a passing run; only orchestrator judgment marked it inconclusive. Any AC whose oracle spans multiple paths can be silently under-run. |
| evidence_integrity | major | — | For AC-WH-2, AC-WH-3 and AC-WH-1 the captured output_tail is the vitest summary block (file/test counts) with no assertion names. Clause-level claims — flag-naming VALIDATION_ERROR, per-step audit rows, dependent ready:true, idempotent no-op, non-green at each read site — cannot be confirmed from the record; only that N tests passed. |
| outcome | minor | AC-WH-1 | M1 was archived with AC-WH-1 claimed while the distinct-rendering clause was unimplemented and formatWorkflowBadge classified expected-fail/inconclusive as green. T5 and T6 closed both, so the AC is now evidenced, but the original close was premature relative to the AC text. |
| outcome | minor | AC-WH-4 | One attested e2e fail remains in the corpus (T6 evidence [5]): stale-binary guard tripped because the binary was not rebuilt after source changes. Behaviourally benign and superseded by a pass ([9]), but the failing record is unannotated and skews the AC's pass/fail ledger. |
| outcome | minor | — | No diff and tests_touched=false: implementation quality (e.g. that M3's walk reuses VALID_TRANSITIONS, that M4 adds no symlink path beyond the e2e's assertion) is asserted by task descriptions only, not verified from source. |

## Typed Recommendations

| Target | Action | Rationale |
|---|---|---|
| process | Fail an oracle run when the test runner resolves fewer files than the command lists, instead of reporting green. Treat a zero-match path as a red result, not a pass. | AC-WH-3's oracle ran green over a suite that did not exist yet; only a human-in-the-loop inconclusive mark caught it. |
| process | Capture AC-tagged test names in output_tail (grep the runner output for the AC id) rather than the trailing summary block, so each clause maps to a named passing assertion. | AC-WH-1B and AC-WH-4 tails are auditable; the other three ACs' tails prove only that some N tests passed. |
| plan | For enum/vocabulary widening, make the RED phase emit the grep-derived consumer list as an artifact and require one assertion per listed consumer before the task may be closed. | M1's instruction to grep consumers was not mechanized; formatWorkflowBadge escaped and needed T6. |
| process | Gate compiled-binary e2e oracles behind an automatic rebuild (or record the guard failure as environmental) so tooling failures do not enter the AC pass/fail ledger. | AC-WH-4 shows 1 attested fail that is a stale-build guard, not a behavioural regression. |

## Unverifiable Materials

- Implementation diff / changed-file list: diff_available=false and tests_touched=false; no source for the enum change, done verb, worktree fallback, or badge fix could be inspected.
- Test bodies for task-workflow-service.test.ts, done-command.test.ts, ac-service.test.ts, evidence-panel.test.ts, tree-claim-badge.test.ts: Only aggregate pass counts appear in output tails; assertion content backing AC-WH-2, AC-WH-3 and AC-WH-1 clauses is not visible.
- The two linked knowledge docs (retro, assessment): Referenced by id in task descriptions but their contents were not included in the bundle.

## Facts Summary

- AC coverage: 5 declared criteria
- Task evidence: 6 tasks
- AC scope: 0 scoped, 0 dangling
- Knowledge capture: 2 docs (bundle)
- Regression: tests_touched=false, attested_evidence_ratio=0.70
