/**
 * Tests for the libsql static-require rewrite plugin used in scripts/build.ts.
 *
 * These tests verify the core logic of the plugin (pattern detection, rewriting,
 * loud failure on missing pattern) without executing an actual Bun.build() call.
 * The platform map and path resolution logic are also tested.
 */

import { describe, it, expect } from "vitest";
import { existsSync } from "fs";
import { join } from "path";

// ─── Inline the testable units from scripts/build.ts ─────────────────────────
// We inline rather than import to avoid executing build side-effects at test time.

function resolveLibsqlTarget(platform: string, arch: string): string {
  if (platform === "darwin" && arch === "arm64") return "darwin-arm64";
  if (platform === "darwin" && arch === "x64") return "darwin-x64";
  if (platform === "linux" && arch === "x64") return "linux-x64-gnu";
  if (platform === "linux" && arch === "arm64") return "linux-arm64-gnu";
  if (platform === "win32" && arch === "x64") return "win32-x64-msvc";
  throw new Error(
    `[build] Unsupported platform/arch combination: ${platform}/${arch}.`
  );
}

function rewriteLibsqlSource(source: string, nativeNodePath: string): string {
  const dynamicRequirePattern = /return require\(`@libsql\/\${target}`\);/;

  if (!dynamicRequirePattern.test(source)) {
    throw new Error(
      `[build] libsql-static-native-require plugin: expected to find ` +
        `'return require(\`@libsql/\${target}\`);' in libsql/index.js ` +
        `but the pattern was not found.`
    );
  }

  const escapedNodePath = nativeNodePath.replace(/\\/g, "\\\\");
  return source.replace(
    dynamicRequirePattern,
    `return require("${escapedNodePath}");`
  );
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("resolveLibsqlTarget", () => {
  it("maps darwin/arm64 → darwin-arm64", () => {
    expect(resolveLibsqlTarget("darwin", "arm64")).toBe("darwin-arm64");
  });

  it("maps darwin/x64 → darwin-x64", () => {
    expect(resolveLibsqlTarget("darwin", "x64")).toBe("darwin-x64");
  });

  it("maps linux/x64 → linux-x64-gnu", () => {
    expect(resolveLibsqlTarget("linux", "x64")).toBe("linux-x64-gnu");
  });

  it("maps linux/arm64 → linux-arm64-gnu", () => {
    expect(resolveLibsqlTarget("linux", "arm64")).toBe("linux-arm64-gnu");
  });

  it("maps win32/x64 → win32-x64-msvc", () => {
    expect(resolveLibsqlTarget("win32", "x64")).toBe("win32-x64-msvc");
  });

  it("throws loudly for unknown platform/arch", () => {
    expect(() => resolveLibsqlTarget("freebsd", "x64")).toThrow(
      "Unsupported platform/arch combination: freebsd/x64"
    );
  });
});

describe("rewriteLibsqlSource (plugin core logic)", () => {
  const fakeSource = `
function requireNative() {
  let target = currentTarget();
  return require(\`@libsql/\${target}\`);
}
`;

  it("rewrites the dynamic require to a static absolute path", () => {
    const result = rewriteLibsqlSource(
      fakeSource,
      "/absolute/path/to/index.node"
    );
    expect(result).toContain('return require("/absolute/path/to/index.node");');
    expect(result).not.toContain("@libsql/${target}");
  });

  it("preserves surrounding source code unchanged", () => {
    const result = rewriteLibsqlSource(
      fakeSource,
      "/absolute/path/to/index.node"
    );
    expect(result).toContain("function requireNative()");
    expect(result).toContain("let target = currentTarget();");
  });

  it("throws loudly when the pattern is not found (version drift guard)", () => {
    const sourceWithoutPattern = `
function requireNative() {
  return require("some-other-thing");
}
`;
    expect(() =>
      rewriteLibsqlSource(sourceWithoutPattern, "/path/to/index.node")
    ).toThrow("pattern was not found");
  });

  it("escapes Windows backslashes in the .node path", () => {
    const result = rewriteLibsqlSource(
      fakeSource,
      "C:\\path\\to\\index.node"
    );
    expect(result).toContain('return require("C:\\\\path\\\\to\\\\index.node");');
  });

  it("only rewrites the first/only occurrence (single require guard)", () => {
    // The real libsql/index.js has exactly one dynamic require; verify replace is safe
    const result = rewriteLibsqlSource(fakeSource, "/node/path");
    const matches = (result.match(/return require\(/g) ?? []).length;
    expect(matches).toBe(1);
  });
});

describe("native addon path (integration — darwin-arm64 host)", () => {
  it("@libsql/darwin-arm64/index.node exists in node_modules", () => {
    // Locate libsql via require.resolve rather than hard-coded dir traversal;
    // this works whether tests run inside a worktree or the main checkout.
    const libsqlMainPath = require.resolve("libsql");
    const libsqlPkgRoot = join(libsqlMainPath, "..");
    const nodePath = join(
      libsqlPkgRoot,
      "..",
      "@libsql",
      "darwin-arm64",
      "index.node"
    );
    expect(existsSync(nodePath)).toBe(true);
  });

  it("the real libsql/index.js contains the expected dynamic-require pattern", () => {
    const libsqlIndexPath = require.resolve("libsql");
    expect(existsSync(libsqlIndexPath)).toBe(true);

    const dynamicRequirePattern = /return require\(`@libsql\/\${target}`\);/;
    const src = require("fs").readFileSync(libsqlIndexPath, "utf8");
    expect(dynamicRequirePattern.test(src)).toBe(true);
  });
});
