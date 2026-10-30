import { defineConfig } from "vitest/config";
import { rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, URL } from "node:url";
import { listAgentHarnessMarkerEnvs } from "./packages/core/src/run-identity";
import { workspaceAliases } from "./workspace-aliases";
import { resolveMaxWorkers } from "./scripts/test-max-workers";
import { armSandboxEnv, createRunRoot } from "./scripts/test-isolation-env";
import { readRecorderAliases, readRecorderMockRedirect } from "./scripts/test-read-aliases";

// reason: arm the AC-TG-2 sandbox marker HERE, at config load in the runner's main process.
// Workers are forked with this environment as their STARTUP environment, which is the only kind
// a child spawned without an explicit `env` inherits under the Bun runtime. A setupFiles mutation
// would arm the worker but not its children; scripts/test-isolation-setup.ts measures the result.
armSandboxEnv(fileURLToPath(new URL(".", import.meta.url)));

// reason: a test run is hermetic about identity (#503). An agent session exports its own LORE_HARNESS_RUN to every Bash call
// (#418); a test run started there would hand it to every `lore` it spawns against a throwaway corpus, where that run is
// unknown and the call is refused. Removed HERE, at config load in the runner's main process (same reason as the sandbox
// marker above: workers and children spawned without an explicit env inherit the STARTUP environment under Bun; a
// setupFiles/globalSetup deletion would not reach them). Both configs import this module, so both runners are covered.
// Identity in tests comes only from packages/lore/tests/helpers/test-run-identity.ts and scripts/test-known-party-spawn.ts,
// which set the variable deliberately on the children they start.
// #531: the agent-harness MARKER (hasAgentHarnessMarker) is part of the same inherited identity: with the run gone but the
// marker kept, a fixture that spawns `lore` without a test identity is refused ("runs inside an agent harness but carries no
// attested run"), which CI never sees. Strip every marker on the ONE list core exports, so the two cannot drift. A test that
// needs the marker (CLAUDECODE=1 defaults AI assist off) must set it itself on the child it spawns.
delete process.env["LORE_HARNESS_RUN"];
for (const markerEnv of listAgentHarnessMarkerEnvs()) delete process.env[markerEnv];

/** Env var naming the throwaway HOME of this run (lets a nested run reuse its parent's and the teardown remove it). */
export const THROWAWAY_HOME_ENV = "LORE_TEST_THROWAWAY_HOME";

/**
 * Give the test run a throwaway HOME (AS-27, spec-process-state-end-state-one-invocation-per-entry-returned Goal 5): the
 * isolation test must not damage the developer's data on the day it fails, so the real home is unreachable by
 * construction instead of fingerprinted before and after. Armed HERE, at config load in the runner's main process, for
 * the same reason as the sandbox marker: workers are forked with this environment as their startup environment, and under
 * the Bun runtime a child spawned without an explicit `env` inherits only that.
 *
 * One run root (plan-test-runs-own-their-temp-dir-one-run-root-holds-home-and) holds that home and a `tmp/` that TMPDIR,
 * TMP and TEMP point at, so the directories tests create through `tmpdir()` are removed with the run instead of piling up
 * in the developer's temp dir.
 *
 * What the tools need from the real home, set explicitly and nothing else:
 *   - `BUN_INSTALL_CACHE_DIR`: bun's package cache lives under `$HOME/.bun` by default; without this every `bun`
 *     the run starts (the one `bun run build`, the oracle subprocesses) would re-download packages into the empty home.
 *   - source-control identity: written as `.gitconfig` inside the throwaway home, so a test that commits in a fixture
 *     repository needs no developer configuration (the tool finds it through `$HOME`, no further variable needed).
 * The claude CLI is not needed: tests that exercise the AI path use scripts of their own (tests/helpers/stub-claude.ts).
 * A nested run (vitest started by a test) inherits its parent's throwaway home unchanged.
 */
function armThrowawayHome(env: Record<string, string | undefined> = process.env): void {
  if (env[THROWAWAY_HOME_ENV] !== undefined) return;
  const realHome = env["HOME"] !== undefined && env["HOME"] !== "" ? env["HOME"] : homedir();
  if (env["BUN_INSTALL_CACHE_DIR"] === undefined) {
    env["BUN_INSTALL_CACHE_DIR"] = join(env["BUN_INSTALL"] ?? join(realHome, ".bun"), "install", "cache");
  }
  const { root, home } = createRunRoot(env);
  writeFileSync(join(home, ".gitconfig"), "[user]\n\tname = Lore Test\n\temail = lore-test@example.invalid\n");
  env["HOME"] = home;
  env[THROWAWAY_HOME_ENV] = home;
  // reason: the process that created the root removes it, with the home and every directory the tests made under its
  // tmp/, when it ends (also for `vitest list`, which loads this config and runs no teardown); a nested run created
  // nothing and removes nothing. A run killed by SIGKILL cannot; the next run removes its root (createRunRoot).
  process.once("exit", () => rmSync(root, { recursive: true, force: true }));
}
armThrowawayHome();

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
  // reason: the repo's own gate scripts (scripts/*.ts) are unit-tested directly (no subprocess) from here. Verified empirically
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
        // reason: a test that composes the App as the live test run and then writes needs that run registered in its
        // corpus file (an unregistered run is refused, BR-1351); scripts/test-app-shim.ts registers it after `createApp`.
        // Only specifiers ending in `src/app[.js]` match: modules inside packages/lore/src import `./app.js`-style paths
        // and get the real module.
        // The pattern spans the WHOLE specifier (vite replaces only the matched part of a regex `find`).
        { find: /^(?:\.{1,2}\/)+(?:packages\/lore\/)?src\/app(?:\.js)?$/, replacement: fileURLToPath(new URL("./scripts/test-app-shim.ts", import.meta.url)) },
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
      // reason: dist/lore is built ONCE per run here (not in any test), and the teardown fails the run
      // loud if a test wrote it (task-skill-implement-tg-24, adr-tg-1: in-test rebuilds tripped the
      // stale-binary check of every compiled test in a parallel run).
      globalSetup: ["scripts/test-global-setup.ts"],
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
      // reason: one worker per CPU, capped at 8 (scripts/test-max-workers.ts has the measurement:
      // 4 workers 732 s, 8 workers 538 s for the full run). Command logic runs in-process and
      // dist/lore is built once (TG-24/25/26), so workers are CPU-bound and no longer starve on
      // per-case `bun run` subprocesses, the reason this used to be capped at 4.
      // MUST be the pool-agnostic top-level `maxWorkers`: vitest 2+ defaults
      // `pool` to 'forks' (resolveConfig: `resolved.pool ??= 'forks'`), so a cap
      // written under poolOptions.threads.maxThreads silently never applies —
      // every full run spawned one fork process per CPU (~200-300MB RSS each),
      // and overlapping suite runs exhausted machine memory (2026-07-17).
      // Overridable per-run via the VITEST_MAX_WORKERS env var.
      maxWorkers: resolveMaxWorkers(process.env),
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
        // reason: one event-loop turn after every test, so a file of synchronous tests cannot starve the
        // worker's RPC for 60 s (`Timeout calling "onTaskUpdate"`); see the file header (TG-15).
        "scripts/test-yield-setup.ts",
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
