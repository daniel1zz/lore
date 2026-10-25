---
id: TASK-1867
type: task
role: plan
title: "[Skill:implement] ES-C returned exit codes, global-free test runner, throwaway test HOME"
status: draft
priority: medium
phase: "P1"
created: 2026-10-18
updated: 2026-10-19
tags: []
parent: PLAN-240
plan: PLAN-240
links:
  - {id: TASK-1875, type: relates-to}
---
> ⚠ INVALIDATED 2026-10-18T17:32:12.384Z — superseded by task-skill-implement-es-c2-output-through-inv-io-returned-codes; ES-C's scope (returned exit codes, global-free in-process runner, throwaway test HOME) was delivered by ES-C2 (merged 7e526991) after the first ES-C pass relied on a rejected AsyncLocalStorage run scope

Implements spec-process-state-end-state-one-invocation-per-entry-returned Goals 2 and 5 (D2, D4). Lands after ES-B (merged 50d4ee4a): no code below an entry reads process state any more.

## Done means
1. `runCli(inv)` returns the exit code (number); commands no longer call `process.exit` or set `process.exitCode`. They report their code to `runCli` (keep the single mapping `exitCode(error)` in `adapters/cli/utils.ts`: validation 4, usage errors such as an unknown flag 2). `packages/lore/src/index.ts` is the only place that calls `process.exit(code)`. citty's own exit paths (unknown flag in `wrapCommandStrict`, `--help`) must also surface as a returned code, not a process exit — check how `runMain` exits and replace with `runCommand` or equivalent if needed.
2. `packages/lore/tests/helpers/run-lore-in-process.ts`: `runLoreInProcess(args, { cwd, env, home })` requires `home`, builds an `Invocation` (cwd, env, argv, paths from home, io capturing stdout/stderr) and calls `runCli(inv)`; returns `{ exitCode, stdout, stderr }` from the invocation's writers. It assigns NO process global (`process.env`, `process.chdir`, `process.argv`, `process.exit`, `process.exitCode`, `console.*`, `process.stdout/stderr.write`) and has NO serial queue (`queueTail` deleted). If commands still write via `console.log`/`process.stdout.write` directly instead of `inv.io`, route them through `inv.io` (that is part of this task; grep the adapters for direct writes).
3. The test process runs with a throwaway HOME: the vitest configuration (vitest.shared.ts / config load, where `armSandboxEnv` already runs) sets `HOME` to a fresh mkdtemp directory before workers start, and sets explicitly only what tools need from the real home (measure: bun install cache `BUN_INSTALL_CACHE_DIR`, git identity via `GIT_CONFIG_GLOBAL` or per-repo config in fixtures, the claude-cli for any AI test). Reason (spec Goal 5): the isolation test must not damage the developer's data on the day it fails.
4. Delete `scripts/test-user-state-guard.ts`, `scripts/tests/iv-user-state-guard.test.ts`, and its wiring in `scripts/test-global-setup.ts` (the real home is unreachable by construction now).

## Acceptance criteria (oracles to write)
- AC-ES-1 `packages/lore/tests/helpers/es-run-lore-in-process.test.ts`: two runLoreInProcess calls whose commands each wait on a shared latch until both entered runCli complete (overlap proven; a surviving queue deadlocks and fails by timeout); each writes only under its own home (the other home byte-identical before/after); process.env and process.cwd() unchanged during and after.
- AC-ES-2 `packages/lore/tests/unit/cli/es-run-cli-exit-code.test.ts`: runCli returns 0 / 4 / 2 for success / validation refusal / unknown flag, and a spy on process.exit records zero calls.
RED first (record `--result expected-fail` at the moment), then GREEN, then unfiltered `lore evidence <task> --oracle test --result pass --command "<exact AC command>" --capture --ac <id>`; tsc via `--capture --result pass`. Remove the AC-ES-1/2 rows from scripts/ac-oracle-not-built-ledger.json; `bun run check:ac-oracle-ownership` must be OK. Do not write AC ids in other test files.

## Notes
- 61+ test files use runLoreInProcess; keep their call sites working (add `home` where missing — tests already pass a sandbox HOME in env; use it).
- Compiled-binary tests that spawn dist/lore are unaffected by the helper but are affected by the throwaway HOME — run a sample.
- Scoped floor: tests importing run-cli / adapters/cli/index / run-lore-in-process, `bun run test:changed <base>`, a sample of 10+ in-process e2e. Worktree caveat: scratch-namespace, check-shipped-defaults, compiled-census, baseline-coverage fail in worktrees for layout reasons. Never write the real HOME or the repo `.lore/`. Commit only in your worktree.
