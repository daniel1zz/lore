// @reads assets/**
// @reads packages/lore/package.json
// @reads packages/lore/src/generated/assets-manifest.ts
/**
 * @spec_ref SPEC-076 §C2, Downstream Handoff `EmbeddedAssetsManifest`
 *
 * Six-dimension coverage for scripts/embed-assets-manifest.mjs — the build-
 * time generator that walks assets/ and produces the git-tracked
 * packages/lore/src/generated/assets-manifest.ts constant `bun build
 * --compile` embeds into the binary. This suite exercises the generator's
 * PURE functions directly (imported from the .mjs file — `import.meta.main`
 * guards the CLI entrypoint so importing never writes anything or calls
 * `process.exit`); the CLI's exit-code contract (0/3) is separately pinned by
 * the shell-level oracle `bun scripts/embed-assets-manifest.mjs --check`
 * (AC-076-9).
 *
 * This test file is ALSO the "generated file exports are imported by
 * packages/lore" reachability proof (SPEC-076 T1's 5th task AC) — it imports
 * `EMBEDDED_ASSETS_MANIFEST` from the generated module directly.
 *
 * Coverage:
 *   HAPPY:      buildManifest() over the real repo assets/ tree produces a
 *               non-empty, sorted entry list whose tree_digest matches the
 *               digest embedded in the checked-in generated file (freshness);
 *               renderGeneratedFile's own output round-trips through
 *               extractEmbeddedTreeDigest to the same digest it was built
 *               from.
 *   NEGATIVE:   deriveOwnership returns the project/* overrides ("merged" /
 *               "user_once"), never the kind-level "managed" default, for
 *               the four overridden paths; an unregistered kind throws
 *               AssetManifestError (not a silent fallback).
 *   BOUNDARY:   computeTreeDigest is insensitive to input array order
 *               (shuffled entries produce the identical digest); the
 *               generated file's entries array is empty-tolerant in shape
 *               (a manifest with zero entries still renders and round-trips).
 *   ERROR:      buildManifest throws AssetManifestError (not silently
 *               returning an empty manifest) when a declared top-level
 *               directory is missing from a synthetic assetsRoot;
 *               resolveBinaryVersion throws when neither package.json
 *               exists under a synthetic repoRoot.
 *   STATE:      renderGeneratedFile(manifest) -> extractEmbeddedTreeDigest
 *               recovers exactly manifest.tree_digest, for both the real
 *               repo manifest and a small synthetic one.
 *   REGRESSION: two independent buildManifest() calls over the real repo
 *               assets/ tree produce byte-identical renderGeneratedFile()
 *               output (determinism — no timestamps, no walk-order leakage);
 *               this is the vitest-side twin of the file-level AC "regenerate
 *               twice with no assets change -> byte-identical".
 */

import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  ASSETS_ROOT,
  REPO_ROOT,
  GENERATED_FILE_PATH,
  AssetManifestError,
  buildManifest,
  renderGeneratedFile,
  extractEmbeddedTreeDigest,
  computeTreeDigest,
  deriveOwnership,
  resolveBinaryVersion,
  OWNERSHIP_OVERRIDES,
} from "../../../../../scripts/embed-assets-manifest.mjs";

import { EMBEDDED_ASSETS_MANIFEST } from "../../../src/generated/assets-manifest.js";

// ─── HAPPY ──────────────────────────────────────────────────────────────────

describe("embed-assets-manifest — HAPPY", () => {
  it("buildManifest() over the real assets/ tree produces a non-empty, path-sorted entry list", () => {
    const manifest = buildManifest(ASSETS_ROOT, REPO_ROOT);
    expect(manifest.entries.length).toBeGreaterThan(0);
    const paths = manifest.entries.map((e: { path: string }) => e.path);
    const sorted = [...paths].sort();
    expect(paths).toEqual(sorted);
  });

  it("the checked-in generated file's tree_digest matches a fresh recomputation over assets/ (freshness)", () => {
    const fresh = buildManifest(ASSETS_ROOT, REPO_ROOT);
    expect(EMBEDDED_ASSETS_MANIFEST.tree_digest).toBe(fresh.tree_digest);
  });

  it("the checked-in generated file's entries count matches a fresh recomputation over assets/", () => {
    const fresh = buildManifest(ASSETS_ROOT, REPO_ROOT);
    expect(EMBEDDED_ASSETS_MANIFEST.entries.length).toBe(fresh.entries.length);
  });

  it("renderGeneratedFile(manifest) round-trips through extractEmbeddedTreeDigest to the same digest", () => {
    const manifest = buildManifest(ASSETS_ROOT, REPO_ROOT);
    const rendered = renderGeneratedFile(manifest);
    expect(extractEmbeddedTreeDigest(rendered)).toBe(manifest.tree_digest);
  });
});

// ─── NEGATIVE ───────────────────────────────────────────────────────────────

describe("embed-assets-manifest — NEGATIVE", () => {
  it.each(Object.entries(OWNERSHIP_OVERRIDES) as Array<[string, string]>)(
    "deriveOwnership returns the override %s -> %s, never the kind-level 'managed' default",
    (path, expectedOwnership) => {
      expect(deriveOwnership("project", path)).toBe(expectedOwnership);
      expect(deriveOwnership("project", path)).not.toBe("managed");
    },
  );

  it("deriveOwnership throws AssetManifestError for an unregistered kind, never a silent fallback", () => {
    expect(() => deriveOwnership("nonexistent-kind" as never, "x/y.md")).toThrow(AssetManifestError);
  });

  it("a path NOT in OWNERSHIP_OVERRIDES falls back to the kind default, not to an override value", () => {
    expect(deriveOwnership("skill", "skills/lore/SKILL.md")).toBe("managed");
  });
});

// ─── BOUNDARY ───────────────────────────────────────────────────────────────

describe("embed-assets-manifest — BOUNDARY", () => {
  it("computeTreeDigest is insensitive to input array order", () => {
    const entries = [
      { path: "b/two.md", kind: "skill" as const, ownership: "managed" as const, sha256: "b".repeat(64) },
      { path: "a/one.md", kind: "skill" as const, ownership: "managed" as const, sha256: "a".repeat(64) },
      { path: "c/three.md", kind: "skill" as const, ownership: "managed" as const, sha256: "c".repeat(64) },
    ];
    const forward = computeTreeDigest(entries);
    const reversed = computeTreeDigest([...entries].reverse());
    expect(forward).toBe(reversed);
  });

  it("a zero-entry manifest still renders and round-trips its tree_digest", () => {
    const empty = { binary_version: "0.0.0-test", tree_digest: computeTreeDigest([]), entries: [] };
    const rendered = renderGeneratedFile(empty);
    expect(rendered).toContain("entries: [");
    expect(extractEmbeddedTreeDigest(rendered)).toBe(empty.tree_digest);
  });

  it("extractEmbeddedTreeDigest returns undefined for a source string with no tree_digest field", () => {
    expect(extractEmbeddedTreeDigest("export const x = 1;")).toBeUndefined();
  });
});

// ─── ERROR ──────────────────────────────────────────────────────────────────

describe("embed-assets-manifest — ERROR", () => {
  it("buildManifest throws AssetManifestError (not a silent empty manifest) when a declared top-level directory is missing", () => {
    const tmpRoot = mkdtempSync(join(tmpdir(), "embed-assets-manifest-error-"));
    try {
      // Only create 4 of the 5 declared top-level dirs — "project" is missing.
      for (const dir of ["skills", "agents", "hooks", "governance"]) {
        mkdirSync(join(tmpRoot, dir), { recursive: true });
        writeFileSync(join(tmpRoot, dir, "placeholder.md"), "x");
      }
      expect(() => buildManifest(tmpRoot, REPO_ROOT)).toThrow(AssetManifestError);
    } finally {
      rmSync(tmpRoot, { recursive: true, force: true });
    }
  });

  it("resolveBinaryVersion throws AssetManifestError when neither package.json declares a version", () => {
    const tmpRoot = mkdtempSync(join(tmpdir(), "embed-assets-manifest-noversion-"));
    try {
      mkdirSync(join(tmpRoot, "packages", "lore"), { recursive: true });
      // Neither <tmpRoot>/package.json nor <tmpRoot>/packages/lore/package.json exists.
      expect(() => resolveBinaryVersion(tmpRoot)).toThrow(AssetManifestError);
    } finally {
      rmSync(tmpRoot, { recursive: true, force: true });
    }
  });

  it("resolveBinaryVersion falls back to the root package.json when packages/lore/package.json has no version field", () => {
    const tmpRoot = mkdtempSync(join(tmpdir(), "embed-assets-manifest-fallback-"));
    try {
      mkdirSync(join(tmpRoot, "packages", "lore"), { recursive: true });
      writeFileSync(join(tmpRoot, "packages", "lore", "package.json"), JSON.stringify({ name: "no-version-here" }));
      writeFileSync(join(tmpRoot, "package.json"), JSON.stringify({ name: "root", version: "9.9.9" }));
      expect(resolveBinaryVersion(tmpRoot)).toBe("9.9.9");
    } finally {
      rmSync(tmpRoot, { recursive: true, force: true });
    }
  });
});

// ─── STATE ──────────────────────────────────────────────────────────────────

describe("embed-assets-manifest — STATE", () => {
  it("the on-disk generated file exists and its tree_digest is recoverable via extractEmbeddedTreeDigest", () => {
    expect(existsSync(GENERATED_FILE_PATH)).toBe(true);
    const source = readFileSync(GENERATED_FILE_PATH, "utf8");
    const digest = extractEmbeddedTreeDigest(source);
    expect(digest).toBe(EMBEDDED_ASSETS_MANIFEST.tree_digest);
  });

  it("a synthetic manifest's rendered source recovers its own tree_digest, independent of the real-repo case above", () => {
    const synthetic = {
      binary_version: "1.2.3",
      tree_digest: computeTreeDigest([
        { path: "skills/x/SKILL.md", kind: "skill" as const, ownership: "managed" as const, sha256: "f".repeat(64) },
      ]),
      entries: [{ path: "skills/x/SKILL.md", kind: "skill" as const, ownership: "managed" as const, sha256: "f".repeat(64) }],
    };
    const rendered = renderGeneratedFile(synthetic);
    expect(extractEmbeddedTreeDigest(rendered)).toBe(synthetic.tree_digest);
    expect(rendered).toContain('"1.2.3"');
  });
});

// ─── REGRESSION ─────────────────────────────────────────────────────────────

describe("embed-assets-manifest — REGRESSION", () => {
  it("two independent buildManifest() calls over the real repo assets/ tree render byte-identical output", () => {
    const first = renderGeneratedFile(buildManifest(ASSETS_ROOT, REPO_ROOT));
    const second = renderGeneratedFile(buildManifest(ASSETS_ROOT, REPO_ROOT));
    expect(first).toBe(second);
  });

  it("REGRESSION control: computeTreeDigest is NOT vacuously constant — different entries produce different digests", () => {
    const a = computeTreeDigest([{ path: "x", kind: "skill" as const, ownership: "managed" as const, sha256: "1".repeat(64) }]);
    const b = computeTreeDigest([{ path: "x", kind: "skill" as const, ownership: "managed" as const, sha256: "2".repeat(64) }]);
    expect(a).not.toBe(b);
  });
});
