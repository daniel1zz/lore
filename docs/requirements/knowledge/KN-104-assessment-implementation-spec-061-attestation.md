---
id: KN-104
type: knowledge
role: knowledge
title: "Assessment: Implementation — SPEC-061 attestation completeness guard (2026-07-21)"
status: archived
priority: medium
created: 2026-07-21
updated: 2026-10-23
tags: []
parent: PLAN-065
links:
  - {id: PLAN-065, type: informs}
---
> ⚠ INVALIDATED 2026-07-21T09:41:58.324Z; Assessed against a wrong diff range (a2b697c..HEAD) that swept in all subsequent SPEC-062/063/046 work; its scope_fidelity 42 and the scope gaps are artifacts of orchestrator input error, not implementation drift. Superseded by a re-run on the correct SPEC-061-only range.

# Assessment: partially_met (73/100)

Scope: plan `01KY1N8XG2YY27CTX28WE6ZGWF`

## AC Scores

| AC | Score | Reasoning | Evidence |
|---|---|---|---|
| AC-061-1 | 92 | 3 pass / 0 fail, 2 attested. Filtered vitest run on packages/core/tests/attestation-completeness.test.ts shows 8 passed of 22, 1 test file — consistent with the declared single path. | 01KY1N8Y842ZAEHWZJCAJPMKF1 (T1 ev[11]), 01KY1Q5XCQDWBXCV4J2XCEXVJ1 (T2 ev[8]) |
| AC-061-2 | 92 | 3 pass / 0 fail, 2 attested; 5 passed of 22 under the parseExecutedUnits filter, 1 file executed vs 1 declared path. | 01KY1N8Y842ZAEHWZJCAJPMKF1 (ev[12]), 01KY1Q5XCQDWBXCV4J2XCEXVJ1 (ev[9]) |
| AC-061-3 | 92 | 3 pass / 0 fail, 2 attested; 9 passed of 22 under the judgeCompleteness filter. The four verdict branches are asserted only per the AC text — the module source is not in the diff. | 01KY1N8Y842ZAEHWZJCAJPMKF1 (ev[13]), 01KY1Q5XCQDWBXCV4J2XCEXVJ1 (ev[10]) |
| AC-061-4 | 88 | 3 pass / 0 fail, 2 attested (REPRO filter, 1 of 8 tests). Exit-code-3 claim rests on the test's own assertion; verify-runner-service.ts is truncated so the downgrade path itself was not reviewable. | 01KY1N8Y842ZAEHWZJCAJPMKF1 (ev[14]), 01KY1Q5XCQDWBXCV4J2XCEXVJ1 (ev[11]) |
| AC-061-5 | 88 | 3 pass / 0 fail, 2 attested (REGRESSION filter, 4 of 8 tests). Complete + unknown_runner regression shapes covered; service source unseen. | 01KY1N8Y842ZAEHWZJCAJPMKF1 (ev[15]), 01KY1Q5XCQDWBXCV4J2XCEXVJ1 (ev[12]) |
| AC-061-6 | 88 | 3 pass / 0 fail, 2 attested (2 of 8 tests). Task-path caller-supplied inconclusive rejection evidenced; TaskWorkflowService guard itself is not in the shown diff (only the phase-path twin is). | 01KY1N8Y842ZAEHWZJCAJPMKF1 (ev[16]), 01KY1Q5XCQDWBXCV4J2XCEXVJ1 (ev[13]) |
| AC-061-7 | 32 | Contradicted: 1 pass / 2 fail with 0 attested_pass and 2 attested_fail. Both attested runs report 'No test files found, exiting with code 1' — the declared path packages/core/tests/acceptance.test.ts does not exist. Mitigated only by the AC-061-8 restatement. | 01KY1N8Y842ZAEHWZJCAJPMKF1 (ev[17] fail), 01KY1Q5XCQDWBXCV4J2XCEXVJ1 (ev[14] fail) |
| AC-061-8 | 90 | 2 pass / 0 fail, 2 attested. packages/core/src/acceptance.test.ts runs 35 tests across exactly 1 file, matching the corrected single declared path. Note: it does not assert the 'byte-identical totals' half of AC-061-7. | 01KY1N8Y842ZAEHWZJCAJPMKF1 (ev[18]), 01KY1Q5XCQDWBXCV4J2XCEXVJ1 (ev[15]) |
| AC-061-G1 | 84 | 2 pass / 1 fail; the fail is a red-state run (no test file yet) followed by green (6 tests, 1 file) and a later attested pass. Guard code visible in phase-workflow-service.ts; byte-for-byte parity with the task path is asserted only inside the truncated test. | 01KY1Q5XCQDWBXCV4J2XCEXVJ1 (ev[1] fail, ev[3]/[16] pass) |
| AC-061-G2 | 90 | 3 pass / 0 fail, 2 attested; bun run reports 14 pass / 0 fail across 1 file, matching the declared 14-case suite. Badge logic (⚑? last-checked branch) is visible in ac.ts and matches the AC text. | 01KY1Q5XCQDWBXCV4J2XCEXVJ1 (ev[4] 14 pass, ev[17]) |

## Gaps

- The bundle diff contains three unrelated specs' work: SPEC-062 config write layer (config-editability.ts, config-routes.ts, ConfigService wiring, middleware refactor, dashboard route dispatch), SPEC-063 verify execution-root resolution (verify-execution-root.ts, --execution-root flag, new attestation fields, App.repoRoot exposure), and a SPEC-046 hook amendment (subagent-stop-commit-guard.mjs). The plan declares a single slice for SPEC-061 only, and no ac_scope or amendment explains the extra s…
- AC-061-7 has 0 attested passes and 2 attested fails; both failing runs show vitest exiting 1 with 'No test files found' for packages/core/tests/acceptance.test.ts. A declared acceptance criterion whose oracle matches zero files is precisely the blind spot this plan set out to close, and it was left on the spec rather than removed.
- AC-061-8 restates AC-061-7 but silently drops the 'coverage totals for a 0-inconclusive corpus stay byte-identical to pre-change values' clause, so the backwards-compatibility half of the original criterion has no evidenced assertion anywhere in the bundle.
- The plan's exit criteria reference 7 ACs; the spec declares 10 (including two G-series gap ACs added later). The plan document was never updated, so 'all ACs attested' cannot be checked against the plan's own stated bar.
- packages/core/src/attestation-completeness.ts — the D1 pure core module the plan's Goal centres on — appears in neither the shown diff nor the truncation manifest, so countExplicitPathArgs/parseExecutedUnits/judgeCompleteness are evidenced only by filtered test runs, never by inspectable source.

## Recommendations

- Amend or retire AC-061-7 rather than leaving it declared-and-failing beside its AC-061-8 correction, and fold the dropped byte-identical-totals assertion into AC-061-8's test file.
- Require that a plan's bundle diff be scoped to its own spec, or that a recorded amendment name any co-landed specs, before an audit is run.
- Update the plan's Exit Criteria whenever ACs are added mid-flight (7 declared vs 10 actual here).
- Link at least one knowledge doc capturing the SPEC-060 false-attestation failure mode and the guard's verdict taxonomy.

## Judgment

- Provider: claude-cli
- Prompt version: 6
- Duration: 91375ms
- Retried: false
- Truncated sections: diff:CLAUDE.md, diff:assets/hooks/subagent-stop-commit-guard.mjs, diff:packages/core/src/task-workflow.test.ts, diff:packages/core/src/verify-execution-root.test.ts, diff:packages/core/tests/browser-safety.test.ts, diff:packages/lore/src/service/config-service.ts, diff:packages/lore/src/service/verify-runner-service.ts, diff:packages/lore/tests/unit/adapters/cli-ac-coverage-badge.bun.test.ts, diff:packages/lore/tests/unit/adapters/http/config-routes.test.ts, diff:packages/lore/tests/unit/adapters/verify-render-execution-root.test.ts, diff:packages/lore/tests/unit/core/distribution-hooks.test.ts, diff:packages/lore/tests/unit/service/config-service.test.ts, diff:packages/lore/tests/unit/service/phase-workflow-inconclusive-guard.test.ts, diff:packages/lore/tests/unit/service/setup-service.test.ts, diff:packages/lore/tests/unit/service/verify-execution-root.test.ts

## Dimension Scores

| Dimension | Score | Confidence (self-reported, uncalibrated) | Based On | Reasoning |
|---|---|---|---|---|
| outcome | 84 | 0.75 | evidence | 8 of 10 ACs strongly evidenced with attested passes; AC-061-7 contradicted but functionally superseded by AC-061-8, minus one dropped assertion. |
| evidence_integrity | 74 | 0.7 | evidence | Attested ratio 0.57, both tsc and test oracles, red-then-green trail on G1. Weakened by a declared AC whose oracle provably matched zero files — the exact defect being fixed. |
| scope_fidelity | 42 | 0.7 | evidence | Diff carries substantial SPEC-062/063/046 work (config HTTP write layer, verify execution-root resolver, new hook) far outside the declared single-slice SPEC-061 scope. |

## Typed Gaps

| Dimension | Severity | AC Ref | Statement |
|---|---|---|---|
| scope_fidelity | major | — | The bundle diff contains three unrelated specs' work: SPEC-062 config write layer (config-editability.ts, config-routes.ts, ConfigService wiring, middleware refactor, dashboard route dispatch), SPEC-063 verify execution-root resolution (verify-execution-root.ts, --execution-root flag, new attestation fields, App.repoRoot exposure), and a SPEC-046 hook amendment (subagent-stop-commit-guard.mjs). The plan declares a single slice for SPEC-061 only, and no ac_scope or amendment explains the extra s… |
| evidence_integrity | major | AC-061-7 | AC-061-7 has 0 attested passes and 2 attested fails; both failing runs show vitest exiting 1 with 'No test files found' for packages/core/tests/acceptance.test.ts. A declared acceptance criterion whose oracle matches zero files is precisely the blind spot this plan set out to close, and it was left on the spec rather than removed. |
| outcome | minor | AC-061-8 | AC-061-8 restates AC-061-7 but silently drops the 'coverage totals for a 0-inconclusive corpus stay byte-identical to pre-change values' clause, so the backwards-compatibility half of the original criterion has no evidenced assertion anywhere in the bundle. |
| outcome | minor | — | The plan's exit criteria reference 7 ACs; the spec declares 10 (including two G-series gap ACs added later). The plan document was never updated, so 'all ACs attested' cannot be checked against the plan's own stated bar. |
| evidence_integrity | minor | — | packages/core/src/attestation-completeness.ts — the D1 pure core module the plan's Goal centres on — appears in neither the shown diff nor the truncation manifest, so countExplicitPathArgs/parseExecutedUnits/judgeCompleteness are evidenced only by filtered test runs, never by inspectable source. |

## Typed Recommendations

| Target | Action | Rationale |
|---|---|---|
| spec | Amend or retire AC-061-7 rather than leaving it declared-and-failing beside its AC-061-8 correction, and fold the dropped byte-identical-totals assertion into AC-061-8's test file. | A permanently red AC on an otherwise-green spec erodes the signal value of coverage totals. |
| process | Require that a plan's bundle diff be scoped to its own spec, or that a recorded amendment name any co-landed specs, before an audit is run. | Three unrelated specs in one diff make it impossible to attribute regression risk to the plan under review. |
| plan | Update the plan's Exit Criteria whenever ACs are added mid-flight (7 declared vs 10 actual here). | Exit criteria that undercount ACs cannot serve as a completion gate. |
| process | Link at least one knowledge doc capturing the SPEC-060 false-attestation failure mode and the guard's verdict taxonomy. | Knowledge capture is 0 for a plan whose entire value is a reusable trust invariant. |

## Unverifiable Materials

- packages/core/src/attestation-completeness.ts: Absent from both the diff and the truncation manifest; the D1 core module's implementation could not be inspected.
- packages/lore/src/service/verify-runner-service.ts: Listed as truncated; the inconclusive downgrade, exit-code-3 mapping, and attestation threading were judged from test evidence only.
- packages/lore/src/service/task-workflow-service.ts inconclusive guard (AC-061-6): The task-path guard is referenced by the phase-path comment but its source does not appear in the shown diff.
- All 11 truncated test files: Assertion contents unseen; test-level rigor for every AC inferred from pass counts and file counts in output tails.

## Facts Summary

- AC coverage: 10 declared criteria
- Task evidence: 2 tasks
- AC scope: 0 scoped, 0 dangling
- Knowledge capture: 0 docs (bundle)
- Regression: tests_touched=true, attested_evidence_ratio=0.57
