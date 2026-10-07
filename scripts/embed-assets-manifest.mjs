#!/usr/bin/env bun
/**
 * Build-time asset manifest generator (SPEC-076 §C2, D1).
 *
 * Walks the repo's vendored `assets/{skills,agents,hooks,governance,project}/`
 * SSOT tree, computes a per-file sha256 plus a single sorted-pair tree digest,
 * and renders `packages/lore/src/generated/assets-manifest.ts` — a git-tracked,
 * deterministic TypeScript module exporting `EMBEDDED_ASSETS_MANIFEST`. That
 * generated module is what `bun build --compile` embeds into the `dist/lore`
 * binary (scripts/build.ts calls `buildManifest`/`renderGeneratedFile` from
 * this file BEFORE the compile step — see that file's doc comment, R1
 * mitigation). The binary's embedded `tree_digest` is the freshness truth
 * source for `lore setup --check` (five-state classification, SPEC-076 §C3) —
 * this script never reads or writes any install target, only `assets/`.
 *
 * Public surface (importable — used by scripts/build.ts and this package's
 * tests; the CLI entrypoint below only runs when this file is the direct
 * Bun entrypoint, guarded by `import.meta.main`):
 *   - buildManifest(assetsRoot, repoRoot) -> {binary_version, tree_digest, entries[]}
 *   - renderGeneratedFile(manifest) -> deterministic .ts source string
 *   - extractEmbeddedTreeDigest(generatedFileSource) -> string | undefined
 *   - computeTreeDigest(entries), sha256Hex(bytes), deriveOwnership(kind, path)
 *   - resolveBinaryVersion(repoRoot), walkFilesRelative(dir)
 *   - REPO_ROOT, ASSETS_ROOT, GENERATED_FILE_PATH, REGENERATE_COMMAND
 *
 * Invariants:
 *   - Deterministic: no timestamps, no `Math.random()`, no environment-
 *     dependent values other than `assets/`'s own bytes and the two
 *     `package.json` `version` fields. Two regenerations with unchanged
 *     `assets/` content produce byte-identical output (AC: regeneration
 *     determinism).
 *   - `tree_digest` is computed over `entries` SORTED by `path` — the walk
 *     order (filesystem `readdir` order) never leaks into the digest.
 *   - `sha256` is computed over each file's RAW BYTES (not utf8-decoded
 *     text) — `assets/` contains a mix of text and executable-bit scripts;
 *     hashing bytes uniformly avoids an encoding-dependent digest.
 *   - Ownership (`AssetOwnership`) is a LOCAL union in the generated file,
 *     not imported from `@lore/core` — SPEC-076 T2 (parallel task) is
 *     extending `@lore/core`'s schema with its own `AssetOwnership` type;
 *     this generator intentionally does not couple to that in-flight work.
 *     `deriveOwnership` maps kind -> "managed" by default, with explicit
 *     per-path overrides for the `project/` scaffold templates that are
 *     merged (`CLAUDE.md.template`, `gitignore.template`) or user-owned
 *     after first write (`lore-config-template.yaml`, `lore.tree.yaml.template`).
 *   - `--check` never writes; it recomputes the manifest from the CURRENT
 *     `assets/` tree and compares against the `tree_digest` embedded in the
 *     on-disk generated file (never a byte-for-byte file diff — the whole
 *     point of "digest is the freshness truth", SPEC-076 D1). Exit 0 on
 *     match, exit 3 (missing/corrupt/stale) with a stderr message naming the
 *     literal regeneration command — never silent.
 *
 * Side-effect class: IO (synchronous `node:fs` reads always; a single write
 * to `GENERATED_FILE_PATH` in default/non-check mode only).
 * Source: SPEC-076 §C2 + Downstream Handoff `EmbeddedAssetsManifest` type.
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** Thrown for domain-specific failures (missing dir, unparsable version, corrupt check target). */
export class AssetManifestError extends Error {
  constructor(message) {
    super(message);
    this.name = "AssetManifestError";
  }
}

// ─── Fixed locations (script lives at <repoRoot>/scripts/) ────────────────────

export const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
export const ASSETS_ROOT = join(REPO_ROOT, "assets");
export const GENERATED_FILE_PATH = join(REPO_ROOT, "packages", "lore", "src", "generated", "assets-manifest.ts");
export const REGENERATE_COMMAND = "bun scripts/embed-assets-manifest.mjs";

// ─── Kind + ownership classification ───────────────────────────────────────────

/** Top-level `assets/` subdirectory name -> the local `AssetEntryKind` its files are tagged with. */
export const TOP_LEVEL_KIND_MAP = {
  agents: "agent",
  governance: "governance",
  hooks: "hook",
  project: "project",
  skills: "skill",
};

/** Default ownership per kind (SPEC-076 §C1) — everything is "managed" unless overridden below. */
const DEFAULT_OWNERSHIP_BY_KIND = {
  agent: "managed",
  governance: "managed",
  hook: "managed",
  project: "managed",
  skill: "managed",
};

/**
 * Per-path ownership overrides — the `project/` scaffold templates that are
 * NOT plain "managed, only-lore-owns-this" files (SPEC-076 §C1 three-region
 * model). Keys are POSIX paths relative to `assets/`.
 */
export const OWNERSHIP_OVERRIDES = {
  "project/CLAUDE.md.template": "merged",
  "project/CLAUDE.md.skeleton": "user_once",
  "project/gitignore.template": "merged",
  "project/lore-config-template.yaml": "user_once",
  "project/lore.tree.yaml.template": "user_once",
};

/**
 * Resolves the ownership region for one asset file.
 * @param kind - The file's `AssetEntryKind` (from {@link TOP_LEVEL_KIND_MAP}).
 * @param relPath - POSIX path relative to `assets/` (e.g. `"project/pre-push"`).
 * @throws {AssetManifestError} if `kind` has no registered default (should be
 *   unreachable — `kind` always comes from `TOP_LEVEL_KIND_MAP`).
 */
export function deriveOwnership(kind, relPath) {
  const override = OWNERSHIP_OVERRIDES[relPath];
  if (override !== undefined) return override;
  const fallback = DEFAULT_OWNERSHIP_BY_KIND[kind];
  if (fallback === undefined) {
    throw new AssetManifestError(`deriveOwnership: no default ownership registered for kind "${kind}" (path: ${relPath}).`);
  }
  return fallback;
}

// ─── Hashing + tree walk ────────────────────────────────────────────────────────

/** Hex-encoded sha256 of raw bytes (a `Buffer` or a `string`, hashed as-is). */
export function sha256Hex(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

/** Recursively collects every regular file under `dir`, as POSIX paths relative to `dir` (sorted). */
export function walkFilesRelative(dir) {
  const out = [];
  const walk = (current, prefix) => {
    const dirents = readdirSync(current, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of dirents) {
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        walk(join(current, entry.name), rel);
      } else if (entry.isFile()) {
        out.push(rel);
      }
    }
  };
  walk(dir, "");
  return out;
}

/**
 * Computes the whole-tree digest: sha256 over `entries` SORTED by `path`,
 * each pair joined as `path sha256`, pairs newline-joined. Walk order
 * (filesystem-dependent) never affects the result.
 */
export function computeTreeDigest(entries) {
  const sorted = [...entries].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const joined = sorted.map((e) => `${e.path} ${e.sha256}`).join("\n");
  return sha256Hex(Buffer.from(joined, "utf8"));
}

// ─── Binary version resolution ─────────────────────────────────────────────────

/** Reads `<pkgJsonPath>`'s `version` field; returns `undefined` if the file or a non-empty string version is absent. */
function readPackageVersion(pkgJsonPath) {
  if (!existsSync(pkgJsonPath)) return undefined;
  const parsed = JSON.parse(readFileSync(pkgJsonPath, "utf8"));
  const version = parsed.version;
  return typeof version === "string" && version.length > 0 ? version : undefined;
}

/**
 * Resolves `LORE_BINARY_VERSION`: primarily `packages/lore/package.json`'s
 * `version`, falling back to the workspace root `package.json`'s `version`
 * if the former is absent/empty. Fails loud (never a silent `"0.0.0"`
 * default) if neither package.json declares a usable version.
 */
export function resolveBinaryVersion(repoRoot) {
  const lorePkgPath = join(repoRoot, "packages", "lore", "package.json");
  const rootPkgPath = join(repoRoot, "package.json");
  const loreVersion = readPackageVersion(lorePkgPath);
  if (loreVersion !== undefined) return loreVersion;
  const rootVersion = readPackageVersion(rootPkgPath);
  if (rootVersion !== undefined) return rootVersion;
  throw new AssetManifestError(
    `resolveBinaryVersion: no non-empty "version" field found in ${lorePkgPath} or ${rootPkgPath}.`,
  );
}

// ─── Manifest assembly ──────────────────────────────────────────────────────────

/**
 * Walks `assetsRoot`'s five declared top-level directories and assembles the
 * full in-memory manifest (never writes anything).
 * @throws {AssetManifestError} if a declared top-level directory is missing.
 */
export function buildManifest(assetsRoot, repoRoot) {
  const entries = [];
  for (const topDir of Object.keys(TOP_LEVEL_KIND_MAP).sort()) {
    const kind = TOP_LEVEL_KIND_MAP[topDir];
    const dirPath = join(assetsRoot, topDir);
    if (!existsSync(dirPath)) {
      throw new AssetManifestError(`buildManifest: declared asset directory missing: ${dirPath}`);
    }
    for (const relFile of walkFilesRelative(dirPath)) {
      const path = `${topDir}/${relFile}`;
      const bytes = readFileSync(join(dirPath, relFile));
      entries.push({ path, kind, ownership: deriveOwnership(kind, path), sha256: sha256Hex(bytes) });
    }
  }
  entries.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return {
    binary_version: resolveBinaryVersion(repoRoot),
    tree_digest: computeTreeDigest(entries),
    entries,
  };
}

// ─── Rendering ──────────────────────────────────────────────────────────────────

/** Renders the deterministic `assets-manifest.ts` source for `manifest`. */
export function renderGeneratedFile(manifest) {
  const entriesSrc = manifest.entries
    .map(
      (e) =>
        `  { path: ${JSON.stringify(e.path)}, kind: ${JSON.stringify(e.kind)}, ownership: ${JSON.stringify(e.ownership)}, sha256: ${JSON.stringify(e.sha256)} },`,
    )
    .join("\n");

  return `/**
 * AUTO-GENERATED by scripts/embed-assets-manifest.mjs — DO NOT HAND-EDIT.
 * Regenerate: \`${REGENERATE_COMMAND}\`
 * Verify freshness (never writes): \`${REGENERATE_COMMAND} --check\`
 *
 * The embedded asset manifest (SPEC-076 §C2) — a per-file sha256 plus a
 * whole-tree digest over the repo's vendored \`assets/\` SSOT, computed at
 * build time and compiled into the \`dist/lore\` binary by \`scripts/build.ts\`
 * (which calls this file BEFORE \`bun build --compile\`, never after). This is
 * the freshness truth source \`lore setup --check\` compares an installed
 * environment's manifest against (five-state classification, SPEC-076 §C3).
 *
 * \`ownership\` is a LOCAL union (not \`@lore/core\`'s in-flight
 * \`AssetOwnership\` type, SPEC-076 T2) — see scripts/embed-assets-manifest.mjs
 * for the kind -> ownership derivation rules.
 */

/** One of the five vendored top-level \`assets/\` directories. */
export type AssetEntryKind = "skill" | "agent" | "hook" | "governance" | "project";

/** Update-time handling region (SPEC-076 §C1) — see the generator's doc comment. */
export type AssetOwnership = "managed" | "merged" | "user_once";

/** One file in the embedded manifest. */
export interface EmbeddedAssetEntry {
  /** POSIX path relative to \`assets/\` (e.g. \`"skills/lore/SKILL.md"\`). */
  readonly path: string;
  readonly kind: AssetEntryKind;
  readonly ownership: AssetOwnership;
  /** Hex-encoded sha256 of the file's raw bytes. */
  readonly sha256: string;
}

/** The whole build-time asset manifest, embedded into the compiled binary. */
export interface EmbeddedAssetsManifest {
  /** The \`lore\` version that generated this manifest (package.json \`version\`). */
  readonly binary_version: string;
  /** sha256 over \`entries\` sorted by \`path\`, each pair joined as \`path\\0sha256\`. */
  readonly tree_digest: string;
  readonly entries: readonly EmbeddedAssetEntry[];
}

/** The \`lore\` version that generated this manifest. */
export const LORE_BINARY_VERSION = ${JSON.stringify(manifest.binary_version)} as const;

export const EMBEDDED_ASSETS_MANIFEST: EmbeddedAssetsManifest = {
  binary_version: LORE_BINARY_VERSION,
  tree_digest: ${JSON.stringify(manifest.tree_digest)},
  entries: [
${entriesSrc}
  ],
};
`;
}

/** Extracts the embedded `tree_digest` from a generated file's source text, or `undefined` if absent/corrupt. */
export function extractEmbeddedTreeDigest(generatedFileSource) {
  const match = generatedFileSource.match(/tree_digest:\s*"([0-9a-f]{64})"/);
  return match ? match[1] : undefined;
}

// ─── CLI entrypoint (guarded — inert when this module is imported) ────────────

/**
 * Runs the CLI: default mode regenerates+writes `GENERATED_FILE_PATH`;
 * `--check` recomputes and compares against the on-disk file's embedded
 * digest without writing (exit 0 match, exit 3 stale/missing/corrupt).
 * Calls `process.exit` — never call this from a test or from `scripts/build.ts`
 * (both should call `buildManifest`/`renderGeneratedFile` directly instead).
 */
function main() {
  const args = process.argv.slice(2);
  const checkMode = args.includes("--check");
  const unknown = args.filter((a) => a !== "--check");
  if (unknown.length > 0) {
    process.stderr.write(`embed-assets-manifest: unknown argument(s): ${unknown.join(", ")}\n`);
    process.exit(2);
    return;
  }

  const manifest = buildManifest(ASSETS_ROOT, REPO_ROOT);

  if (checkMode) {
    if (!existsSync(GENERATED_FILE_PATH)) {
      process.stderr.write(
        `embed-assets-manifest --check: generated file missing at ${GENERATED_FILE_PATH}. Regenerate with: ${REGENERATE_COMMAND}\n`,
      );
      process.exit(3);
      return;
    }
    const onDisk = readFileSync(GENERATED_FILE_PATH, "utf8");
    const embeddedDigest = extractEmbeddedTreeDigest(onDisk);
    if (embeddedDigest === undefined) {
      process.stderr.write(
        `embed-assets-manifest --check: could not find a tree_digest in ${GENERATED_FILE_PATH} (corrupt file). Regenerate with: ${REGENERATE_COMMAND}\n`,
      );
      process.exit(3);
      return;
    }
    if (embeddedDigest !== manifest.tree_digest) {
      process.stderr.write(
        `embed-assets-manifest --check: stale — embedded tree_digest ${embeddedDigest} != current ${manifest.tree_digest}. Regenerate with: ${REGENERATE_COMMAND}\n`,
      );
      process.exit(3);
      return;
    }
    process.stdout.write(`embed-assets-manifest --check: OK (${manifest.entries.length} files, tree_digest ${manifest.tree_digest}).\n`);
    process.exit(0);
    return;
  }

  mkdirSync(dirname(GENERATED_FILE_PATH), { recursive: true });
  writeFileSync(GENERATED_FILE_PATH, renderGeneratedFile(manifest), "utf8");
  process.stdout.write(
    `embed-assets-manifest: wrote ${GENERATED_FILE_PATH} (${manifest.entries.length} files, tree_digest ${manifest.tree_digest}).\n`,
  );
  process.exit(0);
}

// reason: `import.meta.main` is Bun's entrypoint flag (true only when this file
// is the direct `bun <file>` target) — `undefined`/falsy under Node/Vite's ESM
// loader when a test imports this module, so importing never triggers the CLI
// side effects (fs write, process.exit). See module doc "Public surface".
if (import.meta.main) {
  main();
}
