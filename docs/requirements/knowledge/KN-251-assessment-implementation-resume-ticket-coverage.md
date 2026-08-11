---
id: KN-251
type: knowledge
role: knowledge
title: "Assessment: Implementation — resume-ticket coverage floor: blocking channel, arming provenance, cross-turn idempotence (2026-08-01)"
status: approved
priority: medium
created: 2026-08-01
updated: 2026-08-01
tags: []
parent: PLAN-086
links:
  - {id: PLAN-086, type: informs}
---
# Assessment: met (86/100)

Scope: plan `01KYXK8227XPEKC4CKMPTEJDPG`

## AC Scores

| AC | Score | Reasoning | Evidence |
|---|---|---|---|
| AC-RCH-1 | 90 | Filtered vitest run passed twice (worktree + independent main-checkout re-run), each reporting 'Test Files 1 passed (1)', 4 tests. Diff shows stdout JSON block decision at exit 0 with stderr per-id lines retained. Test body unseen (truncated), so set-equality strictness is taken on attestation. | task-t2-unit-oracles-for-the-coverage-check-verb (evidence [1] and [10]), task-t1-coverage-verb (diff: process.stdout.write(JSON.stringify({decision, reason}))) |
| AC-RCH-2 | 90 | Two passing runs, 1 matched file each; named STATE test on the round-trip property appears in the tail. Diff confirms buildBlockReason composes only from @lore/core exports and parseDispositionedIds is shared, so the zero-hit literal search is structurally supported. | task-t2-unit-oracles-for-the-coverage-check-verb (evidence [2], [11]), task-t1-coverage-verb (buildBlockReason uses RESUME_DISPOSITION_* exports only) |
| AC-RCH-3 | 86 | Two passing runs, 'Test Files 1 passed (1)', 2 tests — matching the stub-PATH relay plus the zero-grammar control. Hook asset is unedited in the diff, consistent with the claim. Assertion internals unverifiable (test file truncated). | task-t2-unit-oracles-for-the-coverage-check-verb (evidence [3], [12]) |
| AC-RCH-4 | 89 | Two passing runs, 1 matched file, 4 tests. Diff implements tool_use_id pairing (armingToolUseIds) and skips unpaired results, matching the negative/control pair the AC demands. | task-t2-unit-oracles-for-the-coverage-check-verb (evidence [4], [13]), task-t1-coverage-verb (scanTranscript pairs tool_result to tool_use by id) |
| AC-RCH-5 | 89 | 12 tests pass under the filter with 1 matched file, consistent with an exhaustive fixture array over arming/non-arming shapes. Diff's toLoneCommandTokens does order-independent, non-adjacent equality matching and the D10 floor check precedes disposition inspection. | task-t2-unit-oracles-for-the-coverage-check-verb (evidence [5], [14] — 12 passed), task-t1-coverage-verb (toLoneCommandTokens + RESUME_COVERAGE_FLOOR early return) |
| AC-RCH-6 | 89 | Two passing runs, 1 matched file, 4 tests. Diff unions post-ticket transcript dispositions (entryIndex > ticket.entryIndex) with last_assistant_message, preserving the D8 channel split as the AC's control arm requires. | task-t2-unit-oracles-for-the-coverage-check-verb (evidence [6], [15]), task-t1-coverage-verb (dispositionBearingMessages union in runCoverageCheck) |
| AC-RCH-7 | 78 | Only e2e AC with a single run; both recorded tails show AC-RC-4 (a pre-existing describe) rather than the AC-RCH-7 tests, and no matched-file count is visible. The visible test source is strong (PATH shim, relay fidelity, vacuity controls), but the pass tail does not attest those specific tests ran… | task-t3-compiled-consumer-path-oracle (evidence [1] agent, [2] orchestrator; tails show AC-RC-4 only) |
| AC-RCH-8 | 90 | Two passing runs, 1 matched file; the tail names the five-payload-class STATE test explicitly. Diff removes process.exitCode = 1 entirely and documents that no deliberate non-zero path remains. | task-t2-unit-oracles-for-the-coverage-check-verb (evidence [7], [16]), task-t1-coverage-verb (exitCode assignment deleted) |

## Gaps

- Both recorded AC-RCH-7 runs show output tails naming AC-RC-4 tests ('the coverage-floor grammar reaches BOTH shipping render surfaces') and no matched-file/test count. The AC additionally requires asserting exactly 1 matched test file; nothing in the evidence shows that assertion or the AC-RCH-7 test results. The pass verdict is therefore carried by the recorder's claim rather than by legible output.
- The plan mandates one full-suite run on main at a clean tree (git status --porcelain empty) because dirty concurrent checkouts were measured to produce 20+ phantom failures. No such run appears in the evidence, so cross-suite regressions from the verb's exit-status removal (any test asserting the old exit 1) are unmeasured outside test:changed.
- The spec's purpose — that a block decision actually produces accounting compliance — has no oracle. The plan carries this deliberately on an n=1 control (doc-sync 10/10 vs 0/130). The eight ACs prove the channel and template are emitted, not that the outcome follows.
- T1, the implementation task, has zero attested evidence — only self-reported typecheck and test:changed against a base SHA. Its correctness is inferred from T2/T3 oracles, which is acceptable given oracle independence, but the base-SHA test:changed scope itself is unverifiable from these materials.

## Recommendations

- Require an evidence tail for e2e oracles that includes the matched-file/test summary line and at least one test name from the AC under measurement; reject tails whose named tests belong to a different AC in the same file.
- Add the clean-tree full-suite run on main as an explicit, recordable oracle rather than a prose verification note, with the git status --porcelain output captured alongside it.
- Register the first post-rollout consumed ticket as a named follow-up observation with a recording location, so the accepted n=1 behavioural risk gets a confirming or refuting datapoint.

## Judgment

- Provider: claude-cli
- Prompt version: 6
- Duration: 72369ms
- Retried: false
- Truncated sections: task:task-t1-coverage-check-verb-block-channel-verdict-arming, diff:packages/lore/tests/unit/handoff-coverage-check.test.ts
- Reasoning clipped for: AC-RCH-7
- Overall confidence: low (degraded by truncation)

## Dimension Scores

| Dimension | Score | Confidence (self-reported, uncalibrated) | Based On | Reasoning |
|---|---|---|---|---|
| outcome | 89 | 0.82 | evidence | All four T1 behaviour changes are visible in the diff and map cleanly onto H1–H5; all eight ACs have passing script oracles with attested re-runs. |
| evidence_integrity | 80 | 0.75 | evidence | Oracles written by a non-implementing agent and re-run independently on main with matched-file counts; weakened by AC-RCH-7's mismatched tail, no clean-tree full suite, 0.40 attested ratio. |
| scope_fidelity | 94 | 0.85 | evidence | Changes confined to the declared anchors: the verb source and the two test files. Hook asset untouched as the plan requires, so no manifest regeneration or setup re-run is implied. |

## Typed Gaps

| Dimension | Severity | AC Ref | Statement |
|---|---|---|---|
| evidence_integrity | major | AC-RCH-7 | Both recorded AC-RCH-7 runs show output tails naming AC-RC-4 tests ('the coverage-floor grammar reaches BOTH shipping render surfaces') and no matched-file/test count. The AC additionally requires asserting exactly 1 matched test file; nothing in the evidence shows that assertion or the AC-RCH-7 test results. The pass verdict is therefore carried by the recorder's claim rather than by legible output. |
| evidence_integrity | minor | — | The plan mandates one full-suite run on main at a clean tree (git status --porcelain empty) because dirty concurrent checkouts were measured to produce 20+ phantom failures. No such run appears in the evidence, so cross-suite regressions from the verb's exit-status removal (any test asserting the old exit 1) are unmeasured outside test:changed. |
| outcome | minor | — | The spec's purpose — that a block decision actually produces accounting compliance — has no oracle. The plan carries this deliberately on an n=1 control (doc-sync 10/10 vs 0/130). The eight ACs prove the channel and template are emitted, not that the outcome follows. |
| evidence_integrity | minor | — | T1, the implementation task, has zero attested evidence — only self-reported typecheck and test:changed against a base SHA. Its correctness is inferred from T2/T3 oracles, which is acceptable given oracle independence, but the base-SHA test:changed scope itself is unverifiable from these materials. |

## Typed Recommendations

| Target | Action | Rationale |
|---|---|---|
| process | Require an evidence tail for e2e oracles that includes the matched-file/test summary line and at least one test name from the AC under measurement; reject tails whose named tests belong to a different AC in the same file. | AC-RCH-7's tail shows AC-RC-4 tests, so the recorded pass does not demonstrate the AC-RCH-7 assertions ran. |
| plan | Add the clean-tree full-suite run on main as an explicit, recordable oracle rather than a prose verification note, with the git status --porcelain output captured alongside it. | The plan names it as a non-negotiable but no evidence record exists for it, so the requirement silently went unmet. |
| spec | Register the first post-rollout consumed ticket as a named follow-up observation with a recording location, so the accepted n=1 behavioural risk gets a confirming or refuting datapoint. | The plan already identifies this as the confirming observation but assigns it no owner or artifact. |

## Unverifiable Materials

- packages/lore/tests/unit/handoff-coverage-check.test.ts: Omitted from the diff per the truncation manifest; the strictness of set-equality, export-identity and zero-hit-search assertions for AC-RCH-1..6/8 could not be inspected.
- AC-RCH-7 bun test output showing the AC-RCH-7 tests and matched-file count: Both recorded tails display AC-RC-4 test names with no file-count summary line.
- Clean-tree full-suite run on main: No evidence record of the run or of the required git status --porcelain check appears in the bundle.

## Facts Summary

- AC coverage: 8 declared criteria
- Task evidence: 3 tasks
- AC scope: 0 scoped, 0 dangling
- Knowledge capture: 4 docs (bundle)
- Regression: tests_touched=true, attested_evidence_ratio=0.40
