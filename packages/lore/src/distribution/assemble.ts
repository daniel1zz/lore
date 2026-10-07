/**
 * Pure PublishPlan assembler for the npm single-platform publish pipeline
 * (SPEC-048 Scope IN #3, #5; Design D3, D4, D5, D6, D7).
 *
 * Public surface:
 *   - PlatformDescriptor — structural mirror of `scripts/platform-map.ts`'s
 *     exported `PlatformDescriptor` shape. Deliberately NOT imported: this
 *     module lives under `packages/lore/src/`, whose `tsconfig.json` pins
 *     `rootDir: "src"` — a static import of a repo-root `scripts/*.ts` file
 *     would sit outside that rootDir and fail `tsc` with TS6059. A workspace
 *     package must not depend on repo-root tooling scripts regardless (a
 *     published npm tarball never ships `scripts/`). Kept in lockstep with
 *     the real shape by structural typing (TS duck-types objects, so any
 *     real `PlatformDescriptor` from `platform-map.ts` is assignable here
 *     with zero adapter code) — the same convention already established by
 *     `tests/unit/distribution/platform-map.test.ts`'s own structural mirror.
 *   - BuildPublishPlanInput — the `buildPublishPlan` argument shape.
 *   - PublishPlan / GeneratedPackageJson — the return shape: a staging
 *     destination→source file map plus the generated npm package.json object.
 *   - buildPublishPlan(input) — Result-returning pure builder. Target-
 *     parameterized from day one (D7): P2 (this repo, today) calls it once
 *     per publish with the current machine's platform; P3 loops it across a
 *     target matrix with ZERO change to this module's call contract.
 *
 *   - mergeShippedAssetFiles(input) — pure union of the three "what ships in the
 *     npm package" sources (install set, retired-from-install files, binary-read-
 *     only `assets/context/**`), deduplicated and sorted; the SSOT for the
 *     `assetFiles` list `scripts/publish-npm.ts` feeds to buildPublishPlan.
 *
 * Invariants:
 *   - Pure: no fs, no `child_process`/`Bun.spawn`, no `Date.now()` /
 *     `Math.random()`. Every field of the returned `PublishPlan` is a
 *     deterministic function of `input` alone.
 *   - `target` = `input.platform.libsqlTarget` verbatim — `platform-map.ts`'s
 *     `PLATFORM_TABLE` already produces a value unique per (os, cpu, libc)
 *     triple (e.g. `linux-x64-gnu` vs a hypothetical `linux-x64-musl`), so
 *     reusing it as-is is what makes a same-(os,cpu)-different-libc row
 *     resolve to a different package name and staging path with no extra
 *     derivation logic (SPEC-048 boundary AC).
 *   - `packageJson.bin.lore` is ALWAYS the literal staged destination
 *     `"dist/lore"` — independent of `input.binaryPath` (the SOURCE path the
 *     binary is copied FROM). See `stagingFiles` for the source→dest copy the
 *     orchestrator (`scripts/publish-npm.ts`, a later task) must perform.
 *   - `packageJson` NEVER carries a `private` key (a generated manifest must
 *     be publishable) — this is unrelated to the WORKSPACE ROOT's own
 *     `package.json` `private: true`, which this module never reads or
 *     writes.
 *   - `PACKAGE_SCOPE` is a DELIBERATE, clearly-fake placeholder (SPEC-048
 *     D3) — the real scope literal is an owner decision made at first
 *     publish. `nameFor()` is the single seam that decision would touch.
 *   - `input.assetFiles` entries MUST be repo-relative source paths rooted
 *     at `"assets/"` (the SPEC-046 SSOT tree) — each is staged at the
 *     corresponding path under `<stagingRoot>assets/...`, preserving its
 *     sub-path relative to the `assets/` root. An entry not rooted there is
 *     rejected as malformed input (NEGATIVE case) rather than silently
 *     staged somewhere unexpected.
 *
 * Side-effect class: pure.
 * Source: SPEC-048 Scope IN #3, #5; Design D3, D4, D5, D6, D7.
 */

import { err, ok } from "@lore/core";
import type { Result, LoreError } from "@lore/core";

/**
 * Structural mirror of `scripts/platform-map.ts`'s `PlatformDescriptor`. See
 * the module docstring for why this is a mirror, not an import.
 */
export interface PlatformDescriptor {
  /** npm-canonical `os` value (e.g. `"darwin"`, `"linux"`, `"win32"`). */
  os: string;
  /** npm-canonical `cpu` value (e.g. `"arm64"`, `"x64"`). */
  cpu: string;
  /** libc/toolchain qualifier, present only where the naming scheme needs it (e.g. linux/win32). */
  libc?: string;
  /** The exact target suffix used to resolve the platform's prebuilt native addon — reused verbatim as this module's package/staging target key. */
  libsqlTarget: string;
}

/** Argument shape for {@link buildPublishPlan}. */
export interface BuildPublishPlanInput {
  /** Workspace version to lock the generated manifest to (passed in, never read from fs — see SPEC-048 Scope IN #5). */
  version: string;
  /** Structured platform descriptor for the ONE platform/arch this publish targets (SPEC-048 D4 — single-arch pin). */
  platform: PlatformDescriptor;
  /** Repo-relative source paths of every asset file to ship, each rooted at `"assets/"`. */
  assetFiles: string[];
  /** Repo-relative source path of the built native binary (e.g. `"dist/lore"`). */
  binaryPath: string;
}

/** The generated, publishable npm `package.json` object (SPEC-048 Scope IN #5). Deliberately has NO `private` key. */
export interface GeneratedPackageJson {
  name: string;
  version: string;
  bin: { lore: string };
  os: string[];
  cpu: string[];
  files: string[];
  scripts: { postinstall: string };
}

/**
 * The full result of {@link buildPublishPlan}: a target-scoped staging plan.
 */
export interface PublishPlan {
  /** The target identifier this plan was built for — `input.platform.libsqlTarget` verbatim (D7). */
  target: string;
  /** The generated package's npm name (`nameFor(target)`). */
  packageName: string;
  /** Staging root directory, repo-relative, trailing slash included (`dist-npm/<pkg>-<target>/`, D7). */
  stagingRoot: string;
  /**
   * Staging file map: keyed by the STAGED destination path (repo-relative,
   * prefixed by `stagingRoot`), valued by the SOURCE path to copy it from.
   * Always contains exactly: the binary (`<stagingRoot>dist/lore`), one entry
   * per `input.assetFiles` element (`<stagingRoot>assets/...`), and the
   * postinstall script (`<stagingRoot>postinstall.mjs`).
   */
  stagingFiles: Record<string, string>;
  /** The generated `package.json` object to write at `<stagingRoot>package.json`. */
  packageJson: GeneratedPackageJson;
}

/**
 * Deliberately fake npm scope placeholder (SPEC-048 D3). The real scope is an
 * owner decision fixed at first publish — this constant is the single seam
 * that decision touches. Kept lowercase/hyphen-only to stay a structurally
 * valid npm scope name so downstream tooling (e.g. `npm pack --dry-run`) can
 * exercise the real shape today without a placeholder-shaped rejection.
 */
export const PACKAGE_SCOPE = "@lore-npm-scope-placeholder";

/** Unscoped local package identifier — the `<pkg>` in `dist-npm/<pkg>-<target>/` (SPEC-048 D7). */
export const PACKAGE_BASENAME = "cli";

/**
 * Repo-relative source path of the shipped postinstall script (SPEC-048
 * Scope IN #4) — a fixed repo location, not a `buildPublishPlan` input,
 * because every publish target ships the SAME postinstall source file.
 */
export const POSTINSTALL_SOURCE_PATH = "npm-pkg/postinstall.mjs";

/** Repo-relative source path of the README shipped in the generated package. */
export const README_SOURCE_PATH = "README.md";

/**
 * Derives the generated package's npm name for a given target identifier.
 * The single seam `PACKAGE_SCOPE`'s eventual real-scope decision touches.
 *
 * @param target - A target identifier, conventionally `platform.libsqlTarget`.
 * @returns The scoped npm package name, e.g. `"@lore-npm-scope-placeholder/cli-darwin-arm64"`.
 * @example
 * nameFor("darwin-arm64"); // => "@lore-npm-scope-placeholder/cli-darwin-arm64"
 */
export function nameFor(target: string): string {
  return `${PACKAGE_SCOPE}/${PACKAGE_BASENAME}-${target}`;
}

/** Input of {@link mergeShippedAssetFiles}. Paths in the two non-install lists are relative to `assets/`. */
export interface MergeShippedAssetFilesInput {
  /** Repo-relative (`assets/...`) files from the machine install set (`RealAssetSource.load()`). */
  installSetAssetFiles: readonly string[];
  /** `assets/`-relative paths retired from install but still shipped (`RETIRED_FROM_INSTALL_PATHS`). */
  retiredFromInstallPaths: Iterable<string>;
  /** `assets/`-relative binary-read-only files, e.g. `context/<id>.md` (`listBinaryReadAssetPaths`). */
  binaryReadAssetPaths: readonly string[];
}

/**
 * Unions the three sources of "files that ship inside the npm package" into one
 * deduplicated, sorted, `assets/`-rooted list for `BuildPublishPlanInput.assetFiles`.
 * The install set alone is NOT the package contents: governance prose and
 * `assets/context/**` fragments are read off the binary's own assets root at
 * runtime (`resolveAssetsRoot`) and must ship even though `lore setup` never
 * installs them. Pure.
 *
 * @param input - the three path sources.
 * @returns sorted unique `assets/...` paths.
 * @throws Never.
 * @example
 * mergeShippedAssetFiles({ installSetAssetFiles: [], retiredFromInstallPaths: [], binaryReadAssetPaths: ["context/a.md"] });
 * // => ["assets/context/a.md"]
 */
export function mergeShippedAssetFiles(input: MergeShippedAssetFilesInput): string[] {
  const all = new Set<string>(input.installSetAssetFiles);
  for (const retired of input.retiredFromInstallPaths) all.add(`assets/${retired}`);
  for (const binaryRead of input.binaryReadAssetPaths) all.add(`assets/${binaryRead}`);
  return [...all].sort();
}

/**
 * Builds the target-scoped staging plan + generated `package.json` for the
 * npm single-platform publish pipeline. Pure — see the module docstring's
 * invariants.
 *
 * @param input - Version, platform descriptor, asset source paths, and the
 *   built binary's source path.
 * @returns `ok(plan)` on valid input, or `err(VALIDATION_ERROR)` naming the
 *   first offending field on malformed/missing input. Never throws.
 * @throws Never — always returns a Result.
 *
 * @example
 * buildPublishPlan({
 *   version: "0.1.0",
 *   platform: { os: "darwin", cpu: "arm64", libsqlTarget: "darwin-arm64" },
 *   assetFiles: ["assets/governance/seat-briefing.md"],
 *   binaryPath: "dist/lore",
 * });
 * // => ok({
 * //   target: "darwin-arm64",
 * //   packageName: "@lore-npm-scope-placeholder/cli-darwin-arm64",
 * //   stagingRoot: "dist-npm/cli-darwin-arm64/",
 * //   stagingFiles: {
 * //     "dist-npm/cli-darwin-arm64/dist/lore": "dist/lore",
 * //     "dist-npm/cli-darwin-arm64/assets/governance/seat-briefing.md":
 * //       "assets/governance/seat-briefing.md",
 * //     "dist-npm/cli-darwin-arm64/postinstall.mjs": "npm-pkg/postinstall.mjs",
 * //   },
 * //   packageJson: {
 * //     name: "@lore-npm-scope-placeholder/cli-darwin-arm64",
 * //     version: "0.1.0",
 * //     bin: { lore: "dist/lore" },
 * //     os: ["darwin"],
 * //     cpu: ["arm64"],
 * //     files: ["dist/lore", "assets/**", "postinstall.mjs", "README.md"],
 * //     scripts: { postinstall: "node postinstall.mjs" },
 * //   },
 * // })
 */
export function buildPublishPlan(input: BuildPublishPlanInput): Result<PublishPlan, LoreError> {
  const validation = validateInput(input);
  if (!validation.ok) {
    return validation;
  }

  const { version, platform, assetFiles, binaryPath } = input;
  const target = platform.libsqlTarget;
  const packageName = nameFor(target);
  const stagingRoot = `dist-npm/${PACKAGE_BASENAME}-${target}/`;

  const stagingFiles: Record<string, string> = {
    [`${stagingRoot}dist/lore`]: binaryPath,
    [`${stagingRoot}postinstall.mjs`]: POSTINSTALL_SOURCE_PATH,
  };
  for (const assetFile of assetFiles) {
    const relativeToAssetsRoot = assetFile.slice("assets/".length);
    stagingFiles[`${stagingRoot}assets/${relativeToAssetsRoot}`] = assetFile;
  }

  const packageJson: GeneratedPackageJson = {
    name: packageName,
    version,
    bin: { lore: "dist/lore" },
    os: [platform.os],
    cpu: [platform.cpu],
    files: ["dist/lore", "assets/**", "postinstall.mjs", README_SOURCE_PATH],
    scripts: { postinstall: "node postinstall.mjs" },
  };

  return ok({ target, packageName, stagingRoot, stagingFiles, packageJson });
}

/**
 * Validates {@link BuildPublishPlanInput} before any derivation runs.
 * Internal — not exported; {@link buildPublishPlan} is the only caller.
 *
 * @param input - Candidate input, typed as `BuildPublishPlanInput` but
 *   validated defensively since a caller may construct it from untyped data
 *   (e.g. a CLI flag parse in the later `scripts/publish-npm.ts` task).
 * @returns `ok(input)` unchanged when valid, else `err(VALIDATION_ERROR)`
 *   naming the first offending field.
 */
function validateInput(input: BuildPublishPlanInput): Result<BuildPublishPlanInput, LoreError> {
  if (!input.version || input.version.trim().length === 0) {
    return err({
      code: "VALIDATION_ERROR",
      field: "version",
      message: "version is required and must be a non-empty string",
      value: input.version,
    });
  }
  if (!input.platform || !input.platform.os || !input.platform.cpu || !input.platform.libsqlTarget) {
    return err({
      code: "VALIDATION_ERROR",
      field: "platform",
      message: "platform is required and must carry os, cpu, and libsqlTarget",
      value: input.platform,
    });
  }
  if (!input.binaryPath || input.binaryPath.trim().length === 0) {
    return err({
      code: "VALIDATION_ERROR",
      field: "binaryPath",
      message: "binaryPath is required and must be a non-empty string",
      value: input.binaryPath,
    });
  }
  if (!Array.isArray(input.assetFiles)) {
    return err({
      code: "VALIDATION_ERROR",
      field: "assetFiles",
      message: "assetFiles is required and must be an array of strings",
      value: input.assetFiles,
    });
  }
  for (const assetFile of input.assetFiles) {
    if (typeof assetFile !== "string" || !assetFile.startsWith("assets/") || assetFile === "assets/") {
      return err({
        code: "VALIDATION_ERROR",
        field: "assetFiles",
        message: `every assetFiles entry must be a repo-relative path rooted at "assets/"; got ${JSON.stringify(assetFile)}`,
        value: assetFile,
      });
    }
  }

  return ok(input);
}
