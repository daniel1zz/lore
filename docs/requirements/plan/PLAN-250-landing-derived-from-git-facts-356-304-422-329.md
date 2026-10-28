---
id: PLAN-250
type: plan
role: plan
title: "Plan: landing derived from git facts (#356, #304, #422, #329)"
status: archived
priority: high
created: 2026-10-26
updated: 2026-10-27
tags: [governance-mechanism-fixes, issue-356]
parent: SPEC-244
phases:
  - {name: "P1 Red", description: "Failing integration test for AC-ND-1..5, expected-fail captured"}
  - {name: "P2 Landing predicate", description: "Landing kind, checkNoChangeDeclaration, floor, CAS write, lore get rendering, milestone review reader"}
  - {name: "P3 Wiring and close", description: "CLI flag, MCP argument, compiled e2e; verify, rule apply, close the four blocked evaluation tasks"}
---
# Plan — landing derived from git facts (#356, #304, #422, #329)

Implements `spec-lore-done-closes-a-commitless-task-through-an-audited-no` (AC-ND-1..8), widened per user decision D20. Rules: BR-1423 (proposed, amended), BR-1291, BR-159, BR-1179 (modified). Issues: #356 (this plan), #304 and #329 (predicate task), #422 (back-fill task). Batched S2/S3 draft.

## Ordering

First of the governance plans. Its close task blocks the first task of `plan-per-call-run-identity-verified-by-process-ancestry-418` (task-level link: plan-level links are ignored by readiness, #464). It unblocks `plan-evaluation-1-experiments-and-honest-metric-envelope`: the four experiment tasks close through the route written in their bodies once this plan's predicate is on main.

## Overview

Claims record start_head. One pure predicate, landingOf, decides landed and its kind from git facts. Evidence, lore done, integrate's post-landing archive, plan close and milestone review all use it. Oracle files are read in main's tree. A one-time back-fill gives legacy landings a kind and open claims a start_head; after that the fields are required.

## Invariants

| # | Invariant | Checked by |
|---|---|---|
| I1 | One predicate: no caller computes landing on its own | AC-ND-8 |
| I2 | No fail-open: unmeasurable refuses | AC-ND-4 |
| I3 | Finished work is never recorded deprecated | AC-ND-1 |
| I4 | One landing write under concurrency | AC-ND-5 |
| I5 | No read-time default for legacy records | AC-ND-7 |

## Phases

- **P1 Red**: failing integration and back-fill tests (AC-ND-1..7).
- **P2 Landing predicate**: landingOf, git facts port, start_head at claim, the evidence counting rule, floors, oracle-in-tree; then the back-fill.
- **P3 Wiring and close**: integrate, plan close, milestone review, get, tool protocol, compiled e2e (AC-ND-8); verify, rule apply, the four experiment closes.

## Decisions log

D1-D6 in the spec. The S2 --declare-no-change ritual was dropped (D20): the predicate measures every precondition it restated. S2 tasks deprecated 2026-10-26 (draft, never claimed).
