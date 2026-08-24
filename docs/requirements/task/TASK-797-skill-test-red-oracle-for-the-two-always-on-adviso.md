---
id: TASK-797
type: task
role: plan
title: "skill-test: RED oracle for the two always-on advisories (line_length, target_distance)"
status: archived
priority: medium
phase: "P4-always-on-advisories"
created: 2026-08-23
updated: 2026-08-23
tags: []
parent: PLAN-139
plan: PLAN-139
---
## Objective

RED oracles for Phase 4 — the two always-on advisory metrics. Neither exists.

## What to write

`packages/lore/tests/integration/claude-md-advisories.test.ts` (vitest, CLI subprocess)

describe `always-on advisories — printed every run, exit code untouched`:

- For EVERY discovered memory file, `lore status --check-claude-md --json` yields one advisory entry of kind exactly `line_length` and one of kind exactly `target_distance`.
- `target_distance`'s `measured` field equals that file's line count minus `OFFICIAL_LINE_TARGET`. ⛔ Read the target from the exported module constant — never restate 200 in the test.
- Exit code is exactly 0 on a repo with no breach. ⛔ Advisories NEVER affect the exit code: Anthropic defines 200 lines as a target, not a limit, and rendering it as a breach would overwrite that definition (spec N9, and the contract's own Target-vs-Ceiling section).
- Assert on JSON kinds and fields, ⛔ never on rendered prose.
- "Every discovered memory file" now includes `role: "rules"` files — Phase 3 added that role. A fixture with `.claude/rules/**` must get advisories too, or the metric is silently partial.

⛔ Non-vacuity: a run that discovers zero files would satisfy "every file has both kinds" trivially. Assert the discovered count is nonzero and matches the headroom array's length.

## Constraints

- ⛔ `mkdtemp` + cwd inside it. NEVER write to this repo's own `.lore/` or `.claude/`.
- ⛔ Assert exit codes EXACTLY.
- vitest only.
- ⛔ Record the red run yourself with `lore evidence ... --result expected-fail` at the moment it is red.
- ⛔ Do NOT run `bun run build`.

## AC covered

AC-ADV-1. Read it verbatim via `lore ac list spec-claude-md-governance-content-dimension-checks-wire-the`.
