---
id: TASK-1516
type: task
role: plan
title: "[Skill:test] TG-31 corpus fail census to zero, stale AC-080 statements, retire BR-1068"
status: archived
priority: high
phase: "Phase 3: guards"
created: 2026-10-17
updated: 2026-10-17
tags: []
parent: PLAN-201
plan: PLAN-201
links:
  - {id: TASK-1496, type: blocks}
---
Estimate: M
Approach: Follow-ups reported by T11A (merge 444feadf), measured 2026-10-17. (1) `bun scripts/check-corpus-fail-census.ts` exits 1: 5 criteria in state fail — AC-061-7, AC-062-3, AC-062-5 (repointed today; likely old-command evidence: run `lore verify` with a task so the new command is attested), AC-FR-10 and AC-064-7 (investigate: a real defect gets fixed or recorded as a task; never weaken the oracle). (2) AC-080-2, AC-080-3, AC-080-6 still describe the retired injection contract (count caps, omitted ledger) while buildBootstrapInjection is now seat-only: correct each to the surviving contract with its reason, or tombstone it as AC-CT-6 was. (3) BR-1068 describes the retired edit-notice hook (ee114c62): retire the rule through its baseline (lore rule set / retire) after confirming no criterion cites it. (4) Wire `bun scripts/check-corpus-fail-census.ts` into the package.json test chain once it exits 0.
Source: spec-test-governance-guards-that-refuse-bad-tests-declared (AC-TG-9); AS-17
AC: the census exits 0 on main and runs in the test chain; AC-080-2/3/6 match the code; BR-1068 retired.
