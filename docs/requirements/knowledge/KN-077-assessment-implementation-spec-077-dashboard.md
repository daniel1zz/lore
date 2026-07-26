---
id: KN-077
type: knowledge
role: knowledge
title: "Assessment: Implementation — SPEC-077 dashboard execution read surface (2026-07-25)"
status: draft
priority: medium
created: 2026-07-25
updated: 2026-07-25
tags: []
parent: PLAN-041
links:
  - {id: PLAN-041, type: informs}
---
# Assessment: partially_met (78/100)

Scope: plan `01KYBHPM0FRHN608TW2SHDT2T8`

## AC Scores

| AC | Score | Reasoning | Evidence |
|---|---|---|---|
| AC-077-1 | 88 | Oracle command run 3x pass (2 attested); 21 tests across ExecutionPage/ReadyTaskList. Test bodies not visible, so tri-state badge + TTL clamp + ?plan sync assertions cannot be confirmed line-by-line; no diff provided. | 01KYBHQ7SZT7MZXFM0FG99ZCHY (T2 ev[1] self-reported pass), 01KYBHPX57VD4TGYNK9NPA5MC9 (T1 ev[3] attested pass), 01KYBHQHN6617N5QWMJB93XEM5 (T3 ev[3] attested pass) |
| AC-077-2 | 88 | SessionsPanel (5 tests) + AnchorConflictsPanel (4 tests) pass 3x, 2 attested. Counts plausibly cover row rendering plus empty state, but keying by (by,machine,worktree) and literal empty text are unverifiable without sources. | 01KYBHPX57VD4TGYNK9NPA5MC9 (T1 ev[4] attested pass), 01KYBHQHN6617N5QWMJB93XEM5 (T3 ev[4] attested pass) |
| AC-077-3 | 87 | PhaseProgressPanel 9 tests pass 3x (2 attested). AC bundles six behaviors (a/b counts, checklist states, dropped names, vacuous badge, verbatim trust labels, empty state); 9 tests is consistent but per-behavior coverage is unverified. | 01KYBHPX57VD4TGYNK9NPA5MC9 (T1 ev[5] attested pass), 01KYBHQHN6617N5QWMJB93XEM5 (T3 ev[5] attested pass) |
| AC-077-4 | 86 | Both lore suites pass 3x (2 attested) and tsc passes. Output tail is only server-start noise — no test names or pass counts shown, so 200/404/422/dual-auth cases and claim_ttl_minutes equality are inferred, not observed. | 01KYBHPX57VD4TGYNK9NPA5MC9 (T1 ev[1]/ev[6] pass; ev[2] tsc pass), 01KYBHQHN6617N5QWMJB93XEM5 (T3 ev[6] attested pass) |
| AC-077-5 | 58 | Mixed: 1 attested pass (2 Playwright tests green in T3 ev[7]) against 2 fails — T3 ev[2] self-reported fail and T1 ev[7] attested 'No tests found' (pre-merge sequencing). Final state looks green but the ledger is contradictory and unordered. | 01KYBHQHN6617N5QWMJB93XEM5 (ev[7] attested pass, 2 tests; ev[2] self-reported fail), 01KYBHPX57VD4TGYNK9NPA5MC9 (ev[7] attested fail: No tests found) |
| AC-077-6 | 88 | use-route-telemetry 8 tests pass 3x (2 attested). The added /execution route_id case is claimed in T2 scope and the file grew a case per plan, but the exactly-one-POST assertion itself is not visible. | 01KYBHPX57VD4TGYNK9NPA5MC9 (T1 ev[8] attested pass), 01KYBHQHN6617N5QWMJB93XEM5 (T3 ev[8] attested pass) |
| AC-077-4 | 86 | Duplicate guard omitted. | — |

## Gaps

- AC-077-5 has 2 fail records against 1 pass. T1 ev[7] is an attested fail ('No tests found') and T3 ev[2] a self-reported fail; T3 ev[7] is an attested pass showing 2/2 green. Records carry no ordering, so the passing run cannot be proven to supersede the failures.
- The lore bun-test evidence (T1 ev[1], T1 ev[6], T3 ev[6]) shows output tails containing only repeated 'Lore server running at http://127.0.0.1:0' lines — truncated before any test name, assertion, or pass count. The 200/404/422 cases, dual-auth acceptance, and claim_ttl_minutes equality are asserted only by the pass verdict.
- No diff was provided, so no component source or test body could be inspected. Multi-clause ACs (tri-state claim badge with clamped TTL in AC-077-1; six distinct scorecard behaviors in AC-077-3) are judged solely from aggregate test counts, which cannot show which clauses are actually asserted.
- T3's second deliverable — fixing the stale packages/dashboard/CLAUDE.md ready-route line and documenting the /execution surface — maps to no oracle and no AC. With no diff, it is unverifiable whether this in-scope work was done at all.
- T2, the task that authored the entire dashboard UI layer for AC-077-1/2/3/6, has 0 attested and 5 self-reported evidence records. Independent corroboration comes only from T1/T3 autopilot reruns of the identical commands, not from an attested run at T2's own merge point.

## Recommendations

- Supersede or invalidate stale oracle records when a later attested run of the same command passes — e.g. mark T1 ev[7] ('No tests found', run before T3 created the suite) as superseded by T3 ev[7] so AC-077-5 coverage is not left at 1 pass / 2 fail.
- Capture output tails from the end of a test run (test names, pass/fail counts) rather than the head; for bun test, suppress or filter server-boot logging so the recorded tail carries the assertion summary.
- Attach an oracle to documentation deliverables (e.g. a grep/lint check that packages/dashboard/CLAUDE.md contains the corrected ready-route line and an /execution entry) or drop them from task scope.
- Require at least one attested oracle run per task before archive, including UI-only tasks; T2 archived with 5/5 self-reported records.
- Split multi-clause ACs (AC-077-1's three badge states plus ?plan sync; AC-077-3's six scorecard behaviors) into separately verified clauses, or require the oracle to name the per-clause test titles.

## Judgment

- Provider: claude-cli
- Prompt version: 6
- Duration: 119296ms
- Retried: true
- Truncated sections: (none)

## Dimension Scores

| Dimension | Score | Confidence (self-reported, uncalibrated) | Based On | Reasoning |
|---|---|---|---|---|
| outcome | 82 | 0.7 | evidence | Five of six ACs have 3 passing runs each (2 attested) plus green typecheck; AC-077-5 ends green but with contradictory fail records and no diff to confirm depth. |
| evidence_integrity | 63 | 0.75 | evidence | Attested ratio 0.57, T2 fully self-reported, lore tails show no assertions, and AC-077-5 mixes attested pass with attested fail without ordering. |
| scope_fidelity | 80 | low | absence | Task descriptions map cleanly onto spec sections S1-S5 with no ac_scope narrowing, but with no diff, drift in touched files cannot be checked. |

## Typed Gaps

| Dimension | Severity | AC Ref | Statement |
|---|---|---|---|
| evidence_integrity | major | AC-077-5 | AC-077-5 has 2 fail records against 1 pass. T1 ev[7] is an attested fail ('No tests found') and T3 ev[2] a self-reported fail; T3 ev[7] is an attested pass showing 2/2 green. Records carry no ordering, so the passing run cannot be proven to supersede the failures. |
| evidence_integrity | major | AC-077-4 | The lore bun-test evidence (T1 ev[1], T1 ev[6], T3 ev[6]) shows output tails containing only repeated 'Lore server running at http://127.0.0.1:0' lines — truncated before any test name, assertion, or pass count. The 200/404/422 cases, dual-auth acceptance, and claim_ttl_minutes equality are asserted only by the pass verdict. |
| outcome | minor | AC-077-3 | No diff was provided, so no component source or test body could be inspected. Multi-clause ACs (tri-state claim badge with clamped TTL in AC-077-1; six distinct scorecard behaviors in AC-077-3) are judged solely from aggregate test counts, which cannot show which clauses are actually asserted. |
| scope_fidelity | minor | AC-077-5 | T3's second deliverable — fixing the stale packages/dashboard/CLAUDE.md ready-route line and documenting the /execution surface — maps to no oracle and no AC. With no diff, it is unverifiable whether this in-scope work was done at all. |
| evidence_integrity | minor | AC-077-1 | T2, the task that authored the entire dashboard UI layer for AC-077-1/2/3/6, has 0 attested and 5 self-reported evidence records. Independent corroboration comes only from T1/T3 autopilot reruns of the identical commands, not from an attested run at T2's own merge point. |

## Typed Recommendations

| Target | Action | Rationale |
|---|---|---|
| process | Supersede or invalidate stale oracle records when a later attested run of the same command passes — e.g. mark T1 ev[7] ('No tests found', run before T3 created the suite) as superseded by T3 ev[7] so AC-077-5 coverage is not left at 1 pass / 2 fail. | The blocks-ordered plan makes the T1-era fail expected, but the ledger cannot express that, so a correctly sequenced execution scores as contradicted. |
| process | Capture output tails from the end of a test run (test names, pass/fail counts) rather than the head; for bun test, suppress or filter server-boot logging so the recorded tail carries the assertion summary. | All three lore evidence records are opaque — the tail shows only server startup lines, giving an auditor nothing to verify AC-077-4 against. |
| plan | Attach an oracle to documentation deliverables (e.g. a grep/lint check that packages/dashboard/CLAUDE.md contains the corrected ready-route line and an /execution entry) or drop them from task scope. | T3's doc-sync half is in the task statement but has no verification path, leaving declared scope unevidenced. |
| process | Require at least one attested oracle run per task before archive, including UI-only tasks; T2 archived with 5/5 self-reported records. | Attested ratio 0.57 overall; the task owning four of six ACs contributed no attested evidence. |
| spec | Split multi-clause ACs (AC-077-1's three badge states plus ?plan sync; AC-077-3's six scorecard behaviors) into separately verified clauses, or require the oracle to name the per-clause test titles. | Aggregate pass counts cannot show which clauses of a bundled AC were actually asserted. |

## Unverifiable Materials

- Implementation diff (route, components, tests, CLAUDE.md): diff_available=false; no source or test bodies were included in the bundle, so per-clause AC behavior and touched-file scope could not be inspected.
- packages/dashboard/CLAUDE.md ready-route fix and /execution documentation: T3 deliverable with no oracle and no diff — no way to confirm the stale line was corrected or the new surface documented.
- Assertion detail of packages/lore bun test runs: Output tails contain only 'Lore server running' lines; test names and pass counts were truncated away.
- Chronological ordering of evidence records: Records carry no timestamps, so whether T3 ev[7]'s pass postdates the AC-077-5 fails cannot be established from the bundle.
- Regression impact on pre-existing suites: tests_touched=false with no diff; only the six AC-scoped commands were run, so effects on the wider dashboard/lore suites are unknown.

## Rubric Warnings

- Dimension "scope_fidelity" scored based_on="absence" but no matching entry was found in unverifiable[] or judgment.truncated[] — the absence claim is ungrounded.

## Facts Summary

- AC coverage: 6 declared criteria
- Task evidence: 3 tasks
- AC scope: 0 scoped, 0 dangling
- Knowledge capture: 0 docs (bundle)
- Regression: tests_touched=false, attested_evidence_ratio=0.57
