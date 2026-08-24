---
id: TASK-814
type: task
role: plan
title: "Author the red-first phase-write lifecycle doc-parity suite"
status: archived
priority: medium
phase: "red-first parity suite"
created: 2026-08-24
updated: 2026-08-24
tags: []
parent: PLAN-142
plan: PLAN-142
---
## Objective

Author `packages/lore/tests/integration/phase-write-lifecycle-doc-parity.test.ts`, the single
oracle behind SPEC-148's AC-PHASEVER-1/2/3. This task claims NO acceptance criterion. Its
deliverable is a suite that is RED for the reasons the spec already measured, plus
`lore evidence --result expected-fail` recorded BY THIS AGENT at the moment the red is
observed. ⛔ A red transcribed later by the orchestrator does not count.

## Measured red baselines — a green run here means the suite is defective

| Predicate | Measured 2026-08-24 | Must become |
|---|---|---|
| `neither demotes NOR logs a version` in root CLAUDE.md | 1 | 0 |
| `` `lore phase add|rm` does NOT demote but LOGS a version `` in root CLAUDE.md | 0 | 1 |
| `grep -rIl -e 'no version history' -e 'version-less' packages/` | 2 files | 0 files |
| ADR slug literal in each of phase-service.ts / ac-service.ts | 0 / 0 | 1 / 1 |
| `insertVersion` in phase-service.ts | 0 | 3 |
| `resolveStatusAfterContractEdit` in phase-service.ts | 0 | 0 (regression guard, VACUOUS today) |
| `resolveStatusAfterContractEdit` in ac-service.ts (green control) | 2 (import :99, call :615) | >= 1 |

## Exact test titles are load-bearing

The AC commands address blocks by `-t` filter. The suite MUST contain a block titled exactly
`rename and rm measured and premise recorded` and one titled exactly
`stale version-less assertions swept and demotion guarded`. ⛔ A title typo makes the filter
select nothing, and vitest reports selecting nothing as SUCCESS — a false green, which is the
failure shape this repo has documented. Assert the titles by running each AC command verbatim
and confirming it actually executes assertions.

## Invocation shape — pinned, do not improvise

- ⛔ Reach the CLI through the WORKTREE'S OWN SOURCE (`bun <repo>/packages/lore/src/index.ts`
  or `bun run dev`). ⛔ NEVER a prebuilt `dist/lore`: that binary is whatever commit last ran
  `bun run build`, so a suite spawning it measures a different commit and reports the verdict
  as if it measured this change. ASSERT the resolved entry path is inside the repo under test.
- ⛔ vitest is the pinned runner, so the suite may NOT top-level-import `bun:sqlite` or
  anything that transitively does. That is what forces the subprocess shape instead of an
  in-process `createApp` — the in-process version is what you will reach for first, and it
  fails under vitest for reasons unrelated to this task.
- ⛔ Throwaway corpus only: `mkdtemp` + `lore init`, cwd inside it. NEVER this repo's
  `.lore/` — it is the team's live knowledge base. Canonical pattern:
  `packages/dashboard/tests/e2e/global-setup.ts`.
- ⛔ Every negative assertion needs a green control in the SAME run, in the same vitest
  process as the negative it guards. `lore set --content` is the control: it demotes to
  `draft` AND raises `data.total`. A control in a different invocation is not a control.
- Version rows are read as `lore log <plan> --json` → `data.total` (measured to exist and to
  equal the entries length). ⛔ Not printed lines: `--limit` defaults to 20.

## Out of scope

⛔ Do not touch `phase-service.ts`, `ac-service.ts`, or `CLAUDE.md` — they are the NEXT task's
anchors, and the anchor gate will refuse an overlapping claim. Your suite must be red against
them as they stand.
