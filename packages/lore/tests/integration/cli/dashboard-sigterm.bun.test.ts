/**
 * AC-3 (task-lore-dashboard-leaks-the-vite-child-on-sigterm-only-sigint) — end-to-end
 * oracle spawning the COMPILED `dist/lore dashboard` binary, sending it SIGTERM (the
 * default `kill`/`pkill` signal), and asserting the spawned Vite child is actually gone
 * and both the API port and the dashboard port are released within a bounded window.
 * Pre-fix, only SIGINT ran any teardown at all — SIGTERM left the Vite child alive
 * holding its port, which then broke the NEXT `lore dashboard` run's Origin-allowlist
 * match (compounds with task-dashboard-bootstrap-origin-allowlist-hardcodes-port-5173).
 *
 * A SECOND, deeper defect was found manually while building this suite (not in the
 * original task description): `bun run --filter @lore/dashboard dev` is an INTERMEDIATE
 * process that itself spawns the real Vite server as a further grandchild. Node's default
 * (non-`detached`) `spawn` keeps every descendant in `lore dashboard`'s own process
 * group, so signaling just the immediate child's PID (the pre-fix — and this task's
 * initially-drafted fix's — `vite.kill(signal)`) killed `bun run --filter ...` but left
 * the actual `vite` node process running and still holding the port, reproduced via a
 * manual `kill -TERM <dashboard-pid>` + `lsof -iTCP:<dashPort>` check. The shipped fix
 * (`commands/dashboard.ts::killableProcessGroup`) spawns the intermediate process
 * `detached: true` (POSIX: makes it the leader of its OWN new process group) and signals
 * the NEGATIVE pid (`process.kill(-pid, signal)`), which the kernel delivers to every
 * process in that group. This suite is what caught that gap and is what now pins it.
 *
 * DD-5 restore (task-skill-test-f5a-restore-dashboard-sigterm-test-to-dev, spec
 * spec-dashboard-production-packaging-one-command-lore-dashboard): `spec-dashboard-
 * production-packaging-one-command-lore-dashboard` DD-5 flipped `lore dashboard`'s DEFAULT
 * from this two-process Vite topology to a single-process packaged mode with ZERO
 * descendant processes. Every `spawnDashboard` call below now passes `--dev` explicitly so
 * this suite keeps exercising the Vite-child descendant-teardown behavior it was written
 * for — the packaged-mode default is structurally out of scope for THIS suite (it has no
 * descendant to snapshot/kill/verify-gone at all; that topology's own SIGTERM/SIGINT
 * cleanliness, if ever pinned, belongs in a separate packaged-mode test).
 *
 * Requires `bun run build` to have run first — `assertFreshBinary` (same helper
 * `slugify-compiled.bun.test.ts` uses) fails loud before any test runs if `dist/lore` is
 * missing or older than the newest `.ts` source under `packages/{lore,core}/src`.
 *
 * Isolation (root CLAUDE.md 2026-07-07 pollution-incident rule + this task's own
 * constraint — never touch the real machine auth store, the real machine config, or any
 * real corpus):
 *   - `lore dashboard`'s Vite spawn (`commands/dashboard.ts`) hardcodes `cwd:
 *     projectRoot`, where `projectRoot` is derived from wherever `.lore/` was found —
 *     `bun run --filter @lore/dashboard dev` only resolves when that same directory ALSO
 *     contains this monorepo's `packages/`, `node_modules/`, `package.json` and
 *     `bun.lock` (Bun's workspace-filter resolution). A THROWAWAY corpus directory alone
 *     (no `packages/`) reproducibly fails with "No packages matched the filter" —
 *     verified manually while building this suite. `makeProjectRootFarm` below builds a
 *     fresh `mkdtemp` directory per scenario, SYMLINKS the four real monorepo entries
 *     into it (cheap — no copy of `node_modules`), and `lore init`'s a genuinely fresh
 *     `.lore/` INSIDE that farm dir — the real repo tree is only ever read through, never
 *     written to, and the corpus itself is 100% throwaway.
 *   - `LORE_STATE_HOME` points at a throwaway dir — the machine-scope dashboard-auth.db
 *     (SPEC-078 D1) never touches `~/.local/state/lore`.
 *   - `LORE_CONFIG_HOME` alone does NOT suppress the real `~/.config/lore/config.yaml`
 *     fallback (verified manually — `resolveGlobalConfigPath`'s XDG/homedir tiers still
 *     apply when the `LORE_CONFIG_HOME` candidate file doesn't exist), so `HOME` is ALSO
 *     redirected to the farm dir — `homedir()` then resolves inside the throwaway tree,
 *     and this repo's own (real, dogfooded) `dashboard.projects` registry is never read.
 *   - Ports are randomized per run (high range) to minimize collision with any other
 *     concurrent worktree's test suite on this machine.
 *
 * Verification strategy: rather than trying to name the Vite child's exact PID up front,
 * this test snapshots the FULL descendant-PID tree of the `dist/lore` process (via
 * `pgrep -P`, recursively) once the dashboard's own `/health` endpoint responds (a
 * deterministic readiness signal bound to `127.0.0.1` — unlike the Vite dev server's own
 * readiness, which this sandbox's Vite binds to `::1` only, not `127.0.0.1`, an unrelated
 * environment quirk this suite works around by never probing the dashPort directly), then
 * asserts EVERY one of those PIDs is gone after the signal — cross-checked against port
 * release, the actual user-visible symptom the bug report describes ("the orphan then
 * triggers the Task-1 auto-increment failure").
 *
 * Test plan (6-dimension):
 *   HAPPY:
 *     - SIGTERM: every descendant PID gone + both ports free within the bounded window
 *       (AC-3's primary assertion)
 *
 *   NEGATIVE:
 *     - n/a — a failure to tear down manifests as the SAME assertions failing, not a
 *       distinct negative-input case; the REGRESSION case below is this suite's negative
 *       control (pre-fix, SIGINT alone taught nothing about SIGTERM)
 *
 *   BOUNDARY:
 *     - the descendant-PID snapshot is taken only after `waitUntil` confirms at least one
 *       descendant exists (guards against a flaky "snapshot too early, before Vite even
 *       spawned" false pass on the "every descendant gone" assertion)
 *
 *   ERROR:
 *     - n/a — no IO-failure path distinct from the happy path at this level
 *
 *   STATE:
 *     - n/a — process lifecycle, not persisted state
 *
 *   REGRESSION:
 *     - SIGINT: identical assertions (every descendant PID gone + both ports free) — the
 *       pre-existing behavior this fix must not have broken
 *
 * @spec_ref task-lore-dashboard-leaks-the-vite-child-on-sigterm-only-sigint AC-1, AC-2
 */

import { describe, expect, it, beforeAll, afterEach } from "bun:test";
import { mkdtempSync, rmSync, symlinkSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { assertFreshBinary } from "../helpers/assert-fresh-binary";

// tests/integration/cli/ -> tests/integration/ -> tests/ -> packages/lore/ -> packages/ -> repo root (5 levels up).
const REPO_ROOT = new URL("../../../../../", import.meta.url).pathname.replace(/\/$/, "");
const LORE_BIN = join(REPO_ROOT, "dist", "lore");

beforeAll(() => {
  assertFreshBinary(LORE_BIN, [
    join(REPO_ROOT, "packages", "lore", "src"),
    join(REPO_ROOT, "packages", "core", "src"),
  ]);
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Builds a fresh `mkdtemp` directory that LOOKS like this monorepo's root to Bun's
 * `--filter` workspace resolution (symlinked `packages/`, `node_modules/`,
 * `package.json`, `bun.lock`) — see this file's header for why `lore dashboard`'s Vite
 * spawn needs this. The real repo tree is only ever read through these symlinks, never
 * written to.
 */
function makeProjectRootFarm(): string {
  const farmDir = mkdtempSync(join(tmpdir(), "lore-dashboard-sigterm-farm-"));
  symlinkSync(join(REPO_ROOT, "packages"), join(farmDir, "packages"));
  symlinkSync(join(REPO_ROOT, "node_modules"), join(farmDir, "node_modules"));
  symlinkSync(join(REPO_ROOT, "package.json"), join(farmDir, "package.json"));
  symlinkSync(join(REPO_ROOT, "bun.lock"), join(farmDir, "bun.lock"));
  return farmDir;
}

function initCorpus(dir: string): void {
  const result = Bun.spawnSync([LORE_BIN, "init"], {
    cwd: dir,
    env: { ...process.env, HOME: dir },
  });
  if (result.exitCode !== 0) {
    throw new Error(`lore init failed: ${result.stderr.toString()}`);
  }
}

/** Direct child PIDs of `pid` via `pgrep -P` (empty array if none / pgrep unavailable). */
function directChildPids(pid: number): number[] {
  const result = Bun.spawnSync(["pgrep", "-P", String(pid)]);
  const out = result.stdout.toString().trim();
  if (out === "") return [];
  return out.split("\n").map((s) => Number.parseInt(s, 10)).filter((n) => Number.isFinite(n));
}

/** Full descendant PID tree (BFS), not just the immediate child. */
function descendantPids(rootPid: number): number[] {
  const all: number[] = [];
  let frontier = [rootPid];
  // reason: bounded depth (8) — a real dashboard->bun->vite chain is at most a few levels
  // deep; this guards against an unexpected pgrep cycle/self-loop spinning forever.
  for (let depth = 0; depth < 8 && frontier.length > 0; depth++) {
    const next: number[] = [];
    for (const pid of frontier) {
      const children = directChildPids(pid);
      all.push(...children);
      next.push(...children);
    }
    frontier = next;
  }
  return all;
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** True iff a NEW listener can bind `port` on 127.0.0.1 (i.e. nothing else holds it). */
function isPortFree(port: number): boolean {
  try {
    const listener = Bun.listen({
      hostname: "127.0.0.1",
      port,
      socket: { data() {} },
    });
    listener.stop(true);
    return true;
  } catch {
    return false;
  }
}

async function waitUntil(
  predicate: () => boolean | Promise<boolean>,
  timeoutMs: number,
  intervalMs = 150,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await predicate()) return true;
    if (Date.now() >= deadline) return false;
    await new Promise<void>((r) => setTimeout(r, intervalMs));
  }
}

async function isApiHealthy(apiPort: number): Promise<boolean> {
  try {
    const res = await fetch(`http://127.0.0.1:${apiPort}/health`, { signal: AbortSignal.timeout(500) });
    return res.ok;
  } catch {
    return false;
  }
}

interface DashboardHandle {
  proc: ReturnType<typeof Bun.spawn>;
  apiPort: number;
  dashPort: number;
}

/**
 * Spawns the compiled dashboard against a throwaway project-root farm + corpus, forcing
 * the `--dev` two-process Vite topology.
 *
 * spec-dashboard-production-packaging-one-command-lore-dashboard DD-5 flipped `lore
 * dashboard`'s DEFAULT to packaged mode (in-process HTTP server, embedded static assets,
 * ZERO descendant processes). This suite's entire premise — snapshot the Vite-child
 * descendant-PID tree, signal the parent, assert every descendant is gone — only exercises
 * anything under the pre-DD-5 dev topology, where `bun run --filter @lore/dashboard dev`
 * (and the real `vite` node process it further spawns) exist as children in the first
 * place. Every `spawnDashboard` call in this file MUST pass `--dev` explicitly: without
 * it, `descendantPids(proc.pid)` would stay empty for the packaged-mode default, and this
 * suite would either hang on the `descendantsAppeared` wait (until its own 15s timeout) or,
 * worse, degrade into a vacuously-true assertion that teaches nothing about teardown at
 * all — see this file's header comment on the observed sub-3s "2 pass 0 fail" false-green.
 */
function spawnDashboard(farmDir: string, stateDir: string, configDir: string): DashboardHandle {
  // reason: randomized high range — minimizes collision with any other concurrent
  // worktree suite's ports on this machine (standing lesson: serialize/avoid fixed
  // ports across concurrent runs).
  const apiPort = 21000 + Math.floor(Math.random() * 4000);
  const dashPort = apiPort + 1;

  const proc = Bun.spawn(
    [
      LORE_BIN,
      "dashboard",
      "--dev",
      "--no-open",
      "--api-port",
      String(apiPort),
      "--dashboard-port",
      String(dashPort),
    ],
    {
      cwd: farmDir,
      env: {
        ...process.env,
        HOME: farmDir,
        LORE_STATE_HOME: stateDir,
        LORE_CONFIG_HOME: configDir,
        CLAUDECODE: "1",
      },
      stdout: "ignore",
      stderr: "ignore",
    },
  );

  return { proc, apiPort, dashPort };
}

/**
 * Minimum plausible wall time for one full spawn -> ready -> descendant-appear -> signal
 * -> descendant-gone -> port-free cycle against the REAL `--dev` Vite topology.
 *
 * Anti-false-oracle guard (task-skill-test-f5a-restore-dashboard-sigterm-test-to-dev): the
 * T3 implementer observed this exact file intermittently reporting "2 pass 0 fail" in
 * ~2 SECONDS TOTAL (both scenarios combined) — far too fast to have spawned a real Vite
 * dev server, polled for it, signaled it, and polled again for its exit. `bun run --filter
 * @lore/dashboard dev` alone (before Vite even starts pre-bundling) reliably costs real
 * wall time (workspace-filter resolution + process fork/exec), so a scenario that genuinely
 * short-circuited (e.g. a packaged-mode-style zero-descendant run) would return in single-
 * digit-to-low-double-digit ms, not hundreds. Measured across repeated genuine `--dev` runs
 * on this machine, per-scenario wall time ranged ~900ms–2.6s (SIGTERM: 905ms–2586ms; SIGINT:
 * 1155ms–1184ms) — this floor is set well below that observed range (not at its low end) to
 * avoid flaking on faster hardware/less-contended runs while still catching a genuinely
 * skipped polling path. The PRIMARY non-flaky proof that the polling path executed is the
 * explicit `descendantsBeforeSignal.length` assertion below (it cannot pass without a real
 * live descendant PID existing); this wall-time check is a secondary belt-and-suspenders
 * guard, logged unconditionally so `bun test` output always reports the observed time.
 */
const MIN_PLAUSIBLE_SCENARIO_MS = 300;

/** Runs one full spawn -> ready -> signal -> assert-teardown cycle. Shared by both tests. */
async function runSignalTeardownScenario(signal: "SIGTERM" | "SIGINT"): Promise<void> {
  const scenarioStart = Date.now();
  const farmDir = makeProjectRootFarm();
  const stateDir = mkdtempSync(join(tmpdir(), `lore-dashboard-${signal.toLowerCase()}-state-`));
  const configDir = mkdtempSync(join(tmpdir(), `lore-dashboard-${signal.toLowerCase()}-config-`));

  let proc: ReturnType<typeof Bun.spawn> | undefined;
  try {
    initCorpus(farmDir);
    const handle = spawnDashboard(farmDir, stateDir, configDir);
    proc = handle.proc;
    const { apiPort, dashPort } = handle;

    try {
      const apiReady = await waitUntil(() => isApiHealthy(apiPort), 20_000, 200);
      expect(apiReady).toBe(true);

      // reason: the HTTP server (and its /health route) comes up before the Vite child
      // finishes spawning — give the child a moment to actually exist before snapshotting
      // the descendant tree, or the snapshot could be empty even on a correctly-running
      // dashboard (a false pass on the "every descendant gone" assertion below).
      const descendantsAppeared = await waitUntil(() => descendantPids(proc!.pid).length > 0, 15_000, 200);
      expect(descendantsAppeared).toBe(true);
      const descendantsBeforeSignal = descendantPids(proc.pid);
      // Explicit descendant-COUNT assertion (not just the boolean poll result above) — the
      // `--dev` topology's real `bun run --filter @lore/dashboard dev` process (and,
      // transitively, the further `vite` child it spawns) must show up as ≥1 tracked PID,
      // or there is nothing for the SIGTERM/SIGINT teardown assertions below to prove.
      expect(descendantsBeforeSignal.length).toBeGreaterThan(0);

      proc.kill(signal);
      await proc.exited;

      const descendantsGone = await waitUntil(
        () => descendantsBeforeSignal.every((pid) => !isAlive(pid)),
        15_000,
        200,
      );
      expect(descendantsGone).toBe(true);

      const apiPortFree = await waitUntil(() => isPortFree(apiPort), 15_000, 200);
      const dashPortFree = await waitUntil(() => isPortFree(dashPort), 15_000, 200);
      expect(apiPortFree).toBe(true);
      expect(dashPortFree).toBe(true);

      // Anti-false-oracle guard — see MIN_PLAUSIBLE_SCENARIO_MS's doc comment. Logged
      // unconditionally (visible in `bun test` output for evidence) and asserted so a
      // future regression that silently short-circuits the polling above fails LOUD
      // instead of reporting a suspiciously fast green.
      const scenarioElapsedMs = Date.now() - scenarioStart;
      console.log(`[dashboard-sigterm] ${signal} scenario wall time: ${scenarioElapsedMs}ms`);
      expect(scenarioElapsedMs).toBeGreaterThan(MIN_PLAUSIBLE_SCENARIO_MS);
    } finally {
      // Reap any straggler descendant regardless of test outcome.
      for (const pid of descendantPids(proc.pid)) {
        try {
          process.kill(pid, "SIGKILL");
        } catch {
          /* already gone */
        }
      }
      if (!proc.killed) {
        try {
          proc.kill("SIGKILL");
        } catch {
          /* already gone */
        }
      }
    }
  } finally {
    for (const dir of [farmDir, stateDir, configDir]) {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        /* best-effort cleanup */
      }
    }
  }
}

// ─── Test suite ───────────────────────────────────────────────────────────────

describe("AC-3: lore dashboard SIGTERM/SIGINT teardown (compiled binary)", () => {
  afterEach(() => {
    // no shared mutable state between tests — each scenario is fully self-contained.
  });

  it(
    "HAPPY: SIGTERM kills every descendant process and releases both ports within a bounded window",
    async () => {
      await runSignalTeardownScenario("SIGTERM");
    },
    45_000,
  );

  it(
    "REGRESSION: SIGINT still tears down identically (pre-existing behavior unchanged)",
    async () => {
      await runSignalTeardownScenario("SIGINT");
    },
    45_000,
  );
});
