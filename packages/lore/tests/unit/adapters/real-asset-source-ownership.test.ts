// @reads assets/**
/**
 * @spec_ref SPEC-076 §C1 (ownership three-zone model), D8 (ownership is
 *   declared, never derived) — task-skill-implement-t2-ownership-schema-manifest-version,
 *   AC-076-6 (schema half): "every AssetFile RealAssetSource.load() returns
 *   carries a non-undefined ownership, and each (kind, ownership) pair is in
 *   the documented I6 legal set."
 *
 * `real-setup-ports.test.ts` (a pre-existing, out-of-anchor sibling suite)
 * already covers `RealAssetSource`'s kind/executable/path behavior in full —
 * this suite is DELIBERATELY narrow: it exists solely to pin the NEW
 * `ownership` behavior this task adds, without touching that file (its
 * anchors belong to a different task boundary; adding a sibling file avoids
 * any merge risk).
 *
 * Coverage:
 *   HAPPY:      RealAssetSource.load() against the real repo assets/ tree —
 *               every returned file carries ownership, and the FOUR walked
 *               kinds (skill/agent/hook/governance) are all "managed" while
 *               the synthetic settings.json is "merged".
 *   NEGATIVE:   an AssetFile constructed with an ownership string outside
 *               ASSET_OWNERSHIPS is rejected by assetFileSchema — proves the
 *               enumeration this suite performs is itself meaningful (the
 *               schema, not just this port, refuses garbage).
 *   BOUNDARY:   an empty declared subdirectory still yields zero WALKED files
 *               (no ownership assertion possible) plus the always-present,
 *               correctly-owned synthetic settings.json entry.
 *   ERROR:      (see real-setup-ports.test.ts's own ERROR suite for the
 *               missing-subdirectory err(STORE_ERROR) case — unaffected by
 *               this task, not re-pinned here to avoid duplicate coverage of
 *               a behavior this task did not change).
 *   STATE:      loading the SAME synthetic tree twice yields ownership-
 *               identical AssetFile sets both times (deterministic, no
 *               hidden mutable state across calls).
 *   REGRESSION: every returned AssetFile's (kind, ownership) pair is a member
 *               of the documented I6 legal set — enumerated exhaustively, so
 *               a future kind/ownership drift fails this test loudly instead
 *               of silently shipping an undocumented pairing.
 */

import { describe, it, expect } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { assetFileSchema, type AssetOwnership, type SetupEntryKind } from "@lore/core";

import { RealAssetSource } from "../../../src/adapters/real-asset-source.js";

const REPO_ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..", "..", "..");
const REPO_ASSETS_ROOT = join(REPO_ROOT, "assets");

/** SPEC-076 D8's I6 legal-pairing table, scoped to RealAssetSource (see setup-manifest.ts's module doc). */
const I6_LEGAL_PAIRS: Record<Exclude<SetupEntryKind, "mcp">, AssetOwnership> = {
  skill: "managed",
  agent: "managed",
  hook: "managed",
  governance: "managed",
  "settings-hook": "merged",
};

function makeScratchDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

// ─── HAPPY ──────────────────────────────────────────────────────────────────

describe("HAPPY: RealAssetSource.load() ownership — real repo assets/", () => {
  it("every returned AssetFile carries a non-undefined ownership", async () => {
    const source = new RealAssetSource(REPO_ASSETS_ROOT);
    const result = await source.load();
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.files.length).toBeGreaterThan(0);
    for (const file of result.value.files) {
      expect(file.ownership).toBeDefined();
    }
  });

  it("the four walked kinds are all 'managed'; the synthetic settings.json is 'merged'", async () => {
    const source = new RealAssetSource(REPO_ASSETS_ROOT);
    const result = await source.load();
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const nonSettings = result.value.files.filter((f) => f.path !== "settings.json");
    expect(nonSettings.length).toBeGreaterThan(0);
    for (const file of nonSettings) {
      expect(file.ownership).toBe("managed");
    }

    const settingsFiles = result.value.files.filter((f) => f.path === "settings.json");
    expect(settingsFiles).toHaveLength(1);
    expect(settingsFiles[0]?.ownership).toBe("merged");
  });
});

// ─── NEGATIVE ───────────────────────────────────────────────────────────────

describe("NEGATIVE: assetFileSchema rejects an ownership string outside ASSET_OWNERSHIPS", () => {
  it("rejects a file otherwise identical to a real RealAssetSource output but with a garbage ownership", async () => {
    const source = new RealAssetSource(REPO_ASSETS_ROOT);
    const result = await source.load();
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const sample = result.value.files[0];
    expect(sample).toBeDefined();
    if (sample === undefined) return;

    const tampered = { ...sample, ownership: "read-only-forever" };
    const parsed = assetFileSchema.safeParse(tampered);
    expect(parsed.success).toBe(false);
  });
});

// ─── BOUNDARY ───────────────────────────────────────────────────────────────

describe("BOUNDARY: empty declared subdirectory — zero walked files, correctly-owned synthetic entry", () => {
  it("an empty skills/ subdir yields zero skill files but a correctly-owned settings.json", async () => {
    const root = makeScratchDir("asset-source-ownership-empty-");
    try {
      mkdirSync(join(root, "skills"), { recursive: true });
      mkdirSync(join(root, "agents"), { recursive: true });
      mkdirSync(join(root, "hooks"), { recursive: true });
      mkdirSync(join(root, "governance"), { recursive: true });

      const source = new RealAssetSource(root);
      const result = await source.load();
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.value.files.map((f) => f.path)).toEqual(["settings.json"]);
      expect(result.value.files[0]?.ownership).toBe("merged");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

// ─── STATE ──────────────────────────────────────────────────────────────────

describe("STATE: ownership is deterministic across repeated loads of the same tree", () => {
  it("loading the same synthetic tree twice yields identical (path, ownership) pairs both times", async () => {
    const root = makeScratchDir("asset-source-ownership-state-");
    try {
      mkdirSync(join(root, "skills", "foo"), { recursive: true });
      mkdirSync(join(root, "agents"), { recursive: true });
      mkdirSync(join(root, "hooks"), { recursive: true });
      mkdirSync(join(root, "governance"), { recursive: true });
      writeFileSync(join(root, "skills", "foo", "SKILL.md"), "content");
      writeFileSync(join(root, "agents", "bar.md"), "content");

      const source = new RealAssetSource(root);
      const first = await source.load();
      const second = await source.load();
      expect(first.ok && second.ok).toBe(true);
      if (!first.ok || !second.ok) return;

      const pairsOf = (files: typeof first.value.files) =>
        files.map((f) => `${f.path}::${f.ownership}`).sort();

      expect(pairsOf(first.value.files)).toEqual(pairsOf(second.value.files));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

// ─── REGRESSION ─────────────────────────────────────────────────────────────

describe("REGRESSION: every (kind, ownership) pair RealAssetSource emits is in the documented I6 legal set", () => {
  it("real repo assets/ tree — exhaustive enumeration", async () => {
    const source = new RealAssetSource(REPO_ASSETS_ROOT);
    const result = await source.load();
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    for (const file of result.value.files) {
      const legalOwnership = I6_LEGAL_PAIRS[file.kind as Exclude<SetupEntryKind, "mcp">];
      expect(legalOwnership, `unexpected kind "${file.kind}" for path "${file.path}"`).toBeDefined();
      expect(file.ownership, `illegal (kind, ownership) pair for "${file.path}": (${file.kind}, ${file.ownership})`).toBe(
        legalOwnership,
      );
    }
  });

  it("synthetic mixed-kind tree — exhaustive enumeration", async () => {
    const root = makeScratchDir("asset-source-ownership-regression-");
    try {
      mkdirSync(join(root, "skills"), { recursive: true });
      mkdirSync(join(root, "agents"), { recursive: true });
      mkdirSync(join(root, "hooks"), { recursive: true });
      mkdirSync(join(root, "governance"), { recursive: true });
      writeFileSync(join(root, "skills", "SKILL.md"), "s");
      writeFileSync(join(root, "agents", "a.md"), "a");
      writeFileSync(join(root, "hooks", "h.sh"), "h");
      writeFileSync(join(root, "governance", "g.md"), "g");

      const source = new RealAssetSource(root);
      const result = await source.load();
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.value.files.length).toBe(5); // 4 walked + 1 synthetic settings.json
      for (const file of result.value.files) {
        const legalOwnership = I6_LEGAL_PAIRS[file.kind as Exclude<SetupEntryKind, "mcp">];
        expect(legalOwnership).toBeDefined();
        expect(file.ownership).toBe(legalOwnership);
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
