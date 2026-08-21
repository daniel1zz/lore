---
id: KN-489
type: knowledge
role: knowledge
title: "Assessment: Fix the flat command tokenizer at its root: one segmentation seam for all three path-parsing call sites (2026-08-21)"
status: approved
priority: medium
created: 2026-08-21
updated: 2026-08-21
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
| AC-061-18 | 80 | 3 attested passes; both extractors now read the shared splitCommandSegments seam and unclassified is an observable state. But the 'lore-cli' shape is matched unanchored anywhere in a segment, so an echo naming dist/lore re-admits prose tokens; unclassified is not consumed downstream. | 01M0H3HHE36NMFNBQY57WB11PX (evidence 10,14,21 attested pass; runner-segment-scope 6 cases) |
| AC-061-19 | 64 | 3 attested passes for the vitest+bun mixed stdout, but the fix sums across the two PATTERNS only: each uses a non-global exec, so a stdout with two bun (or two vitest) summaries still credits one. AC says 'EVERY recognised summary present'. | 01M0H3HHE36NMFNBQY57WB11PX (evidence 11,15,22 attested pass; multi-runner-credit 4 cases) |
| AC-061-20 | 87 | Service-layer suite covers both halves the AC demands: echo-prose declaration accepted, and a genuinely missing runner-segment path still refused with VALIDATION_ERROR naming the real path. 3 attested passes plus an unfiltered whole-file green. | 01M0H3HHE36NMFNBQY57WB11PX (evidence 12,16,23 attested; 26 unfiltered control) |
| AC-061-21 | 86 | Compiled-binary e2e on a throwaway mkdtemp corpus with a stale-binary guard, asserting accept-then-write and refuse-writing-nothing (exit 4). 3 attested passes. Its recorded red was a stale-binary guard throw, not the pre-fix wrong answer. | 01M0H3HHE36NMFNBQY57WB11PX (evidence 13,17,24 attested pass; 27 unfiltered) |
| AC-061-15 | 40 | Standing REGRESSION criterion over verify-runner-service.test.ts + the attestation suite. attestation-completeness.ts changed, yet no evidence row runs the verify-runner suite; only the attestation and ac-service files were run unfiltered. Mitigation: not this plan's declared AC. | 01M0H3HHE36NMFNBQY57WB11PX (evidence 25-27 omit verify-runner-service.test.ts) |
| AC-061-1 | 45 | 0 pass / 0 fail in this bundle. countExplicitPathArgs was rewritten by this diff, so its pre-existing criterion is now unattested against changed behaviour. Mitigation: predates this plan, which declares only AC-061-18..21. | — |
| AC-061-2 | 45 | 0 pass / 0 fail. parseExecutedUnits was rewritten (summing) by this diff and this criterion carries no run in the bundle. Mitigation: outside the plan's declared four ACs. | — |
| AC-061-3 | 45 | 0 pass / 0 fail in this bundle; judgeCompleteness consumes the changed parse seam. Mitigation: pre-existing criterion, not claimed by this plan. | — |
| AC-061-4 | 45 | 0 pass / 0 fail in this bundle. Mitigation: pre-existing criterion from an earlier plan; no evidence supplied or claimed here. | — |
| AC-061-5 | 45 | 0 pass / 0 fail in this bundle. Mitigation: pre-existing criterion, outside the plan's declared scope. | — |
| AC-061-6 | 45 | 0 pass / 0 fail in this bundle. Mitigation: pre-existing criterion, outside the plan's declared scope. | — |
| AC-061-7 | 45 | 0 pass / 0 fail in this bundle; superseded in part by AC-061-8's path correction. Mitigation: not claimed by this plan. | — |
| AC-061-8 | 45 | 0 pass / 0 fail in this bundle. Mitigation: pre-existing criterion, outside the plan's declared scope. | — |
| AC-061-G1 | 45 | 0 pass / 0 fail in this bundle. Mitigation: pre-existing criterion, outside the plan's declared scope. | — |
| AC-061-G2 | 45 | 0 pass / 0 fail in this bundle. Mitigation: pre-existing criterion, outside the plan's declared scope. | — |
| AC-061-9 | 45 | 0 pass / 0 fail in this bundle. Its COMPILED_BINARY pattern was relocated by this diff, so the criterion is unattested against the moved SSOT. Mitigation: not claimed by this plan. | — |
| AC-061-10 | 45 | 0 pass / 0 fail in this bundle; matched-case parsing shares the rewritten parseExecutedUnits. Mitigation: pre-existing criterion, not claimed here. | — |
| AC-061-11 | 45 | 0 pass / 0 fail in this bundle. Mitigation: pre-existing criterion, outside the plan's declared scope. | — |
| AC-061-12 | 45 | 0 pass / 0 fail in this bundle. Mitigation: pre-existing criterion, outside the plan's declared scope. | — |
| AC-061-13 | 45 | 0 pass / 0 fail in this bundle. Mitigation: pre-existing criterion, outside the plan's declared scope. | — |
| AC-061-14 | 45 | 0 pass / 0 fail in this bundle. This diff adds new shared exports, and the single-definition scan that would police duplication was not re-run. Mitigation: not claimed by this plan. | — |
| AC-061-16 | 45 | 0 pass / 0 fail in this bundle. Mitigation: pre-existing e2e criterion, outside the plan's declared scope. | — |
| AC-061-17 | 45 | 0 pass / 0 fail in this bundle. Mitigation: pre-existing MCP-parity criterion, outside the plan's declared scope. | — |

## Gaps

- parseExecutedUnits in packages/core/src/attestation-completeness.ts calls BUN_SUMMARY_PATTERN.exec and VITEST_SUMMARY_PATTERN.exec exactly once each (non-global), so it sums across the two RUNNER PATTERNS, not across every summary present. A stdout from two chained bun test invocations ('Ran 16 tests across 1 files.' then 'Ran 18 tests across 1 files.') still yields files:1 against declaredPaths:2 -> under_match -> inconclusive: the identical first-match-wins under-credit the AC says it closes,…
- In packages/core/src/oracle-file-existence.ts, classifyCommandSegment's four runner arms are ^\s*-anchored but the fifth tests COMPILED_BINARY_TOKEN_PATTERN anywhere in the segment. So 'bunx vitest run a.test.ts && echo "compare against dist/lore output for b.test.ts"' classifies the echo segment as runner 'lore-cli', extractTestFileTokens re-admits b.test.ts, and findMissingOracleFiles refuses the declaration — reproducing manifestation 3 for any prose mentioning the binary.
- The plan's non-negotiable symmetry requirement is satisfied only at the primitive level. countExplicitPathArgs in packages/core/src/attestation-completeness.ts skips unclassified segments and returns a bare number, and the diff contains no change to packages/lore/src/service/verify-runner-service.ts or the evidence guard to surface the unclassified verdict. A command of entirely unrecognised shape yields declaredPaths 0, so the completeness guard silently stops guarding instead of reporting an …
- The recorded attested reds do not falsify anything. Evidence 5,6,7,18,19,20 all end in 'failed to load config ... Cannot find package vitest' (deps never installed in the attested-red worktree); evidence 9 throws the stale-binary guard; evidence 1,2,3 tails show only skipped-case listings consistent with the -t filter matching nothing. Only evidence 4 is a genuine assertion-level red. A red that fails for an environmental reason cannot show the pre-fix wrong answer.
- The plan states the implementer's LAST step is declaring --falsifier-* on AC-061-18/19/20 via `lore ac set`, running them while the plan is LIVE, and recording the attested red at that moment. No evidence row, diff hunk, or knowledge doc in the materials shows any falsifier declaration or falsifier run, and 0 knowledge docs are linked.
- AC-061-15 is a standing regression criterion naming packages/lore/tests/unit/service/verify-runner-service.test.ts, and the task doc instructs running it. The three unfiltered control rows (evidence 25-27) run the attestation, ac-service and new e2e files only. The consumer of the rewritten judgeCompleteness/parseExecutedUnits seam was never exercised.
- The diff adds export-index rows for PLAN-132, PLAN-133, TASK-742, TASK-743 and TASK-744 in .lore/export-index.json, none of which belong to this plan or task. Mechanical corpus-index churn, but it makes the commit carry unrelated governance state.

## Recommendations

- Before restoring the spec to approved, land a follow-up making parseExecutedUnits per-occurrence (global regex + matchAll over both patterns) and anchoring classifyCommandSegment's lore-cli arm to the segment's leading token; pin both with cases asserting exact counts (two-bun-summary -> files:2; 'echo "... dist/lore ... b.test.ts"' -> no token).
- Require an attested red to be rejected when its output tail shows a startup/config/module-resolution error, a stale-binary guard throw, or a -t filter that matched zero cases. A red must name the assertion it failed on.
- Either declare extra.ac_scope on plans that target a subset of a long-lived spec, or re-run the spec's pre-existing oracles (AC-061-1/2/3/10/14/15) whenever their underlying seam is rewritten.
- Propagate the unclassified verdict into the verify and evidence guards, and add a criterion asserting a fully-unclassified command is reported as unclassified rather than declaredPaths 0.

## Judgment

- Provider: claude-cli
- Prompt version: 8
- Reproducible: yes (this prompt_version's rendering is guaranteed byte-identical)
- Duration: 133160ms
- Retried: false
- Truncated sections: spec, task:task-promote-splitcommandsegments-to-the-one-segmentation-seam
- Overall confidence: low (degraded by truncation)

## Dimension Scores

| Dimension | Score | Confidence (self-reported, uncalibrated) | Based On | Reasoning |
|---|---|---|---|---|
| outcome | 76 | 0.78 | evidence | Root fix landed as one seam with green oracles at unit, service and compiled-CLI layers; but summing is per-pattern not per-occurrence, lore-cli matching is unanchored, and unclassified stays unwired. |
| evidence_integrity | 64 | 0.72 | evidence | 20 attested rows, greens repeated 3x incl. compiled binary and unfiltered controls; but the recorded reds failed on missing vitest/stale binary, and no falsifier declaration or run is shown. |
| scope_fidelity | 88 | 0.8 | evidence | Diff confined to the two core modules plus their tests and the one new e2e file, matching the task. Only drift: unrelated PLAN/TASK rows added to the corpus export index. |

## Typed Gaps

| Dimension | Severity | AC Ref | Statement |
|---|---|---|---|
| outcome | major | AC-061-19 | parseExecutedUnits in packages/core/src/attestation-completeness.ts calls BUN_SUMMARY_PATTERN.exec and VITEST_SUMMARY_PATTERN.exec exactly once each (non-global), so it sums across the two RUNNER PATTERNS, not across every summary present. A stdout from two chained bun test invocations ('Ran 16 tests across 1 files.' then 'Ran 18 tests across 1 files.') still yields files:1 against declaredPaths:2 -> under_match -> inconclusive: the identical first-match-wins under-credit the AC says it closes,… |
| outcome | major | AC-061-18 | In packages/core/src/oracle-file-existence.ts, classifyCommandSegment's four runner arms are ^\s*-anchored but the fifth tests COMPILED_BINARY_TOKEN_PATTERN anywhere in the segment. So 'bunx vitest run a.test.ts && echo "compare against dist/lore output for b.test.ts"' classifies the echo segment as runner 'lore-cli', extractTestFileTokens re-admits b.test.ts, and findMissingOracleFiles refuses the declaration — reproducing manifestation 3 for any prose mentioning the binary. |
| outcome | major | — | The plan's non-negotiable symmetry requirement is satisfied only at the primitive level. countExplicitPathArgs in packages/core/src/attestation-completeness.ts skips unclassified segments and returns a bare number, and the diff contains no change to packages/lore/src/service/verify-runner-service.ts or the evidence guard to surface the unclassified verdict. A command of entirely unrecognised shape yields declaredPaths 0, so the completeness guard silently stops guarding instead of reporting an … |
| evidence_integrity | major | — | The recorded attested reds do not falsify anything. Evidence 5,6,7,18,19,20 all end in 'failed to load config ... Cannot find package vitest' (deps never installed in the attested-red worktree); evidence 9 throws the stale-binary guard; evidence 1,2,3 tails show only skipped-case listings consistent with the -t filter matching nothing. Only evidence 4 is a genuine assertion-level red. A red that fails for an environmental reason cannot show the pre-fix wrong answer. |
| evidence_integrity | major | — | The plan states the implementer's LAST step is declaring --falsifier-* on AC-061-18/19/20 via `lore ac set`, running them while the plan is LIVE, and recording the attested red at that moment. No evidence row, diff hunk, or knowledge doc in the materials shows any falsifier declaration or falsifier run, and 0 knowledge docs are linked. |
| evidence_integrity | minor | AC-061-15 | AC-061-15 is a standing regression criterion naming packages/lore/tests/unit/service/verify-runner-service.test.ts, and the task doc instructs running it. The three unfiltered control rows (evidence 25-27) run the attestation, ac-service and new e2e files only. The consumer of the rewritten judgeCompleteness/parseExecutedUnits seam was never exercised. |
| scope_fidelity | minor | — | The diff adds export-index rows for PLAN-132, PLAN-133, TASK-742, TASK-743 and TASK-744 in .lore/export-index.json, none of which belong to this plan or task. Mechanical corpus-index churn, but it makes the commit carry unrelated governance state. |

## Typed Recommendations

| Target | Action | Rationale |
|---|---|---|
| plan | Before restoring the spec to approved, land a follow-up making parseExecutedUnits per-occurrence (global regex + matchAll over both patterns) and anchoring classifyCommandSegment's lore-cli arm to the segment's leading token; pin both with cases asserting exact counts (two-bun-summary -> files:2; 'echo "... dist/lore ... b.test.ts"' -> no token). | Both defects are the same first-match/loose-match root the plan set out to remove, so shipping as-is leaves the seam re-breakable. |
| process | Require an attested red to be rejected when its output tail shows a startup/config/module-resolution error, a stale-binary guard throw, or a -t filter that matched zero cases. A red must name the assertion it failed on. | 7 of 9 red rows here failed environmentally, so the falsifier discipline produced no signal while still reading as attested. |
| spec | Either declare extra.ac_scope on plans that target a subset of a long-lived spec, or re-run the spec's pre-existing oracles (AC-061-1/2/3/10/14/15) whenever their underlying seam is rewritten. | 19 of 23 ACs show 0/0 coverage while the functions several of them describe were rewritten in this diff. |
| process | Propagate the unclassified verdict into the verify and evidence guards, and add a criterion asserting a fully-unclassified command is reported as unclassified rather than declaredPaths 0. | The plan called the symmetry requirement non-negotiable; today it is observable only from unit tests, not from any production surface. |

## Unverifiable Materials

- packages/lore/src/service/ac-service.ts and src/adapters/cli/commands/ac.ts post-fix source: Not in the diff; the AC-061-20/21 wiring claims rest on evidence tails alone.
- Oracle runs for the 19 spec ACs outside AC-061-18..21: 0 pass / 0 fail in the coverage facts and no evidence rows in the bundle.
- Falsifier declarations for AC-061-18/19/20: The plan makes them the implementer's last step; nothing in the materials records a declaration or a falsifier run.
- Repo-wide grep of declared verify.command shapes: The task told the implementer to measure the real distribution before fixing the five-shape list; only the resulting list is visible.

## Finding Path Verification

- Checked (confirmed present at the assessed commit): 6
- Unverifiable (confirmed absent — finding withdrawn): 0
- Unchecked (NO assessed-commit referent — NOT verified; do not read as "fine"): 0

## Facts Summary

- AC coverage: 23 declared criteria
- Task evidence: 1 tasks
- AC scope: 0 scoped, 0 dangling
- Knowledge capture: 0 docs (bundle)
- Regression: tests_touched=true, attested_evidence_ratio=0.74
