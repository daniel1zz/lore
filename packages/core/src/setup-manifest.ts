/**
 * Setup manifest domain — the authoritative record of every file `lore setup`
 * has written into a Claude Code install directory, plus the PURE install
 * planner that decides writes/skips/backups/removals from that record. Pure,
 * browser-safe module: no IO, no `Date.now()`/`Math.random()` calls.
 *
 * Public surface:
 *   - setupEntryKindSchema / SetupEntryKind — the closed kind enum
 *   - setupEntrySchema / SetupEntry — one manifest row
 *   - setupManifestSchema / SetupManifest — the whole `.lore-setup-manifest.json`
 *   - assetFileSchema / AssetFile, assetPayloadSchema / AssetPayload — the
 *     in-memory asset tree `planInstall` compares against disk state
 *   - PlannedWrite / PlannedSkip / InstallPlan — planner output row shapes
 *   - planInstall(current, payload, existingFiles) — the pure decision function
 *
 * Invariants:
 *   - PURE — `planInstall` takes only in-memory parameters (a manifest, a
 *     payload, and a caller-supplied sha256 map of on-disk bytes). It never
 *     reads the filesystem itself; the fs-reading happens in the service layer
 *     (`SetupService`, which owns the `SetupFsReader` port) and the resulting
 *     `existingFiles` map is handed in here already resolved. This mirrors the
 *     `file-anchors.ts` / `staleness.ts` precedent of keeping the decision
 *     logic testable with plain objects, no fs fixture required.
 *   - `sha256` on a manifest entry is defined as the digest of the FINAL
 *     on-disk bytes, i.e. POST-MERGE for a `settings-hook` target (whose
 *     on-disk content is `mergeSettings`'s output, not the raw payload) —
 *     never the raw asset payload bytes. This is the invariant the future
 *     three-way upgrade diff depends on (SPEC-046 I5). `planInstall` itself is
 *     digest-agnostic: it only ever compares caller-supplied sha256 strings for
 *     equality, never computes one — hashing is a service-layer concern (this
 *     module has zero crypto dependency, keeping it usable from a browser
 *     bundle without a WebCrypto polyfill).
 *   - A byte-identical target (payload sha === current on-disk sha) is a
 *     `skip`, never a `write` — this is SPEC-046's I2 re-run-idempotency
 *     invariant's pure half.
 *   - A target path present on disk (i.e. a key in `existingFiles`) that is
 *     NOT already tracked by `current`'s entries is foreign, user-owned
 *     content — if its sha differs from the payload's, it is backed up before
 *     being overwritten (recorded in `InstallPlan.backups`). A path already
 *     tracked by `current` is lore-owned and is overwritten without a backup
 *     (the manifest itself is the source of truth for "lore wrote this").
 *
 * Source: SPEC-046 §Design ("`@lore/core` (pure, browser-safe)").
 */

import { z } from "zod";

// ─── Manifest schema ────────────────────────────────────────────────────────

/** The closed set of asset kinds `lore setup` may write. */
export const SETUP_ENTRY_KINDS = [
  "skill",
  "agent",
  "hook",
  "governance",
  "settings-hook",
  "mcp",
] as const;

/** Zod schema for one {@link SetupEntryKind}. */
export const setupEntryKindSchema = z.enum(SETUP_ENTRY_KINDS);

/** Derived TypeScript union for a manifest entry's `kind`. */
export type SetupEntryKind = z.infer<typeof setupEntryKindSchema>;

/**
 * One row of the setup manifest — a single path `lore setup` has written (or,
 * for `kind: "mcp"`, a registration it performed with no corresponding file).
 *
 * @invariant `sha256` is the digest of the FINAL on-disk bytes (post-merge for
 *   `settings-hook`), never the raw payload. See module invariants above.
 */
export const setupEntrySchema = z.object({
  /** Path relative to the target `claude-dir`, POSIX separators. */
  path: z.string().min(1),
  kind: setupEntryKindSchema,
  /** Hex-encoded sha256 of the final on-disk bytes (see module invariants). */
  sha256: z.string().min(1),
  /** ISO-8601 timestamp of the write. */
  written_at: z.string().min(1),
});

/** Derived TypeScript type for one manifest row. */
export type SetupEntry = z.infer<typeof setupEntrySchema>;

/** The whole `<claude-dir>/.lore-setup-manifest.json` document. */
export const setupManifestSchema = z.object({
  /** Manifest schema version — opaque string, bumped on breaking shape changes. */
  version: z.string().min(1),
  /** The target directory this manifest describes (absolute path, as installed). */
  claude_dir: z.string().min(1),
  entries: z.array(setupEntrySchema),
});

/** Derived TypeScript type for the whole manifest document. */
export type SetupManifest = z.infer<typeof setupManifestSchema>;

// ─── Asset payload (planner input) ─────────────────────────────────────────

/** One asset file to be installed, as loaded from the asset SSOT tree. */
export const assetFileSchema = z.object({
  /** Path relative to the target `claude-dir`, POSIX separators. */
  path: z.string().min(1),
  kind: setupEntryKindSchema,
  /** File content, as a string (text assets only — SPEC-046 P0/P1 scope). */
  content: z.string(),
  /**
   * Hex-encoded sha256 of `content` as it will land on disk for this kind.
   * For non-merge kinds (skill/agent/hook/governance/mcp) this is the raw
   * payload digest. For `settings-hook`, the CALLER (service layer) must
   * compute this over `mergeSettings`'s merged output, not `content` itself —
   * `content` for a `settings-hook` entry is advisory/unused by the planner,
   * present only so `AssetPayload` has one uniform row shape.
   */
  sha256: z.string().min(1),
  /**
   * OPTIONAL — the source file's on-disk owner-execute bit, as read by an
   * `AssetSource` implementation (e.g. `RealAssetSource`,
   * `packages/lore/src/adapters/real-asset-source.ts`). Present (`true`) only
   * when the bit is set — omitted rather than `false`, so a legacy/synthetic
   * `AssetFile` with no opinion on executability still validates. Declared
   * here as a minimal, additive (REGRESSION-safe) field: `SetupService.install`
   * does not yet consume it (it independently hardcodes `executable: true`
   * for every `kind: "hook"` write — see that module's doc comment) — this
   * field exists so a real asset source can report the fact without the
   * schema rejecting it, ahead of `SetupService` being wired to read it.
   */
  executable: z.boolean().optional(),
});

/** Derived TypeScript type for one asset payload file. */
export type AssetFile = z.infer<typeof assetFileSchema>;

/** The full in-memory set of assets a `lore setup` run intends to install. */
export const assetPayloadSchema = z.object({
  files: z.array(assetFileSchema),
});

/** Derived TypeScript type for the asset payload. */
export type AssetPayload = z.infer<typeof assetPayloadSchema>;

// ─── Planner output ─────────────────────────────────────────────────────────

/** One file the planner decided must be written (new content differs from on-disk). */
export interface PlannedWrite {
  path: string;
  kind: SetupEntryKind;
  content: string;
  sha256: string;
}

/** One file the planner decided is already correct — byte-identical, no write needed. */
export interface PlannedSkip {
  path: string;
  kind: SetupEntryKind;
  sha256: string;
}

/**
 * The full pure decision output of {@link planInstall}.
 *
 * @invariant `writes`, `skips`, `backups`, and `removals` are mutually
 *   exclusive over `path` — WITHIN one payload, a path appears in at most one
 *   of the four buckets (a path in `backups` is also, by construction, present
 *   in `writes` — see {@link planInstall} doc comment).
 */
export interface InstallPlan {
  writes: PlannedWrite[];
  skips: PlannedSkip[];
  /** Paths requiring a pre-write backup (subset of `writes`' paths — see invariant). */
  backups: string[];
  /**
   * Paths tracked in `current` but absent from `payload` — entries a future
   * uninstall/removal pass should remove. P1 payloads are currently a
   * superset-stable asset list (no asset is ever dropped between releases),
   * so this is typically empty; the field exists so the shape is stable for
   * when that changes.
   */
  removals: string[];
}

// ─── Planner ────────────────────────────────────────────────────────────────

/**
 * Pure install planner (SPEC-046 §Design, invariants I2/I5's pure half).
 *
 * Decision per payload file `f`:
 *   1. `existingFiles` has no entry for `f.path` → not on disk at all → `write`,
 *      no backup (nothing to preserve).
 *   2. `existingFiles.get(f.path) === f.sha256` → on-disk bytes already match
 *      the intended final bytes → `skip` (I2 idempotency).
 *   3. Otherwise, on-disk bytes differ from the intended final bytes → `write`,
 *      AND that path is also pushed to `backups` — regardless of whether
 *      `current` already tracks it as lore-owned, because ANY differing
 *      on-disk content is worth preserving before being overwritten (a lore
 *      entry may have been hand-edited by the user since the last run).
 *
 * `removals` is `current.entries` minus every path present in `payload.files`
 * (lore-tracked paths that a payload no longer declares).
 *
 * @param current - The manifest from the target's last successful `lore
 *   setup` run, or `null` on a first-ever install (no prior state).
 * @param payload - The asset set this run intends to install.
 * @param existingFiles - Map of `path → sha256` for every payload path that
 *   currently exists on disk (paths absent from this map are treated as
 *   "not on disk"). Caller-supplied — this function never touches the fs.
 * @returns The full write/skip/backup/removal decision, never throws.
 *
 * @example
 * planInstall(null, { files: [{ path: "skills/lore/SKILL.md", kind: "skill", content: "x", sha256: "abc" }] }, new Map());
 * // => { writes: [{path: "skills/lore/SKILL.md", ...}], skips: [], backups: [], removals: [] }
 */
export function planInstall(
  current: SetupManifest | null,
  payload: AssetPayload,
  existingFiles: Map<string, string>,
): InstallPlan {
  const writes: PlannedWrite[] = [];
  const skips: PlannedSkip[] = [];
  const backups: string[] = [];

  for (const file of payload.files) {
    const onDiskSha = existingFiles.get(file.path);

    if (onDiskSha === undefined) {
      // Not on disk at all — plain write, nothing to back up.
      writes.push({ path: file.path, kind: file.kind, content: file.content, sha256: file.sha256 });
      continue;
    }

    if (onDiskSha === file.sha256) {
      // Byte-identical to the intended final content — I2 idempotency skip.
      skips.push({ path: file.path, kind: file.kind, sha256: file.sha256 });
      continue;
    }

    // On-disk content differs — write, and preserve the old bytes first.
    writes.push({ path: file.path, kind: file.kind, content: file.content, sha256: file.sha256 });
    backups.push(file.path);
  }

  const payloadPaths = new Set(payload.files.map((f) => f.path));
  const removals = (current?.entries ?? [])
    .map((e) => e.path)
    .filter((path) => !payloadPaths.has(path));

  return { writes, skips, backups, removals };
}
