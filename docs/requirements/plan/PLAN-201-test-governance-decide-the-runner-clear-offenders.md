---
id: PLAN-201
type: plan
role: plan
title: "Test governance: decide the runner, clear offenders, land guards, scope by declared inputs"
status: approved
priority: medium
created: 2026-10-16
updated: 2026-10-16
tags: []
parent: SPEC-195
phases:
  - {name: "Phase 1: decide", description: "Runner and binary-execution ADR (T1); the user picks"}
  - {name: "Phase 2: clear offenders", description: "Remove the tests each guard would catch (T2, T3, T7, T8, T12) before the guard lands"}
  - {name: "Phase 3: guards", description: "Sandbox guard, tree snapshot, prose-pin check, oracle ownership, missing-oracle verify (T4, T5, T6, T9, T10, T11)"}
  - {name: "Phase 4: selector", description: "Declared test inputs and the selector cross-check (T13, T14)"}
  - {name: "Phase 5: cadence", description: "Parallel bun run, workflow docs and rule records, final verify on main (T15, T16, T17)"}
---
## Overview
Implements spec-test-governance-guards-that-refuse-bad-tests-declared (AC-TG-1..11). Order: decide the runner first, clear the known offenders, then turn each guard on (a guard lands only when main already passes it), then the selector, then the cadence.

| T | Task | AC |
|---|---|---|
| T1 | Runner and binary-execution ADR (measured; user decides) | AC-TG-1 |
| T2 | Move the 5 live-corpus repo-state tests into check scripts (AC-MOS-2, AC-PHASEVER-2/3, AC-FR-6/7/10 corrected) | AC-TG-9 |
| T3 | Rewrite the 4 live-corpus tests onto mkdtemp corpora; delete mirror-status-parity after rebinding AC-OX-6 | AC-TG-9 |
| T4 | Test-sandbox guard: LORE_TEST_SANDBOX refuses this repo's corpus; vitest setupFiles + bun preload | AC-TG-2 |
| T5 | Repo-tree snapshot guard + scripts/test-isolation-ledger.json | AC-TG-3 |
| T6 | check-prose-pins + ledger + pre-push wiring; fix the 4 prose pins | AC-TG-4 |
| T7 | Runtime error sentence pins assert exported constants or rule tokens | AC-TG-9 |
| T8 | One RETIREMENTS registry test replaces the 4 tombstone files; fix the vacuous npm-install-simulation:294 assertion | AC-TG-9 |
| T9 | check:ac-oracle-ownership (checker + fixtures) | AC-TG-5 |
| T10 | lore verify: missing oracle file = not measured; lore done refuses until repointed | AC-TG-6 |
| T11 | Repoint the 46 missing oracle paths, merge true duplicate AC tests, wire check:ac-oracle-ownership into the test chain | AC-TG-9 |
| T12 | Store tests: one *.shared.ts suite per behaviour run by all three adapters | AC-TG-9 |
| T13 | Declared test inputs + selector without blanket rules | AC-TG-7 |
| T14 | Selector cross-check against a full-suite result | AC-TG-8 |
| T15 | Parallel bun run + measure-test-wall script | AC-TG-11 |
| T16 | Workflow update: CLAUDE.md Commands, scoped-oracle rule, AS-13/AS-14/AS-24 rule records | AC-TG-10 |
| T17 | Verify on main: rebuild, lore verify AC-TG-2..11 | AC-TG-9, AC-TG-10, AC-TG-11 |

Dependencies: T2, T3 block T4; T4 blocks T5 (shared setup file); T9 blocks T11; T10 blocks T11; T1 blocks T13 and T15; T13 blocks T14; T4, T5 block T15; T13, T14, T15 block T16; every task blocks T17. Phases: 1 decide (T1); 2 clear offenders (T2, T3, T7, T8, T12); 3 guards (T4, T5, T6, T9, T10, T11); 4 selector (T13, T14); 5 cadence (T15, T16, T17). Phase 4 and 5 tasks are re-planned if the T1 decision changes the runner.

Approved ACs changed with `lore ac set --correction`: T2 owns AC-MOS-2, AC-PHASEVER-2/3, AC-FR-6/7/10; T3 owns AC-GV-5, AC-BFI-6/7, AC-TC-2, AC-OX-6; T11 owns every AC it repoints.

T13 also adds input declarations to every existing test that reads repository files other than by static import (at least the 28 tests selected today as tree-scan-oracle), so the run-time check lands green (INV-2); it states how reads made by child processes and by the compiled binary are covered, with a fixture for each.

Source audits (2026-10-16, main 2fc7661e): live-corpus/repo-write audit (74 files: 5 move, 4 rewrite, 1 delete, 13 keep, 51 false positives), prose-pin audit (49 files: 4 prose pins, 10 contract strings, 35 false positives; 11 tombstone files: 7 keep, 4 merge), duplicate-AC audit (about 15-25 duplicate cases; 46 of 684 AC-named test paths missing; store tests copied three times). Each task lists the files it owns.

## Invariants
- INV-1: no task weakens a test to make it pass. A changed oracle of an approved AC goes through `lore ac set --correction` with the original command, its result and why the change corrects rather than weakens.
- INV-2: main stays green after every merge: a guard is merged only after the offenders it catches are gone.
- INV-3: each guard and checker is red-first on a fixture in its own task, with the exact exit code and the rule name asserted.
- INV-4: no ledger entry without a named reason or consumer; a stale ledger entry fails the checker.

## Risk Register
| Risk | Impact | Mitigation |
|---|---|---|
| A concurrent session merges a new offender while a guard lands | M | The guard fails loud on main and names it; the merging task fixes it before T17 |
| Parallel bun runs expose shared-state races (e.g. #191 falsifier-dep-materialization) | H | T15 fixes the shared state at its root; no retries or timeout bumps |
| The T1 decision invalidates T13/T15 approaches | M | They are blocked by T1 and re-planned after it |
| Moving approved ACs' oracles weakens them | M | INV-1; reviewers compare the old and new oracle on the same falsifier |

## Exit Criteria
AC-TG-1 approved by the user; AC-TG-2..11 pass on main via lore verify.
