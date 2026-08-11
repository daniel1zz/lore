---
id: KN-293
type: knowledge
role: knowledge
title: "Assessment: Implementation — proposed to accepted decision_status writer (2026-07-31)"
status: approved
priority: medium
created: 2026-07-31
updated: 2026-07-31
tags: []
parent: PLAN-096
links:
  - {id: PLAN-096, type: informs}
---
# Assessment: partially_met (68/100)

Scope: plan `01KYV2PH7QG1MC3WQERHTTDVPQ`

## AC Scores

| AC | Score | Reasoning | Evidence |
|---|---|---|---|
| AC-DS-1 | 66 | T2 evidence [1] runs the spec's exact e2e command and passes, matching declared coverage (1 pass, 0 fail). But the pass is self-reported by the implementing agent with no attestation and no diff to confirm the assertion actually reads extra.decision_status via lore get --json. | task-t2-wire-decision-status-into-lore-set-with-read-merge-write (evidence [1] e2e 'accept end-to-end') |
| AC-DS-2 | 65 | Evidence [2] matches the spec command and passes. Unverifiable that the test asserts exit code 4 and that stderr names the target's actual type rather than a generic message — no diff, no test source, no attestation. | task-t2-wire-decision-status-into-lore-set-with-read-merge-write (evidence [2] e2e 'non-adr target') |
| AC-DS-3 | 66 | Evidence [3] matches the spec command and passes; the test name 'names lore invalidate' aligns with the AC's stderr requirement. Exit-code-2 behaviour for both deprecated and superseded is unconfirmed from the materials shown. | task-t2-wire-decision-status-into-lore-set-with-read-merge-write (evidence [3] e2e 'names lore invalidate') |
| AC-DS-4 | 65 | Evidence [4] 'no draft demotion' passes against the spec's command. Whether the test genuinely observes status still approved after accept (vs merely not erroring) cannot be checked without the diff or test body. | task-t2-wire-decision-status-into-lore-set-with-read-merge-write (evidence [4] e2e 'no draft demotion') |
| AC-DS-5 | 65 | Evidence [5] passes for 'unrelated extra key survives'. The AC's stronger byte-identical requirement is not independently verifiable; read-merge-write is claimed in the task text only, with no diff to confirm the merge path. | task-t2-wire-decision-status-into-lore-set-with-read-merge-write (evidence [5] e2e 'unrelated extra key survives') |
| AC-DS-6 | 65 | Evidence [6] 'idempotent second accept' passes. The precise version-advances-exactly-once assertion is the kind of claim most likely to be approximated in a test; with no diff or attestation it stays unverified. | task-t2-wire-decision-status-into-lore-set-with-read-merge-write (evidence [6] e2e 'idempotent second accept') |
| AC-DS-7 | 65 | Evidence [7] matches the spec command and passes. Exit 2 plus stderr listing the accepted value is plausible given T1's validation module, but not directly observable in the materials. | task-t2-wire-decision-status-into-lore-set-with-read-merge-write (evidence [7] e2e 'unknown decision-status value') |
| AC-DS-8 | 72 | Strongest AC: T1 evidence [1] runs the exact vitest command (2 pass, 0 fail) plus typecheck and test:changed. The task text explicitly names a pure module reachable from vitest with no store/spawn, matching the AC's purity constraint. Still self-reported only. | task-t1-pure-decision-status-value-restriction-module (evidence [1] vitest 'closed value set' 2 pass), task-t1-pure-decision-status-value-restriction-module (evidence [2],[3] test:changed + tsc) |

## Gaps

- Zero attested evidence: all 9 T2 records and 3 T1 records are self-reported by the agents that wrote the code (attested_evidence_ratio 0.00). Every AC pass therefore rests on the implementer's own claim, with no independent replay.
- No diff was provided, so no implementation or test source could be reviewed. For all 8 ACs the mapping from AC statement to actual assertion is inferred from -t filter names only; specific behaviours (exit 4 vs 2, stderr wording, byte-identical extra key, exactly-one version bump) are unverified.
- Regression signal tests_touched=false contradicts both tasks, which describe creating packages/lore/tests/unit/cli/decision-status-validation.test.ts and running tests/unit/adapters/cli-adr-decision-status.bun.test.ts. Either the signal is stale or the tests pre-existed and were not extended.
- AC-DS-5 requires the unrelated extra key be byte-identical after accept. Read-merge-write is asserted in the task description, but nothing in the evidence distinguishes byte-identical preservation from semantic round-trip through a JSON re-serialize.
- 0 knowledge docs captured. The change establishes a reusable convention (closed decision-status value set, hand-off to lore invalidate for deprecated/superseded) that is not recorded anywhere in the bundle.

## Recommendations

- Block bundle acceptance when diff_available=false and attested_evidence_ratio=0.00 together — one or the other must be present for a reviewer to distinguish a real pass from a test that merely shares the AC's name.
- Fold the observable values into the verify commands or test names for AC-DS-2/3/7 (exit code) and AC-DS-6 (version delta), e.g. -t 'non-adr target exits 4', so a name-only audit carries real signal.
- Add a third task that captures a knowledge doc for the decision_status closed value set and the lore invalidate hand-off message, linked from the spec.
- Have a non-implementing agent re-run each spec verify command and record attested evidence for at least AC-DS-1, AC-DS-5 and AC-DS-6 — the three whose assertions are hardest to approximate correctly.
- Investigate why tests_touched=false was emitted for a bundle whose tasks create and run test files; fix the signal computation or explain it in the bundle.

## Judgment

- Provider: claude-cli
- Prompt version: 6
- Duration: 57108ms
- Retried: false
- Truncated sections: (none)

## Dimension Scores

| Dimension | Score | Confidence (self-reported, uncalibrated) | Based On | Reasoning |
|---|---|---|---|---|
| outcome | 72 | 0.6 | evidence | All 8 ACs have a passing run of the spec's own verify command, 0 fails. Task text mirrors the --kind precedent. But no diff means outcome quality is inferred from test names. |
| evidence_integrity | 45 | low | absence | Commands match spec verifies and oracles are diverse (e2e, tsc, test), but attestation ratio is 0.00, no diff, and tests_touched=false conflicts with newly-created test files. |
| scope_fidelity | 78 | low | absence | Two tasks map cleanly onto AC-DS-1..7 and AC-DS-8, no ac_scope narrowing, no extra tasks. Without a diff, incidental drift outside the two named files is undetectable. |

## Typed Gaps

| Dimension | Severity | AC Ref | Statement |
|---|---|---|---|
| evidence_integrity | major | — | Zero attested evidence: all 9 T2 records and 3 T1 records are self-reported by the agents that wrote the code (attested_evidence_ratio 0.00). Every AC pass therefore rests on the implementer's own claim, with no independent replay. |
| outcome | major | — | No diff was provided, so no implementation or test source could be reviewed. For all 8 ACs the mapping from AC statement to actual assertion is inferred from -t filter names only; specific behaviours (exit 4 vs 2, stderr wording, byte-identical extra key, exactly-one version bump) are unverified. |
| evidence_integrity | minor | — | Regression signal tests_touched=false contradicts both tasks, which describe creating packages/lore/tests/unit/cli/decision-status-validation.test.ts and running tests/unit/adapters/cli-adr-decision-status.bun.test.ts. Either the signal is stale or the tests pre-existed and were not extended. |
| outcome | minor | AC-DS-5 | AC-DS-5 requires the unrelated extra key be byte-identical after accept. Read-merge-write is asserted in the task description, but nothing in the evidence distinguishes byte-identical preservation from semantic round-trip through a JSON re-serialize. |
| scope_fidelity | minor | — | 0 knowledge docs captured. The change establishes a reusable convention (closed decision-status value set, hand-off to lore invalidate for deprecated/superseded) that is not recorded anywhere in the bundle. |

## Typed Recommendations

| Target | Action | Rationale |
|---|---|---|
| process | Block bundle acceptance when diff_available=false and attested_evidence_ratio=0.00 together — one or the other must be present for a reviewer to distinguish a real pass from a test that merely shares the AC's name. | Here all 8 ACs are evidenced only by self-reported runs of name-filtered tests whose bodies no auditor can see. |
| spec | Fold the observable values into the verify commands or test names for AC-DS-2/3/7 (exit code) and AC-DS-6 (version delta), e.g. -t 'non-adr target exits 4', so a name-only audit carries real signal. | Current -t filters omit the exact exit codes and counts the AC statements hinge on. |
| plan | Add a third task that captures a knowledge doc for the decision_status closed value set and the lore invalidate hand-off message, linked from the spec. | Knowledge Capture shows 0 linked docs for a new cross-command convention. |
| process | Have a non-implementing agent re-run each spec verify command and record attested evidence for at least AC-DS-1, AC-DS-5 and AC-DS-6 — the three whose assertions are hardest to approximate correctly. | Idempotency and byte-preservation are the likeliest places for a passing-but-weak assertion. |
| process | Investigate why tests_touched=false was emitted for a bundle whose tasks create and run test files; fix the signal computation or explain it in the bundle. | A regression signal that silently disagrees with task evidence undermines every other signal it sits beside. |

## Unverifiable Materials

- Implementation diff (packages/lore/src/adapters/cli/decision-status-validation.ts, set.ts --decision-status wiring): diff_available=false; no source shown, so read-merge-write, type-scoping to adr, and exit-code selection are claims only.
- tests/unit/adapters/cli-adr-decision-status.bun.test.ts body: Not included. AC-DS-1..7 assertions are inferred from -t filter strings, so assertion strength and AC alignment cannot be checked.
- packages/lore/tests/unit/cli/decision-status-validation.test.ts body: Not included. Cannot confirm the 2 passing cases cover all three AC-DS-8 behaviours (allow accepted, refuse deprecated/superseded, refuse unknown).
- Independent attestation of any oracle run: attested_count=0 on both tasks; all 12 records are self-reported by the implementing agents.
- set.ts:472 --kind precedent referenced by T2: Cited as the pattern to mirror exactly, but the file is not in the materials, so conformance to the precedent is unassessable.

## Rubric Warnings

- Dimension "evidence_integrity" scored based_on="absence" but no matching entry was found in unverifiable[] or judgment.truncated[] — the absence claim is ungrounded.
- Dimension "scope_fidelity" scored based_on="absence" but no matching entry was found in unverifiable[] or judgment.truncated[] — the absence claim is ungrounded.

## Facts Summary

- AC coverage: 8 declared criteria
- Task evidence: 2 tasks
- AC scope: 0 scoped, 0 dangling
- Knowledge capture: 0 docs (bundle)
- Regression: tests_touched=false, attested_evidence_ratio=0.00
