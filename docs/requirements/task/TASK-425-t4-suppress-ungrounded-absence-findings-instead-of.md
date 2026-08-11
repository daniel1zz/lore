---
id: TASK-425
type: task
role: plan
title: "T4 — suppress ungrounded absence findings instead of merely warning about them"
status: archived
priority: high
created: 2026-08-01
updated: 2026-08-01
tags: []
parent: PLAN-082
plan: PLAN-082
---
Stop publishing absence findings the judge could not have grounded.

Measured: two of four typed gaps on one assessment were FALSE against stored corpus data,
both artifacts of a truncated view, both published into the permanent record. The rubric
ALREADY detected the shape — `findUngroundedAbsenceDimensions`
(`ai-provider-service.ts:200-218`) matched, `computeGroundingWarnings` (`:251-259`)
appended a `rubric_warning`, `applyGroundingConfidenceDowngrade` (`:289-311`) forced
confidence low — and the findings shipped anyway. A warning that does not change what
lands in the record is not a mechanism.

## Required

In `_finalizeAssessment` (`:1298-1370`): a `dimension_scores` entry with
`based_on: "absence"` that `findUngroundedAbsenceDimensions` flags is REMOVED from the
persisted findings, and an `unverifiable[]` entry naming that material is added in its
place. Suppression must not be silent-in-the-record: the assessment still says the
material could not be judged, it just no longer asserts a defect about it.

## D4 — one detector, not two

Consume `findUngroundedAbsenceDimensions`' verdict. Do NOT re-derive the match with a new
rule: two detectors with different match semantics for one condition is its own defect.
AC-AEP-7 pins this with a case where that function's (case-insensitive, substring) rule
and a naive equality check DISAGREE — the suppression must follow the function.

## Regression surface

`_finalizeAssessment` also: replaces `gaps`/`recommendations` via `deriveLegacyFindings`
(`:1317-1321`), forces `verdict="inconclusive"` + omits `overall_score` at 100% task
truncation (`:1352-1353`). AC-AEP-8 pins that branch. If suppression empties the typed
array, the legacy projection must degrade coherently rather than emitting a contradictory
"no gaps found" summary.

## Verification discipline

Red first; record the red with a NON-EMPTY output_tail.
