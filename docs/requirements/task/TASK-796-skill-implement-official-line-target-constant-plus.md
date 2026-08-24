---
id: TASK-796
type: task
role: plan
title: "skill-implement: OFFICIAL_LINE_TARGET constant plus the line_length and target_distance always-on advisories"
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

Phase 4, the last: the two always-on advisory metrics.

## What to build

1. **`OFFICIAL_LINE_TARGET`** — exported module constant in `claude-md-admission.ts`, value 200, citing [S] code.claude.com/docs/en/memory.md. ⛔ NOT in `contextConfigSchema`. Ceilings are per-repo tunable numbers needing exactly one writer; the official target is a fixed external citation nobody tunes. Conflating them puts two number-classes under an anti-dual-write rule written for only one of them (Module Boundary, spec v37).
2. **`line_length`** — advisory kind, one entry per discovered memory file, reporting that file's line-length distribution. The contract's reworded reflow clause explicitly names this signal and permits it.
3. **`target_distance`** — advisory kind, one entry per discovered memory file, `measured` = that file's line count minus `OFFICIAL_LINE_TARGET`.
4. Both route through `runMemoryFileChecks` and render via `claude-md-render.ts`.

⛔ Both are advisory FOREVER. Anthropic defines 200 lines as a target, not a limit; the exit code must never move because of them. A `max_lines` breach still decides exit 3 independently — the suite has a REGRESSION test for exactly that combination.

⛔ Every discovered file gets both kinds — including `role: "rules"` files added in Phase 3. The suite's STATE test covers root + module + rules simultaneously and asserts the per-kind counts equal a nonzero `headroom.length`, so a metric that silently skips a role fails.

⛔ An empty, 0-line CLAUDE.md still gets both kinds (ERROR dimension) — do not let a falsy zero suppress an entry.

## Constraints

- ⛔ Service modules stay PURE — predicates injected, no `node:fs`, no store.
- ⛔ AC-COMPOSE-1 bans 7 named functions from both call sites; everything goes through `runMemoryFileChecks`.
- ⛔ The oracle lives in another task's anchor — do NOT edit `packages/lore/tests/integration/claude-md-advisories.test.ts`.
- ⛔ Run the suite BY HAND plus `bun run typecheck`.
- `packages/lore/src/service/CLAUDE.md` runway is tight — if you record anything there, one line, then re-run `claude-md-eviction-floor.test.ts` (NOT `lore status --check-claude-md`, whose floor is looser and reported "within budget" on an already-red file this session).

## Definition of done

AC-ADV-1 green, verified with its declared `--falsifier-*` mutation producing the declared EXACT exit code. Record evidence, then `lore release`. ⛔ Do NOT run `lore done`.
