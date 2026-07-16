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
 *   HAPPY:      every one of the four flag combinations resolves to its
 *               correct SetupMode; --claude-dir / $CLAUDE_CONFIG_DIR /
 *               homedir() default precedence resolves correctly;
 *               resolveBinPath/resolveAssetsRoot's compiled-vs-dev branches
 *   NEGATIVE:   every rejected flag combination (--project+--dry-run,
 *               --project+--uninstall, --project+--claude-dir,
 *               --dry-run+--uninstall) is rejected with a message naming the
 *               conflicting flag
 *   BOUNDARY:   an empty-string / whitespace-only --claude-dir flag is
 *               treated as absent (falls through to the next precedence tier)
 *   REGRESSION: a relative --claude-dir value is resolved to an absolute path
 *
 * @spec_ref AC-046-E
 */

import { describe, expect, it } from "vitest";
import { join, resolve } from "node:path";

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
});

// ─── validateSetupFlags — NEGATIVE ───────────────────────────────────────────

describe("validateSetupFlags — NEGATIVE", () => {
  it("--project + --dry-run is rejected", () => {
    const result = validateSetupFlags({ dryRun: true, uninstall: false, project: true });
    expect(result.ok).toBe(false);
    expect(!result.ok && result.message).toContain("--dry-run");
  });

  it("--project + --uninstall is rejected", () => {
    const result = validateSetupFlags({ dryRun: false, uninstall: true, project: true });
    expect(result.ok).toBe(false);
    expect(!result.ok && result.message).toContain("--uninstall");
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
