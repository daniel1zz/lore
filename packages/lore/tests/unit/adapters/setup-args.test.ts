/**
 * Unit tests for `setup-args.ts` — the pure flag-validation + path-resolution
 * helpers behind `lore setup` (SPEC-046 §Design, task AC-046-E). These
 * functions have NO fs/env/Bun access of their own (every ambient value is a
 * caller-supplied parameter), so every case here runs with plain objects —
 * no mkdtemp fixture needed. End-to-end reachability (the actual CLI
 * resolving these correctly through real env/argv) is covered by
 * `tests/integration/cli/setup.test.ts`.
 *
 * Coverage:
 *   HAPPY:      every one of the FIVE flag combinations resolves to its
 *               correct SetupMode, incl. `--project --uninstall` ->
 *               `"project-uninstall"` (SPEC-060 §Design D2 — no longer
 *               rejected); --claude-dir / $CLAUDE_CONFIG_DIR / homedir()
 *               default precedence resolves correctly;
 *               resolveBinPath/resolveAssetsRoot's compiled-vs-dev branches;
 *               (SPEC-048 D8) a REAL symlink chain (mirroring npm's
 *               `node_modules/.bin/<name>` bin-link layout) resolves
 *               binPath/assetsRoot through to the real package dir, not the
 *               `.bin` dir — proven with an actual tmpdir symlink, not a
 *               string fixture
 *   NEGATIVE:   every STILL-rejected flag combination (--project+--dry-run,
 *               --project+--claude-dir, --dry-run+--uninstall) is rejected
 *               with a message naming the conflicting flag
 *   BOUNDARY:   an empty-string / whitespace-only --claude-dir flag is
 *               treated as absent (falls through to the next precedence
 *               tier); (SPEC-048 D8) an execPath that is already a REAL path
 *               (no symlink layer) resolves idempotently — realpath is a
 *               no-op, not a rewrite
 *   ERROR:      (SPEC-048 D8) a realpath failure (nonexistent execPath, e.g.
 *               a stale/dangling reference) falls back to the ORIGINAL
 *               unresolved execPath instead of throwing
 *   STATE:      (SPEC-048 D8) dev mode (isCompiled: false) never invokes
 *               realpath at all — a bogus, unprobeable execPath in dev-mode
 *               context has zero effect on the result
 *   REGRESSION: a relative --claude-dir value is resolved to an absolute
 *               path; pre-existing dev-mode and non-symlink compiled-mode
 *               resolveBinPath/resolveAssetsRoot cases are byte-identical
 *               (their fixture paths don't exist on disk, so realpath fails
 *               and falls back to the unresolved path unchanged)
 *
 * @spec_ref AC-046-E, SPEC-048 D8
 */

import { describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

import {
  resolveAssetsRoot,
  resolveBinPath,
  resolveTargetDir,
  validateSetupFlags,
  type SetupPathContext,
} from "../../../src/adapters/cli/setup-args.js";

// ─── validateSetupFlags — HAPPY ──────────────────────────────────────────────

describe("validateSetupFlags — HAPPY", () => {
  it("no flags -> install", () => {
    const result = validateSetupFlags({ dryRun: false, uninstall: false, project: false });
    expect(result).toEqual({ ok: true, mode: "install" });
  });

  it("--dry-run -> dry-run", () => {
    const result = validateSetupFlags({ dryRun: true, uninstall: false, project: false });
    expect(result).toEqual({ ok: true, mode: "dry-run" });
  });

  it("--uninstall -> uninstall", () => {
    const result = validateSetupFlags({ dryRun: false, uninstall: true, project: false });
    expect(result).toEqual({ ok: true, mode: "uninstall" });
  });

  it("--project -> project", () => {
    const result = validateSetupFlags({ dryRun: false, uninstall: false, project: true });
    expect(result).toEqual({ ok: true, mode: "project" });
  });

  it("--project + --uninstall -> project-uninstall (SPEC-060 D2, no longer rejected)", () => {
    const result = validateSetupFlags({ dryRun: false, uninstall: true, project: true });
    expect(result).toEqual({ ok: true, mode: "project-uninstall" });
  });
});

// ─── validateSetupFlags — NEGATIVE ───────────────────────────────────────────

describe("validateSetupFlags — NEGATIVE", () => {
  it("--project + --dry-run is rejected", () => {
    const result = validateSetupFlags({ dryRun: true, uninstall: false, project: true });
    expect(result.ok).toBe(false);
    expect(!result.ok && result.message).toContain("--dry-run");
  });

  it("--project + --claude-dir is rejected", () => {
    const result = validateSetupFlags({ dryRun: false, uninstall: false, project: true, claudeDir: "/tmp/x" });
    expect(result.ok).toBe(false);
    expect(!result.ok && result.message).toContain("--claude-dir");
  });

  it("--dry-run + --uninstall is rejected", () => {
    const result = validateSetupFlags({ dryRun: true, uninstall: true, project: false });
    expect(result.ok).toBe(false);
    expect(!result.ok && result.message).toContain("--uninstall");
  });

  it("--project wins precedence over --dry-run+--uninstall (project-specific message, not the dry-run/uninstall one)", () => {
    const result = validateSetupFlags({ dryRun: true, uninstall: true, project: true });
    expect(result.ok).toBe(false);
    expect(!result.ok && result.message).toContain("--dry-run");
  });
});

// ─── resolveTargetDir ─────────────────────────────────────────────────────────

describe("resolveTargetDir — HAPPY", () => {
  it("no flag, no env -> join(homeDir, '.claude')", () => {
    const result = resolveTargetDir({ env: {}, homeDir: "/Users/x" });
    expect(result).toBe(join("/Users/x", ".claude"));
  });

  it("$CLAUDE_CONFIG_DIR set, no flag -> the env value (resolved)", () => {
    const result = resolveTargetDir({ env: { CLAUDE_CONFIG_DIR: "/opt/claude-cfg" }, homeDir: "/Users/x" });
    expect(result).toBe(resolve("/opt/claude-cfg"));
  });

  it("--claude-dir flag set -> wins over $CLAUDE_CONFIG_DIR and homeDir", () => {
    const result = resolveTargetDir({
      claudeDirFlag: "/tmp/flag-target",
      env: { CLAUDE_CONFIG_DIR: "/opt/claude-cfg" },
      homeDir: "/Users/x",
    });
    expect(result).toBe(resolve("/tmp/flag-target"));
  });
});

describe("resolveTargetDir — BOUNDARY", () => {
  it("an empty-string --claude-dir flag is treated as absent", () => {
    const result = resolveTargetDir({ claudeDirFlag: "", env: { CLAUDE_CONFIG_DIR: "/opt/claude-cfg" }, homeDir: "/Users/x" });
    expect(result).toBe(resolve("/opt/claude-cfg"));
  });

  it("a whitespace-only --claude-dir flag is treated as absent", () => {
    const result = resolveTargetDir({ claudeDirFlag: "   ", env: {}, homeDir: "/Users/x" });
    expect(result).toBe(join("/Users/x", ".claude"));
  });

  it("an empty-string $CLAUDE_CONFIG_DIR is treated as absent", () => {
    const result = resolveTargetDir({ env: { CLAUDE_CONFIG_DIR: "" }, homeDir: "/Users/x" });
    expect(result).toBe(join("/Users/x", ".claude"));
  });
});

describe("resolveTargetDir — REGRESSION", () => {
  it("a relative --claude-dir value is resolved to an absolute path", () => {
    const result = resolveTargetDir({ claudeDirFlag: "relative/path", env: {}, homeDir: "/Users/x" });
    expect(result).toBe(resolve("relative/path"));
    expect(result.startsWith("/")).toBe(true);
  });
});

// ─── resolveBinPath / resolveAssetsRoot ──────────────────────────────────────

describe("resolveBinPath / resolveAssetsRoot — HAPPY", () => {
  const devCtx: SetupPathContext = { repoRoot: "/repo", isCompiled: false, execPath: "/opt/bun/bin/bun" };
  const compiledCtx: SetupPathContext = { repoRoot: "/repo", isCompiled: true, execPath: "/repo/dist/lore" };

  it("dev mode -> binPath is repoRoot/dist/lore", () => {
    expect(resolveBinPath(devCtx)).toBe(join("/repo", "dist", "lore"));
  });

  it("compiled mode -> binPath is the running executable's own execPath", () => {
    expect(resolveBinPath(compiledCtx)).toBe("/repo/dist/lore");
  });

  it("dev mode -> assetsRoot is repoRoot/assets", () => {
    expect(resolveAssetsRoot(devCtx)).toBe(join("/repo", "assets"));
  });

  it("compiled mode -> assetsRoot is the sibling of the binary's parent directory", () => {
    expect(resolveAssetsRoot(compiledCtx)).toBe(join("/repo/dist", "..", "assets"));
  });
});

// ─── resolveBinPath / resolveAssetsRoot — npm bin-symlink realpath hardening (SPEC-048 D8) ──

describe("resolveBinPath / resolveAssetsRoot — npm bin-symlink realpath hardening (SPEC-048 D8) — HAPPY", () => {
  it("compiled execPath through a REAL symlink chain (npm .bin/<name> layout) resolves through to the real package dir, not the .bin dir", () => {
    // Mirrors npm's actual install shape: node_modules/.bin/lore is a
    // SYMLINK into node_modules/@scope/lore-cli/dist/lore. A pre-hardening
    // resolveAssetsRoot would derive node_modules/.bin/../assets — a
    // directory that never exists — instead of the real package's
    // node_modules/@scope/lore-cli/assets.
    const base = mkdtempSync(join(tmpdir(), "lore-setup-args-symlink-"));
    const pkgDistDir = join(base, "node_modules", "@scope", "lore-cli", "dist");
    mkdirSync(pkgDistDir, { recursive: true });
    const realBinary = join(pkgDistDir, "lore");
    writeFileSync(realBinary, "#!/bin/sh\necho fake-lore-binary\n");

    const binDir = join(base, "node_modules", ".bin");
    mkdirSync(binDir, { recursive: true });
    const symlinkPath = join(binDir, "lore");
    symlinkSync(realBinary, symlinkPath);

    const ctx: SetupPathContext = { repoRoot: "/unused", isCompiled: true, execPath: symlinkPath };
    const expectedRealBinary = realpathSync(realBinary);

    expect(resolveBinPath(ctx)).toBe(expectedRealBinary);
    expect(resolveAssetsRoot(ctx)).toBe(join(dirname(expectedRealBinary), "..", "assets"));
    // Explicitly proves it did NOT derive from the unresolved .bin/ path.
    expect(resolveAssetsRoot(ctx)).not.toBe(join(dirname(symlinkPath), "..", "assets"));
  });

  it("resolves a multi-hop symlink chain (symlink -> symlink -> real file) fully, not just one level", () => {
    const base = mkdtempSync(join(tmpdir(), "lore-setup-args-multihop-"));
    const pkgDistDir = join(base, "node_modules", "@scope", "lore-cli", "dist");
    mkdirSync(pkgDistDir, { recursive: true });
    const realBinary = join(pkgDistDir, "lore");
    writeFileSync(realBinary, "#!/bin/sh\necho fake-lore-binary\n");

    const intermediateLink = join(base, "intermediate-lore-link");
    symlinkSync(realBinary, intermediateLink);
    const binDir = join(base, "node_modules", ".bin");
    mkdirSync(binDir, { recursive: true });
    const outerLink = join(binDir, "lore");
    symlinkSync(intermediateLink, outerLink);

    const ctx: SetupPathContext = { repoRoot: "/unused", isCompiled: true, execPath: outerLink };
    expect(resolveBinPath(ctx)).toBe(realpathSync(realBinary));
  });
});

describe("resolveBinPath / resolveAssetsRoot — npm bin-symlink realpath hardening (SPEC-048 D8) — BOUNDARY", () => {
  it("an execPath that is already a REAL path (no symlink layer) resolves idempotently", () => {
    const base = mkdtempSync(join(tmpdir(), "lore-setup-args-noreal-"));
    const distDir = join(base, "dist");
    mkdirSync(distDir, { recursive: true });
    const realBinary = join(distDir, "lore");
    writeFileSync(realBinary, "#!/bin/sh\necho fake-lore-binary\n");

    const ctx: SetupPathContext = { repoRoot: "/unused", isCompiled: true, execPath: realBinary };
    expect(resolveBinPath(ctx)).toBe(realpathSync(realBinary));
    expect(resolveAssetsRoot(ctx)).toBe(join(dirname(realpathSync(realBinary)), "..", "assets"));
  });
});

describe("resolveBinPath / resolveAssetsRoot — npm bin-symlink realpath hardening (SPEC-048 D8) — ERROR", () => {
  it("a realpath failure (nonexistent execPath) falls back to the unresolved path instead of throwing", () => {
    const bogusExecPath = "/definitely/does/not/exist/lore-binary-that-is-not-real";
    const ctx: SetupPathContext = { repoRoot: "/repo", isCompiled: true, execPath: bogusExecPath };

    expect(() => resolveBinPath(ctx)).not.toThrow();
    expect(() => resolveAssetsRoot(ctx)).not.toThrow();
    expect(resolveBinPath(ctx)).toBe(bogusExecPath);
    expect(resolveAssetsRoot(ctx)).toBe(join(dirname(bogusExecPath), "..", "assets"));
  });
});

describe("resolveBinPath / resolveAssetsRoot — npm bin-symlink realpath hardening (SPEC-048 D8) — STATE", () => {
  it("dev mode (isCompiled: false) never invokes realpath — a bogus execPath has zero effect", () => {
    const ctx: SetupPathContext = {
      repoRoot: "/repo",
      isCompiled: false,
      execPath: "/definitely/does/not/exist/lore-binary-that-is-not-real",
    };
    expect(resolveBinPath(ctx)).toBe(join("/repo", "dist", "lore"));
    expect(resolveAssetsRoot(ctx)).toBe(join("/repo", "assets"));
  });
});
