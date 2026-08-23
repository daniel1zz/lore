---
id: TASK-801
type: task
role: plan
title: "skill-test: RED oracles for slug-pointer resolution and emphasis saturation"
status: archived
priority: medium
phase: "P2-slug-and-emphasis"
created: 2026-08-23
updated: 2026-08-23
tags: []
parent: PLAN-139
plan: PLAN-139
---
## Objective

Author the RED oracles for Phase 2 — two NEW deterministic metrics. Both must be red at authoring: neither metric exists yet.

## What to write

1. `packages/lore/tests/integration/claude-md-slug-pointers.test.ts` (vitest, CLI subprocess)
   - describe `slug pointers — a dangling slug is refused`: mkdtemp repo + its own `lore init` corpus, CLAUDE.md citing a backtick-quoted slug that does not exist there. `lore status --check-memory-pointers --json` → kind exactly `slug_pointer_missing`, exit code exactly 3.
   - describe `slug pointers — positive control plus real-corpus sweep`: the positive control above, PLUS every memory file in THIS repo yielding zero. ⛔ The positive control is mandatory — a skipped check and a clean check both produce zero.
   - ⛔ The check runs on `--check-memory-pointers` (a NEW flag in the corpus-loading family), NOT on `--check-claude-md`, which is corpus-free by SPEC-095 D9 and cannot resolve a slug. See decision N14.
   - The grammar must distinguish a real slug pointer from a gate name: `lore gate plan-close` contains the token `plan-close`, which matches a naive `plan-*` pattern but is not a document. Cover it.

2. `packages/lore/tests/integration/claude-md-emphasis.test.ts` (vitest, CLI subprocess, on `--check-claude-md`)
   - describe `emphasis saturation — over-threshold density is refused`: a fixture at TWICE the resolved `max_per_kb` → exactly one `emphasis_saturated`, exit exactly 3; a fixture AT the default → none, exit exactly 0. ⛔ Read the default from resolved config and construct both fixtures from it — never restate the number.
   - Assert the finding carries NO warn/evict fraction field: marker density is not a capacity metric and must not reuse the three-band ceiling machinery (N5).
   - describe `emphasis saturation — positive control plus repo sweep at shipped default`: positive control + every memory file in this repo passing at the shipped default.

## Constraints

- ⛔ `mkdtemp` + cwd inside it. NEVER write to this repo's own `.lore/` or `.claude/`. Pattern: `packages/dashboard/tests/e2e/global-setup.ts`.
- ⛔ Assert exit codes EXACTLY, and assert the output NAMES the kind. Never "non-zero".
- vitest only, no `.bun.test.ts`.
- ⛔ Record the red run yourself, at the moment it is red, with `lore evidence ... --result expected-fail`.

## AC covered

AC-SLUG-1, AC-SLUG-2, AC-EMPH-1, AC-EMPH-2 — read them verbatim via `lore ac list spec-claude-md-governance-content-dimension-checks-wire-the`, including each declared `--falsifier-*`.
