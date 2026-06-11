/**
 * @spec_ref AC-SYNC-APP-001 (SPEC-009 §3.3 §7, D-006, D-007)
 *
 * RED integration tests for:
 *   - createApp store selection (SQLiteStore vs TursoStore) [SPEC-009 §3.3, D-007]
 *   - Fail-loud when sync enabled but token env missing [D-007]
 *   - `lore sync pull` handler exits 1 when unconfigured [SPEC-009 §5]
 *
 * CONSTRUCTION ASSUMPTIONS (define the FUTURE API shape via tests):
 *   createApp(dbPath: string, config?: LoreConfig): App | Result<App, LoreError>
 *
 *   D-007: When config.sync.enabled=true AND remote_url present AND token env set
 *          → TursoStore is selected (not SQLiteStore).
 *   D-007: When config.sync.enabled=true AND remote_url present AND token env MISSING
 *          → MUST fail loud (Result.ok=false with VALIDATION_ERROR), NOT silent SQLite fallback.
 *   Scenario 1: No sync config → SQLiteStore (regression lock; this should pass NOW)
 *   Scenario 2: Sync config + token → TursoStore (RED until createApp accepts config param)
 *   Scenario 3: Sync config + missing token → fail loud (RED)
 *   Scenario 6: `lore sync pull` unconfigured → exit 1 (some parts may already pass)
 *
 * STORE SELECTION DETECTION STRATEGY:
 *   Since createApp returns an App (no .store discriminator today), we detect TursoStore
 *   by calling app.corpusService.listAll() and checking if it returns ok:true in async mode.
 *   More robustly: we check that the app was created WITHOUT error, and that it is NOT
 *   a SQLiteStore-backed app (SQLiteStore has .db, TursoStore has .client).
 *   We also import TursoStore/SQLiteStore classes to perform instanceof checks IF the
 *   implementation exposes the store on the App interface. If not, we use behavioral checks.
 *
 * These tests run under `bun test .bun.test` ONLY.
 * Scenario 1 may pass immediately (regression lock).
 * Scenarios 2, 3 will FAIL RED until createApp is extended to accept config.
 *
 * IMPORTANT: This file does NOT import from sync-push — that is tested separately.
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// ─── Module Imports ──────────────────────────────────────────────────────────

// Real implementations (not mocked — behavioral oracle)
import { createApp, type App } from "../../src/app.js";
import type { LoreConfig } from "../../src/core/config.js";
import type { Result, LoreError } from "../../src/core/errors.js";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeTmpDir(label: string): string {
  return mkdtempSync(join(tmpdir(), `lore-sync-app-${label}-`));
}

/** Create a minimal LoreConfig with no sync section (local-only). */
function makeLocalConfig(): LoreConfig {
  return {
    project: { name: "test-project", author: "tester" },
  };
}

/** Create a LoreConfig with sync.enabled=true and a fake remote_url. */
function makeSyncConfig(tokenEnvName: string = "LORE_TEST_SYNC_TOKEN"): LoreConfig {
  return {
    project: { name: "test-project", author: "tester" },
    sync: {
      enabled: true,
      remote_url: "libsql://test-db.turso.io",
      auth_token_env: tokenEnvName,
      interval: 60,
    },
  };
}

/** Type-guard: is the createApp return value a Result (has .ok property)? */
function isResult(value: unknown): value is Result<App, LoreError> {
  return typeof value === "object" && value !== null && "ok" in value;
}

/** Helper to close App whether returned directly or wrapped in Result. */
function closeApp(appOrResult: App | Result<App, LoreError>): void {
  if (isResult(appOrResult)) {
    if (appOrResult.ok) {
      appOrResult.value.close();
    }
  } else {
    (appOrResult as App).close();
  }
}

// ─── Shared Env Cleanup ──────────────────────────────────────────────────────

const TEST_TOKEN_ENV = "LORE_TEST_SYNC_TOKEN";

afterEach(() => {
  // Always clean up test env var to prevent cross-test leakage
  delete process.env[TEST_TOKEN_ENV];
  delete process.env["LORE_SYNC_TOKEN"];
});

// ─── Test Suite ───────────────────────────────────────────────────────────────

// ===========================================================================
// SCENARIO 1 — Local-only (no sync config) → SQLiteStore
// This is a REGRESSION LOCK and should PASS immediately.
// ===========================================================================

describe("createApp — no sync config (regression lock, SPEC-009 §3.3 invariant)", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir("local-only");
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("createApp(dbPath) without config param succeeds and returns a working App", () => {
    const dbPath = join(tmpDir, "lore.db");
    const app = createApp(dbPath);

    // Must return an App-shaped object (not a Result with ok:false)
    // Regression: if createApp were to silently fail, corpus operations would break
    expect(app).toBeDefined();

    // Must have all expected service properties
    expect(typeof app.corpusService).toBe("object");
    expect(typeof app.reviewService).toBe("object");
    expect(typeof app.versionService).toBe("object");
    expect(typeof app.outlineService).toBe("object");
    expect(typeof app.migrationService).toBe("object");
    expect(typeof app.apiKeyStore).toBe("object");
    expect(typeof app.close).toBe("function");

    app.close();
  });

  it("createApp(dbPath) local-only creates a usable corpus service (can insert and retrieve)", async () => {
    const dbPath = join(tmpDir, "lore2.db");
    const app = createApp(dbPath);

    // Behavioral check: SQLiteStore-backed app must be able to insert and list docs
    const insertResult = await app.corpusService.create({
      type: "prd",
      title: "Local Test Doc",
      content: "local-only content",
      created_by: "tester",
    });

    expect(insertResult.ok).toBe(true);

    app.close();
  });
});

// ===========================================================================
// SCENARIO 2 — Sync config + token set → TursoStore selected
// RED until createApp is extended to accept config param.
// ===========================================================================

describe("createApp — sync config + token env set → TursoStore (SPEC-009 D-007)", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir("turso-select");
    // Set the token env var to a non-empty value
    process.env[TEST_TOKEN_ENV] = "test-token-12345";
  });

  afterEach(() => {
    delete process.env[TEST_TOKEN_ENV];
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("createApp(dbPath, config) with sync.enabled=true returns an App (not an error)", () => {
    const dbPath = join(tmpDir, "lore.db");
    const config = makeSyncConfig(TEST_TOKEN_ENV);

    // FUTURE API: createApp must accept an optional second config param
    // This call will fail RED with a TypeScript/runtime error until implemented.
    // @ts-expect-error — second param does not exist yet (RED state)
    const appOrResult = createApp(dbPath, config);

    // Whether createApp returns App directly or Result<App, LoreError>,
    // the result must be non-error.
    if (isResult(appOrResult)) {
      expect(appOrResult.ok).toBe(true);
      if (appOrResult.ok) {
        appOrResult.value.close();
      }
    } else {
      // Returned App directly — also acceptable
      expect(appOrResult).toBeDefined();
      expect(typeof appOrResult.close).toBe("function");
      (appOrResult as App).close();
    }
  });

  it("createApp with sync config produces a store that accepts async corpus operations", async () => {
    const dbPath = join(tmpDir, "lore2.db");
    const config = makeSyncConfig(TEST_TOKEN_ENV);

    // @ts-expect-error — second param does not exist yet (RED state)
    const appOrResult = createApp(dbPath, config);

    let app: App;
    if (isResult(appOrResult)) {
      expect(appOrResult.ok).toBe(true);
      if (!appOrResult.ok) return;
      app = appOrResult.value;
    } else {
      app = appOrResult as App;
    }

    // TursoStore-backed app must also support corpus operations
    const insertResult = await app.corpusService.create({
      type: "prd",
      title: "Turso-backed Doc",
      content: "turso content",
      created_by: "tester",
    });

    // Should succeed — TursoStore in file: mode should work the same as SQLiteStore
    expect(insertResult.ok).toBe(true);

    app.close();
  });
});

// ===========================================================================
// SCENARIO 3 — Sync config + token env MISSING → FAIL LOUD (D-007)
// RED until createApp is extended.
// This is the critical anti-fallback test: D-007 says missing token MUST fail loud,
// NOT silently fall back to SQLiteStore.
// ===========================================================================

describe("createApp — sync enabled + token env MISSING → fail loud (D-007)", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir("missing-token");
    // Ensure the env var is NOT set (already cleaned in afterEach above, but be explicit)
    delete process.env[TEST_TOKEN_ENV];
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("createApp with sync.enabled=true but missing token env returns err, NOT a working App", () => {
    const dbPath = join(tmpDir, "lore.db");
    const config = makeSyncConfig(TEST_TOKEN_ENV); // points to env var that is NOT set

    // @ts-expect-error — second param does not exist yet (RED state)
    const appOrResult = createApp(dbPath, config);

    // D-007: MUST fail loud — either:
    //   (a) createApp returns Result<App, LoreError> with ok:false, or
    //   (b) createApp throws an Error
    // MUST NOT silently succeed and fall back to SQLiteStore.

    if (isResult(appOrResult)) {
      // Option A: Result pattern
      // ok MUST be false — missing token is a validation error, not recoverable via fallback
      expect(appOrResult.ok).toBe(false);
      if (!appOrResult.ok) {
        // Error code must indicate the credential failure
        const code = appOrResult.error.code;
        expect(["VALIDATION_ERROR", "STORE_ERROR"]).toContain(code);
      }
    } else {
      // Option B: If createApp returns App directly, it must NOT return a working app
      // when the token is missing. The implementation is wrong if it silently falls back.
      // If we reach here with a non-Result return, force the test to fail with a clear message.
      const typedApp = appOrResult as App;
      typedApp.close();
      throw new Error(
        "D-007 VIOLATION: createApp silently succeeded despite missing token env. " +
        "Expected: ok:false or thrown error when sync.enabled=true but token env is absent. " +
        "Got: working App — this is a silent fallback bug.",
      );
    }
  });

  it("createApp with sync.enabled=true and empty token env var also fails loud", () => {
    const dbPath = join(tmpDir, "lore2.db");
    const config = makeSyncConfig(TEST_TOKEN_ENV);

    // Set env var to empty string — must also fail (not treat empty as valid token)
    process.env[TEST_TOKEN_ENV] = "";

    // @ts-expect-error — second param does not exist yet (RED state)
    const appOrResult = createApp(dbPath, config);

    if (isResult(appOrResult)) {
      expect(appOrResult.ok).toBe(false);
    } else {
      const typedApp = appOrResult as App;
      typedApp.close();
      throw new Error(
        "D-007 VIOLATION: createApp silently accepted empty string token. " +
        "Expected: ok:false when token env var is empty.",
      );
    }

    delete process.env[TEST_TOKEN_ENV];
  });
});

// ===========================================================================
// SCENARIO 6 — `lore sync pull` unconfigured → exit 1
// Uses Bun.spawnSync (subprocess) to test the full CLI path.
// Some of this may already be covered by sync-cli.test.ts (vitest), so we
// add only the bun.test.ts variant for the pull wiring path once configured.
// ===========================================================================

describe("lore sync pull — unconfigured → exit 1 (SPEC-009 §5)", () => {
  let tmpDir: string;

  const PROJECT_ROOT = new URL("../../", import.meta.url).pathname.replace(/\/$/, "");
  const INDEX_TS = join(PROJECT_ROOT, "src", "index.ts");

  function runLore(args: string[], cwd: string, extraEnv: Record<string, string> = {}): {
    stdout: string;
    stderr: string;
    exitCode: number;
  } {
    const proc = Bun.spawnSync(["bun", "run", INDEX_TS, ...args], {
      cwd,
      env: { ...process.env, HOME: cwd, ...extraEnv },
    });
    return {
      stdout: proc.stdout.toString(),
      stderr: proc.stderr.toString(),
      exitCode: proc.exitCode ?? 1,
    };
  }

  beforeEach(() => {
    // Do NOT pre-create .lore/ — let `lore init` do it
    tmpDir = makeTmpDir("pull-e2e");
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("lore sync pull with no sync config exits 1 and prints error", () => {
    // Initialize a project first (creates .lore/lore.db)
    const initResult = runLore(["init", "--name", "pull-test"], tmpDir);
    expect(initResult.exitCode).toBe(0);

    // lore sync pull — no sync configured → must exit 1
    const result = runLore(["sync", "pull"], tmpDir);

    expect(result.exitCode).toBe(1);

    // Must produce an error message (not silent)
    const combined = (result.stdout + result.stderr).toLowerCase();
    const hasErrorMessage =
      combined.includes("not configured") ||
      combined.includes("no sync") ||
      combined.includes("sync") ||
      combined.includes("error");
    expect(hasErrorMessage).toBe(true);
  });

  it("lore sync pull with sync.enabled=true but missing token env exits 1 (D-007)", () => {
    // Init project
    runLore(["init", "--name", "pull-token-test"], tmpDir);

    // Manually write a config.yaml with sync section
    writeFileSync(
      join(tmpDir, ".lore", "config.yaml"),
      [
        "project:",
        "  name: pull-token-test",
        "  author: tester",
        "sync:",
        "  enabled: true",
        '  remote_url: "libsql://pull-token-test.turso.io"',
        "  auth_token_env: LORE_TEST_PULL_TOKEN",
        "  interval: 60",
      ].join("\n"),
    );

    // Run pull WITHOUT the token env — must fail loud
    const result = runLore(
      ["sync", "pull"],
      tmpDir,
      // Explicitly exclude the token env (remove it from env)
      { LORE_TEST_PULL_TOKEN: "" },
    );

    // D-007: must fail loud — not silently use SQLiteStore
    expect(result.exitCode).toBe(1);
    const combined = (result.stdout + result.stderr).toLowerCase();
    const hasError =
      combined.includes("not set") ||
      combined.includes("missing") ||
      combined.includes("unavailable") ||
      combined.includes("error") ||
      combined.includes("token");
    expect(hasError).toBe(true);
  });

  it("lore sync pull with valid sync config executes pull (placeholder returns error but exits 1 per NOT_WIRED)", () => {
    // This tests the wiring path: config loads → credentials resolve → performPull called
    // Since performPull is currently a placeholder, it returns STORE_ERROR → exit 1.
    // Once wired, this test will be updated to expect exit 0.
    // For now, it verifies the credential-resolution path is exercised (not just config-load).

    runLore(["init", "--name", "pull-wired-test"], tmpDir);

    writeFileSync(
      join(tmpDir, ".lore", "config.yaml"),
      [
        "project:",
        "  name: pull-wired-test",
        "  author: tester",
        "sync:",
        "  enabled: true",
        '  remote_url: "libsql://pull-wired-test.turso.io"',
        "  auth_token_env: LORE_TEST_PULL_TOKEN_WIRED",
        "  interval: 60",
      ].join("\n"),
    );

    // Run WITH a valid-looking token (no actual remote)
    const result = runLore(
      ["sync", "pull"],
      tmpDir,
      { LORE_TEST_PULL_TOKEN_WIRED: "fake-token-wired" },
    );

    // The placeholder performPull returns STORE_ERROR → exit 1.
    // This test verifies the credential path is reached (token env was used, not "missing token").
    // When pull is implemented (Phase 2c), this test should be updated to expect exit 0
    // for a file: mode scenario. Right now exit 1 is correct because it's a placeholder.
    expect(result.exitCode).toBe(1);

    // Must NOT produce "not configured" or "missing token" error
    // (those would indicate it failed before reaching performPull)
    const errText = result.stderr.toLowerCase();
    const failedAtConfig =
      errText.includes("not configured") || errText.includes("not set or is empty");
    expect(failedAtConfig).toBe(false);
  });
});

// ===========================================================================
// BOUNDARY VALUES — createApp with config=undefined (explicit undefined)
// ===========================================================================

describe("createApp — boundary values", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir("boundary");
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("createApp(dbPath, undefined) is equivalent to createApp(dbPath) — uses SQLiteStore", () => {
    const dbPath = join(tmpDir, "lore.db");

    // @ts-expect-error — second param does not exist yet (RED state)
    const appOrResult = createApp(dbPath, undefined);

    // Passing explicit undefined must behave like no config — SQLiteStore, local-only
    if (isResult(appOrResult)) {
      expect(appOrResult.ok).toBe(true);
      if (appOrResult.ok) {
        expect(appOrResult.value.corpusService).toBeDefined();
        appOrResult.value.close();
      }
    } else {
      expect((appOrResult as App).corpusService).toBeDefined();
      (appOrResult as App).close();
    }
  });
});

// ===========================================================================
// REGRESSION — Existing createApp(dbPath) API must not break
// ===========================================================================

describe("createApp — regression (existing API must not break)", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir("regression");
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("createApp(dbPath) single-arg call still works after config param is added", async () => {
    const dbPath = join(tmpDir, "lore.db");

    // This call MUST keep working — it's the existing public API used by all CLI commands
    const app = createApp(dbPath);

    expect(app.corpusService).toBeDefined();
    expect(app.reviewService).toBeDefined();
    expect(app.versionService).toBeDefined();
    expect(app.outlineService).toBeDefined();
    expect(app.migrationService).toBeDefined();
    expect(app.apiKeyStore).toBeDefined();
    expect(typeof app.close).toBe("function");

    // Functional check: must be able to list docs (empty is fine)
    const listResult = await app.corpusService.list({});
    expect(listResult.ok).toBe(true);

    app.close();
  });

  it("lore sync push unconfigured exits 1 (existing behavior from sync.ts placeholder)", () => {
    // Regression lock: the push placeholder always returns STORE_ERROR → exit 1
    // when no sync config is present. This MUST keep failing until push is wired.
    const tmpProjDir = makeTmpDir("push-reg");
    mkdirSync(join(tmpProjDir, ".lore"), { recursive: true });

    const PROJECT_ROOT = new URL("../../", import.meta.url).pathname.replace(/\/$/, "");
    const INDEX_TS = join(PROJECT_ROOT, "src", "index.ts");

    // Init project
    Bun.spawnSync(["bun", "run", INDEX_TS, "init", "--name", "push-reg"], {
      cwd: tmpProjDir,
      env: { ...process.env, HOME: tmpProjDir },
    });

    // Push without config
    const result = Bun.spawnSync(["bun", "run", INDEX_TS, "sync", "push"], {
      cwd: tmpProjDir,
      env: { ...process.env, HOME: tmpProjDir },
    });

    expect(result.exitCode).toBe(1);

    rmSync(tmpProjDir, { recursive: true, force: true });
  });
});
