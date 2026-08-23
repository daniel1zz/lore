---
id: TASK-807
type: task
role: plan
title: "skill-test: RED oracles for the three-way split, the sole composition entry, and the two dead functions reaching the CLI"
status: archived
priority: medium
phase: "P1-split-and-wire"
created: 2026-08-23
updated: 2026-08-23
tags: []
parent: PLAN-139
plan: PLAN-139
---
## Objective

Author the RED oracles for Phase 1. All four must be red at authoring time because the production wiring they pin does not exist yet — that absence IS the defect.

## What to write

1. `packages/lore/tests/integration/claude-md-wiring.test.ts` (vitest) — spawns the CLI as a subprocess, never imports the check functions directly.
   - describe `claude-md wiring — reference_missing reaches the CLI as advisory`: mkdtemp repo whose CLAUDE.md cites a backtick-quoted nonexistent repo-relative path; `lore status --check-claude-md --json` yields a finding of kind exactly `reference_missing` **in the advisory array**, exit code exactly 0.
   - describe `claude-md wiring — narrative smells reach the CLI without affecting exit`: a paragraph at the module's declared ISO-date density threshold emits nothing; threshold+1 emits kind exactly `iso_date_density`. Both runs exit exactly 0. ⛔ Read the threshold from the exported module constant — never restate the number.
2. `scripts/check-claude-md-composition.ts` — exits 0 iff `status.ts` and `context-flow.ts` each reference `runMemoryFileChecks` and neither names any individual metric function. Print a summary line naming what was checked.
3. `scripts/check-claude-md-purity.ts` — exits 0 iff neither `claude-md-budget.ts` nor `claude-md-admission.ts` imports `node:fs`, `node:path`, or any store module. Print a summary line.

## Constraints

- ⛔ Fixtures use `mkdtemp` + cwd inside it. NEVER write to this repo's own `.lore/` or `.claude/`. Canonical pattern: `packages/dashboard/tests/e2e/global-setup.ts`.
- ⛔ Assert the exit code is **exactly** the declared value and that the output **names the kind**. Never assert merely "non-zero" — a tool that exits fatally without ever running the rule passes that test.
- vitest only. ⛔ No `.bun.test.ts` here (no `bun:sqlite` involved).
- Record the red run yourself, at the moment it is red: `lore evidence <task> --oracle test --command "<cmd>" --result expected-fail`. ⛔ Transcription by anyone else later does not count.

## AC covered

AC-WIRE-1, AC-WIRE-2, AC-COMPOSE-1, AC-PURE-1 — see `lore ac list spec-claude-md-governance-content-dimension-checks-wire-the` for the exact statements and the declared `--falsifier-*` mutation of each.
