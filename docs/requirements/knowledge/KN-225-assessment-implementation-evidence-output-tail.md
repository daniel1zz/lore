---
id: KN-225
type: knowledge
role: knowledge
title: "Assessment: Implementation — evidence output_tail integrity: self-report non-pass predicate + runner AC-witnessing tail (2026-08-01)"
status: archived
priority: medium
created: 2026-08-01
updated: 2026-10-23
tags: []
parent: PLAN-083
links:
  - {id: PLAN-083, type: informs}
---
# Assessment: met (87/100)

Scope: plan `01KYYB0ENEGR78SFQYE6JX6NHE`

## AC Scores

| AC | Score | Reasoning | Evidence |
|---|---|---|---|
| AC-ETI-1 | 93 | Guard rejectMissingNonPassOutputTail wired into TaskWorkflowService._addEvidenceImpl; test asserts VALIDATION_ERROR/field=output_tail, exit 4, and non-append via direct store re-read (version 1, no verification_evidence). Red recorded with real assertion text; 3 pass, 2 attested. | 01KYYB1J2MX03VDYW0035NTM0W (rows [1] red, [2][12][18] green) |
| AC-ETI-2 | 92 | Predicate uses outputTail.trim().length > 0, so whitespace-only is rejected identically. Two tests ('\n' and '   '), the '\n' one also pins error.value and non-append. Red recorded with non-empty tail. Only the '\n' variant has a recorded red. | 01KYYB1J2MX03VDYW0035NTM0W (rows [3] red, [6][13][19] green) |
| AC-ETI-3 | 93 | Predicate branches on result !== 'fail' && !== 'expected-fail', so expected-fail shares one code path with fail (D1). Test pins rejection + non-append and adds a positive twin proving the guard fires on emptiness, not on the result value. Red recorded. | 01KYYB1J2MX03VDYW0035NTM0W (rows [4] red, [7][14][20] green) |
| AC-ETI-4 | 88 | Early return for non-fail results makes pass structurally unbound; test accepts pass + unfiltered command + no tail and asserts version 2 and one appended row. Control has no red phase (correctly), so its discriminating power rests on the diff, which supports it. | 01KYYB1J2MX03VDYW0035NTM0W (rows [8][15][21] green) |
| AC-ETI-5 | 91 | Diff confirms the guard lives only in the two _addEvidenceImpl bodies, not appendEvidenceEntry. Tests exercise recordVerifiedEvidence with output_tail='' and with it omitted, both appending and storing '' verbatim. Verified from diff, not just assertion text. | 01KYYB1J2MX03VDYW0035NTM0W (rows [9][16][22] green) |
| AC-ETI-6 | 92 | PhaseWorkflowService imports the same exported predicate (SSOT, not re-derived) and calls it before appendEvidenceEntry. Five tests including a byte-level parity check of code/field/message/value/exit-code against the task tier. Red recorded with real failure text. | 01KYYB1J2MX03VDYW0035NTM0W (rows [5] red, [10][17][23] green) |
| AC-ETI-7 | 82 | selectOutputTailWindow is correct and well-tested (last-occurrence wins, cap respected, non-vacuous naiveTail control). But tests bind the pure helper only; that executor/runner wiring actually stores this tail is covered by typecheck alone — no test on executeVerifySpawnSpec or acRef forwarding. | 01KYYB1J8B0KDQH5P09E2ANX66 (rows [1] red, [3][7][9] green; [6] typecheck) |
| AC-ETI-8 | 86 | Expected value is hand-derived ('b'.repeat(4000)) rather than recomputed via tailChars, meeting the plan's anti-vacuity demand; undefined and '' acRef variants also pinned. Red was 'not a function', a structural rather than behavioural red — inherent for a new pure helper. | 01KYYB1J8B0KDQH5P09E2ANX66 (rows [2] red, [4][8][10] green) |

## Gaps

- AC-ETI-7 says 'the stored output_tail contains that AC id', but every recorded run tests selectOutputTailWindow in isolation. The three-hop wiring (VerifyRunnerService recordAcRef gate -> buildVerifySpawnSpec acRef -> executeVerifySpawnSpec) is verified by typecheck only; a regression that stopped forwarding acRef would leave all AC-ETI-7 rows green.

## Recommendations

- When a guard lands on a shared write path and a follow-up commit repairs unrelated fixtures, require one broad-suite green evidence row at the head commit before archiving, not just per-AC `-t` runs.
- For slices that extract a pure helper for testability, add one narrow seam test asserting the caller still invokes it, so the AC cannot be satisfied by a helper the production path bypasses.

## Judgment

- Provider: claude-cli
- Prompt version: 7
- Duration: 77357ms
- Retried: false
- Truncated sections: (none)

## Dimension Scores

| Dimension | Score | Confidence (self-reported, uncalibrated) | Based On | Reasoning |
|---|---|---|---|---|
| outcome | 88 | 0.82 | evidence | Both slices land the specified behaviour; diff matches spec intent including the deliberate self-report/attested split. Only the executor wiring for AC-ETI-7 is unproven by test. |
| scope_fidelity | 90 | 0.85 | evidence | Anchors stayed disjoint as planned; guard placed exactly where the plan said and out of appendEvidenceEntry. Test-fixture churn is necessary fallout, disclosed in its own commit. |

## Typed Gaps

| Dimension | Severity | AC Ref | Statement |
|---|---|---|---|
| outcome | minor | AC-ETI-7 | AC-ETI-7 says 'the stored output_tail contains that AC id', but every recorded run tests selectOutputTailWindow in isolation. The three-hop wiring (VerifyRunnerService recordAcRef gate -> buildVerifySpawnSpec acRef -> executeVerifySpawnSpec) is verified by typecheck only; a regression that stopped forwarding acRef would leave all AC-ETI-7 rows green. |

## Typed Recommendations

| Target | Action | Rationale |
|---|---|---|
| process | When a guard lands on a shared write path and a follow-up commit repairs unrelated fixtures, require one broad-suite green evidence row at the head commit before archiving, not just per-AC `-t` runs. | Targeted -t runs cannot observe fixtures in other files or other test tiers; the fallout commit is direct proof the blast radius exceeded the AC files. |
| plan | For slices that extract a pure helper for testability, add one narrow seam test asserting the caller still invokes it, so the AC cannot be satisfied by a helper the production path bypasses. | T2 deliberately moved the ACs to the vitest tier; that trade left the executor call site unpinned. |

## Unverifiable Materials

- Full test-suite / bun-tier state after commit 02f6691: No evidence row runs the edited .bun.test.ts files or a whole-suite command at the final commit.
- Runtime behaviour of executeVerifySpawnSpec and VerifyRunnerService acRef forwarding: Covered only by the tsc row; no executed test exercises the spawn path end to end.
- @lore/core headChars existence and surrogate-safety contract: Not in the diff; inferred from the passing typecheck row and the module's stated BUG-001 history.
- Scope of `bun run test:changed 2a133a39` (T2 row [5]): Tail bytes recorded but no output_tail shown, so the set of tests it actually selected is unknown.
- evidence_integrity dimension score: based_on="absence" cited no matching unverifiable[]/judgment.truncated[] entry — suppressed as ungrounded rather than published as a finding.

## Rubric Warnings

- Dimension "evidence_integrity" scored based_on="absence" but no matching entry was found in unverifiable[] or judgment.truncated[] — the absence claim is ungrounded.

## Facts Summary

- AC coverage: 8 declared criteria
- Task evidence: 2 tasks
- AC scope: 0 scoped, 0 dangling
- Knowledge capture: 1 docs (bundle)
- Regression: tests_touched=true, attested_evidence_ratio=0.48
