---
id: PLAN-147
type: plan
role: plan
title: "Land measured-blast-radius grading: one fan-in definition, a total class map, the middle tier, and a shared arming cutoff"
status: approved
priority: medium
created: 2026-08-24
updated: 2026-08-24
tags: []
parent: SPEC-151
phases:
  - {name: "P1 one fan-in definition"}
  - {name: "P2 the derived grade"}
  - {name: "P3 the total class map"}
  - {name: "P4 wire the waivers and the middle tier"}
  - {name: "P5 two-axis recheck and arming"}
  - {name: "P6 ship the rules as executables"}
---
## Objective

Land `spec-governance-weight-must-scale-with-measured-blast-radius-a` — the derived
requirement grade, the size-invariant class boundary, the middle tier, and the shared
arming cutoff — without retro-invalidating any of the 822 live tasks.

## Phase order and why it is this order

The dependency chain is real, not stylistic: the grade function cannot exist before
`adjustedFanIn` has one definition (P1); the waiver wiring cannot be asserted before the
class map exists (P3); arming must come AFTER the behaviour it grandfathers is in place,
or the parity assertion has nothing to compare.

## RED-first split, and where it is mandatory

⛔ For the three phases whose oracle is itself a governance verdict — P3 (class totality),
P4 (waiver wiring), P5 (arming parity) — the suite is authored by a DIFFERENT agent than
the implementation, in its own task, and the implementing task is forbidden from editing
it. Rationale measured in this repo: changing a red oracle and then reporting green is
indistinguishable from concealing a failure, however justified the change. For the
remaining phases the implementer runs red-first inside its own task and records
`lore evidence --result expected-fail` AT THE MOMENT OF RED — transcription afterwards
does not count.

## Out of scope

⛔ No task in this plan may edit `scripts/check-anchor-coverage.ts` or the search
projection — those belong to the sibling read-side spec and its plan. Anchor overlap
between the two plans is expected to be EMPTY; if a task needs a file the sibling plan
owns, stop and report rather than widening the anchor.
