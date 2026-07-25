/**
 * Type declarations for embed-assets-manifest.mjs — hand-written companion
 * (TypeScript resolves this automatically for `.mjs` imports without
 * `allowJs`; see scripts/build.ts's import). Keep in sync with the JSDoc in
 * the .mjs file; this file has no runtime behavior of its own.
 */

export type AssetEntryKind = "skill" | "agent" | "hook" | "governance" | "project";
export type AssetOwnership = "managed" | "merged" | "user_once";

export interface EmbeddedAssetEntry {
  readonly path: string;
  readonly kind: AssetEntryKind;
  readonly ownership: AssetOwnership;
  readonly sha256: string;
}

export interface EmbeddedAssetsManifest {
  readonly binary_version: string;
  readonly tree_digest: string;
  readonly entries: readonly EmbeddedAssetEntry[];
}

export class AssetManifestError extends Error {}

export const REPO_ROOT: string;
export const ASSETS_ROOT: string;
export const GENERATED_FILE_PATH: string;
export const REGENERATE_COMMAND: string;

export const TOP_LEVEL_KIND_MAP: Record<string, AssetEntryKind>;
export const OWNERSHIP_OVERRIDES: Record<string, AssetOwnership>;

export function deriveOwnership(kind: AssetEntryKind, relPath: string): AssetOwnership;
export function sha256Hex(bytes: Buffer | string): string;
export function walkFilesRelative(dir: string): string[];
export function computeTreeDigest(entries: readonly EmbeddedAssetEntry[]): string;
export function resolveBinaryVersion(repoRoot: string): string;
export function buildManifest(assetsRoot: string, repoRoot: string): EmbeddedAssetsManifest;
export function renderGeneratedFile(manifest: EmbeddedAssetsManifest): string;
export function extractEmbeddedTreeDigest(generatedFileSource: string): string | undefined;
