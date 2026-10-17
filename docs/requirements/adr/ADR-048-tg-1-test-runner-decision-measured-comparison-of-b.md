---
id: ADR-048
type: adr
role: decision
title: "TG-1 test runner decision: measured comparison of bun-only, vitest-on-Bun and a storage seam, plus compiled-binary test audit"
status: approved
priority: critical
created: 2026-10-16
updated: 2026-10-17
tags: [testing, runner, tg-1]
parent: PRD-001
links:
  - {id: TASK-1505, type: informs}
---
# Context

AC-TG-1 of spec-test-governance-guards-that-refuse-bad-tests-declared (rule AS-13 of baseline-standard-testing): today the suite runs under two runners. `*.bun.test.ts` (312 files, of which `test:bun` runs the 311 under packages/lore) run only under `bun test`, because they need bun:sqlite or Bun APIs. Every other `*.test.ts(x)` (730 files) runs only under vitest on Node. Selection across the two (`scripts/changed-tests.ts`) is our own code. This ADR records measured numbers for three runner options, plus a classification of the tests that spawn the compiled `dist/lore`. **Decision status: proposed. The user picks the option.**

## Measurement setup

- Commit 2fc7661e (main), measured in a scratch git worktree (since removed). Never this repo's `.lore/`.
- Machine: macOS Darwin 25.1.0, arm64, Apple M1 Pro, 8 CPUs, 16 GB. bun 1.3.10 (installed), bun 1.4.2 (downloaded from npm for the parallel trial), vitest 3.2.6, Node 24.14.0.
- vitest concurrency: `maxWorkers: 4` (repo config). bun concurrency is stated per row.
- **Caveat:** the machine was shared with other agent sessions running tsc and `bun run test:bun` in other worktrees. 1-minute load averages ranged from 2.8 to 44 during the runs. Every wall time below is one run, labelled with its load. Compare rows with that in mind. The orchestrator's earlier serial bun run on a quieter machine took 1235 s; mine took 1753 s.
- Known environment failures, present in every option and excluded from "must change": `mirror-status-parity`, `spec-mirror-export` and `list-json-real-corpus-buffer` need the live `.lore/` corpus, which a fresh worktree lacks. `pre-push-trip` hit code drift in the worktree. `falsifier-dep-materialization` is the known flaky test #191.

## Baseline (today, two runners)

| run | files | wall | failing files | load 1m before/after |
|---|---|---|---|---|
| vitest on Node, 4 workers (run 1) | 730 | 384 s | 5 (3 env + anchor-coverage-ratchet, anchor-coverage-stale-exemption) | 12 / 30 |
| vitest on Node, 4 workers (run 2) | 730 | 303 s | 4 (3 env + #191) | 6 / 23 |
| bun 1.3.10 `test:bun`, serial | 311 | 1753 s | 1 (pre-push-trip, env) | 7 / 13 |

Today's total is the sum of two invocations: about 303 + 1753 = 2056 s. This sum is computed, not a single run.

# Options measured

## (a) bun test only (our own change selection)

- **Vitest files run one at a time under `bun test <file>` (bun 1.3.10, one process per file, 4 at a time): 83 of 730 fail.**
  - jsdom / dashboard: 54. 54 of the 68 dashboard files fail. bun has no DOM environment and does not run the vitest setupFiles. A happy-dom preload was not measured.
  - vi.* / vitest-only APIs: 15. These are `vi.hoisted` (4), `vi.mock` factory `importOriginal` (5), `vi.setSystemTime` (2), `vi.resetModules` (1), `vi.stubGlobal` (1), `expect.soft` (2) and `ctx.task` (1).
  - config: 0 apart from the dashboard alias and setupFiles, which are counted under dashboard.
  - other semantic differences: 11. These are 5 `eval/*` files (`expect(...).not.toThrow()` behaves differently), plan-exempt-attestation, session-bootstrap-injection, real-process-scan-port, attestation-head-sha, setup-service and #191.
  - env: 3.
- Wall time for the 730 vitest files run per file, 4 processes: **282 s** (load 19→7). The per-file times add up to 1034 s.
- bun 1.3.10 cannot run files in parallel. Under 1.3.10 the full suite therefore means 282 s plus the serial bun side at 1753 s, about **2035 s** (computed sum).
- **bun 1.4.2 `--parallel=4`** (released 2026-09-05, adds `--parallel`, `--shard`, `--isolate`, `--changed`):
  - Bun side alone (311 files): **533 s** (load 3→35). 9 files failing. 5 of them failed the stale-binary guard because **8 test files rebuild `dist/lore` in `beforeAll`** (`bun run build`), and the rebuild races with the guard in other compiled tests that run at the same time. The other 4 hit the 30 s timeout under load.
  - **All 1042 files in one run: did not finish.** A worker hung on `integration/cli/architecture-cli.bun.test.ts` at 99 % CPU and the log stayed idle for more than 10 minutes. I killed the worker at 2211 s. bun reported 529 failing tests and 53 errors, and one worker crashed (`assess-ai.bun.test.ts`, exit 4).
- bun 1.3.10 `--concurrent` (in-file concurrency, max 20), bun side: **aborted at 887 s with no summary**, and 15 files had failures before that. The in-process command tests change process-wide state (`process.chdir`, a spy on `process.exit`, `process.exitCode`), so tests running at the same time inside one file collide.
- **Files that must change:** 80 vitest files (83 minus 3 env). That includes 54 dashboard files unless a DOM preload makes them pass (not measured). 0 bun files. Any parallel bun run also needs the 8 files that rebuild `dist/lore` changed to build once before the run.
- Selection: bun 1.3.10 has none. bun 1.4.2 `--changed[=ref]` walks the static import graph in reverse, the same model as vitest's `--changed`.

## (b) vitest under the Bun runtime (`bunx --bun vitest run`)

- Unchanged config: **557 of 730 fail**. 530 of them share one cause: `z` from zod is undefined at module evaluation. Adding one config line, `test.server.deps.inline: ["zod"]`, fixes it.
- With that line: **26 of 730 fail.**
  - 3 env and 1 is #191.
  - 9 are vi.mock interop: members of the mocked module are missing under Bun (`mockReset`, `mockClear`, `mockResolvedValue`, `db.close`).
  - 13 behave differently. 2 of those (check-test-budgets, dashboard typecheck-scope) were caused by my experiment's extra copied files being in the tree.
  - **About 20 vitest files must change.**
- **Does bun:sqlite load? Yes.** The ported bun files that reach bun:sqlite pass under vitest on the Bun runtime.
- **Can `*.bun.test.ts` run there unchanged? No: 270 of 312 fail.** 255 fail with "Cannot use describe/beforeAll/... outside of the test runner" (the `bun:test` import), 11 because `import.meta.dir` is undefined, and 4 for other reasons. 42 pass.
- **With a mechanical rewrite** (import from `vitest` instead of `bun:test`; `setDefaultTimeout` becomes `vi.setConfig`; `spyOn` becomes `vi.spyOn`, generated by a script): **291 of 312 pass.** The 21 failures:
  - 13: `import.meta.dir` / `dirname` is undefined after the vite transform.
  - 2: bun-only matchers (`toEndWith`).
  - 1: a vite dynamic import with a variable path.
  - 1: env (pre-push-trip).
  - 2: artefacts of my experiment (dashboard-assets-loader typechecks the copied files; changed-tests-cli was mangled by the rewrite script).
  - 2: not diagnosed (turso-store, verbatim-slug-concurrency fail at suite level with no message).
- **Full suite in one invocation (730 vitest files + 312 rewritten bun files = 1042), 4 workers: 740 s** (load 23→10), 47 failing files: 26 vitest files plus 21 rewritten bun files. The bun files alone under vitest on Bun took 487 s (load 21→10), against 1753 s serial under `bun test`.
- **Files that must change:** 312 bun files with the scripted rewrite; about 16 of them also need a manual edit (mostly `import.meta.dir`). About 20 vitest files. 1 config line.
- Support status: vitest's docs require Node ≥ 22.12 and say `vi.mock` / `vi.hoisted` loader transforms "do not work in Deno or Bun" (experimental.md). Running vitest on Bun is not a documented target.
- Selection: `vitest --changed` and `vitest related` use the static module graph. `experimental.recordDependencies` records what each test actually imported at run time, but **it exists only in vitest 5.x**. I checked the published tarballs: it is not in 3.2.6 (installed) or 4.1.12, and it is in 5.0.5. Neither the static graph nor the recorded imports see subprocess spawns of `dist/lore` or files read with `fs`.

## (c) storage seam: most tests on vitest/Node with InMemoryStore

Static classification of the 312 bun files, following imports with Bun's transpiler:

| category | files |
|---|---|
| uses a `Bun.*` API or spawns a process (165 use `Bun.spawnSync`) | 203 |
| imports `bun:sqlite` directly (raw `Database`) | 25 |
| reaches bun:sqlite through app.ts / http / cli modules | 44 |
| **only Bun dependency is SQLiteStore** | **23** |
| no Bun dependency at run time (only the `bun:test` import) | 17 |

- Measured under vitest on Node with only the import rewrite: **23 of 312 pass.** Of the failures, 162 are "Cannot find package bun:sqlite" and 110 are "Bun is not defined".
- The 23 SQLiteStore-only files with `new SQLiteStore(":memory:")` replaced by `new InMemoryStore()` (16 replacements in 11 files): **5 pass** (batch-methods, ordinal-allocation.contract, paging, task-workflow-links, mirror-human-id-ssot). The other 18 fail for these reasons:
  - 12 use a file-backed `SQLiteStore(path)`. They test SQLite itself: reopening, persistence and races between processes.
  - 2 inject faults through `store.getDatabase()`.
  - 3 assert behaviour that InMemoryStore does not match.
  - 1 (migrate-ordinals) fails on an undefined path.
- **So the seam moves at most 23 + 5 = 28 of 312 bun files to vitest on Node. 284 stay on a Bun runtime, and the second runner remains.** I did not measure a full-suite wall time for this option. Its bun side would still be about 284 files under bun.
- Related, not measured: a driver seam that makes SQLiteStore run on `node:sqlite`. Node 24.14 has it and FTS5 works, but it still prints `ExperimentalWarning`. bun:sqlite call sites are in sqlite-store.ts (17 `.query`, 72 `.prepare`, 44 `.exec`, 110 `.run`) plus 5 other modules. This would not help the 203 files that use `Bun.*` APIs.

# Tests that spawn the compiled `dist/lore`

- The selector's marker regex (`dist/lore|LORE_BIN`) matches **122 test files** (97 bun, 25 vitest).
- **Run-time measurement:** I replaced `dist/lore` with a wrapper that logs every exec and ran the 122 files one at a time. **76 files spawned it, 2340 times in total.** Another **8 files rebuild `dist/lore` in `beforeAll` and then spawn it**; the rebuild replaces the wrapper, so their spawns were not logged, but I confirmed them in the code. That makes **84 files that spawn the binary at run time**. The other 38 marker files only mention the path, in comments or path checks.
- **Binary-only: 17 files, 381 logged spawns.**
  - 9 test the compiled artefact:
    - the census through `/$bunfs` (compiled-census)
    - the native libsql lazy load
    - binary provenance (2 files)
    - embedded asset serving (governance ×3, rs-shipped-catalog, context-provenance manifest parity)
  - 8 test real process behaviour:
    - SIGTERM and server lifecycle (dashboard-sigterm, dashboard-command)
    - the MCP stdio transport (record-lock-compiled)
    - hooks run the way Claude Code runs them, plus `--harness-run` argv handling in index.ts (run-identity-e2e, harness-run-any-server-name, session-start-seat-injection-hook, resume-coverage, context-fragments)
- **Command logic that can run in-process: 67 files, 1959 logged spawns.** Most say in their headers that they spawn the binary because the command imports the bun-only loader, or to test wiring.
- 28 test files already call a command's `run()` in-process, with a spy on `process.exit` and `process.chdir`. Each file copies this pattern; there is no shared helper. This is the same process-wide state that broke `--concurrent`.

Timing of 10 of each kind (first 10 alphabetically, run one at a time):

| kind | files | wall | spawns | wall per spawn |
|---|---|---|---|---|
| binary-only | context-fragments 17.28 s, context-provenance 5.54, governance-bootstrap-framing 1.32, governance-claude-md 1.28, libsql-lazy-load 5.70, record-lock 10.08, resume-coverage 8.72, rs-shipped-catalog 0.92, run-identity-e2e 7.24, session-start-seat-injection-hook 2.44 | 60.5 s | 227 | 267 ms |
| in-process-callable | ac-add-path-precheck 3.35 s, ac-command-pipe 4.44, ac-falsifier-range 2.42, ac-set-correction 7.69, baseline-rollback 13.20, bootstrap-injection 5.19, bootstrap-seat-injection 11.26, context-verbs 2.94, done-worktree-cleanup 13.47, evidence-cd-chain-precheck 6.28 | 70.2 s | 251 | 280 ms |

Microbenchmark, N=20 medians on a throwaway corpus:

| call | median |
|---|---|
| spawn `dist/lore --version` | 163 ms |
| spawn `dist/lore list --json` | 260 ms |
| in-process `list` command `run()` | 91 ms |

**Estimated, not measured:** moving the 67 in-process-callable files to in-process calls would save about 1959 × 0.17 s ≈ 330 s of serial time.

# Parallelism and selection options noted

- bun 1.3.10 has `--concurrent` and `--max-concurrency` (in-file only; aborted here). It has no file sharding or `--parallel`.
- bun ≥ 1.4.0 has `--parallel[=N]` (one worker per file, `--isolate` implied), `--shard=i/n` with `--timings`, and `--changed[=ref]`.
- vitest has `--changed[=ref]`, `vitest related <files>` and `--shard`. `experimental.recordDependencies` needs vitest 5.x.

# Comparison matrix

| | (a) bun test only | (b) vitest on Bun runtime | (c) storage seam |
|---|---|---|---|
| vitest files failing unchanged | 83 / 730 | 557 / 730 (26 after a 1-line config fix) | 0 (they stay on Node) |
| bun files failing unchanged | 1 / 311 (env) | 270 / 312 | 289 / 312 under Node even after the import rewrite |
| full-suite wall (measured) | 282 s + 1753 s as two runs (1.3.10). With bun 1.4.2 `--parallel=4` the full run hung (killed at 2211 s); bun side alone 533 s | **740 s, one run, 4 workers** | not measured; about 284 bun files stay on bun |
| test files that must change | about 80 vitest files (54 dashboard) + 8 that rebuild `dist/lore` | 312 bun files by script + about 16 by hand + about 20 vitest files + 1 config line | 28 bun files move; 284 still need Bun |
| runners after | 1 (bun) | 1 (vitest) | 2 |
| selection | bun 1.4.2 `--changed` (static) or ours | vitest `--changed` / `related` (static); recordDependencies in v5 | ours (two runners) |
| support risk | bun parallel runner is new (1.4.0, 2026-08) and hung here | Bun runtime is not a documented vitest target; 9 vi.mock interop failures | none new |

# Recommendation (proposed; the user decides)

**Option (b): one runner, vitest on the Bun runtime.** Make these changes together:

1. Add the `server.deps.inline: ["zod"]` config line.
2. Rewrite the 312 `*.bun.test.ts` files by script and fix the about 16 that still fail by hand.
3. Fix the about 20 vitest files that behave differently under Bun.
4. Build `dist/lore` once before the run, and remove the 8 in-test rebuilds.

Separately, convert the 67 in-process-callable binary tests to in-process calls through one shared helper, and keep the 17 binary-only tests on the compiled binary.

Why:
- It is the only measured option that runs the whole suite in one invocation and finishes: 740 s for 1042 files, against about 2056 s today as two runs.
- Change selection is then one tool, `vitest --changed` / `related`, instead of our selector spanning two runners. A move to vitest 5 adds recorded dependencies.
- 291 of 312 bun files pass after the scripted rewrite, so most of the change is mechanical and can be checked by running the suite.

Trade-offs, measured in error probability and blast radius:
- **Unsupported-runtime risk.** vitest documents only Node. 9 vi.mock interop failures already show divergence. Each vitest upgrade is a point of failure for the whole suite (blast radius: every test). Pin vitest and keep one Node vitest job for the vitest-only mock files as a check.
- **Rewriting 312 files** costs the script plus about 36 manual fixes. A wrong rewrite shows up as a red test, not a silent pass, as long as the AC-TG-6 missing-file and zero-matched guards hold.
- **Neither runner's selection sees subprocess spawns or fs reads.** Binary consumers still need declared inputs (TG-13) whichever option is chosen.
- **(a) is cheaper per file** (0 bun files change) but needs about 80 vitest files changed, a DOM for the dashboard, and bun 1.4.x's new `--parallel`. That run hung on a full-suite pass here, so it carries a higher chance that the gate never finishes.
- **(c) leaves two runners in place** (284 bun files remain). It does not meet AS-13's goal by itself. It is useful only as a follow-up for the 28 files.

Confidence: 75 %. Unknowns:
- Wall times were taken on a shared, loaded machine (one run each).
- The 2 undiagnosed bun-file failures under vitest.
- Whether a happy-dom preload would fix the 54 dashboard files under option (a).
- Whether bun 1.4.2's hang on architecture-cli reproduces on a quiet machine.


# Decision (user, 2026-10-17)

Option (b): one runner, vitest on the Bun runtime (`bunx --bun vitest`), with the vitest version pinned. The files whose mocks behave differently under Bun keep a Node vitest job until each is fixed or removed; the list is explicit, never a glob. The `*.bun.test.ts` files are migrated by script (`bun:test` imports → `vitest`), the remainder by hand. AS-13 (two runners, never mixed) is replaced by the one-runner rule when the migration lands.

Also in scope of the same plan (user decision): build `dist/lore` once before a run instead of 8 tests rebuilding it in `beforeAll`; move the 67 command-logic tests that start the binary to in-process calls through one shared helper, keeping the 17 tests that need the real binary.

Consequences: change selection uses vitest's static import graph plus declared test inputs (TG-13), since no runner option sees subprocess or file reads; AC-TG-11's wall-time limit applies to the single runner's full run.

Reviewer notes reconciled (2026-10-17): the vi.*/vitest-only API sub-counts sum to 16 against a category total of 15; the likely cause is one file counted under two APIs, but that overlap was NOT verified from the per-file logs; the binary-only timing sample is described as 'first 10 alphabetically' but its listing order was not re-checked; treat it as a 10-file sample of that category. The ADR is accepted (decision_status accepted) with the user's decision above.
