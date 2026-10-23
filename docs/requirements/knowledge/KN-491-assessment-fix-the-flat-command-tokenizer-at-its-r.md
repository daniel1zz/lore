---
id: KN-491
type: knowledge
role: knowledge
title: "Assessment: Fix the flat command tokenizer at its root: one segmentation seam for all three path-parsing call sites (2026-08-21)"
status: archived
priority: medium
created: 2026-08-21
updated: 2026-10-23
tags: []
parent: PLAN-134
links:
  - {id: PLAN-134, type: informs}
---
# Assessment: inconclusive (N/A (fully truncated))

Scope: plan `01M0H3FSMHY8YA8EDH2N6YV6PY`

## AC Scores

| AC | Score | Reasoning | Evidence |
|---|---|---|---|
| AC-061-18 | 88 | 3 attested passes + unit cases asserting exact counts/arrays for test -f and echo-prose segments, plus unclassified-vs-zero distinction. Deducted because a later assess found the classifier arm re-admitted gap 8, showing the case set was under-specified. | 01M0H3HHE36NMFNBQY57WB11PX (evidence [1] red, [10]/[14]/[21] pass) |
| AC-061-19 | 78 | 3 attested passes with red-first evidence, but the diff shows the fix summed per PATTERN, not per occurrence — AC-061-23 later measured {files:1,tests:5} for two vitest summaries. The stated property ('every recognised summary') was only half delivered. | 01M0H3HHE36NMFNBQY57WB11PX (evidence [2] red, [11]/[15]/[22] pass) |
| AC-061-20 | 88 | Service-layer suite covers both halves: accept echo-prose declaration, refuse missing runner-segment path, refuse when echo names same basename. Attested pass ×3 with prior expected-fail. Symmetry requirement satisfied. | 01M0H3HHE36NMFNBQY57WB11PX (evidence [3] red, [12]/[16]/[23] pass) |
| AC-061-21 | 85 | New compiled-binary bun e2e created, freshness-guarded, throwaway mkdtemp corpus, asserts exit 0 + criterion written and exit 4 + nothing written. Red evidence [4]/[8]/[9] then attested pass ×3. Wiring proven at CLI surface. | 01M0H3HHE36NMFNBQY57WB11PX (evidence [4]/[8]/[9] red, [13]/[17]/[24] pass) |
| AC-061-22 | 72 | Leading-token re-anchor implemented, 7 cases including the AC-061-9 dogfooding shape and mydist collision; verify-completeness regression pair run. Only 1 of 2 passes attested, and the red evidence [1] tail shows discovery-refusal case names, not the -t-filtered block. | 01M0H9CFBPQGJRQW0M9AJX99Q0 (evidence [1] red, [3] pass, [7] regression pair) |
| AC-061-23 | 70 | matchAll over cloned global regexes, order-independence pinned, single-summary controls kept. But vitest 'Tests' lines are summed unpaired with 'Test Files' occurrences — a truncated stdout can mis-pair. 1 attested pass; red tail again shows unrelated case names. | 01M0H9CFBPQGJRQW0M9AJX99Q0 (evidence [2] red, [4] pass) |
| AC-061-15 | 65 | Standing regression criterion: 1 unattested pass (139 tests, 2 files) recorded in the second task's evidence [6]. Verify-runner suite unchanged and green, but the pass is self-reported rather than attested. | 01M0H9CFBPQGJRQW0M9AJX99Q0 (evidence [6]) |
| AC-061-1 | 50 | Zero evidence rows in this bundle. countExplicitPathArgs was materially rewritten (segment loop + worker split), so its pre-existing suite is a regression surface, yet only whole-file runs [5]/[25] (no ac_ref) touch it. | 01M0H3HHE36NMFNBQY57WB11PX (evidence [25] unattributed whole-file pass) |
| AC-061-2 | 50 | Zero evidence rows. parseExecutedUnits was rewritten twice in this bundle (sum-across-patterns, then matchAll), so this criterion's own oracle should have been re-run and attributed; only unattributed whole-file runs exist. | 01M0H9CFBPQGJRQW0M9AJX99Q0 (evidence [5] unattributed whole-file pass) |
| AC-061-3 | 55 | Zero evidence rows. judgeCompleteness now reads a summed total; behaviour is exercised indirectly by multi-runner-credit cases and the unattributed whole-file run, but not by its own declared oracle. | 01M0H3HHE36NMFNBQY57WB11PX (evidence [25]) |
| AC-061-9 | 55 | No evidence row for its own command, but the classifier change directly touches the dist/lore recognition this AC depends on; the verify-completeness regression pair (16 tests) passed in evidence [7], which is the standing guard named in the task. | 01M0H9CFBPQGJRQW0M9AJX99Q0 (evidence [7]) |
| AC-061-10 | 50 | No evidence rows. Filtered matched-case parsing shares parseExecutedUnits, which changed; only the unattributed whole-file attestation-completeness run covers it. | 01M0H9CFBPQGJRQW0M9AJX99Q0 (evidence [5]) |
| AC-061-11 | 40 | No evidence rows in this bundle and no run of the evidence-completeness-guard suite, which consumes the changed parse/filter primitives from @lore/core. | — |
| AC-061-12 | 40 | No evidence rows; the guard suite that depends on the mutated summary-parsing seam was never run in either task. | — |
| AC-061-13 | 40 | No evidence rows; unfiltered-control behaviour of the evidence guard is unverified after the parse changes. | — |
| AC-061-14 | 45 | No evidence rows. The diff is consistent with SSOT intent (patterns promoted, COMPILED_BINARY_TOKEN_PATTERN de-duplicated), but the single-definition-site scan was not run. | — |
| AC-061-16 | 40 | No evidence rows; the compiled-binary e2e guard suite for the evidence gate was not run despite core changes flowing into the compiled binary. | — |
| AC-061-17 | 40 | No evidence rows; MCP/CLI gate-parity unverified in this bundle. | — |
| AC-061-4 | 45 | No evidence rows; verify-completeness suite did pass in evidence [7] of the second task, which contains this REPRO case file, but not under this AC's own filtered command. | 01M0H9CFBPQGJRQW0M9AJX99Q0 (evidence [7] whole-file run of the suite) |
| AC-061-5 | 45 | No evidence rows; same whole-file verify-completeness pass [7] covers the file but not this criterion's declared -t filter. | 01M0H9CFBPQGJRQW0M9AJX99Q0 (evidence [7]) |
| AC-061-6 | 45 | No evidence rows; covered only incidentally by the whole-file verify-completeness run. | 01M0H9CFBPQGJRQW0M9AJX99Q0 (evidence [7]) |
| AC-061-7 | 40 | No evidence rows, and the statement's own path is known-wrong (superseded by AC-061-8). Nothing in this bundle exercises it. | — |
| AC-061-8 | 40 | No evidence rows; coverage-counting suite not run in either task. | — |
| AC-061-G1 | 40 | No evidence rows; phase-target inconclusive guard untouched and unrun here. | — |
| AC-061-G2 | 40 | No evidence rows; coverage-badge suite not run in either task. | — |

## Gaps

- AC-061-19 was attested green while its fix summed across the two PATTERNS (one non-global .exec() per runner) instead of every occurrence, so a stdout chaining two invocations of the SAME runner still under-credited. The defect was only caught later as AC-061-23.
- The AC-061-18/20 case set never fed a segment mentioning dist/lore in prose, so classifyCommandSegment's unanchored 5th arm reintroduced gap 8 in the same commit that closed it.
- parseExecutedUnits sums vitest 'Tests' line occurrences independently of 'Test Files' occurrences, assuming 1:1 pairing. A tail-truncated stdout with two file-count lines but one Tests line credits 2 files with only one invocation's case total; no case pins this skew.
- The recorded expected-fail rows for AC-061-22 and AC-061-23 show output tails enumerating findDiscoveryRefusal cases rather than the leading-token-classification / every-summary-occurrence blocks, so the red does not visibly demonstrate the intended cases failing.
- Multiple expected-fail rows are environment failures — vitest/config unresolved, 'filters did not match any test files', and a stale-binary guard throw — not assertion failures, so they do not establish a red for the property under test.
- The evidence-completeness guard ACs (AC-061-11/12/13/14/16/17) carry zero evidence rows even though they consume the mutated summary-parsing and filter-detection seam in packages/core/src/attestation-completeness.ts.
- AC-061-15's regression run is recorded as a self-reported (unattested) pass, and overall attested_evidence_ratio is 0.65 with task 01M0H9CFBPQGJRQW0M9AJX99Q0 showing 2 attested vs 5 self-reported rows.

## Recommendations

- Reject an expected-fail record whose output tail does not show the declared -t block's cases failing with an assertion diff; environment errors (missing config, zero-matched filter, stale-binary throw) must be re-run, not banked as red.
- For universally-quantified ACs ('every recognised summary', 'both extractors'), require one case per quantifier axis — same-runner ×2, cross-runner, single, and one prose-mention-of-each-recognised-runner-token — before attesting.
- Add a downstream-consumer run set to the plan: re-run and attribute the evidence-guard, verify-completeness and MCP-parity suites whenever attestation-completeness.ts or oracle-file-existence.ts changes.
- Pin a positional-pairing case for vitest summaries (two 'Test Files' lines, one 'Tests' line) and record the intended degrade behaviour explicitly.

## Judgment

- Provider: claude-cli
- Prompt version: 8
- Reproducible: yes (this prompt_version's rendering is guaranteed byte-identical)
- Duration: 258844ms
- Retried: true
- Truncated sections: spec, task:task-re-anchor-the-compiled-binary-classifier-arm-and-credit, task:task-promote-splitcommandsegments-to-the-one-segmentation-seam
- Overall confidence: low (degraded by truncation)

## Dimension Scores

| Dimension | Score | Confidence (self-reported, uncalibrated) | Based On | Reasoning |
|---|---|---|---|---|
| outcome | 75 | 0.7 | evidence | The four root-fix ACs plus the two follow-up ACs are attested green and the diff matches their claims, but AC-061-19's first landing under-delivered its stated property and needed re-fixing. |
| evidence_integrity | 58 | 0.65 | evidence | Attested passes exist for all six worked ACs, but several red rows are environment failures, two red tails name unrelated cases, and attested ratio is 0.65 with 18 ACs carrying no evidence. |
| scope_fidelity | 88 | 0.75 | evidence | Diff stays on the segmentation/summary seam plus its tests and one new e2e file; no ac_scope declared, and the follow-up task is a documented same-root defect closure. |

## Typed Gaps

| Dimension | Severity | AC Ref | Statement |
|---|---|---|---|
| outcome | major | AC-061-19 | AC-061-19 was attested green while its fix summed across the two PATTERNS (one non-global .exec() per runner) instead of every occurrence, so a stdout chaining two invocations of the SAME runner still under-credited. The defect was only caught later as AC-061-23. |
| outcome | major | AC-061-18 | The AC-061-18/20 case set never fed a segment mentioning dist/lore in prose, so classifyCommandSegment's unanchored 5th arm reintroduced gap 8 in the same commit that closed it. |
| outcome | minor | AC-061-23 | parseExecutedUnits sums vitest 'Tests' line occurrences independently of 'Test Files' occurrences, assuming 1:1 pairing. A tail-truncated stdout with two file-count lines but one Tests line credits 2 files with only one invocation's case total; no case pins this skew. |
| evidence_integrity | major | AC-061-22 | The recorded expected-fail rows for AC-061-22 and AC-061-23 show output tails enumerating findDiscoveryRefusal cases rather than the leading-token-classification / every-summary-occurrence blocks, so the red does not visibly demonstrate the intended cases failing. |
| evidence_integrity | major | AC-061-21 | Multiple expected-fail rows are environment failures — vitest/config unresolved, 'filters did not match any test files', and a stale-binary guard throw — not assertion failures, so they do not establish a red for the property under test. |
| evidence_integrity | major | AC-061-11 | The evidence-completeness guard ACs (AC-061-11/12/13/14/16/17) carry zero evidence rows even though they consume the mutated summary-parsing and filter-detection seam in packages/core/src/attestation-completeness.ts. |
| evidence_integrity | minor | AC-061-15 | AC-061-15's regression run is recorded as a self-reported (unattested) pass, and overall attested_evidence_ratio is 0.65 with task 01M0H9CFBPQGJRQW0M9AJX99Q0 showing 2 attested vs 5 self-reported rows. |

## Typed Recommendations

| Target | Action | Rationale |
|---|---|---|
| process | Reject an expected-fail record whose output tail does not show the declared -t block's cases failing with an assertion diff; environment errors (missing config, zero-matched filter, stale-binary throw) must be re-run, not banked as red. | Four red rows here are environment failures and two name unrelated cases, so the red-first discipline was formally satisfied without proving the property. |
| spec | For universally-quantified ACs ('every recognised summary', 'both extractors'), require one case per quantifier axis — same-runner ×2, cross-runner, single, and one prose-mention-of-each-recognised-runner-token — before attesting. | AC-061-19 and AC-061-18 both went green on a proper subset of their own quantifier, and each gap re-emerged within one commit. |
| plan | Add a downstream-consumer run set to the plan: re-run and attribute the evidence-guard, verify-completeness and MCP-parity suites whenever attestation-completeness.ts or oracle-file-existence.ts changes. | 18 of 25 declared ACs have no evidence while their direct dependencies were rewritten twice in this bundle. |
| process | Pin a positional-pairing case for vitest summaries (two 'Test Files' lines, one 'Tests' line) and record the intended degrade behaviour explicitly. | The current unpaired matchAll sums can produce a confident wrong total on truncated tails — the same failure class this spec exists to eliminate. |

## Unverifiable Materials

- Source of packages/lore/src/service/verify-runner-service.ts and the evidence-guard adapters: Not included in the diff or materials; downstream impact of the parseExecutedUnits/classifier changes could not be inspected.
- Full statement text of AC-061-20 (truncated in materials) and of AC-061-22/AC-061-23: Statements are cut off or absent, so exact required properties were judged from task prose and diff only.
- Independent test execution: No repository access in this audit; all pass/fail claims rest on the recorded evidence tails.

## Finding Path Verification

- Checked (confirmed present at the assessed commit): 7
- Unverifiable (confirmed absent — finding withdrawn): 0
- Unchecked (NO assessed-commit referent — NOT verified; do not read as "fine"): 0

## Facts Summary

- AC coverage: 25 declared criteria
- Task evidence: 2 tasks
- AC scope: 0 scoped, 0 dangling
- Knowledge capture: 2 docs (bundle)
- Regression: tests_touched=true, attested_evidence_ratio=0.65
