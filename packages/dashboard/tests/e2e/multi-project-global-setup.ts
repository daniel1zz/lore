/**
 * Playwright globalSetup for the SPEC-078 T11 multi-project e2e suite
 * (`playwright.multi-project.config.ts`, testMatch `multi-project-*.spec.ts` ONLY).
 *
 * Why a SEPARATE config/globalSetup instead of extending `global-setup.ts` in place:
 * the default suite's `global-setup.ts` boots a REGISTRY-LESS server (`mountRegistry`
 * omitted) because `AC-078-9` needs a genuinely registry-absent environment to prove
 * "the existing single-project suite passes unchanged" AND its own new route-shape pin
 * (added to `browse-ux.pw.ts`) means what it says — a run where `dashboard.projects` is
 * truly absent, not merely unused. This suite needs the OPPOSITE: a REAL populated
 * registry (2 mkdtemp corpora) reachable through real browser navigation. Since
 * `vite.config.ts`'s dev proxy target is hardcoded to `http://localhost:8787`
 * (implementation source this task must not modify — same constraint
 * `global-setup.ts`'s own header names) and Playwright only runs ONE `globalSetup` per
 * process invocation, both environments cannot coexist within a single `bunx playwright
 * test` run. Two independent, non-overlapping-in-time invocations — this config for the
 * 3 `multi-project-*.spec.ts` files, the default config for everything else — is the
 * only way to get REAL registry-populated browser e2e coverage without editing
 * `playwright.config.ts`/`vite.config.ts` (both outside this task's declared anchor,
 * `packages/dashboard/tests/e2e/`). Ports 8787/5173 are REUSED (not distinct) precisely
 * because the proxy target is fixed — this suite must never run CONCURRENTLY with the
 * default suite (root CLAUDE.md standing lesson: "Serialize Playwright suites against a
 * fixed dev-server port"); `assertPortFree` below fails loud if anything is already
 * listening, the same guard `global-setup.ts` uses.
 *
 * Boots ONE server (`multi-project-server.ts`) whose TOP-LEVEL (unprefixed) `app` is
 * project A's own corpus and whose `mountRegistry` carries BOTH project-a and
 * project-b, addressable via `/api/p/project-a/*` / `/api/p/project-b/*`. Every auth
 * store (machine-scope AND both per-corpus stores) lives under a fresh `mkdtemp`
 * directory — never the real `~/.local/state`/`~/.config` paths (root CLAUDE.md
 * pollution-incident rule), same discipline `global-setup.ts` follows for the corpus
 * itself.
 *
 * Source: SPEC-078 §Acceptance Criteria AC-078-6/7/8; §Rollout T-order step 6.
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
const SERVER_SCRIPT = join(__dirname, "multi-project-server.ts");
const SEED_SCRIPT = join(__dirname, "seed-multi-project-fixture.ts");
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
    socket.setTimeout(1000, () => finish(false));
  });
}

async function assertPortFree(port: number, label: string): Promise<void> {
  if (await isPortOpen(port)) {
    throw new Error(
      `multi-project e2e globalSetup: port ${port} (${label}) is already in use. This suite ` +
        `must never run concurrently with the default (registry-less) Playwright suite — both ` +
        `bind the SAME fixed ports (vite.config.ts's proxy target is hardcoded to 8787). Stop ` +
        `the other run first (lsof -i :${port}).`,
    );
  }
}

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
    setTimeout(() => {
      if (proc.exitCode === null) proc.kill("SIGKILL");
      resolve();
    }, 3000);
  });
}

interface SeedProjectResult {
  prdId: string;
  prdTitle: string;
  markerTaskId: string;
  markerTaskTitle: string;
  markerContent: string;
}
interface SeedProjectAResult extends SeedProjectResult {
  draftSpecId: string;
  draftSpecTitle: string;
}
interface SeedResult {
  a: SeedProjectAResult;
  b: SeedProjectResult;
}

/**
 * Bearer-authenticates `GET /api/p/:name/api/auth/me` against a project-addressed
 * route — the "assertServerIsOurs" equivalent PER PROJECT (dispatch's explicit ask:
 * "assertServerIsOurs guard authenticated against BOTH corpora"). Distinct from the
 * single-project suite's check in TWO ways: (1) it authenticates via a BEARER key
 * scoped to that project's OWN `apiKeyStore` (D1 — bearer keys stay per-corpus, so the
 * MACHINE-scope "dashboard-local" key does NOT work here), proving the registry entry
 * is not just "some server on this port" but genuinely OUR freshly-mounted App for
 * THAT corpus; (2) reaching it at all (rather than a 404/503) proves the entry
 * actually classified to `"mounted"`, not merely declared in the registry.
 */
async function assertProjectIsOurs(apiUrl: string, projectName: string, rawKey: string): Promise<void> {
  let body: { ok: boolean; data?: { name?: string } } | undefined;
  try {
    const res = await fetch(`${apiUrl}/api/p/${projectName}/api/auth/me`, {
      headers: { Authorization: `Bearer ${rawKey}` },
      signal: AbortSignal.timeout(3000),
    });
    body = (await res.json()) as typeof body;
    if (res.ok && body?.ok === true && body.data?.name === "dashboard-local") return;
  } catch (err) {
    throw new Error(
      `multi-project e2e globalSetup: identity check against ${apiUrl}/api/p/${projectName}/api/auth/me ` +
        `failed to complete: ${String(err)}.`,
    );
  }
  throw new Error(
    `multi-project e2e globalSetup: identity check FAILED for project "${projectName}" — ` +
      `response: ${JSON.stringify(body)}. The registry entry may not have mounted correctly.`,
  );
}

export default async function globalSetup(_config: FullConfig): Promise<() => Promise<void>> {
  await assertPortFree(API_PORT, "lore multi-project server");
  await assertPortFree(DASH_PORT, "vite dev server");

  const runId = String(Date.now());
  const projectARoot = mkdtempSync(join(tmpdir(), "lore-e2e-mp-a-"));
  const projectBRoot = mkdtempSync(join(tmpdir(), "lore-e2e-mp-b-"));
  const machineAuthBaseDir = mkdtempSync(join(tmpdir(), "lore-e2e-mp-machine-"));

  // Publish for spec files that need direct paths (mirrors global-setup.ts's
  // LORE_E2E_DB_PATH pattern).
  process.env.LORE_E2E_MP_PROJECT_A_DB_PATH = join(projectARoot, ".lore", "lore.db");
  process.env.LORE_E2E_MP_PROJECT_B_DB_PATH = join(projectBRoot, ".lore", "lore.db");
  process.env.LORE_E2E_MP_RUN_ID = runId;

  const cleanupTmpDirs = (): void => {
    for (const dir of [projectARoot, projectBRoot, machineAuthBaseDir]) {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        // best-effort
      }
    }
  };

  try {
    // 1. Init both throwaway corpora.
    execFileSync("bun", [LORE_ENTRY, "init", "--author", "e2e-runner"], { cwd: projectARoot, stdio: "pipe" });
    execFileSync("bun", [LORE_ENTRY, "init", "--author", "e2e-runner"], { cwd: projectBRoot, stdio: "pipe" });

    // 2. Seed distinguishable, gate-conformant content into both.
    const seedOut = execFileSync(
      "bun",
      [SEED_SCRIPT, join(projectARoot, ".lore", "lore.db"), join(projectBRoot, ".lore", "lore.db"), runId],
      { stdio: "pipe" },
    ).toString();
    const seed = parseLastJsonLine(seedOut) as SeedResult;
    process.env.LORE_E2E_MP_SEED_JSON = JSON.stringify(seed);

    // 3. Per-corpus bearer keys ("dashboard-local", mirrors global-setup.ts's own
    //    single-project key-creation step) — bearer auth for a project-addressed
    //    route always checks THAT project's OWN apiKeyStore (D1), never the machine
    //    store, so these are independent from the machine dashboard-local key below.
    const createKeyOut = (root: string): string => {
      const out = execFileSync(
        "bun",
        [LORE_ENTRY, "agent", "create", "--name", "dashboard-local", "--owner", "admin", "--json"],
        { cwd: root, stdio: "pipe" },
      ).toString();
      const parsed = parseLastJsonLine(out) as { ok: boolean; data?: { api_key: string } };
      if (!parsed.ok || parsed.data === undefined) {
        throw new Error(`Failed to create per-corpus dashboard-local key at ${root}: ${out}`);
      }
      return parsed.data.api_key;
    };
    const bearerKeyA = createKeyOut(projectARoot);
    const bearerKeyB = createKeyOut(projectBRoot);
    process.env.LORE_E2E_MP_PROJECT_A_BEARER_KEY = bearerKeyA;
    process.env.LORE_E2E_MP_PROJECT_B_BEARER_KEY = bearerKeyB;

    // 4. Start the unified multi-project server: top-level `app` = project A's own
    //    corpus, registry = {project-a, project-b} (see this file's header for why A
    //    doubles as both — the new suite only ever addresses BOTH via `/p/:name`,
    //    never through the unprefixed routes, so the duplication is inert).
    const registryProjects = JSON.stringify([
      { name: "project-a", path: projectARoot },
      { name: "project-b", path: projectBRoot },
    ]);
    const serverProc = spawn(
      "bun",
      [SERVER_SCRIPT, projectARoot, String(API_PORT), "127.0.0.1", machineAuthBaseDir, registryProjects],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    let serverStdout = "";
    serverProc.stdout?.on("data", (chunk: Buffer) => {
      serverStdout += chunk.toString();
    });
    serverProc.stderr?.on("data", (chunk: Buffer) => {
      process.stderr.write(`[multi-project-server] ${chunk.toString()}`);
    });

    try {
      await waitFor200(`${API_URL}/health`, 20_000);
    } catch (err) {
      await killAndWait(serverProc);
      throw err;
    }

    const ready = parseLastJsonLine(serverStdout) as {
      ok: boolean;
      data?: { api_key: string; mounts: Array<{ name: string; state: string; diagnosis?: string }> };
    };
    if (!ready.ok || ready.data === undefined) {
      await killAndWait(serverProc);
      throw new Error(`multi-project-server.ts did not report readiness: ${serverStdout}`);
    }
    const notMounted = ready.data.mounts.filter((m) => m.state !== "mounted");
    if (notMounted.length > 0) {
      await killAndWait(serverProc);
      throw new Error(`multi-project-server.ts registry entries did not all mount: ${JSON.stringify(notMounted)}`);
    }
    const machineRawKey = ready.data.api_key;

    // 5. Identity checks — the machine key for the primary (via /api/auth/me,
    //    mirrors global-setup.ts) AND per-project bearer checks for BOTH corpora
    //    (dispatch's explicit "authenticated against BOTH corpora" ask).
    try {
      await assertProjectIsOurs(API_URL, "project-a", bearerKeyA);
      await assertProjectIsOurs(API_URL, "project-b", bearerKeyB);
    } catch (err) {
      await killAndWait(serverProc);
      throw err;
    }

    // 6. Real Vite dev server — same mechanism as global-setup.ts. Bootstrap token is
    //    the MACHINE "dashboard-local" key (cookie auth is machine-scope, D1) so the
    //    SPA's real bootstrapAuthIfNeeded() path mints ONE session that reads BOTH
    //    projects (AC-078-6 "one login reads both projects").
    const viteProc = spawn(
      "bun",
      ["run", "dev", "--", "--port", String(DASH_PORT), "--strictPort"],
      {
        cwd: DASHBOARD_DIR,
        stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env, VITE_LORE_BOOTSTRAP_TOKEN: machineRawKey },
      },
    );
    viteProc.stdout?.on("data", () => {});
    viteProc.stderr?.on("data", (chunk: Buffer) => {
      process.stderr.write(`[vite:mp] ${chunk.toString()}`);
    });

    try {
      await waitFor200(`${DASH_URL}/`, 30_000);
    } catch (err) {
      await killAndWait(serverProc);
      await killAndWait(viteProc);
      throw err;
    }

    return async function globalTeardown(): Promise<void> {
      await Promise.all([killAndWait(serverProc), killAndWait(viteProc)]);
      cleanupTmpDirs();
    };
  } catch (err) {
    cleanupTmpDirs();
    throw err;
  }
}
