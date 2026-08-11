---
id: TASK-489
type: task
role: plan
title: "plan-close must block when the coverage conjunct is scope-undeclared AND tasks carry evidence (a fully-inapplicable gate exits 0 today)"
status: archived
priority: critical
created: 2026-07-31
updated: 2026-07-31
tags: []
parent: PRD-001
---
## Task

`plan-close` cannot distinguish "the predicate passed" from "the predicate did not
apply". A plan whose every blocking conjunct is inapplicable closes with exit 0 and
an advisory, indistinguishable from a plan that earned its close.

## Measured, on this repo, this week

Four plans were archived at `08:32:25–26Z` on 2026-07-31 emitting one
`gate_not_applicable {"checkpoint":"plan-close","kind":"attestation-not-applicable"}`
row each. All 10 of their tasks carried evidence (53 rows) and **zero** runner
attestation; all four `lore assess` reports state `attested_evidence_ratio 0.00`.

At the closing session's own base commit `d373654` the same input would have been
**DENIED**:

```
meetsFloor = zeroAttestedTasks.length === 0 && claimedAcCoverage.meets_coverage
          && (minRatio === null || ratio >= minRatio)
attestationFloor: total_evidence === 0 ? notApplicable("no-evidence")
                : !meets_floor       ? {ok:false, ATTESTATION_FLOOR_NOT_MET}
                : {ok:true}
```

After that session's own change, `meets_floor` is the ratio conjunct alone;
`DEFAULT_ATTESTATION_MIN_RATIO` is `null` and the repo config declares no
`min_ratio`, so it is vacuous. The replacement conjunct reads `extra.ac_scope`,
absent on all 10 tasks, so it returns `notApplicable("scope-undeclared")`.

Net: every blocking conjunct inapplicable, exit 0, four plans archived.

## Mechanism required

**`plan-close` MUST block when the declared-scope coverage conjunct is
`scope-undeclared` AND at least one of the plan's tasks carries evidence.**

Rationale for that exact predicate shape: `scope-undeclared` with NO evidence is a
genuine not-applicable (a pure-planning plan — keep it advisory). `scope-undeclared`
WITH evidence means work was verified against nothing declared, which is precisely
the state the coverage conjunct exists to catch. The feeding pack already exists, so
a deny is actionable on arrival: declare scope + `lore verify`, or take a typed
exemption.

⛔ Do NOT satisfy this by re-conflating `meets_floor`. The separation of
evidence-derived facts from declared-scope facts is deliberate
(spec-declared-scope-attestation-contract-task-owned-ac-scope §Facts) — the two
must be able to disagree. The fix belongs at the PREDICATE's applicability
handling, not in the fact derivation.

**Also required: a vacuity signal.** A checkpoint run in which every blocking
conjunct returned `notApplicable` must say so in its output — an operator (or the
next AI session) reading exit 0 currently cannot tell a measured pass from a
completely dark gate. Thirteen `gate_not_applicable` rows and zero denials in one
session is a signature no surface reports today.

## Oracle

Failure-first — the control is the whole point here:
- a plan with evidence-bearing tasks and no `ac_scope` is **DENIED** at close
  (this is the case that exits 0 today — prove it now fails);
- the same plan with `ac_scope` declared and attested evidence **closes**;
- a plan with zero evidence anywhere still closes (`no-evidence` stays advisory —
  prove the fix did not break the pure-planning case);
- a checkpoint whose every blocking conjunct was inapplicable reports that fact in
  its output, asserted as a string, not inferred.
