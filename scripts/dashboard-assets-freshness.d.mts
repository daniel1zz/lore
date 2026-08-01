/**
 * Type declarations for dashboard-assets-freshness.mjs — hand-written
 * companion (TypeScript resolves this automatically for `.mjs` imports
 * without `allowJs`; see scripts/build.ts's import). Keep in sync with the
 * JSDoc in the .mjs file; this file has no runtime behavior of its own.
 */

export class DashboardAssetsFreshnessError extends Error {}

export const DASHBOARD_SHORT_CIRCUIT_MARKER: string;
export const DASHBOARD_BUILD_START_MARKER: string;

export function sha256Hex(bytes: Buffer | string): string;
export function walkFilesRelative(dir: string): string[];

export function computeDashboardSourceDigest(
  dashboardSrcDir: string,
  dashboardViteConfigPath: string,
  dashboardPkgJsonPath: string,
): string;

export function extractEmbeddedDashboardDigest(source: string): string | undefined;
export function dashboardDistIsPresent(distDir: string): boolean;

export const DASHBOARD_CONTENT_TYPE_BY_EXT: Record<string, string>;
export function contentTypeForDistPath(relPath: string): string;

export interface DashboardAssetsStamp {
  readonly digest: string;
  readonly builtAt: string;
  readonly skipped?: boolean;
}

export interface DashboardAssetsPaths {
  readonly dashboardDistDir: string;
  readonly generatedFilePath: string;
}

export function renderDashboardAssetsModule(
  distFiles: readonly string[],
  stamp: DashboardAssetsStamp,
  paths: DashboardAssetsPaths,
): string;

export function writeDashboardAssetsModule(
  stamp: DashboardAssetsStamp,
  paths: DashboardAssetsPaths,
): { distFileCount: number };

export function extractManifestSpecifiers(source: string): string[];

export interface ManifestResolvability {
  readonly resolvable: boolean;
  readonly reason: string;
  readonly missing: readonly string[];
}

export function manifestReferencesResolvable(generatedFilePath: string): ManifestResolvability;

export interface ShortCircuitArgs {
  readonly existingDigest: string | undefined;
  readonly freshDigest: string;
  readonly dashboardDistDir: string;
  readonly generatedFilePath: string;
}

export interface ShortCircuitDecision {
  readonly shortCircuit: boolean;
  readonly reason: string;
}

export function shouldShortCircuitDashboardBuild(args: ShortCircuitArgs): ShortCircuitDecision;

export interface RunViteResult {
  readonly status: number | null;
}

export interface RunDashboardAssetsStepArgs {
  readonly dashboardSrcDir: string;
  readonly dashboardViteConfigPath: string;
  readonly dashboardPkgJsonPath: string;
  readonly dashboardDistDir: string;
  readonly generatedFilePath: string;
  readonly skipDashboardBuild: boolean;
  readonly runVite: () => RunViteResult;
  readonly onBeforeRebuild?: (decision: ShortCircuitDecision) => void;
  readonly now?: () => string;
}

export interface DashboardBuildStepResult {
  readonly action: "skipped" | "short-circuited" | "rebuilt";
  readonly reason: string;
  /** Present for "skipped"/"rebuilt" — the freshly-written manifest's dist file count. */
  readonly distFileCount?: number;
  /** Present for "skipped"/"rebuilt" — the digest just written into the manifest's stamp. */
  readonly digest?: string;
}

export function runDashboardAssetsStep(args: RunDashboardAssetsStepArgs): DashboardBuildStepResult;
