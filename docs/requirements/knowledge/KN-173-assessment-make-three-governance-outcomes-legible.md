---
id: KN-173
type: knowledge
role: knowledge
title: "Assessment: Make three governance outcomes legible: vacuous plan-close passes, silent AC demotions, and the empty feeding pack a fresh install receives (2026-08-10)"
status: archived
priority: medium
created: 2026-08-10
updated: 2026-10-23
tags: []
parent: PLAN-078
links:
  - {id: PLAN-078, type: informs}
---
# Assessment: met (88/100)

Scope: plan `01KZN4F7772NR1BNYGNTRCQX4Z`

## AC Scores

| AC | Score | Reasoning | Evidence |
|---|---|---|---|
| AC-GV-1 | 93 | Diff shows checkPlanClose pushing notApplicable{reason:"no-evidence"} before invoking assessmentFreshness; oracle asserts structural discriminator ('notApplicable' in entry / 'ok' not in entry), plus measured-fail as a third shape and an exempt regression. RED recorded (4 failures), 7/7 GREEN, 2 at… | 01KZN4F7H8CYG2GXYGRDJHBN81 (RED then 7/7 GREEN on -t vacuous-vs-satisfied), 01KZN738X38SGJ934R3EEM551Z (re-run on merged tree, attested) |
| AC-GV-2 | 86 | Stale sentence removed in tree-check-service.ts; test asserts not.toContain('gate never evaluated') and the corrected justification, RED recorded, GREEN attested. Gap: the AC's 'the command it suggests is one whose gate behaviour matches' was satisfied by changing the justification, not the command… | 01KZN4F7NXQ5HDMFFP36S7AC1W (expected-fail then pass, plan-close-hint-wording) |
| AC-GV-3 | 94 | CLAUDE.md diff visible: 'evaluates NO gate' replaced with text naming corpus-service.ts:2029, resolveGateEnabled, and the vacuous-pass mechanism. RED evidence shows grep count 1 / exit 1 before, GREEN shows count 0 / exit 0 after, with raw command transcripts. | 01KZN4F7NXQ5HDMFFP36S7AC1W (oracle=other RED and GREEN transcripts) |
| AC-GV-4 | 88 | Notice implemented as an observed before/after status diff with a non-terminal descendant-task count; suite drives the real CLI and covers the load-bearing negative half (add, already-draft second set, rejected write) plus a stderr-channel assertion. RED recorded (3 failed). No fixture runs `ac add… | 01KZN4F7TKAS1MEPAQ1SDSSABZ (RED then 5/5 GREEN, demotion-blast-radius) |
| AC-GV-5 | 85 | Fallback rule slice compiled into corpus-service.ts (ships in dist), integration test flipped from asserting [source: unknown] to asserting the slice body. Finding-3 timing doubt closed by a positive-trace existsSync on the fresh corpus db. Test file itself unseen; single both-ends case (4 siblings… | 01KZN4F7Z7ANCTK31S0YH61KB3 (expected-fail then pass both-ends), 01KZN738X38SGJ934R3EEM551Z (positive-trace assertion added, attested re-run) |
| AC-GV-6 | 86 | Both reds are surface-specific — gating set.ts's human print and gating the docPatch.extra write each turned the oracle red — which is positive evidence the test drives the render and --json surfaces rather than re-serialising verdicts. Test file itself not shown, so the no-re-serialisation prohibi… | 01KZN738X38SGJ934R3EEM551Z (RED probes (a) and (b), then 6/6 GREEN, attested re-run) |

## Gaps

- The new notApplicable('no-evidence') entry is audited as kind 'attestation-not-applicable' (predicate-applicability.test.ts COVERAGE-RESTORE asserts exactly that for a ctx where attestationFloor measurably passed). In the audit table the assessment-freshness vacuity is therefore indistinguishable from attestationFloor's zero-evidence case — a legibility conflation inside the very surface this spec makes legible.
- corpus-service.ts writes PLAN_CLOSE_VACUITY_NOTICE_FIELD into docPatch.extra only when vacuous and never removes it. Any later plan-close evaluation that is satisfied leaves the previously-written notice in extra, so the --json discriminator can report a vacuous close for an evaluation that was measured.
- The fallback source label 'built-in fallback (no seeded rule doc)' is applied on the else-branch of findFeedingSkill, which covers both an empty corpus and a failed store read. A store failure is then reported to the user as 'no seeded rule doc' — a false cause in the one field meant to name the slice's provenance.
- plan-close-render-provenance.test.ts and gate-feeding-fresh-install.test.ts are not shown. The prohibition 'never by re-serialising the predicate objects' and the both-ends construction are inferred from the recorded RED probes (set.ts print gated; extra write gated) rather than read directly.
- AC-GV-2 asks that the suggested command be one whose gate behaviour matches the justification; the implementation keeps the command and rewrites the justification instead. Defensible (a sibling integration test pins the command string, per the test comment) but it is a reinterpretation of the AC rather than a literal satisfaction of it.

## Recommendations

- Add an AC (or amend AC-GV-1) requiring the gate_not_applicable audit kind to name its producing predicate, so a vacuous assessment-freshness verdict is distinguishable from attestationFloor's zero-evidence verdict in the audit trail.
- Add a follow-up task to clear PLAN_CLOSE_VACUITY_NOTICE_FIELD when a plan-close evaluation is non-vacuous, with a STATE test that closes a plan vacuously, then re-evaluates with real data and asserts the key is gone.
- Require attestation on the oracle run for each AC's RED as well as its GREEN; the 0.19 attested ratio means most run records are self-reported even though each AC has one attested pass.
- When an AC names two subcommands ('ac add and ac set each print...'), require a fixture per subcommand on the state that would trigger the notice, not only on states where one of them cannot.

## Judgment

- Provider: claude-cli
- Prompt version: 7
- Reproducible: yes (this prompt_version's rendering is guaranteed byte-identical)
- Duration: 110286ms
- Retried: false
- Truncated sections: diff:packages/lore/tests/unit/service/gate-feeding-fresh-install.test.ts, diff:packages/lore/tests/unit/adapters/plan-close-render-provenance.test.ts
- Reasoning clipped for: AC-GV-1, AC-GV-2, AC-GV-4, AC-GV-5, AC-GV-6

## Dimension Scores

| Dimension | Score | Confidence (self-reported, uncalibrated) | Based On | Reasoning |
|---|---|---|---|---|
| outcome | 89 | 0.8 | evidence | All six ACs land on shipping surfaces (checkpoint-registry, corpus-service, set.ts, ac.ts, CLAUDE.md, tree-check) with RED-first oracles; residual defects are stale-key and audit-kind conflation, not… |
| evidence_integrity | 84 | 0.75 | evidence | Every AC has a recorded RED and an attested GREEN; the flagged timing doubt and exempt-flag coverage regression were both closed explicitly. Attested ratio 0.19 and two oracle files unseen limit conf… |
| scope_fidelity | 91 | 0.8 | evidence | Edits match the named anchors; the corpus-service.ts and plan-membership.ts touches are each justified in-place against the stated prohibition, and stale prose was corrected in the same units. |

## Typed Gaps

| Dimension | Severity | AC Ref | Statement |
|---|---|---|---|
| outcome | minor | AC-GV-1 | The new notApplicable('no-evidence') entry is audited as kind 'attestation-not-applicable' (predicate-applicability.test.ts COVERAGE-RESTORE asserts exactly that for a ctx where attestationFloor measurably passed). In the audit table the assessment-freshness vacuity is therefore indistinguishable from attestationFloor's zero-evidence case — a legibility conflation inside the very surface this spec makes legible. |
| outcome | minor | AC-GV-6 | corpus-service.ts writes PLAN_CLOSE_VACUITY_NOTICE_FIELD into docPatch.extra only when vacuous and never removes it. Any later plan-close evaluation that is satisfied leaves the previously-written notice in extra, so the --json discriminator can report a vacuous close for an evaluation that was measured. |
| outcome | minor | AC-GV-5 | The fallback source label 'built-in fallback (no seeded rule doc)' is applied on the else-branch of findFeedingSkill, which covers both an empty corpus and a failed store read. A store failure is then reported to the user as 'no seeded rule doc' — a false cause in the one field meant to name the slice's provenance. |
| evidence_integrity | minor | AC-GV-6 | plan-close-render-provenance.test.ts and gate-feeding-fresh-install.test.ts are not shown. The prohibition 'never by re-serialising the predicate objects' and the both-ends construction are inferred from the recorded RED probes (set.ts print gated; extra write gated) rather than read directly. |
| outcome | minor | AC-GV-2 | AC-GV-2 asks that the suggested command be one whose gate behaviour matches the justification; the implementation keeps the command and rewrites the justification instead. Defensible (a sibling integration test pins the command string, per the test comment) but it is a reinterpretation of the AC rather than a literal satisfaction of it. |

## Typed Recommendations

| Target | Action | Rationale |
|---|---|---|
| spec | Add an AC (or amend AC-GV-1) requiring the gate_not_applicable audit kind to name its producing predicate, so a vacuous assessment-freshness verdict is distinguishable from attestationFloor's zero-evidence verdict in the audit trail. | The spec's goal is legibility of gate outcomes; two producers sharing one audit kind reintroduces the ambiguity at the audit surface. |
| plan | Add a follow-up task to clear PLAN_CLOSE_VACUITY_NOTICE_FIELD when a plan-close evaluation is non-vacuous, with a STATE test that closes a plan vacuously, then re-evaluates with real data and asserts the key is gone. | A write-only notice field can outlive the evaluation that produced it, making the --json discriminator report a stale verdict. |
| process | Require attestation on the oracle run for each AC's RED as well as its GREEN; the 0.19 attested ratio means most run records are self-reported even though each AC has one attested pass. | A RED-first claim is only as strong as the attestation on the RED measurement itself. |
| spec | When an AC names two subcommands ('ac add and ac set each print...'), require a fixture per subcommand on the state that would trigger the notice, not only on states where one of them cannot. | `ac add` is currently only tested on a draft spec, so its silence on an approved spec rests on reading AcService, not on a measurement. |

## Unverifiable Materials

- packages/lore/tests/unit/adapters/plan-close-render-provenance.test.ts: Omitted per truncation manifest; AC-GV-6's 'drive the actual CLI/render path, never re-serialise' constraint is inferred from the two surface-specific RED probes rather than read.
- packages/lore/tests/unit/service/gate-feeding-fresh-install.test.ts (full body): Only the added existsSync hunk is visible; the mkdtemp+init end and the populated-corpus control end are inferred from that hunk and the run output.
- GateEnforcer notApplicableAdvisoryKind mapping: Not in the diff; the conflation of the new no-evidence reason with 'attestation-not-applicable' is read off the COVERAGE-RESTORE fixture's assertion, not the mapping source.

## Facts Summary

- AC coverage: 6 declared criteria
- Task evidence: 5 tasks
- AC scope: 0 scoped, 0 dangling
- Knowledge capture: 1 docs (bundle)
- Regression: tests_touched=true, attested_evidence_ratio=0.19
