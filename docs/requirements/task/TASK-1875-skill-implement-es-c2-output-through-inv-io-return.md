---
id: TASK-1875
type: task
role: plan
title: "[Skill:implement] ES-C2 output through inv.io, returned codes without a run scope, no implicit cwd reads"
status: archived
priority: medium
phase: "P1"
created: 2026-10-18
updated: 2026-10-18
tags: []
parent: PLAN-240
plan: PLAN-240
links:
  - {id: TASK-1868, type: blocks}
  - {id: TASK-1867, type: supersedes}
---
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

## Review of the first pass (branch worktree-agent-a9bd3bd9d00f4433b, commits b01c12ce, f019b090, 81910f9e) — required changes
Continue on that branch (merge it into your worktree first). Kept: AC-ES-1/2 oracles, returned exit codes, `dispatch` replacing runMain, the throwaway test HOME (HOME + BUN_INSTALL_CACHE_DIR + .gitconfig), deletions of the user-state guard, 69 runLoreInProcess call sites passing `home`, `runHandlerForExit`, the sync-stdio entry change, `process.exit(0)` at the end of a successful run.

Rejected (spec D4 + this brief's item 2; the same class as the deleted invocation-scope bridge):
1. `run-scope.ts`'s AsyncLocalStorage scope and its one-time global patch of `console` / `process.stdout.write` / `writeAllSync`. Output goes through `inv.io` explicitly: commands write via `inv.io` (ctx.inv), helpers that print take a writer parameter. Use codemods (as the formatError pass did: ~274 sites mechanically). Exit: `exitCli(code)` throwing `CliExit` is control flow and stays; `setExitCode` via the scope goes — a command returns its code (or throws CliExit). Delete run-scope.ts's scope; nothing in src patches a process global.
2. Implicit process reads below the entry: any fs call with a relative path, any child spawn without an explicit `cwd`, any sentinel string passed into fs. Resolve every path against `inv.cwd` (or the composed root) and pass `cwd` (and `env` when it matters) to every spawn. Known: `claim --worktree <relative>` git probe; the fragments sentinel `"\0lore-no-layer"` reaching fs. Find the rest: grep spawn/spawnSync/execFile/Bun.spawn calls without `cwd`, and fs calls whose path is not built from an absolute root. The test read recorder (scripts/test-read-log.ts) flagging these is CORRECT — do not change the recorder to tolerate them.
Report the before/after counts for direct writes, scope uses, and cwd-less spawns (all should be 0 below the entries).
