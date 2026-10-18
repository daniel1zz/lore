---
id: TASK-1540
type: task
role: plan
title: "[Skill:implement] EI-1 coverage counts only equal-command attested rows; other_command tally on every surface"
status: draft
priority: critical
phase: "Phase 1: rule and re-verification"
created: 2026-10-18
updated: 2026-10-18
tags: []
parent: PLAN-203
plan: PLAN-203
links:
  - {id: TASK-1538, type: blocks}
  - {id: TASK-1539, type: blocks}
---
Estimate: L
Approach: computeAcCoverage (packages/core/src/acceptance.ts ~558-617) groups rows by ac_ref and counts pass/fail when attested, never reading entry.command; deriveAcCoverageState (~737-753) maps to states. Count only rows whose command === the AC's current verify.command (strict, no normalisation) into the pass/fail tallies, both directions; add an other_command tally and render it on lore ac list (text + --json), lore status, the spec mirror export, and lore assess's AC table, all via the one derivation (no surface re-derives). Find every caller of computeAcCoverage / deriveAcCoverageState and every reader of entry.command in coverage code. Red-first: test file with the 5 halves of AC-EI-1 in a throwaway corpus. Remove the AC-EI-1 not-built ledger row. Expect many existing tests that assert coverage states from fixture evidence with mismatched commands to need their fixtures fixed (fixture evidence must use the AC's command) — never change an assertion's expected state to make it pass without stating why in the commit.
Source: spec-evidence-identity-an-attested-row-counts-only-for-the AC-EI-1; investigation: acceptance.ts:558-617, 737-753, task-workflow.ts:1204 (isApprovedVerifyCommand is the only command comparison today)
AC: AC-EI-1 red-first then green; check:ac-state-renderers, typecheck, every importer of acceptance.ts green.
