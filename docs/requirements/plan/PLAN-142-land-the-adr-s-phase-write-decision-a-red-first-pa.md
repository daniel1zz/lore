---
id: PLAN-142
type: plan
role: plan
title: "Land the ADR's phase-write decision: a red-first parity suite, then version-logging in all three PhaseService writers"
status: archived
priority: medium
created: 2026-08-24
updated: 2026-08-24
tags: []
parent: SPEC-148
phases:
  - {name: "red-first parity suite", description: "Author the vitest parity suite. Claims no AC; deliverable is a RED oracle plus expected-fail evidence recorded at the moment of red."}
  - {name: "consume the decision", description: "Add insertVersion to all three PhaseService writers, sweep both service headers and the root CLAUDE.md clause, turn the suite green without editing it."}
links:
  - {id: KN-542, type: relates-to}
---
## Goal

Consume `adr-phase-writes-log-a-version-row-and-do-not-demote-the-plan`: make all three
`PhaseService` writers log a version row, leave plan status alone, and sweep every prose
assertion that said they do not. SPEC-148's three ACs are the acceptance surface.

## Why two phases and not one task

The oracle for all three ACs is one vitest file that does not exist yet. If one agent wrote
both the suite and the implementation, nothing would stop it from writing a suite that passes
against whatever it happened to build. Splitting it puts a mechanical mutex in the way: the
two tasks declare DISJOINT file anchors, so the implementation task literally cannot edit the
suite that judges it, and the suite's RED is recorded by the agent that observed it rather
than transcribed afterwards.

## Phase 1 — red-first parity suite

Authors `packages/lore/tests/integration/phase-write-lifecycle-doc-parity.test.ts`. Claims NO
acceptance criterion: its deliverable is an oracle that is RED for the declared reasons, and
`lore evidence --result expected-fail` recorded at the moment the red is observed. Every
non-vacuous conjunct already has a measured red baseline in the spec, so a suite that comes
out green is a defective suite, not early progress.

⛔ Exact test titles are load-bearing. The AC commands address blocks by `-t` filter, so the
suite MUST contain a block titled exactly `rename and rm measured and premise recorded`
(AC-PHASEVER-2) and one titled exactly `stale version-less assertions swept and demotion
guarded` (AC-PHASEVER-3). AC-PHASEVER-1 runs the whole file with no filter. A title typo
makes the AC command select nothing, and vitest reports selecting nothing as success — which
is the exact false-oracle shape this repo has already been burned by.

## Phase 2 — consume the decision

Adds `insertVersion` to `addPhase`, `removePhase`, `renamePhase`; rewrites both service
headers so each cites the ADR slug and neither uses the two banned phrases; replaces the root
CLAUDE.md clause with the normative literal. Claims all three ACs and must turn the suite
green without touching it.

⛔ The trap, named in SPEC-148's Risks: the nearest wrong pattern-match is `lore ac set`,
which demotes. This decision is the `lore ac add` shape — log, do NOT demote.
`resolveStatusAfterContractEdit` MUST NOT appear in `phase-service.ts`.
