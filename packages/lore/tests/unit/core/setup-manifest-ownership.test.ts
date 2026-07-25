/**
 * @spec_ref SPEC-076 §C1 (ownership three-zone model), §C4 (manifest version
 *   fields, additive), D8 (ownership is declared, never derived) —
 *   task-skill-implement-t2-ownership-schema-manifest-version, AC-076-6
 *   (schema half).
 *
 * Six-dimension coverage for `@lore/core`'s `setup-manifest.ts` SPEC-076
 * additions: `assetOwnershipSchema`/`AssetOwnership`, the `ownership` field
 * on `assetFileSchema`/`setupEntrySchema`, `setupManifestSchema`'s new
 * top-level `binary_version`/`installed_at`/`assets_digest`, and the
 * `deriveOwnershipFromKind` legacy-manifest migration fallback.
 *
 * Coverage:
 *   HAPPY:      every `AssetOwnership` member round-trips through
 *               `assetFileSchema`/`setupEntrySchema`; a manifest with all
 *               three new top-level fields parses; `deriveOwnershipFromKind`
 *               returns the documented value for every kind.
 *   NEGATIVE:   an unknown/mistyped ownership string is REJECTED by both
 *               schemas — fail-loud, never silently defaulted (AC-076-6's
 *               "Zod rejects loud" requirement).
 *   BOUNDARY:   a pre-SPEC-076 manifest JSON (no `ownership` on any entry, no
 *               top-level version fields at all) still parses successfully
 *               (AC-076-6 "existing setup tests stay green" / I3 regression),
 *               and its parsed entries carry `ownership: undefined` (never a
 *               silently-injected default).
 *   ERROR:      `deriveOwnershipFromKind` never throws across every declared
 *               `SETUP_ENTRY_KINDS` member.
 *   STATE:      a `SetupEntry` constructed with an explicit `ownership`
 *               survives a JSON.stringify → JSON.parse → re-validate
 *               round-trip unchanged.
 *   REGRESSION: `setup-pure.test.ts`'s pre-existing ownership-less fixtures
 *               (no `ownership`, no manifest-level version fields) still
 *               validate byte-for-byte the same way after this change; the
 *               module stays free of Node builtins (browser-safety).
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import {
  ASSET_OWNERSHIPS,
  assetOwnershipSchema,
  assetFileSchema,
  setupEntrySchema,
  setupManifestSchema,
  deriveOwnershipFromKind,
  SETUP_ENTRY_KINDS,
  type AssetOwnership,
  type SetupEntryKind,
} from "@lore/core";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CORE_SRC_DIR = join(__dirname, "../../../../core/src");

// ─── HAPPY ──────────────────────────────────────────────────────────────────

describe("HAPPY: assetOwnershipSchema / ownership field", () => {
  it("assetOwnershipSchema accepts every ASSET_OWNERSHIPS member", () => {
    for (const ownership of ASSET_OWNERSHIPS) {
      expect(assetOwnershipSchema.safeParse(ownership).success).toBe(true);
    }
  });

  it("assetFileSchema accepts a well-formed AssetFile with each ownership value", () => {
    for (const ownership of ASSET_OWNERSHIPS) {
      const result = assetFileSchema.safeParse({
        path: "skills/lore/SKILL.md",
        kind: "skill",
        content: "x",
        sha256: "a".repeat(64),
        ownership,
      });
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.ownership).toBe(ownership);
    }
  });

  it("setupEntrySchema accepts a well-formed entry with each ownership value", () => {
    for (const ownership of ASSET_OWNERSHIPS) {
      const result = setupEntrySchema.safeParse({
        path: "skills/lore/SKILL.md",
        kind: "skill",
        sha256: "a".repeat(64),
        written_at: "2026-07-25T00:00:00.000Z",
        ownership,
      });
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.ownership).toBe(ownership);
    }
  });

  it("setupManifestSchema accepts binary_version/installed_at/assets_digest", () => {
    const result = setupManifestSchema.safeParse({
      version: "1",
      claude_dir: "/home/user/.claude",
      entries: [],
      binary_version: "0.2.1",
      installed_at: "2026-07-25T00:00:00.000Z",
      assets_digest: "b".repeat(64),
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.binary_version).toBe("0.2.1");
      expect(result.data.installed_at).toBe("2026-07-25T00:00:00.000Z");
      expect(result.data.assets_digest).toBe("b".repeat(64));
    }
  });

  it("deriveOwnershipFromKind returns the documented value for every declared kind", () => {
    const expected: Record<SetupEntryKind, AssetOwnership> = {
      skill: "managed",
      agent: "managed",
      hook: "managed",
      governance: "managed",
      mcp: "managed",
      "settings-hook": "merged",
    };
    for (const kind of SETUP_ENTRY_KINDS) {
      expect(deriveOwnershipFromKind(kind)).toBe(expected[kind]);
    }
  });
});

// ─── NEGATIVE ───────────────────────────────────────────────────────────────

describe("NEGATIVE: unknown ownership is rejected loud, never silently defaulted", () => {
  it("assetOwnershipSchema rejects an unknown string", () => {
    const result = assetOwnershipSchema.safeParse("not-a-real-ownership");
    expect(result.success).toBe(false);
  });

  it("assetFileSchema rejects an AssetFile with an unknown ownership string", () => {
    const result = assetFileSchema.safeParse({
      path: "skills/lore/SKILL.md",
      kind: "skill",
      content: "x",
      sha256: "a".repeat(64),
      ownership: "readonly", // not a member of ASSET_OWNERSHIPS
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const ownershipIssue = result.error.issues.find((issue) => issue.path.includes("ownership"));
      expect(ownershipIssue).toBeDefined();
    }
  });

  it("setupEntrySchema rejects a manifest entry with an unknown ownership string", () => {
    const result = setupEntrySchema.safeParse({
      path: "skills/lore/SKILL.md",
      kind: "skill",
      sha256: "a".repeat(64),
      written_at: "2026-07-25T00:00:00.000Z",
      ownership: "shared", // not a member of ASSET_OWNERSHIPS
    });
    expect(result.success).toBe(false);
  });

  it("setupManifestSchema rejects a non-string assets_digest (wrong type, not just wrong value)", () => {
    const result = setupManifestSchema.safeParse({
      version: "1",
      claude_dir: "/tmp/x",
      entries: [],
      assets_digest: 12345,
    });
    expect(result.success).toBe(false);
  });
});

// ─── BOUNDARY ───────────────────────────────────────────────────────────────

describe("BOUNDARY: pre-SPEC-076 manifest (no ownership, no version fields) still parses (I3 regression)", () => {
  it("a legacy manifest JSON with zero new fields parses successfully", () => {
    const legacyManifest = {
      version: "1",
      claude_dir: "/home/user/.claude",
      entries: [
        { path: "skills/lore/SKILL.md", kind: "skill", sha256: "a".repeat(64), written_at: "2026-01-01T00:00:00.000Z" },
        { path: "settings.json", kind: "settings-hook", sha256: "b".repeat(64), written_at: "2026-01-01T00:00:00.000Z" },
      ],
    };
    const result = setupManifestSchema.safeParse(legacyManifest);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.binary_version).toBeUndefined();
    expect(result.data.installed_at).toBeUndefined();
    expect(result.data.assets_digest).toBeUndefined();
    for (const entry of result.data.entries) {
      expect(entry.ownership).toBeUndefined();
    }
  });

  it("a legacy AssetFile with no ownership opinion still validates", () => {
    const result = assetFileSchema.safeParse({
      path: "hooks/pre-push",
      kind: "hook",
      content: "#!/bin/sh\n",
      sha256: "c".repeat(64),
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.ownership).toBeUndefined();
  });
});

// ─── ERROR ──────────────────────────────────────────────────────────────────

describe("ERROR: deriveOwnershipFromKind never throws", () => {
  it("never throws across every declared SETUP_ENTRY_KINDS member", () => {
    for (const kind of SETUP_ENTRY_KINDS) {
      expect(() => deriveOwnershipFromKind(kind)).not.toThrow();
    }
  });

  it("always returns a value that is itself a valid AssetOwnership (round-trips through the schema)", () => {
    for (const kind of SETUP_ENTRY_KINDS) {
      const ownership = deriveOwnershipFromKind(kind);
      expect(assetOwnershipSchema.safeParse(ownership).success).toBe(true);
    }
  });
});

// ─── STATE ──────────────────────────────────────────────────────────────────

describe("STATE: ownership survives a JSON round-trip unchanged", () => {
  it("a SetupEntry with ownership: 'merged' survives stringify -> parse -> re-validate", () => {
    const original = setupEntrySchema.parse({
      path: "settings.json",
      kind: "settings-hook",
      sha256: "d".repeat(64),
      written_at: "2026-07-25T00:00:00.000Z",
      ownership: "merged",
    });

    const roundTripped: unknown = JSON.parse(JSON.stringify(original));
    const reparsed = setupEntrySchema.safeParse(roundTripped);

    expect(reparsed.success).toBe(true);
    if (reparsed.success) expect(reparsed.data.ownership).toBe("merged");
  });

  it("a full manifest with version fields + mixed ownership entries round-trips unchanged", () => {
    const manifest = setupManifestSchema.parse({
      version: "1",
      claude_dir: "/tmp/x",
      entries: [
        { path: "skills/a/SKILL.md", kind: "skill", sha256: "e".repeat(64), written_at: "2026-07-25T00:00:00.000Z", ownership: "managed" },
        { path: "settings.json", kind: "settings-hook", sha256: "f".repeat(64), written_at: "2026-07-25T00:00:00.000Z", ownership: "merged" },
      ],
      binary_version: "0.3.0",
      installed_at: "2026-07-25T00:00:00.000Z",
      assets_digest: "g".repeat(64),
    });

    const roundTripped: unknown = JSON.parse(JSON.stringify(manifest));
    expect(roundTripped).toEqual(manifest);
    expect(setupManifestSchema.safeParse(roundTripped).success).toBe(true);
  });
});

// ─── REGRESSION ─────────────────────────────────────────────────────────────

describe("REGRESSION: pre-existing ownership-less fixtures + browser-safety", () => {
  it("setup-pure.test.ts's own fixture shape (entries with no ownership, manifest with no version fields) still validates", () => {
    // Mirrors setup-pure.test.ts's HAPPY fixtures verbatim — proves this
    // task's additive fields did not tighten the schema for pre-existing callers.
    const entryResult = setupEntrySchema.safeParse({
      path: "skills/lore/SKILL.md",
      kind: "skill",
      sha256: "a".repeat(64),
      written_at: "2026-07-16T00:00:00.000Z",
    });
    expect(entryResult.success).toBe(true);

    const manifestResult = setupManifestSchema.safeParse({
      version: "1",
      claude_dir: "/home/user/.claude",
      entries: [],
    });
    expect(manifestResult.success).toBe(true);
  });

  it("setup-manifest.ts imports no Node builtins (unchanged by this task's additions)", () => {
    const src = readFileSync(join(CORE_SRC_DIR, "setup-manifest.ts"), "utf-8");
    const NODE_BUILTIN_IMPORT = /from\s+["'](?:node:)?(fs|path|os|child_process)["']/;
    expect(NODE_BUILTIN_IMPORT.test(src)).toBe(false);
  });

  it("ASSET_OWNERSHIPS has exactly the three documented members, in stable order", () => {
    expect(ASSET_OWNERSHIPS).toEqual(["managed", "merged", "user_once"]);
  });
});
