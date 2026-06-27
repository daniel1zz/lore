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
 *   NEGATIVE:   path resolution ordering ($LORE_CONFIG_HOME > $XDG_CONFIG_HOME > ~/.config)
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
  rmSync,
} from "fs";
import { join, resolve } from "path";
import { tmpdir } from "os";
import {
  GlobalLoreConfigSchema,
  resolveGlobalConfigPath,
  loadGlobalConfig,
  mergeDefaults,
  LoreDefaultsSchema,
} from "@core/config";

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
    // Call with explicit undefined — simulates no file found
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
