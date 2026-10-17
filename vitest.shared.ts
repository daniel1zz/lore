import { defineConfig } from "vitest/config";
import { fileURLToPath, URL } from "node:url";
import { workspaceAliases } from "./workspace-aliases";
import { armSandboxEnv } from "./scripts/test-isolation-env";
import { readRecorderAliases, readRecorderMockRedirect } from "./scripts/test-read-aliases";

// reason: arm the AC-TG-2 sandbox marker HERE, at config load in the runner's main process.
// Workers are forked with this environment as their STARTUP environment, which is the only kind
// a child spawned without an explicit `env` inherits under the Bun runtime. A setupFiles mutation
// would arm the worker but not its children; scripts/test-isolation-setup.ts measures the result.
armSandboxEnv(fileURLToPath(new URL(".", import.meta.url)));

// reason: under the Bun runtime the vitest MAIN process can exit 0 in the middle of a run: Bun ends a
// process whose event loop is empty even while the run still awaits worker results, so vitest never prints
// its summary or writes its report and `bunx` reports success (measured 2026-10-17: 3 of 3 full runs, and a
// 6-file subset 5 of 5 times, before this line). A ref'd timer in the main process keeps the loop alive until
// vitest itself calls process.exit() at the end of the run. Workers do not load this config.
setInterval(() => undefined, 60_000);

/** Every test file glob; the Bun-runtime config runs all of them except the files vitest.node-files.ts lists. */
export const ALL_TEST_GLOBS: readonly string[] = [
  "packages/lore/tests/**/*.test.ts",
  "packages/lore/src/**/*.test.ts",
  "packages/core/src/**/*.test.ts",
  // reason: SPEC-040 T1 introduces a dedicated packages/core/tests/ directory
  // (existing convention colocates *.test.ts next to source in src/) — both
  // layouts are valid; this glob just adds the new directory. SPEC-040 §T1.
  "packages/core/tests/**/*.test.ts",
  "packages/dashboard/tests/**/*.test.ts",
  "packages/dashboard/tests/**/*.test.tsx",
  "packages/dashboard/src/**/*.test.ts",
  "packages/dashboard/src/**/*.test.tsx",
  // reason: task-t1-structural-test-budget-oracle (spec-a-test-case-s-
  // timeout-budget-must-be-declared-when-its) — scripts/check-test-budgets.ts
  // is unit-tested directly (no subprocess) from here. Verified empirically
  // that an explicit `vitest run <path>` CLI argument does NOT add a file
  // outside these globs to the discovered set (it only filters within it) —
  // without this entry the AC oracle commands report "No test files found"
  // and exit 1, which is a false negative, not a legitimate run.
  "scripts/tests/**/*.test.ts",
];

/** One config body for both invocations: `include`/`exclude` are the only differences. */
export function createConfig(selection: { include: readonly string[]; exclude: readonly string[] }) {
  return defineConfig({
    plugins: [readRecorderMockRedirect(fileURLToPath(new URL(".", import.meta.url)))],
    resolve: {
      alias: [
        // reason: @lore/* resolves to THIS checkout's packages, never through node_modules
        // (a git worktree has none and would silently read the main checkout's). Derived from
        // tsconfig.base.json `paths`. task-skill-implement-tg-20-worktrees-resolve-their-own-lore.
        ...workspaceAliases(fileURLToPath(new URL(".", import.meta.url))),
        // reason: route fs / fs/promises / child_process through the declared-input recorder (AC-TG-7,
        // scripts/test-read-log.ts explains why an alias and not a patch).
        ...readRecorderAliases(fileURLToPath(new URL(".", import.meta.url))),
        // reason: dashboard src uses "@/" path alias; root vitest must resolve it to
        // packages/dashboard/src/ for component tests to find ui primitives. SPEC-015 §4 M6.
        { find: /^@\//, replacement: fileURLToPath(new URL("./packages/dashboard/src/", import.meta.url)) },
      ],
    },
    test: {
      // reason: under the Bun runtime vite-node evaluates zod's package before its `z` export is
      // wired, so `z` is undefined at module evaluation; inlining zod makes vite transform it.
      // adr-tg-1 option (b): 530 of the 557 failures of an unchanged config had this one cause.
      server: { deps: { inline: ["zod"] } },
      environment: "node",
      globals: false,
      // reason: packages/lore/tests/integration/cli/*.test.ts spawn the CLI as a real
      // `bun run src/index.ts` subprocess per case. Under full-suite CPU contention
      // (vitest's threads pool defaults to one worker per available CPU, so N
      // subprocess-heavy integration files can land on separate workers simultaneously,
      // each spawning its own bun subprocess) individual cases were observed taking
      // 6000-6500ms — already past the vitest default 5000ms testTimeout/hookTimeout —
      // producing intermittent subprocess-timeout failures that pass 29/29 in isolation.
      // 30000ms gives ~4.5x headroom over the observed 6.5s worst case, comfortably
      // covering additional contention (more worktrees, slower CI runners) without
      // masking a genuinely hung process. Do not lower this back toward 5000ms without
      // re-measuring worst-case subprocess latency under full-suite contention first.
      testTimeout: 30000,
      hookTimeout: 30000,
      // reason: same contention as above — capping workers below the 8 available
      // CPUs leaves headroom for each worker's spawned `bun run` subprocess to get
      // CPU time. 4 halves the worst-case subprocess-spawning parallelism while
      // still running 4 files concurrently (this is not a global serialization —
      // fileParallelism stays true, maxWorkers=1 would 10x wall-clock).
      // MUST be the pool-agnostic top-level `maxWorkers`: vitest 2+ defaults
      // `pool` to 'forks' (resolveConfig: `resolved.pool ??= 'forks'`), so a cap
      // written under poolOptions.threads.maxThreads silently never applies —
      // every full run spawned one fork process per CPU (~200-300MB RSS each),
      // and overlapping suite runs exhausted machine memory (2026-07-17).
      // Overridable per-run via the VITEST_MAX_WORKERS env var.
      maxWorkers: 4,
      // reason: maxWorkers caps process COUNT, not per-process memory — without
      // an explicit heap cap each fork can balloon to Node's 64-bit default
      // (~4GB old-space) before GC pressure kicks in, so 4 workers could still
      // claim ~16GB. isolate defaults to true (fork restarted per test file),
      // so 1.5GB is a generous per-FILE budget; a file exceeding it crashes
      // loud with a heap-OOM naming the culprit instead of silently swelling.
      // The MAIN vitest process is not covered by execArgv — it is capped via
      // NODE_OPTIONS in the `test:vitest` script (package.json).
      poolOptions: {
        forks: {
          execArgv: ["--max-old-space-size=1536"],
        },
      },
      setupFiles: [
        // reason: arms LORE_TEST_SANDBOX so corpus resolution refuses this repo's own
        // .lore/lore.db (AC-TG-2, task-skill-implement-tg-4). Child processes inherit it.
        "scripts/test-isolation-setup.ts",
        // reason: dashboard component tests need jest-dom matchers + React cleanup wired before
        // each test. vitest globals:false prevents @testing-library/react auto-detecting afterEach,
        // so setup.ts registers it explicitly. SPEC-015 §4 M6.
        "packages/dashboard/tests/setup.ts",
        // reason: LAST, so it discards the reads of the setup files above and then fails a test that
        // reads a repository file or spawns a repository program without declaring it (AC-TG-7).
        "scripts/test-read-recorder.ts",
      ],
      include: [...selection.include],
      // reason: "**/*.pw.ts" (Playwright e2e specs, packages/dashboard/tests/e2e/**) already
      // fail to match the `include` globs above (which only list *.test.ts(x)), but this
      // exclude is a belt-and-suspenders guard so a future include-glob change can't
      // accidentally pull Playwright specs into the vitest run. SPEC-022 §9.7.
      // reason: the former `*.bun.test.ts` files run here too (one runner, TG-23); only the files
      // listed BY FILE in vitest.node-files.ts are left to the Node invocation (vitest.node.config.ts).
      exclude: [...selection.exclude],
      coverage: {
        provider: "v8",
        reporter: ["text", "lcov"],
        include: ["packages/*/src/**/*.ts"],
        exclude: ["packages/lore/src/index.ts"],
      },
    },
    ssr: { external: ["bun:sqlite"] },
    optimizeDeps: { exclude: ["bun:sqlite"] },
  });
}
