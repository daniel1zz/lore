/**
 * @spec_ref SPEC-003 §6.2 (global config + defaults in loadLoreApp)
 *
 * Bun integration tests for loadLoreApp() global config support.
 * Verifies that loadLoreApp() returns correct `defaults` when:
 *   - global config exists with defaults
 *   - global config is missing (silent — defaults is {})
 *   - global config is malformed (warning to stderr, defaults is {}, app still works)
 *   - global + project defaults are merged (project wins)
 *
 * Six-dimension coverage:
 *   HAPPY:      global config with defaults.editor → loadLoreApp returns defaults.editor
 *   NEGATIVE:   no global config → defaults is {} (silent)
 *   BOUNDARY:   global config with empty defaults: {} → defaults is {}
 *   ERROR:      malformed global config → stderr warning, defaults is {}, app usable
 *   STATE:      multiple loadLoreApp calls return independent Apps with consistent defaults
 *   REGRESSION: existing return shape { app, dbPath } still present; corpus operations work
 *
 * Uses bun:test (loadLoreApp transitively imports bun:sqlite via app.ts / SQLiteStore).
 */

import { describe, it, expect, beforeEach, afterEach, spyOn } from "bun:test";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  existsSync,
} from "fs";
import { join, resolve } from "path";
import { tmpdir } from "os";
import { createApp } from "../../../../src/app.js";
import { loadLoreApp } from "../../../../src/adapters/cli/loader.js";
import { saveConfig } from "../../../../src/core/config.js";

// ─── Helpers ────────────────────────────────────────────────────────────────

function createTempProject(): string {
  const dir = resolve(mkdtempSync(join(tmpdir(), "lore-loader-global-test-")));
  const loreDir = join(dir, ".lore");
  mkdirSync(loreDir, { recursive: true });
  const dbPath = join(loreDir, "lore.db");
  const app = createApp(dbPath);
  app.close();
  return dir;
}

function writeProjectConfig(projectDir: string, config: object): void {
  saveConfig(projectDir, config as never);
}

function writeGlobalConfig(dir: string, content: string): void {
  writeFileSync(join(dir, "config.yaml"), content, "utf8");
}

function makeXdgConfigHome(content: string): string {
  const xdgDir = resolve(mkdtempSync(join(tmpdir(), "lore-xdg-test-")));
  const loreDir = join(xdgDir, "lore");
  mkdirSync(loreDir, { recursive: true });
  writeFileSync(join(loreDir, "config.yaml"), content, "utf8");
  return xdgDir;
}

// ─── cwd + env save/restore ───────────────────────────────────────────────────

let originalCwd: string;
let savedEnv: { LORE_CONFIG_HOME: string | undefined; XDG_CONFIG_HOME: string | undefined } = {
  LORE_CONFIG_HOME: undefined,
  XDG_CONFIG_HOME: undefined,
};

beforeEach(() => {
  originalCwd = process.cwd();
  savedEnv = {
    LORE_CONFIG_HOME: process.env["LORE_CONFIG_HOME"],
    XDG_CONFIG_HOME: process.env["XDG_CONFIG_HOME"],
  };
  // Clear both so tests start from a known state (avoid picking up developer's config)
  delete process.env["LORE_CONFIG_HOME"];
  delete process.env["XDG_CONFIG_HOME"];
});

afterEach(() => {
  process.chdir(originalCwd);
  const { LORE_CONFIG_HOME, XDG_CONFIG_HOME } = savedEnv;
  if (LORE_CONFIG_HOME === undefined) {
    delete process.env["LORE_CONFIG_HOME"];
  } else {
    process.env["LORE_CONFIG_HOME"] = LORE_CONFIG_HOME;
  }
  if (XDG_CONFIG_HOME === undefined) {
    delete process.env["XDG_CONFIG_HOME"];
  } else {
    process.env["XDG_CONFIG_HOME"] = XDG_CONFIG_HOME;
  }
});

// ─── HAPPY ───────────────────────────────────────────────────────────────────

describe("loadLoreApp — global config HAPPY", () => {
  it("global config with defaults.editor → loadLoreApp returns defaults.editor", () => {
    const projectDir = createTempProject();
    const globalDir = resolve(mkdtempSync(join(tmpdir(), "lore-global-")));
    writeGlobalConfig(globalDir, "defaults:\n  editor: vim\n");
    process.env["LORE_CONFIG_HOME"] = globalDir;

    process.chdir(projectDir);
    const { app, dbPath, defaults } = loadLoreApp();
    try {
      expect(dbPath).toEndWith("/.lore/lore.db");
      expect(defaults.editor).toBe("vim");
      expect(app).toBeDefined();
    } finally {
      app.close();
    }
  });

  it("global config with all defaults → all fields present in merged defaults", () => {
    const projectDir = createTempProject();
    const globalDir = resolve(mkdtempSync(join(tmpdir(), "lore-global-")));
    writeGlobalConfig(globalDir, "defaults:\n  editor: emacs\n  format: json\n  color: false\n");
    process.env["LORE_CONFIG_HOME"] = globalDir;

    process.chdir(projectDir);
    const { app, defaults } = loadLoreApp();
    try {
      expect(defaults.editor).toBe("emacs");
      expect(defaults.format).toBe("json");
      expect(defaults.color).toBe(false);
    } finally {
      app.close();
    }
  });
});

// ─── NEGATIVE ────────────────────────────────────────────────────────────────

describe("loadLoreApp — global config NEGATIVE", () => {
  it("no global config → defaults is {} (silent, no error)", () => {
    const projectDir = createTempProject();
    process.chdir(projectDir);

    const { app, defaults } = loadLoreApp();
    try {
      expect(defaults).toEqual({});
    } finally {
      app.close();
    }
  });

  it("global config has no defaults section → defaults is {}", () => {
    const projectDir = createTempProject();
    const globalDir = resolve(mkdtempSync(join(tmpdir(), "lore-global-")));
    writeGlobalConfig(globalDir, "{}\n");
    process.env["LORE_CONFIG_HOME"] = globalDir;

    process.chdir(projectDir);
    const { app, defaults } = loadLoreApp();
    try {
      expect(defaults).toEqual({});
    } finally {
      app.close();
    }
  });
});

// ─── BOUNDARY ────────────────────────────────────────────────────────────────

describe("loadLoreApp — global config BOUNDARY", () => {
  it("global config with empty defaults: {} → defaults is {}", () => {
    const projectDir = createTempProject();
    const globalDir = resolve(mkdtempSync(join(tmpdir(), "lore-global-")));
    writeGlobalConfig(globalDir, "defaults: {}\n");
    process.env["LORE_CONFIG_HOME"] = globalDir;

    process.chdir(projectDir);
    const { app, defaults } = loadLoreApp();
    try {
      expect(defaults).toEqual({});
    } finally {
      app.close();
    }
  });

  it("empty global config file → defaults is {} (treated as missing)", () => {
    const projectDir = createTempProject();
    const globalDir = resolve(mkdtempSync(join(tmpdir(), "lore-global-")));
    writeGlobalConfig(globalDir, "");
    process.env["LORE_CONFIG_HOME"] = globalDir;

    process.chdir(projectDir);
    const { app, defaults } = loadLoreApp();
    try {
      expect(defaults).toEqual({});
    } finally {
      app.close();
    }
  });

  it("project config with defaults overrides global defaults", () => {
    const projectDir = createTempProject();
    writeProjectConfig(projectDir, {
      project: { name: "test", author: "tester" },
      defaults: { editor: "nano" },
    });

    const globalDir = resolve(mkdtempSync(join(tmpdir(), "lore-global-")));
    writeGlobalConfig(globalDir, "defaults:\n  editor: vim\n  color: true\n");
    process.env["LORE_CONFIG_HOME"] = globalDir;

    process.chdir(projectDir);
    const { app, defaults } = loadLoreApp();
    try {
      expect(defaults.editor).toBe("nano"); // project wins
      expect(defaults.color).toBe(true);   // global fallback preserved
    } finally {
      app.close();
    }
  });
});

// ─── ERROR (AC-GC-5) ─────────────────────────────────────────────────────────

describe("loadLoreApp — global config ERROR (AC-GC-5)", () => {
  it("malformed global config → prints warning to stderr, defaults is {}, app still works", async () => {
    const projectDir = createTempProject();
    const globalDir = resolve(mkdtempSync(join(tmpdir(), "lore-global-")));
    writeGlobalConfig(globalDir, "defaults:\n  editor: [unclosed bracket\n");
    process.env["LORE_CONFIG_HOME"] = globalDir;

    const stderrMessages: string[] = [];
    const spy = spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      stderrMessages.push(args.join(" "));
    });

    process.chdir(projectDir);
    let app;
    try {
      const result = loadLoreApp();
      app = result.app;
      const { defaults } = result;

      // Warning printed to stderr
      expect(stderrMessages.some((m) => m.includes("Warning"))).toBe(true);
      expect(stderrMessages.some((m) => m.includes(globalDir))).toBe(true);

      // Defaults falls back to {}
      expect(defaults).toEqual({});

      // App is still fully functional
      const listResult = await app.corpusService.list({});
      expect(listResult.ok).toBe(true);
    } finally {
      app?.close();
      spy.mockRestore();
    }
  });

  it("global config with project: key → warning to stderr, defaults is {}, app works", async () => {
    const projectDir = createTempProject();
    const globalDir = resolve(mkdtempSync(join(tmpdir(), "lore-global-")));
    writeGlobalConfig(globalDir, "project:\n  name: lore\n  author: alice\n");
    process.env["LORE_CONFIG_HOME"] = globalDir;

    const stderrMessages: string[] = [];
    const spy = spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      stderrMessages.push(args.join(" "));
    });

    process.chdir(projectDir);
    let app;
    try {
      const result = loadLoreApp();
      app = result.app;

      expect(stderrMessages.some((m) => m.includes("Warning"))).toBe(true);
      expect(result.defaults).toEqual({});

      const listResult = await app.corpusService.list({});
      expect(listResult.ok).toBe(true);
    } finally {
      app?.close();
      spy.mockRestore();
    }
  });
});

// ─── STATE ────────────────────────────────────────────────────────────────────

describe("loadLoreApp — global config STATE", () => {
  it("two consecutive calls return independent App instances with consistent defaults", () => {
    const projectDir = createTempProject();
    const globalDir = resolve(mkdtempSync(join(tmpdir(), "lore-global-")));
    writeGlobalConfig(globalDir, "defaults:\n  editor: vim\n");
    process.env["LORE_CONFIG_HOME"] = globalDir;

    process.chdir(projectDir);
    const { app: app1, defaults: defaults1 } = loadLoreApp();
    const { app: app2, defaults: defaults2 } = loadLoreApp();

    try {
      expect(app1).not.toBe(app2);
      expect(defaults1.editor).toBe("vim");
      expect(defaults2.editor).toBe("vim");
      // Independent App instances
      expect(app1.corpusService).not.toBe(app2.corpusService);
    } finally {
      app1.close();
      app2.close();
    }
  });
});

// ─── REGRESSION (AC-GC-6) ────────────────────────────────────────────────────

describe("loadLoreApp — REGRESSION (AC-GC-6)", () => {
  it("returns { app, dbPath, defaults } — app and dbPath still present for existing callers", () => {
    const projectDir = createTempProject();
    process.chdir(projectDir);

    const result = loadLoreApp();
    try {
      // All three keys present — non-breaking addition
      expect(result.app).toBeDefined();
      expect(result.dbPath).toBeDefined();
      expect(result.defaults).toBeDefined();
      expect(result.dbPath).toEndWith("/.lore/lore.db");
      expect(existsSync(result.dbPath)).toBe(true);
    } finally {
      result.app.close();
    }
  });

  it("corpus operations still work after adding global config support", async () => {
    const projectDir = createTempProject();
    writeProjectConfig(projectDir, {
      project: { name: "test", author: "tester" },
    });
    process.chdir(projectDir);

    const { app } = loadLoreApp();
    try {
      const createResult = await app.corpusService.create({
        type: "prd",
        title: "Regression PRD",
      });
      expect(createResult.ok).toBe(true);

      const listResult = await app.corpusService.list({});
      expect(listResult.ok).toBe(true);
      if (listResult.ok) {
        expect(listResult.value.total).toBeGreaterThanOrEqual(1);
      }
    } finally {
      app.close();
    }
  });

  it("no global config → defaults {} → no disruption to existing commands (silent)", () => {
    const projectDir = createTempProject();
    writeProjectConfig(projectDir, {
      project: { name: "test", author: "tester" },
      telemetry: { enabled: false },
    });
    process.chdir(projectDir);

    // Should not throw, not print anything extra to stderr
    const { app, defaults } = loadLoreApp();
    try {
      expect(defaults).toEqual({});
      expect(app.corpusService).toBeDefined();
    } finally {
      app.close();
    }
  });
});
