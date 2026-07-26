---
id: KN-119
type: knowledge
role: knowledge
title: "Assessment: Implementation — SPEC-061 attestation completeness guard (2026-07-21)"
status: approved
priority: medium
created: 2026-07-21
updated: 2026-07-24
tags: []
parent: PLAN-065
links:
  - {id: PLAN-065, type: informs}
---
# Assessment: partially_met (82/100)

Scope: plan `01KY1N8XG2YY27CTX28WE6ZGWF`

## AC Scores

| AC | Score | Reasoning | Evidence |
|---|---|---|---|
| AC-061-1 | 92 | 3 pass / 2 attested. Diff shows countExplicitPathArgs with tests asserting 3 for the AC-060-7 command, 0 for `bun run test`, and 0 for `--reporter json`. Tail confirms 1 file, 8 tests run. | 01KY1N8Y842ZAEHWZJCAJPMKF1 (T1 ev[1],[11]), 01KY1Q5XCQDWBXCV4J2XCEXVJ1 (T2 ev[8]) |
| AC-061-2 | 92 | 3 pass / 2 attested. Diff shows parseExecutedUnits with bun+vitest patterns and tests for files=1, files=70, and null on unrecognised output. Tail: 5 tests passed, 1 file. | 01KY1N8Y842ZAEHWZJCAJPMKF1 (T1 ev[12]), 01KY1Q5XCQDWBXCV4J2XCEXVJ1 (T2 ev[9]) |
| AC-061-3 | 93 | 3 pass / 2 attested. judgeCompleteness implements the exact five-step decision order; tests cover under_match, zero_match, complete, unknown_runner plus declaredPaths===0 boundary. 9 tests run. | 01KY1N8Y842ZAEHWZJCAJPMKF1 (T1 ev[13]), 01KY1Q5XCQDWBXCV4J2XCEXVJ1 (T2 ev[10]) |
| AC-061-4 | 84 | 3 pass / 2 attested, and verify.ts sets exit 3 on inconclusiveCount>0. Test file itself is truncated from materials, so the REPRO assertion body (exit code 3, result=inconclusive) is not directly readable; tail shows only 1 test ran under -t 'REPRO'. | 01KY1N8Y842ZAEHWZJCAJPMKF1 (T1 ev[14]), 01KY1Q5XCQDWBXCV4J2XCEXVJ1 (T2 ev[11]) |
| AC-061-5 | 84 | 3 pass / 2 attested; VerifyRunnerService only downgrades on zero/under_match, leaving complete and unknown_runner as pass, consistent with the AC. Assertion bodies unreadable (file truncated); 4 tests ran. | 01KY1N8Y842ZAEHWZJCAJPMKF1 (T1 ev[15]), 01KY1Q5XCQDWBXCV4J2XCEXVJ1 (T2 ev[12]) |
| AC-061-6 | 86 | 3 pass / 2 attested. task-workflow-service.ts adds the runtime rejection (VALIDATION_ERROR, field=result) and narrows EvidenceInput. Exit-code-4 mapping asserted only in the truncated test file; 2 tests ran. | 01KY1N8Y842ZAEHWZJCAJPMKF1 (T1 ev[16]), 01KY1Q5XCQDWBXCV4J2XCEXVJ1 (T2 ev[13]) |
| AC-061-7 | 30 | 2 attested FAILS: the declared command targets packages/core/tests/acceptance.test.ts, which does not exist ('No test files found, exiting with code 1'). Ironically the exact defect SPEC-061 fixes. Superseded by AC-061-8, but the AC itself remains contradicted and its byte-identical-totals clause w… | 01KY1N8Y842ZAEHWZJCAJPMKF1 (T1 ev[17] fail), 01KY1Q5XCQDWBXCV4J2XCEXVJ1 (T2 ev[14] fail) |
| AC-061-8 | 88 | 2 attested pass on the corrected path (packages/core/src/acceptance.test.ts, 35 tests, 1 file). EvidenceRefLite widening to include 'inconclusive' is visible in the diff. The specific inconclusive-not-counted assertions live in that file, which is not shown. | 01KY1N8Y842ZAEHWZJCAJPMKF1 (T1 ev[18]), 01KY1Q5XCQDWBXCV4J2XCEXVJ1 (T2 ev[15]) |
| AC-061-G1 | 90 | Red-then-green: initial fail (no test file) followed by 6/6 pass, 1 attested each way. The test file is fully visible and does assert code/field/message/value parity plus exitCode 4 against TaskWorkflowService, matching the AC statement. | 01KY1Q5XCQDWBXCV4J2XCEXVJ1 (T2 ev[1] fail, ev[3]/ev[16] pass) |
| AC-061-G2 | 91 | 3 pass / 2 attested; tail shows '14 pass, 0 fail, Ran 14 tests across 1 file', matching the declared 14-case suite (6 pre-existing + 8 new). coverageBadge's ⚑? branch and its pass/fail precedence are visible in the diff. | 01KY1Q5XCQDWBXCV4J2XCEXVJ1 (T2 ev[4],[17]) |

## Gaps

- AC-061-7 carries 2 attested fails: its oracle command names packages/core/tests/acceptance.test.ts, a path that does not exist ('No test files found, exiting with code 1'). AC-061-8 corrects the path but drops the 'coverage totals stay byte-identical for a 0-inconclusive corpus' clause, so that property is now unevidenced anywhere. The AC remains declared and failing rather than retracted.
- The guard keys on executed FILE count only. Most of this plan's own oracles are `-t '<pattern>'`-filtered runs where 14-17 of 22 tests are skipped; a pattern matching zero tests would still report 'Test Files 1 passed (1)' and be judged 'complete', reproducing the very false-attestation class SPEC-061 exists to close, one level down. The plan's own dogfooding exit criterion is therefore only partly satisfied.
- packages/lore/tests/unit/service/verify-completeness.test.ts is the sole evidence source for AC-061-4, -5 and -6 and is omitted from the reviewable materials. The exit-code-3 and exit-code-4 claims in those AC statements cannot be read directly; they are inferred from verify.ts and task-workflow-service.ts plus pass records.
- verify.ts maps the inconclusive outcome onto exit code 3, already meaning DOC_NOT_FOUND. A CI wrapper cannot distinguish 'plan not found' from 'oracle under-matched'. The header comments the choice but does not resolve the ambiguity.
- judgeCompleteness returns 'complete' when executed files exceed declared paths, so an over-matching filter (declares 1 file, runs 217) is unflagged. Symmetric to under_match and arguably an equally untrustworthy attestation.

## Recommendations

- Mark AC-061-7 superseded by AC-061-8 (or delete it) so the spec stops carrying a permanently-failing AC, and re-add the dropped 'coverage totals byte-identical for a 0-inconclusive corpus' assertion to AC-061-8 or a new AC.
- Extend the completeness guard to parse executed TEST counts (bun's summary already carries them; vitest's 'Tests N passed (M)' line is adjacent) and judge a name-filtered run that executed zero tests as zero_match.
- Give the inconclusive outcome its own verify exit code instead of overloading 3 (DOC_NOT_FOUND).
- Require that any AC whose oracle command is corrected be re-verified against the ORIGINAL statement text, so a path fix cannot also quietly narrow the assertion.

## Judgment

- Provider: claude-cli
- Prompt version: 6
- Duration: 86188ms
- Retried: false
- Truncated sections: diff:packages/lore/tests/unit/service/verify-completeness.test.ts
- Reasoning clipped for: AC-061-7

## Dimension Scores

| Dimension | Score | Confidence (self-reported, uncalibrated) | Based On | Reasoning |
|---|---|---|---|---|
| outcome | 85 | 0.75 | evidence | Core module, verify integration, both write-path guards and the CLI badge are all present in the diff and attested. One AC (061-7) stands failed; its replacement narrowed the requirement. |
| evidence_integrity | 78 | 0.7 | evidence | Attested ratio 0.57 with red-then-green on G1 is a good trail, but -t-filtered oracles execute a fraction of each file and the guard cannot detect that, so attestation depth is weaker than counts imp… |
| scope_fidelity | 90 | 0.8 | evidence | Diff stays within SPEC-061 scope: pure core module, verify runner, two service guards, badge. Every touched file cites SPEC-061. T2 closure task is declared, not silent drift. |

## Typed Gaps

| Dimension | Severity | AC Ref | Statement |
|---|---|---|---|
| outcome | major | AC-061-7 | AC-061-7 carries 2 attested fails: its oracle command names packages/core/tests/acceptance.test.ts, a path that does not exist ('No test files found, exiting with code 1'). AC-061-8 corrects the path but drops the 'coverage totals stay byte-identical for a 0-inconclusive corpus' clause, so that property is now unevidenced anywhere. The AC remains declared and failing rather than retracted. |
| evidence_integrity | major | AC-061-1 | The guard keys on executed FILE count only. Most of this plan's own oracles are `-t '<pattern>'`-filtered runs where 14-17 of 22 tests are skipped; a pattern matching zero tests would still report 'Test Files 1 passed (1)' and be judged 'complete', reproducing the very false-attestation class SPEC-061 exists to close, one level down. The plan's own dogfooding exit criterion is therefore only partly satisfied. |
| evidence_integrity | minor | AC-061-4 | packages/lore/tests/unit/service/verify-completeness.test.ts is the sole evidence source for AC-061-4, -5 and -6 and is omitted from the reviewable materials. The exit-code-3 and exit-code-4 claims in those AC statements cannot be read directly; they are inferred from verify.ts and task-workflow-service.ts plus pass records. |
| outcome | minor | — | verify.ts maps the inconclusive outcome onto exit code 3, already meaning DOC_NOT_FOUND. A CI wrapper cannot distinguish 'plan not found' from 'oracle under-matched'. The header comments the choice but does not resolve the ambiguity. |
| outcome | minor | — | judgeCompleteness returns 'complete' when executed files exceed declared paths, so an over-matching filter (declares 1 file, runs 217) is unflagged. Symmetric to under_match and arguably an equally untrustworthy attestation. |

## Typed Recommendations

| Target | Action | Rationale |
|---|---|---|
| spec | Mark AC-061-7 superseded by AC-061-8 (or delete it) so the spec stops carrying a permanently-failing AC, and re-add the dropped 'coverage totals byte-identical for a 0-inconclusive corpus' assertion to AC-061-8 or a new AC. | A declared AC with 2 attested fails and no retraction pollutes coverage and hides that one requirement clause silently vanished during correction. |
| spec | Extend the completeness guard to parse executed TEST counts (bun's summary already carries them; vitest's 'Tests N passed (M)' line is adjacent) and judge a name-filtered run that executed zero tests as zero_match. | File-count-only judgement leaves -t-filtered oracles — the majority of this plan's own evidence — able to green-pass on zero executed tests. |
| spec | Give the inconclusive outcome its own verify exit code instead of overloading 3 (DOC_NOT_FOUND). | CI wrappers cannot distinguish a launch-time lookup failure from an under-matched oracle, which weakens the guard's actionability. |
| process | Require that any AC whose oracle command is corrected be re-verified against the ORIGINAL statement text, so a path fix cannot also quietly narrow the assertion. | AC-061-8 fixed the path and simultaneously dropped a clause; the process did not surface that as a scope change. |

## Unverifiable Materials

- packages/lore/tests/unit/service/verify-completeness.test.ts: Listed in the truncation manifest; assertion bodies for AC-061-4/5/6 (exit codes 3 and 4, attestation.completeness values) could not be read.
- packages/core/src/acceptance.test.ts: Not included in the diff; the AC-061-8 inconclusive-bucketing assertions within its 35 tests could not be inspected.
- SPEC-061 spec document (§Scope D1-D6, §Design): Only cited via code comments; the design decisions the diff claims to implement could not be checked against the source text.

## Facts Summary

- AC coverage: 10 declared criteria
- Task evidence: 2 tasks
- AC scope: 0 scoped, 0 dangling
- Knowledge capture: 1 docs (bundle)
- Regression: tests_touched=true, attested_evidence_ratio=0.57
