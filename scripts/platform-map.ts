#!/usr/bin/env bun
/**
 * Platform → libsql-native-target map — the single source of truth for mapping a
 * (Node/Bun `process.platform`, `process.arch`) pair to the libsql native-addon
 * target this repo ships (SPEC-048 Scope IN #1). Extracted from `scripts/build.ts`'s
 * former `resolveLibsqlTarget()` so the publish pipeline (SPEC-048 later tasks —
 * `buildPublishPlan`, `package.json` `os`/`cpu` fields, package naming) can consume
 * the SAME structured descriptor `build.ts` uses to resolve its native addon, instead
 * of re-deriving or string-parsing a fused target name.
 *
 * Public surface:
 *   - resolvePlatform(platform?, arch?) — pure fn; defaults read the ambient
 *     `process.platform`/`process.arch` ONLY as fallback parameter values, so a
 *     caller can query any of the 5 known pairs without touching global state
 *     (this is what makes the function unit-testable across all combinations).
 *   - PlatformDescriptor — the structured return shape. NEVER a fused string: the
 *     publish pipeline needs `os`/`cpu` as discrete npm-canonical values for
 *     `package.json`'s `os`/`cpu` allow-list fields, and `libsqlTarget` separately
 *     for native-addon resolution — collapsing them back into one string would force
 *     every consumer to re-parse it.
 *   - UnsupportedPlatformError — typed throw naming the exact platform/arch pair.
 *
 * @invariant `libsqlTarget` values are byte-identical to the pre-extraction
 * `resolveLibsqlTarget()` strings in `scripts/build.ts` (REGRESSION-locked by
 * `packages/lore/tests/unit/distribution/platform-map.test.ts`) — any change here
 * changes which prebuilt `@libsql/<target>` package the build resolves.
 * @invariant `libc` is present ONLY for the linux/win32 rows — darwin has no libc
 * axis for the libsql prebuild naming scheme, so the field is OMITTED (not set to
 * `undefined`) for darwin entries, matching `exactOptionalPropertyTypes`.
 *
 * Side-effect class: pure (the only "IO" is reading two ambient process fields, and
 * only as DEFAULT parameter values a caller can always override).
 */

/** npm-canonical `os` values this repo currently maps — mirrors `package.json`'s `os` field grammar. */
export type NpmOs = "darwin" | "linux" | "win32";

/** npm-canonical `cpu` values this repo currently maps — mirrors `package.json`'s `cpu` field grammar. */
export type NpmCpu = "arm64" | "x64";

/** libc/toolchain qualifier libsql's prebuild naming distinguishes by, where applicable. */
export type LibsqlLibc = "gnu" | "msvc";

/**
 * Structured platform descriptor. `libsqlTarget` is the exact suffix used to resolve
 * the `@libsql/<libsqlTarget>` prebuilt native-addon package.
 */
export interface PlatformDescriptor {
  os: NpmOs;
  cpu: NpmCpu;
  libc?: LibsqlLibc;
  libsqlTarget: string;
}

/**
 * Typed error for an (platform, arch) pair not present in {@link PLATFORM_TABLE}.
 * Carries the raw `process.platform`/`process.arch` strings (not narrowed to
 * {@link NpmOs}/{@link NpmCpu} — the whole point of this error is that the input
 * did NOT match a known row) so a caller can report the exact unsupported pair
 * without re-deriving it from the error message.
 */
export class UnsupportedPlatformError extends Error {
  public readonly platform: string;
  public readonly arch: string;

  constructor(platform: string, arch: string) {
    super(
      `[platform-map] Unsupported platform/arch combination: ${platform}/${arch}. ` +
        `Add it to PLATFORM_TABLE in scripts/platform-map.ts.`
    );
    this.name = "UnsupportedPlatformError";
    this.platform = platform;
    this.arch = arch;
  }
}

/**
 * The five (os, cpu) pairs this repo currently prebuilds/ships for, each mapped to
 * its libsql prebuild target suffix. Order is presentation-only (lookup is by
 * `os`+`cpu` equality, not position) — kept in a stable, human-scannable order.
 */
const PLATFORM_TABLE: readonly PlatformDescriptor[] = [
  { os: "darwin", cpu: "arm64", libsqlTarget: "darwin-arm64" },
  { os: "darwin", cpu: "x64", libsqlTarget: "darwin-x64" },
  { os: "linux", cpu: "x64", libc: "gnu", libsqlTarget: "linux-x64-gnu" },
  { os: "linux", cpu: "arm64", libc: "gnu", libsqlTarget: "linux-arm64-gnu" },
  { os: "win32", cpu: "x64", libc: "msvc", libsqlTarget: "win32-x64-msvc" },
];

/**
 * Resolves the structured platform descriptor for a given (platform, arch) pair.
 *
 * @param platform - Raw `process.platform`-shaped string. Defaults to the ambient
 * `process.platform` when omitted — pass an explicit value to query a pair other
 * than the current runtime's (as the test suite does for all 5 known pairs).
 * @param arch - Raw `process.arch`-shaped string. Defaults to the ambient
 * `process.arch` when omitted, same rationale as `platform`.
 * @returns The matching {@link PlatformDescriptor}, a fresh object (never a shared
 * reference into {@link PLATFORM_TABLE}) so callers may not mutate the table.
 * @throws {UnsupportedPlatformError} When no row in {@link PLATFORM_TABLE} matches
 * the given (platform, arch) pair.
 * @example
 * resolvePlatform("darwin", "arm64")
 * // => { os: "darwin", cpu: "arm64", libsqlTarget: "darwin-arm64" }
 */
export function resolvePlatform(
  platform: string = process.platform,
  arch: string = process.arch
): PlatformDescriptor {
  const match = PLATFORM_TABLE.find((row) => row.os === platform && row.cpu === arch);
  if (!match) {
    throw new UnsupportedPlatformError(platform, arch);
  }
  return { ...match };
}
