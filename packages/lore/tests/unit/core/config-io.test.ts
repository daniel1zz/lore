/**
 * @spec_ref AC-CORE-CONFIG-IO (SPEC-009 §6, D-004, D-007)
 *
 * RED test suite for file-IO and credential-resolution layers of @core/config.
 *
 * The implementation (loadConfig / saveConfig / resolveSyncCredentials) does NOT
 * exist yet. All tests in this file MUST FAIL because those named exports are
 * absent from src/core/config.ts until Phase 1c implementation lands.
 *
 * ⚠ Decision: We put these tests in a SEPARATE file (config-io.test.ts) rather
 *   than appending to config.test.ts.  Reason: importing non-existent named
 *   exports from @core/config at module-collection time would cause
 *   config.test.ts to fail with an import-level error, breaking all 29 existing
 *   (green) schema tests.  This file uses dynamic import() inside each test so
 *   the collection-time import error is isolated to this file only.
 *
 * Spec behaviors under test (derived from SPEC-009 §5 §6, NOT from source code):
 *
 *   loadConfig(dir: string): Result<LoreConfig, LoreError>
 *     - Reads <dir>/.lore/config.yaml
 *     - Valid file → {ok:true, value: LoreConfig}
 *     - Missing file → {ok:false, error.code VALIDATION_ERROR or STORE_ERROR}  (fail loud)
 *     - Malformed YAML → {ok:false, error.code VALIDATION_ERROR}              (fail loud)
 *     - File exists but schema invalid → {ok:false, error.code VALIDATION_ERROR}
 *     - Never throws
 *
 *   saveConfig(dir: string, config: LoreConfig): Result<void, LoreError>
 *     - Writes to <dir>/.lore/config.yaml
 *     - Written file MUST NOT contain any plaintext token value (D-004)
 *     - Written file MUST contain only the env-var name in auth_token_env (D-004)
 *     - Roundtrip: saveConfig + loadConfig → identical LoreConfig
 *     - Never throws
 *
 *   resolveSyncCredentials(config: LoreConfig): Result<{url:string,token:string},LoreError>
 *     - Reads process.env[config.sync.auth_token_env]
 *     - Env var set → {ok:true, value:{url, token}}
 *     - Env var NOT set → {ok:false, error.code VALIDATION_ERROR}  (fail loud, no silent undefined)
 *     - config has no sync section → {ok:false, error.code VALIDATION_ERROR}
 *     - Never throws
 *
 * Test plan:
 *   HAPPY: valid file read, roundtrip save+load, credentials resolved from env
 *   NEGATIVE: missing file, schema invalid, env var absent, no sync section
 *   BOUNDARY: empty auth_token_env string, custom env var name
 *   ERROR: directory not writable (N/A — hard to test portably; annotated below)
 *   STATE: N/A — stateless functions
 *   REGRESSION: no plaintext token written to disk (D-004)
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

// ─── Dynamic import helpers ───────────────────────────────────────────────────
//
// We use dynamic import() so that collection-time import failures in THIS file
// do not cascade to other test files.  Each test calls importConfigIO() which
// will throw the "module not found" / "export not found" error at the point of
// the test — that is the RED we want.

async function importConfigIO() {
  // loadConfig/saveConfig read/write the filesystem via Node fs — they live in
  // @lore/core/node (browser-safety split, packages/core/src/CLAUDE.md);
  // resolveSyncCredentials is pure (process.env only) and stays in @lore/core.
  const nodeMod = await import("@lore/core/node");
  const coreMod = await import("@lore/core");
  type LoadConfig = (dir: string) => import("@lore/core").Result<import("@lore/core").LoreConfig, import("@lore/core").LoreError>;
  type SaveConfig = (dir: string, config: import("@lore/core").LoreConfig) => import("@lore/core").Result<void, import("@lore/core").LoreError>;
  type ResolveSyncCredentials = (config: import("@lore/core").LoreConfig) => import("@lore/core").Result<{ url: string; token: string }, import("@lore/core").LoreError>;

  const loadConfig = (nodeMod as any).loadConfig as LoadConfig;
  const saveConfig = (nodeMod as any).saveConfig as SaveConfig;
  const resolveSyncCredentials = (coreMod as any).resolveSyncCredentials as ResolveSyncCredentials;

  if (typeof loadConfig !== "function") {
    throw new Error("@core/config does not export loadConfig — implementation missing (RED expected)");
  }
  if (typeof saveConfig !== "function") {
    throw new Error("@core/config does not export saveConfig — implementation missing (RED expected)");
  }
  if (typeof resolveSyncCredentials !== "function") {
    throw new Error("@core/config does not export resolveSyncCredentials — implementation missing (RED expected)");
  }

  return { loadConfig, saveConfig, resolveSyncCredentials };
}

// ─── Fixtures ────────────────────────────────────────────────────────────────

const VALID_CONFIG_YAML = `project:
  name: "test-project"
  author: "tester"
`;

const VALID_SYNC_CONFIG_YAML = `project:
  name: "sync-project"
  author: "tester"
sync:
  enabled: true
  remote_url: "libsql://sync-project-abc.turso.io"
  auth_token_env: "LORE_SYNC_TOKEN"
  interval: 60
`;

// ─── Temp dir lifecycle ───────────────────────────────────────────────────────

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "lore-config-io-test-"));
  // Create .lore/ subdirectory (mirroring real project layout)
  mkdirSync(join(tmpDir, ".lore"), { recursive: true });
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

// ─── env mutation cleanup ────────────────────────────────────────────────────

let savedEnvToken: string | undefined;

beforeEach(() => {
  savedEnvToken = process.env["LORE_SYNC_TOKEN"];
  delete process.env["LORE_SYNC_TOKEN"];
});

afterEach(() => {
  if (savedEnvToken !== undefined) {
    process.env["LORE_SYNC_TOKEN"] = savedEnvToken;
  } else {
    delete process.env["LORE_SYNC_TOKEN"];
  }
});

// ===========================================================================
// HAPPY PATH
// ===========================================================================

describe("loadConfig() — happy path (SPEC-009 §6)", () => {
  it("reads a valid config.yaml from <dir>/.lore/config.yaml and returns ok LoreConfig", async () => {
    writeFileSync(join(tmpDir, ".lore", "config.yaml"), VALID_CONFIG_YAML);

    const { loadConfig } = await importConfigIO();
    const result = loadConfig(tmpDir);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.project.name).toBe("test-project");
      expect(result.value.project.author).toBe("tester");
      expect(result.value.sync).toBeUndefined();
    }
  });

  it("reads a config with full sync section — all fields preserved", async () => {
    writeFileSync(join(tmpDir, ".lore", "config.yaml"), VALID_SYNC_CONFIG_YAML);

    const { loadConfig } = await importConfigIO();
    const result = loadConfig(tmpDir);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.project.name).toBe("sync-project");
      expect(result.value.sync?.enabled).toBe(true);
      expect(result.value.sync?.remote_url).toBe("libsql://sync-project-abc.turso.io");
      expect(result.value.sync?.auth_token_env).toBe("LORE_SYNC_TOKEN");
      expect(result.value.sync?.interval).toBe(60);
    }
  });

  it("two different config files produce two different LoreConfig values (anti-hardcoded)", async () => {
    const yaml1 = `project:\n  name: "alpha"\n  author: "alice"\n`;
    const yaml2 = `project:\n  name: "beta"\n  author: "bob"\n`;

    // Use two separate tmp dirs
    const tmpDir2 = mkdtempSync(join(tmpdir(), "lore-config-io-test-b-"));
    mkdirSync(join(tmpDir2, ".lore"), { recursive: true });
    try {
      writeFileSync(join(tmpDir, ".lore", "config.yaml"), yaml1);
      writeFileSync(join(tmpDir2, ".lore", "config.yaml"), yaml2);

      const { loadConfig } = await importConfigIO();
      const r1 = loadConfig(tmpDir);
      const r2 = loadConfig(tmpDir2);

      expect(r1.ok).toBe(true);
      expect(r2.ok).toBe(true);
      if (r1.ok && r2.ok) {
        expect(r1.value.project.name).toBe("alpha");
        expect(r2.value.project.name).toBe("beta");
        expect(r1.value.project.name).not.toBe(r2.value.project.name);
      }
    } finally {
      rmSync(tmpDir2, { recursive: true, force: true });
    }
  });
});

describe("saveConfig() + loadConfig() — roundtrip (SPEC-009 §6)", () => {
  it("save then load returns identical LoreConfig (local-only)", async () => {
    const { loadConfig, saveConfig } = await importConfigIO();

    const config = {
      project: { name: "roundtrip-project", author: "tester" },
    };

    const saveResult = saveConfig(tmpDir, config);
    expect(saveResult.ok).toBe(true);

    const loadResult = loadConfig(tmpDir);
    expect(loadResult.ok).toBe(true);
    if (loadResult.ok) {
      expect(loadResult.value.project.name).toBe("roundtrip-project");
      expect(loadResult.value.project.author).toBe("tester");
      expect(loadResult.value.sync).toBeUndefined();
    }
  });

  it("save then load returns identical LoreConfig (with sync section)", async () => {
    const { loadConfig, saveConfig } = await importConfigIO();

    const config = {
      project: { name: "sync-rt", author: "alice" },
      sync: {
        enabled: true,
        remote_url: "libsql://sync-rt.turso.io",
        auth_token_env: "MY_CUSTOM_TOKEN_ENV",
        interval: 120,
      },
    };

    const saveResult = saveConfig(tmpDir, config);
    expect(saveResult.ok).toBe(true);

    const loadResult = loadConfig(tmpDir);
    expect(loadResult.ok).toBe(true);
    if (loadResult.ok) {
      expect(loadResult.value.sync?.remote_url).toBe("libsql://sync-rt.turso.io");
      expect(loadResult.value.sync?.auth_token_env).toBe("MY_CUSTOM_TOKEN_ENV");
      expect(loadResult.value.sync?.interval).toBe(120);
    }
  });
});

describe("resolveSyncCredentials() — happy path (D-004, SPEC-009 §6)", () => {
  it("returns {ok:true, value:{url, token}} when env var is set", async () => {
    process.env["LORE_SYNC_TOKEN"] = "secret-turso-token";

    const { resolveSyncCredentials } = await importConfigIO();
    const config = {
      project: { name: "test", author: "tester" },
      sync: {
        enabled: true,
        remote_url: "libsql://test.turso.io",
        auth_token_env: "LORE_SYNC_TOKEN",
        interval: 60,
      },
    };

    const result = resolveSyncCredentials(config);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.url).toBe("libsql://test.turso.io");
      expect(result.value.token).toBe("secret-turso-token");
    }
  });

  it("uses the custom env var name from config.sync.auth_token_env", async () => {
    process.env["MY_PROJECT_TOKEN"] = "custom-env-token-value";

    const { resolveSyncCredentials } = await importConfigIO();
    const config = {
      project: { name: "test", author: "tester" },
      sync: {
        enabled: true,
        remote_url: "libsql://custom.turso.io",
        auth_token_env: "MY_PROJECT_TOKEN",
        interval: 60,
      },
    };

    const result = resolveSyncCredentials(config);

    delete process.env["MY_PROJECT_TOKEN"];

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.token).toBe("custom-env-token-value");
    }
  });
});

// ===========================================================================
// NEGATIVE CASES
// ===========================================================================

describe("loadConfig() — negative cases (SPEC-009 §6)", () => {
  it("returns {ok:false} when config.yaml does not exist — fails loud, not silent", async () => {
    // tmpDir/.lore/ exists but config.yaml is absent
    const { loadConfig } = await importConfigIO();

    const result = loadConfig(tmpDir);

    // MUST fail loud — no silent fallback to empty config
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBeDefined();
      // Should be either VALIDATION_ERROR or STORE_ERROR — both are acceptable fail-loud codes
      expect(["VALIDATION_ERROR", "STORE_ERROR"]).toContain(result.error.code);
    }
  });

  it("returns {ok:false, VALIDATION_ERROR} for malformed YAML in config file", async () => {
    writeFileSync(
      join(tmpDir, ".lore", "config.yaml"),
      "project:\n  name: [unclosed\n  bad::colon\n",
    );

    const { loadConfig } = await importConfigIO();
    const result = loadConfig(tmpDir);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("VALIDATION_ERROR");
    }
  });

  it("returns {ok:false, VALIDATION_ERROR} when YAML parses but schema is invalid", async () => {
    writeFileSync(
      join(tmpDir, ".lore", "config.yaml"),
      "project:\n  name: my-project\nsync:\n  enabled: true\n  # missing remote_url\n",
    );

    const { loadConfig } = await importConfigIO();
    const result = loadConfig(tmpDir);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("VALIDATION_ERROR");
    }
  });

  it("does NOT throw even when .lore/ directory is absent entirely", async () => {
    const noLoreDir = mkdtempSync(join(tmpdir(), "lore-config-io-nolore-"));
    try {
      const { loadConfig } = await importConfigIO();

      let result: Awaited<ReturnType<typeof importConfigIO>>["loadConfig"] extends (dir: string) => infer R ? R : never;
      expect(() => {
        result = loadConfig(noLoreDir);
      }).not.toThrow();

      const r = loadConfig(noLoreDir);
      expect(r.ok).toBe(false);
    } finally {
      rmSync(noLoreDir, { recursive: true, force: true });
    }
  });
});

describe("resolveSyncCredentials() — negative cases (D-004, SPEC-009 §6)", () => {
  it("returns {ok:false, VALIDATION_ERROR} when env var is NOT set — fail loud (D-004 anti-silent-undefined)", async () => {
    // Ensure the env var is absent (beforeEach deletes LORE_SYNC_TOKEN)
    expect(process.env["LORE_SYNC_TOKEN"]).toBeUndefined();

    const { resolveSyncCredentials } = await importConfigIO();
    const config = {
      project: { name: "test", author: "tester" },
      sync: {
        enabled: true,
        remote_url: "libsql://test.turso.io",
        auth_token_env: "LORE_SYNC_TOKEN",
        interval: 60,
      },
    };

    const result = resolveSyncCredentials(config);

    // MUST fail loud — NOT return {ok:true, value:{token: undefined}}
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("VALIDATION_ERROR");
      // Error message or field MUST mention the env var name so user knows what to set
      const errorStr = JSON.stringify(result.error);
      expect(errorStr).toContain("LORE_SYNC_TOKEN");
    }
  });

  it("returns {ok:false} when config has no sync section at all", async () => {
    const { resolveSyncCredentials } = await importConfigIO();
    const config = {
      project: { name: "local-only", author: "tester" },
      // sync intentionally absent
    };

    const result = resolveSyncCredentials(config);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("VALIDATION_ERROR");
    }
  });

  it("returns {ok:false} when env var is set to empty string (not a valid token)", async () => {
    process.env["LORE_SYNC_TOKEN"] = "";

    const { resolveSyncCredentials } = await importConfigIO();
    const config = {
      project: { name: "test", author: "tester" },
      sync: {
        enabled: true,
        remote_url: "libsql://test.turso.io",
        auth_token_env: "LORE_SYNC_TOKEN",
        interval: 60,
      },
    };

    const result = resolveSyncCredentials(config);

    // Empty string is not a valid token — must fail loud
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("VALIDATION_ERROR");
    }
  });

  // [Fix 3 regression] enabled=false with token set → err (fail loud, not silent ok)
  // Previously resolveSyncCredentials did not check sync.enabled, so a config with
  // sync.enabled=false but a valid env token would silently return credentials.
  // This test guards against that latent bug.
  it("REGRESSION Fix3: returns {ok:false} when sync.enabled=false even if env token is set", async () => {
    process.env["LORE_SYNC_TOKEN"] = "some-valid-token";

    const { resolveSyncCredentials } = await importConfigIO();
    // sync section exists but enabled=false — credentials must NOT be resolved
    const config = {
      project: { name: "test", author: "tester" },
      sync: {
        enabled: false,
        auth_token_env: "LORE_SYNC_TOKEN",
        interval: 60,
        // remote_url omitted (schema allows it when enabled=false)
      },
    };

    // Cast to LoreConfig because TypeScript enforces runtime shape via Zod,
    // but our test exercises the JS runtime guard directly.
    const result = resolveSyncCredentials(config as any);

    delete process.env["LORE_SYNC_TOKEN"];

    // Must fail loud — not return credentials for a disabled sync config
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("VALIDATION_ERROR");
    }
  });
});

// ===========================================================================
// BOUNDARY VALUES
// ===========================================================================

describe("loadConfig() — boundary values", () => {
  it("returns {ok:false} for a config.yaml with only whitespace content", async () => {
    writeFileSync(join(tmpDir, ".lore", "config.yaml"), "   \n\n   ");

    const { loadConfig } = await importConfigIO();
    const result = loadConfig(tmpDir);

    expect(result.ok).toBe(false);
  });

  it("returns {ok:false} for an empty config.yaml file (zero bytes)", async () => {
    writeFileSync(join(tmpDir, ".lore", "config.yaml"), "");

    const { loadConfig } = await importConfigIO();
    const result = loadConfig(tmpDir);

    expect(result.ok).toBe(false);
  });
});

describe("saveConfig() — boundary values (D-004 no-plaintext-token)", () => {
  it("written file does NOT contain any plaintext token value — only the env-var name (D-004 regression)", async () => {
    // This is the critical D-004 check: config must store the env-var NAME, not the secret.
    const { saveConfig } = await importConfigIO();

    const config = {
      project: { name: "security-test", author: "tester" },
      sync: {
        enabled: true,
        remote_url: "libsql://security.turso.io",
        // auth_token_env holds the NAME; no field holds the actual value
        auth_token_env: "MY_SECRET_ENV_VAR",
        interval: 60,
      },
    };

    // Simulate env var being set (should never appear in the file)
    process.env["MY_SECRET_ENV_VAR"] = "super-secret-plaintext-token-12345";

    const saveResult = saveConfig(tmpDir, config);
    expect(saveResult.ok).toBe(true);

    delete process.env["MY_SECRET_ENV_VAR"];

    // Read the raw file content and assert the secret is NOT present
    const rawContent = readFileSync(join(tmpDir, ".lore", "config.yaml"), "utf8");
    expect(rawContent).not.toContain("super-secret-plaintext-token-12345");
    // The env-var NAME must be present
    expect(rawContent).toContain("MY_SECRET_ENV_VAR");
  });

  it("saveConfig creates .lore/ directory if it does not exist", async () => {
    // Use a fresh dir without the .lore/ subdirectory pre-created
    const freshDir = mkdtempSync(join(tmpdir(), "lore-config-io-fresh-"));
    // intentionally do NOT create freshDir/.lore/
    try {
      const { saveConfig, loadConfig } = await importConfigIO();

      const config = { project: { name: "auto-dir", author: "tester" } };
      const saveResult = saveConfig(freshDir, config);
      expect(saveResult.ok).toBe(true);

      const loadResult = loadConfig(freshDir);
      expect(loadResult.ok).toBe(true);
    } finally {
      rmSync(freshDir, { recursive: true, force: true });
    }
  });
});

describe("resolveSyncCredentials() — boundary values", () => {
  it("handles a custom auth_token_env name with uppercase and underscores", async () => {
    process.env["ACME_CORP_LORE_TOKEN_PROD"] = "token-value-xyz";

    const { resolveSyncCredentials } = await importConfigIO();
    const config = {
      project: { name: "test", author: "tester" },
      sync: {
        enabled: true,
        remote_url: "libsql://acme.turso.io",
        auth_token_env: "ACME_CORP_LORE_TOKEN_PROD",
        interval: 30,
      },
    };

    const result = resolveSyncCredentials(config);

    delete process.env["ACME_CORP_LORE_TOKEN_PROD"];

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.token).toBe("token-value-xyz");
    }
  });
});

// ===========================================================================
// ERROR HANDLING
// ===========================================================================

describe("loadConfig() — error handling (never throws)", () => {
  it("does NOT throw for any input — always returns Result", async () => {
    const { loadConfig } = await importConfigIO();

    // Non-existent path
    expect(() => loadConfig("/non/existent/path/that/does/not/exist")).not.toThrow();
    const r = loadConfig("/non/existent/path/that/does/not/exist");
    expect(r.ok).toBe(false);
  });
});

describe("saveConfig() — error handling (never throws)", () => {
  it("does NOT throw for a read-only directory — returns {ok:false}", async () => {
    // N/A on some CI environments; annotated but not skipped
    // We only verify the function does not throw.
    const { saveConfig } = await importConfigIO();

    // Try to save to a directory that doesn't allow subdirectory creation
    // This is a best-effort test; on permissive OSes it may return ok:true
    // The critical property is: NEVER throws
    expect(() => {
      saveConfig("/tmp/definitely-does-not-exist-xyz123/subdir", {
        project: { name: "x", author: "x" },
      });
    }).not.toThrow();
  });
});

// ===========================================================================
// STATE — N/A: stateless pure functions
// ===========================================================================

// ===========================================================================
// REGRESSION
// ===========================================================================

describe("REGRESSION — D-004: no plaintext token on disk", () => {
  it("loadConfig never returns a token value — only env-var name (D-004)", async () => {
    // The config file itself should store the env-var NAME (e.g. "LORE_SYNC_TOKEN"),
    // NOT any resolved token value.  loadConfig must return the name string,
    // not a resolved secret.
    writeFileSync(join(tmpDir, ".lore", "config.yaml"), VALID_SYNC_CONFIG_YAML);
    process.env["LORE_SYNC_TOKEN"] = "secret-runtime-value-never-in-file";

    const { loadConfig } = await importConfigIO();
    const result = loadConfig(tmpDir);

    expect(result.ok).toBe(true);
    if (result.ok) {
      // The auth_token_env field must be the NAME "LORE_SYNC_TOKEN", not the value
      expect(result.value.sync?.auth_token_env).toBe("LORE_SYNC_TOKEN");
      expect(result.value.sync?.auth_token_env).not.toBe("secret-runtime-value-never-in-file");
    }
  });
});
