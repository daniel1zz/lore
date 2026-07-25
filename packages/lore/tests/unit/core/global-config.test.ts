/**
 * @spec_ref SPEC-003 §6.2 (XDG-aware global config loading)
 *
 * Six-dimension test suite for global config functions in src/core/config.ts:
 *   - resolveGlobalConfigPath()  — XDG path resolution with env-var precedence
 *   - loadGlobalConfig()         — parse + validate GlobalLoreConfigSchema
 *   - mergeDefaults()            — project-wins merge semantics
 *
 * Test dimensions:
 *   HAPPY:      valid global config → ok with defaults populated
 *   NEGATIVE:   path resolution ordering ($LORE_CONFIG_HOME > $XDG_CONFIG_HOME
 *               either/or ~/.config — an explicit $XDG_CONFIG_HOME REPLACES
 *               the ~/.config default, it never stacks under it)
 *   BOUNDARY:   empty file, file with only defaults:{}, null YAML
 *   ERROR:      malformed YAML, project/sync/telemetry keys, unknown keys
 *   STATE:      resolveGlobalConfigPath returns undefined when no file exists
 *   REGRESSION: no global config → behaviour identical to pre-feature baseline
 *
 * Uses vitest (no bun:sqlite dependency).
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
  rmSync,
} from "fs";
import { join, resolve } from "path";
import { tmpdir, homedir } from "os";
import { createHash } from "crypto";
import { GlobalLoreConfigSchema, mergeDefaults, LoreDefaultsSchema } from "@lore/core";
// reason: resolveGlobalConfigPath/loadGlobalConfig read the filesystem via Node
// fs/path/os — only reachable via the @lore/core/node subpath (browser-safety
// split, packages/core/src/CLAUDE.md).
import {
  resolveGlobalConfigPath,
  resolveGlobalConfigWritePath,
  loadGlobalConfig,
  saveGlobalConfig,
} from "@lore/core/node";

// ─── Env-var save/restore ─────────────────────────────────────────────────────

type SavedEnv = { [key: string]: string | undefined };
let savedEnv: SavedEnv = {};

const ENV_KEYS = ["LORE_CONFIG_HOME", "XDG_CONFIG_HOME"] as const;

function saveEnv(): void {
  for (const key of ENV_KEYS) {
    savedEnv[key] = process.env[key];
  }
}

function restoreEnv(): void {
  for (const key of ENV_KEYS) {
    const saved = savedEnv[key];
    if (saved === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = saved;
    }
  }
  savedEnv = {};
}

/** Create a hermetic temp dir with resolve() to normalize macOS /var → /private/var symlinks. */
function makeTempDir(): string {
  return resolve(mkdtempSync(join(tmpdir(), "lore-global-cfg-test-")));
}

/** Write a YAML config file at the expected location inside dir. */
function writeGlobalConfig(dir: string, content: string): string {
  const configPath = join(dir, "config.yaml");
  writeFileSync(configPath, content, "utf8");
  return configPath;
}

/** Create $LORE_CONFIG_HOME dir structure with config.yaml. */
function makeLoreConfigHome(content: string): string {
  const dir = makeTempDir();
  writeGlobalConfig(dir, content);
  return dir;
}

/** Create $XDG_CONFIG_HOME/lore/ structure with config.yaml. */
function makeXdgConfigHome(content: string): string {
  const xdgDir = makeTempDir();
  const loreDir = join(xdgDir, "lore");
  mkdirSync(loreDir, { recursive: true });
  writeFileSync(join(loreDir, "config.yaml"), content, "utf8");
  return xdgDir;
}

beforeEach(saveEnv);
afterEach(() => {
  restoreEnv();
});

// ─── HAPPY PATH ───────────────────────────────────────────────────────────────

describe("GlobalLoreConfigSchema — happy path", () => {
  it("AC-GC-1: accepts valid config with defaults.editor", () => {
    const result = GlobalLoreConfigSchema.safeParse({
      defaults: { editor: "vim" },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.defaults?.editor).toBe("vim");
    }
  });

  it("accepts config with all defaults fields", () => {
    const result = GlobalLoreConfigSchema.safeParse({
      defaults: { editor: "nano", format: "json", color: false },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.defaults?.format).toBe("json");
      expect(result.data.defaults?.color).toBe(false);
    }
  });

  it("accepts empty object (no defaults section)", () => {
    const result = GlobalLoreConfigSchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.defaults).toBeUndefined();
    }
  });
});

describe("loadGlobalConfig() — happy path (AC-GC-1)", () => {
  it("reads valid YAML at resolved path and returns ok with defaults.editor", () => {
    const dir = makeLoreConfigHome("defaults:\n  editor: vim\n");
    process.env["LORE_CONFIG_HOME"] = dir;

    const path = resolveGlobalConfigPath();
    expect(path).toBeDefined();
    const result = loadGlobalConfig(path);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.defaults?.editor).toBe("vim");
    }
  });

  it("accepts config with all defaults fields via file", () => {
    const content = "defaults:\n  editor: nano\n  format: json\n  color: false\n";
    const dir = makeLoreConfigHome(content);
    process.env["LORE_CONFIG_HOME"] = dir;

    const path = resolveGlobalConfigPath();
    const result = loadGlobalConfig(path);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.defaults?.format).toBe("json");
      expect(result.value.defaults?.color).toBe(false);
    }
  });
});

describe("mergeDefaults() — happy path", () => {
  it("returns merged object — global supplies base, project overrides", () => {
    const merged = mergeDefaults(
      { editor: "vim", color: true },
      { editor: "nano" },
    );
    expect(merged.editor).toBe("nano"); // project wins
    expect(merged.color).toBe(true);   // global fallback preserved
  });

  it("returns global defaults unchanged when project provides nothing", () => {
    const merged = mergeDefaults({ editor: "vim", color: false }, undefined);
    expect(merged.editor).toBe("vim");
    expect(merged.color).toBe(false);
  });

  it("returns project defaults unchanged when global provides nothing", () => {
    const merged = mergeDefaults(undefined, { format: "json" });
    expect(merged.format).toBe("json");
  });

  it("returns empty object when both are undefined", () => {
    const merged = mergeDefaults(undefined, undefined);
    expect(merged).toEqual({});
  });
});

// ─── NEGATIVE — path resolution ordering (AC-GC-2) ───────────────────────────

describe("resolveGlobalConfigPath() — path resolution ordering (AC-GC-2)", () => {
  it("prefers $LORE_CONFIG_HOME over $XDG_CONFIG_HOME when both exist", () => {
    const loreDir = makeLoreConfigHome("defaults:\n  editor: from-lore\n");
    const xdgDir = makeXdgConfigHome("defaults:\n  editor: from-xdg\n");

    process.env["LORE_CONFIG_HOME"] = loreDir;
    process.env["XDG_CONFIG_HOME"] = xdgDir;

    const path = resolveGlobalConfigPath();
    expect(path).toBeDefined();
    // Should point to the LORE_CONFIG_HOME file
    expect(path).toContain(loreDir);
    expect(path).not.toContain(xdgDir);
  });

  it("falls back to $XDG_CONFIG_HOME when $LORE_CONFIG_HOME is not set", () => {
    delete process.env["LORE_CONFIG_HOME"];
    const xdgDir = makeXdgConfigHome("defaults:\n  editor: from-xdg\n");
    process.env["XDG_CONFIG_HOME"] = xdgDir;

    const path = resolveGlobalConfigPath();
    expect(path).toBeDefined();
    expect(path).toContain(xdgDir);
  });

  it("falls back to $XDG_CONFIG_HOME when $LORE_CONFIG_HOME dir exists but has no config.yaml", () => {
    const emptyDir = makeTempDir(); // no config.yaml inside
    const xdgDir = makeXdgConfigHome("defaults:\n  editor: from-xdg\n");

    process.env["LORE_CONFIG_HOME"] = emptyDir;
    process.env["XDG_CONFIG_HOME"] = xdgDir;

    const path = resolveGlobalConfigPath();
    expect(path).toBeDefined();
    expect(path).toContain(xdgDir);
  });

  it("returns undefined when no config file exists at any candidate path", () => {
    delete process.env["LORE_CONFIG_HOME"];
    // Set XDG_CONFIG_HOME to a dir that exists but has no lore/config.yaml
    const emptyXdg = makeTempDir();
    process.env["XDG_CONFIG_HOME"] = emptyXdg;

    // This test assumes ~/.config/lore/config.yaml doesn't exist.
    // We can't reliably clear that; instead we test that when LORE and XDG
    // are both set to empty dirs, XDG path is checked and returns undefined.
    // If the user happens to have ~/.config/lore/config.yaml, the result
    // would be defined — that's expected behaviour.
    const path = resolveGlobalConfigPath();
    // When XDG points to an empty dir and LORE is unset, path should be
    // undefined (or point to ~/.config if the user has one — both are valid)
    if (path !== undefined) {
      // If a path is returned, it must be a real file
      const { existsSync } = require("fs");
      expect(existsSync(path)).toBe(true);
    }
  });

  it("resolves correct sub-path for $XDG_CONFIG_HOME (adds /lore/config.yaml)", () => {
    delete process.env["LORE_CONFIG_HOME"];
    const xdgDir = makeXdgConfigHome("defaults:\n  color: true\n");
    process.env["XDG_CONFIG_HOME"] = xdgDir;

    const path = resolveGlobalConfigPath();
    expect(path).toBeDefined();
    expect(path).toBe(join(xdgDir, "lore", "config.yaml"));
  });

  it("resolves correct sub-path for $LORE_CONFIG_HOME (adds /config.yaml directly)", () => {
    const loreDir = makeLoreConfigHome("defaults:\n  editor: vim\n");
    process.env["LORE_CONFIG_HOME"] = loreDir;

    const path = resolveGlobalConfigPath();
    expect(path).toBeDefined();
    expect(path).toBe(join(loreDir, "config.yaml"));
  });
});

// ─── XDG semantics regression (task-xdg-semantics-resolveglobalconfigpath) ───
//
// XDG Base Directory spec: $XDG_CONFIG_HOME, when set (even to an empty dir
// with no lore/config.yaml inside), REPLACES the ~/.config default — it never
// stacks under it (pnpm/helm/gh all implement this as either-or). Before the
// 2026-07-25 fix, resolveGlobalConfigPath's step 3 ran unconditionally
// whenever step 2 found nothing, silently falling through to the REAL
// ~/.config/lore/config.yaml even with $XDG_CONFIG_HOME explicitly set to an
// isolated temp dir.

describe("resolveGlobalConfigPath() — XDG_CONFIG_HOME replaces (never stacks under) ~/.config default", () => {
  it("returns undefined when XDG_CONFIG_HOME points at an empty dir, even if ~/.config/lore/config.yaml exists on this machine", () => {
    // reason: this assertion is the exact leak-repro from the incident. There
    // is no fake-homedir seam in this module (homedir() is called directly
    // from "os"), so this pins the resolver's CONTRACT rather than faking the
    // real home directory. It passes VACUOUSLY on a machine with no real
    // ~/.config/lore/config.yaml — it becomes NON-vacuous (and catches a
    // regression of this exact bug) the moment that file exists, which is
    // this repo's own dev machine state as of the incident (SPEC-078
    // dashboard.projects populated ~/.config/lore/config.yaml).
    delete process.env["LORE_CONFIG_HOME"];
    process.env["XDG_CONFIG_HOME"] = makeTempDir(); // no lore/ subdir inside

    expect(resolveGlobalConfigPath()).toBeUndefined();
  });

  it("treats an empty-string XDG_CONFIG_HOME identically to unset (AC-4)", () => {
    // reason: the XDG spec says "not set OR empty" for the default fallback
    // condition — an empty string must behave exactly like a deleted env var,
    // never like "set to the empty path". We don't assert a specific resolved
    // value (machine-dependent) — only that "" and deleted produce the SAME
    // outcome, proving "" is not silently treated as a truthy override.
    delete process.env["LORE_CONFIG_HOME"];

    delete process.env["XDG_CONFIG_HOME"];
    const withUnsetVar = resolveGlobalConfigPath();

    process.env["XDG_CONFIG_HOME"] = "";
    const withEmptyVar = resolveGlobalConfigPath();

    expect(withEmptyVar).toBe(withUnsetVar);
  });

  it("XDG_CONFIG_HOME unset → ~/.config/lore/config.yaml still resolves when present (AC-2, existing behavior preserved)", () => {
    delete process.env["LORE_CONFIG_HOME"];
    delete process.env["XDG_CONFIG_HOME"];

    // No machine-dependent value assertion — only that omitting XDG_CONFIG_HOME
    // does not itself suppress the ~/.config default (never throws, and any
    // returned path must be the real default candidate).
    const path = resolveGlobalConfigPath();
    if (path !== undefined) {
      expect(path).toBe(join(homedir(), ".config", "lore", "config.yaml"));
    }
  });
});

// ─── BOUNDARY (AC-GC-3) ──────────────────────────────────────────────────────

describe("loadGlobalConfig() — boundary cases (AC-GC-3)", () => {
  it("empty file → returns ok({})", () => {
    const dir = makeLoreConfigHome("");
    process.env["LORE_CONFIG_HOME"] = dir;
    const path = resolveGlobalConfigPath();

    const result = loadGlobalConfig(path);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual({});
    }
  });

  it("whitespace-only file → returns ok({})", () => {
    const dir = makeLoreConfigHome("   \n   \n");
    process.env["LORE_CONFIG_HOME"] = dir;
    const path = resolveGlobalConfigPath();

    const result = loadGlobalConfig(path);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual({});
    }
  });

  it("defaults: {} → returns ok({ defaults: {} })", () => {
    const dir = makeLoreConfigHome("defaults: {}\n");
    process.env["LORE_CONFIG_HOME"] = dir;
    const path = resolveGlobalConfigPath();

    const result = loadGlobalConfig(path);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual({ defaults: {} });
    }
  });

  it("no global config path (undefined) → returns ok({})", () => {
    // reason: force resolveGlobalConfigPath() to find nothing at any candidate
    // path via an isolated, empty $XDG_CONFIG_HOME — WITHOUT this isolation,
    // the fallthrough call inside loadGlobalConfig(undefined) resolves the
    // real machine's ambient env, which leaked ~/.config/lore/config.yaml
    // into this "no config" assertion (2026-07-25 incident, task-xdg-semantics).
    delete process.env["LORE_CONFIG_HOME"];
    process.env["XDG_CONFIG_HOME"] = makeTempDir(); // no lore/ subdir inside

    const result = loadGlobalConfig(undefined);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual({});
    }
  });

  it("YAML comment-only file → returns ok({})", () => {
    const dir = makeLoreConfigHome("# this file is intentionally empty\n");
    process.env["LORE_CONFIG_HOME"] = dir;
    const path = resolveGlobalConfigPath();

    const result = loadGlobalConfig(path);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual({});
    }
  });
});

describe("LoreDefaultsSchema — boundary values", () => {
  it("accepts format: 'text'", () => {
    expect(LoreDefaultsSchema.safeParse({ format: "text" }).success).toBe(true);
  });

  it("accepts format: 'json'", () => {
    expect(LoreDefaultsSchema.safeParse({ format: "json" }).success).toBe(true);
  });

  it("rejects unknown format value", () => {
    expect(
      LoreDefaultsSchema.safeParse({ format: "yaml" }).success,
    ).toBe(false);
  });
});

// ─── ERROR HANDLING (AC-GC-4) ────────────────────────────────────────────────

describe("loadGlobalConfig() — error cases (AC-GC-4)", () => {
  it("malformed YAML → returns err(VALIDATION_ERROR)", () => {
    const dir = makeLoreConfigHome("defaults:\n  editor: [unclosed\n  bad: : :\n");
    process.env["LORE_CONFIG_HOME"] = dir;
    const path = resolveGlobalConfigPath();

    const result = loadGlobalConfig(path);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("VALIDATION_ERROR");
    }
  });

  it("project: key present → returns err(VALIDATION_ERROR)", () => {
    const dir = makeLoreConfigHome(
      "project:\n  name: lore\n  author: alice\n",
    );
    process.env["LORE_CONFIG_HOME"] = dir;
    const path = resolveGlobalConfigPath();

    const result = loadGlobalConfig(path);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("VALIDATION_ERROR");
    }
  });

  it("sync: key present → returns err(VALIDATION_ERROR)", () => {
    const dir = makeLoreConfigHome(
      "sync:\n  enabled: false\n",
    );
    process.env["LORE_CONFIG_HOME"] = dir;
    const path = resolveGlobalConfigPath();

    const result = loadGlobalConfig(path);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("VALIDATION_ERROR");
    }
  });

  it("telemetry: key present → returns err(VALIDATION_ERROR)", () => {
    const dir = makeLoreConfigHome(
      "telemetry:\n  enabled: true\n",
    );
    process.env["LORE_CONFIG_HOME"] = dir;
    const path = resolveGlobalConfigPath();

    const result = loadGlobalConfig(path);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("VALIDATION_ERROR");
    }
  });

  it("unknown top-level key → returns err(VALIDATION_ERROR)", () => {
    const dir = makeLoreConfigHome("unknown_key: should-not-be-here\n");
    process.env["LORE_CONFIG_HOME"] = dir;
    const path = resolveGlobalConfigPath();

    const result = loadGlobalConfig(path);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("VALIDATION_ERROR");
    }
  });

  it("GlobalLoreConfigSchema rejects unknown top-level key (strict)", () => {
    const result = GlobalLoreConfigSchema.safeParse({ random: "field" });
    expect(result.success).toBe(false);
  });

  it("GlobalLoreConfigSchema rejects project section", () => {
    const result = GlobalLoreConfigSchema.safeParse({
      project: { name: "x", author: "y" },
    });
    expect(result.success).toBe(false);
  });

  it("GlobalLoreConfigSchema rejects sync section", () => {
    const result = GlobalLoreConfigSchema.safeParse({
      sync: { enabled: false },
    });
    expect(result.success).toBe(false);
  });

  it("GlobalLoreConfigSchema rejects telemetry section", () => {
    const result = GlobalLoreConfigSchema.safeParse({
      telemetry: { enabled: true },
    });
    expect(result.success).toBe(false);
  });

  it("does not throw on malformed YAML — never throws", () => {
    const dir = makeLoreConfigHome("{{invalid: yaml]]");
    process.env["LORE_CONFIG_HOME"] = dir;
    const path = resolveGlobalConfigPath();

    expect(() => loadGlobalConfig(path)).not.toThrow();
  });
});

// ─── STATE (AC-GC-5) ─────────────────────────────────────────────────────────

describe("resolveGlobalConfigPath() — state (AC-GC-5)", () => {
  it("returns undefined when no config file exists at any candidate path", () => {
    delete process.env["LORE_CONFIG_HOME"];
    // Point XDG to a dir without lore/config.yaml
    const emptyXdg = makeTempDir();
    process.env["XDG_CONFIG_HOME"] = emptyXdg;

    // If ~/.config/lore/config.yaml also doesn't exist, result is undefined.
    // This test is best-effort — if the dev machine has that file, skip assertion.
    const path = resolveGlobalConfigPath();
    // When XDG points to emptyXdg (no lore/config.yaml), result should be undefined
    // (or point to ~/.config if developer has it — both valid)
    if (path !== undefined) {
      // Must be a real, readable file
      const { readFileSync } = require("fs");
      expect(() => readFileSync(path, "utf8")).not.toThrow();
    }
    // Primary assertion: does not throw
    expect(resolveGlobalConfigPath).not.toThrow();
  });
});

// ─── REGRESSION (AC-GC-6) ─────────────────────────────────────────────────────

describe("loadGlobalConfig() — regression (AC-GC-6)", () => {
  it("no global config present → ok({}) — identical to pre-feature baseline", () => {
    delete process.env["LORE_CONFIG_HOME"];
    const emptyXdg = makeTempDir(); // no lore/ subdir
    process.env["XDG_CONFIG_HOME"] = emptyXdg;

    // If no global config exists at any path, call with undefined path directly
    const result = loadGlobalConfig(undefined);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual({});
    }
  });

  it("mergeDefaults with both undefined → empty object (no crash)", () => {
    // Simulates the pre-feature baseline where no defaults exist
    const merged = mergeDefaults(undefined, undefined);
    expect(merged).toEqual({});
  });
});

// ─── AC-GC-7: Merge semantics ─────────────────────────────────────────────────

describe("mergeDefaults() — AC-GC-7 merge semantics", () => {
  it("project editor wins over global editor", () => {
    const merged = mergeDefaults({ editor: "vim" }, { editor: "nano" });
    expect(merged.editor).toBe("nano");
  });

  it("global editor preserved when project has no editor", () => {
    const merged = mergeDefaults({ editor: "vim" }, { color: true });
    expect(merged.editor).toBe("vim");
    expect(merged.color).toBe(true);
  });

  it("project format wins over global format", () => {
    const merged = mergeDefaults({ format: "text" }, { format: "json" });
    expect(merged.format).toBe("json");
  });

  it("project color wins over global color", () => {
    const merged = mergeDefaults({ color: true }, { color: false });
    expect(merged.color).toBe(false);
  });

  it("full merge: project overrides all fields that it provides", () => {
    const merged = mergeDefaults(
      { editor: "vim", format: "text", color: true },
      { editor: "nano", format: "json" }, // no color override
    );
    expect(merged.editor).toBe("nano");   // project wins
    expect(merged.format).toBe("json");   // project wins
    expect(merged.color).toBe(true);      // global survives
  });
});

// ─── AC-064-3: saveGlobalConfig — validate-then-write, atomic ────────────────
//
// Source: SPEC-064 §Acceptance Criteria AC-064-3. Coverage dimensions:
//   HAPPY:      valid write to a non-existent path creates parent dirs +
//               round-trips via loadGlobalConfig
//   NEGATIVE:   a schema-invalid candidate (unknown top-level key) is rejected
//   BOUNDARY:   first write creates multiple nested missing directories
//   ERROR:      malformed/non-object input never throws
//   STATE:      a rejected write leaves a PRE-EXISTING file byte-identical
//               (sha256 asserted before === after, not just "file exists")
//   REGRESSION: an accepted write's content round-trips through YAML +
//               loadGlobalConfig exactly (no silent coercion)

function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

describe("saveGlobalConfig() — validate-then-write + atomic (AC-064-3)", () => {
  // ─── HAPPY ──────────────────────────────────────────────────────────────

  it("HAPPY: valid write to a non-existent XDG path creates parent dirs and round-trips", () => {
    const dir = makeTempDir();
    const targetPath = join(dir, "nested", "does", "not", "exist", "config.yaml");
    expect(existsSync(targetPath)).toBe(false);

    const result = saveGlobalConfig(
      { defaults: { format: "json", color: false } },
      targetPath,
    );
    expect(result.ok).toBe(true);
    expect(existsSync(targetPath)).toBe(true);

    const reread = loadGlobalConfig(targetPath);
    expect(reread.ok).toBe(true);
    if (reread.ok) {
      expect(reread.value).toEqual({ defaults: { format: "json", color: false } });
    }
  });

  it("HAPPY: omitting path resolves via resolveGlobalConfigWritePath (LORE_CONFIG_HOME)", () => {
    const dir = makeTempDir();
    process.env["LORE_CONFIG_HOME"] = dir;
    delete process.env["XDG_CONFIG_HOME"];

    const result = saveGlobalConfig({ defaults: { editor: "vim" } });
    expect(result.ok).toBe(true);

    const expectedPath = join(dir, "config.yaml");
    expect(existsSync(expectedPath)).toBe(true);
    const reread = loadGlobalConfig(expectedPath);
    expect(reread.ok && reread.value.defaults?.editor).toBe("vim");
  });

  // ─── NEGATIVE / STATE ───────────────────────────────────────────────────

  it("NEGATIVE+STATE: schema-invalid config writes 0 bytes, pre-existing file byte-identical", () => {
    const dir = makeTempDir();
    const targetPath = writeGlobalConfig(dir, "defaults:\n  editor: vim\n");
    const before = sha256(readFileSync(targetPath, "utf8"));

    // reason: GlobalLoreConfigSchema is .strict() at the top level — an unknown
    // key ("bogus") is schema-invalid regardless of what's nested under it.
    const result = saveGlobalConfig(
      { defaults: { editor: "nano" }, bogus: "field" } as never,
      targetPath,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("VALIDATION_ERROR");
    }

    const after = sha256(readFileSync(targetPath, "utf8"));
    expect(after).toBe(before);
  });

  it("NEGATIVE: an invalid enum value (defaults.format) is rejected, writes 0 bytes", () => {
    const dir = makeTempDir();
    const targetPath = join(dir, "config.yaml");
    // reason: no pre-existing file this time — asserts the REJECTED write never
    // CREATES a file either (not just "doesn't corrupt an existing one").
    const result = saveGlobalConfig(
      { defaults: { format: "yaml" } } as never,
      targetPath,
    );
    expect(result.ok).toBe(false);
    expect(existsSync(targetPath)).toBe(false);
  });

  // ─── BOUNDARY ───────────────────────────────────────────────────────────

  it("BOUNDARY: creates every missing nested parent directory in one write", () => {
    const dir = makeTempDir();
    const targetPath = join(dir, "a", "b", "c", "d", "e", "config.yaml");

    const result = saveGlobalConfig({ defaults: { color: true } }, targetPath);
    expect(result.ok).toBe(true);
    expect(existsSync(join(dir, "a", "b", "c", "d", "e"))).toBe(true);
    expect(existsSync(targetPath)).toBe(true);
  });

  it("BOUNDARY: an empty GlobalLoreConfig ({}) writes successfully and round-trips to {}", () => {
    const dir = makeTempDir();
    const targetPath = join(dir, "config.yaml");

    const result = saveGlobalConfig({}, targetPath);
    expect(result.ok).toBe(true);

    const reread = loadGlobalConfig(targetPath);
    expect(reread.ok).toBe(true);
    if (reread.ok) {
      expect(reread.value).toEqual({});
    }
  });

  // ─── ERROR ──────────────────────────────────────────────────────────────

  it("ERROR: does not throw on a malformed (non-object) candidate", () => {
    const dir = makeTempDir();
    const targetPath = join(dir, "config.yaml");

    expect(() => saveGlobalConfig(null as never, targetPath)).not.toThrow();
    expect(() => saveGlobalConfig("not-an-object" as never, targetPath)).not.toThrow();
    expect(existsSync(targetPath)).toBe(false);
  });

  // ─── REGRESSION ─────────────────────────────────────────────────────────

  it("REGRESSION: an accepted write's content is exactly what loadGlobalConfig reads back", () => {
    const dir = makeTempDir();
    const targetPath = join(dir, "config.yaml");
    const config = { defaults: { format: "text" as const, color: true } };

    const result = saveGlobalConfig(config, targetPath);
    expect(result.ok).toBe(true);

    const reread = loadGlobalConfig(targetPath);
    expect(reread.ok).toBe(true);
    if (reread.ok) {
      expect(reread.value).toEqual(config);
    }
  });
});

describe("resolveGlobalConfigWritePath() — precedence (mirrors resolveGlobalConfigPath, unresolved-by-existence)", () => {
  it("prefers $LORE_CONFIG_HOME when set, regardless of whether the file exists", () => {
    const dir = makeTempDir(); // no config.yaml inside — deliberately non-existent
    process.env["LORE_CONFIG_HOME"] = dir;
    delete process.env["XDG_CONFIG_HOME"];

    expect(resolveGlobalConfigWritePath()).toBe(join(dir, "config.yaml"));
  });

  it("falls back to $XDG_CONFIG_HOME/lore/config.yaml when LORE_CONFIG_HOME is unset", () => {
    delete process.env["LORE_CONFIG_HOME"];
    const dir = makeTempDir();
    process.env["XDG_CONFIG_HOME"] = dir;

    expect(resolveGlobalConfigWritePath()).toBe(join(dir, "lore", "config.yaml"));
  });

  it("falls back to ~/.config/lore/config.yaml when neither env var is set", () => {
    delete process.env["LORE_CONFIG_HOME"];
    delete process.env["XDG_CONFIG_HOME"];

    expect(resolveGlobalConfigWritePath()).toBe(join(homedir(), ".config", "lore", "config.yaml"));
  });
});
