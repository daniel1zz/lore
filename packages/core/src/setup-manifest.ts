/**
 * Setup manifest domain — the authoritative record of every file `lore setup`
 * has written into a Claude Code install directory, plus the PURE install
 * planner that decides writes/skips/backups/removals from that record. Pure,
 * browser-safe module: no IO, no `Date.now()`/`Math.random()` calls.
 *
 * Public surface:
 *   - setupEntryKindSchema / SetupEntryKind — the closed kind enum
 *   - ASSET_OWNERSHIPS / assetOwnershipSchema / AssetOwnership — the closed
 *     ownership enum (SPEC-076 D8: `"managed" | "merged" | "user_once"`)
 *   - setupEntrySchema / SetupEntry — one manifest row
 *   - setupManifestSchema / SetupManifest — the whole `.lore-setup-manifest.json`
 *     (SPEC-076 §C4 adds optional top-level `binary_version` / `installed_at` /
 *     `assets_digest`)
 *   - assetFileSchema / AssetFile, assetPayloadSchema / AssetPayload — the
 *     in-memory asset tree `planInstall` compares against disk state
 *   - PlannedWrite / PlannedSkip / InstallPlan — planner output row shapes
 *   - planInstall(current, payload, existingFiles) — the pure decision function
 *   - deriveOwnershipFromKind(kind) — legacy-manifest migration fallback ONLY
 *     (SPEC-076 §C4) — see its own doc comment for why this is NOT the
 *     primary ownership-assignment path
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
 *   - **SPEC-076 D8 — ownership is DECLARED, never DERIVED (I6 kind∩ownership
 *     legal-pairing table).** `ownership` on `assetFileSchema`/`setupEntrySchema`
 *     is OPTIONAL (additive — a pre-SPEC-076 manifest with no `ownership` on
 *     any entry, or an old binary that has never heard of this field, still
 *     parses byte-for-byte unchanged; I3 regression). It is set EXPLICITLY by
 *     whichever `AssetSource` constructs the `AssetFile`, at LOAD time — never
 *     inferred from `kind` in the primary path. `kind` is a TECHNICAL
 *     classification (which installer subsystem produced this file);
 *     `ownership` is an ORTHOGONAL operational policy (how an update should
 *     treat a diverged copy) — collapsing the two into a kind→ownership
 *     lookup is provably wrong: `flows/setup-project-flow.ts` (the project
 *     scaffold's OWN candidate-construction path, a separate `AssetSource`
 *     from the machine installer's) already tags `lore.tree.yaml` /
 *     `.gitignore` / `CLAUDE.md` with `kind: "governance"`, yet per SPEC-076's
 *     ownership table those three are `user_once` / `merged` / `merged` (the
 *     last a marker-segment special case, SPEC-076 T6) — NOT `managed`, which
 *     is what a kind-based lookup would (wrongly) assign every `"governance"`
 *     entry. The only LEGAL `(kind, ownership)` pairs this repo's real
 *     `AssetSource` implementations currently produce (recorded HERE, in
 *     `@lore/core`, rather than `packages/lore/src/service/setup-service.ts`'s
 *     own module header — that file's anchors belong to a concurrently-claimed
 *     sibling task, SPEC-076 T5; see `real-asset-source.ts`'s doc comment for
 *     the producer-scoped detail):
 *       - `RealAssetSource` (`packages/lore/src/adapters/real-asset-source.ts`,
 *         the MACHINE `~/.claude` installer's sole `AssetSource`):
 *         `skill → managed`, `agent → managed`, `hook → managed`,
 *         `governance → managed`, `settings-hook → merged`. (`kind: "mcp"` is
 *         a manifest-only entry `SetupService` constructs directly — never
 *         emitted by an `AssetSource` — out of this table's scope; stamping
 *         its `ownership: "managed"` is SPEC-076 T5's job.)
 *       - The project scaffold path (`setup-project-flow.ts`) does not yet
 *         declare `ownership` at all (out of THIS task's anchors) — its reuse
 *         of `kind: "governance"` for `user_once`/`merged`-policy files is
 *         exactly the counter-example above, proving this table must be keyed
 *         per PRODUCER, never by `kind` alone.
 *   - **The legacy-manifest fallback is a NAMED, DOCUMENTED exception, not a
 *     second derivation path.** `deriveOwnershipFromKind` exists ONLY for a
 *     manifest entry written before this field existed (no signal available
 *     except `kind`) — see its own doc comment for the full caveat. Every
 *     FRESH write goes through the explicit-declaration path above.
 *
 * Source: SPEC-046 §Design ("`@lore/core` (pure, browser-safe)"); SPEC-076
 *   §C1 (ownership three-zone model), §C4 (manifest version fields), D8.
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
 * The closed set of ownership zones a file/entry can belong to (SPEC-076 §C1
 * D8) — how an update should treat this path when its on-disk bytes diverge
 * from what lore last wrote:
 *   - `"managed"` — tool-owned, read-only distribution unit. Outdated →
 *     backup-then-overwrite; diverged → skipped-by-default + reported
 *     (`--force-diverged` to override).
 *   - `"merged"` — both parties co-own via a deterministic merge (e.g.
 *     `settings.json` via `mergeSettings`) — never a blind overwrite.
 *   - `"user_once"` — scaffolded once, then belongs to the user forever
 *     (e.g. a `config.yaml` template) — NEVER rewritten by a later converge.
 * See {@link setupEntrySchema}'s/`assetFileSchema`'s `ownership` field doc and
 * this module's top-level "ownership is DECLARED, never DERIVED" invariant
 * for the full kind∩ownership legal-pairing table.
 */
export const ASSET_OWNERSHIPS = ["managed", "merged", "user_once"] as const;

/** Zod schema for one {@link AssetOwnership}. */
export const assetOwnershipSchema = z.enum(ASSET_OWNERSHIPS);

/** Derived TypeScript union for an asset/manifest-entry's `ownership`. */
export type AssetOwnership = z.infer<typeof assetOwnershipSchema>;

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
  /**
   * OPTIONAL (SPEC-076 §C4, additive/I3-regression-safe) — this entry's
   * ownership zone. Absent on every manifest written before SPEC-076 (and on
   * any entry a future caller constructs without an opinion) — a reader that
   * needs a value for a legacy entry uses {@link deriveOwnershipFromKind} as a
   * one-time migration fallback, never a silent default baked into this
   * schema. See the module's top-level "ownership is DECLARED, never DERIVED"
   * invariant for why this is NOT inferred here from `kind`.
   */
  ownership: assetOwnershipSchema.optional(),
});

/** Derived TypeScript type for one manifest row. */
export type SetupEntry = z.infer<typeof setupEntrySchema>;

/**
 * What a project setup replaced OUTSIDE the files it owns, so `lore setup --project --uninstall` can put it back
 * (BR-834 / BR-837 / BR-845). Written only by the project ledger; absent on the machine-target manifest.
 *
 * - `hooks_path.prior` — git's `core.hooksPath` before the first setup (`null` = it was unset).
 * - `settings_language` — one row per project settings file that received a `language` key: whether the file and the
 *   key existed before the first setup, and the key's earlier value.
 */
export const projectPriorsSchema = z.object({
  hooks_path: z.object({ prior: z.string().nullable() }).optional(),
  settings_language: z
    .array(
      z.object({
        /** Repo-relative POSIX path of the settings file. */
        path: z.string().min(1),
        file_existed: z.boolean(),
        had_key: z.boolean(),
        /** The key's earlier value; meaningful only when `had_key`. */
        prior: z.unknown(),
      }),
    )
    .optional(),
});

/** Derived TypeScript type for {@link projectPriorsSchema}. */
export type ProjectPriors = z.infer<typeof projectPriorsSchema>;

/** The whole `<claude-dir>/.lore-setup-manifest.json` document. */
export const setupManifestSchema = z.object({
  /** Manifest schema version — opaque string, bumped on breaking shape changes. */
  version: z.string().min(1),
  /** The target directory this manifest describes (absolute path, as installed). */
  claude_dir: z.string().min(1),
  entries: z.array(setupEntrySchema),
  /**
   * OPTIONAL (SPEC-076 §C4, additive) — the `lore` binary version (embedded
   * `LORE_BINARY_VERSION` constant, SPEC-076 §C2) that produced this manifest,
   * stamped at the END of a successful converge (manifest-last discipline,
   * unchanged). Absent on every pre-SPEC-076 manifest and on a manifest whose
   * writer hasn't yet been upgraded to stamp it (SPEC-076 T5's job) — never
   * back-filled by this schema.
   */
  binary_version: z.string().min(1).optional(),
  /**
   * OPTIONAL (SPEC-076 §C4, additive) — ISO-8601 timestamp of the most recent
   * successful `lore setup` install/converge that touched this target.
   */
  installed_at: z.string().min(1).optional(),
  /**
   * OPTIONAL (SPEC-076 §C4, additive) — the embedded assets tree's
   * `tree_digest` (SPEC-076 §C2, `generated/assets-manifest.ts`) AS OF this
   * install/converge — the value `lore setup --check`'s digest-equality
   * short-circuit compares the CURRENTLY-embedded digest against.
   */
  assets_digest: z.string().min(1).optional(),
  /** OPTIONAL — earlier values a project setup replaced; see {@link projectPriorsSchema}. Project ledger only. */
  project_priors: projectPriorsSchema.optional(),
});

/** Derived TypeScript type for the whole manifest document. */
export type SetupManifest = z.infer<typeof setupManifestSchema>;

/**
 * One-time ownership DERIVATION for a legacy (pre-SPEC-076) manifest entry
 * that lacks the `ownership` field — `kind` is the only signal available.
 * This is a MIGRATION FALLBACK ONLY, never the primary assignment path: per
 * this module's "ownership is DECLARED, never DERIVED" invariant (SPEC-076
 * D8), a real `AssetSource` always sets `ownership` explicitly at load time.
 * The mapping below is scoped to `RealAssetSource` (the MACHINE `~/.claude`
 * installer) — it is NOT a universal kind→ownership truth: the project
 * scaffold's `AssetSource` reuses `kind: "governance"` for files whose real
 * ownership is `user_once`/`merged`, not `managed` (see this module's
 * top-level doc comment for the full counter-example). A caller reading a
 * legacy PROJECT-scope ledger should not use this function.
 *
 * The caller (the manifest-read seam SPEC-076 T5 wires into `SetupService`)
 * owns emitting the single one-time stderr migration notice this fallback's
 * existence implies — this function itself is silent and pure.
 *
 * @param kind - A manifest entry's `SetupEntryKind`, as produced by
 *   `RealAssetSource` (or `SetupService`'s own synthetic `"mcp"` entry).
 * @returns The best-effort {@link AssetOwnership} for that kind.
 * @throws Never.
 * @example
 * deriveOwnershipFromKind("skill"); // => "managed"
 * deriveOwnershipFromKind("settings-hook"); // => "merged"
 */
export function deriveOwnershipFromKind(kind: SetupEntryKind): AssetOwnership {
  switch (kind) {
    case "skill":
    case "agent":
    case "hook":
    case "governance":
    case "mcp":
      return "managed";
    case "settings-hook":
      return "merged";
    default: {
      // Unreachable — SetupEntryKind is a closed Zod enum (setupEntryKindSchema)
      // validated upstream; assigning `kind` to a `never`-typed const is a
      // compile-time exhaustiveness guard (mirrors outline-service.ts's
      // renderAcVerifyLine) that fails to build if a new kind is ever added
      // without updating this switch. "managed" is the SAFEST fallback
      // direction (D2: a managed, diverged file is never silently
      // overwritten, only skipped+reported) — never reached in practice.
      const _exhaustive: never = kind;
      void _exhaustive;
      return "managed";
    }
  }
}

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
  /**
   * OPTIONAL AT THE SCHEMA LEVEL (SPEC-076 §C4, additive/I3-regression-safe —
   * a caller constructing an `AssetFile` with no opinion, e.g. a pre-SPEC-076
   * asset source or `setup-project-flow.ts`'s own candidates, still
   * validates). NOT optional in practice for `RealAssetSource.load()`'s own
   * output — every file it returns sets this explicitly (see that module's
   * doc comment and this module's top-level "ownership is DECLARED, never
   * DERIVED" invariant for the full kind∩ownership legal-pairing table an
   * unknown/mistyped string here is rejected by {@link assetOwnershipSchema}
   * loud, at parse time, never silently defaulted).
   */
  ownership: assetOwnershipSchema.optional(),
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
   * RETIRED paths: tracked in `current`, absent from `payload`, and present on
   * disk byte-identical to the ledger sha (never edited) — safe to remove.
   */
  removals: string[];
  /**
   * Retired paths present on disk but EDITED since lore wrote them (sha differs
   * from the ledger). Treated as diverged (BR-818): kept, unless the caller opts
   * into backup-then-remove. A retired path absent from disk appears in neither list.
   */
  divergedRemovals: string[];
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
 * Retired paths (`current.entries` minus every path in `payload.files`) are split
 * by their on-disk sha: equal to the ledger → `removals`; different →
 * `divergedRemovals`; absent → neither. `existingFiles` therefore also carries
 * the on-disk sha of retired ledger paths (extra keys beyond the payload are inert
 * for the payload loop).
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
 * // => { writes: [{path: "skills/lore/SKILL.md", ...}], skips: [], backups: [], removals: [], divergedRemovals: [] }
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
  const removals: string[] = [];
  const divergedRemovals: string[] = [];
  for (const entry of current?.entries ?? []) {
    if (payloadPaths.has(entry.path)) continue;
    const onDiskSha = existingFiles.get(entry.path);
    if (onDiskSha === undefined) continue;
    (onDiskSha === entry.sha256 ? removals : divergedRemovals).push(entry.path);
  }

  return { writes, skips, backups, removals, divergedRemovals };
}
