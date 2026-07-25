/**
 * `lore dashboard` — orchestrate local dashboard development environment.
 * Purpose: start in-process lore HTTP server + Vite dev server + auto-open browser,
 *   with local API key bootstrap so the SPA authenticates without user interaction.
 * Public surface: default citty command export; ensureLocalApiKey re-exported for tests.
 * Invariants:
 *   - HTTP server runs in-process (same App, same Database — no fork of lore binary).
 *   - Vite dev server is the only child process.
 *   - SIGINT AND SIGTERM both run the SAME teardown (kill Vite's WHOLE PROCESS GROUP, stop
 *     the HTTP server, close the mount registry, close the app + machine-auth db) before
 *     exiting — wired via `../dashboard-lifecycle.js::createDashboardTeardown` /
 *     `registerDashboardShutdownSignals` so the two signals can never drift (pre-fix,
 *     only SIGINT was handled — SIGTERM, the default `kill`/`pkill` signal, left the Vite
 *     child alive holding its port, which then broke the NEXT run's Origin-allowlist
 *     match; task-lore-dashboard-leaks-the-vite-child-on-sigterm-only-sigint). Handlers
 *     are registered IMMEDIATELY after Vite is spawned — NOT after Vite's own readiness is
 *     confirmed — so a signal arriving during the (up to ~15s) startup window still tears
 *     down correctly instead of hitting the OS default disposition (immediate kill, zero
 *     teardown); the same single `teardown` instance is also invoked directly by the
 *     `--strictPort` startup-failure path below (its own `ran` idempotency guard makes a
 *     second invocation from a concurrently-arriving signal a safe no-op).
 *   - Killing "the Vite child" means killing its WHOLE PROCESS GROUP, not just the
 *     immediate `bun run --filter @lore/dashboard dev` PID: that process itself spawns
 *     the real Vite server as a FURTHER child, and Node's default (non-`detached`) spawn
 *     keeps every descendant in `lore dashboard`'s own process group — signaling just the
 *     immediate child's PID left the actual Vite server running and still holding the
 *     port (reproduced manually while building this fix's test coverage). `vite` is
 *     spawned `detached: true` (POSIX) and `killableProcessGroup` signals the NEGATIVE
 *     pid (`process.kill(-pid, signal)`), which the kernel delivers to the whole group.
 *   - Vite is spawned with `--strictPort`: it FAILS LOUD (nonzero exit) instead of
 *     silently auto-incrementing when `--dashboard-port` is already taken. Deterministic
 *     beats sniffing — an auto-incremented port the Origin allowlist doesn't know about
 *     is exactly how task-dashboard-bootstrap-origin-allowlist-hardcodes-port-5173
 *     happened; failing loud here means the port that Origin-allowlist entries are built
 *     from (`buildAllowedOrigins(apiPort, dashPort)`, below) is ALWAYS the port Vite
 *     actually bound, never a guess. This command detects that early exit (raced against
 *     `waitFor200`) and exits 1 with a message naming the taken port and the recovery
 *     flag, after tearing down the HTTP server it already started.
 *   - The Origin allowlist threaded into `startHttpServer` is built from the ACTUAL
 *     `apiPort`/`dashPort` this run resolved (`buildAllowedOrigins`), not a hardcoded
 *     default — see `../../http/auth.ts`'s module header.
 *   - --no-open skips browser launch.
 *   - Failure to open browser is non-fatal (prints URL and continues).
 *   - The "dashboard-local" API key + the cookie sessions it mints live in a MACHINE-scope
 *     auth store (SPEC-078 D1), constructed ONCE via `createMachineAuthStores()` and
 *     shared between `ensureLocalApiKey` and `startHttpServer` — never the per-corpus
 *     `app.apiKeyStore`/`app.sessionStore`, and never two independently-constructed
 *     machine stores. The raw-key cache file lives alongside that store's own db file,
 *     not this project's `.lore/`, so a second project's `lore dashboard` run reuses the
 *     SAME machine-wide key instead of colliding on `ApiKeyStore.create`'s unique-name
 *     constraint.
 *   - Multi-project mount registry (SPEC-078 D2/D7, T8): when the MACHINE-scope config
 *     (`~/.config/lore/config.yaml`'s `dashboard.projects`, D3) declares one or more
 *     registered projects, a `MountRegistry` is built (probe → classify → parallel
 *     `createApp`, T5) and threaded into `startHttpServer` — the ONLY caller responsible
 *     for constructing one; every per-request classification/isolation concern lives in
 *     `adapters/http/index.ts`'s multi-mode branch. Absent/empty `dashboard.projects`
 *     (the default): `mountRegistry` stays `undefined` and `startHttpServer`'s multi-mode
 *     branch is completely inert (R-15) — this command's existing single-project behavior
 *     is byte-unchanged.
 * Side-effect class: IO (file system, network, child_process, process signals)
 * Source: SPEC-016 §3.6; SPEC-078 §Design Decisions D1, D2, D7
 */

import { dirname } from "node:path";
import { spawn } from "node:child_process";
import { defineCommand } from "citty";
import { loadGlobalConfig } from "@lore/core/node";
import { loadLoreApp } from "../loader.js";
import { createApp } from "../../../app.js";
import type { App } from "../../../app.js";
import { startHttpServer } from "../../http/index.js";
import { createMachineAuthStores } from "../../http/machine-auth.js";
import { buildAllowedOrigins } from "../../http/auth.js";
import { ensureLocalApiKey } from "../local-key.js";
import { createMountRegistry } from "../../../mount/mount-registry.js";
import type { MountRegistry } from "../../../mount/types.js";
import { createDashboardTeardown, registerDashboardShutdownSignals, type KillableChild } from "../dashboard-lifecycle.js";

// Re-export for tests that import from this module path.
export { ensureLocalApiKey } from "../local-key.js";
export type { LocalApiKeyCreator } from "../local-key.js";

// ─── Helpers ───────────────────────────────────────────────────────────────────

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

// ─── Command ───────────────────────────────────────────────────────────────────

export default defineCommand({
  meta: {
    name: "dashboard",
    description:
      "Run dashboard dev server (Vite) + lore HTTP server in one command, with auto-bootstrapped local auth",
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
      description: "Port for the Vite dev server (default: 5173)",
    },
    "no-open": {
      type: "boolean",
      description: "Skip opening the browser",
    },
  },
  async run({ args }) {
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
    // The cached raw-key file now lives alongside the machine auth db (machineAuth's own
    // base dir), not this project's .lore/ — the key itself is machine-wide (one
    // "dashboard-local" key across every project), so the cache must be too; a
    // per-project cache would collide on the SECOND project's `lore dashboard` run
    // (ApiKeyStore.create rejects a duplicate name).
    const localKey = await ensureLocalApiKey(machineAuth.apiKeyStore, machineAuth.baseDir);

    // SPEC-078 D2/D7 — multi-project mount registry, built ONLY when the machine-scope
    // config declares `dashboard.projects`. `loadGlobalConfig` failures (malformed YAML,
    // etc.) degrade to "no registry" rather than aborting the whole `lore dashboard` run —
    // this command's pre-existing single-project behavior must still work even if the
    // OPTIONAL multi-project section is broken.
    const globalConfigResult = loadGlobalConfig();
    const registeredProjects = globalConfigResult.ok ? (globalConfigResult.value.dashboard?.projects ?? []) : [];

    let mountRegistry: MountRegistry<App> | undefined;
    if (registeredProjects.length > 0) {
      mountRegistry = createMountRegistry<App>();
      await mountRegistry.init(
        { projects: registeredProjects },
        // reason: registered projects are always plain local SQLite corpora (no `sync`
        // config passed) — `createApp(dbPath)`'s single-arg overload always returns a
        // bare `App`, never `Result<App>` (see `app.ts`'s overload pair).
        { createApp: async (registryDbPath: string) => createApp(registryDbPath) },
      );

      process.stdout.write(`\n[dashboard] Multi-project registry (${registeredProjects.length} declared):\n`);
      for (const entry of mountRegistry.listEntries()) {
        const detail = entry.state === "mounted" ? "mounted" : `${entry.state}${entry.diagnosis !== undefined ? ` — ${entry.diagnosis}` : ""}`;
        process.stdout.write(`  - ${entry.name}: ${detail}\n`);
      }
    }

    const apiPort = parseInt(args["api-port"] ?? "8787", 10);
    const dashPort = parseInt(args["dashboard-port"] ?? "5173", 10);

    if (isNaN(apiPort) || apiPort < 1 || apiPort > 65535) {
      process.stderr.write("Error: --api-port must be a valid port (1–65535)\n");
      process.exit(1);
    }
    if (isNaN(dashPort) || dashPort < 1 || dashPort > 65535) {
      process.stderr.write("Error: --dashboard-port must be a valid port (1–65535)\n");
      process.exit(1);
    }

    // task-dashboard-bootstrap-origin-allowlist-hardcodes-port-5173 — the allowlist is
    // built from the ACTUAL apiPort/dashPort this run resolved, never a hardcoded
    // default; --strictPort below (Vite spawn) guarantees dashPort is the port Vite
    // really bound (or the process fails loud), so this allowlist is never stale.
    const allowedOrigins = buildAllowedOrigins(apiPort, dashPort);

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
  },
});
