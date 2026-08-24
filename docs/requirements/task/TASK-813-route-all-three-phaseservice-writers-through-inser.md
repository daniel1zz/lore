---
id: TASK-813
type: task
role: plan
title: "Route all three PhaseService writers through insertVersion and sweep the version-less assertions"
status: archived
priority: medium
phase: "consume the decision"
created: 2026-08-24
updated: 2026-08-24
tags: []
parent: PLAN-142
plan: PLAN-142
---
## Objective

Consume `adr-phase-writes-log-a-version-row-and-do-not-demote-the-plan`. Turn the parity suite
authored in phase 1 GREEN — without editing it. Claims AC-PHASEVER-1, -2, -3.

## The change

1. `packages/lore/src/service/phase-service.ts` — `addPhase`, `removePhase`, `renamePhase`
   each gain an `insertVersion` alongside their existing `this.store.update`. Copy the shape
   from `ac-service.ts` (`insertVersion` at :615 area), NOT from `lore ac set`'s demotion path.
2. Both service headers — `phase-service.ts` and `ac-service.ts` — are rewritten so that each
   cites the literal `adr-phase-writes-log-a-version-row-and-do-not-demote-the-plan` exactly
   once, and neither contains `no version history` or `version-less`. ⛔ Not even to describe
   the OLD behaviour historically: name the ADR slug instead. `ac-service.ts:8` currently
   names PhaseService as the version-less contrast — that sentence is TRUE today and becomes
   a stale assertion the moment your change lands, which is why it is in your anchors.
3. Root `CLAUDE.md` Document Lifecycle paragraph (line 120) — the literal
   `neither demotes NOR logs a version` must go to 0 occurrences, and the NORMATIVE literal
   `` `lore phase add|rm` does NOT demote but LOGS a version `` must appear exactly once.
   ⛔ Copy it character-for-character including backticks and capitalization. A
   semantically-correct rewording FAILS the oracle on purpose.

## ⛔ The trap — read before you start

The nearest wrong pattern-match is `lore ac set`, which BOTH logs and demotes. This decision
is the `lore ac add` shape: **log, do NOT demote.** An `approved` plan must still be
`approved` after `phase add`.

`resolveStatusAfterContractEdit` MUST NOT appear in `phase-service.ts`. AC-PHASEVER-3(c)
asserts 0 occurrences there against a green control of >= 1 in `ac-service.ts` — and note
that conjunct is VACUOUSLY GREEN before you start (measured 0 today). It is a regression
guard over exactly this trap, so its pass proves nothing about your work; the version-row
conjuncts are what prove it.

## Out of scope

⛔ Do not edit `packages/lore/tests/integration/phase-write-lifecycle-doc-parity.test.ts`. It
is phase 1's anchor and it is the thing judging you. If you believe the suite is wrong, STOP
and report it rather than adjusting it — changing a red oracle and then reporting green is
indistinguishable from concealing a failure, however justified the change.

⛔ Do not migrate the back-catalogue. Phase mutations already applied left no rows and cannot
be reconstructed; the ADR states this as a permanent disclosure, not a task.
