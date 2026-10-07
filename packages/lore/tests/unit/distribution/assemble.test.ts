/**
 * Tests for `packages/lore/src/distribution/assemble.ts` — the pure
 * `buildPublishPlan` PublishPlan assembler (SPEC-048 Scope IN #3, #5; Design
 * D3/D4/D5/D6/D7).
 *
 * Six-dimension coverage:
 *   HAPPY:      a darwin/arm64 input produces the expected staging map,
 *               staging root, and generated manifest (bin/os/cpu/files/
 *               postinstall/version) exactly
 *   NEGATIVE:   malformed input — an assetFiles entry not rooted at
 *               "assets/", an empty-string entry, a non-array assetFiles
 *   BOUNDARY:   linux target with libc "musl" vs "gnu" (same os/cpu,
 *               different libc) yields a DIFFERENT target/package
 *               name/staging path — proves target parameterization without
 *               a call-site change (P3 readiness)
 *   STATE:      the full PublishPlan shape (target, packageName,
 *               stagingRoot, stagingFiles, packageJson) is asserted as one
 *               coherent, deterministic structure — two calls with
 *               identical input produce deep-equal (not same-reference)
 *               results
 *   ERROR:      missing required fields — empty version, absent
 *               platform.libsqlTarget, empty binaryPath — each a distinct
 *               VALIDATION_ERROR naming the offending field
 *   REGRESSION: the generated manifest has EXACTLY the expected key set
 *               (single-writer field-drift guard) and `private` is never
 *               present; nameFor()/PACKAGE_SCOPE/PACKAGE_BASENAME are the
 *               sole naming seam (byte-identical across repeated calls)
 *
 * @spec_ref AC-048-A
 */

import { describe, it, expect } from "vitest";
import {
  buildPublishPlan,
  mergeShippedAssetFiles,
  nameFor,
  PACKAGE_SCOPE,
  PACKAGE_BASENAME,
  POSTINSTALL_SOURCE_PATH,
  README_SOURCE_PATH,
  type BuildPublishPlanInput,
} from "../../../src/distribution/assemble.js";

const DARWIN_ARM64_INPUT: BuildPublishPlanInput = {
  version: "0.1.0",
  platform: { os: "darwin", cpu: "arm64", libsqlTarget: "darwin-arm64" },
  assetFiles: ["assets/governance/seat-briefing.md", "assets/hooks/session-start-resume.mjs"],
  binaryPath: "dist/lore",
};

describe("buildPublishPlan", () => {
  describe("HAPPY — darwin/arm64 full plan", () => {
    it("produces the expected staging map", () => {
      const result = buildPublishPlan(DARWIN_ARM64_INPUT);
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const { stagingRoot, stagingFiles } = result.value;
      expect(stagingRoot).toBe("dist-npm/cli-darwin-arm64/");
      expect(stagingFiles[`${stagingRoot}dist/lore`]).toBe("dist/lore");
      expect(stagingFiles[`${stagingRoot}assets/governance/seat-briefing.md`]).toBe(
        "assets/governance/seat-briefing.md"
      );
      expect(stagingFiles[`${stagingRoot}assets/hooks/session-start-resume.mjs`]).toBe(
        "assets/hooks/session-start-resume.mjs"
      );
      expect(stagingFiles[`${stagingRoot}postinstall.mjs`]).toBe(POSTINSTALL_SOURCE_PATH);
      // No extra entries beyond binary + 2 assets + postinstall.
      expect(Object.keys(stagingFiles)).toHaveLength(4);
    });

    it("produces the expected generated manifest fields", () => {
      const result = buildPublishPlan(DARWIN_ARM64_INPUT);
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const { packageJson } = result.value;
      expect(packageJson.bin).toEqual({ lore: "dist/lore" });
      expect(packageJson.os).toEqual(["darwin"]);
      expect(packageJson.cpu).toEqual(["arm64"]);
      expect(packageJson.version).toBe("0.1.0");
      expect(packageJson.files).toEqual(["dist/lore", "assets/**", "postinstall.mjs", README_SOURCE_PATH]);
      expect(packageJson.scripts).toEqual({ postinstall: "node postinstall.mjs" });
      expect("private" in packageJson).toBe(false);
    });

    it("names the package via nameFor(target)", () => {
      const result = buildPublishPlan(DARWIN_ARM64_INPUT);
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.value.target).toBe("darwin-arm64");
      expect(result.value.packageName).toBe(nameFor("darwin-arm64"));
      expect(result.value.packageJson.name).toBe(result.value.packageName);
    });
  });

  describe("NEGATIVE — malformed input", () => {
    it("rejects an assetFiles entry not rooted at \"assets/\"", () => {
      const result = buildPublishPlan({
        ...DARWIN_ARM64_INPUT,
        assetFiles: ["not-under-assets-root/foo.mjs"],
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("VALIDATION_ERROR");
      if (result.error.code === "VALIDATION_ERROR") {
        expect(result.error.field).toBe("assetFiles");
        expect(result.error.message).toContain("not-under-assets-root/foo.mjs");
      }
    });

    it("rejects the literal \"assets/\" entry (no sub-path)", () => {
      const result = buildPublishPlan({ ...DARWIN_ARM64_INPUT, assetFiles: ["assets/"] });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("VALIDATION_ERROR");
      if (result.error.code === "VALIDATION_ERROR") {
        expect(result.error.field).toBe("assetFiles");
      }
    });

    it("rejects a non-array assetFiles", () => {
      const result = buildPublishPlan({
        ...DARWIN_ARM64_INPUT,
        // Deliberate malformed-shape input (e.g. from an untyped CLI-flag caller).
        assetFiles: "assets/foo.mjs" as unknown as string[],
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("VALIDATION_ERROR");
      if (result.error.code === "VALIDATION_ERROR") {
        expect(result.error.field).toBe("assetFiles");
      }
    });
  });

  describe("BOUNDARY — linux libc musl vs gnu target parameterization", () => {
    it("gnu and musl rows (same os/cpu) yield different target, package name, and staging path", () => {
      const gnuResult = buildPublishPlan({
        version: "0.1.0",
        platform: { os: "linux", cpu: "x64", libc: "gnu", libsqlTarget: "linux-x64-gnu" },
        assetFiles: ["assets/README.md"],
        binaryPath: "dist/lore",
      });
      const muslResult = buildPublishPlan({
        version: "0.1.0",
        platform: { os: "linux", cpu: "x64", libc: "musl", libsqlTarget: "linux-x64-musl" },
        assetFiles: ["assets/README.md"],
        binaryPath: "dist/lore",
      });

      expect(gnuResult.ok).toBe(true);
      expect(muslResult.ok).toBe(true);
      if (!gnuResult.ok || !muslResult.ok) return;

      expect(gnuResult.value.target).toBe("linux-x64-gnu");
      expect(muslResult.value.target).toBe("linux-x64-musl");
      expect(gnuResult.value.packageName).not.toBe(muslResult.value.packageName);
      expect(gnuResult.value.stagingRoot).not.toBe(muslResult.value.stagingRoot);
    });

    it("os/cpu remain single-arch-pinned arrays regardless of libc", () => {
      const result = buildPublishPlan({
        version: "0.1.0",
        platform: { os: "linux", cpu: "arm64", libc: "musl", libsqlTarget: "linux-arm64-musl" },
        assetFiles: [],
        binaryPath: "dist/lore",
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.packageJson.os).toEqual(["linux"]);
      expect(result.value.packageJson.cpu).toEqual(["arm64"]);
    });
  });

  describe("STATE — full plan shape is deterministic", () => {
    it("two calls with identical input produce deep-equal, independently-owned results", () => {
      const first = buildPublishPlan(DARWIN_ARM64_INPUT);
      const second = buildPublishPlan(DARWIN_ARM64_INPUT);
      expect(first).toEqual(second);
      expect(first.ok).toBe(true);
      expect(second.ok).toBe(true);
      if (!first.ok || !second.ok) return;
      // Mutating one result's staging map must never affect the other.
      first.value.stagingFiles["extra"] = "x";
      expect(second.value.stagingFiles["extra"]).toBeUndefined();
    });

    it("an empty assetFiles list still stages the binary and postinstall", () => {
      const result = buildPublishPlan({ ...DARWIN_ARM64_INPUT, assetFiles: [] });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(Object.keys(result.value.stagingFiles)).toHaveLength(2);
      expect(result.value.stagingFiles[`${result.value.stagingRoot}dist/lore`]).toBe("dist/lore");
      expect(result.value.stagingFiles[`${result.value.stagingRoot}postinstall.mjs`]).toBe(
        POSTINSTALL_SOURCE_PATH
      );
    });
  });

  describe("ERROR — missing required fields", () => {
    it("rejects an empty version", () => {
      const result = buildPublishPlan({ ...DARWIN_ARM64_INPUT, version: "" });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("VALIDATION_ERROR");
      if (result.error.code === "VALIDATION_ERROR") {
        expect(result.error.field).toBe("version");
      }
    });

    it("rejects a platform missing libsqlTarget", () => {
      const result = buildPublishPlan({
        ...DARWIN_ARM64_INPUT,
        platform: { os: "darwin", cpu: "arm64" } as unknown as BuildPublishPlanInput["platform"],
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("VALIDATION_ERROR");
      if (result.error.code === "VALIDATION_ERROR") {
        expect(result.error.field).toBe("platform");
      }
    });

    it("rejects an empty binaryPath", () => {
      const result = buildPublishPlan({ ...DARWIN_ARM64_INPUT, binaryPath: "" });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("VALIDATION_ERROR");
      if (result.error.code === "VALIDATION_ERROR") {
        expect(result.error.field).toBe("binaryPath");
      }
    });
  });

  describe("REGRESSION — single-writer manifest field set + naming seam", () => {
    it("generated manifest has exactly the expected key set (no drift, no extras)", () => {
      const result = buildPublishPlan(DARWIN_ARM64_INPUT);
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(Object.keys(result.value.packageJson).sort()).toEqual(
        ["bin", "cpu", "files", "name", "os", "scripts", "version"].sort()
      );
    });

    it("nameFor is the sole naming seam — PACKAGE_SCOPE/PACKAGE_BASENAME compose it byte-identically", () => {
      expect(nameFor("darwin-arm64")).toBe(`${PACKAGE_SCOPE}/${PACKAGE_BASENAME}-darwin-arm64`);
      expect(nameFor("linux-x64-gnu")).toBe(`${PACKAGE_SCOPE}/${PACKAGE_BASENAME}-linux-x64-gnu`);
    });

    it("PACKAGE_SCOPE is a structurally valid, lowercase npm scope placeholder", () => {
      expect(PACKAGE_SCOPE).toMatch(/^@[a-z0-9-]+$/);
    });
  });
});

describe("assets/context npm assembly", () => {
  it("mergeShippedAssetFiles puts an assets/context/*.md file into the assembled plan's staging map", () => {
    const shipped = mergeShippedAssetFiles({
      installSetAssetFiles: ["assets/hooks/session-start-resume.mjs"],
      retiredFromInstallPaths: ["governance/seat-briefing.md"],
      binaryReadAssetPaths: ["context/zz-probe.md"],
    });
    expect(shipped).toContain("assets/context/zz-probe.md");
    expect(shipped).toContain("assets/governance/seat-briefing.md");
    expect(shipped).toContain("assets/hooks/session-start-resume.mjs");

    const result = buildPublishPlan({ ...DARWIN_ARM64_INPUT, assetFiles: shipped });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const { stagingRoot, stagingFiles } = result.value;
    expect(stagingFiles[`${stagingRoot}assets/context/zz-probe.md`]).toBe("assets/context/zz-probe.md");
  });

  it("deduplicates and is order-deterministic; empty binary-read list adds nothing", () => {
    const a = mergeShippedAssetFiles({
      installSetAssetFiles: ["assets/skills/a.md", "assets/context/x.md"],
      retiredFromInstallPaths: [],
      binaryReadAssetPaths: ["context/x.md"],
    });
    expect(a.filter((p) => p === "assets/context/x.md")).toHaveLength(1);
    const none = mergeShippedAssetFiles({
      installSetAssetFiles: ["assets/skills/a.md"],
      retiredFromInstallPaths: [],
      binaryReadAssetPaths: [],
    });
    expect(none).toEqual(["assets/skills/a.md"]);
  });
});
