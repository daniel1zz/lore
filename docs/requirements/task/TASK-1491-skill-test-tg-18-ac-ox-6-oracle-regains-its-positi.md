---
id: TASK-1491
type: task
role: plan
title: "[Skill:test] TG-18 AC-OX-6 oracle regains its positive parsed count and clean-tree tail"
status: archived
priority: high
phase: "Phase 2: clear offenders"
created: 2026-10-16
updated: 2026-10-16
tags: []
parent: PLAN-201
plan: PLAN-201
links:
  - {id: TASK-1496, type: blocks}
---
Estimate: S
Approach: T3 rebound approved AC-OX-6 (spec-oracle-exclusivity-in-a-shared-checkout-a-mirror-check) from scripts/tests/mirror-status-parity.test.ts to `bun run check:spec-mirror && bunx vitest run scripts/tests/mirror-status-drift-check.test.ts`. The AC statement still requires (1) a POSITIVE trace: the count of mirror files whose frontmatter status was actually parsed, non-zero and equal to the mapped-and-present population (a first attempt once reported 0 mismatches while parsing 0 of 1490 files), and (2) the run leaves `git status --short docs/requirements .lore` empty. The new oracle drops both: check:spec-mirror prints no parsed count. Fix: the frontmatter/content check in scripts/export-spec-mirror-core.ts (and its caller) prints the number of files compared per type and fails when it compared zero while the mapped population is non-zero; mirror-status-drift-check.test.ts asserts the count line and a zero-parsed failure; restore the clean-tree tail in the AC command via lore ac set --correction (record why).
Source: spec-test-governance-guards-that-refuse-bad-tests-declared (INV-1)
AC: AC-OX-6's command again proves a non-zero parsed count and a clean tree; the zero-parsed fixture goes red with an exact exit code.
