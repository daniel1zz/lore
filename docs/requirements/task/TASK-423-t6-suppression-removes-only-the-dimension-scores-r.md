---
id: TASK-423
type: task
role: plan
title: "T6 — suppression removes only the dimension_scores row, so the ungrounded finding still publishes via typed_gaps and the legacy gaps projection"
status: archived
priority: high
created: 2026-08-01
updated: 2026-08-01
tags: []
parent: PLAN-082
plan: PLAN-082
---
## The mechanism is incomplete, and the record it produces contradicts itself

Measured 2026-08-01 on `knowledge-assessment-implementation-evidence-output-tail`, the
FIRST assessment produced after `task-t4-suppress-ungrounded-absence-findings-instead-of-merely`
landed. Stored fields:

    dimension_scores keys : ['outcome', 'evidence_integrity']        <- scope_fidelity SUPPRESSED
    unverifiable[4]       : {material: "scope_fidelity dimension score",
                             reason: "...suppressed as ungrounded rather than
                                      PUBLISHED AS A FINDING."}
    typed_gaps dimensions : ['scope_fidelity', ...]                  <- STILL PUBLISHED
    gaps[0]               : "diff_available=false. The plan pins exact anchors..."  <- STILL PUBLISHED

So the record simultaneously claims the finding was "suppressed rather than published as a
finding" and publishes it, twice — once in `typed_gaps`, once in the legacy `gaps`
projection `deriveLegacyFindings` builds from it.

And the finding is FALSE in the way that matters: it was authored on absence
(`based_on="absence"`, `diff_available=false`) and its content asserts that the guard
placement and error shape "cannot be inspected" — a statement about the BUNDLE, published
as a `major` gap against the WORK. That is the exact failure mode
`spec-lore-assess-project-evidence-rows-instead-of-embedding-the` §Overview was written to
stop, still occurring after the mechanism meant to stop it shipped.

## Root cause: an ambiguous AC, not a faulty implementation

AC-AEP-5 said the entry is "REMOVED from the persisted assessment's **dimension findings**".
`dimension_scores` and `typed_gaps` are SEPARATE arrays (`packages/core/src/assessment.ts`).
T4 implemented the narrower reading — remove the `dimension_scores` entry — and its four ACs
all pass, attested. The implementation is faithful to what was asked; the ask was
under-specified. Do not re-litigate T4's diff.

## Required

`suppressUngroundedAbsenceFindings` (`packages/lore/src/service/ai-provider-service.ts`)
must remove EVERY published expression of a suppressed dimension, not just its
`dimension_scores` row:

- the matching `typed_gaps[]` entries (keyed on the same dimension)
- consequently the legacy `gaps[]` projection, which `_finalizeAssessment` derives from
  `typed_gaps` via `deriveLegacyFindings` — verify it degrades coherently and does NOT
  emit a contradictory "no gaps found" summary when suppression empties the array
- leave `typed_recommendations` alone unless a recommendation's ONLY support was the
  suppressed gap; decide this explicitly and record the decision either way

The `unverifiable[]` entry stays — it is the honest record that something could not be
judged. Its reason text ("rather than published as a finding") must become TRUE.

## Oracle

- RED first: an assessment fixture with an ungrounded absence `scope_fidelity` dimension AND
  a matching `typed_gaps` entry must, before the fix, still carry that typed gap; after the
  fix it must not.
- The legacy `gaps[]` projection no longer contains the suppressed gap's text.
- CONTROL: a GROUNDED absence dimension keeps BOTH its `dimension_scores` row and its
  `typed_gaps` entry.
- CONTROL: `based_on="evidence"` dimensions and their typed gaps are untouched.
- CONTROL: AC-AEP-5/6/7/8 all still pass — this extends the mechanism, it must not weaken it.
- REGRESSION: suppression emptying `typed_gaps` entirely does not produce a verdict that
  claims the work is clean; assert the resulting verdict/summary explicitly.
