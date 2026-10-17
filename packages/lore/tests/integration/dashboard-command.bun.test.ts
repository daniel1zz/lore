// @spawns dist/lore
// @spawns packages/lore/src/index.ts
/**
 * TDD-RED suite for `lore dashboard`'s packaged-mode default flip (DD-5, AC-F5A-5).
 * Paired-Impl: "[Skill:implement] F5a lore dashboard packaged-mode default flip"
 * (task-skill-implement-f5a-lore-dashboard-packaged-mode-default-flip).
 *
 * Every scenario below is EXPECTED TO FAIL against the CURRENT `commands/dashboard.ts`:
 * that file unconditionally spawns a Vite dev-server child and blocks — there is no
 * `--dev` flag, no packaged-mode default, no DD-1 asset-availability guard, and no
 * stdout handshake. The paired implementation task must make these RED, then GREEN.
 *
 * Spawn strategy: the CLI is run FROM SOURCE (`bun <worktree>/packages/lore/src/index.ts
 * dashboard ...`), never the compiled `dist/lore` binary — this suite intentionally never
 * runs `bun run build`, because "no built dashboard assets" is exactly the precondition
 * AC-F5A-5 describes. `cwd` is always a throwaway `mkdtemp` corpus this suite `lore
 * init`s itself — NEVER this repo's own `.lore/` (root CLAUDE.md pollution-incident
 * rule). Because that throwaway corpus dir is NOT a Bun workspace root (no `packages/`,
 * no `bun.lock`), the current implementation's `bun run --filter @lore/dashboard dev`
 * spawn attempt fails fast with "No packages matched the filter" instead of genuinely
 * blocking for 15s — this is a welcome, deterministic side effect of the exact cwd the
 * task bundle prescribes, not a workaround; it does not change what each scenario proves
 * (see each `it()`'s own comment for the precise RED reason). Every spawn still carries a
 * hard `timeout` + `killSignal: "SIGTERM"` (Context Digest requirement) as a defensive
 * backstop in case a future edit to this file, or an unexpected environment, resurrects a
 * real block — a timeout hit is itself reported as a RED failure, never a silent hang.
 *
 * Isolation: `HOME`, `LORE_STATE_HOME`, `LORE_CONFIG_HOME` are all redirected into the
 * throwaway fixture tree per test (mirrors `tests/integration/cli/dashboard-sigterm.bun
 * .test.ts`) so the machine-scope dashboard-auth store and `~/.config/lore/config.yaml`
 * are never touched. Ports are randomized per test in a high, non-default range (never
 * 8787 / 5173) to avoid colliding with any other concurrent worktree suite on this
 * machine.
 *
 * Seams this task DEFINES for the paired implementation to consume (or deliberately
 * replace with an equivalent — the binding contract is the marker FORMAT, not the env
 * var name):
 *   - `LORE_DASHBOARD_ASSETS_FIXTURE=1` — hermetic "pretend packaged assets are
 *     available" signal for the "handshake" scenario. The current CLI does not read this
 *     env var at all, so this scenario is RED-BY-MISSING-SEAM: it pins the stdout
 *     handshake marker format (`LORE_DASHBOARD_URL=<nonce-url>`, DD-2's
 *     `/auth/bootstrap?nonce=<n>` shape) the implementation must emit before blocking,
 *     however it chooses to simulate asset availability.
 *   - `LORE_DASHBOARD_ASSETS_FIXTURE=0` — the complementary "pretend packaged assets are
 *     NOT available" signal, added for task-skill-test-f5a-source-run-guard-test-must-
 *     control-its-own. The "source-run guard" scenario below asserts the unavailable-
 *     assets exit path, but on a checkout where `bun run build` has already produced
 *     `packages/lore/src/generated/dashboard-assets.ts`, the real loader would find real
 *     assets and the guard would never fire — the scenario would then silently observe
 *     the WRONG branch instead of failing loud. This seam makes the precondition
 *     deterministic in both environments: `=0` forces `resolveAssets` to report
 *     unavailable regardless of ambient build state (see `commands/dashboard.ts::
 *     resolveAssets`'s own doc comment for why this can never affect a real user's
 *     packaged launch — the branch is opt-in-only, unreachable unless a caller explicitly
 *     sets this exact value).
 *   - `LORE_DASHBOARD_DEBUG_ALLOWLIST=1` — debug-log signal for the "dev retention"
 *     scenario, pinning the marker format `LORE_DASHBOARD_ALLOWLIST=<json array of
 *     origin strings>`. RED-BY-MISSING-SEAM: `--dev` is not even a recognized flag today
 *     (citty exits 2, "Unknown option: --dev"), so no such line can appear.
 *
 * @spec_ref spec-dashboard-production-packaging-one-command-lore-dashboard DD-5, AC-F5A-5
 * @spec_ref task-skill-test-f5a-cli-packaged-mode-red-scenarios
 * @spec_ref task-skill-test-f5a-source-run-guard-test-must-control-its-own
 *
 * ─── AC-F5A-9 addendum (RED, task-red-failing-tests-for-no-open-suppression-nonce-
 * failure) — "--no-open honours the flag by suppressing the browser opener" ───────────
 *
 * `citty@0.1.6`'s bundled mri parser (`node_modules/citty/dist/index.mjs:170`) rewrites
 * ANY `--no-X` token into `out[X] = false`, so the literal key `"no-open"` never exists in
 * `args` — both `runPackagedMode` (`commands/dashboard.ts:329`) and `runDevMode` (:650) read
 * `args["no-open"]`, get `undefined`, and open the browser unconditionally. The scenario
 * below does NOT assert on parsed argv (that would encode the bug as the expectation) — it
 * intercepts the actual OPENER process via a `PATH`-shimmed `open` executable that appends
 * its argv to a log file, exactly like the reproduction that found this defect. Unlike every
 * other scenario in this file (which deliberately runs FROM SOURCE to exercise the
 * "assets-not-built" precondition), this scenario spawns the COMPILED `dist/lore` binary
 * against a real embedded manifest (`bun run build` must have run first —
 * `assertFreshBinary` fails loud otherwise) — packaged mode's browser-open call site is only
 * reachable once assets actually resolve as available, and `LORE_DASHBOARD_ASSETS_FIXTURE`
 * is a from-source-only seam this scenario has no need for.
 *
 * @spec_ref spec-dashboard-production-packaging-one-command-lore-dashboard AC-F5A-9
 * @spec_ref task-red-failing-tests-for-no-open-suppression-nonce-failure
 */

import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { tmpdir } from "os";
import { assertFreshBinary } from "./helpers/assert-fresh-binary";

// ─── Paths ──────────────────────────────────────────────────────────────────

// tests/integration/ -> tests/ -> packages/lore/ (this file's own package root).
const PACKAGE_ROOT = new URL("../../", import.meta.url).pathname.replace(/\/$/, "");
const INDEX_TS = join(PACKAGE_ROOT, "src", "index.ts");
// packages/lore/ -> packages/ -> repo root (2 levels up from PACKAGE_ROOT).
const REPO_ROOT = dirname(dirname(PACKAGE_ROOT));
const DIST_LORE = join(REPO_ROOT, "dist", "lore");

// ─── Types ──────────────────────────────────────────────────────────────────

interface RunResult {
  readonly exitCode: number | null;
  readonly signalCode: string | null;
  readonly stdout: string;
  readonly stderr: string;
  /** True iff the bounded spawn timeout fired (process was killed, not a natural exit). */
  readonly timedOut: boolean;
}

interface Fixture {
  readonly corpusDir: string;
  readonly stateDir: string;
  readonly configDir: string;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/** A random port in a high, non-default range — never 8787 (api) or 5173 (vite default). */
function randomPort(): number {
  return 24000 + Math.floor(Math.random() * 5000);
}

/**
 * Builds a throwaway corpus + isolated machine-scope state/config dirs, and `lore init`s
 * the corpus. Never touches this repo's own `.lore/`, the real machine dashboard-auth
 * store, or the real `~/.config/lore/config.yaml`.
 */
function makeFixture(): Fixture {
  const corpusDir = mkdtempSync(join(tmpdir(), "lore-dashboard-cmd-corpus-"));
  const stateDir = mkdtempSync(join(tmpdir(), "lore-dashboard-cmd-state-"));
  const configDir = mkdtempSync(join(tmpdir(), "lore-dashboard-cmd-config-"));

  const initResult = Bun.spawnSync(["bun", INDEX_TS, "init"], {
    cwd: corpusDir,
    env: { ...process.env, HOME: corpusDir, LORE_STATE_HOME: stateDir, LORE_CONFIG_HOME: configDir, CLAUDECODE: "1" },
    timeout: 15_000,
    killSignal: "SIGTERM",
    maxBuffer: 4 * 1024 * 1024,
  });
  if (initResult.exitCode !== 0) {
    throw new Error(`lore init failed (fixture setup): ${initResult.stderr.toString()}`);
  }

  return { corpusDir, stateDir, configDir };
}

function cleanupFixture(fixture: Fixture): void {
  for (const dir of [fixture.corpusDir, fixture.stateDir, fixture.configDir]) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* best-effort cleanup */
    }
  }
}

/**
 * True iff a NEW listener can bind `port` on 127.0.0.1 (i.e. nothing else holds it).
 * Mirrors `tests/integration/cli/dashboard-sigterm.bun.test.ts`'s helper of the same name.
 */
function isPortFree(port: number): boolean {
  try {
    const listener = Bun.listen({ hostname: "127.0.0.1", port, socket: { data() {} } });
    listener.stop(true);
    return true;
  } catch {
    return false;
  }
}

/**
 * Runs `bun <INDEX_TS> dashboard --no-open ...args` from source against `fixture`, with a
 * hard bound so the CURRENT blocking implementation can never hang this suite. Exit code
 * is read directly off the `spawnSync` result (never through a shell pipe) per this
 * task's AC.
 */
function runDashboard(
  args: string[],
  fixture: Fixture,
  envExtra: Record<string, string> = {},
  timeoutMs = 15_000,
): RunResult {
  const result = Bun.spawnSync(["bun", INDEX_TS, "dashboard", "--no-open", ...args], {
    cwd: fixture.corpusDir,
    env: {
      ...process.env,
      HOME: fixture.corpusDir,
      LORE_STATE_HOME: fixture.stateDir,
      LORE_CONFIG_HOME: fixture.configDir,
      CLAUDECODE: "1",
      ...envExtra,
    },
    timeout: timeoutMs,
    killSignal: "SIGTERM",
    maxBuffer: 4 * 1024 * 1024,
  });

  return {
    exitCode: result.exitCode,
    signalCode: result.signalCode ?? null,
    stdout: result.stdout.toString(),
    stderr: result.stderr.toString(),
    // reason: on a timeout-triggered kill, Bun's spawnSync reports exitCode === null and
    // signalCode === the killSignal we passed ("SIGTERM") — verified empirically (`sleep
    // 5` spawned with `timeout: 500` yields exactly this pair). A process that caught
    // SIGTERM itself and called `process.exit(n)` reports a non-null exitCode and
    // signalCode === null, so this check does not misclassify a graceful signal-triggered
    // shutdown as a hang.
    timedOut: result.exitCode === null && result.signalCode === "SIGTERM",
  };
}

// ─── Cleanup ────────────────────────────────────────────────────────────────

// reason: track every port this suite has bound so `afterEach` can assert (and, if a
// future edit reintroduces a real hang, best-effort reap) any straggler — Context Digest:
// "never leave orphan vite/bun processes". Each test pushes its own ports before spawning.
let portsInUse: number[] = [];

afterEach(() => {
  // Best-effort: kill any process still listening on a port this test used. Under the
  // scenarios below the current implementation always exits before `runDashboard`
  // returns (spawnSync is synchronous), so this is a defensive backstop, not the primary
  // cleanup path.
  for (const port of portsInUse) {
    const lsof = Bun.spawnSync(["lsof", "-ti", `tcp:${port}`], { timeout: 3_000 });
    const pids = lsof.stdout
      .toString()
      .trim()
      .split("\n")
      .filter((s) => s !== "")
      .map((s) => Number.parseInt(s, 10))
      .filter((n) => Number.isFinite(n));
    for (const pid of pids) {
      try {
        process.kill(pid, "SIGKILL");
      } catch {
        /* already gone */
      }
    }
  }
  portsInUse = [];
});

// ─── Scenario 1: source-run guard (AC-F5A-5) ───────────────────────────────

describe("source-run guard (AC-F5A-5) — packaged mode without built assets", () => {
  it(
    "exits non-zero naming BOTH 'bun run build' and '--dev'; never mentions vite (no spawn attempt); no residual port listener",
    () => {
      const fixture = makeFixture();
      const apiPort = randomPort();
      const dashPort = apiPort + 1;
      portsInUse.push(apiPort, dashPort);

      try {
        // reason: LORE_DASHBOARD_ASSETS_FIXTURE=0 (task-skill-test-f5a-source-run-guard-
        // test-must-control-its-own) forces resolveAssets's unavailable-assets branch
        // deterministically. Without it this scenario would silently inherit ambient
        // checkout state: on a checkout where `bun run build` has already run,
        // packages/lore/src/generated/dashboard-assets.ts exists, the real loader would
        // find it, packaged mode would start normally and exit 0, and the `not.toBe(0)`
        // assertion below would fail — exactly the attested-on-main failure this task
        // fixes. This precondition must hold identically whether or not that generated
        // file happens to exist in the checkout; see this file's header for the seam
        // contract and `commands/dashboard.ts::resolveAssets` for why the seam cannot
        // leak into a real user's launch.
        const result = runDashboard(
          ["--api-port", String(apiPort), "--dashboard-port", String(dashPort)],
          fixture,
          { LORE_DASHBOARD_ASSETS_FIXTURE: "0" },
        );

        if (result.timedOut) {
          throw new Error(
            "hung: packaged-mode guard did not fire before some blocking call",
          );
        }

        // AC: exit code != 0.
        expect(result.exitCode).not.toBe(0);

        // AC: stderr names BOTH remediation paths.
        expect(result.stderr).toContain("bun run build");
        expect(result.stderr).toContain("--dev");

        // AC: "no vite process is spawned; no silent fallback" — the packaged-mode guard
        // fires BEFORE attempting the vite topology, so its failure output must never
        // mention vite.
        expect(result.stderr.toLowerCase()).not.toContain("vite");

        // No residual listener from this run.
        expect(isPortFree(apiPort)).toBe(true);
        expect(isPortFree(dashPort)).toBe(true);
      } finally {
        cleanupFixture(fixture);
      }
    },
    20_000,
  );
});

// ─── Scenario 2: handshake (AC-F5A-5 / DD-2) ───────────────────────────────

describe("handshake — machine-readable nonce URL on stdout before blocking", () => {
  it(
    "RED-by-missing-seam: no LORE_DASHBOARD_URL=<nonce-url> handshake line is ever emitted",
    () => {
      const fixture = makeFixture();
      const apiPort = randomPort();
      const dashPort = apiPort + 1;
      portsInUse.push(apiPort, dashPort);

      try {
        // reason: LORE_DASHBOARD_ASSETS_FIXTURE=1 is a seam this task DEFINES (see file
        // header) for the paired impl to optionally honor as a hermetic "assets are
        // available" signal. The current CLI reads no such env var — it is passed
        // regardless, to document the intended contract, and has zero effect on today's
        // behavior.
        const result = runDashboard(
          ["--api-port", String(apiPort), "--dashboard-port", String(dashPort)],
          fixture,
          { LORE_DASHBOARD_ASSETS_FIXTURE: "1" },
        );

        if (result.timedOut) {
          throw new Error(
            "hung: current impl blocks (vite topology) — packaged-mode handshake not implemented",
          );
        }

        // AC: stdout emits a parseable handshake line containing the nonce URL, BEFORE
        // blocking. Marker format this task pins: `LORE_DASHBOARD_URL=<url>`, where <url>
        // matches DD-2's one-time nonce redirect shape
        // (`http://localhost:<apiPort>/auth/bootstrap?nonce=<n>`).
        const handshake = /^LORE_DASHBOARD_URL=(\S+)$/m.exec(result.stdout);
        expect(handshake).not.toBeNull();

        // Once the seam exists, the captured URL must actually carry the nonce query
        // param and the resolved apiPort — pinned here so the paired impl can't satisfy
        // the marker with an empty or unrelated value. Unreachable today (handshake is
        // null, the assertion above already failed the test) — documents the full
        // contract for when it is reachable.
        if (handshake !== null) {
          expect(handshake[1]).toContain(`:${apiPort}`);
          expect(handshake[1]).toContain("/auth/bootstrap?nonce=");
        }
      } finally {
        cleanupFixture(fixture);
      }
    },
    20_000,
  );
});

// ─── Scenario 3: dev retention (AC-F5A-5 / DD-3) ───────────────────────────

describe("dev retention — --dev selects the vite-child path and threads the real --dashboard-port", () => {
  it(
    "RED-by-missing-seam: --dev is not a recognized flag; no allowlist debug line names the real dashboard port (never the 5173 literal)",
    () => {
      const fixture = makeFixture();
      const apiPort = randomPort();
      // reason: deliberately far from the 5173 default so a hardcoded-5173 regression
      // would be caught the moment the debug seam exists — this value must show up in the
      // allowlist debug line, and 5173 must not.
      const dashPort = apiPort + 137;
      portsInUse.push(apiPort, dashPort);

      try {
        // reason: LORE_DASHBOARD_DEBUG_ALLOWLIST=1 is a seam this task DEFINES (see file
        // header) for the paired impl to optionally honor: print
        // `LORE_DASHBOARD_ALLOWLIST=<json array of origin strings>` before blocking, under
        // --dev, so the allowlist's actual contents are assertable without a live network
        // probe.
        const result = runDashboard(
          ["--dev", "--api-port", String(apiPort), "--dashboard-port", String(dashPort)],
          fixture,
          { LORE_DASHBOARD_DEBUG_ALLOWLIST: "1" },
        );

        if (result.timedOut) {
          throw new Error(
            "hung: current impl blocks (vite topology) — --dev flag / debug seam not implemented",
          );
        }

        // Today: citty rejects the unrecognized --dev flag outright (exit 2, "Unknown
        // option: --dev") — proof that no vite-child path selection exists yet at all,
        // let alone one that threads the real port into a computed allowlist.
        const debugLine = /LORE_DASHBOARD_ALLOWLIST=(.+)/.exec(result.stdout + result.stderr);
        expect(debugLine).not.toBeNull();

        // Unreachable today (debugLine is null, the assertion above already failed) —
        // documents the full port-threading contract for when the seam lands: the
        // allowlist must contain the REAL --dashboard-port and must NEVER contain the
        // retired 5173 hardcode.
        if (debugLine !== null) {
          const allowlist = JSON.parse(debugLine[1]!) as string[];
          expect(allowlist.some((origin) => origin.includes(String(dashPort)))).toBe(true);
          expect(allowlist.some((origin) => origin.includes("5173"))).toBe(false);
        }
      } finally {
        cleanupFixture(fixture);
      }
    },
    20_000,
  );
});

// ─── Scenario 4: --no-open opener interception (AC-F5A-9, compiled binary) ─────────────
//
// This scenario spawns the COMPILED `dist/lore` binary (packaged mode, the default — no
// `--dev`), never `bun run <INDEX_TS>` — packaged mode needs a REAL embedded assets
// manifest to ever reach the browser-open call site, and `bun run build` (which this
// worktree already ran) is what produces it. `assertFreshBinary` fails loud, before any
// spawn, if the binary is missing or stale relative to source.

/** Executable-`open`-shim fixture: a PATH-prependable dir whose `open` script appends its
 * argv to `logFile` instead of doing anything real. Never trusts parsed argv — this is the
 * actual opener the CLI's `openBrowser()` (`commands/dashboard.ts`) resolves via `PATH`
 * lookup on darwin (`spawn("open", [url], ...)`). */
interface OpenShim {
  readonly shimDir: string;
  readonly logFile: string;
  cleanup(): void;
}

function createOpenShim(): OpenShim {
  const shimDir = mkdtempSync(join(tmpdir(), "lore-no-open-shim-"));
  const logFile = join(shimDir, "open-invocations.log");
  const openScriptPath = join(shimDir, "open");
  writeFileSync(openScriptPath, `#!/bin/sh\necho "OPEN_CALLED args=$*" >> "${logFile}"\n`);
  chmodSync(openScriptPath, 0o755);
  return {
    shimDir,
    logFile,
    cleanup: () => {
      try {
        rmSync(shimDir, { recursive: true, force: true });
      } catch {
        /* best-effort cleanup */
      }
    },
  };
}

/** Reads `logFile`'s content, or `""` if the shim was never invoked (file never created —
 * that is the expected outcome for a correctly-suppressed `--no-open` run). */
function readShimLog(logFile: string): string {
  return existsSync(logFile) ? readFileSync(logFile, "utf8") : "";
}

/**
 * Structural shape this file needs from a `Bun.spawn(...)` result — deliberately NOT
 * `ReturnType<typeof Bun.spawn>`: that utility type resolves the function's generic I/O
 * type parameters to their unconstrained union (not the call site's actual `"pipe"`
 * literals), which widens `.stdout` to `number | ReadableStream | undefined` and breaks
 * every consumer expecting a concrete `ReadableStream`. Declaring variables against this
 * narrower interface instead lets the real `Bun.spawn(...)` call sites (which DO pass
 * literal `stdout: "pipe"` options) infer their own concrete, correctly-typed return value,
 * which then structurally satisfies this interface.
 */
interface DashboardProcessHandle {
  readonly stdout: ReadableStream<Uint8Array>;
  readonly exited: Promise<number>;
  readonly killed: boolean;
  kill(signal?: number | NodeJS.Signals): void;
}

/**
 * Reads `stream` incrementally until `LORE_DASHBOARD_URL=<url>` (packaged mode's
 * machine-readable stdout handshake, written BEFORE the browser-open call and BEFORE the
 * process blocks for SIGINT/SIGTERM) appears, or `timeoutMs` elapses.
 */
async function waitForDashboardHandshake(
  stream: ReadableStream<Uint8Array>,
  timeoutMs: number,
): Promise<{ url: string; stdoutSoFar: string }> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const deadline = Date.now() + timeoutMs;
  try {
    for (;;) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) {
        throw new Error(
          `handshake "LORE_DASHBOARD_URL=" not observed within ${timeoutMs}ms; stdout so far:\n${buffer}`,
        );
      }
      const outcome = await Promise.race([
        reader.read(),
        new Promise<"timeout">((resolve) => setTimeout(() => resolve("timeout"), remaining)),
      ]);
      if (outcome === "timeout") {
        throw new Error(
          `handshake "LORE_DASHBOARD_URL=" not observed within ${timeoutMs}ms; stdout so far:\n${buffer}`,
        );
      }
      const { value, done } = outcome;
      if (done) {
        throw new Error(`process stdout closed before the handshake appeared; stdout so far:\n${buffer}`);
      }
      buffer += decoder.decode(value, { stream: true });
      const match = /^LORE_DASHBOARD_URL=(\S+)$/m.exec(buffer);
      if (match) return { url: match[1]!, stdoutSoFar: buffer };
    }
  } finally {
    reader.releaseLock();
  }
}

/** Sends SIGTERM and waits for exit, escalating to SIGKILL if the process is unresponsive. */
async function killAndWait(proc: DashboardProcessHandle, timeoutMs = 8_000): Promise<void> {
  if (proc.killed) return;
  try {
    proc.kill("SIGTERM");
  } catch {
    /* already gone */
  }
  const exited = await Promise.race([
    proc.exited.then(() => true),
    new Promise<boolean>((resolve) => setTimeout(() => resolve(false), timeoutMs)),
  ]);
  if (!exited) {
    try {
      proc.kill("SIGKILL");
    } catch {
      /* already gone */
    }
    await proc.exited;
  }
}

describe("--no-open honours the flag by suppressing the browser opener (AC-F5A-9, packaged mode, compiled binary)", () => {
  beforeAll(() => {
    assertFreshBinary(DIST_LORE, [join(REPO_ROOT, "packages", "lore", "src"), join(REPO_ROOT, "packages", "core", "src")]);
  });

  it(
    "no-open: --no-open spawns ZERO browser-opener invocations; the control run (same command, no --no-open) spawns exactly ONE — proving the shim itself is live",
    async () => {
      const fixture = makeFixture();
      const suppressedShim = createOpenShim();
      const controlShim = createOpenShim();

      let suppressedProc: DashboardProcessHandle | undefined;
      let controlProc: DashboardProcessHandle | undefined;

      try {
        // ── Suppressed case: --no-open must yield ZERO opener invocations ──────────
        const suppressedPort = randomPort();
        suppressedProc = Bun.spawn(
          [DIST_LORE, "dashboard", "--api-port", String(suppressedPort), "--no-open"],
          {
            cwd: fixture.corpusDir,
            env: {
              ...process.env,
              HOME: fixture.corpusDir,
              LORE_STATE_HOME: fixture.stateDir,
              LORE_CONFIG_HOME: fixture.configDir,
              CLAUDECODE: "1",
              PATH: `${suppressedShim.shimDir}:${process.env.PATH ?? ""}`,
            },
            stdout: "pipe",
            stderr: "pipe",
          },
        );

        const suppressedHandshake = await waitForDashboardHandshake(suppressedProc.stdout, 15_000);
        expect(suppressedHandshake.url).toContain(`:${suppressedPort}`);
        expect(suppressedHandshake.url).toContain("/auth/bootstrap?nonce=");

        // Grace window for the (buggy) opener spawn to have fired and the shim script
        // to have flushed its log line — the real invocation, if it happens, is
        // effectively instantaneous (a trivial shell echo), so this is generous.
        await new Promise((resolve) => setTimeout(resolve, 1_000));

        await killAndWait(suppressedProc);

        const suppressedLog = readShimLog(suppressedShim.logFile);
        // THE assertion: --no-open must suppress the opener entirely. This FAILS against
        // current `commands/dashboard.ts` (both `runPackagedMode`/`runDevMode` read
        // `args["no-open"]`, which citty/mri never populates — see this file's header
        // addendum) — the log instead contains exactly one OPEN_CALLED line, identical to
        // the control case below.
        expect(suppressedLog).toBe("");

        // ── Control case: WITHOUT --no-open, the opener must fire exactly once ─────
        const controlPort = randomPort();
        controlProc = Bun.spawn([DIST_LORE, "dashboard", "--api-port", String(controlPort)], {
          cwd: fixture.corpusDir,
          env: {
            ...process.env,
            HOME: fixture.corpusDir,
            LORE_STATE_HOME: fixture.stateDir,
            LORE_CONFIG_HOME: fixture.configDir,
            CLAUDECODE: "1",
            PATH: `${controlShim.shimDir}:${process.env.PATH ?? ""}`,
          },
          stdout: "pipe",
          stderr: "pipe",
        });

        const controlHandshake = await waitForDashboardHandshake(controlProc.stdout, 15_000);
        expect(controlHandshake.url).toContain(`:${controlPort}`);

        await new Promise((resolve) => setTimeout(resolve, 1_000));

        await killAndWait(controlProc);

        const controlLog = readShimLog(controlShim.logFile);
        const controlInvocations = controlLog
          .split("\n")
          .filter((line) => line.startsWith("OPEN_CALLED"));
        // Proves the shim itself is live and the grace window is sufficient — a
        // "suppressedLog === ''" result above is only meaningful relative to this control
        // actually recording exactly one call.
        expect(controlInvocations.length).toBe(1);
        expect(controlLog).toContain(`:${controlPort}`);
        expect(controlLog).toContain("/auth/bootstrap?nonce=");
      } finally {
        if (suppressedProc !== undefined) await killAndWait(suppressedProc);
        if (controlProc !== undefined) await killAndWait(controlProc);
        suppressedShim.cleanup();
        controlShim.cleanup();
        cleanupFixture(fixture);
      }
    },
    45_000,
  );
});
