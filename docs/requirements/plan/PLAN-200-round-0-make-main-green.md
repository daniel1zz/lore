---
id: PLAN-200
type: plan
role: plan
title: "Round 0: make main green"
status: archived
priority: medium
created: 2026-10-16
updated: 2026-10-25
tags: []
parent: SPEC-194
phases:
  - {name: "Phase 1: fixes"}
  - {name: "Phase 2: verify on main"}
---
## Overview
Round 0 of the backlog: make main green (spec-round-0-main-is-green-every-red-test-on-e1878626-traced-to). Ten tasks: nine fix tasks (Phase 1), one per root cause in the spec's Scope table, and one verification task (Phase 2).

| T | Task | Root cause / report |
|---|---|---|
| T1 | task-skill-test-r0-1-tests-assert-the-fragment-rules-not-the | fragment-prose pins, #227 |
| T2 | task-skill-implement-r0-2-setup-records-each-manifest-sha-from | setup manifest sha, #233 (AC-R0-3) |
| T3 | task-skill-test-r0-3-test-budget-ledger-and-missing-timeouts-170 | test-budget ledger, #170 |
| T4 | task-skill-refactor-r0-4-evict-store-claude-md-below-its-floor | store CLAUDE.md floor, #10 |
| T5 | task-skill-test-r0-5-plan-close-cascade-asserts-field-by-field | plan-close-cascade, #201 |
| T6 | task-skill-implement-r0-6-mirror-detects-and-repairs-duplicate | mirror human_ids + parity, #210 #234 #32 (AC-R0-5) |
| T7 | task-skill-implement-r0-7-ac-scope-resolution-ignores | ac_scope deprecated spec, #237 (AC-R0-4) |
| T8 | task-skill-implement-r0-8-anchor-or-ledger-every-unanchored | anchor coverage, #32 |
| T9 | task-skill-test-r0-9-no-test-writes-into-the-repo-tree-vocab | .vocab-probe race (new) |
| T10 | task-skill-test-r0-10-verify-both-suites-green-on-main | Phase 2: rebuild, run both suites, lore verify AC-R0-1..5 on main after the last merge |

Dependencies: T1 blocks T3 (T1 renames test titles the ledger is keyed on); T1-T9 all block T10. T1, T2, T4-T9 have disjoint anchors and run in parallel (max 6 at once).

## Invariants
- INV-1: no task weakens a test to make it pass; a pinned literal is replaced by an assertion of the same rule, recorded in the commit message.
- INV-2: every product fix (T2, T6, T7) is red-first in its own task.
- INV-3: tests never write into the repo tree (T9 enforces it for the one known offender).

## Risk Register
| Risk | Impact | Mitigation |
|---|---|---|
| Another concurrent session merges new red tests mid-round | M | T10 re-runs both suites on main after the last merge and compares to this spec's measured list |
| Renumbering duplicate mirror human_ids renames docs/requirements files other sessions reference | M | T6 renames via the exporter's repair only, reviews the diff in full, and commits it alone |

## Exit Criteria
AC-R0-1..5 pass on main via lore verify; each resolved report linked from its task.
