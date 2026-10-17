// @reads scripts/build.ts
/**
 * `scripts/platform-map.ts` unit suite (SPEC-048 Scope IN #1, AC-048-A).
 *
 * Verifies the extracted platform-map SSOT: (1) every one of the 5 known
 * (platform, arch) pairs resolves to the byte-identical legacy `libsqlTarget`
 * string the pre-extraction `scripts/build.ts::resolveLibsqlTarget()` produced,
 * (2) an unsupported pair throws a typed, message-bearing error, (3) `libc` is
 * present ONLY on the linux/win32 rows, and (4) `scripts/build.ts` itself was
 * actually refactored to consume this module — a source-scan REGRESSION
 * assertion (mirrors SPEC-046's assets-ssot conformance-scan pattern) proving
 * build.ts imports `platform-map` and carries no inline platform/arch switch
 * and no local `resolveLibsqlTarget` definition.
 *
 * Coverage:
 *   HAPPY:      all 5 known (platform, arch) pairs resolve to the correct
 *               structured descriptor, `os`/`cpu` are npm-canonical values
 *   NEGATIVE:   an unsupported (platform, arch) pair throws UnsupportedPlatformError
 *               naming the exact platform/arch in its message
 *   BOUNDARY:   `libc` is present (and correct) only for linux/win32 rows;
 *               absent (not `undefined`-valued) for darwin rows
 *   ERROR:      the thrown error is an instance of UnsupportedPlatformError
 *               (not a bare Error) and exposes `.platform`/`.arch` fields
 *   STATE:      resolvePlatform returns a structurED object, never a fused
 *               string — verified by asserting `os`/`cpu`/`libsqlTarget` are
 *               all independently readable and a fresh object per call (no
 *               shared mutable reference into the internal table)
 *   REGRESSION: `libsqlTarget` values are byte-identical to the pre-refactor
 *               strings that lived inline in scripts/build.ts, AND build.ts's
 *               own source is scanned to prove the extraction actually
 *               happened (imports platform-map, no inline switch, no local
 *               resolveLibsqlTarget)
 *
 * Import note: `scripts/platform-map.ts` lives OUTSIDE `packages/lore/tsconfig.tests.json`'s
 * `rootDir` ("."). A static `import` of a repo-root `scripts/` file from here would pull it
 * into that tsconfig's program and fail with TS6059 ("File is not under rootDir"). Loading it
 * via `import()` with a runtime-COMPUTED (non-literal) specifier sidesteps that: TypeScript only
 * attempts module/type resolution for a dynamic-import call when the specifier is a string
 * literal — a computed specifier types the awaited result as `any` and is never added to the
 * `tsconfig.tests.json` program, while vitest's own (tsc-independent) Vite/esbuild loader still
 * resolves and executes the real file at runtime, exactly as a static import would.
 *
 * @spec_ref AC-048-A
 */

import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/** Structural mirror of `scripts/platform-map.ts`'s `PlatformDescriptor` — not imported (see note above), kept in lockstep by the REGRESSION parity checks below. */
interface PlatformDescriptor {
  os: string;
  cpu: string;
  libc?: string;
  libsqlTarget: string;
}

type ResolvePlatformFn = (platform?: string, arch?: string) => PlatformDescriptor;
/** Instance shape of `scripts/platform-map.ts`'s `UnsupportedPlatformError` — see the module-level import note. */
interface UnsupportedPlatformErrorInstance extends Error {
  platform: string;
  arch: string;
}
type UnsupportedPlatformErrorCtor = new (
  platform: string,
  arch: string
) => UnsupportedPlatformErrorInstance;

// packages/lore/tests/unit/distribution/platform-map.test.ts -> repo root is 5 levels up.
const REPO_ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..", "..", "..");
const BUILD_TS_PATH = join(REPO_ROOT, "scripts", "build.ts");
const PLATFORM_MAP_SPECIFIER = pathToFileURL(join(REPO_ROOT, "scripts", "platform-map.ts")).href;

let resolvePlatform: ResolvePlatformFn;
let UnsupportedPlatformError: UnsupportedPlatformErrorCtor;

beforeAll(async () => {
  const platformMapModule = await import(/* @vite-ignore */ PLATFORM_MAP_SPECIFIER);
  resolvePlatform = platformMapModule.resolvePlatform;
  UnsupportedPlatformError = platformMapModule.UnsupportedPlatformError;
});

/** The legacy fused-string table `resolveLibsqlTarget()` produced pre-extraction (SPEC-048 REGRESSION oracle). */
const LEGACY_TARGET_TABLE: ReadonlyArray<{
  platform: string;
  arch: string;
  libsqlTarget: string;
}> = [
  { platform: "darwin", arch: "arm64", libsqlTarget: "darwin-arm64" },
  { platform: "darwin", arch: "x64", libsqlTarget: "darwin-x64" },
  { platform: "linux", arch: "x64", libsqlTarget: "linux-x64-gnu" },
  { platform: "linux", arch: "arm64", libsqlTarget: "linux-arm64-gnu" },
  { platform: "win32", arch: "x64", libsqlTarget: "win32-x64-msvc" },
];

describe("scripts/platform-map — resolvePlatform", () => {
  describe("HAPPY — all 5 known pairs", () => {
    it.each(LEGACY_TARGET_TABLE)(
      "resolves $platform/$arch to $libsqlTarget with npm-canonical os/cpu",
      ({ platform, arch, libsqlTarget }) => {
        const descriptor = resolvePlatform(platform, arch);
        expect(descriptor.os).toBe(platform);
        expect(descriptor.cpu).toBe(arch);
        expect(descriptor.libsqlTarget).toBe(libsqlTarget);
      }
    );
  });

  describe("NEGATIVE — unsupported platform/arch", () => {
    it("throws UnsupportedPlatformError naming the exact pair", () => {
      expect(() => resolvePlatform("freebsd", "mips")).toThrow(UnsupportedPlatformError);
      try {
        resolvePlatform("freebsd", "mips");
        expect.unreachable("resolvePlatform must throw for an unmapped pair");
      } catch (e) {
        expect(e).toBeInstanceOf(UnsupportedPlatformError);
        expect((e as Error).message).toContain("freebsd");
        expect((e as Error).message).toContain("mips");
      }
    });

    it("throws for a KNOWN os paired with an arch it does not support (win32/arm64)", () => {
      expect(() => resolvePlatform("win32", "arm64")).toThrow(UnsupportedPlatformError);
    });
  });

  describe("BOUNDARY — libc presence", () => {
    it("omits libc for darwin rows (not set to undefined, absent entirely)", () => {
      const darwinArm = resolvePlatform("darwin", "arm64");
      const darwinX64 = resolvePlatform("darwin", "x64");
      expect("libc" in darwinArm).toBe(false);
      expect("libc" in darwinX64).toBe(false);
    });

    it("includes the correct libc for linux rows (gnu) and win32 (msvc)", () => {
      expect(resolvePlatform("linux", "x64").libc).toBe("gnu");
      expect(resolvePlatform("linux", "arm64").libc).toBe("gnu");
      expect(resolvePlatform("win32", "x64").libc).toBe("msvc");
    });
  });

  describe("ERROR — typed error shape", () => {
    it("exposes .platform and .arch fields on the thrown error", () => {
      try {
        resolvePlatform("aix", "ppc64");
        expect.unreachable("must throw");
      } catch (e) {
        const err = e as UnsupportedPlatformErrorInstance;
        expect(err.name).toBe("UnsupportedPlatformError");
        expect(err.platform).toBe("aix");
        expect(err.arch).toBe("ppc64");
      }
    });
  });

  describe("STATE — structured shape, never a fused string", () => {
    it("returns independently-readable os/cpu/libsqlTarget fields", () => {
      const descriptor: PlatformDescriptor = resolvePlatform("linux", "arm64");
      expect(typeof descriptor.os).toBe("string");
      expect(typeof descriptor.cpu).toBe("string");
      expect(typeof descriptor.libsqlTarget).toBe("string");
      expect(descriptor.libsqlTarget).not.toBe(`${descriptor.os}/${descriptor.cpu}`);
    });

    it("returns a fresh object per call — mutating one result never affects another", () => {
      const first = resolvePlatform("darwin", "x64");
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- deliberate mutation to prove isolation
      (first as any).libsqlTarget = "MUTATED";
      const second = resolvePlatform("darwin", "x64");
      expect(second.libsqlTarget).toBe("darwin-x64");
    });

    it("defaults platform/arch to the ambient process values when omitted", () => {
      const descriptor = resolvePlatform();
      expect(descriptor.os).toBe(process.platform);
      expect(descriptor.cpu).toBe(process.arch);
    });
  });

  describe("REGRESSION — legacy fused-string parity + build.ts source-scan", () => {
    it.each(LEGACY_TARGET_TABLE)(
      "libsqlTarget for $platform/$arch is byte-identical to the pre-refactor string",
      ({ platform, arch, libsqlTarget }) => {
        expect(resolvePlatform(platform, arch).libsqlTarget).toBe(libsqlTarget);
      }
    );

    it("build.ts imports platform-map and contains no inline platform/arch switch or local resolveLibsqlTarget", () => {
      const buildSource = readFileSync(BUILD_TS_PATH, "utf-8");

      // Must import the extracted module.
      expect(buildSource).toMatch(/from\s+["']\.\/platform-map\.js["']/);
      expect(buildSource).toMatch(/resolvePlatform/);

      // Must NOT re-define the local switch function that used to live here.
      expect(buildSource).not.toMatch(/function\s+resolveLibsqlTarget/);

      // Must NOT contain an inline process.platform === "..." branch — the
      // extraction is supposed to have removed every such comparison from
      // build.ts, leaving platform/arch branching solely inside platform-map.ts.
      expect(buildSource).not.toMatch(/process\.platform\s*===/);
      expect(buildSource).not.toMatch(/process\.arch\s*===/);
    });

    it("nativePkg derivation in build.ts resolves through resolvePlatform().libsqlTarget", () => {
      const buildSource = readFileSync(BUILD_TS_PATH, "utf-8");
      expect(buildSource).toMatch(/resolvePlatform\(\)\.libsqlTarget/);
    });
  });
});
