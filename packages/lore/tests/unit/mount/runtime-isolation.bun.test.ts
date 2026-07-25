/** @spec_ref spec-078-dashboard-multi-project-mount-registry-machine-scope AC-078-10 */

/**
 * Runtime isolation (SPEC-078 D8/R-17, T8) — proves the `/api/p/:name/*` path shim's
 * per-request try/catch (`adapters/http/index.ts::dispatchProjectRequest`) actually
 * isolates ONE misbehaving mounted project from every other mounted project on the
 * SAME `lore dashboard` process, end-to-end through a real in-process `Bun.Server`
 * (mirrors `tests/unit/adapters/http/ready-route.bun.test.ts`'s `makeTestServer`
 * pattern — a direct-call unit test of `dispatchProjectRequest` couldn't exercise the
 * REAL `startHttpServer`/`Bun.serve` wiring this AC cares about).
 *
 * Method: a `MountRegistry<App>` mounts TWO entries via the real
 * `createMountRegistry` runtime (T5) — "healthy" gets a REAL `createApp(dbPath)` App
 * over a throwaway `mkdtemp` corpus (mirrors `mount-registry.bun.test.ts`'s own
 * `makeRealCorpus` helper), "broken" gets a `Proxy` stub whose `get` trap throws on
 * ANY property access. `deps.createApp` for "broken" itself does NOT throw (the stub
 * is constructed successfully) — only USING it later does, so "broken" classifies as
 * `"mounted"` after `init()` and only flips to `"error"` on its FIRST dispatched
 * request, exactly matching D8's per-request (not per-mount) isolation boundary.
 *
 * Six-dimension framing:
 *   HAPPY:      the "healthy" project's routes return 200 and a real write lands
 *               (POST /api/p/healthy/api/docs).
 *   ERROR:      the "broken" project's routes return a NAMED 5xx (never a generic
 *               500) and its `/api/projects` entry flips mounted → error.
 *   STATE:      a SECOND request to "broken" after the first failure ALSO returns a
 *               named 5xx (not a one-off artifact of the first failing call) and the
 *               registry never throws or crashes the process.
 *   REGRESSION: the "healthy" project keeps serving 200s in the SAME window as
 *               "broken"'s failures — one project's runtime error never
 *               cross-contaminates another (the D8/R-17 guarantee itself).
 *
 * ⛔ Every corpus here is a throwaway `mkdtemp` directory — NEVER the repo's own
 * `.lore/` (root CLAUDE.md's 2026-07-07 pollution-incident convention).
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createApp } from "../../../src/app.js";
import type { App } from "../../../src/app.js";
import { startHttpServer } from "../../../src/adapters/http/index.js";
import { createMachineAuthStores, type MachineAuthStores } from "../../../src/adapters/http/machine-auth.js";
import { createMountRegistry } from "../../../src/mount/mount-registry.js";
import type { MountRegistryDeps } from "../../../src/mount/types.js";
import type { DashboardConfig } from "@lore/core";

const scratchDirs: string[] = [];

/** Builds a real, throwaway, fully-migrated `.lore/lore.db` corpus (mirrors
 * `mount-registry.bun.test.ts`'s `makeRealCorpus`). */
function makeRealCorpusRoot(prefix: string): string {
  const root = mkdtempSync(join(tmpdir(), prefix));
  scratchDirs.push(root);
  mkdirSync(join(root, ".lore"), { recursive: true });
  return root;
}

/**
 * A `Proxy` App stub whose `get` trap THROWS on any property access — simulates a
 * mounted project whose underlying store/service layer has gone bad (e.g. the D8
 * deleted-corpus-liveness spike's real `bun:sqlite` throw) without needing an actual
 * broken corpus file. `createApp` for this entry resolves successfully (the stub
 * object itself is returned without throwing) — the throw only happens the FIRST
 * time a route handler touches ANY property (`corpusService`, `apiKeyStore`, etc.),
 * which is exactly the per-REQUEST (not per-mount) failure this AC pins.
 */
function makeThrowingStubApp(): App {
  return new Proxy(
    {},
    {
      get(_target, prop) {
        // reason: EVERY `await`/async-return of this stub (both this test's own
        // `deps.createApp` returning it, and `classifyAndMount`'s internal
        // `await deps.createApp(dbPath)`) goes through the JS Promise-resolution
        // algorithm, which checks "is this value thenable?" by reading its `.then`
        // property — an unconditional throw here would misfire on THAT check
        // alone, before the stub is ever handed to a real route handler. Only
        // `"then"` is exempted; every other property access still throws.
        if (prop === "then") return undefined;
        throw new Error(`stub project: access to '${String(prop)}' should never succeed`);
      },
    },
  ) as unknown as App;
}

interface TestContext {
  server: ReturnType<typeof Bun.serve>;
  healthyApp: App;
  machineAuth: MachineAuthStores;
  baseUrl: string;
  healthyRawKey: string;
}

async function makeTestServer(): Promise<TestContext> {
  const healthyRoot = makeRealCorpusRoot("runtime-isolation-healthy-");
  const brokenRoot = makeRealCorpusRoot("runtime-isolation-broken-");
  // reason: MountRegistry classifies by probing `<path>/.lore/lore.db` — "broken"
  // still needs a `.lore` dir to exist so classification reaches `createApp` at all
  // (an actually-missing corpus would classify "missing" at MOUNT time, never
  // reaching "mounted" — a different AC-078-1 scenario, not this one).
  mkdirSync(join(brokenRoot, ".lore"), { recursive: true });
  // Give "broken" a real (empty-schema) db file so probeUpstreamDb succeeds and
  // classification proceeds to createApp — where the STUB (not a real corpus) takes over.
  const seedApp = createApp(join(brokenRoot, ".lore", "lore.db"));
  seedApp.close();

  const healthyApp = createApp(join(healthyRoot, ".lore", "lore.db"));

  const deps: MountRegistryDeps<App> = {
    createApp: async (dbPath: string) => {
      if (dbPath === join(brokenRoot, ".lore", "lore.db")) return makeThrowingStubApp();
      return healthyApp;
    },
  };

  const config: DashboardConfig = {
    projects: [
      { name: "healthy", path: healthyRoot },
      { name: "broken", path: brokenRoot },
    ],
  };

  const registry = createMountRegistry<App>();
  await registry.init(config, deps);

  // Sanity precondition — BOTH entries start "mounted" (the stub itself doesn't
  // throw on construction, only on later property access).
  expect(registry.resolve("healthy")?.state).toBe("mounted");
  expect(registry.resolve("broken")?.state).toBe("mounted");

  const machineAuth = createMachineAuthStores({ baseDir: mkdtempSync(join(tmpdir(), "runtime-isolation-machine-")) });

  const healthyKeyResult = await healthyApp.apiKeyStore.create("healthy-bearer", "owner");
  if (!healthyKeyResult.ok) throw new Error("Failed to create healthy API key");

  const server = startHttpServer(healthyApp, {
    port: 0,
    host: "127.0.0.1",
    machineAuth,
    mountRegistry: registry,
  });
  const baseUrl = `http://127.0.0.1:${server.port}`;

  return { server, healthyApp, machineAuth, baseUrl, healthyRawKey: healthyKeyResult.value.rawKey };
}

// ─── Test suite ───────────────────────────────────────────────────────────────

describe("SPEC-078 D8/R-17 — per-project runtime isolation (throwing-stub App)", () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await makeTestServer();
  });

  afterEach(() => {
    ctx.server.stop(true);
    ctx.healthyApp.close();
    ctx.machineAuth.db.close();
    while (scratchDirs.length > 0) {
      const dir = scratchDirs.pop();
      if (dir === undefined) continue;
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        // reason: best-effort scratch cleanup — mirrors mount-registry.bun.test.ts's afterEach.
      }
    }
  });

  describe("ERROR — the broken project's routes return a named 5xx and its state flips to error", () => {
    it("GET /api/p/broken/api/docs → 5xx-class JSON naming the project, never a generic 500", async () => {
      const res = await fetch(`${ctx.baseUrl}/api/p/broken/api/docs`, {
        headers: { Authorization: `Bearer ${ctx.healthyRawKey}` },
      });

      expect(res.status).toBeGreaterThanOrEqual(500);
      expect(res.status).toBeLessThan(600);
      const body = (await res.json()) as { ok: boolean; error: { code: string; message: string } };
      expect(body.ok).toBe(false);
      expect(body.error.code).not.toBe("INTERNAL_ERROR");
      expect(body.error.message).toContain("broken");
    });

    it("GET /api/projects → the broken entry's state has flipped from mounted to error", async () => {
      // Trigger the failure first.
      await fetch(`${ctx.baseUrl}/api/p/broken/api/docs`, {
        headers: { Authorization: `Bearer ${ctx.healthyRawKey}` },
      });

      const res = await fetch(`${ctx.baseUrl}/api/projects`, {
        headers: { Authorization: `Bearer ${ctx.healthyRawKey}` },
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        ok: boolean;
        data: { projects: Array<{ name: string; state: string }> };
      };
      const broken = body.data.projects.find((p) => p.name === "broken");
      expect(broken?.state).toBe("error");
    });
  });

  describe("STATE — a second request to the broken project after the first failure also settles as a named 5xx", () => {
    it("does not crash the process, and does not resolve/hang", async () => {
      const first = await fetch(`${ctx.baseUrl}/api/p/broken/api/docs`, {
        headers: { Authorization: `Bearer ${ctx.healthyRawKey}` },
      });
      expect(first.status).toBeGreaterThanOrEqual(500);

      const second = await fetch(`${ctx.baseUrl}/api/p/broken/api/docs`, {
        headers: { Authorization: `Bearer ${ctx.healthyRawKey}` },
      });
      expect(second.status).toBeGreaterThanOrEqual(500);
      expect(second.status).toBeLessThan(600);
      const body = (await second.json()) as { ok: boolean };
      expect(body.ok).toBe(false);
    });
  });

  describe("REGRESSION — the healthy project keeps serving 200s and accepting writes, unaffected by broken's failures", () => {
    it("POST /api/p/healthy/api/docs succeeds and the write is visible via a follow-up GET, even after broken has already failed", async () => {
      // First: make broken fail (state now "error").
      await fetch(`${ctx.baseUrl}/api/p/broken/api/docs`, {
        headers: { Authorization: `Bearer ${ctx.healthyRawKey}` },
      });

      // Then: healthy still accepts a real write.
      const createRes = await fetch(`${ctx.baseUrl}/api/p/healthy/api/docs`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${ctx.healthyRawKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ type: "prd", title: "Isolation write", content: "still lands" }),
      });
      expect(createRes.status).toBe(201);
      const created = (await createRes.json()) as { ok: boolean; data: { id: string; title: string } };
      expect(created.ok).toBe(true);
      expect(created.data.title).toBe("Isolation write");

      const getRes = await fetch(`${ctx.baseUrl}/api/p/healthy/api/docs/${created.data.id}`, {
        headers: { Authorization: `Bearer ${ctx.healthyRawKey}` },
      });
      expect(getRes.status).toBe(200);
    });
  });
});
