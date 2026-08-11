---
id: PLAN-076
type: plan
role: plan
title: "Land falsifiability reachability: the attested-red runner, a guard that means what it says, feedable checkpoints, and a mirror whose drift trips"
status: draft
priority: medium
created: 2026-08-10
updated: 2026-08-10
tags: []
parent: SPEC-133
phases:
  - {name: "evidence-integrity", description: "The attested-red runner (declared falsifier, scratch-worktree application, exact-exit assertion), the tail guard predicate raised to match its own message, and capture_source/count enumeration visibility. BLOCKS plan-land-oracle-executability's backlog-and-arm."}
  - {name: "gate-reachability", description: "lore feed's checkpoint set derived from checkpointRegistry, an unregistered name exiting exactly 2 instead of 0, and an enforcer-emitted evaluation trace for every deterministic checkpoint."}
  - {name: "mirror", description: "The spec-mirror export script, its root package.json chain wiring, and a drift check that is a separate command from the exporter."}
---
## Goal

Land the eight ACs of `spec-falsifiability-reachability-a-feedable-checkpoint-an`. Every one of them
exists because a governance surface reported success for something it had not established.

## Phases

**Phase 1 — `evidence-integrity` (AC-FR-2, AC-FR-3, AC-FR-4, AC-FR-5).** The attested-red runner plus
the guard and visibility work. ⛔ This phase BLOCKS `plan-land-oracle-executability`'s
`backlog-and-arm` phase: clearing the 29 `pass_unfalsified` criteria before AC-FR-2 exists would mint
29 self-reported reds, which is the exact evidence tier this spec raises. Highest priority for that
reason, not because it is the largest.

**Phase 2 — `gate-reachability` (AC-FR-1, AC-FR-8).** Derive `lore feed`'s checkpoint set from
`checkpointRegistry`, make an unregistered name exit 2 instead of 0, and emit a queryable evaluation
trace from the enforcer for every checkpoint.

**Phase 3 — `mirror` (AC-FR-6, AC-FR-7).** The spec-mirror export script, its chain wiring, and a
drift check that is a separate command from the exporter.

Phases 1-3 touch disjoint subsystems and can run concurrently; within a phase, AC-FR-2 precedes
AC-FR-3 (isolation is asserted against the runner AC-FR-2 builds), and AC-FR-4 precedes AC-FR-5.

## Sequencing Risks

- **The tail guard (AC-FR-4) will retroactively invalidate existing evidence rows.** Raising the
  predicate from `tail.length > 0` to `capture_source: runner` makes every historical self-report
  `pass` non-conforming. ⛔ Budget the back-catalogue sweep and a written exemption for pre-existing
  rows IN THE SAME slice — a newly armed gate that invalidates the back-catalogue without a stated
  exemption has already cost this repo one full round.
- **AC-FR-8's trace must not be mistaken for `plan-close`'s.** `spec-governance-visibility` already
  emits a vacuity discriminator for `plan-close` only. AC-FR-8 asks for an evaluation trace for
  EVERY checkpoint, written by the enforcer (D7). Reusing the per-call-site pattern would reproduce
  the very asymmetry being fixed.
- **AC-FR-3 must be verified against a real crash, not a clean exit.** A `finally`-block revert
  passes a graceful-exit test and fails the crash case; this repo has already shipped a backup that
  was never read back.

## Out of Scope

Clearing the `pass_unfalsified` backlog, arming any threshold on the resulting counts, and
re-authoring the one-sided ACs `lore assess` flagged on other plans.
