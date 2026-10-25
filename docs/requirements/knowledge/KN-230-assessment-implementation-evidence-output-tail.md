---
id: KN-230
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
# Assessment: met (82/100)

Scope: plan `01KYYB0ENEGR78SFQYE6JX6NHE`

## AC Scores

| AC | Score | Reasoning | Evidence |
|---|---|---|---|
| AC-ETI-1 | 88 | Red recorded with real assertion text (expected true to be false), then green; re-attested green by main-orchestrator on the main repo path. Implementation code unseen (no diff), so guard placement is inferred from AC-ETI-5 only. | 01KYYB1J2MX03VDYW0035NTM0W (rows [1],[2],[12]) |
| AC-ETI-2 | 88 | Red row names the whitespace case explicitly (output_tail='\n') with a genuine assertion diff, then green plus an attested green. Trim semantics per D3 evidenced by test title only, not by code. | 01KYYB1J2MX03VDYW0035NTM0W (rows [3],[6],[13]) |
| AC-ETI-3 | 88 | expected-fail variant recorded red with assertion text, then green and an attested green. Shared-predicate claim (D1) is asserted by the test name; the predicate itself is not visible. | 01KYYB1J2MX03VDYW0035NTM0W (rows [4],[7],[14]) |
| AC-ETI-4 | 82 | CONTROL, correctly has no red (it should pass before and after). Two greens, one attested. Because a control cannot fail red, it gives no independent proof the new predicate did not widen — only that it did not break pass-path acceptance. | 01KYYB1J2MX03VDYW0035NTM0W (rows [8],[15]) |
| AC-ETI-5 | 84 | Key control that the guard did not land in the shared appendEvidenceEntry chokepoint: recordVerifiedEvidence with empty tail still appends. Two greens, one attested. Strongest available substitute for the missing diff. | 01KYYB1J2MX03VDYW0035NTM0W (rows [9],[16]) |
| AC-ETI-6 | 88 | Phase tier covered in its own file with a recorded red (assertion diff) then green; attested green shows all 5 tests in the file passing. Confirms the phase fallback channel was closed. | 01KYYB1J2MX03VDYW0035NTM0W (rows [5],[10],[17]) |
| AC-ETI-7 | 78 | Red is a weak kind — 'selectOutputTailWindow is not a function' (module-missing, not behavioral). Greens plus attested green cover the PURE helper; that the executor at verify-executor.ts:150 actually calls it is unproven here (only the broad test:changed run touches it). | 01KYYB1J8B0KDQH5P09E2ANX66 (rows [1],[3],[5],[7]) |
| AC-ETI-8 | 72 | Same module-missing red. The AC's core requirement — byte-identity against a CAPTURED pre-change string rather than a re-derived tailChars call — is exactly what a green run cannot distinguish, and no test source or diff is provided to check for vacuity. | 01KYYB1J8B0KDQH5P09E2ANX66 (rows [2],[4],[8]) |

## Gaps

- diff_available=false. The plan pins exact anchors (task-workflow-service.ts:717-777, phase-workflow-service.ts:468, verify-executor.ts:150) and forbids touching appendEvidenceEntry:795-916. None of this is checkable from the bundle; AC-ETI-5's green is behavioural evidence for the negative constraint but does not show where the code landed.
- The task text warns against asserting a property both old and new code satisfy vacuously, and requires comparing against a captured pre-change string. A green run is consistent with either a correct captured-literal assertion or a vacuous self-comparison, and no test source is in the bundle to discriminate.
- AC-ETI-7/8 speak of the STORED output_tail, but evidence covers a pure selectOutputTailWindow helper. No run of tests/integration/verify-executor.bun.test.ts is recorded; only the broad 'bun run test:changed' row indirectly covers the executor call site.
- T2's red rows fail with '(0, selectOutputTailWindow) is not a function' — the module did not exist yet. This proves the test ran before the implementation but not that the test discriminates correct from incorrect window selection.
- Independent re-attestation is single-source: every AC's attested pass comes from agent:main-orchestrator, run within one minute-range on the main repo path. attested_evidence_ratio is 0.32.

## Recommendations

- Include the implementation diff in audit bundles whenever a plan states negative placement constraints ('must NOT go in X'). Behavioural controls alone cannot localise code.
- For byte-identity / golden controls, require the evidence row to carry the captured expected value (or its hash) in output_tail, not just a green summary line.
- When extracting a pure helper to move ACs into the vitest tier, also require one recorded run of the pre-existing integration test that exercises the real call site.
- Treat 'symbol is not a function' reds as provisional; require at least one behavioural red (stub returning the old value, assertion mismatch) per behaviour-changing AC.
- Add a knowledge-capture requirement for the D2 scope rule: the non-pass tail predicate binds self-report only and must never bind the shared append chokepoint.

## Judgment

- Provider: claude-cli
- Prompt version: 6
- Duration: 67316ms
- Retried: false
- Truncated sections: (none)

## Dimension Scores

| Dimension | Score | Confidence (self-reported, uncalibrated) | Based On | Reasoning |
|---|---|---|---|---|
| outcome | 84 | 0.72 | evidence | All 8 ACs have 2 greens incl. 1 attested, 0 fails, plus typecheck on both tasks. Deductions: AC-ETI-7/8 proven only at the pure-helper level, wiring unproven. |
| evidence_integrity | 78 | 0.7 | evidence | Red-first honoured for all 6 non-control ACs with non-empty tails; T1's reds show real assertion diffs. Weakened by T2's module-missing reds and a 0.32 attested ratio from one recorder. |

## Typed Gaps

| Dimension | Severity | AC Ref | Statement |
|---|---|---|---|
| scope_fidelity | major | — | diff_available=false. The plan pins exact anchors (task-workflow-service.ts:717-777, phase-workflow-service.ts:468, verify-executor.ts:150) and forbids touching appendEvidenceEntry:795-916. None of this is checkable from the bundle; AC-ETI-5's green is behavioural evidence for the negative constraint but does not show where the code landed. |
| evidence_integrity | major | AC-ETI-8 | The task text warns against asserting a property both old and new code satisfy vacuously, and requires comparing against a captured pre-change string. A green run is consistent with either a correct captured-literal assertion or a vacuous self-comparison, and no test source is in the bundle to discriminate. |
| outcome | minor | AC-ETI-7 | AC-ETI-7/8 speak of the STORED output_tail, but evidence covers a pure selectOutputTailWindow helper. No run of tests/integration/verify-executor.bun.test.ts is recorded; only the broad 'bun run test:changed' row indirectly covers the executor call site. |
| evidence_integrity | minor | — | T2's red rows fail with '(0, selectOutputTailWindow) is not a function' — the module did not exist yet. This proves the test ran before the implementation but not that the test discriminates correct from incorrect window selection. |
| evidence_integrity | minor | — | Independent re-attestation is single-source: every AC's attested pass comes from agent:main-orchestrator, run within one minute-range on the main repo path. attested_evidence_ratio is 0.32. |

## Typed Recommendations

| Target | Action | Rationale |
|---|---|---|
| process | Include the implementation diff in audit bundles whenever a plan states negative placement constraints ('must NOT go in X'). Behavioural controls alone cannot localise code. | Scope fidelity here had to be scored on absence despite complete AC coverage. |
| plan | For byte-identity / golden controls, require the evidence row to carry the captured expected value (or its hash) in output_tail, not just a green summary line. | AC-ETI-8's stated anti-vacuity risk is invisible in a pass/fail record. |
| plan | When extracting a pure helper to move ACs into the vitest tier, also require one recorded run of the pre-existing integration test that exercises the real call site. | Keeps the helper-to-production wiring from becoming an untested seam. |
| process | Treat 'symbol is not a function' reds as provisional; require at least one behavioural red (stub returning the old value, assertion mismatch) per behaviour-changing AC. | Module-missing reds do not demonstrate the test discriminates old from new behaviour. |
| spec | Add a knowledge-capture requirement for the D2 scope rule: the non-pass tail predicate binds self-report only and must never bind the shared append chokepoint. | 0 knowledge docs linked; the rule is easy to re-break in a later refactor. |

## Unverifiable Materials

- Implementation diff for task-workflow-service.ts, phase-workflow-service.ts and verify-executor.ts: diff_available=false; guard placement, error shape (VALIDATION_ERROR field=output_tail with repair-action wording), and non-duplication of findFilteredPassRefusal wording cannot be inspected.
- Source of packages/lore/tests/unit/service/verify-tail-witness.test.ts: Needed to confirm AC-ETI-8 asserts against a captured pre-change literal rather than re-deriving tailChars, which would make the control vacuous.
- A recorded run of tests/integration/verify-executor.bun.test.ts: No evidence row targets it, so the wiring of selectOutputTailWindow into verify-executor.ts:150 is unconfirmed.
- Full output of 'bun run test:changed 2a133a39' (T2 row [5]): Tail shows only server-startup noise and a detector summary line; the test pass/fail summary is outside the retained window.
- scope_fidelity dimension score: based_on="absence" cited no matching unverifiable[]/judgment.truncated[] entry — suppressed as ungrounded rather than published as a finding.

## Rubric Warnings

- Dimension "scope_fidelity" scored based_on="absence" but no matching entry was found in unverifiable[] or judgment.truncated[] — the absence claim is ungrounded.

## Facts Summary

- AC coverage: 8 declared criteria
- Task evidence: 2 tasks
- AC scope: 0 scoped, 0 dangling
- Knowledge capture: 0 docs (bundle)
- Regression: tests_touched=false, attested_evidence_ratio=0.32
