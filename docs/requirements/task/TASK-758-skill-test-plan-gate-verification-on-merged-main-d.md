---
id: TASK-758
type: task
role: plan
title: "[Skill:test] Plan-gate verification on merged main — dual runner, verify, drift, provenance, SPEC-038 restored"
status: draft
priority: critical
phase: "P3 Phase-gate verification"
created: 2026-08-23
updated: 2026-08-23
tags: []
parent: PLAN-137
plan: PLAN-137
---
Estimate: S
Approach: run every invariant of this plan on the MERGED main, not in any worktree.
Source: plan Invariants INV-1..INV-7; SPEC-143 v51.
Dimensions: D-REGRESSION
Scope-Alt: none — without this the plan has no final gate and could be declared complete on per-task evidence alone.
Covers: (verification of AC-CT-1, AC-CT-2, AC-CT-3, AC-CT-4, AC-CT-5, AC-CT-7, AC-CT-8)

Runs only after every other task in this plan is archived and merged into main.

AC:
- Given merged main, When `bun run typecheck` runs, Then exit 0 (INV-1).
- Given merged main, When `bun run test:vitest` and `bun run test:bun` both run, Then both exit 0 (INV-2). ⛔ Full suite here only — worktree runs used `test:changed`.
- Given merged main, When `lore verify <this plan>` runs, Then every in-scope script-mode AC has an ATTESTED pass whose output tail is non-empty and contains the runner's summary line.
- Given merged main, When `lore status --check-tree --check-drift` runs, Then exit 0 (INV-5).
- Given the last merge, When `bun run build` has run, Then `lore status --check-binary-provenance` does not exit 3 (INV-6). ⛔ Every merge not followed by a rebuild trips this.
- Given T2's D7 amendment, When SPEC-038 is read, Then its status is `approved` — not left in draft by the ac set.
- Given every task in this plan, When their evidence is listed, Then each carries BOTH an `expected-fail` from its red phase and a later pass (INV-4).
- ⛔ Report any AC whose falsifier was never observed red as an explicit gap, rather than counting it as covered.
