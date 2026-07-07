/**
 * Playwright globalSetup — boots a throwaway Lore corpus + real HTTP server + real Vite
 * dev server, exactly the way `lore dashboard` does, so the SPEC-022 write-flow e2e
 * suite drives the actual browser bootstrap (cookie-session) path end to end.
 *
 * Deliberate design choice (documented per task instructions): we do NOT shell out to
 * the `lore dashboard` CLI command itself, because that command spawns its Vite child
 * via `bun run --filter '@lore/dashboard' dev`, which requires `cwd` to be inside the
 * Bun workspace root so `--filter` can resolve the package. Since the throwaway corpus
 * directory lives outside the monorepo (a fresh OS tmpdir, to guarantee we never touch
 * the real team `.lore/`), `--filter` resolution would fail if `cwd` were the throwaway
 * dir. Instead we reproduce the same two-process topology `lore dashboard` uses
 * (SPEC-016 §3.6) ourselves:
 *   1. `bun <repo>/packages/lore/src/index.ts init`      (cwd = throwaway dir)
 *   2. `bun <repo>/packages/lore/src/index.ts agent create dashboard-local --json`
 *      (cwd = throwaway dir) — captures the raw API key exactly like
 *      `ensureLocalApiKey` would write to `.lore/local-key`.
 *   3. `bun <repo>/packages/lore/src/index.ts serve --port 8787` (cwd = throwaway dir)
 *      — the real HTTP server, same code path as `lore serve` / `lore dashboard`.
 *   4. `bun run dev -- --port 5173` (cwd = packages/dashboard) with
 *      `VITE_LORE_BOOTSTRAP_TOKEN=<rawKey>` in the child's env — the real Vite dev
 *      server, so the `lore-bootstrap-token` plugin (vite.config.ts) inlines the token
 *      into `index.html` and the SPA's `bootstrapAuthIfNeeded()` (src/lib/bootstrap.ts)
 *      exchanges it for a real `lore_sid` HttpOnly cookie on first page load — no
 *      manual cookie minting in the test code.
 *
 * Ports are fixed at 8787 / 5173 deliberately: `vite.config.ts`'s dev proxy target
 * (`/api` → `http://localhost:8787`) and the server's Origin allowlist for
 * `POST /api/auth/local-bootstrap` (`packages/lore/src/adapters/http/auth.ts::ALLOWED_ORIGINS`)
 * are both hardcoded to these two ports — they are implementation source we must not
 * modify, so the harness matches them instead of trying to parameterize.
 *
 * Incident (documented so the guard below is never "cleaned up" as dead code): a stale
 * `lore dashboard` process serving the REAL team `.lore/` corpus was already squatting
 * port 8787 when this suite ran. This harness's own `lore serve` child died on
 * EADDRINUSE, but `waitFor200` doesn't care WHO answers — the squatter answered `/health`
 * with 200 just fine, so the entire write-path e2e suite ran against the real team
 * corpus, polluting it with 4 docs and corrupting `.lore/export-index.json` numbering.
 * Two independent guards now prevent a repeat:
 *   1. `assertPortFree` — probes both fixed ports with a raw TCP connect BEFORE spawning
 *      anything. If either already accepts connections, we throw immediately. We never
 *      kill the foreign process automatically — it may be someone's live corpus server,
 *      exactly the thing this suite must never write into.
 *   2. `assertServerIsOurs` — even a clean port-free start doesn't fully rule out a race
 *      (something else binds the port between our probe and our spawn), so after our
 *      own `lore serve` child starts and passes `/health`, we additionally authenticate
 *      against it using the `dashboard-local` API key we JUST created against the
 *      throwaway corpus. That raw key's SHA-256 hash exists in exactly one `api_keys`
 *      table on the filesystem — the throwaway tmpdir's. A foreign server (backed by a
 *      different `.lore/lore.db`) has never seen this hash and will answer `401`, not
 *      `200`. This is cheaper than diffing doc counts (no seed-count coupling to
 *      maintain) and strictly stronger than trusting `/health` (which is intentionally
 *      unauthenticated and answers identically for every corpus).
 *
 * Source: SPEC-022 §9.7, SPEC-016 §3.6-§3.9.
 */

import { spawn, execFileSync, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createConnection } from "node:net";
import type { FullConfig } from "@playwright/test";

const __dirname = dirname(fileURLToPath(import.meta.url));
// tests/e2e -> tests -> dashboard -> packages -> <repo root>
const REPO_ROOT = join(__dirname, "..", "..", "..", "..");
const LORE_ENTRY = join(REPO_ROOT, "packages", "lore", "src", "index.ts");
const DASHBOARD_DIR = join(REPO_ROOT, "packages", "dashboard");

export const API_PORT = 8787;
export const DASH_PORT = 5173;
const API_URL = `http://127.0.0.1:${API_PORT}`;
const DASH_URL = `http://localhost:${DASH_PORT}`;

async function waitFor200(url: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastErr: unknown;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(1500) });
      if (res.ok) return;
    } catch (err) {
      lastErr = err;
    }
    await new Promise<void>((r) => setTimeout(r, 250));
  }
  throw new Error(`Timed out waiting for ${url} to return 200: ${String(lastErr)}`);
}

/**
 * Raw-TCP-connect probe: does anything already accept connections on `port`?
 * Deliberately lower-level than an HTTP fetch — a squatter need not even speak HTTP
 * for this to detect it, and it resolves in milliseconds instead of a request timeout.
 */
async function isPortOpen(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({ port, host: "127.0.0.1" });
    const finish = (result: boolean): void => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(result);
    };
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
    // Safety bound: a hung connect attempt (e.g. firewalled port) must not stall setup.
    socket.setTimeout(1000, () => finish(false));
  });
}

/**
 * Fail-loud pre-flight: BOTH fixed ports (8787 API, 5173 Vite) must be free before we
 * spawn anything. See the incident writeup in this file's header comment — a squatting
 * `lore serve` / `vite` process must stop this run immediately, not get raced against.
 */
async function assertPortFree(port: number, label: string): Promise<void> {
  if (await isPortOpen(port)) {
    throw new Error(
      `e2e globalSetup: port ${port} (${label}) is already in use.\n` +
        `Another lore serve / vite dev server is running on this port — stop it first ` +
        `(lsof -i :${port}) before running the e2e suite. Refusing to proceed: a foreign ` +
        `server there could be a real team corpus, and writing into it is exactly the ` +
        `incident this guard exists to prevent.`,
    );
  }
}

/**
 * Confirms the server now answering on API_PORT is OUR freshly-spawned `lore serve`
 * against the throwaway corpus, not a squatter that raced our port-free probe.
 *
 * reason: `rawKey`'s SHA-256 hash was just inserted into the throwaway tmpdir's
 * `api_keys` table by step 2 (`lore agent create`) and exists nowhere else. Bearer-
 * authenticating `GET /api/auth/me` with it is the cheapest strong check available in
 * the existing API surface: a foreign server (backed by a different `.lore/lore.db`)
 * has never seen this hash and MUST answer 401, whereas our own server MUST answer 200
 * with `name: "dashboard-local"`. This is strictly stronger than re-probing `/health`,
 * which is intentionally unauthenticated (SPEC-016) and answers identically no matter
 * whose corpus is behind it.
 */
async function assertServerIsOurs(apiUrl: string, rawKey: string): Promise<void> {
  let body: { ok: boolean; data?: { name?: string } } | undefined;
  try {
    const res = await fetch(`${apiUrl}/api/auth/me`, {
      headers: { Authorization: `Bearer ${rawKey}` },
      signal: AbortSignal.timeout(3000),
    });
    body = (await res.json()) as typeof body;
    if (res.ok && body?.ok === true && body.data?.name === "dashboard-local") return;
  } catch (err) {
    throw new Error(
      `e2e globalSetup: server identity check against ${apiUrl}/api/auth/me failed to ` +
        `complete: ${String(err)}. Refusing to proceed — cannot confirm this is our ` +
        `throwaway corpus server, not a squatter.`,
    );
  }
  throw new Error(
    `e2e globalSetup: server identity check FAILED — ${apiUrl} did not accept our ` +
      `freshly-created 'dashboard-local' API key (response: ${JSON.stringify(body)}). ` +
      `This means something other than our own 'lore serve' child is answering on port ` +
      `${API_PORT} — almost certainly a squatter serving a different corpus (see the ` +
      `incident writeup in this file's header). Refusing to run the write-path suite ` +
      `against it.`,
  );
}

/** Extract the last JSON-parseable line from CLI stdout (skips warnings printed above it). */
function parseLastJsonLine(stdout: string): unknown {
  const lines = stdout.split("\n").map((l) => l.trim()).filter((l) => l.length > 0);
  for (let i = lines.length - 1; i >= 0; i--) {
    try {
      return JSON.parse(lines[i]!);
    } catch {
      // keep scanning upward — earlier lines may be warnings, not JSON
    }
  }
  throw new Error(`No JSON line found in CLI output:\n${stdout}`);
}

async function killAndWait(proc: ChildProcess): Promise<void> {
  if (proc.exitCode !== null || proc.killed) return;
  await new Promise<void>((resolve) => {
    proc.once("exit", () => resolve());
    proc.kill("SIGTERM");
    // Fallback hard-kill if the child ignores SIGTERM.
    setTimeout(() => {
      if (proc.exitCode === null) proc.kill("SIGKILL");
      resolve();
    }, 3000);
  });
}

export default async function globalSetup(_config: FullConfig): Promise<() => Promise<void>> {
  // 0. Port guard — BEFORE spawning anything. Fail loud, never kill-and-retry: see the
  //    incident writeup in this file's header comment.
  await assertPortFree(API_PORT, "lore serve API");
  await assertPortFree(DASH_PORT, "vite dev server");

  const tmpDir = mkdtempSync(join(tmpdir(), "lore-e2e-"));

  // Publish the throwaway corpus's SQLite path via env var so spec files that need to
  // seed data the UI cannot create (e.g. SPEC-034 review judgments — no UI writes
  // `review_judgments` directly) can open the SAME db file with their own SQLiteStore
  // instance. `globalSetup` runs in Playwright's main process BEFORE worker processes
  // are forked, so a `process.env` write here is inherited by every worker (documented
  // Playwright globalSetup pattern) — no IPC/tempfile plumbing needed.
  process.env.LORE_E2E_DB_PATH = join(tmpDir, ".lore", "lore.db");

  // 1. Init a throwaway corpus — never the real team `.lore/`.
  execFileSync("bun", [LORE_ENTRY, "init", "--author", "e2e-runner"], {
    cwd: tmpDir,
    stdio: "pipe",
  });

  // 2. Create the "dashboard-local" API key exactly as `ensureLocalApiKey` would,
  //    and capture the raw key so we can inject it as VITE_LORE_BOOTSTRAP_TOKEN.
  const createOut = execFileSync(
    "bun",
    [LORE_ENTRY, "agent", "create", "--name", "dashboard-local", "--owner", "admin", "--json"],
    { cwd: tmpDir, stdio: "pipe" },
  ).toString();
  const created = parseLastJsonLine(createOut) as {
    ok: boolean;
    data?: { api_key: string };
    error?: unknown;
  };
  if (!created.ok || created.data === undefined) {
    throw new Error(`Failed to create dashboard-local API key: ${JSON.stringify(created)}`);
  }
  const rawKey = created.data.api_key;

  // 3. Start the real HTTP API server against the throwaway corpus.
  const apiProc = spawn(
    "bun",
    [LORE_ENTRY, "serve", "--port", String(API_PORT), "--host", "127.0.0.1"],
    { cwd: tmpDir, stdio: ["ignore", "pipe", "pipe"] },
  );
  apiProc.stdout?.on("data", () => {});
  apiProc.stderr?.on("data", (chunk: Buffer) => {
    process.stderr.write(`[lore serve] ${chunk.toString()}`);
  });

  try {
    await waitFor200(`${API_URL}/health`, 20_000);
    // reason: /health alone cannot distinguish us from a squatter that raced our port
    // probe (assertPortFree) between the check and this spawn — it's intentionally
    // unauthenticated and answers identically for every corpus. assertServerIsOurs is
    // the strong check: only OUR throwaway corpus's api_keys table has this hash.
    await assertServerIsOurs(API_URL, rawKey);
  } catch (err) {
    await killAndWait(apiProc);
    rmSync(tmpDir, { recursive: true, force: true });
    throw err;
  }

  // 4. Start the real Vite dev server with the bootstrap token injected via env —
  //    same mechanism `lore dashboard` uses (SPEC-016 §3.6, §3.7).
  const viteProc = spawn(
    "bun",
    ["run", "dev", "--", "--port", String(DASH_PORT), "--strictPort"],
    {
      cwd: DASHBOARD_DIR,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, VITE_LORE_BOOTSTRAP_TOKEN: rawKey },
    },
  );
  viteProc.stdout?.on("data", () => {});
  viteProc.stderr?.on("data", (chunk: Buffer) => {
    process.stderr.write(`[vite] ${chunk.toString()}`);
  });

  try {
    await waitFor200(`${DASH_URL}/`, 30_000);
  } catch (err) {
    await killAndWait(apiProc);
    await killAndWait(viteProc);
    rmSync(tmpDir, { recursive: true, force: true });
    throw err;
  }

  return async function globalTeardown(): Promise<void> {
    await Promise.all([killAndWait(apiProc), killAndWait(viteProc)]);
    try {
      rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // best-effort cleanup — never fail the test run over a leftover tmp dir
    }
  };
}
