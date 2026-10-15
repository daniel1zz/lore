---
id: PLAN-152
type: plan
role: plan
title: "One worktree-removal test for the guard, lore done and a sweep"
status: archived
priority: medium
created: 2026-10-12
updated: 2026-10-12
tags: []
parent: SPEC-174
phases:
  - {name: "unify", description: "single removal test, check/sweep, lore done, hook"}
---
# Plan — One worktree-removal test for the guard, lore done and a sweep

Implements `spec-one-worktree-removal-test-for-the-guard-lore-done-and-a` (AC-WS-1..6), baseline `baseline-remove-a-seat` BR-1070 (amended) and BR-1079. User confirmation 2026-10-12 ("这个确认") of the proposal: one test shared by the hook and `lore done`, plus `lore worktree sweep`; taken as S1 decision and S4 approval for this one-task change.

## Overview

One task: a single removal test in lore (pure decision + IO probe incl. the process scan moved out of the hook), `lore worktree check|sweep`, `lore done`'s cleanup switched to it with the quiet window deleted, the hook's occupancy step delegated to `lore worktree check`.

## Invariants

| # | Invariant | How it is checked |
|---|---|---|
| I1 | The hook's clean/merged/HEAD refusal texts and every other gate rule unchanged | existing git-safety-gate suite |
| I2 | No test writes the live `.lore/`; tests that register runs set their own session ids | mkdtemp + lore init |
| I3 | Never `--force`, never `branch -D` on any removal path | AC-WS-5 review + code review |
| I4 | Installed hook refreshed by `lore setup` only after merge | orchestrator |

## Risk register

| # | Risk | Impact | Mitigation |
|---|---|---|---|
| R1 | A run that never recorded an end keeps its worktree forever | M | sweep hint names `lore run end <id> --reason` (audited) |
| R2 | `lore done` now removes sooner (no 30-min wait) and a resumed agent finds its worktree gone | M | D1 only removes for the caller's OWN session when the run ended; resuming one's own agent after `lore done` archived its task is a caller decision, and `lore done` prints what it removed |

## Decisions Log

- 2026-10-12 — user confirmed the unification proposal.
