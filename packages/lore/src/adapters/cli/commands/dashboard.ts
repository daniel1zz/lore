/**
 * `lore dashboard` — one-command dashboard launcher.
 * Purpose: packaged mode (the DEFAULT, spec-dashboard-production-packaging-one-command-
 *   lore-dashboard DD-5) starts the lore HTTP server IN-PROCESS with the embedded
 *   production dashboard bundle statically served, mints a one-time nonce (DD-2), and
 *   opens the browser at the nonce-redemption URL — ONE process, no Vite, no injected
 *   secret. `--dev` retains the pre-existing two-process topology (in-process HTTP server
 *   + a spawned Vite dev-server child) for dashboard SPA development.
 * Public surface: default citty command export; `ensureLocalApiKey` re-exported for tests
 *   (dev-mode-only helper — see this file's header for why packaged mode never calls it).
 * Invariants:
 *   - Mode selection is a discriminated dispatch, never an in-line boolean threaded through
 *     one shared code path: `runPackagedMode` and `runDevMode` are two independent async
 *     functions, each `Promise<never>` (every exit is `process.exit`), so a future edit to
 *     one topology's startup/teardown sequence cannot accidentally leak into the other's.
 *   - Packaged mode (DD-5) NEVER attempts the Vite topology and NEVER mentions "vite" in
 *     any failure output — the DD-1 assets-availability guard (`resolveAssets`) is the
 *     FIRST thing `runPackagedMode` does, before `loadLoreApp`, before any store is opened,
 *     before any port is parsed: unavailable assets exit non-zero naming BOTH remediation
 *     paths (`bun run build` / `--dev`) with zero side effects and zero listening sockets
 *     (spec Failure Modes table: "Source-run packaged mode without built assets" — no
 *     silent fallback to the dev topology). See `resolveAssets`'s own doc comment for the
 *     `LORE_DASHBOARD_ASSETS_FIXTURE=1` hermetic test seam
 *     (task-skill-test-f5a-cli-packaged-mode-red-scenarios) that lets the paired RED suite
 *     exercise the "assets available" branch without a real `bun run build`.
 *   - Packaged mode's stdout handshake (`LORE_DASHBOARD_URL=<nonce-url>`, matching DD-2's
 *     `/auth/bootstrap?nonce=<n>` shape) is written BEFORE the browser is opened and BEFORE
 *     this command blocks on shutdown — a machine-readable marker other tooling (this
 *     task's own RED suite; a future orchestrator) can scan for without racing the browser
 *     launch.
 *   - Packaged mode never calls `ensureLocalApiKey`: DD-2 replaced the injected
 *     `VITE_LORE_BOOTSTRAP_TOKEN` flow with a one-time nonce redeemed straight into a
 *     `lore_sid` cookie session — no bearer key is minted or read on this path. `--dev`
 *     keeps the pre-existing bootstrap-key flow byte-unchanged (`runDevMode` still calls
 *     `ensureLocalApiKey` and injects the raw key into the Vite child's env), which is why
 *     the helper stays exported from this module.
 *   - Packaged mode's Origin allowlist (DD-3) is API-origin-only — `localhost`/`127.0.0.1`
 *     at `apiPort`, computed inline (NOT `buildAllowedOrigins`, which always also includes
 *     a dashboard-port pair — irrelevant and misleading in a single-origin topology).
 *     `--dev`'s allowlist stays `buildAllowedOrigins(apiPort, dashPort)` fed the REAL
 *     `--dashboard-port` (retires the 5173-hardcode defect,
 *     task-dashboard-bootstrap-origin-allowlist-hardcodes-port-5173); under
 *     `LORE_DASHBOARD_DEBUG_ALLOWLIST=1` it is additionally printed as
 *     `LORE_DASHBOARD_ALLOWLIST=<json array>` before the Vite child is spawned, so the
 *     paired RED suite can assert the real port appears and `5173` never does without a
 *     live network probe.
 *   - Both modes share ONE teardown mechanism (`dashboard-lifecycle.ts::createDashboardTeardown`
 *     / `registerDashboardShutdownSignals`) wired to BOTH SIGINT and SIGTERM — the fix for
 *     task-lore-dashboard-leaks-the-vite-child-on-sigterm-only-sigint must not regress
 *     under either topology. Packaged mode has no Vite child to kill, so it passes a no-op
 *     `KillableChild` (`NOOP_VITE_CHILD`) rather than forking a second teardown sequence
 *     that could drift from the dev-mode one.
 *   - `--api-port` semantics are unchanged in both modes. `--dashboard-port` is only
 *     meaningful under `--dev` (packaged mode is single-port); it is still parsed/validated
 *     when supplied in packaged mode (a stray `--dashboard-port` is not an error), it is
 *     just never read.
 *   - SPEC-078 D2/D7 multi-project mount registry (`buildMountRegistry`) is mode-agnostic —
 *     both topologies still honor `~/.config/lore/config.yaml`'s `dashboard.projects` the
 *     same way the pre-existing single-topology command did.
 *   - Failure to open the browser is non-fatal in both modes (prints the URL and continues).
 * Side-effect class: IO (file system, network, child_process — dev mode only, process
 *   signals)
 * Source: SPEC-016 §3.6; SPEC-078 §Design Decisions D1, D2, D7;
 *   spec-dashboard-production-packaging-one-command-lore-dashboard DD-1..DD-5
 */

import { dirname, join } from "node:path";
import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { defineCommand } from "citty";
import { loadGlobalConfig } from "@lore/core/node";
import { loadLoreApp } from "../loader.js";
import { createApp } from "../../../app.js";
import type { App } from "../../../app.js";
import { startHttpServer } from "../../http/index.js";
import { createMachineAuthStores } from "../../http/machine-auth.js";
import { buildAllowedOrigins } from "../../http/auth.js";
import { createNonceStore } from "../../http/static-serving.js";
import type { DashboardAssetsManifest, DashboardAssetsResult } from "../../http/static-serving.js";
import { loadDashboardAssets } from "../../http/dashboard-assets-loader.js";
import { ensureLocalApiKey } from "../local-key.js";
import { createMountRegistry } from "../../../mount/mount-registry.js";
import type { MountRegistry } from "../../../mount/types.js";
import { createDashboardTeardown, registerDashboardShutdownSignals, type KillableChild } from "../dashboard-lifecycle.js";

// Re-export for tests that import from this module path.
export { ensureLocalApiKey } from "../local-key.js";
export type { LocalApiKeyCreator } from "../local-key.js";

// ─── Shared helpers (both topologies) ───────────────────────────────────────────

/** No Vite child exists in packaged mode — this satisfies `DashboardShutdownDeps.vite`
 * (a required field, shared by both topologies' teardown) without forking a second
 * teardown sequence. See this file's header. */
const NOOP_VITE_CHILD: KillableChild = { kill() {} };

/**
 * Parse and validate a `--<flagName>` port argument, exiting 1 on an out-of-range or
 * non-numeric value (matches this command's pre-existing inline validation, shared so
 * both topologies validate identically).
 *
 * @param rawValue - The citty-parsed flag value (already defaulted by citty's own `default`).
 * @param flagName - Flag name for the error message, e.g. `"api-port"`.
 * @param fallback - Fallback used if `rawValue` is somehow `undefined` (citty's `default`
 *   should already have applied it — defensive only, mirrors this command's pre-existing
 *   `?? "8787"`-style guards).
 */
function parsePort(rawValue: string | undefined, flagName: string, fallback: string): number {
  const port = parseInt(rawValue ?? fallback, 10);
  if (isNaN(port) || port < 1 || port > 65535) {
    process.stderr.write(`Error: --${flagName} must be a valid port (1–65535)\n`);
    process.exit(1);
  }
  return port;
}

/**
 * Build the SPEC-078 D2/D7 multi-project mount registry when the machine-scope config
 * declares `dashboard.projects`; `undefined` otherwise (the common single-project case —
 * both topologies' `startHttpServer` call treats an omitted `mountRegistry` as completely
 * inert). `loadGlobalConfig` failures (malformed YAML, etc.) degrade to "no registry"
 * rather than aborting the whole `lore dashboard` run.
 */
async function buildMountRegistry(): Promise<MountRegistry<App> | undefined> {
  const globalConfigResult = loadGlobalConfig();
  const registeredProjects = globalConfigResult.ok ? (globalConfigResult.value.dashboard?.projects ?? []) : [];
  if (registeredProjects.length === 0) return undefined;

  const mountRegistry = createMountRegistry<App>();
  await mountRegistry.init(
    { projects: registeredProjects },
    // reason: registered projects are always plain local SQLite corpora (no `sync`
    // config passed) — `createApp(dbPath)`'s single-arg overload always returns a
    // bare `App`, never `Result<App>` (see `app.ts`'s overload pair).
    { createApp: async (registryDbPath: string) => createApp(registryDbPath) },
  );

  process.stdout.write(`\n[dashboard] Multi-project registry (${registeredProjects.length} declared):\n`);
  for (const entry of mountRegistry.listEntries()) {
    const detail =
      entry.state === "mounted" ? "mounted" : `${entry.state}${entry.diagnosis !== undefined ? ` — ${entry.diagnosis}` : ""}`;
    process.stdout.write(`  - ${entry.name}: ${detail}\n`);
  }
  return mountRegistry;
}

/**
 * Open the given URL in the system default browser.
 * Failure is non-fatal — prints the URL to stdout so the user can open it manually.
 *
 * @param url - URL to open.
 */
function openBrowser(url: string): void {
  const platform = process.platform;
  const cmd =
    platform === "darwin" ? "open" : platform === "win32" ? "start" : "xdg-open";
  try {
    spawn(cmd, [url], { detached: true, stdio: "ignore" });
  } catch {
    process.stdout.write(`Could not open browser automatically. Visit: ${url}\n`);
  }
}

// ─── Packaged mode (DD-1..DD-5, the default) ────────────────────────────────────

/** Memoized `LORE_DASHBOARD_ASSETS_FIXTURE=1` manifest — see `resolveFixtureManifest`. */
let fixtureManifest: DashboardAssetsManifest | undefined;

/**
 * Build (once, memoized within this process) a minimal fixture assets manifest for the
 * `LORE_DASHBOARD_ASSETS_FIXTURE=1` hermetic seam this task's paired RED suite defines
 * (task-skill-test-f5a-cli-packaged-mode-red-scenarios) — simulates "packaged assets are
 * available" without a real `bun run build`. Writes one throwaway `index.html` to a fresh
 * `mkdtemp` dir so a request against this fixture still gets real bytes back, matching the
 * production manifest's own "never serve a dangling path" discipline.
 */
function resolveFixtureManifest(): DashboardAssetsManifest {
  if (fixtureManifest !== undefined) return fixtureManifest;
  const dir = mkdtempSync(join(tmpdir(), "lore-dashboard-assets-fixture-"));
  const indexPath = join(dir, "index.html");
  writeFileSync(indexPath, "<!doctype html><title>lore dashboard (fixture)</title>\n");
  fixtureManifest = {
    stamp: { digest: "fixture", builtAt: new Date().toISOString() },
    entries: {
      "/index.html": { embedded: indexPath, contentType: "text/html", immutable: false },
    },
  };
  return fixtureManifest;
}

/**
 * Resolve the DD-1 embedded dashboard assets manifest for packaged-mode serving.
 * Honors the `LORE_DASHBOARD_ASSETS_FIXTURE=1` test seam (see `resolveFixtureManifest`);
 * otherwise delegates to the committed loader (`dashboard-assets-loader.ts`), which never
 * throws and never silently falls back — see that module's own doc comment.
 *
 * @returns `{ available: false, reason }` naming `bun run build` / `--dev` on any failure,
 *   never a thrown error.
 */
async function resolveAssets(): Promise<DashboardAssetsResult> {
  if (process.env.LORE_DASHBOARD_ASSETS_FIXTURE === "1") {
    return { available: true, manifest: resolveFixtureManifest() };
  }
  const loaded = await loadDashboardAssets();
  if (!loaded.available) return loaded;
  // reason: dashboard-assets-loader.ts's `DashboardAssetsManifestEntry.embedded` is typed
  // `z.unknown()` (an opaque, dynamically-imported file handle — that module stays
  // Zod-boundary-agnostic about what "embedded" even is) while static-serving.ts's own
  // `DashboardAssetsManifestEntry.embedded` is typed `string` (the shape `Bun.file()`
  // actually needs to read bytes). Both types describe the SAME runtime value — DD-1's
  // `with { type: "file" }` import always resolves to a path string — so this is the one
  // bridging cast between the two independently-typed manifest shapes, scoped to this exact
  // assignment; it is not a validation bypass (the loader already Zod-validated the shape
  // it can express).
  return loaded as unknown as DashboardAssetsResult;
}

/**
 * Packaged-mode startup (DD-5, the default): assert built assets are available, start the
 * HTTP server with static serving + nonce auth enabled, mint one nonce, print the stdout
 * handshake, open the browser, then block until SIGINT/SIGTERM.
 *
 * @returns Never resolves — every exit path is `process.exit`.
 */
async function runPackagedMode(args: {
  "api-port"?: string;
  "no-open"?: boolean;
}): Promise<never> {
  // DD-5 / Failure Modes table: this guard is the FIRST thing packaged mode does — no
  // corpus load, no store open, no port parsed, no listener bound — so an unavailable-
  // assets exit has zero side effects and never mentions Vite (packaged mode never
  // attempts that topology at all).
  const assetsResult = await resolveAssets();
  if (!assetsResult.available) {
    process.stderr.write(
      `Error: Dashboard assets are not built (${assetsResult.reason})\n` +
        `Run 'bun run build' to build them for packaged mode, or run 'lore dashboard --dev' ` +
        `to use the development topology instead.\n`,
    );
    process.exit(1);
  }

  const apiPort = parsePort(args["api-port"], "api-port", "8787");

  const { app } = loadLoreApp();
  const machineAuth = createMachineAuthStores();
  const mountRegistry = await buildMountRegistry();

  // DD-3: packaged mode is single-origin — the api origin only, never a dashboard-port
  // pair (there is no second process/port in this topology).
  const allowedOrigins = [`http://localhost:${apiPort}`, `http://127.0.0.1:${apiPort}`] as const;

  const nonces = createNonceStore();
  const server = startHttpServer(app, {
    port: apiPort,
    host: "127.0.0.1",
    machineAuth,
    allowedOrigins,
    ...(mountRegistry !== undefined ? { mountRegistry } : {}),
    dashboard: {
      assets: resolveAssets,
      nonces,
      machineAuth: () => machineAuth,
    },
  });

  // DD-2: one-time nonce redeemed into a `lore_sid` session by GET /auth/bootstrap — the
  // machine key is never served over HTTP, unlike --dev's VITE_LORE_BOOTSTRAP_TOKEN flow.
  const nonceToken = nonces.mint();
  const bootstrapUrl = `http://localhost:${apiPort}/auth/bootstrap?nonce=${nonceToken}`;

  // Machine-readable handshake, printed BEFORE the browser opens and BEFORE this command
  // blocks — the seam task-skill-test-f5a-cli-packaged-mode-red-scenarios pins.
  process.stdout.write(`LORE_DASHBOARD_URL=${bootstrapUrl}\n`);
  process.stdout.write(`\nDashboard ready: ${bootstrapUrl}\n`);

  if (!args["no-open"]) {
    openBrowser(bootstrapUrl);
  }

  const teardown = createDashboardTeardown({
    vite: NOOP_VITE_CHILD,
    server,
    ...(mountRegistry !== undefined ? { mountRegistry } : {}),
    app,
    machineAuthDb: machineAuth.db,
  });

  let shutdownResolve: () => void;
  const shutdownPromise = new Promise<void>((resolve) => {
    shutdownResolve = resolve;
  });
  registerDashboardShutdownSignals(
    async (signal) => {
      await teardown(signal);
    },
    () => shutdownResolve(),
  );

  // Block until SIGINT (Ctrl+C) OR SIGTERM (kill/pkill default).
  await shutdownPromise;
  process.exit(0);
}

// ─── Dev mode (--dev; pre-existing two-process Vite topology) ──────────────────

/**
 * Outcome of racing the Vite dev server's startup against its own "exit" event
 * (task-dashboard-bootstrap-origin-allowlist-hardcodes-port-5173 — see this file's
 * header). A discriminated union rather than a nullable/boolean combo so every branch
 * below is exhaustively handled: "ready" (proceed normally), "exited" (fatal —
 * `--strictPort` rejected an already-taken port), "timeout" (non-fatal warning — Vite may
 * still be starting up, a genuinely different failure class from "exited"), "shutting-
 * down" (a SIGINT/SIGTERM arrived DURING startup — see this file's header on early signal
 * registration — and its teardown killed Vite's process group as ordinary shutdown, NOT a
 * `--strictPort` failure; must never be confused with "exited" or print "Dashboard ready").
 */
type ViteStartupOutcome =
  | { kind: "ready" }
  | { kind: "exited"; code: number | null; signal: NodeJS.Signals | null }
  | { kind: "timeout" }
  | { kind: "shutting-down" };

/**
 * Poll a URL until it returns HTTP 200, or throw on timeout.
 *
 * @param url - URL to poll (GET request).
 * @param timeoutMs - Max wait in milliseconds (default 15 000).
 */
async function waitFor200(url: string, timeoutMs = 15_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(1000) });
      if (res.ok) return;
    } catch {
      // Server not up yet — retry after 200ms.
    }
    await new Promise<void>((r) => setTimeout(r, 200));
  }
  throw new Error(`Timed out waiting for ${url} to return 200 after ${timeoutMs}ms`);
}

/**
 * Wrap a spawned child process into a {@link KillableChild} that kills its WHOLE PROCESS
 * GROUP, not just the immediate child PID.
 *
 * `vite` here is `bun run --filter @lore/dashboard dev` — an intermediate process that
 * itself spawns the actual Vite server as a FURTHER child. Node's default (non-`detached`)
 * `spawn` keeps every descendant in the SAME process group as `lore dashboard` itself, so
 * `child.kill(signal)` (which signals only that one PID) can leave the grandchild Vite
 * server running as an orphan after the intermediate process exits — reproduced manually:
 * SIGTERM to the parent killed `bun run --filter ...` but left the real `vite` node
 * process alive and still holding the port. The fix is to spawn the intermediate process
 * `detached: true` (POSIX: makes it the LEADER of its OWN new process group, pgid ===
 * its own pid) and signal the NEGATIVE pid (`process.kill(-pid, signal)`), which the
 * kernel delivers to every process in that group — the intermediate AND every process it
 * spawned. Falls back to a direct single-PID kill when group-signaling itself throws
 * (already-reaped group, or `win32` — negative-PID process-group signaling is POSIX-only;
 * Windows keeps the pre-existing single-PID semantics rather than silently no-op'ing).
 *
 * @param child - The `detached: true`-spawned intermediate child process.
 * @returns A `KillableChild` whose `kill` signals the whole group.
 */
function killableProcessGroup(child: ReturnType<typeof spawn>): KillableChild {
  return {
    kill(signal) {
      const pid = child.pid;
      if (pid === undefined || process.platform === "win32") {
        child.kill(signal);
        return;
      }
      try {
        process.kill(-pid, signal ?? "SIGTERM");
      } catch {
        // reason: the process group may already be gone (e.g. Vite already exited on its
        // own) — fall back to the direct single-PID kill rather than silently doing nothing.
        child.kill(signal);
      }
    },
  };
}

/**
 * Dev-mode startup (`--dev`): the pre-existing two-process topology — in-process HTTP
 * server + a spawned Vite dev-server child, `VITE_LORE_BOOTSTRAP_TOKEN` bootstrap-key
 * injection untouched. Byte-compatible with `lore dashboard`'s behavior before DD-5's
 * default flip.
 *
 * @returns Never resolves — every exit path is `process.exit`.
 */
async function runDevMode(args: {
  "api-port"?: string;
  "dashboard-port"?: string;
  "no-open"?: boolean;
}): Promise<never> {
  const { app, dbPath } = loadLoreApp();
  const loreDir = dirname(dbPath);
  const projectRoot = dirname(loreDir);

  // reason: SPEC-078 D1 unconditional re-point — the dashboard cookie login flow
  // (bootstrap + session resolution) moves to a MACHINE-scope auth store, never the
  // per-corpus app.apiKeyStore/app.sessionStore. Constructed ONCE here and threaded
  // into BOTH ensureLocalApiKey (below) and startHttpServer (below) so the key this
  // command mints and the key the running server validates are the SAME store
  // instance — never two independently-constructed stores that could disagree.
  const machineAuth = createMachineAuthStores();

  // Ensure local API key (create if absent, reuse if present). Fail-loud on error.
  // The cached raw-key file lives alongside the machine auth db (machineAuth's own
  // base dir), not this project's .lore/ — the key itself is machine-wide (one
  // "dashboard-local" key across every project), so the cache must be too; a
  // per-project cache would collide on the SECOND project's `lore dashboard` run
  // (ApiKeyStore.create rejects a duplicate name). Dev-mode-only: packaged mode's DD-2
  // nonce flow never mints or reads this key — see this file's header.
  const localKey = await ensureLocalApiKey(machineAuth.apiKeyStore, machineAuth.baseDir);

  const mountRegistry = await buildMountRegistry();

  const apiPort = parsePort(args["api-port"], "api-port", "8787");
  const dashPort = parsePort(args["dashboard-port"], "dashboard-port", "5173");

  // task-dashboard-bootstrap-origin-allowlist-hardcodes-port-5173 — the allowlist is
  // built from the ACTUAL apiPort/dashPort this run resolved, never a hardcoded
  // default; --strictPort below (Vite spawn) guarantees dashPort is the port Vite
  // really bound (or the process fails loud), so this allowlist is never stale.
  const allowedOrigins = buildAllowedOrigins(apiPort, dashPort);

  // DD-3 debug seam: prints the REAL --dashboard-port-derived allowlist before the Vite
  // child is spawned, so the paired RED suite can assert the actual port appears (and the
  // retired 5173 hardcode never does) without a live network probe.
  if (process.env.LORE_DASHBOARD_DEBUG_ALLOWLIST === "1") {
    process.stdout.write(`LORE_DASHBOARD_ALLOWLIST=${JSON.stringify(allowedOrigins)}\n`);
  }

  // Start HTTP server in-process — single Database connection, no cross-process sync.
  // reason: In-process server means no IPC latency and no race on .lore/lore.db.
  // SPEC-016 §3.6. `machineAuth` here is the SAME instance ensureLocalApiKey just used
  // above — see this file's header (SPEC-078 D1).
  // reason: `exactOptionalPropertyTypes` — `mountRegistry` is only spread onto the
  // config object when defined, rather than passed as an explicit `undefined` value
  // (HttpConfig's `mountRegistry?` means "may be absent", not "may be `undefined`").
  const server = startHttpServer(app, {
    port: apiPort,
    host: "127.0.0.1",
    machineAuth,
    allowedOrigins,
    ...(mountRegistry !== undefined ? { mountRegistry } : {}),
  });

  // Spawn Vite dev server as the only child process.
  // reason: VITE_LORE_BOOTSTRAP_TOKEN is passed via env (not CLI args) to avoid it
  // appearing in process lists. The Vite plugin reads it server-side only. SPEC-016 §3.7.
  // reason: --strictPort (task-dashboard-bootstrap-origin-allowlist-hardcodes-port-5173)
  // — deterministic beats sniffing. Without it, Vite silently auto-increments past a
  // held `dashPort` and this command has no reliable way to learn the real bound port,
  // so the Origin allowlist built above would desync from what the SPA actually runs
  // on. With it, Vite either binds EXACTLY `dashPort` or exits nonzero — handled below.
  // reason: detached: true (task-lore-dashboard-leaks-the-vite-child-on-sigterm-only-
  // sigint) — makes this process the LEADER of its own new process group, so
  // killableProcessGroup's negative-pid signal reaches EVERY descendant (the actual
  // Vite server `bun run --filter` spawns as a further child), not just this one PID.
  // stdio stays "inherit" — detached only changes process-group membership, not stdio.
  const vite = spawn(
    "bun",
    [
      "run",
      "--filter",
      "@lore/dashboard",
      "dev",
      "--",
      "--port",
      String(dashPort),
      "--strictPort",
    ],
    {
      stdio: "inherit",
      cwd: projectRoot,
      env: { ...process.env, VITE_LORE_BOOTSTRAP_TOKEN: localKey },
      detached: process.platform !== "win32",
    },
  );

  vite.on("error", (err) => {
    process.stderr.write(`[dashboard] Vite process error: ${err.message}\n`);
  });

  // reason: teardown is built ONCE, right after Vite is spawned, and the SAME instance
  // is used by EVERY exit path below (a --strictPort startup failure, SIGINT, SIGTERM) —
  // never two independently authored shutdown sequences (task-lore-dashboard-leaks-the-
  // vite-child-on-sigterm-only-sigint's root cause), and `createDashboardTeardown`'s own
  // `ran` guard makes calling it more than once (e.g. a signal arriving mid-startup-
  // failure-teardown) a safe no-op rather than a double-kill.
  const teardown = createDashboardTeardown({
    // reason: killableProcessGroup wraps the raw ChildProcess so teardown signals the
    // WHOLE process group (spawned detached: true above) — see that function's own
    // header for why a plain `vite.kill()` leaves the actual Vite server (a further
    // grandchild of `bun run --filter ...`) orphaned and still holding the port.
    vite: killableProcessGroup(vite),
    server,
    ...(mountRegistry !== undefined ? { mountRegistry } : {}),
    app,
    machineAuthDb: machineAuth.db,
  });

  // reason: registered IMMEDIATELY after Vite is spawned — NOT after the startup race
  // below settles. The startup race's own "timeout" branch can legitimately take up to
  // waitFor200's full 15s (observed on this dev machine: the local Vite binds its dev
  // server to `::1` only, never `127.0.0.1`, so this process's own 127.0.0.1 readiness
  // probe always times out even once Vite is genuinely ready — an unrelated, pre-
  // existing environment quirk this command does not attempt to fix). Registering
  // signal handling only AFTER that race would leave a real window — up to 15s on a
  // slow-starting Vite — where a SIGTERM/SIGINT during startup hits the OS's default
  // disposition (immediate kill, ZERO teardown), reproducing this task's exact defect
  // for anyone who signals `lore dashboard` before it prints "Dashboard ready". This
  // resolver is awaited at the very end of `run()`, after the startup race and the
  // "Dashboard ready" print, so if NEITHER exit path above already tore down (the
  // common case), the process still blocks until a signal arrives.
  let shutdownResolve: () => void;
  const shutdownPromise = new Promise<void>((resolve) => {
    shutdownResolve = resolve;
  });
  // reason: `shuttingDown` distinguishes a SIGNAL-triggered Vite-process-group kill
  // (ordinary shutdown) from a genuine `--strictPort` startup failure — both surface as
  // the SAME `vite.once("exit", ...)` event below, but must not be handled the same way
  // (see the "shutting-down" ViteStartupOutcome variant's doc comment above). Set true
  // BEFORE the shared `teardown` call so the race's exit listener can check it.
  let shuttingDown = false;
  registerDashboardShutdownSignals(
    async (signal) => {
      shuttingDown = true;
      await teardown(signal);
    },
    () => shutdownResolve(),
  );

  // reason: races waitFor200 against Vite's own "exit" event so a --strictPort failure
  // (port already in use) is detected DETERMINISTICALLY and fails loud immediately,
  // instead of silently falling through to the pre-existing 15s-timeout "Vite did not
  // respond in time" warning path (which is for genuine slow-start, not a bound-to-fail
  // exit — those are different failure classes and must not share one code path).
  // Discriminated union (not a mutated nullable variable) so every possible startup
  // outcome is exhaustively handled below, not inferred from a boolean/null combo.
  const startupOutcome = await new Promise<ViteStartupOutcome>((resolve) => {
    let settled = false;
    const settle = (outcome: ViteStartupOutcome): void => {
      if (settled) return;
      settled = true;
      resolve(outcome);
    };

    vite.once("exit", (code, signal) => {
      if (shuttingDown) {
        settle({ kind: "shutting-down" });
        return;
      }
      settle({ kind: "exited", code, signal });
    });

    waitFor200(`http://127.0.0.1:${dashPort}/`)
      .then(() => settle({ kind: "ready" }))
      .catch(() => settle({ kind: "timeout" }));
  });

  if (startupOutcome.kind === "shutting-down") {
    // reason: a SIGINT/SIGTERM arrived DURING startup — `teardown` is already running
    // (triggered by the signal handler above, which is what killed Vite's process group
    // and produced THIS exit event in the first place). Never print "Dashboard ready"
    // or open a browser for a run that is already shutting down; just wait for the
    // in-flight teardown to finish and exit cleanly.
    await shutdownPromise;
    process.exit(0);
  }

  if (startupOutcome.kind === "exited") {
    process.stderr.write(
      `[dashboard] Fatal: Vite dev server exited before binding port ${dashPort} ` +
        `(code=${startupOutcome.code ?? "null"}, signal=${startupOutcome.signal ?? "null"}). ` +
        `--dashboard-port ${dashPort} is likely already in use — --strictPort is set deliberately ` +
        `(see this file's header) so a taken port fails loud instead of silently auto-incrementing to ` +
        `a port the Origin allowlist wouldn't know about. Choose a free port with --dashboard-port <port> ` +
        `and retry.\n`,
    );
    await teardown("startup-failure");
    process.exit(1);
  } else if (startupOutcome.kind === "timeout") {
    process.stderr.write(
      `[dashboard] Warning: Vite did not respond on port ${dashPort} in time — continuing anyway (may still be starting up).\n`,
    );
    // Continue anyway — Vite may still be starting up (genuine slow start, not a
    // --strictPort exit — those are handled above).
  }
  // startupOutcome.kind === "ready" → proceed normally, nothing to do here.

  const dashUrl = `http://localhost:${dashPort}/`;
  process.stdout.write(`\nDashboard ready: ${dashUrl}\n`);

  if (!args["no-open"]) {
    openBrowser(dashUrl);
  }

  // Block until SIGINT (Ctrl+C) OR SIGTERM (kill/pkill default) — handlers were already
  // registered right after Vite was spawned (see above), so this covers the common case
  // where neither exit path above already fired.
  await shutdownPromise;

  process.exit(0);
}

// ─── Command ───────────────────────────────────────────────────────────────────

export default defineCommand({
  meta: {
    name: "dashboard",
    description:
      "Run the lore dashboard: packaged single-process mode by default (embedded production " +
      "bundle + one-time nonce auth), or --dev for the Vite dev-server two-process topology",
  },
  args: {
    "api-port": {
      type: "string",
      default: "8787",
      description: "Port for the lore HTTP API server (default: 8787)",
    },
    "dashboard-port": {
      type: "string",
      default: "5173",
      description: "Port for the Vite dev server — only meaningful with --dev (default: 5173)",
    },
    dev: {
      type: "boolean",
      description: "Use the Vite dev-server two-process topology instead of the packaged default",
    },
    "no-open": {
      type: "boolean",
      description: "Skip opening the browser",
    },
  },
  async run({ args }) {
    if (args.dev) {
      await runDevMode(args);
      return;
    }
    await runPackagedMode(args);
  },
});
