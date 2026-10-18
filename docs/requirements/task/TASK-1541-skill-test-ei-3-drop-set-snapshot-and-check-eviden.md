---
id: TASK-1541
type: task
role: plan
title: "[Skill:test] EI-3 drop-set snapshot and check-evidence-identity-drop-set script"
status: draft
priority: high
phase: "Phase 1: rule and re-verification"
created: 2026-10-18
updated: 2026-10-18
tags: []
parent: PLAN-203
plan: PLAN-203
links:
  - {id: TASK-1540, type: blocks}
---
Estimate: M
Approach: Write scripts/check-evidence-identity-drop-set.ts (AC-EI-3 semantics: exit 0/1/2, per-outcome counts) and a generator that diffs two `lore ac list --json` dumps over every live spec (before/after) into scripts/evidence-identity-drop-set.json rows {spec, ac, before, after, task?, corrected?}. Commit the generator + checker + an EMPTY-but-present drop-set file is NOT allowed (exit 2 path); instead the task lands the checker and generator, and the orchestrator produces the real drop set at EI-1 merge time. Red-first fixture tests for exit 1 (unexplained row) and exit 2 (absent/empty), exact codes asserted. Remove the AC-EI-3 not-built ledger row when the script lands.
Source: spec-evidence-identity-an-attested-row-counts-only-for-the AC-EI-3
AC: AC-EI-3 checker + generator with red-first fixtures; check:ac-oracle-ownership exit 0.
