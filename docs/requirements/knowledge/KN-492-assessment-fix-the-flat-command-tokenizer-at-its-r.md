---
id: KN-492
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
| AC-061-18 | 92 | Diff shows countExplicitPathArgs and extractTestFileTokens both routed through splitCommandSegments/classifyCommandSegment; unclassified is a distinct verdict. 3 attested passes with real vitest tails plus a prior red. | 01M0H3HHE36NMFNBQY57WB11PX (evidence [1] red, [10]/[14]/[21] attested pass) |
| AC-061-19 | 88 | parseExecutedUnits now accumulates instead of returning on first match; single-summary controls pinned. 3 attested passes. Gap: as landed here it summed per PATTERN only, which AC-061-23 had to correct. | 01M0H3HHE36NMFNBQY57WB11PX (evidence [2] red, [11]/[15]/[22] attested pass) |
| AC-061-20 | 90 | ac-service tests cover accept-echo-prose plus two refusal cases naming the missing runner-segment path, so the symmetry requirement is exercised. 3 attested passes plus a recorded red. | 01M0H3HHE36NMFNBQY57WB11PX (evidence [3] red, [12]/[16]/[23] attested pass) |
| AC-061-21 | 90 | New compiled-binary bun e2e drives dist/lore against a throwaway mkdtemp corpus with a freshness guard; asserts accept-and-write and exit 4 writing nothing. Attested passes show both cases green. | 01M0H3HHE36NMFNBQY57WB11PX (evidence [4]/[8]/[9] reds, [13]/[17]/[24] attested pass) |
| AC-061-22 | 82 | Fifth classifier arm re-anchored to a leading-token pattern derived from COMPILED_BINARY_TOKEN_PATTERN.source; 7 cases including the dogfooding shape. Only 1 attested pass, and evidence [1] red tail shows unrelated discovery-refusal cases. | 01M0H9CFBPQGJRQW0M9AJX99Q0 (evidence [1] red, [3] attested pass) |
| AC-061-23 | 82 | matchAll over global clones credits every occurrence; order-independence and single-summary controls pinned. 1 attested pass. Vitest tests-line summing is positional-pairing-free by assumption, untested when only one of two invocations prints a Tests line. | 01M0H9CFBPQGJRQW0M9AJX99Q0 (evidence [2] red, [4] attested pass) |
| AC-061-1 | 60 | Not in this plan's scope; no evidence recorded. countExplicitPathArgs was refactored under it, but the AC-061-1 suite was not run as a named regression — only the unfiltered whole-file run in evidence [25]. | 01M0H3HHE36NMFNBQY57WB11PX (evidence [25] unfiltered attestation-completeness run) |
| AC-061-2 | 60 | Pre-existing AC over parseExecutedUnits, which this plan rewrote. No AC-061-2-tagged evidence; only the unfiltered whole-file green run covers it indirectly. | 01M0H3HHE36NMFNBQY57WB11PX (evidence [25]) |
| AC-061-3 | 60 | judgeCompleteness consumes the changed executed-unit total. No AC-tagged run; whole-file suite green. | 01M0H3HHE36NMFNBQY57WB11PX (evidence [25]) |
| AC-061-4 | 60 | Out of plan scope; no evidence in this bundle. | — |
| AC-061-5 | 60 | Out of plan scope; no evidence in this bundle. | — |
| AC-061-6 | 60 | Out of plan scope; no evidence in this bundle. | — |
| AC-061-7 | 60 | Out of plan scope; superseded by AC-061-8; no evidence in this bundle. | — |
| AC-061-8 | 60 | Out of plan scope; no evidence in this bundle. | — |
| AC-061-G1 | 60 | Out of plan scope; no evidence in this bundle. | — |
| AC-061-G2 | 60 | Out of plan scope; no evidence in this bundle. | — |
| AC-061-9 | 60 | The plan explicitly flags AC-061-9's ./dist/lore dogfooding shape as a constraint the re-anchoring must preserve, and the task text says to run the standing verify-completeness regression pair, but no such run appears in the evidence. | 01M0H9CFBPQGJRQW0M9AJX99Q0 (verify-completeness.test.ts regression pair not run) |
| AC-061-10 | 60 | Filtered-case-count behavior in the same module; covered only by the unfiltered whole-file green run, not a tagged oracle. | 01M0H3HHE36NMFNBQY57WB11PX (evidence [25]) |
| AC-061-11 | 60 | Evidence-guard AC consuming these primitives; no run recorded in this bundle. | — |
| AC-061-12 | 60 | Evidence-guard AC consuming these primitives; no run recorded in this bundle. | — |
| AC-061-13 | 60 | Evidence-guard AC consuming these primitives; no run recorded in this bundle. | — |
| AC-061-14 | 60 | Single-definition-site scan AC. The diff is consistent with SSOT intent (patterns promoted, not copied), but the guard suite was not run to confirm. | — |
| AC-061-15 | 55 | Standing REGRESSION over verify-runner-service.test.ts plus the unfiltered attestation suite; both tasks' instructions call for running it. Only the attestation half appears (evidence [25]); no verify-runner-service run in either task. | 01M0H3HHE36NMFNBQY57WB11PX (evidence [25] covers only half the declared command) |
| AC-061-16 | 60 | Out of plan scope; no evidence in this bundle. | — |
| AC-061-17 | 60 | Out of plan scope; no evidence in this bundle. | — |

## Gaps

- AC-061-15's declared command covers packages/lore/tests/unit/service/verify-runner-service.test.ts plus the attestation suite, and both task briefs instruct running it. Only the attestation half appears (evidence [25]/[27]); no verify-runner-service run is recorded in either task, so the standing regression over lore verify's consumer of judgeCompleteness is unproven against a rewritten parseExecutedUnits.
- The AC-061-22 task text names packages/lore/tests/unit/service/verify-completeness.test.ts as the standing regression pair guarding AC-061-9's ./dist/lore dogfooding classification against the anchor tightening, and says to run it. No evidence row for that file exists in either task.
- AC-061-19 was attested green in packages/core/src/attestation-completeness.ts while parseExecutedUnits still summed once per PATTERN via non-global .exec, so two invocations of the SAME runner kept the under-credit the AC exists to remove. The gap between 'AC green' and 'property held' persisted through merge until lore assess found it.
- In packages/core/src/attestation-completeness.ts, parseExecutedUnits sums every VITEST_TESTS_LINE occurrence whenever any Test Files line matched, with no positional pairing. A stdout where one of two vitest invocations was truncated before its Tests line yields a files total covering two runs and a tests total covering one; no case pins this.
- packages/core/src/oracle-file-existence.ts now silently contributes zero path tokens for any segment outside the five recognised runner arms. classifyCommandSegments exposes 'unclassified' structurally, but no consumer in the diff refuses or warns on an all-unclassified command, so a novel runner shape escapes the declaration-time existence check entirely.
- The recorded expected-fail tails for AC-061-22 and AC-061-23 (task 01M0H9CFBPQGJRQW0M9AJX99Q0, evidence [1]/[2]) show only findDiscoveryRefusal case names, never the leading-token-classification or every-summary-occurrence cases they claim to have failed, so the red is not legible from the captured tail.
- Several recorded reds for AC-061-18/19/20/21 are environment failures inside the attested-red worktree (vitest/config unresolved, stale-binary guard throwing in packages/lore/tests/e2e/ac-add-path-precheck-compiled.bun.test.ts) rather than assertion failures naming the phantom token, so those rows prove the harness ran, not that the pre-fix defect reproduced.

## Recommendations

- Require that a task whose brief names a standing regression command (AC-061-15's verify-runner-service pair, AC-061-22's verify-completeness pair) cannot record its own ACs attested until an evidence row for that exact command exists.
- Reject an expected-fail evidence row whose output_tail contains no case name matching the declared -t filter. Environment failures (unresolved vitest/config, stale-binary guard throws) should be recorded as a distinct kind, never as an attested red.
- Add an AC pinning what parseExecutedUnits returns when a stdout carries two vitest Test Files lines but only one Tests line, and what an all-unclassified command should do at declaration time (refuse, warn, or pass).
- For each new case, require the author to state the smallest input that keeps it green while the goal fails, and record that string alongside the case. AC-061-19 shipped green with only the mixed-runner shape covered.

## Judgment

- Provider: claude-cli
- Prompt version: 8
- Reproducible: yes (this prompt_version's rendering is guaranteed byte-identical)
- Duration: 234858ms
- Retried: true
- Truncated sections: spec, task:task-re-anchor-the-compiled-binary-classifier-arm-and-credit, task:task-promote-splitcommandsegments-to-the-one-segmentation-seam
- Overall confidence: low (degraded by truncation)

## Dimension Scores

| Dimension | Score | Confidence (self-reported, uncalibrated) | Based On | Reasoning |
|---|---|---|---|---|
| outcome | 85 | 0.75 | evidence | All four planned ACs plus two follow-ups land with attested passes and a coherent single-seam refactor; but AC-061-19's first landing under-delivered its own stated property and needed AC-061-23. |
| evidence_integrity | 72 | 0.7 | evidence | Reds and greens recorded with real runner tails, throwaway corpus, freshness guard. Weakened by red tails not naming the claimed cases, missing AC-061-15 half, ratio 0.69. |
| scope_fidelity | 90 | 0.8 | evidence | Diff touches exactly the two core modules, their tests, one new e2e, and index rows. No unrelated refactors; the second task is a declared follow-up on the same root. |

## Typed Gaps

| Dimension | Severity | AC Ref | Statement |
|---|---|---|---|
| evidence_integrity | major | AC-061-15 | AC-061-15's declared command covers packages/lore/tests/unit/service/verify-runner-service.test.ts plus the attestation suite, and both task briefs instruct running it. Only the attestation half appears (evidence [25]/[27]); no verify-runner-service run is recorded in either task, so the standing regression over lore verify's consumer of judgeCompleteness is unproven against a rewritten parseExecutedUnits. |
| evidence_integrity | major | AC-061-22 | The AC-061-22 task text names packages/lore/tests/unit/service/verify-completeness.test.ts as the standing regression pair guarding AC-061-9's ./dist/lore dogfooding classification against the anchor tightening, and says to run it. No evidence row for that file exists in either task. |
| outcome | major | AC-061-19 | AC-061-19 was attested green in packages/core/src/attestation-completeness.ts while parseExecutedUnits still summed once per PATTERN via non-global .exec, so two invocations of the SAME runner kept the under-credit the AC exists to remove. The gap between 'AC green' and 'property held' persisted through merge until lore assess found it. |
| outcome | minor | AC-061-23 | In packages/core/src/attestation-completeness.ts, parseExecutedUnits sums every VITEST_TESTS_LINE occurrence whenever any Test Files line matched, with no positional pairing. A stdout where one of two vitest invocations was truncated before its Tests line yields a files total covering two runs and a tests total covering one; no case pins this. |
| outcome | minor | AC-061-18 | packages/core/src/oracle-file-existence.ts now silently contributes zero path tokens for any segment outside the five recognised runner arms. classifyCommandSegments exposes 'unclassified' structurally, but no consumer in the diff refuses or warns on an all-unclassified command, so a novel runner shape escapes the declaration-time existence check entirely. |
| evidence_integrity | minor | AC-061-22 | The recorded expected-fail tails for AC-061-22 and AC-061-23 (task 01M0H9CFBPQGJRQW0M9AJX99Q0, evidence [1]/[2]) show only findDiscoveryRefusal case names, never the leading-token-classification or every-summary-occurrence cases they claim to have failed, so the red is not legible from the captured tail. |
| evidence_integrity | minor | AC-061-21 | Several recorded reds for AC-061-18/19/20/21 are environment failures inside the attested-red worktree (vitest/config unresolved, stale-binary guard throwing in packages/lore/tests/e2e/ac-add-path-precheck-compiled.bun.test.ts) rather than assertion failures naming the phantom token, so those rows prove the harness ran, not that the pre-fix defect reproduced. |

## Typed Recommendations

| Target | Action | Rationale |
|---|---|---|
| process | Require that a task whose brief names a standing regression command (AC-061-15's verify-runner-service pair, AC-061-22's verify-completeness pair) cannot record its own ACs attested until an evidence row for that exact command exists. | Both tasks were told to run standing regressions and neither recorded one; the consumers of the rewritten primitives are unverified here. |
| process | Reject an expected-fail evidence row whose output_tail contains no case name matching the declared -t filter. Environment failures (unresolved vitest/config, stale-binary guard throws) should be recorded as a distinct kind, never as an attested red. | Multiple recorded reds prove only that the worktree was broken, not that the pre-fix defect reproduced. |
| spec | Add an AC pinning what parseExecutedUnits returns when a stdout carries two vitest Test Files lines but only one Tests line, and what an all-unclassified command should do at declaration time (refuse, warn, or pass). | Both are currently decided by implementation comment rather than by a test, and both are the same silent-zero shape the plan forbids. |
| process | For each new case, require the author to state the smallest input that keeps it green while the goal fails, and record that string alongside the case. AC-061-19 shipped green with only the mixed-runner shape covered. | The two-of-the-same-runner shape was the obvious sibling of the case that was written; naming the near-miss surfaces it. |

## Unverifiable Materials

- packages/lore/src/service/ac-service.ts and its checkDeclaredPathExistence: Named as the consumer wired to the fix but not present in the diff; only its test file changes are visible.
- packages/lore/tests/integration/helpers/assert-fresh-binary: Imported by the new e2e suite to guard against a stale dist/lore; the helper source is not in the materials.
- Whole-file green runs (evidence [25]/[26]/[27] and task 747 [5]): Tails truncated to ~100-303 bytes, so pass/fail counts and file totals cannot be read from the record.
- Corpus distribution of declared verify.command strings: The five recognised runner arms are said to be measured against it; the underlying grep output is not shown, so arm coverage cannot be checked.

## Finding Path Verification

- Checked (confirmed present at the assessed commit): 6
- Unverifiable (confirmed absent — finding withdrawn): 0
- Unchecked (NO assessed-commit referent — NOT verified; do not read as "fine"): 0

## Facts Summary

- AC coverage: 25 declared criteria
- Task evidence: 2 tasks
- AC scope: 0 scoped, 0 dangling
- Knowledge capture: 1 docs (bundle)
- Regression: tests_touched=true, attested_evidence_ratio=0.69
