// @reads packages/lore/src/adapters/http/dashboard-assets-loader.ts
// @spawns-external bun runs the lore typecheck script (`bun run typecheck:lore`) in a process group
/**
 * RED scenarios for the dashboard assets loader (spec
 * spec-dashboard-production-packaging-one-command-lore-dashboard, DD-1).
 *
 * TDD-Role: red. Paired implementation task (GREEN target):
 * task-skill-implement-f5a-build-step-embed-manifest-and-committed-loader,
 * which creates the committed loader at
 * `packages/lore/src/adapters/http/dashboard-assets-loader.ts`. As of THIS
 * task that module does not exist yet — every scenario that touches it fails
 * with "Cannot find module ... dashboard-assets-loader.ts" (missing
 * implementation), never a test-authoring bug.
 *
 * Contract under test (defined here; the paired implementation must honor
 * it verbatim):
 *
 *   export function loadDashboardAssets(
 *     modulePath?: string,
 *   ): Promise<
 *     | { available: true; manifest: DashboardAssetsManifest }
 *     | { available: false; reason: string }
 *   >;
 *
 *   interface DashboardAssetsManifest {
 *     stamp: { digest: string; builtAt: string; skipped?: boolean };
 *     entries: Record<
 *       string, // urlPath, e.g. "/index.html"
 *       { embedded: unknown; contentType: string; immutable: boolean }
 *     >;
 *   }
 *
 * `modulePath` is an optional TEST SEAM: when supplied, the loader performs
 * its guarded dynamic import against THAT path instead of the real
 * git-ignored `packages/lore/src/generated/dashboard-assets.ts`. The
 * injected fixture module must export `DASHBOARD_ASSETS_MANIFEST` matching
 * `DashboardAssetsManifest` above. The loader is responsible for turning a
 * filesystem path into a valid dynamic-import specifier (e.g. via
 * `pathToFileURL(path).href`) — callers pass a plain absolute path.
 *
 * Never throws: `{ available: false }` covers BOTH "module absent" and any
 * other guarded-import failure — the loader always resolves, it never
 * rejects and never lets a thrown error escape to the caller.
 *
 * The loader itself must have NO static import of the generated module (a
 * static `import` would break fresh-clone `bun run typecheck`, which never
 * builds the dashboard first) — enforced structurally by the third scenario
 * below (a source-level regex check that is deterministic regardless of
 * whether the generated module happens to exist in this checkout), and the
 * consequence (typecheck holding either way) is exercised end-to-end by the
 * fourth scenario. Neither scenario reads the generated module's on-disk
 * presence/absence as a precondition — see
 * knowledge-a-test-that-reads-its-precondition-from-ambient-state and
 * task-skill-test-sweep-the-ambient-precondition-class-dashboard for why:
 * `bun run build` is REQUIRED before any `.bun.test.ts` suite that spawns
 * `dist/lore` can run, so a "the generated module must be ABSENT" precondition
 * fails on every legitimately built checkout.
 */

import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { runProcessGroup } from "../integration/helpers/run-process-group";

// ─── Paths ──────────────────────────────────────────────────────────────────

// packages/lore/tests/unit/ -> repo root is four levels up.
const REPO_ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..", "..");

const LOADER_MODULE_PATH = join(
  REPO_ROOT,
  "packages",
  "lore",
  "src",
  "adapters",
  "http",
  "dashboard-assets-loader.ts",
);

// ─── Loader import (DYNAMIC, variable specifier) ───────────────────────────
//
// The loader module does not exist yet in this RED task. A *static* import
// specifier (`import { loadDashboardAssets } from "../../src/adapters/http/
// dashboard-assets-loader.js"`) would fail `bun run typecheck` outright
// (TS2307 "Cannot find module") rather than fail the *test*, which would
// violate this task's own AC-F5A-6-adjacent structural scenario (typecheck
// must stay green). Routing the specifier through a variable — the same
// pattern used by tests/unit/distribution/publish-pipeline.test.ts — keeps
// resolution entirely at runtime, so tsc never inspects it.

type LoadDashboardAssetsResult =
  | { available: true; manifest: unknown }
  | { available: false; reason: string };

type LoadDashboardAssetsFn = (modulePath?: string) => Promise<LoadDashboardAssetsResult>;

async function importLoader(): Promise<{ loadDashboardAssets: LoadDashboardAssetsFn }> {
  const mod = (await import(/* @vite-ignore */ LOADER_MODULE_PATH)) as {
    loadDashboardAssets?: LoadDashboardAssetsFn;
  };
  if (typeof mod.loadDashboardAssets !== "function") {
    throw new Error(
      "packages/lore/src/adapters/http/dashboard-assets-loader.ts must export loadDashboardAssets()",
    );
  }
  return { loadDashboardAssets: mod.loadDashboardAssets };
}

// ─── Fixture cleanup ────────────────────────────────────────────────────────

const fixtureDirs: string[] = [];

afterEach(() => {
  while (fixtureDirs.length > 0) {
    const dir = fixtureDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

function writeFixtureManifest(source: string): string {
  const dir = mkdtempSync(join(tmpdir(), "dashboard-assets-loader-fixture-"));
  fixtureDirs.push(dir);
  const modulePath = join(dir, "fixture-manifest.mjs");
  writeFileSync(modulePath, source, "utf8");
  return modulePath;
}

// ─── Scenarios ──────────────────────────────────────────────────────────────

describe("dashboard-assets-loader", () => {
  it("returns { available: false, reason } naming `bun run build` when the generated manifest module is absent, and never throws", async () => {
    const { loadDashboardAssets } = await importLoader();

    // Deterministic "absent" regardless of this checkout's build state: the
    // real generated path is git-ignored and only produced by `bun run
    // build`, but we don't want this scenario's pass/fail to depend on
    // whether a stray build happened to run earlier in this session.
    const absentDir = mkdtempSync(join(tmpdir(), "dashboard-assets-loader-absent-"));
    fixtureDirs.push(absentDir);
    const absentModulePath = join(absentDir, "does-not-exist.mjs");

    let thrown: unknown = null;
    let result: LoadDashboardAssetsResult | undefined;
    try {
      result = await loadDashboardAssets(absentModulePath);
    } catch (e) {
      thrown = e;
    }

    expect(thrown).toBeNull();
    expect(result).toBeDefined();
    expect(result?.available).toBe(false);
    if (result && !result.available) {
      expect(result.reason).toContain("bun run build");
    }
  });

  it("returns { available: true, manifest } exposing urlPath -> { embedded, contentType, immutable } and the build stamp { digest, builtAt } for a fixture manifest with two entries", async () => {
    const { loadDashboardAssets } = await importLoader();

    const fixtureModulePath = writeFixtureManifest(
      [
        "export const DASHBOARD_ASSETS_MANIFEST = {",
        '  stamp: { digest: "deadbeefcafe", builtAt: "2026-07-28T00:00:00.000Z" },',
        "  entries: {",
        '    "/index.html": { embedded: "index.html", contentType: "text/html", immutable: false },',
        '    "/assets/app-abc123.js": { embedded: "assets/app-abc123.js", contentType: "application/javascript", immutable: true },',
        "  },",
        "};",
        "",
      ].join("\n"),
    );

    const result = await loadDashboardAssets(fixtureModulePath);

    expect(result.available).toBe(true);
    if (result.available) {
      const manifest = result.manifest as {
        stamp: { digest: string; builtAt: string };
        entries: Record<string, { embedded: unknown; contentType: string; immutable: boolean }>;
      };

      expect(manifest.stamp.digest).toBe("deadbeefcafe");
      expect(manifest.stamp.builtAt).toBe("2026-07-28T00:00:00.000Z");

      expect(Object.keys(manifest.entries).sort()).toEqual([
        "/assets/app-abc123.js",
        "/index.html",
      ]);
      expect(manifest.entries["/index.html"]).toEqual({
        embedded: "index.html",
        contentType: "text/html",
        immutable: false,
      });
      expect(manifest.entries["/assets/app-abc123.js"]).toEqual({
        embedded: "assets/app-abc123.js",
        contentType: "application/javascript",
        immutable: true,
      });
    }
  });

  it("has no static import of the generated manifest module (source-level structural invariant — deterministic and independent of this checkout's build state, unlike an existsSync precondition)", () => {
    const source = readFileSync(LOADER_MODULE_PATH, "utf8");

    // A static ES import DECLARATION (`import ... from "...generated/
    // dashboard-assets..."` or a bare side-effect `import "...";`) would fail
    // `bun run typecheck` outright on a fresh clone (TS2307, module absent).
    // The loader's REAL production access path is a *dynamic* `import(...)`
    // expression with a literal string argument (required so `bun build
    // --compile` can statically discover and embed it — see this module's
    // doc comment) — that is deliberately NOT a static import declaration
    // and must NOT trip this check. The regex below only matches the
    // declaration form: `import` not immediately followed by `(`, eventually
    // reaching a quoted specifier that names the generated module.
    const staticImportOfGenerated =
      /^\s*import\s+(?!\()[^;]*?["'][^"']*generated\/dashboard-assets[^"']*["']/m;

    expect(staticImportOfGenerated.test(source)).toBe(false);
  });

  it(
    "bun run typecheck:lore exits 0 regardless of whether the generated manifest module exists in this checkout (the loader has no static import of it — verified by the prior scenario — so the fresh-clone typecheck contract holds identically before and after `bun run build`)",
    async () => {
      // reason: async on purpose (TG-15). A synchronous spawn blocks this vitest worker's event loop for the
      // whole typecheck (measured 76 s under an 8-worker run); past 60 s the worker cannot answer the
      // runner's RPC, vitest reports `Timeout calling "onTaskUpdate"` as an unhandled error and the run
      // exits 1 even though every test passed. Awaiting keeps the loop serving the runner.
      const env: Record<string, string> = {};
      for (const [k, v] of Object.entries(process.env)) if (v !== undefined) env[k] = v;
      // reason: `typecheck:lore` (tsc over packages/lore, the only project that contains the loader and could
      // raise TS2307 for an absent generated module), not the whole seven-project `typecheck` chain: the chain
      // took 34 s alone and over 110 s inside an 8-12 worker run, and the other six projects cannot see the
      // loader. The full chain is its own step of the release gate.
      const result = await runProcessGroup("bun", ["run", "typecheck:lore"], { cwd: REPO_ROOT, env, timeoutMs: 110_000 });

      if (result.exitCode !== 0) {
        throw new Error(
          `bun run typecheck:lore exited ${String(result.exitCode)}\n--- stdout ---\n${result.stdout}\n--- stderr ---\n${result.stderr}`,
        );
      }
      expect(result.exitCode).toBe(0);
    },
    120_000,
  );
});
