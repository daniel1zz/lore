---
id: KN-313
type: knowledge
role: knowledge
title: "Assessment: Implementation — resume-ticket coverage floor (ordinal render + Stop-time enforcement) (2026-07-31)"
status: approved
priority: medium
created: 2026-07-31
updated: 2026-07-31
tags: []
parent: PLAN-100
links:
  - {id: PLAN-100, type: informs}
---
# Assessment: met (83/100)

Scope: plan `01KYS2YBDZBFKZCKYD1KJP2RWB`

## AC Scores

| AC | Score | Reasoning | Evidence |
|---|---|---|---|
| AC-RC-1 | 88 | Ordinal cardinality test passes under T1/T2 and is independently re-run by the orchestrator (attested output tail shows the -t filter matched 1 of 6 tests). Array-length-derived assertion is unverifiable without the diff. | 01KYS30NMHDMNT3KXTD1YJH52G (T2 ev[2], attested ev[12]) |
| AC-RC-2 | 89 | Highest attestation count (3 attested passes, incl. T1 and T2 re-runs by orchestrator). Identity-against-pure-renderer and line-index ordering claims rest on test internals not shown. | 01KYS30N5TGTD4NS0E5NBQ9RKG (T1 ev[3] attested), 01KYS30NMHDMNT3KXTD1YJH52G (T2 ev[3], ev[13]) |
| AC-RC-3 | 87 | "both bounds" filter passes with 2 attested orchestrator re-runs. The distinct-strings sub-assertion (merged implementation must fail) is asserted only inside unseen test code. | 01KYS30NMHDMNT3KXTD1YJH52G (ev[4], ev[10]) |
| AC-RC-4 | 90 | Compiled-binary e2e attested twice with visible output tail naming both surfaces (CLI stdout AND MCP lore_feed) plus a boundary case; build ran before e2e per constraint. Strongest dual-surface evidence in the set. | 01KYS31B6ZYMZ2CSFM0SEFKHZP (T4 ev[5]-[6] attested tails) |
| AC-RC-5 | 87 | Degraded-zero-decisions test passes, attested by orchestrator re-run. No-throw and zero-KD-line claims not independently observable. | 01KYS30NMHDMNT3KXTD1YJH52G (ev[5], ev[14]) |
| AC-RC-6 | 68 | Passes with attestation, but this is a zero-hit negative search: a green run is equally consistent with a weakened search. Plan itself names the working diff as required (not optional) evidence for this AC; no diff was provided. | 01KYS30NMHDMNT3KXTD1YJH52G (ev[6], ev[15]) |
| AC-RC-7 | 88 | Three-way test passes with 2 attested re-runs; attested tail shows 3 tests selected of 12, consistent with three payload cases. Set-equality-on-stderr strictness unverifiable without test source. | 01KYS31AR2BYEJGVQ9FX9G1HSM (T3 ev[3], ev[9]) |
| AC-RC-8 | 90 | Install-parity e2e attested twice with visible tail (22 expect() calls, throwaway claude-dir, byte-identity + manifest sha256 for both changed assets). Build preceded the run. | 01KYS31B6ZYMZ2CSFM0SEFKHZP (ev[7]), 01KYTV4WKMG0D6J673VPRBAFTM (ev[9]) |
| AC-RC-9 | 85 | Round-trip test passes, 2 attested tails, but each selects exactly 1 test — the "computed from arrays rather than a literal list" discipline is the whole point and is invisible in the evidence. | 01KYS31AR2BYEJGVQ9FX9G1HSM (ev[4], ev[10]) |
| AC-RC-10 | 80 | Relay half is well evidenced: attested tail names exit-3-with-verbatim-stderr and an exit-1 case the hook has no knowledge of. Grammar-absence half is a zero-hit search, unverifiable without the hook source or diff. | 01KYS3KT0WM5MPCHGZQ6GH3AYN (T5 ev[2], ev[5] tail) |
| AC-RC-11 | 85 | "multi-actor no floor" passes with 2 attested tails selecting 2 tests, consistent with negative + vacuity-control pair. Content of the control assertion not observable. | 01KYS30NMHDMNT3KXTD1YJH52G (ev[7], ev[11]) |
| AC-RC-12 | 86 | Verb half of AC-RC-11 passes; attested tails select 2 tests, matching the exits-zero case plus the incomplete-disposition control that guards against a vacuous exit 0. | 01KYS31AR2BYEJGVQ9FX9G1HSM (ev[5], ev[11]) |
| AC-RC-13 | 84 | Only 1 attested pass, but that tail is specific: names the derived-from-HOOK_REGISTRATIONS Stop entry and the stop-doc-sync vacuity control, 15 expect() calls, fresh throwaway install. Derivation-not-literal unverifiable. | 01KYTV4WKMG0D6J673VPRBAFTM (T6 ev[3], ev[19] tail) |
| AC-RC-14 | 66 | Attested tail shows both roster files ran green (225 + 27 tests). But the AC's core is a negative anti-cheat constraint (declare, never loosen) plus an exactly-2-matched-files check; the plan names the diff as required evidence and none exists. | 01KYTV4WKMG0D6J673VPRBAFTM (ev[4], ev[20]) |

## Gaps

- The plan explicitly declares the working diff as required (not optional) evidence for AC-RC-14, because a passing run is equally consistent with the forbidden fix (loosening the roster check to derive from enumeration). No diff was provided, so the declare-don't-derive constraint is unverified. The attested tail proves both files are green, which is exactly the state the cheat would also produce.
- AC-RC-6 is a zero-hit source search over feed-flow.ts with a vacuity control. Without the diff or file source, a weakened search pattern is indistinguishable from a clean consumer. Same class as AC-RC-14 per the plan's own Risks note.
- The grammar-absence half (zero hits for every exported item-id prefix and disposition token in the hook source) is unverifiable from the materials; only the relay half (exit 3 + verbatim stderr, plus exit 1) appears in the attested tail.
- AC-RC-13 and AC-RC-14 each have only 1 attested pass. The derivation-from-HOOK_REGISTRATIONS requirement (vs a hand-written command string) is the AC's anti-drift core and is not observable in the output tail.
- Round-trip identity is asserted as computed from fixture array lengths rather than a literal list; the attested run selects a single test and cannot distinguish the two implementations.

## Recommendations

- Block archival of any plan whose ACs include negative constraints (zero-hit searches, hardcoded-roster tripwires, declare-don't-derive) unless the working diff is attached to the assessment bundle. The plan already identified this; make it enforced rather than advisory.
- Give each zero-hit or roster AC a paired mutation control: assert the same search yields >0 hits against a deliberately violating fixture, so the AC can fail for the right reason without needing a human to read the diff.
- Require at least one orchestrator-attested unfiltered per-file run for every test file backing an AC, in addition to -t filtered runs; record the selected/skipped counts.
- Raise the attestation target above 0.44 for tasks whose ACs were added late in execution (T6's AC-RC-13/14 have 1 attested pass each), since late-added ACs get the least cross-checking.

## Judgment

- Provider: claude-cli
- Prompt version: 6
- Duration: 75780ms
- Retried: false
- Truncated sections: task:task-t6-wire-the-stop-hook-into-settings-json-auto-registration

## Dimension Scores

| Dimension | Score | Confidence (self-reported, uncalibrated) | Based On | Reasoning |
|---|---|---|---|---|
| outcome | 87 | 0.75 | evidence | All 14 ACs have passing script-mode evidence, 0 failures; compiled-binary e2e tails independently confirm dual-surface render, install parity, and Stop registration — the wiring gap was closed. |
| evidence_integrity | 71 | low | absence | No working diff and 0.44 attested ratio. Orchestrator re-ran most oracles with quoted tails, but negative-constraint ACs (RC-6, RC-14, RC-10a) cannot be corroborated from output alone. |
| scope_fidelity | 89 | 0.8 | evidence | 4→6 tasks and 8→14 ACs, but each expansion is documented with measured cause (CLAUDE_SESSION_ID unset; HOOK_REGISTRATIONS omission) and the plan was updated as scope SSOT. |

## Typed Gaps

| Dimension | Severity | AC Ref | Statement |
|---|---|---|---|
| evidence_integrity | major | AC-RC-14 | The plan explicitly declares the working diff as required (not optional) evidence for AC-RC-14, because a passing run is equally consistent with the forbidden fix (loosening the roster check to derive from enumeration). No diff was provided, so the declare-don't-derive constraint is unverified. The attested tail proves both files are green, which is exactly the state the cheat would also produce. |
| evidence_integrity | major | AC-RC-6 | AC-RC-6 is a zero-hit source search over feed-flow.ts with a vacuity control. Without the diff or file source, a weakened search pattern is indistinguishable from a clean consumer. Same class as AC-RC-14 per the plan's own Risks note. |
| evidence_integrity | minor | AC-RC-10 | The grammar-absence half (zero hits for every exported item-id prefix and disposition token in the hook source) is unverifiable from the materials; only the relay half (exit 3 + verbatim stderr, plus exit 1) appears in the attested tail. |
| evidence_integrity | minor | AC-RC-13 | AC-RC-13 and AC-RC-14 each have only 1 attested pass. The derivation-from-HOOK_REGISTRATIONS requirement (vs a hand-written command string) is the AC's anti-drift core and is not observable in the output tail. |
| outcome | minor | AC-RC-9 | Round-trip identity is asserted as computed from fixture array lengths rather than a literal list; the attested run selects a single test and cannot distinguish the two implementations. |

## Typed Recommendations

| Target | Action | Rationale |
|---|---|---|
| process | Block archival of any plan whose ACs include negative constraints (zero-hit searches, hardcoded-roster tripwires, declare-don't-derive) unless the working diff is attached to the assessment bundle. The plan already identified this; make it enforced rather than advisory. | Plan Risks section states a green oracle cannot prove roster/zero-hit ACs were respected; the diff was named as required evidence and then omitted. |
| spec | Give each zero-hit or roster AC a paired mutation control: assert the same search yields >0 hits against a deliberately violating fixture, so the AC can fail for the right reason without needing a human to read the diff. | Converts an unfalsifiable negative assertion into a self-witnessing one, removing the diff dependency for future audits. |
| process | Require at least one orchestrator-attested unfiltered per-file run for every test file backing an AC, in addition to -t filtered runs; record the selected/skipped counts. | Attested tails show 9-11 skips under -t filters; a mistyped filter selecting 0 tests can exit green. |
| plan | Raise the attestation target above 0.44 for tasks whose ACs were added late in execution (T6's AC-RC-13/14 have 1 attested pass each), since late-added ACs get the least cross-checking. | T6 exists precisely because a gap survived T4's green oracle; its own ACs deserve stronger independent corroboration. |

## Unverifiable Materials

- Working diff for the whole plan (no diff provided; diff_available=false): Named by the plan as required evidence for AC-RC-14 and AC-RC-6; without it the declare-don't-derive and zero-hit constraints cannot be confirmed.
- Test source for packages/lore/tests/unit/feed-resume-coverage.test.ts and the two roster tests: Strictness of the zero-hit searches, set-equality checks, and vacuity controls lives in test code not shown.
- assets/hooks/stop-handoff-coverage.mjs source: Needed to confirm the hook carries no id/disposition grammar (AC-RC-10 first half) rather than trusting the search that asserts it.
- packages/core/src/distribution-hooks.ts and the pinned 11/17 count test: AC-RC-13's derive-from-HOOK_REGISTRATIONS requirement and the owner-classification rationale paragraph are not observable in the evidence tails.

## Rubric Warnings

- Dimension "evidence_integrity" scored based_on="absence" but no matching entry was found in unverifiable[] or judgment.truncated[] — the absence claim is ungrounded.

## Facts Summary

- AC coverage: 14 declared criteria
- Task evidence: 6 tasks
- AC scope: 0 scoped, 0 dangling
- Knowledge capture: 1 docs (bundle)
- Regression: tests_touched=false, attested_evidence_ratio=0.44
