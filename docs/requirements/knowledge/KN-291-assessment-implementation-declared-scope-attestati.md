---
id: KN-291
type: knowledge
role: knowledge
title: "Assessment: Implementation — declared-scope attestation contract (2026-07-31)"
status: approved
priority: medium
created: 2026-07-31
updated: 2026-07-31
tags: []
parent: PLAN-095
links:
  - {id: PLAN-095, type: informs}
---
# Assessment: partially_met (72/100)

Scope: plan `01KYV2N5J8K3FD9QK1XM412KYP`

## AC Scores

| AC | Score | Reasoning | Evidence |
|---|---|---|---|
| AC-VS-1 | 72 | T2 evidence [1] records the exact spec verify command with result=pass, matching the required 1 pass/0 fail. Unattested (attested_pass=0) and no diff to confirm the recorded-set assertion (vs stdout) is what the test actually checks. | task-t2-verify-selects-the-declared-scope-intersection-and (evidence [1] 'intersection by default') |
| AC-VS-2 | 72 | T2 evidence [2] matches the spec command verbatim, result=pass. The 2-vs-3 differential on the SAME fixture cannot be confirmed without the test source; self-reported only. | task-t2-verify-selects-the-declared-scope-intersection-and (evidence [2] 'wider scope executes more') |
| AC-VS-3 | 72 | T2 evidence [3] matches the spec command, pass. Task text explicitly describes exit 4, 'lore scope add' in stderr, and non-invocation via the injected recorder seam. No diff, no attestation to confirm. | task-t2-verify-selects-the-declared-scope-intersection-and (evidence [3] 'unknown scope refuses') |
| AC-VS-10 | 72 | T1 evidence [2] runs the spec's e2e command, pass. Round-trip through lore get --json is asserted only by the test name; source unavailable. | task-t1-task-extra-ac-scope-the-lore-scope-writer-and (evidence [2] 'create task with ac-scope round trip') |
| AC-VS-4 | 72 | T2 evidence [4] matches the spec command, pass. The compound assertion (zero commands, zero entries, offending id AND full declared set in stderr) is unverifiable from the records alone. | task-t2-verify-selects-the-declared-scope-intersection-and (evidence [4] 'out of scope ac refuses preflight') |
| AC-VS-5 | 70 | T2 evidence [5] matches the spec command, pass. The distinctness requirement — literal 'declares no acceptance criterion' absent from the AC-VS-3 message — is a cross-message claim not observable in the evidence records. | task-t2-verify-selects-the-declared-scope-intersection-and (evidence [5] 'empty scope distinct from absent') |
| AC-VS-8 | 74 | T4 evidence [1] matches the spec command and the coverage table shows pass=2, fail=0, exactly the declared 2 pass/0 fail. Presence of the literal 'plan-wide run' is asserted by the task text, not independently verified. | task-t4-record-the-coverage-predicate-s-measured-false-pass-in (evidence [1], pass count matches expected 2) |
| AC-VS-6 | 72 | T3 evidence [1] matches the spec command, pass; evidence [4] adds ~10 affected suites incl. predicate-applicability. The notApplicable/'scope-undeclared' behaviour (never ok) is described in the task but unattested and undiffed. | task-t3-exercised-acs-rename-declaredscopecoverage-and-the (evidence [1], [4]) |
| AC-VS-7 | 72 | T3 evidence [2] matches the spec command, pass, plus attestation-floor in the broader suite run [4]. Demotion of condition 1 to a reported zero_attested_tasks fact is claimed, not shown. | task-t3-exercised-acs-rename-declaredscopecoverage-and-the (evidence [2], [4]) |
| AC-VS-9 | 70 | T1 evidence [1] matches the spec command, pass. The AC bundles four behaviours (task tier, phase tier, blocked evidenced rm, allowed non-evidenced rm) into one run; no diff or attestation to confirm all four are exercised. | task-t1-task-extra-ac-scope-the-lore-scope-writer-and (evidence [1] 'evidenced removal blocked non-evidenced allowed') |
| AC-VS-11 | 70 | T1 evidence [3] matches the spec command, pass. Byte-identical extra keys, empty-array-not-absent-key, and lore set --ac-scope exiting 2 are all inside one unattested test; not independently confirmable. | task-t1-task-extra-ac-scope-the-lore-scope-writer-and (evidence [3] 'scope writer round trip and set rejects the flag') |

## Gaps

- attested_evidence_ratio is 0.00: all 20 evidence entries across the 4 tasks are self-reported by the executing agent (recorder=agent:vs-t1..t4). No independent oracle run confirms any of the 11 ACs, so every AC score rests on the executor's own report.
- No diff was provided. The ACs turn on exact exit codes (4, 2), exact stderr literals ('lore scope add', 'declares no acceptance criterion', 'cannot remove ac_scope id(s) with recorded evidence', 'plan-wide run'), empty-array-vs-absent-key semantics, and notApplicable-not-ok behaviour — none of which are observable in the evidence records beyond the test names.
- T3 evidence [4] records its command as a prose summary ('bunx vitest run <10 affected suites: evidence-panel, attestation-floor, ...>') instead of an executable command, making that regression pass non-reproducible.
- Regression signals report tests_touched=false while all 11 ACs are verified by named new test files (verify-declared-scope.test.ts, cli-scope-writer.bun.test.ts, plan-close-known-false-pass.bun.test.ts). One of the two is wrong and the materials cannot say which.
- AC-VS-9 asserts four distinct behaviours (blocked evidenced rm for a task, for a phase, allowed non-evidenced rm, id persistence) under one test name; AC-VS-11 similarly bundles three. A single recorded pass cannot be decomposed to show each was exercised.
- T3 renames a public field (ClaimedAcCoverage.claimed_acs -> exercised_acs) and demotes attestationFloor condition 1, both consumer-visible changes, yet 0 knowledge docs were linked to capture the migration or the ADR D1-D8 rationale.

## Recommendations

- Require at least one independently-attested run of each spec verify command before a plan implementing the attestation contract itself can close; block on attested_evidence_ratio = 0.
- Include the implementation diff in the audit bundle whenever ACs specify exact exit codes, stderr literals, or absent-vs-empty key semantics.
- Record evidence commands as literal re-runnable strings; replace T3 evidence [4]'s '<10 affected suites: ...>' placeholder with the actual vitest invocation.
- Split AC-VS-9 and AC-VS-11 into one AC (and one named test) per asserted behaviour — task-tier block, phase-tier block, non-evidenced allow, empty-array persistence, set-flag rejection.
- Link a knowledge doc covering the claimed_acs -> exercised_acs rename and the attestationFloor condition-1 demotion, referencing ADR D1-D8.

## Judgment

- Provider: claude-cli
- Prompt version: 6
- Duration: 69009ms
- Retried: false
- Truncated sections: (none)

## Dimension Scores

| Dimension | Score | Confidence (self-reported, uncalibrated) | Based On | Reasoning |
|---|---|---|---|---|
| outcome | 78 | 0.7 | evidence | All 11 ACs have a pass on the spec's own verify command, 0 fails, plus typecheck and regression suites per task. Behaviour beyond the command name is unconfirmed. |
| evidence_integrity | 52 | 0.8 | evidence | Records show 20/20 entries self-reported, 0 attested, one recorder per task. Commands match the spec verbatim, but nothing independent corroborates any result. |
| scope_fidelity | 70 | low | absence | T1-T4 map cleanly onto the 11 ACs with no extra ACs claimed and plan declares no ac_scope, but with no diff, code-level drift is unobservable. |

## Typed Gaps

| Dimension | Severity | AC Ref | Statement |
|---|---|---|---|
| evidence_integrity | major | — | attested_evidence_ratio is 0.00: all 20 evidence entries across the 4 tasks are self-reported by the executing agent (recorder=agent:vs-t1..t4). No independent oracle run confirms any of the 11 ACs, so every AC score rests on the executor's own report. |
| outcome | major | — | No diff was provided. The ACs turn on exact exit codes (4, 2), exact stderr literals ('lore scope add', 'declares no acceptance criterion', 'cannot remove ac_scope id(s) with recorded evidence', 'plan-wide run'), empty-array-vs-absent-key semantics, and notApplicable-not-ok behaviour — none of which are observable in the evidence records beyond the test names. |
| evidence_integrity | minor | — | T3 evidence [4] records its command as a prose summary ('bunx vitest run <10 affected suites: evidence-panel, attestation-floor, ...>') instead of an executable command, making that regression pass non-reproducible. |
| evidence_integrity | minor | — | Regression signals report tests_touched=false while all 11 ACs are verified by named new test files (verify-declared-scope.test.ts, cli-scope-writer.bun.test.ts, plan-close-known-false-pass.bun.test.ts). One of the two is wrong and the materials cannot say which. |
| outcome | minor | AC-VS-9 | AC-VS-9 asserts four distinct behaviours (blocked evidenced rm for a task, for a phase, allowed non-evidenced rm, id persistence) under one test name; AC-VS-11 similarly bundles three. A single recorded pass cannot be decomposed to show each was exercised. |
| scope_fidelity | minor | — | T3 renames a public field (ClaimedAcCoverage.claimed_acs -> exercised_acs) and demotes attestationFloor condition 1, both consumer-visible changes, yet 0 knowledge docs were linked to capture the migration or the ADR D1-D8 rationale. |

## Typed Recommendations

| Target | Action | Rationale |
|---|---|---|
| process | Require at least one independently-attested run of each spec verify command before a plan implementing the attestation contract itself can close; block on attested_evidence_ratio = 0. | All 20 entries are self-reported by the executing agent, so the evidence trail is uncorroborated. |
| process | Include the implementation diff in the audit bundle whenever ACs specify exact exit codes, stderr literals, or absent-vs-empty key semantics. | Without the diff, literal-string and exit-code ACs can only be scored on test names. |
| plan | Record evidence commands as literal re-runnable strings; replace T3 evidence [4]'s '<10 affected suites: ...>' placeholder with the actual vitest invocation. | A non-reproducible command cannot be re-verified by an auditor or a later regression check. |
| spec | Split AC-VS-9 and AC-VS-11 into one AC (and one named test) per asserted behaviour — task-tier block, phase-tier block, non-evidenced allow, empty-array persistence, set-flag rejection. | Bundled ACs make a single pass indistinguishable from partial coverage. |
| plan | Link a knowledge doc covering the claimed_acs -> exercised_acs rename and the attestationFloor condition-1 demotion, referencing ADR D1-D8. | Consumer-visible field rename and gate-behaviour change with zero captured knowledge. |

## Unverifiable Materials

- Implementation diff (diff_available: false): No production or test source shown, so exit codes, stderr literals, non-invocation of recordVerifiedEvidence, and empty-array-vs-absent-key behaviour could not be checked.
- Test sources for verify-declared-scope.test.ts, cli-scope-writer.bun.test.ts, plan-close-known-false-pass.bun.test.ts, evidence-panel.test.ts, attestation-floor.test.ts: Only command strings and pass results are recorded; the assertions behind each test name are unseen.
- Independent attestation of any oracle run: attested_count is 0 for all four tasks; every entry is self-reported by the executing agent.
- T3 evidence [4] suite list: Recorded as prose ('<10 affected suites: ...>') rather than an executable command, so the run cannot be reproduced.
- assertScopeFreeze production wiring claimed by T1: The claim that it moved from zero to one production call site is not observable in any provided material.

## Rubric Warnings

- Dimension "scope_fidelity" scored based_on="absence" but no matching entry was found in unverifiable[] or judgment.truncated[] — the absence claim is ungrounded.

## Facts Summary

- AC coverage: 11 declared criteria
- Task evidence: 4 tasks
- AC scope: 0 scoped, 0 dangling
- Knowledge capture: 0 docs (bundle)
- Regression: tests_touched=false, attested_evidence_ratio=0.00
