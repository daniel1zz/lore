---
id: TASK-1506
type: task
role: plan
title: "[Skill:implement] TG-23 one runner: vitest on the Bun runtime for every test"
status: archived
priority: critical
phase: "Phase 3b: one runner"
created: 2026-10-17
updated: 2026-10-17
tags: []
parent: PLAN-201
plan: PLAN-201
links:
  - {id: TASK-1509, type: blocks}
  - {id: TASK-1508, type: blocks}
  - {id: TASK-1503, type: blocks}
  - {id: TASK-1495, type: blocks}
  - {id: TASK-1498, type: blocks}
  - {id: TASK-1493, type: blocks}
  - {id: TASK-1496, type: blocks}
---
Estimate: XL (one acceptance unit: the suite runs under one runner)
Approach: Move every test to vitest on the Bun runtime (`bunx --bun vitest run`), vitest version pinned exactly in package.json.
- Config: add `test.server.deps.inline: ["zod"]` (530 of 557 unchanged failures share that cause, measured in the ADR); one vitest config covers packages/core, packages/lore, scripts, dashboard. The dashboard DOM tests and the files whose vi.mock behaves differently under Bun (9 measured) run in a Node vitest project listed BY FILE, never a glob; each listed file names its reason.
- Rewrite the 312 `*.bun.test.ts` files by script (bun:test imports → vitest; the researcher's script is /private/tmp/claude-501/-Users-apple-Projects-zz-lore/c1ffea04-89c5-46f4-8bb9-0d10906f3f65/scratchpad/tg1-research/tools/port.ts, measured 291/312 passing after it) then fix the rest by hand (mostly import.meta.dir). Decide and state the filename policy (keep or rename `.bun.test.ts`); whichever you choose, every AC command that runs a moved file with `bun test` is repointed in this task by one scripted batch of `lore ac set --correction` (record the old command and why), and check:ac-oracle-ownership must not regress.
- Sandbox guard under the new runtime: Bun children do NOT inherit runtime process.env mutations (measured 2026-10-16), so the vitest setupFiles marker must reach children under `--bun` too (e.g. env set before the runner starts, as T4 did with .env.test). Assert it from inside a child spawned with no env, red first.
- package.json: `test` runs one runner (plus the listed Node project); retire `test:bun` or make it an alias that fails loud; update hooks/pre-push and the shipped assets/project/pre-push if they name either runner.
- Rebuild-in-test (8 files) is T24's, in-process conversion is T25's; do not touch those beyond the mechanical rewrite.
Source: spec-test-governance-guards-that-refuse-bad-tests-declared; decision: adr-tg-1-test-runner-decision-measured-comparison-of-bun-only (option b, accepted 2026-10-17)
AC: AC-TG-10 groundwork: `bun run test` on main runs every test file exactly once under the one runner (plus the listed Node project) and exits 0; a count check proves no file is dropped (files on disk == files run).
