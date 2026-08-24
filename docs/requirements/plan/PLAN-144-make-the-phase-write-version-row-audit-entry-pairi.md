---
id: PLAN-144
type: plan
role: plan
title: "Make the phase-write version-row / audit-entry pairing oracle-enforced"
status: approved
priority: medium
created: 2026-08-24
updated: 2026-08-24
tags: []
parent: SPEC-148
phases:
  - {name: "audit pairing oracle", description: "Author the audit-pairing suite and prove it can fail by severing the pairing in a scratch copy."}
---
## Goal

Close AC-PHASEVER-4: make the version-row / audit-entry pairing on phase writes
oracle-enforced instead of comment-enforced.

## Why this exists as its own plan

The implementation is ALREADY correct — `writePhases` makes one CAS-guarded
`store.updateWithProvenance` call, and `lore audit --verify` was measured clean after all
three phase writes. What is missing is the refusal. The previous plan's three criteria passed
41/41 against a shape whose audit trail was severed, which was measured by the implementer
building the prescribed shape and testing it, not inferred.

## ⛔ The hard part is NOT writing the test — it is proving the test can fail

Because the implementation is already right, the new suite will be GREEN ON ARRIVAL. A
green-on-arrival oracle has no demonstrated discriminating power, and this plan exists
precisely because the previous plan shipped three of them with respect to the audit trail.

So the deliverable is TWO things: the suite, AND a recorded red produced by deliberately
severing the pairing in a scratch copy (never in the tracked tree) and observing the suite go
red — restored afterwards, with the red recorded via `lore evidence --result expected-fail` at
the moment it was observed. ⛔ Without that probe this plan reproduces the exact defect it was
opened to fix.
