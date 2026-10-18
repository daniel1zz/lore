/**
 * Tests for `createDashboardTeardown` / `registerDashboardShutdownSignals`.
 * Source: task-lore-dashboard-leaks-the-vite-child-on-sigterm-only-sigint — pre-fix, only
 * SIGINT ran ANY teardown; SIGTERM (the default `kill`/`pkill` signal) left the spawned
 * Vite child alive holding its port. This suite proves BOTH signals now run the exact same
 * teardown function (not two independently authored handler bodies that could drift), and
 * that the teardown itself is idempotent and resilient to per-step failures.
 *
 * `registerDashboardShutdownSignals` is exercised via `process.emit("SIGINT"|"SIGTERM")`
 * — this only invokes the registered JS listeners, it does NOT send a real OS signal to
 * the test process (a real `process.kill(pid, "SIGTERM")` would kill the test runner).
 * `process.removeAllListeners` for both signals runs in `afterEach` so listeners never
 * leak across tests or fire on an unrelated later signal.
 *
 * Test plan (6-dimension):
 *   HAPPY:
 *     - createDashboardTeardown("SIGTERM") runs every step: vite.kill, server.stop,
 *       mountRegistry.closeAll, app.close, machineAuthDb.close (AC-3's "SIGTERM kills the
 *       Vite child + stops the HTTP server" requirement, exercised directly)
 *     - registerDashboardShutdownSignals wires the SAME teardown to SIGTERM: emitting
 *       "SIGTERM" invokes every step exactly once
 *
 *   NEGATIVE:
 *     - mountRegistry omitted (undefined) → teardown completes without calling closeAll,
 *       still calls app.close/machineAuthDb.close (SPEC-078 R-15-style: absent registry is
 *       inert, never a crash)
 *
 *   BOUNDARY:
 *     - vite.kill throws → server.stop / app.close / machineAuthDb.close STILL run (one
 *       already-dead resource never skips tearing down the rest)
 *     - mountRegistry.closeAll rejects → app.close / machineAuthDb.close STILL run
 *
 *   ERROR:
 *     - server.stop throws → app.close / machineAuthDb.close STILL run
 *
 *   STATE:
 *     - calling the SAME teardown function twice → second call is a no-op (every dep
 *       called exactly once, not twice) — the `ran` idempotency guard
 *
 *   REGRESSION:
 *     - registerDashboardShutdownSignals wires the IDENTICAL teardown reference to BOTH
 *       "SIGINT" and "SIGTERM" — emitting SIGINT alone produces the exact same call
 *       pattern SIGTERM does (the pre-fix asymmetry this task exists to close)
 *
 * @spec_ref task-lore-dashboard-leaks-the-vite-child-on-sigterm-only-sigint AC-1, AC-2
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createDashboardTeardown,
  registerDashboardShutdownSignals,
  type DashboardShutdownDeps,
} from "../../../../src/adapters/cli/dashboard-lifecycle.js";
import { liveIo } from "../../../live-invocation.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeDeps(overrides: Partial<DashboardShutdownDeps> = {}): {
  deps: DashboardShutdownDeps;
  calls: { vite: number; server: number; mountRegistry: number; app: number; machineAuthDb: number };
} {
  const calls = { vite: 0, server: 0, mountRegistry: 0, app: 0, machineAuthDb: 0 };
  const deps: DashboardShutdownDeps = {
    vite: { kill: vi.fn(() => { calls.vite++; }) },
    server: { stop: vi.fn(() => { calls.server++; }) },
    mountRegistry: { closeAll: vi.fn(async () => { calls.mountRegistry++; }) },
    app: { close: vi.fn(() => { calls.app++; }) },
    machineAuthDb: { close: vi.fn(() => { calls.machineAuthDb++; }) },
    log: () => {}, // silence [dashboard] log lines in test output
    ...overrides,
  };
  return { deps, calls };
}

afterEach(() => {
  // reason: process.emit-based tests below register real process.once listeners;
  // clearing them prevents cross-test leakage / an unrelated later signal firing a
  // stale teardown from a previous test.
  process.removeAllListeners("SIGINT");
  process.removeAllListeners("SIGTERM");
});

// ─── createDashboardTeardown ────────────────────────────────────────────────────

describe("createDashboardTeardown", () => {
  describe("happy path", () => {
    it("runs every teardown step exactly once", async () => {
      const { deps, calls } = makeDeps();
      const teardown = createDashboardTeardown(liveIo(), deps);
      await teardown("SIGTERM");

      expect(calls.vite).toBe(1);
      expect(calls.server).toBe(1);
      expect(calls.mountRegistry).toBe(1);
      expect(calls.app).toBe(1);
      expect(calls.machineAuthDb).toBe(1);
      expect(deps.vite.kill).toHaveBeenCalledWith("SIGTERM");
      expect(deps.server.stop).toHaveBeenCalledWith(true);
    });
  });

  describe("negative cases", () => {
    it("mountRegistry omitted (undefined) — teardown completes, never calls closeAll", async () => {
      const { deps: fullDeps, calls } = makeDeps();
      const { mountRegistry: _unused, ...depsWithoutRegistry } = fullDeps;
      const teardown = createDashboardTeardown(liveIo(), depsWithoutRegistry);
      await teardown("SIGTERM");

      expect(calls.mountRegistry).toBe(0);
      expect(calls.vite).toBe(1);
      expect(calls.server).toBe(1);
      expect(calls.app).toBe(1);
      expect(calls.machineAuthDb).toBe(1);
    });
  });

  describe("boundary values", () => {
    it("vite.kill throws — server.stop/app.close/machineAuthDb.close still run", async () => {
      const { deps, calls } = makeDeps({
        vite: { kill: vi.fn(() => { throw new Error("already exited"); }) },
      });
      const teardown = createDashboardTeardown(liveIo(), deps);
      await teardown("SIGTERM");

      expect(calls.server).toBe(1);
      expect(calls.mountRegistry).toBe(1);
      expect(calls.app).toBe(1);
      expect(calls.machineAuthDb).toBe(1);
    });

    it("mountRegistry.closeAll rejects — app.close/machineAuthDb.close still run", async () => {
      const { deps, calls } = makeDeps({
        mountRegistry: { closeAll: vi.fn(async () => { throw new Error("close failed"); }) },
      });
      const teardown = createDashboardTeardown(liveIo(), deps);
      await teardown("SIGTERM");

      expect(calls.app).toBe(1);
      expect(calls.machineAuthDb).toBe(1);
    });
  });

  describe("error cases", () => {
    it("server.stop throws — app.close/machineAuthDb.close still run", async () => {
      const { deps, calls } = makeDeps({
        server: { stop: vi.fn(() => { throw new Error("already stopped"); }) },
      });
      const teardown = createDashboardTeardown(liveIo(), deps);
      await teardown("SIGTERM");

      expect(calls.mountRegistry).toBe(1);
      expect(calls.app).toBe(1);
      expect(calls.machineAuthDb).toBe(1);
    });
  });

  describe("state transitions", () => {
    it("calling the same teardown twice is a no-op the second time", async () => {
      const { deps, calls } = makeDeps();
      const teardown = createDashboardTeardown(liveIo(), deps);
      await teardown("SIGTERM");
      await teardown("SIGINT");

      expect(calls.vite).toBe(1);
      expect(calls.server).toBe(1);
      expect(calls.mountRegistry).toBe(1);
      expect(calls.app).toBe(1);
      expect(calls.machineAuthDb).toBe(1);
    });
  });
});

// ─── registerDashboardShutdownSignals ──────────────────────────────────────────

describe("registerDashboardShutdownSignals", () => {
  describe("happy path — SIGTERM (AC-1)", () => {
    it("emitting SIGTERM runs the full teardown exactly once and calls onDone", async () => {
      const { deps, calls } = makeDeps();
      const teardown = createDashboardTeardown(liveIo(), deps);
      const onDone = vi.fn();
      registerDashboardShutdownSignals(teardown, onDone);

      process.emit("SIGTERM");
      // teardown is async — flush microtasks before asserting.
      await new Promise((r) => setTimeout(r, 10));

      expect(calls.vite).toBe(1);
      expect(calls.server).toBe(1);
      expect(calls.app).toBe(1);
      expect(calls.machineAuthDb).toBe(1);
      expect(onDone).toHaveBeenCalledTimes(1);
    });
  });

  describe("regression — SIGINT produces the identical call pattern (AC-2)", () => {
    it("emitting SIGINT alone runs the exact same teardown steps SIGTERM does", async () => {
      const { deps, calls } = makeDeps();
      const teardown = createDashboardTeardown(liveIo(), deps);
      const onDone = vi.fn();
      registerDashboardShutdownSignals(teardown, onDone);

      process.emit("SIGINT");
      await new Promise((r) => setTimeout(r, 10));

      expect(calls.vite).toBe(1);
      expect(calls.server).toBe(1);
      expect(calls.mountRegistry).toBe(1);
      expect(calls.app).toBe(1);
      expect(calls.machineAuthDb).toBe(1);
      expect(onDone).toHaveBeenCalledTimes(1);
    });

    it("SIGINT and SIGTERM are wired to the SAME teardown reference — whichever fires first tears down; the other is a no-op (idempotency guard, not a second run)", async () => {
      const { deps, calls } = makeDeps();
      const teardown = createDashboardTeardown(liveIo(), deps);
      const onDone = vi.fn();
      registerDashboardShutdownSignals(teardown, onDone);

      process.emit("SIGTERM");
      await new Promise((r) => setTimeout(r, 10));
      process.emit("SIGINT");
      await new Promise((r) => setTimeout(r, 10));

      // Each dep called exactly once total, not once-per-signal — proves both signals
      // route through the SAME underlying teardown function, not two separate bodies.
      expect(calls.vite).toBe(1);
      expect(calls.server).toBe(1);
      expect(calls.app).toBe(1);
      expect(calls.machineAuthDb).toBe(1);
      expect(onDone).toHaveBeenCalledTimes(2);
    });
  });
});
