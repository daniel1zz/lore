---
id: KN-654
type: knowledge
role: knowledge
title: "Retro: baseline slice 1 — gate composition, TDD deadlock, scoped-oracle miss, excavated rules inherit prose errors"
status: approved
priority: medium
created: 2026-10-07
updated: 2026-10-08
tags: [baseline, retro]
parent: PLAN-172
---
# Retro — baseline slice 1 (plan-baseline-slice-1-rules-citations-rule-state-specification), 2026-10-07/08

Run fully autonomous under owner delegation (session 6b85319e). Outcome: AC-BLS1-1..9 attested on main; pilot AC-BLS1-11 FAILED both pre-registered kill lines (`knowledge-pilot-assessment-baseline-slice-1-specification`); `lore assess` partially_met 70. Each finding names the mechanism gap, not only what happened.

## Findings

1. **Corpus-authoring tasks have no legal executor** (issue #39). The dispatch-isolation gate forces implementers into worktrees; worktrees are refused corpus writes (`gate:corpus-write:foreign-provenance`). D1, D2, D3, D4 all had to be executed by the orchestrator; D2 used a reviewed command file produced in a worktree and run from main. Mechanism needed: a sanctioned path for corpus-only tasks.
2. **TDD `blocks` edges deadlock under `lore done`** (TASK-879, already filed). Worked around by unlinking 7 RED→impl edges and ordering by hand. Second-order cost: unlinking dropped TRANSITIVE dependencies (C5 and C4 lost their path to A2b) — re-added by hand. Mechanism needed: an edge type satisfied by "RED merged", not by "RED archived".
3. **`lore done` on an impl task demands its own expected-fail row**, while the red run lives on the paired RED task. A2a's red had to be reproduced on the pre-impl commit after the fact (assess correctly flagged it as reconstructed). From A2b on, every impl bundle said "record a red run on THIS task before editing". Mechanism needed: done should accept the paired RED task's expected-fail.
4. **My dispatch bundle scoped B2's oracle to `tests/unit/store` only** — it bumped `LATEST_SCHEMA_VERSION` and broke `sync-push.bun.test.ts` (fixture migration chain), caught only by the orchestrator's full suite (fixed in C9). This repeats the standing lesson "the scoped lower bound is every importer, not the anchor set" — the violation was in the bundle I wrote, not the implementer. Mechanism needed: a schema-version bump should mechanically select every test that replays the migration chain / pins user_version (assess recommendation).
5. **Committing during a full-suite run invalidates every compiled-binary test** (stale-binary guard). The second bun run showed 52 failures, almost all one-per-file guard trips, and ran 70 min instead of 10; isolated re-runs passed. Rule: never commit or rebuild while a full-suite measurement is in flight.
6. **Excavated rules inherit documentation errors.** Both pilot confident-wrong answers trace to baseline content copying prose that contradicts code (BR-73 domain-overview AC floor; missing digit-anchor rule), despite an agent re-verifying every rule. Reading is not an oracle for rule truth; BL-13 needs citing executable ACs, and 83/95 rules had none.
7. **Placement by judgment stayed non-reproducible across four measurements** (A1 65%, A4 66.5%, A5 rule-level 69%, D3 50.6%). The missing artefact is a written placement principle, not more careful agents.
8. **Editing an approved plan's body demotes it to draft**, which silently blocks every claim under it; recording a Decisions Log entry required a re-review + re-approve. Mechanism question: should a Decisions-Log append on an approved plan behave like `phase add` (version, no demotion)?
9. **`lore review`'s judge saw a truncated document and still approved** (issue #34); `lore set` with identical content logs an empty version (#31). Both recurred during this run.
10. **Pre-existing reds on main obscured new ones**: mirror parity, spec-mirror export, store CLAUDE.md eviction floor, setup dry-run manifest (#38), setup-manifest-fields, spec-loop pollution guard (uncommitted mirror files from several sessions), github-intake network. Classifying each new failure required a run on the pre-plan commit. A green main is the precondition for cheap regression detection.

## Issues filed this run
#29 falsifier silently dropped on human/ai ACs · #30 archived spec accepts new ACs · #31 identical-content set logs a version · #34 judge approves a truncated document · #36 MCP/HTTP wholesale extra replace bypasses AC guards · #37 second CAS in one transaction false-succeeds (filed by B2) · #38 setup dry-run rewrites the manifest · #39 corpus-authoring tasks have no legal executor.


## Correction (2026-10-08)
Finding 6 is partly wrong: BR-73 never contradicted code (it says a kind with no minimum set requires one); the Q3 confident-wrong answer was a reader misreading correct content. The digit-anchor fact was in the branch glossary but not in any rule. Evidence and the corrected diagnosis: the Correction section of `knowledge-pilot-assessment-baseline-slice-1-specification`. Pilot v2's citation pass found 5 rules that do contradict code (BR-5, BR-11, BR-71, BR-74, BR-90), so the lesson "reading is not an oracle for rule truth" stands on that evidence instead.
