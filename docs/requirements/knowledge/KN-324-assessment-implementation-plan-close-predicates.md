---
id: KN-324
type: knowledge
role: knowledge
title: "Assessment: Implementation — plan-close predicates measure invariants (applicability type, per-claimed-AC coverage, attributable sync) (2026-07-30)"
status: archived
priority: medium
created: 2026-07-30
updated: 2026-10-23
tags: []
parent: PLAN-102
links:
  - {id: PLAN-102, type: informs}
---
# Assessment: met (84/100)

Scope: plan `01KYS1FSHTF9X1G396894Y4QNX`

## AC Scores

| AC | Score | Reasoning | Evidence |
|---|---|---|---|
| AC-PCI-1 | 88 | Pinned command run twice, 1 attested pass, 0 fail. Attested run shows 7 matched tests in predicate-applicability.test.ts, exit 0. Type-shape assertions themselves unverifiable (no diff). | task-t1-applicability-verdict-in-the-predicate-s-own-type-both, task-t5-compiled-binary-e2e-from-a-throwaway-corpus-clean-close (attested verify run [2]) |
| AC-PCI-2 | 85 | 3 pass / 1 attested. Was RED at 5fcb07f (T8 records 6 failures incl. this AC's tests), repaired with explicit planClaimedAcCoverage fixtures and fresh evidence; attested run (21 tests, 6 matched) is post-T8 and green. | task-t8-repair-the-t3-t4-integration-regression-6-under, task-t5-compiled-binary-e2e-from-a-throwaway-corpus-clean-close (attested [3]) |
| AC-PCI-3 | 85 | 3 pass / 1 attested; same regress-then-repair history as AC-PCI-2. Attested tail also shows the throwing-audit-writer path emitting its warning, matching the best-effort-audit clause. | task-t8-repair-the-t3-t4-integration-regression-6-under, task-t5-compiled-binary-e2e-from-a-throwaway-corpus-clean-close (attested [4]) |
| AC-PCI-4 | 88 | Attested run of plan-promote-prd-sync-advisory.test.ts: 6/6 pass, exit 0, no skips. Distinct-key requirement asserted only inside the test file, which is not visible here. | task-t1-applicability-verdict-in-the-predicate-s-own-type-both |
| AC-PCI-5 | 88 | evidence-panel.test.ts -t 'claimed set': 5 matched pass, 0 fail, attested. Exclusion of ai/human modes and dangling ac_refs asserted in-test; structural argument stated in T2 objective but not inspectable. | task-t2-per-claimed-ac-attested-coverage-as-the-default |
| AC-PCI-6 | 85 | Attested pass, but only 1 matched test for 'coverage conjunct' (28 skipped) — a single fixture carrying the whole meets_floor-false-with-ratio-met claim. Narrow but on-point. | task-t2-per-claimed-ac-attested-coverage-as-the-default |
| AC-PCI-7 | 85 | attestation-floor.test.ts -t 'ratio disabled': 1 matched pass, attested. Claims a real-gate archive transition with no exemption; that the path used CorpusService.set rather than the predicate alone is not verifiable from the tail. | task-t2-per-claimed-ac-attested-coverage-as-the-default |
| AC-PCI-8 | 85 | -t 'explicit ratio': 1 matched pass, attested. Three branches (0.5 denies, 0 permits, AND-ing with coverage) compressed into one matched test; assertion detail unverifiable. | task-t2-per-claimed-ac-attested-coverage-as-the-default |
| AC-PCI-9 | 88 | Attested run covers both files: ac-diagnostics 6/6 pass; reachability file fully skipped under the -t filter, so its byte-pinned tail is asserted unchanged only by T2's separate untouched-file claim, not by this run. | task-t2-per-claimed-ac-attested-coverage-as-the-default |
| AC-PCI-10 | 88 | plan-close-prd-sync.test.ts -t 'attribution': 8 matched pass, attested; T3 recorded a RED expected-fail first. Four required scenarios plausibly covered by 8 tests, though names aren't shown. | task-t3-domain-doc-sync-requires-attribution-to-the-closing-plan |
| AC-PCI-11 | 88 | predicate-contracts.test.ts -t 'contract table': 6 matched pass, attested, with a prior expected-fail RED run. --explain output assertions in-test only. | task-t4-plan-close-predicate-contract-table-lore-gate-explain |
| AC-PCI-12 | 90 | Strongest entry: attested bun-test tail names the compiled-binary scenarios explicitly (throwaway corpus, dist/lore, sibling plans, exit-0 archive with advisory 'genuinely printed'). Scenario B/control tail truncated. | task-t5-compiled-binary-e2e-from-a-throwaway-corpus-clean-close (attested [12]) |
| AC-PCI-13 | 85 | verification-projection-service.test.ts -t 'ratio disabled render': 1 matched pass, attested. The panel==gate equality claim rests on one fixture. | task-t2-per-claimed-ac-attested-coverage-as-the-default |
| AC-PCI-14 | 88 | PlanAttestationPanel.test.tsx -t 'ratio disabled render': 2 matched pass, attested, run from packages/dashboard as the AC specifies. | task-t2-per-claimed-ac-attested-coverage-as-the-default |
| AC-PCI-15 | 74 | Attested, but the only oracle is an anchored grep whose output_tail is two EPIPE 'broken pipe' errors from lore. Pipeline status comes from grep so a match is the likely reading, yet the tail shows no positive confirmation of the heading. | task-t6-upstream-adr-revision-clause-decision-status-accepted, task-t5-compiled-binary-e2e-from-a-throwaway-corpus-clean-close (attested [16]) |
| AC-PCI-16 | 88 | approve-advisory-render.test.ts: 4/4 pass attested, tail names the stderr-not-stdout exit-0 case and the reachability-vs-prd_sync distinctness regression test. T7 recorded RED first. | task-t7-lore-approve-renders-the-prd-sync-advisory-to-stderr |

## Gaps

- The plan's exit criterion requiring both test runners green on the full suite from the main checkout after the last merge has no corresponding evidence entry on any task. The newest broad run is `bun run test:changed 5fcb07f` (T8), which is scoped to changed files. T8's own history shows a merge can leave two already-passing ACs RED, so a changed-scope run is not a substitute here.
- AC-PCI-15's attested evidence records result=pass but its output_tail contains only two `EPIPE: broken pipe` errors from lore, with no captured match line. The pipeline's exit status is grep's, so a match is the likely reading, but nothing in the trail positively shows the '## Revision 2026-07-30' heading rendered unwrapped as the task required.
- T4 evidence [5] records `bun run test:changed f6abb2a` as result=fail. The mitigation is an isolated rerun of one bun test (`-t 'AC-072-9'`) plus two integration files, asserted to prove a pre-existing concurrency flake. The 'pre-existing' and 'unrelated' claims are the recorder's characterisation, not shown by the artifacts.
- Multi-branch ACs are each closed by one matched test: AC-PCI-7 and AC-PCI-8 show 1 matched / 14 skipped, AC-PCI-6 shows 1 matched / 28 skipped, AC-PCI-13 shows 1 matched / 12 skipped. AC-PCI-8 alone asserts three distinct paths (0.5 denies, explicit 0 permits, AND-ing with per-AC coverage) through the real gate.
- The plan's Goal says 'all 15 ACs' and its phase list names T1-T7 with T5=contract table, T6=compiled e2e, T7=ADR. The closing corpus has 16 declared ACs and eight tasks with a different mapping (T4=contract table, T5=e2e, T6=ADR, T7=approve render, T8=repair). All ACs are covered, but the plan text was never reconciled to the executed shape.
- AC-PCI-9's attested run fully SKIPS feed-attestation-reachability.test.ts (8 tests | 8 skipped) under the `-t 'unattested naming'` filter, so the AC's own clause about that file's byte-pinned Recovery tail still passing unchanged is not exercised by the attesting command.

## Recommendations

- Require a recorded full-suite run (vitest + bun) from the main checkout at the final merge SHA as evidence before plan-close, not just `test:changed`.
- Reject `| grep -q` as a script oracle shape, or require redirect-then-grep so the evidence tail captures the matched line instead of EPIPE.
- Split ACs whose statement enumerates 3+ independent branches (AC-PCI-8, AC-PCI-7, AC-PCI-13) so each branch has its own pinned command rather than one filtered test.
- Capture the T8 failure mode as a linked knowledge doc: retiring a defaulted-parameter fabrication converts omitted ctx fields into new verdicts, staling per-task pass evidence at merge.

## Judgment

- Provider: claude-cli
- Prompt version: 6
- Duration: 94507ms
- Retried: false
- Truncated sections: task:task-t8-repair-the-t3-t4-integration-regression-6-under, task:task-t4-plan-close-predicate-contract-table-lore-gate-explain, task:task-t3-domain-doc-sync-requires-attribution-to-the-closing-plan, task:task-t2-per-claimed-ac-attested-coverage-as-the-default, task:task-t1-applicability-verdict-in-the-predicate-s-own-type-both
- Overall confidence: low (degraded by truncation)

## Dimension Scores

| Dimension | Score | Confidence (self-reported, uncalibrated) | Based On | Reasoning |
|---|---|---|---|---|
| outcome | 86 | 0.72 | evidence | All 16 declared ACs carry an attested pass from one post-T8 verify sweep, incl. a compiled-binary e2e whose tail names its scenarios. No diff, so quality is inferred from oracles only. |
| evidence_integrity | 80 | 0.7 | evidence | RED-first runs, an honest T8 regression repair with fresh evidence, one attested run per AC. Weakened by AC-PCI-15's EPIPE-only tail, a dismissed test:changed failure, and no full-suite run. |
| scope_fidelity | 80 | 0.68 | evidence | Tasks map to declared anchors and no exemption is claimed. Drift: task numbering diverges from the plan's phases, an unplanned T8 was added, and AC-PCI-16 exceeds the plan's stated 15 ACs. |

## Typed Gaps

| Dimension | Severity | AC Ref | Statement |
|---|---|---|---|
| evidence_integrity | major | — | The plan's exit criterion requiring both test runners green on the full suite from the main checkout after the last merge has no corresponding evidence entry on any task. The newest broad run is `bun run test:changed 5fcb07f` (T8), which is scoped to changed files. T8's own history shows a merge can leave two already-passing ACs RED, so a changed-scope run is not a substitute here. |
| evidence_integrity | minor | AC-PCI-15 | AC-PCI-15's attested evidence records result=pass but its output_tail contains only two `EPIPE: broken pipe` errors from lore, with no captured match line. The pipeline's exit status is grep's, so a match is the likely reading, but nothing in the trail positively shows the '## Revision 2026-07-30' heading rendered unwrapped as the task required. |
| evidence_integrity | minor | AC-PCI-11 | T4 evidence [5] records `bun run test:changed f6abb2a` as result=fail. The mitigation is an isolated rerun of one bun test (`-t 'AC-072-9'`) plus two integration files, asserted to prove a pre-existing concurrency flake. The 'pre-existing' and 'unrelated' claims are the recorder's characterisation, not shown by the artifacts. |
| outcome | minor | — | Multi-branch ACs are each closed by one matched test: AC-PCI-7 and AC-PCI-8 show 1 matched / 14 skipped, AC-PCI-6 shows 1 matched / 28 skipped, AC-PCI-13 shows 1 matched / 12 skipped. AC-PCI-8 alone asserts three distinct paths (0.5 denies, explicit 0 permits, AND-ing with per-AC coverage) through the real gate. |
| scope_fidelity | minor | — | The plan's Goal says 'all 15 ACs' and its phase list names T1-T7 with T5=contract table, T6=compiled e2e, T7=ADR. The closing corpus has 16 declared ACs and eight tasks with a different mapping (T4=contract table, T5=e2e, T6=ADR, T7=approve render, T8=repair). All ACs are covered, but the plan text was never reconciled to the executed shape. |
| outcome | minor | — | AC-PCI-9's attested run fully SKIPS feed-attestation-reachability.test.ts (8 tests \| 8 skipped) under the `-t 'unattested naming'` filter, so the AC's own clause about that file's byte-pinned Recovery tail still passing unchanged is not exercised by the attesting command. |

## Typed Recommendations

| Target | Action | Rationale |
|---|---|---|
| process | Require a recorded full-suite run (vitest + bun) from the main checkout at the final merge SHA as evidence before plan-close, not just `test:changed`. | T8 documents a merge that left AC-PCI-2/3 RED while typecheck was clean; a changed-scope run is the wrong instrument for cross-anchor merges. |
| process | Reject `\| grep -q` as a script oracle shape, or require redirect-then-grep so the evidence tail captures the matched line instead of EPIPE. | AC-PCI-15's tail records only broken-pipe errors; an oracle whose only artifact is an error message is weak for an audit trail. |
| spec | Split ACs whose statement enumerates 3+ independent branches (AC-PCI-8, AC-PCI-7, AC-PCI-13) so each branch has its own pinned command rather than one filtered test. | A single matched test closing three behavioural branches makes partial implementation indistinguishable from full. |
| plan | Capture the T8 failure mode as a linked knowledge doc: retiring a defaulted-parameter fabrication converts omitted ctx fields into new verdicts, staling per-task pass evidence at merge. | Zero knowledge docs are linked, and this plan's own history shows the class recurring (writer-without-reader in T7, stale fixtures in T8). |

## Unverifiable Materials

- Implementation diff (no diff provided; diff_available=false): Cannot confirm PredicateNotApplicable omits `ok`, that no `?? []` fallback was restored, that byte-pinned pack text was untouched, or that declared-criteria extraction was reused rather than hand-rol…
- Test file bodies for all 16 pinned commands: Only run summaries and truncated tails are shown; the specific assertions each AC statement demands (channel, exit code, key distinctness, exact literals) are not inspectable.
- Full-suite (vitest + bun) run at the final merge commit: No evidence entry exists for it on any task; the plan's exit criteria require it.
- Absence of exemption fields (attestation_exempt / prd_sync_exempt / assessment_freshness_exempt) on this plan: Plan extra fields are not shown in the materials; the no-exemption exit criterion is asserted, not demonstrated.
- Closure of plan-implementation-context-provenance-scope-declaring under the new predicates: The plan names this as the ADR's own stated test of the fix; no evidence record covers it.

## Facts Summary

- AC coverage: 16 declared criteria
- Task evidence: 8 tasks
- AC scope: 0 scoped, 0 dangling
- Knowledge capture: 0 docs (bundle)
- Regression: tests_touched=false, attested_evidence_ratio=0.29
