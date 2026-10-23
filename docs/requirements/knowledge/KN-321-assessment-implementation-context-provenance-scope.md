---
id: KN-321
type: knowledge
role: knowledge
title: "Assessment: Implementation — context provenance (scope-declaring injection + scope-closing resume ticket) (2026-07-30)"
status: archived
priority: medium
created: 2026-07-30
updated: 2026-10-23
tags: []
parent: PLAN-101
links:
  - {id: PLAN-101, type: informs}
---
# Assessment: met (81/100)

Scope: plan `01KYRCSYQT9BZN3FFAB9K9MPVD`

## AC Scores

| AC | Score | Reasoning | Evidence |
|---|---|---|---|
| AC-CP-1 | 82 | Registered vitest oracle passed 5x, 3 attested by main-orchestrator across two separate sessions. But the -t 'first key' filter matches exactly 1 of 14 tests and vitest output shows no assertion count, so the required REQUIRED_DISCLAIMER_TOKENS iteration cannot be confirmed without the test source. | task-t1-core-constants-leading-scope-field-in (ev 1,5,11), task-t5-compiled-e2e-suite-proving-every-surface-from-a (ev 9,17 attested) |
| AC-CP-2 | 82 | Same oracle file/pattern: 5 pass, 3 attested. Degenerate budget_exceeded behaviour is pinned by a single matched test; payload-returned-intact, unsliced-declaration-at-position-1 and omission-ledger sub-assertions are not independently visible (no diff, no expect count). | task-t1-core-constants-leading-scope-field-in (ev 2,6,12), task-t5-compiled-e2e-suite-proving-every-surface-from-a (ev 12,19 attested) |
| AC-CP-4 | 90 | Strongest trail: 9 pass, 3 attested. Both surfaces covered independently — MCP unit test, CLI integration test, pure renderResumeFeed mechanics (T3) plus compiled e2e 'scope closure' (15 expect calls) naming every BOOTSTRAP_INJECTION_KNOWN_KEYS member, incl. a negative case for non-resume checkpoin… | task-t3-scope-closure-on-the-resume-ticket-cli-stdout-and-mcp (ev 3,4,5,6), task-t5-compiled-e2e-suite-proving-every-surface-from-a (ev 10,18 attested) |
| AC-CP-6 | 88 | Compiled e2e 'fresh install' passed 3x (2 attested), 13 expect calls, ~3.4s runtime consistent with a real spawned binary. Test title states the temp-path resolution and both boundary-declaration identity checks. Not independently verifiable that the mkdtemp root is outside the repo tree. | task-t5-compiled-e2e-suite-proving-every-surface-from-a (ev 4,8,16) |
| AC-CP-9 | 88 | 4 pass, 3 attested; 17 expect calls, and the test title explicitly reflects the mandated resume_hint carve-out plus the paired zero-occurrence assertion on corpus-workflow.md. T4 adds a governance-compiled run. Only gap: the per-member iteration is asserted via title, not inspectable source. | task-t4-payload-wide-feed-governance-rule-manifest-regeneration (ev 1,2,5), task-t5-compiled-e2e-suite-proving-every-surface-from-a (ev 13,20 attested) |
| AC-CP-10 | 78 | 3 attested passes on the registered oracle (15 expect calls, real binary). But the trail contains a fail (T2 ev 5) whose exact combined command was never re-run green — it was split into a bun e2e run and a vitest unit run instead. T2's description also still cites retired AC-CP-3. | task-t2-framing-line-emitted-binary-side-hook-demoted-to (ev 5 fail, 6/7 split reruns, 10 attested), task-t5-compiled-e2e-suite-proving-every-surface-from-a (ev 14,21 attested) |
| AC-CP-11 | 72 | 2 pass, both attested (10 expect calls) and the test title matches the AC's absent-corpus-workflow/governance-verb-delivery framing. However T5's own task text instructs byte-comparing corpus-workflow.md's INSTALLED copy, contradicting the AC's ABSENT assertion; the AC is also referenced as AC-CP-7… | task-t5-compiled-e2e-suite-proving-every-surface-from-a (ev 5,11,15,22) |

## Gaps

- No diff was provided and tests_touched is false, so every AC verdict depends on test names plus pass/fail records. Whether the tests actually assert constant identity (rather than substring presence or self-referential imports) is unverifiable from these materials.
- T2 evidence 5 records result=fail for 'bun test governance-bootstrap-framing-compiled.bun.test.ts tests/unit/hooks/session-bootstrap-injection.test.ts'. The remediation split it into a bun e2e run (ev 6) and a vitest run (ev 7); the original command was never re-run green, so the failure is superseded rather than resolved.
- attested_evidence_ratio is 0.36. T2, T3, T4 have a single attested run each — all of them the same final orchestrator e2e filter — so their intermediate unit/integration oracles rest entirely on self-report.
- AC-CP-11 is the least-covered criterion: 2 runs, 10 expect calls. Its three-part statement (hook byte-identity from the install dir, corpus-workflow.md absence, governance output byte-identity) cannot be individually confirmed, and the governing task text asks for the opposite treatment of corpus-workflow.md.
- The AC-CP-1 and AC-CP-2 oracles each resolve to one test (14 total, 13 skipped) and vitest output prints no assertion count, so the required REQUIRED_DISCLAIMER_TOKENS iteration and the intact-payload/unsliced-declaration/ledger-silence trio are evidenced only at test granularity.
- AC identifier drift across artifacts: tasks T2/T4 claim retired AC-CP-3/AC-CP-5, T5 and all its evidence titles use AC-CP-7 where the spec declares AC-CP-11, and the plan summarizes the set as 'AC-CP-1 … AC-CP-7' though the live ids are 1,2,4,6,9,10,11.
- The plan requires the final integration run on a clean tree at a named commit, citing measured phantom regressions from dirty concurrent checkouts. No evidence record names that commit; T4 evidence 3 executed an ad hoc scratchpad script against a worktree-local dist/lore.

## Recommendations

- Require the diff (or the referenced test file bodies) in audit bundles for ACs whose statements specify assertion mechanics such as 'by identity' or 'iterates the exported array'. Pass/fail records alone cannot discriminate an identity assertion from a substring check.
- Treat a recorded failing command as open until that exact command re-runs green, or until a note explains why it was decomposed. Log the runner mismatch (bun test vs vitest) explicitly when splitting.
- Reconcile AC-CP-11's text with T5's task instruction on corpus-workflow.md: the AC requires asserting it ABSENT from the install dir, the task requires byte-comparing its installed copy. Pick one and update the other.
- Update task descriptions and the plan's Acceptance Criteria line to the live AC ids, and add an alias note for the retired AC-CP-3/AC-CP-5/AC-CP-7 references so evidence titles remain traceable.
- Stamp the commit SHA and tree-cleanliness state into each attested evidence record for final integration runs.

## Judgment

- Provider: claude-cli
- Prompt version: 6
- Duration: 100915ms
- Retried: false
- Truncated sections: (none)
- Reasoning clipped for: AC-CP-4, AC-CP-11

## Dimension Scores

| Dimension | Score | Confidence (self-reported, uncalibrated) | Based On | Reasoning |
|---|---|---|---|---|
| outcome | 85 | 0.7 | evidence | All 7 declared ACs have attested passes on their registered verify commands, most re-run twice by the orchestrator. Delivery breadth (constants, both surfaces, governance, install) is evidenced end-t… |
| evidence_integrity | 73 | 0.7 | evidence | Attested reruns at two timestamps are a real positive, but 36% attestation, one never-re-passed failing command, a /private/tmp scratchpad oracle, and no named clean-tree commit weaken the trail. |
| scope_fidelity | 77 | 0.65 | evidence | Work maps 1:1 to P1-P3 tasks with no extraneous surfaces. Deductions are bookkeeping drift: retired AC ids in task text, AC-CP-7/11 numbering, and T5 text contradicting AC-CP-11. |

## Typed Gaps

| Dimension | Severity | AC Ref | Statement |
|---|---|---|---|
| evidence_integrity | major | — | No diff was provided and tests_touched is false, so every AC verdict depends on test names plus pass/fail records. Whether the tests actually assert constant identity (rather than substring presence or self-referential imports) is unverifiable from these materials. |
| evidence_integrity | minor | AC-CP-10 | T2 evidence 5 records result=fail for 'bun test governance-bootstrap-framing-compiled.bun.test.ts tests/unit/hooks/session-bootstrap-injection.test.ts'. The remediation split it into a bun e2e run (ev 6) and a vitest run (ev 7); the original command was never re-run green, so the failure is superseded rather than resolved. |
| evidence_integrity | minor | — | attested_evidence_ratio is 0.36. T2, T3, T4 have a single attested run each — all of them the same final orchestrator e2e filter — so their intermediate unit/integration oracles rest entirely on self-report. |
| outcome | minor | AC-CP-11 | AC-CP-11 is the least-covered criterion: 2 runs, 10 expect calls. Its three-part statement (hook byte-identity from the install dir, corpus-workflow.md absence, governance output byte-identity) cannot be individually confirmed, and the governing task text asks for the opposite treatment of corpus-workflow.md. |
| outcome | minor | AC-CP-1 | The AC-CP-1 and AC-CP-2 oracles each resolve to one test (14 total, 13 skipped) and vitest output prints no assertion count, so the required REQUIRED_DISCLAIMER_TOKENS iteration and the intact-payload/unsliced-declaration/ledger-silence trio are evidenced only at test granularity. |
| scope_fidelity | minor | — | AC identifier drift across artifacts: tasks T2/T4 claim retired AC-CP-3/AC-CP-5, T5 and all its evidence titles use AC-CP-7 where the spec declares AC-CP-11, and the plan summarizes the set as 'AC-CP-1 … AC-CP-7' though the live ids are 1,2,4,6,9,10,11. |
| evidence_integrity | minor | — | The plan requires the final integration run on a clean tree at a named commit, citing measured phantom regressions from dirty concurrent checkouts. No evidence record names that commit; T4 evidence 3 executed an ad hoc scratchpad script against a worktree-local dist/lore. |

## Typed Recommendations

| Target | Action | Rationale |
|---|---|---|
| process | Require the diff (or the referenced test file bodies) in audit bundles for ACs whose statements specify assertion mechanics such as 'by identity' or 'iterates the exported array'. Pass/fail records alone cannot discriminate an identity assertion from a substring check. | All seven ACs here are script-mode with mechanics-specific wording, yet diff_available is false. |
| process | Treat a recorded failing command as open until that exact command re-runs green, or until a note explains why it was decomposed. Log the runner mismatch (bun test vs vitest) explicitly when splitting. | T2 evidence 5's failure is the only fail in the bundle and its resolution is inferred, not recorded. |
| spec | Reconcile AC-CP-11's text with T5's task instruction on corpus-workflow.md: the AC requires asserting it ABSENT from the install dir, the task requires byte-comparing its installed copy. Pick one and update the other. | A direct contradiction between AC and implementing task makes the oracle's intent ambiguous. |
| plan | Update task descriptions and the plan's Acceptance Criteria line to the live AC ids, and add an alias note for the retired AC-CP-3/AC-CP-5/AC-CP-7 references so evidence titles remain traceable. | Stale ids in three of five tasks force auditors to match ACs to evidence by prose rather than id. |
| process | Stamp the commit SHA and tree-cleanliness state into each attested evidence record for final integration runs. | The plan's own Verification section makes clean-tree-at-named-commit a condition, but nothing in the trail records it. |

## Unverifiable Materials

- Implementation and test diff: diff_available is false; no source for the five exported constants, buildBootstrapInjection projection, hook, governance asset, or any test file is present in the bundle.
- Per-assertion content of packages/core/tests/unit/bootstrap-injection-provenance.test.ts: Only 1 of 14 tests runs under each -t filter and vitest output shows no expect count, so the mandated token/key iterations cannot be confirmed.
- Commit identity and tree state of the final integration run: No evidence record names the commit; the plan requires a clean tree at a named commit.
- T4 evidence 3 scratchpad oracle (/private/tmp/.../verify-governance-payload-wide.ts): Ad hoc script in a temp session dir, run against a worktree-local binary; neither the script nor its output is in the bundle.
- mkdtemp corpus location for AC-CP-6: The out-of-tree property is asserted inside the test title only; the path used at runtime is not shown in the captured output.

## Facts Summary

- AC coverage: 7 declared criteria
- Task evidence: 5 tasks
- AC scope: 0 scoped, 0 dangling
- Knowledge capture: 3 docs (bundle)
- Regression: tests_touched=false, attested_evidence_ratio=0.36
