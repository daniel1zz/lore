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
 * Source: SPEC-022 §9.7, SPEC-016 §3.6-§3.9.
 */

import { spawn, execFileSync, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
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
  const tmpDir = mkdtempSync(join(tmpdir(), "lore-e2e-"));

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
