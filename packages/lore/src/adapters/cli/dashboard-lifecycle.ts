/**
 * `lore dashboard` process lifecycle — one shared teardown wired to BOTH SIGINT and SIGTERM.
 * Purpose: fix the leaked-Vite-child defect where only SIGINT was handled — SIGTERM (the
 *   default `kill`/`pkill` signal) left the spawned Vite dev server alive holding its port,
 *   which then broke the NEXT `lore dashboard` run's Origin-allowlist match (Vite
 *   auto-increments to a port the allowlist doesn't know about — see
 *   task-dashboard-bootstrap-origin-allowlist-hardcodes-port-5173).
 * Public surface: DashboardShutdownDeps, createDashboardTeardown, registerDashboardShutdownSignals.
 * Invariants:
 *   - createDashboardTeardown returns ONE function, run at most once (internal `ran` guard —
 *     a second signal arriving mid-teardown, or a caller invoking the returned function
 *     twice, is a no-op the second time, never a double-close/double-kill).
 *   - Every teardown step (kill Vite, stop HTTP server, close mount registry, close app,
 *     close machine-auth db) is independently try/caught — one already-dead resource
 *     (e.g. Vite already exited) never skips tearing down the rest.
 *   - registerDashboardShutdownSignals wires the EXACT SAME teardown function reference to
 *     both "SIGINT" and "SIGTERM" via `process.once` — never two independently authored
 *     handler bodies that could drift (the defect this module exists to fix).
 * Side-effect class: IO (process signals, child-process kill, server stop) — this module
 *   imports no `bun:sqlite`-touching code, so it stays reachable from vitest (unlike
 *   `commands/dashboard.ts`, which transitively imports `loader.ts`).
 * Source: task-lore-dashboard-leaks-the-vite-child-on-sigterm-only-sigint
 */

/** Minimal duck-typed slice of `node:child_process.ChildProcess` this module needs. */
export interface KillableChild {
  kill(signal?: NodeJS.Signals): void;
}

/** Minimal duck-typed slice of `Bun.serve`'s returned server this module needs. */
export interface StoppableServer {
  stop(closeActiveConnections?: boolean): void;
}

/** Minimal duck-typed slice of `SPEC-078` `MountRegistry` this module needs. */
export interface ClosableMountRegistry {
  closeAll(): Promise<void>;
}

/** Minimal duck-typed slice of `App` this module needs. */
export interface ClosableApp {
  close(): void;
}

/** Minimal duck-typed slice of the machine-auth `bun:sqlite Database` this module needs. */
export interface ClosableDb {
  close(): void;
}

/** Dependencies {@link createDashboardTeardown} tears down, in order. */
export interface DashboardShutdownDeps {
  readonly vite: KillableChild;
  readonly server: StoppableServer;
  readonly mountRegistry?: ClosableMountRegistry;
  readonly app: ClosableApp;
  readonly machineAuthDb: ClosableDb;
  /** Injectable for tests; defaults to `process.stdout.write`. */
  readonly log?: (line: string) => void;
}

/**
 * Build the ONE teardown function for a `lore dashboard` run — kills the Vite child,
 * stops the HTTP server, closes the (optional) multi-project mount registry, then closes
 * the app and the machine-auth db. Safe to call more than once (idempotent no-op after
 * the first real run) and safe to call from EITHER a SIGINT or a SIGTERM handler — the
 * whole point of this factory is that both signals share this exact function.
 *
 * @param deps - The resources to tear down.
 * @returns An async function taking the triggering signal name (for the log line), running
 *   the full teardown sequence exactly once.
 * @example
 *   const teardown = createDashboardTeardown({ vite, server, app, machineAuthDb: machineAuth.db });
 *   registerDashboardShutdownSignals(teardown, () => process.exit(0));
 */
export function createDashboardTeardown(deps: DashboardShutdownDeps): (signal: string) => Promise<void> {
  let ran = false;
  const log = deps.log ?? ((line: string) => { process.stdout.write(line); });

  return async (signal: string): Promise<void> => {
    if (ran) return;
    ran = true;

    log(`\n[dashboard] Received ${signal}, shutting down...\n`);

    try {
      deps.vite.kill("SIGTERM");
    } catch {
      // reason: the Vite child may have already exited on its own — best-effort kill,
      // never fatal to the rest of teardown.
    }

    try {
      deps.server.stop(true);
    } catch {
      // reason: the HTTP server may have already stopped — best-effort, never fatal.
    }

    if (deps.mountRegistry !== undefined) {
      try {
        await deps.mountRegistry.closeAll();
      } catch {
        // reason: best-effort shutdown — a mount-registry close failure must never
        // block process exit (mirrors SPEC-078 D2's existing closeAll() call site).
      }
    }

    deps.app.close();
    deps.machineAuthDb.close();
  };
}

/**
 * Register ONE teardown function against BOTH "SIGINT" and "SIGTERM" via `process.once`.
 * This is the fix for the leaked-Vite-child defect: before, only "SIGINT" was registered,
 * so the default `kill`/`pkill` signal (SIGTERM) never ran any teardown at all.
 *
 * @param teardown - The function built by {@link createDashboardTeardown}.
 * @param onDone - Called after the teardown promise settles for whichever signal fires
 *   first (typically `() => process.exit(0)` — kept as a caller-supplied callback rather
 *   than baked in here so this module never calls `process.exit` itself, keeping it a
 *   plain, unit-testable function).
 */
export function registerDashboardShutdownSignals(
  teardown: (signal: string) => Promise<void>,
  onDone: () => void,
): void {
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.once(signal, () => {
      void teardown(signal).then(onDone);
    });
  }
}
