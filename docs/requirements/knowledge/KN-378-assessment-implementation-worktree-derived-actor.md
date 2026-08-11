---
id: KN-378
type: knowledge
role: knowledge
title: "Assessment: Implementation — worktree-derived actor identity (SPEC-104) (2026-07-28)"
status: approved
priority: medium
created: 2026-07-28
updated: 2026-07-28
tags: []
parent: PLAN-107
links:
  - {id: PLAN-107, type: informs}
---
# Assessment: met (84/100)

Scope: plan `01KYKX9XQSBB4J353KE2FR1P59`

## AC Scores

| AC | Score | Reasoning | Evidence |
|---|---|---|---|
| AC-ACTOR-1 | 88 | Attested run by agent:main-orchestrator with output tail showing named AC-ACTOR-1 tests passing (resolveActorWithSource → agent:<branch>, source worktree-derived; plus detectWorktreeDerivedActor unit). 2 pass / 0 fail. No diff to confirm impl shape. | 01KYKX9ZNEYG4R00VTF56NME0A (evidence [1] self-reported, [7] attested with output_tail) |
| AC-ACTOR-2 | 88 | Attested run shows both precedence tests passing: --by wins and $LORE_ACTOR wins over worktree derivation inside a linked worktree. 2 pass / 0 fail. Ordering vs os-fallback not separately shown but implied by AC-ACTOR-3. | 01KYKX9ZNEYG4R00VTF56NME0A (evidence [2] self-reported, [11] attested) |
| AC-ACTOR-3 | 85 | Attested tail shows main-checkout resolves OS username with source os-fallback and an EXACT pre-existing warning-text assertion. 'Byte-identical to today' rests on a string literal in the new test, not a captured pre-change baseline. | 01KYKX9ZNEYG4R00VTF56NME0A (evidence [3] self-reported, [8] attested) |
| AC-ACTOR-4 | 87 | Attested tail shows detached HEAD and malformed .git content each falling back to os-fallback without throwing. 'Unreadable/missing gitdir' cases are named in the task text; tail is truncated so only two of the listed variants are directly visible. | 01KYKX9ZNEYG4R00VTF56NME0A (evidence [4] self-reported, [9] attested) |
| AC-ACTOR-5 | 86 | Attested tail is complete (1 pass, 0 fail, 18 filtered): claim from linked worktree records agent:<branch> with identitySource worktree-derived and no os-fallback warning. End-to-end persistence of identitySource not independently shown beyond the test's 5 assertions. | 01KYKX9ZNEYG4R00VTF56NME0A (evidence [5] self-reported, [10] attested) |

## Gaps

- Task T2 (01KYM2YZCBVTA2HCRPSQEH69SW) carries 4 evidence records (bun test, vitest 94/94, standalone-clone run, typecheck) all recorded by agent:spec104-fallout with attested_count=0. Its central claims — the RED-first porcelain regression test and repair of 14 cwd-fragile assertions — rest entirely on the implementing actor's own report.
- The SPEC-104 change destabilized 14 existing assertions in cli-utils.test.ts and actor-session-tier.test.ts by making them dependent on ambient process.cwd(), and surfaced a parsePorcelainPath order bug that silently dropped ' M'-prefixed modified paths. The ACs passed, but the implementation's blast radius exceeded what the plan anticipated and required a follow-on repair task.
- Plan declares one phase (P1-impl) with anchors utils.ts and commands/claim.ts. T2 modifies scripts/changed-tests.ts and two unrelated test suites. The work is justified as fallout and explicitly forbids changing resolveActorWithSource semantics, but no ac_scope or phase amendment records the widening.
- 'Byte-identical to today' is verified by asserting against an expected warning string authored alongside the change, not by diffing against a captured pre-change output. If the literal was transcribed from the post-change code, the test is self-confirming.
- No diff is present in the bundle (diff_available=false, tests_touched=false), so the claim of filesystem-only detection with no git subprocess — a core design constraint of T1 — is unverifiable from the materials.

## Recommendations

- Require a second-recorder attestation on every task's evidence before status leaves draft, not just on the AC-mapped runs. T2's fallout fixes shipped with zero independent confirmation.
- Include the implementation diff in the audit bundle. Anchors utils.ts and commands/claim.ts were named at plan time, so the diff scope is known and cheap to attach.
- When a task spawns a fallout task, link the originating knowledge doc into the bundle and amend the plan phases so the widened footprint is declared rather than inferred from a task title.
- For byte-identity ACs like AC-ACTOR-3, specify that the baseline be captured from the pre-change binary and stored as a fixture, rather than asserted against an inline literal.

## Judgment

- Provider: claude-cli
- Prompt version: 6
- Duration: 58860ms
- Retried: false
- Truncated sections: (none)

## Dimension Scores

| Dimension | Score | Confidence (self-reported, uncalibrated) | Based On | Reasoning |
|---|---|---|---|---|
| outcome | 87 | 0.78 | evidence | All 5 ACs have attested passing runs with matching output tails; tiering, precedence, fail-open and claim threading each demonstrated. Deducted for collateral breakage of 14 existing assertions. |
| evidence_integrity | 76 | 0.72 | evidence | T1 is strong: 5/5 ACs attested by a second recorder with output tails. T2 is 100% self-reported, tasks are draft, no diff, ratio 0.33, referenced knowledge doc absent from bundle. |
| scope_fidelity | 72 | 0.65 | evidence | T1 matches P1-impl anchors exactly. T2 adds changed-tests.ts porcelain fix and test repairs outside the plan's declared single task/anchors — plausibly necessary fallout, but undeclared. |

## Typed Gaps

| Dimension | Severity | AC Ref | Statement |
|---|---|---|---|
| evidence_integrity | major | — | Task T2 (01KYM2YZCBVTA2HCRPSQEH69SW) carries 4 evidence records (bun test, vitest 94/94, standalone-clone run, typecheck) all recorded by agent:spec104-fallout with attested_count=0. Its central claims — the RED-first porcelain regression test and repair of 14 cwd-fragile assertions — rest entirely on the implementing actor's own report. |
| outcome | major | — | The SPEC-104 change destabilized 14 existing assertions in cli-utils.test.ts and actor-session-tier.test.ts by making them dependent on ambient process.cwd(), and surfaced a parsePorcelainPath order bug that silently dropped ' M'-prefixed modified paths. The ACs passed, but the implementation's blast radius exceeded what the plan anticipated and required a follow-on repair task. |
| scope_fidelity | minor | — | Plan declares one phase (P1-impl) with anchors utils.ts and commands/claim.ts. T2 modifies scripts/changed-tests.ts and two unrelated test suites. The work is justified as fallout and explicitly forbids changing resolveActorWithSource semantics, but no ac_scope or phase amendment records the widening. |
| outcome | minor | AC-ACTOR-3 | 'Byte-identical to today' is verified by asserting against an expected warning string authored alongside the change, not by diffing against a captured pre-change output. If the literal was transcribed from the post-change code, the test is self-confirming. |
| evidence_integrity | minor | — | No diff is present in the bundle (diff_available=false, tests_touched=false), so the claim of filesystem-only detection with no git subprocess — a core design constraint of T1 — is unverifiable from the materials. |

## Typed Recommendations

| Target | Action | Rationale |
|---|---|---|
| process | Require a second-recorder attestation on every task's evidence before status leaves draft, not just on the AC-mapped runs. T2's fallout fixes shipped with zero independent confirmation. | attested_evidence_ratio is 0.33; the unattested third is precisely the corrective work whose correctness is least self-evident. |
| plan | Include the implementation diff in the audit bundle. Anchors utils.ts and commands/claim.ts were named at plan time, so the diff scope is known and cheap to attach. | Design constraints (no git subprocess, fail-open, never throw) are asserted in task text and test names but not inspectable. |
| process | When a task spawns a fallout task, link the originating knowledge doc into the bundle and amend the plan phases so the widened footprint is declared rather than inferred from a task title. | Knowledge capture reports 0 linked docs while T2 cites knowledge-spec-104-fallout-changed-tests-ts-porcelain-path-bug by name. |
| spec | For byte-identity ACs like AC-ACTOR-3, specify that the baseline be captured from the pre-change binary and stored as a fixture, rather than asserted against an inline literal. | An inline expected-string cannot distinguish preserved behavior from transcribed-after-the-fact behavior. |

## Unverifiable Materials

- Implementation diff for utils.ts, commands/claim.ts, scripts/changed-tests.ts: diff_available=false; no code shown, so fail-open structure, .git pointer parsing, and the no-subprocess constraint cannot be inspected.
- knowledge-spec-104-fallout-changed-tests-ts-porcelain-path-bug: Referenced in T2's description but Knowledge Capture reports 0 linked docs in the bundle.
- Attestation for T2's four evidence records: attested_count=0; all runs recorded by the implementing actor agent:spec104-fallout with no output tails.
- Pre-change baseline of the os-fallback warning text: AC-ACTOR-3 byte-identity is asserted against a literal in the new test; no captured pre-change output is provided.
- Full test output for AC-ACTOR-1/2/3/4: output_tail fields are truncated mid-line; only AC-ACTOR-5's tail shows a complete pass/fail summary.

## Facts Summary

- AC coverage: 5 declared criteria
- Task evidence: 2 tasks
- AC scope: 0 scoped, 0 dangling
- Knowledge capture: 0 docs (bundle)
- Regression: tests_touched=false, attested_evidence_ratio=0.33
