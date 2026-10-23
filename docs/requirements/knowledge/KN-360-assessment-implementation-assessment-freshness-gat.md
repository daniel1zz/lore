---
id: KN-360
type: knowledge
role: knowledge
title: "Assessment: Implementation — assessment freshness gate (SPEC-106) (2026-07-28)"
status: archived
priority: medium
created: 2026-07-28
updated: 2026-10-23
tags: []
parent: PLAN-110
links:
  - {id: PLAN-110, type: informs}
---
# Assessment: met (86/100)

Scope: plan `01KYMFDAB067MAMMTWKTCSS3GD`

## AC Scores

| AC | Score | Reasoning | Evidence |
|---|---|---|---|
| AC-FRESH-1 | 88 | Two attested passes of the -t AC-FRESH-1 run; diff shows feedAssessmentFreshness naming `lore assess <plan>` and the test asserts both timestamps plus the exact command in the denial message. Filter run shows only 1 test executing, but it is the AC-named one. | 01KYMFDPGN8A3S4FSBC06629AR (evidence [3],[9],[14]) |
| AC-FRESH-2 | 90 | Attested passes (4 tests) cover: newer assessment closes cleanly, no-assessment plan unaffected, assessment-with-no-activity and zero-task vacuous passes. Predicate code matches (undefined => ok). | 01KYMFDPGN8A3S4FSBC06629AR (evidence [4],[10],[15]) |
| AC-FRESH-3 | 82 | Attested pass; test exercises anchor add, link write, status change after the assessment and still archives. Only 1 test matched the filter, so coverage is a single composite case; resolver reads audit rows with action evidence/done only, consistent with D2. | 01KYMFDPGN8A3S4FSBC06629AR (evidence [5],[11],[16]) |
| AC-FRESH-4 | 88 | Two attested bun integration passes against the compiled binary; second run warns, names both timestamps, exits 0 and writes a 2nd assessment. Advisory text asserted. Provider is a hermetic stub script, an accepted in-repo idiom. | 01KYMFDPGN8A3S4FSBC06629AR (evidence [6],[12],[17]) |
| AC-FRESH-5 | 90 | Attested pass (3 tests): flag+reason exempts, bare flag denies, whitespace-only reason denies. CorpusService resolution mirrors attestation_exempt's trim check exactly, matching D4. | 01KYMFDPGN8A3S4FSBC06629AR (evidence [7],[13],[18]) |

## Gaps

- attested_evidence_ratio 0.56: `bun run typecheck` and `bun run test:changed <sha>` are self-reported with no output_tail, so the broader regression claim (nothing else broke) cannot be inspected from these materials.
- The AC-FRESH-3 filter matches a single test (1 passed / 15 skipped) that bundles anchor add, link write and status change into one scenario; a failure in any one would not be isolable, and no case proves a `done` audit row DOES trip the predicate.
- resolveNewestTaskActivityAt runs one queryAudit per task plus per phase with no cap; the bounded-cost claim lives only in JSDoc, with no oracle run over a large plan.

## Recommendations

- Add a unit test that makes an assessment stale via a `done` audit row (action=update, details.done=true) and one that proves a plain `lore set --status` update does NOT, pinning both sides of D2's discriminator.
- Require attestation (or at least output_tail) on whole-suite oracles like typecheck and test:changed, not just per-AC filtered runs.
- State an explicit bound or query shape for per-task audit scans in SPEC-106's NFR and cover it with an evidenced test on a many-task plan.

## Judgment

- Provider: claude-cli
- Prompt version: 6
- Duration: 110312ms
- Retried: true
- Truncated sections: (none)

## Dimension Scores

| Dimension | Score | Confidence (self-reported, uncalibrated) | Based On | Reasoning |
|---|---|---|---|---|
| outcome | 88 | 0.8 | evidence | All five ACs have passing runs with two attested repeats each; diff implements predicate, context fields, resolver, feeding pack, advisory and exemption as the plan describes. |
| evidence_integrity | 76 | 0.75 | evidence | Ten attested records with output tails for every AC, but attested ratio 0.56; typecheck and test:changed lack tails, and two ACs match only one test under their -t filter. |
| scope_fidelity | 92 | 0.8 | evidence | Diff touches only assess.ts, checkpoint-registry.ts, corpus-service.ts, gate-predicates.ts and two new test files — additive predicate on the armed gate, no new checkpoint, as planned. |

## Typed Gaps

| Dimension | Severity | AC Ref | Statement |
|---|---|---|---|
| evidence_integrity | minor | — | attested_evidence_ratio 0.56: `bun run typecheck` and `bun run test:changed <sha>` are self-reported with no output_tail, so the broader regression claim (nothing else broke) cannot be inspected from these materials. |
| outcome | minor | AC-FRESH-3 | The AC-FRESH-3 filter matches a single test (1 passed / 15 skipped) that bundles anchor add, link write and status change into one scenario; a failure in any one would not be isolable, and no case proves a `done` audit row DOES trip the predicate. |
| outcome | minor | — | resolveNewestTaskActivityAt runs one queryAudit per task plus per phase with no cap; the bounded-cost claim lives only in JSDoc, with no oracle run over a large plan. |

## Typed Recommendations

| Target | Action | Rationale |
|---|---|---|
| plan | Add a unit test that makes an assessment stale via a `done` audit row (action=update, details.done=true) and one that proves a plain `lore set --status` update does NOT, pinning both sides of D2's discriminator. | Current evidence only exercises the `evidence` action; the `done` half of the discriminator is untested. |
| process | Require attestation (or at least output_tail) on whole-suite oracles like typecheck and test:changed, not just per-AC filtered runs. | Regression safety of an armed gate rests on the suite-wide runs, which are the least verifiable records here. |
| spec | State an explicit bound or query shape for per-task audit scans in SPEC-106's NFR and cover it with an evidenced test on a many-task plan. | Plan-close now pays N audit queries per close; cost is asserted only in comments. |

## Unverifiable Materials

- Full contents of checkpoint-registry.ts, corpus-service.ts and gate-predicates.ts outside the diff hunks: Only diff context shown; surrounding gate wiring, GateEnforcer.enforce field-selection rule and knowledgeExtraSchema were not provided.
- Output of `bun run typecheck` and `bun run test:changed 468146c2`: Recorded as pass but self-reported with no output_tail included.
- Linked knowledge/assessment docs for the plan: Deterministic facts report 0 linked knowledge docs, so the motivating incident cited in code comments is not present in materials.

## Facts Summary

- AC coverage: 5 declared criteria
- Task evidence: 1 tasks
- AC scope: 0 scoped, 0 dangling
- Knowledge capture: 0 docs (bundle)
- Regression: tests_touched=true, attested_evidence_ratio=0.56
