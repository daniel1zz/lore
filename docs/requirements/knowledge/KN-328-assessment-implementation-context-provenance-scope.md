---
id: KN-328
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
# Assessment: met (82/100)

Scope: plan `01KYRCSYQT9BZN3FFAB9K9MPVD`

## AC Scores

| AC | Score | Reasoning | Evidence |
|---|---|---|---|
| AC-CP-1 | 90 | Registered command run 4x, 2 attested by main-orchestrator, all pass. Filtered vitest run shows 1 pass / 13 skipped, consistent with the -t filter. Token-iteration assertions unverifiable without the test source or diff. | task-t1-core-constants-leading-scope-field-in (evidence [1],[5],[11]) |
| AC-CP-2 | 88 | Same registered oracle, 4 pass / 2 attested. Degenerate budget-exceeded behaviour pinned by a task-level test, but the payload-returned-intact and omission-ledger assertions are only inferable from test names, not from any inspected code. | task-t1-core-constants-leading-scope-field-in (evidence [2],[6],[12]) |
| AC-CP-4 | 90 | Strongest trail: 8 passes across MCP unit, CLI integration, pure-flow unit and the compiled e2e; 2 attested. Both required surfaces (CLI stdout + MCP lore_feed) exercised separately, plus a negative case (non-resume checkpoint stays closure-free). | task-t3-scope-closure-on-the-resume-ticket-cli-stdout-and-mcp (evidence [3],[4],[5],[6]), task-t5-compiled-e2e-suite-proving-every-surface-from-a (evidence [2],[10]) |
| AC-CP-6 | 84 | 2 passes, 1 attested, on the registered e2e. Runtime (3.3s) and 13 expect() calls are consistent with a real out-of-tree mkdtemp + compiled binary run. Thinnest run count of the passing ACs; no independent corroboration outside the one suite. | task-t5-compiled-e2e-suite-proving-every-surface-from-a (evidence [4],[8]) |
| AC-CP-9 | 82 | 3 pass / 2 attested on the registered e2e, plus governance/asset unit suites in T4. The AC replaced retired AC-CP-5 and carves resume_hint out of the 'names every key' duty; the paired zero-occurrence assertion mitigates but does not remove the weakening. | task-t4-payload-wide-feed-governance-rule-manifest-regeneration (evidence [1],[2],[5]), task-t5-compiled-e2e-suite-proving-every-surface-from-a (evidence [13]) |
| AC-CP-10 | 80 | 6 pass / 2 attested, but the only recorded fail in the whole bundle sits here (T2 evidence [5]) and is superseded by later passes with no stated cause. AC replaced retired AC-CP-3, so the criterion itself moved during execution. | task-t2-framing-line-emitted-binary-side-hook-demoted-to (evidence [5] fail, [6],[7],[10] pass), task-t5-compiled-e2e-suite-proving-every-surface-from-a (evidence [1],[14]) |
| AC-CP-11 | 72 | Single pass, attested. The AC was rewritten to accommodate corpus-workflow.md being retired from the install set, so the original 'installed copy is the oracle' check now holds only for the hook; the md is proved via the governance verb instead. Least redundant coverage. | task-t5-compiled-e2e-suite-proving-every-surface-from-a (evidence [5],[11],[15]) |

## Gaps

- Attested evidence ratio is 0.27: 35 of 48 recorded runs are self-reported by the same worktree agents that wrote the code. Each AC has only 1-2 attested runs, and AC-CP-6 and AC-CP-11 have exactly one each.
- AC-CP-3, AC-CP-5 and AC-CP-7 were retired and replaced by AC-CP-10, AC-CP-9 and AC-CP-11 during execution. Each replacement narrows the original duty: the framing line moved from --injection stdout to a governance verb, resume_hint was excluded from the 'names every key' iteration, and corpus-workflow.md's installed-copy byte compare became a governance-verb compare after the file was retired from the install set.
- The FEED rule provably does not name resume_hint. The carve-out is justified by a competing zero-occurrence invariant and guarded by a paired assertion, but AC-CP-9 as written no longer proves payload-wide key naming.
- T2 evidence [5] is a fail on the identical command as the adjacent passing entries [4] and [6], with no recorded cause. A flaky or environment-dependent hook/framing e2e cannot be ruled out from the bundle.
- AC-CP-11 has a single recorded pass on one e2e run. The plan's own Verification section calls for a final integration run on a clean tree at a named commit; no such run is recorded for this AC.

## Recommendations

- Include the implementation diff in audit bundles, or mark ACs as evidence-only when it is absent so scores are not read as quality judgements.
- Require every declared AC to carry at least one attested run of its registered command by an agent other than the implementing worktree agent, and fail attestation below that bar.
- When an AC is retired and replaced mid-execution, record the retirement rationale and the delta in the spec itself rather than only in task prose, so audits can see the criterion moved.
- Annotate superseded failing evidence with a cause and the fixing change, or drop it once the cause is recorded.
- Execute the plan's stated clean-tree integration run at a named commit and attach it as a single attested evidence record covering all seven AC commands.

## Judgment

- Provider: claude-cli
- Prompt version: 6
- Duration: 69829ms
- Retried: false
- Truncated sections: (none)

## Dimension Scores

| Dimension | Score | Confidence (self-reported, uncalibrated) | Based On | Reasoning |
|---|---|---|---|---|
| outcome | 86 | 0.7 | evidence | All seven ACs have passing registered oracles with at least one attested run; compiled-binary e2e covers every surface. Weakened by mid-flight AC rewrites that relaxed two original checks. |
| evidence_integrity | 68 | 0.75 | evidence | Trail is dense and oracle-kind diverse, but 0.27 attested ratio, one undiagnosed superseded fail, and one ad-hoc /tmp script as an oracle limit trust. |
| scope_fidelity | 74 | low | absence | No diff, so drift is undetectable. Task text documents the manifest-regen move T4→T5 and the AC replacements, but those replacements are themselves scope movement toward what was built. |

## Typed Gaps

| Dimension | Severity | AC Ref | Statement |
|---|---|---|---|
| evidence_integrity | major | — | Attested evidence ratio is 0.27: 35 of 48 recorded runs are self-reported by the same worktree agents that wrote the code. Each AC has only 1-2 attested runs, and AC-CP-6 and AC-CP-11 have exactly one each. |
| scope_fidelity | major | — | AC-CP-3, AC-CP-5 and AC-CP-7 were retired and replaced by AC-CP-10, AC-CP-9 and AC-CP-11 during execution. Each replacement narrows the original duty: the framing line moved from --injection stdout to a governance verb, resume_hint was excluded from the 'names every key' iteration, and corpus-workflow.md's installed-copy byte compare became a governance-verb compare after the file was retired from the install set. |
| outcome | minor | AC-CP-9 | The FEED rule provably does not name resume_hint. The carve-out is justified by a competing zero-occurrence invariant and guarded by a paired assertion, but AC-CP-9 as written no longer proves payload-wide key naming. |
| evidence_integrity | minor | AC-CP-10 | T2 evidence [5] is a fail on the identical command as the adjacent passing entries [4] and [6], with no recorded cause. A flaky or environment-dependent hook/framing e2e cannot be ruled out from the bundle. |
| evidence_integrity | minor | AC-CP-11 | AC-CP-11 has a single recorded pass on one e2e run. The plan's own Verification section calls for a final integration run on a clean tree at a named commit; no such run is recorded for this AC. |

## Typed Recommendations

| Target | Action | Rationale |
|---|---|---|
| process | Include the implementation diff in audit bundles, or mark ACs as evidence-only when it is absent so scores are not read as quality judgements. | diff_available=false and tests_touched=false make implementation quality and assertion strength unverifiable. |
| process | Require every declared AC to carry at least one attested run of its registered command by an agent other than the implementing worktree agent, and fail attestation below that bar. | Attested ratio 0.27 leaves most of the trail self-reported. |
| spec | When an AC is retired and replaced mid-execution, record the retirement rationale and the delta in the spec itself rather than only in task prose, so audits can see the criterion moved. | Three of seven ACs were replaced during this plan; the changes are only discoverable in task descriptions. |
| process | Annotate superseded failing evidence with a cause and the fixing change, or drop it once the cause is recorded. | T2 evidence [5] is an undiagnosed fail on a command that passes before and after. |
| plan | Execute the plan's stated clean-tree integration run at a named commit and attach it as a single attested evidence record covering all seven AC commands. | The plan mandates it; no such consolidated run appears in the bundle. |

## Unverifiable Materials

- Implementation diff: No diff provided; constant contents, projection logic, hook edits and assertion bodies could not be inspected.
- Test sources (context-provenance-compiled.bun.test.ts, bootstrap-injection-provenance.test.ts): Only test names and output tails available; per-member iteration and identity assertions taken on trust.
- Clean-tree integration run at a named commit: Required by the plan's Verification section but absent from the evidence trail.
- T4 scratchpad verification script: Lives under /private/tmp session scratch; contents and reproducibility not inspectable.

## Rubric Warnings

- Dimension "scope_fidelity" scored based_on="absence" but no matching entry was found in unverifiable[] or judgment.truncated[] — the absence claim is ungrounded.

## Facts Summary

- AC coverage: 7 declared criteria
- Task evidence: 5 tasks
- AC scope: 0 scoped, 0 dangling
- Knowledge capture: 2 docs (bundle)
- Regression: tests_touched=false, attested_evidence_ratio=0.27
