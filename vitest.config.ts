import { defineConfig } from "vitest/config";
import { fileURLToPath, URL } from "node:url";

export default defineConfig({
  resolve: {
    alias: {
      // reason: dashboard src uses "@/" path alias; root vitest must resolve it to
      // packages/dashboard/src/ for component tests to find ui primitives. SPEC-015 §4 M6.
      "@": fileURLToPath(new URL("./packages/dashboard/src", import.meta.url)),
    },
  },
  test: {
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
      // reason: dashboard component tests need jest-dom matchers + React cleanup wired before
      // each test. vitest globals:false prevents @testing-library/react auto-detecting afterEach,
      // so setup.ts registers it explicitly. SPEC-015 §4 M6.
      "packages/dashboard/tests/setup.ts",
    ],
    include: [
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
    ],
    // reason: "**/*.pw.ts" (Playwright e2e specs, packages/dashboard/tests/e2e/**) already
    // fail to match the `include` globs above (which only list *.test.ts(x)), but this
    // exclude is a belt-and-suspenders guard so a future include-glob change can't
    // accidentally pull Playwright specs into the vitest run. SPEC-022 §9.7.
    exclude: ["**/*.bun.test.ts", "**/*.pw.ts", "node_modules/**"],
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
