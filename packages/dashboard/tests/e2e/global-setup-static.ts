/**
 * Playwright globalSetup for the SINGLE-PROCESS packaged-mode static e2e harness
 * (spec-dashboard-production-packaging-one-command-lore-dashboard DD-6, AC-F5A-1/2/8).
 *
 * Unlike `global-setup.ts` (the `--dev` TWO-process topology: a separate `lore serve`
 * child + a separate `vite dev` child, both spawned by the harness itself), this file
 * spawns exactly ONE process — the COMPILED `dist/lore` binary running
 * `dashboard --no-open`, the same command a human runs. That binary embeds the built
 * dashboard bundle (DD-1) and serves it statically alongside the API in-process. No
 * vite process is ever spawned by this harness — proving that is this suite's own
 * defining property (see `static-serving.static.ts`'s "no vite process" test).
 *
 * Steps:
 *   1. `bun run build` (cwd = repo root) — regenerates `packages/lore/src/generated/
 *      dashboard-assets.ts` and recompiles `dist/lore`. The dashboard (vite) build
 *      sub-step short-circuits on an unchanged content digest (`scripts/build.ts`), so
 *      repeat runs of this harness are cheap even though the final `bun build --compile`
 *      step itself always re-runs (bounded, single-digit seconds) — dist/lore must
 *      reflect whatever `dashboard-assets.ts` was most recently (re)generated.
 *   2. Port guard on 8787 — BEFORE spawning anything (mirrors `global-setup.ts`'s
 *      incident-prevention discipline; see that file's header for the full writeup of
 *      why a squatting server must stop this run, never get raced against).
 *   3. `mkdtemp` throwaway corpus + isolated machine-scope state/config dirs, `dist/lore
 *      init` against the throwaway corpus. NEVER this repo's own `.lore/`.
 *   4. Spawn `dist/lore dashboard --no-open --api-port 8787` (the ONLY process this
 *      harness starts) and scan its stdout for the `LORE_DASHBOARD_URL=<nonce-url>`
 *      handshake line (DD-2) — published via `process.env` for worker/spec files to
 *      consume (Playwright's documented `globalSetup`-runs-before-workers-fork pattern,
 *      same mechanism `global-setup.ts` uses for `LORE_E2E_DB_PATH`).
 *   5. Redeem that ONE nonce immediately (see `FIRST_REDEMPTION_*_ENV_VAR`'s doc comment
 *      for why this must happen here, not inside a spec file) and publish the resulting
 *      status/`Set-Cookie`/`Location` for the "nonce" test group to assert against.
 *
 * Server-identity proof, adapted for this single-process topology: `global-setup.ts`'s
 * `assertServerIsOurs` authenticates with a per-corpus bearer key nothing else could
 * have — packaged mode has no such key (DD-2 replaced bearer bootstrap with the nonce
 * flow entirely). The equivalent proof here is structural rather than a post-hoc probe:
 * this harness does not connect to a DECOUPLED already-answering server the way the
 * two-process harness's `waitFor200` does — it OWNS the process whose `Bun.serve` call
 * must itself successfully bind the port. If a squatter already held 8787 despite the
 * `assertPortFree` pre-check (a race), our own `dist/lore` child's `Bun.serve` call
 * throws synchronously (Bun's documented EADDRINUSE behavior), crashing OUR child
 * process — `waitForHandshake`'s `exit` listener below turns that into a loud
 * globalSetup failure, never a false "connected fine" positive. The nonce URL is only
 * ever read from THIS child's own stdout stream, so a value that reaches the spec files
 * is, by construction, minted by the process we just spawned.
 *
 * Side-effect class: IO (spawns `bun run build` + one child process; writes/removes
 *   mkdtemp directories).
 * Source: spec-dashboard-production-packaging-one-command-lore-dashboard DD-1 DD-2 DD-6;
 *   task-skill-test-f5a-single-process-static-e2e-harness.
 */

import { spawn, execFileSync, type ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createConnection } from "node:net";
import { get as httpGet, type IncomingMessage } from "node:http";
import type { FullConfig } from "@playwright/test";

const __dirname = dirname(fileURLToPath(import.meta.url));
// tests/e2e -> tests -> dashboard -> packages -> <repo root>
const REPO_ROOT = join(__dirname, "..", "..", "..", "..");
const DIST_LORE = join(REPO_ROOT, "dist", "lore");

export const API_PORT = 8787;
/** Vite's default dev port — MUST stay unbound throughout this suite; see the "no vite
 * process" test in `static-serving.static.ts`, this harness's defining property. */
export const VITE_DEV_PORT = 5173;
const API_URL = `http://127.0.0.1:${API_PORT}`;

/** Env var name spec files read to get the ONE nonce URL this run's `dist/lore
 * dashboard` process minted at startup (DD-2 stdout handshake). Published here,
 * BEFORE Playwright forks worker processes, so every worker inherits it
 * (documented Playwright globalSetup pattern — see `global-setup.ts`'s identical use
 * of `LORE_E2E_DB_PATH` for precedent in this same repo). Used by the "nonce" group's
 * REPLAY test (the nonce is already consumed by the time specs run — see the env vars
 * below — so a second GET against this same URL deterministically answers 410). */
export const NONCE_URL_ENV_VAR = "LORE_E2E_STATIC_NONCE_URL";

/**
 * The nonce mint→redeem window in `commands/dashboard.ts::runPackagedMode` is a
 * single-use token with a fixed 60s server-side TTL (`static-serving.ts::
 * DEFAULT_NONCE_TTL_MS`, out of this task's write-scope anchor — not adjustable here).
 * Playwright's own per-invocation overhead (browser engine launch, reporter setup,
 * project/worker dispatch) between `globalSetup` returning and a spec file's first
 * `request.get()` executing is NOT bounded by this harness and, on a loaded machine,
 * can plausibly approach or exceed that TTL (this repo's own standing lesson: "on a
 * busy machine ... spawns starve into timeout cascades" — see root CLAUDE.md). Waiting
 * for a SPEC FILE to perform the "first redemption" would make AC-F5A-2 flaky against
 * exactly that variance, for a reason that has nothing to do with the nonce flow's own
 * correctness.
 *
 * Fix: `globalSetup` itself performs the first redemption, IMMEDIATELY after the
 * handshake line is parsed (sub-millisecond turnaround from mint to consume — no
 * browser or Playwright dispatch overhead is ever on this path) — a real HTTP call
 * against the real spawned server, not a simulation. The result (status, `Set-Cookie`,
 * `Location`) is captured into these env vars for the "nonce" group's first test to
 * assert against; the SEPARATE "replay" test then issues its OWN live GET against
 * `NONCE_URL_ENV_VAR` (now durably "consumed" — `static-serving.ts`'s `consume()`
 * checks `record.consumed` BEFORE it checks expiry, so a replay 410s deterministically
 * regardless of how much wall-clock time has passed since the first redemption).
 */
export const FIRST_REDEMPTION_STATUS_ENV_VAR = "LORE_E2E_STATIC_FIRST_STATUS";
export const FIRST_REDEMPTION_SET_COOKIE_ENV_VAR = "LORE_E2E_STATIC_FIRST_SET_COOKIE";
export const FIRST_REDEMPTION_LOCATION_ENV_VAR = "LORE_E2E_STATIC_FIRST_LOCATION";

/**
 * Raw-TCP-connect probe: does anything already accept connections on `port`?
 * Mirrors `global-setup.ts`'s helper of the same name/behavior. Exported so spec
 * files can re-probe `VITE_DEV_PORT` for the "no vite process" assertion without
 * duplicating the raw-TCP-connect logic.
 */
export async function isPortOpen(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({ port, host: "127.0.0.1" });
    const finish = (result: boolean): void => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(result);
    };
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
    socket.setTimeout(1000, () => finish(false));
  });
}

/**
 * Fail-loud pre-flight: port 8787 must be free before we spawn anything. See this
 * file's header — a squatting `lore dashboard` / `lore serve` must stop this run
 * immediately, not get raced against (incident precedent documented in `global-setup.ts`).
 */
async function assertPortFree(port: number, label: string): Promise<void> {
  if (await isPortOpen(port)) {
    throw new Error(
      `e2e globalSetup(static): port ${port} (${label}) is already in use.\n` +
        `Another lore dashboard / lore serve is running on this port — stop it first ` +
        `(lsof -i :${port}) before running the static e2e suite. Refusing to proceed: a ` +
        `foreign server there could be a real corpus, and this suite must never write ` +
        `into it.`,
    );
  }
}

async function killAndWait(proc: ChildProcess): Promise<void> {
  if (proc.exitCode !== null || proc.killed) return;
  await new Promise<void>((resolve) => {
    proc.once("exit", () => resolve());
    proc.kill("SIGTERM");
    setTimeout(() => {
      if (proc.exitCode === null) proc.kill("SIGKILL");
      resolve();
    }, 3000);
  });
}

/**
 * Scans `child`'s stdout for the DD-2 handshake line `LORE_DASHBOARD_URL=<url>`,
 * printed before packaged mode blocks on shutdown (`commands/dashboard.ts::
 * runPackagedMode`). Rejects if the child exits first (crash / startup failure — e.g.
 * the EADDRINUSE race described in this file's header) or if `timeoutMs` elapses.
 */
async function waitForHandshake(child: ChildProcess, timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    let buf = "";
    let settled = false;

    const settle = (fn: () => void): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.stdout?.off("data", onData);
      child.off("exit", onExit);
      fn();
    };

    const timer = setTimeout(() => {
      settle(() =>
        reject(
          new Error(
            `e2e globalSetup(static): timed out after ${timeoutMs}ms waiting for the ` +
              `LORE_DASHBOARD_URL= handshake line. stdout so far:\n${buf}`,
          ),
        ),
      );
    }, timeoutMs);

    const onData = (chunk: Buffer): void => {
      const text = chunk.toString();
      buf += text;
      process.stderr.write(`[dist/lore dashboard] ${text}`);
      const match = /^LORE_DASHBOARD_URL=(\S+)$/m.exec(buf);
      if (match) {
        settle(() => resolve(match[1]!));
      }
    };

    const onExit = (code: number | null, signal: NodeJS.Signals | null): void => {
      settle(() =>
        reject(
          new Error(
            `e2e globalSetup(static): 'dist/lore dashboard --no-open' exited before the ` +
              `handshake line appeared (code=${String(code)}, signal=${String(signal)}). ` +
              `stdout so far:\n${buf}`,
          ),
        ),
      );
    };

    child.stdout?.on("data", onData);
    child.once("exit", onExit);
  });
}

/**
 * Raw, non-redirect-following GET via `node:http` — deliberately NOT the Fetch API:
 * `fetch(url, { redirect: "manual" })` yields a spec-compliant "opaqueredirect"
 * response whose status/headers are intentionally inaccessible (a browser-security
 * restriction that does not apply here and only gets in the way) — `node:http`'s
 * `get()` never follows redirects on its own and hands back the raw 3xx status +
 * headers directly, which is exactly what confirming the DD-2 302 + Set-Cookie shape
 * requires.
 */
async function httpGetNoRedirect(url: string): Promise<{ status: number; setCookie: string | undefined; location: string | undefined }> {
  return new Promise((resolve, reject) => {
    const req = httpGet(url, (res: IncomingMessage) => {
      res.resume(); // drain body — this call only inspects status/headers
      const setCookieHeader = res.headers["set-cookie"];
      resolve({
        status: res.statusCode ?? 0,
        setCookie: Array.isArray(setCookieHeader) ? setCookieHeader.join("; ") : setCookieHeader,
        location: res.headers.location,
      });
    });
    req.once("error", reject);
    req.setTimeout(5000, () => {
      req.destroy(new Error(`httpGetNoRedirect: timed out GETting ${url}`));
    });
  });
}

export default async function globalSetup(_config: FullConfig): Promise<() => Promise<void>> {
  // 1. Ensure a fresh dashboard build. The vite sub-step short-circuits on an unchanged
  //    content digest (see this file's header) — repeats are cheap.
  process.stderr.write("[e2e globalSetup(static)] Running 'bun run build'...\n");
  execFileSync("bun", ["run", "build"], { cwd: REPO_ROOT, stdio: "inherit" });

  if (!existsSync(DIST_LORE)) {
    throw new Error(
      `e2e globalSetup(static): 'bun run build' completed but ${DIST_LORE} is missing — ` +
        `cannot run the packaged-mode static e2e suite without a compiled binary.`,
    );
  }

  // 2. Port guard — BEFORE spawning anything.
  await assertPortFree(API_PORT, "packaged dist/lore dashboard");

  // 3. Throwaway corpus + isolated machine-scope state/config dirs — same
  //    pollution-incident discipline as `global-setup.ts`: NEVER this repo's own
  //    `.lore/`, NEVER the real machine dashboard-auth store, NEVER the real
  //    `~/.config/lore/config.yaml`.
  const corpusDir = mkdtempSync(join(tmpdir(), "lore-e2e-static-corpus-"));
  const stateDir = mkdtempSync(join(tmpdir(), "lore-e2e-static-state-"));
  const configDir = mkdtempSync(join(tmpdir(), "lore-e2e-static-config-"));
  const isolatedEnv = {
    ...process.env,
    HOME: corpusDir,
    LORE_STATE_HOME: stateDir,
    LORE_CONFIG_HOME: configDir,
    CLAUDECODE: "1",
  };

  const cleanupDirs = (): void => {
    for (const dir of [corpusDir, stateDir, configDir]) {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        // best-effort cleanup — never fail the run over a leftover tmp dir
      }
    }
  };

  try {
    execFileSync(DIST_LORE, ["init", "--author", "e2e-static-runner"], {
      cwd: corpusDir,
      env: isolatedEnv,
      stdio: "pipe",
    });
  } catch (err) {
    cleanupDirs();
    throw new Error(`e2e globalSetup(static): 'dist/lore init' failed: ${String(err)}`);
  }

  // 4. Spawn the packaged server — the ONLY process this harness ever starts.
  const serverProc = spawn(DIST_LORE, ["dashboard", "--no-open", "--api-port", String(API_PORT)], {
    cwd: corpusDir,
    stdio: ["ignore", "pipe", "pipe"],
    env: isolatedEnv,
  });
  serverProc.stderr?.on("data", (chunk: Buffer) => {
    process.stderr.write(`[dist/lore dashboard] ${chunk.toString()}`);
  });

  let nonceUrl: string;
  try {
    nonceUrl = await waitForHandshake(serverProc, 30_000);
  } catch (err) {
    await killAndWait(serverProc);
    cleanupDirs();
    throw err;
  }

  // Sanity: confirm something now actually answers on API_PORT before handing off to
  // the spec files (a genuine 200 here, from the process we just spawned and whose
  // stdout we just parsed, is a much cheaper signal than waiting for the first spec's
  // own request to discover a startup problem).
  try {
    const res = await fetch(`${API_URL}/health`, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) throw new Error(`unexpected status ${res.status}`);
  } catch (err) {
    await killAndWait(serverProc);
    cleanupDirs();
    throw new Error(
      `e2e globalSetup(static): handshake line appeared but ${API_URL}/health did not ` +
        `respond 200: ${String(err)}`,
    );
  }

  process.env[NONCE_URL_ENV_VAR] = nonceUrl;

  // Redeem the ONE minted nonce NOW — see FIRST_REDEMPTION_*_ENV_VAR's doc comment for
  // why this must happen here (sub-millisecond mint-to-consume turnaround) rather than
  // inside a spec file (which would race Playwright's own browser-launch/dispatch
  // overhead against the server's fixed 60s nonce TTL).
  try {
    const redemption = await httpGetNoRedirect(nonceUrl);
    process.env[FIRST_REDEMPTION_STATUS_ENV_VAR] = String(redemption.status);
    process.env[FIRST_REDEMPTION_SET_COOKIE_ENV_VAR] = redemption.setCookie ?? "";
    process.env[FIRST_REDEMPTION_LOCATION_ENV_VAR] = redemption.location ?? "";
  } catch (err) {
    await killAndWait(serverProc);
    cleanupDirs();
    throw new Error(`e2e globalSetup(static): first nonce redemption failed: ${String(err)}`);
  }

  return async function globalTeardown(): Promise<void> {
    await killAndWait(serverProc);
    cleanupDirs();
  };
}
