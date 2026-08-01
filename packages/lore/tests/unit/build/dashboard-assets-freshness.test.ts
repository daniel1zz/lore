/**
 * @spec_ref spec-dashboard-production-packaging-one-command-lore-dashboard
 *   (DD-1), task-a-stale-untracked-dashboard-assets-ts-breaks-every
 *
 * Six-dimension coverage for scripts/dashboard-assets-freshness.mjs — the
 * dashboard build's freshness/short-circuit decision logic, extracted out
 * of scripts/build.ts so it can be exercised without spawning a real
 * `bun run --filter '@lore/dashboard' build` (see that module's doc comment
 * for the full defect narrative).
 *
 * The defect: the pre-fix short-circuit trusted "dashboard SOURCE digest
 * unchanged + dist/ non-empty" as sufficient evidence that a previously
 * generated `dashboard-assets.ts` manifest was still valid. It is not:
 * `vite build` always empties+rewrites `dist/` with FRESH content-hashed
 * filenames on every invocation, including one that later aborts for a
 * reason unrelated to the dashboard source (observed: a `prebuild`
 * router-codegen step failing AFTER vite's own build had already
 * completed). The manifest never got regenerated, dist/ held new hashes
 * the old manifest didn't mention, and — since nothing hand-written had
 * changed — every subsequent build re-matched the same digest and took the
 * short-circuit forever, permanently skipping the one thing (regeneration)
 * that would fix it.
 *
 * The fix ("cannot happen", not "fails legibly" — see
 * shouldShortCircuitDashboardBuild's doc comment): the short-circuit gate
 * additionally verifies, via plain `existsSync`, that every file the
 * EXISTING manifest references still exists on disk — ground truth, not a
 * digest proxy. Whenever that fails, a rebuild is forced, which always ends
 * by regenerating the manifest from dist's CURRENT listing.
 *
 * Coverage:
 *   HAPPY:      shouldShortCircuitDashboardBuild takes the short-circuit
 *               (and runVite is never invoked) when digest matches, dist is
 *               present, and every manifest-referenced file still exists;
 *               computeDashboardSourceDigest/renderDashboardAssetsModule
 *               are deterministic; contentTypeForDistPath maps common
 *               extensions.
 *   NEGATIVE:   a source-digest mismatch forces a rebuild regardless of
 *               dist/manifest state; extractEmbeddedDashboardDigest and
 *               manifestReferencesResolvable degrade to "not found"/"no
 *               entries" rather than throwing on a corrupt/absent input;
 *               extractManifestSpecifiers never invents matches from a
 *               source with no file-embed imports.
 *   BOUNDARY:   the interrupted-build reproduction — a manifest matching an
 *               OLDER dist state survives a source-digest match (nothing
 *               hand-written changed) while dist/ is silently rewritten to
 *               a NEWER state by an unrelated process (exactly how
 *               scripts/build.ts's own aborted `runVite()` call would leave
 *               things): the short-circuit correctly refuses, naming
 *               "dashboard-assets.ts" and the missing hash — never a
 *               phrase of a bundler's own resolution error — and a
 *               follow-up runDashboardAssetsStep() call self-heals the
 *               manifest against the CURRENT dist without any manual `rm`.
 *   ERROR:      runDashboardAssetsStep throws DashboardAssetsFreshnessError
 *               (never a silent partial write) for: `--skip-dashboard` with
 *               no existing dist, a non-zero runVite() status (and the
 *               stale manifest is left UNTOUCHED, not partially rewritten),
 *               and a post-build empty dist; computeDashboardSourceDigest
 *               throws (not a silent empty digest) for a missing required
 *               path.
 *   STATE:      writeDashboardAssetsModule's post-write digest round-trips
 *               exactly through extractEmbeddedDashboardDigest; after a
 *               forced "stale-manifest" rebuild, the VERY NEXT
 *               shouldShortCircuitDashboardBuild call (same source digest)
 *               short-circuits again — the original build-tax-control
 *               contract survives the fix.
 *   REGRESSION: two independent renderDashboardAssetsModule() calls with
 *               identical inputs render byte-identical output (no
 *               timestamps/walk-order leakage); REGRESSION control —
 *               different distFiles render different output (not a
 *               vacuously constant renderer).
 */

import { describe, it, expect, vi } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  DashboardAssetsFreshnessError,
  computeDashboardSourceDigest,
  extractEmbeddedDashboardDigest,
  dashboardDistIsPresent,
  contentTypeForDistPath,
  renderDashboardAssetsModule,
  writeDashboardAssetsModule,
  extractManifestSpecifiers,
  manifestReferencesResolvable,
  shouldShortCircuitDashboardBuild,
  runDashboardAssetsStep,
  walkFilesRelative,
} from "../../../../../scripts/dashboard-assets-freshness.mjs";

// ─── Fixture helpers ────────────────────────────────────────────────────────

/** Sets up a fresh tmp fixture mirroring the real repo layout's shape (src / vite.config.ts / package.json / dist / generated). */
function makeFixture() {
  const root = mkdtempSync(join(tmpdir(), "dashboard-assets-freshness-"));
  const dashboardSrcDir = join(root, "dashboard-src");
  const dashboardViteConfigPath = join(root, "vite.config.ts");
  const dashboardPkgJsonPath = join(root, "package.json");
  const dashboardDistDir = join(root, "dashboard-dist");
  const generatedFilePath = join(root, "lore-generated", "dashboard-assets.ts");

  mkdirSync(dashboardSrcDir, { recursive: true });
  writeFileSync(join(dashboardSrcDir, "App.tsx"), "export const App = () => null;\n");
  writeFileSync(dashboardViteConfigPath, "export default {};\n");
  writeFileSync(dashboardPkgJsonPath, JSON.stringify({ name: "fixture" }));

  return { root, dashboardSrcDir, dashboardViteConfigPath, dashboardPkgJsonPath, dashboardDistDir, generatedFilePath };
}

/** Wipes and rewrites `distDir` with `files` (relPath -> content) — simulates vite's own empty+rewrite behavior. */
function rewriteDist(distDir: string, files: Record<string, string>) {
  rmSync(distDir, { recursive: true, force: true });
  mkdirSync(distDir, { recursive: true });
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(distDir, rel);
    mkdirSync(join(abs, ".."), { recursive: true });
    writeFileSync(abs, content);
  }
}

function cleanup(root: string) {
  rmSync(root, { recursive: true, force: true });
}

// ─── HAPPY ──────────────────────────────────────────────────────────────────

describe("dashboard-assets-freshness — HAPPY", () => {
  it("shortCircuit is true when digest matches, dist is present, and every manifest reference resolves", () => {
    const f = makeFixture();
    try {
      rewriteDist(f.dashboardDistDir, { "index.html": "<html></html>", "assets/index-AAA.js": "console.log(1)" });
      const digest = computeDashboardSourceDigest(f.dashboardSrcDir, f.dashboardViteConfigPath, f.dashboardPkgJsonPath);
      writeDashboardAssetsModule({ digest, builtAt: "2026-01-01T00:00:00.000Z" }, {
        dashboardDistDir: f.dashboardDistDir,
        generatedFilePath: f.generatedFilePath,
      });

      const decision = shouldShortCircuitDashboardBuild({
        existingDigest: digest,
        freshDigest: digest,
        dashboardDistDir: f.dashboardDistDir,
        generatedFilePath: f.generatedFilePath,
      });
      expect(decision.shortCircuit).toBe(true);
    } finally {
      cleanup(f.root);
    }
  });

  it("runDashboardAssetsStep never calls runVite when the short-circuit applies", () => {
    const f = makeFixture();
    try {
      rewriteDist(f.dashboardDistDir, { "index.html": "<html></html>" });
      const digest = computeDashboardSourceDigest(f.dashboardSrcDir, f.dashboardViteConfigPath, f.dashboardPkgJsonPath);
      writeDashboardAssetsModule({ digest, builtAt: "2026-01-01T00:00:00.000Z" }, {
        dashboardDistDir: f.dashboardDistDir,
        generatedFilePath: f.generatedFilePath,
      });

      const runVite = vi.fn(() => ({ status: 0 }));
      const result = runDashboardAssetsStep({
        dashboardSrcDir: f.dashboardSrcDir,
        dashboardViteConfigPath: f.dashboardViteConfigPath,
        dashboardPkgJsonPath: f.dashboardPkgJsonPath,
        dashboardDistDir: f.dashboardDistDir,
        generatedFilePath: f.generatedFilePath,
        skipDashboardBuild: false,
        runVite,
      });

      expect(result.action).toBe("short-circuited");
      expect(runVite).not.toHaveBeenCalled();
    } finally {
      cleanup(f.root);
    }
  });

  it("computeDashboardSourceDigest is deterministic across repeated calls over the same fixture", () => {
    const f = makeFixture();
    try {
      const a = computeDashboardSourceDigest(f.dashboardSrcDir, f.dashboardViteConfigPath, f.dashboardPkgJsonPath);
      const b = computeDashboardSourceDigest(f.dashboardSrcDir, f.dashboardViteConfigPath, f.dashboardPkgJsonPath);
      expect(a).toBe(b);
      expect(a).toMatch(/^[0-9a-f]{64}$/);
    } finally {
      cleanup(f.root);
    }
  });

  it.each([
    ["index.html", "text/html"],
    ["assets/index-AAA.js", "application/javascript"],
    ["assets/index-AAA.css", "text/css"],
    ["assets/logo.svg", "image/svg+xml"],
  ])("contentTypeForDistPath(%s) -> %s", (relPath, expected) => {
    expect(contentTypeForDistPath(relPath)).toBe(expected);
  });
});

// ─── NEGATIVE ───────────────────────────────────────────────────────────────

describe("dashboard-assets-freshness — NEGATIVE", () => {
  it("a source-digest mismatch forces a rebuild regardless of dist/manifest state", () => {
    const f = makeFixture();
    try {
      rewriteDist(f.dashboardDistDir, { "assets/index-AAA.js": "x" });
      writeDashboardAssetsModule({ digest: "0".repeat(64), builtAt: "2026-01-01T00:00:00.000Z" }, {
        dashboardDistDir: f.dashboardDistDir,
        generatedFilePath: f.generatedFilePath,
      });

      const decision = shouldShortCircuitDashboardBuild({
        existingDigest: "0".repeat(64),
        freshDigest: "1".repeat(64),
        dashboardDistDir: f.dashboardDistDir,
        generatedFilePath: f.generatedFilePath,
      });
      expect(decision.shortCircuit).toBe(false);
      expect(decision.reason).toBe("digest-mismatch-or-no-prior-manifest");
    } finally {
      cleanup(f.root);
    }
  });

  it("extractEmbeddedDashboardDigest returns undefined for a corrupt/digest-less source, never throws", () => {
    expect(extractEmbeddedDashboardDigest("export const x = 1;")).toBeUndefined();
  });

  it("manifestReferencesResolvable reports no-manifest for an absent file, never throws", () => {
    const result = manifestReferencesResolvable("/definitely/does/not/exist/dashboard-assets.ts");
    expect(result.resolvable).toBe(false);
    expect(result.reason).toBe("no-manifest");
  });

  it("extractManifestSpecifiers returns [] for a source with no file-embed imports (never invents matches)", () => {
    expect(extractManifestSpecifiers("export const x = { entries: {} };")).toEqual([]);
  });

  it("walkFilesRelative returns [] for a nonexistent directory, never throws", () => {
    expect(walkFilesRelative("/definitely/does/not/exist")).toEqual([]);
    expect(dashboardDistIsPresent("/definitely/does/not/exist")).toBe(false);
  });
});

// ─── BOUNDARY (the interrupted-build reproduction) ─────────────────────────

describe("dashboard-assets-freshness — BOUNDARY: interrupted build leaves dist/manifest out of sync", () => {
  it("reproduces the defect's arisal: build 1 succeeds, build 2's vite step rewrites dist with a NEW hash but never regenerates the manifest (simulating the abort-after-vite scenario) — the short-circuit must refuse, naming dashboard-assets.ts and the missing file, never a bundler phrase", () => {
    const f = makeFixture();
    try {
      // Build 1 (prior successful build): dist has hash A, manifest written to match.
      rewriteDist(f.dashboardDistDir, { "assets/index-AAAAAAAA.js": "console.log('A')" });
      const digest = computeDashboardSourceDigest(f.dashboardSrcDir, f.dashboardViteConfigPath, f.dashboardPkgJsonPath);
      writeDashboardAssetsModule({ digest, builtAt: "2026-01-01T00:00:00.000Z" }, {
        dashboardDistDir: f.dashboardDistDir,
        generatedFilePath: f.generatedFilePath,
      });
      // Sanity: build 1's own manifest resolves against build 1's own dist.
      expect(manifestReferencesResolvable(f.generatedFilePath).resolvable).toBe(true);

      // Build 2 (interrupted): vite already emptied+rewrote dist with a NEW
      // hash by the time the overall invocation aborted for an unrelated
      // reason (e.g. a prebuild codegen step) — scripts/build.ts's own
      // `runDashboardAssetsStep` never reached `writeDashboardAssetsModule`
      // in that run, so the on-disk manifest STILL says hash A. Nothing
      // hand-written changed, so the source digest is identical.
      rewriteDist(f.dashboardDistDir, { "assets/index-BBBBBBBB.js": "console.log('B')" });
      const freshDigestAfterInterruption = computeDashboardSourceDigest(
        f.dashboardSrcDir,
        f.dashboardViteConfigPath,
        f.dashboardPkgJsonPath,
      );
      expect(freshDigestAfterInterruption).toBe(digest); // nothing hand-written changed

      const decision = shouldShortCircuitDashboardBuild({
        existingDigest: digest,
        freshDigest: freshDigestAfterInterruption,
        dashboardDistDir: f.dashboardDistDir,
        generatedFilePath: f.generatedFilePath,
      });

      expect(decision.shortCircuit).toBe(false);
      // Assert on the filename substring, not a phrase of the bundler's own
      // "Could not resolve" error (task AC-1).
      expect(decision.reason).toContain("dashboard-assets.ts");
      expect(decision.reason).toContain("index-AAAAAAAA.js");
      expect(decision.reason).not.toContain("Could not resolve");
    } finally {
      cleanup(f.root);
    }
  });

  it("the next build after an interruption self-heals via runDashboardAssetsStep, with no manual rm — AC-1's 'succeeds by regenerating' disjunct", () => {
    const f = makeFixture();
    try {
      // Build 1: successful, manifest matches hash A.
      rewriteDist(f.dashboardDistDir, { "assets/index-AAAAAAAA.js": "console.log('A')" });
      const digest = computeDashboardSourceDigest(f.dashboardSrcDir, f.dashboardViteConfigPath, f.dashboardPkgJsonPath);
      writeDashboardAssetsModule({ digest, builtAt: "2026-01-01T00:00:00.000Z" }, {
        dashboardDistDir: f.dashboardDistDir,
        generatedFilePath: f.generatedFilePath,
      });

      // Build 2 interrupted: dist rewritten to hash B, manifest left stale at hash A.
      rewriteDist(f.dashboardDistDir, { "assets/index-BBBBBBBB.js": "console.log('B')" });
      expect(manifestReferencesResolvable(f.generatedFilePath).resolvable).toBe(false);

      // Build 3 (the very next `bun run build`): runVite simulates the
      // retried vite build succeeding and rewriting dist to hash C — never
      // pre-seeded, always the RESULT of the injected runner, exactly what
      // the real spawnSync-backed runVite would do.
      const runVite = vi.fn(() => {
        rewriteDist(f.dashboardDistDir, { "assets/index-CCCCCCCC.js": "console.log('C')" });
        return { status: 0 };
      });

      const result = runDashboardAssetsStep({
        dashboardSrcDir: f.dashboardSrcDir,
        dashboardViteConfigPath: f.dashboardViteConfigPath,
        dashboardPkgJsonPath: f.dashboardPkgJsonPath,
        dashboardDistDir: f.dashboardDistDir,
        generatedFilePath: f.generatedFilePath,
        skipDashboardBuild: false,
        runVite,
      });

      expect(result.action).toBe("rebuilt");
      expect(result.reason).toContain("stale-manifest");
      expect(runVite).toHaveBeenCalledTimes(1);

      // No manual `rm` occurred anywhere in this test — the manifest now
      // resolves against the CURRENT (hash C) dist, entirely via the step's
      // own regeneration.
      const healed = manifestReferencesResolvable(f.generatedFilePath);
      expect(healed.resolvable).toBe(true);
      const source = readFileSync(f.generatedFilePath, "utf8");
      expect(source).toContain("index-CCCCCCCC.js");
      expect(source).not.toContain("index-AAAAAAAA.js");
      expect(source).not.toContain("index-BBBBBBBB.js");
    } finally {
      cleanup(f.root);
    }
  });
});

// ─── ERROR ──────────────────────────────────────────────────────────────────

describe("dashboard-assets-freshness — ERROR", () => {
  it("runDashboardAssetsStep throws DashboardAssetsFreshnessError for --skip-dashboard with no existing dist", () => {
    const f = makeFixture();
    try {
      expect(() =>
        runDashboardAssetsStep({
          dashboardSrcDir: f.dashboardSrcDir,
          dashboardViteConfigPath: f.dashboardViteConfigPath,
          dashboardPkgJsonPath: f.dashboardPkgJsonPath,
          dashboardDistDir: f.dashboardDistDir, // never created in this test
          generatedFilePath: f.generatedFilePath,
          skipDashboardBuild: true,
          runVite: () => {
            throw new Error("runVite must not be called on the --skip-dashboard error path");
          },
        }),
      ).toThrow(DashboardAssetsFreshnessError);
    } finally {
      cleanup(f.root);
    }
  });

  it("a non-zero runVite status throws DashboardAssetsFreshnessError naming the exit code, and leaves the stale manifest UNTOUCHED (never a partial write)", () => {
    const f = makeFixture();
    try {
      rewriteDist(f.dashboardDistDir, { "assets/index-AAAAAAAA.js": "console.log('A')" });
      const digest = computeDashboardSourceDigest(f.dashboardSrcDir, f.dashboardViteConfigPath, f.dashboardPkgJsonPath);
      writeDashboardAssetsModule({ digest, builtAt: "2026-01-01T00:00:00.000Z" }, {
        dashboardDistDir: f.dashboardDistDir,
        generatedFilePath: f.generatedFilePath,
      });
      const beforeSource = readFileSync(f.generatedFilePath, "utf8");

      // Force past the short-circuit via a digest mismatch (simulating "source changed").
      rewriteDist(f.dashboardDistDir, { "assets/index-BBBBBBBB.js": "console.log('B')" });
      writeFileSync(join(f.dashboardSrcDir, "New.tsx"), "export const New = () => null;\n");

      expect(() =>
        runDashboardAssetsStep({
          dashboardSrcDir: f.dashboardSrcDir,
          dashboardViteConfigPath: f.dashboardViteConfigPath,
          dashboardPkgJsonPath: f.dashboardPkgJsonPath,
          dashboardDistDir: f.dashboardDistDir,
          generatedFilePath: f.generatedFilePath,
          skipDashboardBuild: false,
          runVite: () => ({ status: 1 }),
        }),
      ).toThrow(/exited 1/);

      const afterSource = readFileSync(f.generatedFilePath, "utf8");
      expect(afterSource).toBe(beforeSource);
    } finally {
      cleanup(f.root);
    }
  });

  it("a runVite that reports success but leaves dist empty throws DashboardAssetsFreshnessError", () => {
    const f = makeFixture();
    try {
      expect(() =>
        runDashboardAssetsStep({
          dashboardSrcDir: f.dashboardSrcDir,
          dashboardViteConfigPath: f.dashboardViteConfigPath,
          dashboardPkgJsonPath: f.dashboardPkgJsonPath,
          dashboardDistDir: f.dashboardDistDir,
          generatedFilePath: f.generatedFilePath,
          skipDashboardBuild: false,
          runVite: () => ({ status: 0 }), // never creates dist
        }),
      ).toThrow(DashboardAssetsFreshnessError);
    } finally {
      cleanup(f.root);
    }
  });

  it("computeDashboardSourceDigest throws (never a silent empty digest) when a required path is missing", () => {
    const f = makeFixture();
    try {
      expect(() =>
        computeDashboardSourceDigest(f.dashboardSrcDir, join(f.root, "does-not-exist-vite.config.ts"), f.dashboardPkgJsonPath),
      ).toThrow();
    } finally {
      cleanup(f.root);
    }
  });
});

// ─── STATE ──────────────────────────────────────────────────────────────────

describe("dashboard-assets-freshness — STATE", () => {
  it("writeDashboardAssetsModule's post-write digest round-trips exactly via extractEmbeddedDashboardDigest", () => {
    const f = makeFixture();
    try {
      rewriteDist(f.dashboardDistDir, { "assets/index-AAAAAAAA.js": "x" });
      const digest = computeDashboardSourceDigest(f.dashboardSrcDir, f.dashboardViteConfigPath, f.dashboardPkgJsonPath);
      writeDashboardAssetsModule({ digest, builtAt: "2026-01-01T00:00:00.000Z" }, {
        dashboardDistDir: f.dashboardDistDir,
        generatedFilePath: f.generatedFilePath,
      });
      const roundTripped = extractEmbeddedDashboardDigest(readFileSync(f.generatedFilePath, "utf8"));
      expect(roundTripped).toBe(digest);
    } finally {
      cleanup(f.root);
    }
  });

  it("the build-tax-control contract survives the fix: a rebuild forced by a stale manifest heals to a state where the VERY NEXT decision short-circuits again", () => {
    const f = makeFixture();
    try {
      rewriteDist(f.dashboardDistDir, { "assets/index-AAAAAAAA.js": "console.log('A')" });
      const digest = computeDashboardSourceDigest(f.dashboardSrcDir, f.dashboardViteConfigPath, f.dashboardPkgJsonPath);
      writeDashboardAssetsModule({ digest, builtAt: "2026-01-01T00:00:00.000Z" }, {
        dashboardDistDir: f.dashboardDistDir,
        generatedFilePath: f.generatedFilePath,
      });

      // Interruption: dist rewritten, manifest stale.
      rewriteDist(f.dashboardDistDir, { "assets/index-BBBBBBBB.js": "console.log('B')" });

      const runVite = vi.fn(() => ({ status: 0 })); // vite already "ran" (dist is as-is); nothing further to rewrite here
      const healRun = runDashboardAssetsStep({
        dashboardSrcDir: f.dashboardSrcDir,
        dashboardViteConfigPath: f.dashboardViteConfigPath,
        dashboardPkgJsonPath: f.dashboardPkgJsonPath,
        dashboardDistDir: f.dashboardDistDir,
        generatedFilePath: f.generatedFilePath,
        skipDashboardBuild: false,
        runVite,
      });
      expect(healRun.action).toBe("rebuilt");

      const freshDigestNow = computeDashboardSourceDigest(f.dashboardSrcDir, f.dashboardViteConfigPath, f.dashboardPkgJsonPath);
      const existingDigestNow = extractEmbeddedDashboardDigest(readFileSync(f.generatedFilePath, "utf8"));
      const nextDecision = shouldShortCircuitDashboardBuild({
        existingDigest: existingDigestNow,
        freshDigest: freshDigestNow,
        dashboardDistDir: f.dashboardDistDir,
        generatedFilePath: f.generatedFilePath,
      });
      expect(nextDecision.shortCircuit).toBe(true);
    } finally {
      cleanup(f.root);
    }
  });
});

// ─── REGRESSION ─────────────────────────────────────────────────────────────

describe("dashboard-assets-freshness — REGRESSION", () => {
  it("two independent renderDashboardAssetsModule() calls with identical inputs render byte-identical output", () => {
    const paths = { dashboardDistDir: "/fixture/dist", generatedFilePath: "/fixture/generated/dashboard-assets.ts" };
    const stamp = { digest: "a".repeat(64), builtAt: "2026-01-01T00:00:00.000Z" };
    const distFiles = ["index.html", "assets/index-AAA.js"];
    const first = renderDashboardAssetsModule(distFiles, stamp, paths);
    const second = renderDashboardAssetsModule(distFiles, stamp, paths);
    expect(first).toBe(second);
  });

  it("REGRESSION control: different distFiles render different output (not a vacuously constant renderer)", () => {
    const paths = { dashboardDistDir: "/fixture/dist", generatedFilePath: "/fixture/generated/dashboard-assets.ts" };
    const stamp = { digest: "a".repeat(64), builtAt: "2026-01-01T00:00:00.000Z" };
    const a = renderDashboardAssetsModule(["index.html"], stamp, paths);
    const b = renderDashboardAssetsModule(["index.html", "assets/index-AAA.js"], stamp, paths);
    expect(a).not.toBe(b);
  });
});
