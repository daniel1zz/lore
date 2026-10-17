// @spawns packages/lore/src/index.ts
/**
 * @spec_ref AC-SYNC-APP-001 (SPEC-009 §3.3 §7, D-005, D-006, D-007)
 *
 * Integration tests for:
 *   - createApp store selection (SQLiteStore vs TursoStore) [SPEC-009 §3.3, D-007]
 *   - Fail-loud when sync enabled but token env missing [D-007]
 *   - Fail-loud when TursoStore construction fails (unreachable remote) [D-005, D-007]
 *   - `lore sync pull` handler exits 1 when unconfigured [SPEC-009 §5]
 *
 * MEASURED LIBSQL OFFLINE BEHAVIOR (empirically verified, not assumed):
 *   @libsql/client createClient() with an unreachable syncUrl throws EAGERLY at construction.
 *   Error: "sync error: error trying to connect: ..."
 *   This means new TursoStore({ remoteUrl: unreachable }) throws during construction.
 *   Therefore createApp() with sync enabled + unreachable remote returns err(STORE_ERROR).
 *   This satisfies D-005/D-007: writes NEVER silently land only-local — the store doesn't
 *   even construct. There is no silent fallback; the error is surfaced immediately.
 *
 * These tests run under `bun test .bun.test` ONLY.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// ─── Module Imports ──────────────────────────────────────────────────────────

import { createApp, type App } from "../../src/app.js";
import type { LoreConfig } from "@lore/core";
import type { Result, LoreError } from "@lore/core";

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

/**
 * Create a LoreConfig with sync.enabled=true and an unreachable remote URL.
 * Using a DNS-invalid hostname guarantees no real network calls succeed.
 */
function makeSyncConfig(
  tokenEnvName: string = "LORE_TEST_SYNC_TOKEN",
  remoteUrl: string = "libsql://nonexistent-host-for-tests.invalid",
): LoreConfig {
  return {
    project: { name: "test-project", author: "tester" },
    sync: {
      enabled: true,
      remote_url: remoteUrl,
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
// Regression lock: this MUST always pass.
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
    });

    expect(insertResult.ok).toBe(true);

    app.close();
  });
});

// ===========================================================================
// SCENARIO 2 — Sync config + token set + UNREACHABLE remote
//
// TRUE-SEMANTICS tests (SPEC-009 §3.3, D-005, D-007).
//
// Measured libsql behavior (empirically verified — see file header):
//   @libsql/client createClient() throws EAGERLY when syncUrl is unreachable.
//   Therefore new TursoStore({ remoteUrl: unreachable }) throws at construction.
//   createApp catches this and returns err(STORE_ERROR) — fail loud (D-005/D-007).
//
// The invariant that MUST hold (D-007 D-005):
//   With sync.enabled=true, writes NEVER silently land only-local.
//   Either TursoStore constructs successfully (real remote reachable),
//   OR createApp returns err(STORE_ERROR) — never a silent SQLiteStore fallback.
// ===========================================================================

describe("createApp — sync config + token env set + unreachable remote (SPEC-009 §3.3 D-007 D-005)", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir("turso-select");
    // Set a non-empty token env var
    process.env[TEST_TOKEN_ENV] = "test-token-12345";
  });

  afterEach(() => {
    delete process.env[TEST_TOKEN_ENV];
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("createApp with sync.enabled=true + unreachable remote fails loud with STORE_ERROR (D-007 invariant)", () => {
    // Measured behavior: @libsql/client createClient() throws eagerly when syncUrl is
    // unreachable. createApp must catch this and return err(STORE_ERROR) — NOT silently
    // fall back to SQLiteStore. This is the D-005/D-007 offline semantic.
    const dbPath = join(tmpDir, "lore.db");
    const config = makeSyncConfig(TEST_TOKEN_ENV);

    const appOrResult = createApp(dbPath, config);

    // Must be a Result (not a raw App) — sync-path always returns Result
    expect(isResult(appOrResult)).toBe(true);

    if (isResult(appOrResult)) {
      // D-007: must fail loud with STORE_ERROR (TursoStore construction failed)
      expect(appOrResult.ok).toBe(false);

      if (!appOrResult.ok) {
        expect(appOrResult.error.code).toBe("STORE_ERROR");
        // The error message must mention TursoStore construction failure
        const msg = (appOrResult.error as { code: string; message: string }).message;
        expect(msg).toContain("TursoStore construction failed");
      }
    }
  });

  it("createApp with unreachable remote does NOT silently return a working SQLiteStore-backed App (D-007 anti-regression)", () => {
    // This test guards against the specific regression D-007 was written to prevent:
    // createApp silently falling back to SQLiteStore when sync is enabled.
    const dbPath = join(tmpDir, "lore2.db");
    const config = makeSyncConfig(TEST_TOKEN_ENV);

    const appOrResult = createApp(dbPath, config);

    // If it returned a raw App (not wrapped in Result), that's a D-007 violation
    if (!isResult(appOrResult)) {
      // Close the app to avoid resource leaks before throwing
      (appOrResult as App).close();
      throw new Error(
        "D-007 VIOLATION: createApp returned a raw App (not a Result) for sync config. " +
        "With sync.enabled=true, createApp MUST always return Result<App, LoreError>. " +
        "A raw App return means sync semantics are being bypassed silently.",
      );
    }

    // If it returned an ok Result, that means TursoStore connected to the remote.
    // This is only valid if the remote is actually reachable (which we explicitly prevented).
    if (appOrResult.ok) {
      appOrResult.value.close();
      throw new Error(
        "D-007 VIOLATION: createApp returned ok:true for unreachable remote. " +
        "Expected: err(STORE_ERROR) because libsql throws eagerly on unreachable syncUrl. " +
        "This means the test's remote URL was unexpectedly reachable, OR " +
        "createApp silently constructed SQLiteStore instead of TursoStore.",
      );
    }

    // Correct: err result — D-007 satisfied
    expect(appOrResult.ok).toBe(false);
  });

  it("createApp sync error code is STORE_ERROR (not VALIDATION_ERROR — credentials were valid)", () => {
    // VALIDATION_ERROR = credentials missing/empty (handled before TursoStore construction)
    // STORE_ERROR = TursoStore construction failed (credentials valid, but remote unreachable)
    // This test distinguishes the two failure modes.
    const dbPath = join(tmpDir, "lore3.db");
    const config = makeSyncConfig(TEST_TOKEN_ENV); // token IS set — credentials are valid

    const appOrResult = createApp(dbPath, config);

    expect(isResult(appOrResult)).toBe(true);
    if (isResult(appOrResult) && !appOrResult.ok) {
      // Must be STORE_ERROR (construction failed), not VALIDATION_ERROR (cred missing)
      expect(appOrResult.error.code).toBe("STORE_ERROR");
      expect(appOrResult.error.code).not.toBe("VALIDATION_ERROR");
    }
  });
});

// ===========================================================================
// SCENARIO 3 — Sync config + token env MISSING → FAIL LOUD (D-007)
// The critical anti-fallback test: missing token MUST fail loud.
// ===========================================================================

describe("createApp — sync enabled + token env MISSING → fail loud (D-007)", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir("missing-token");
    // Ensure the env var is NOT set
    delete process.env[TEST_TOKEN_ENV];
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("createApp with sync.enabled=true but missing token env returns err, NOT a working App", () => {
    const dbPath = join(tmpDir, "lore.db");
    const config = makeSyncConfig(TEST_TOKEN_ENV); // points to env var that is NOT set

    // D-007: MUST fail loud — either:
    //   (a) createApp returns Result<App, LoreError> with ok:false, or
    //   (b) createApp throws an Error
    // MUST NOT silently succeed and fall back to SQLiteStore.

    const appOrResult = createApp(dbPath, config);

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

  it("missing token error code is VALIDATION_ERROR (pre-construction credential check)", () => {
    // Credential check happens BEFORE TursoStore construction.
    // Missing token → VALIDATION_ERROR (not STORE_ERROR).
    const dbPath = join(tmpDir, "lore3.db");
    const config = makeSyncConfig(TEST_TOKEN_ENV);

    const appOrResult = createApp(dbPath, config);

    expect(isResult(appOrResult)).toBe(true);
    if (isResult(appOrResult) && !appOrResult.ok) {
      expect(appOrResult.error.code).toBe("VALIDATION_ERROR");
    }
  });
});

// ===========================================================================
// SCENARIO 6 — `lore sync pull` unconfigured → exit 1
// Uses Bun.spawnSync (subprocess) to test the full CLI path.
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

  it("lore sync pull with valid sync config but unreachable remote exits 1 (fail-loud contract)", () => {
    // Contract: configured-but-unreachable remote → fail loud with exit 1.
    // This is permanent correct semantics per D-003/R4: when the remote cannot be
    // reached, pull MUST NOT silently succeed or fall back to local-only state.
    // The test verifies the credential-resolution path is exercised (config loaded,
    // token env resolved) before the network failure causes a STORE_ERROR exit 1.
    // Reachable-remote happy path = manual acceptance checklist (D-003/R4).

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

    // Exit 1 is the correct permanent contract for unreachable-remote pull.
    // Pull is wired; the remote URL is intentionally unreachable → STORE_ERROR → exit 1.
    // This verifies the credential path is reached (token env was used, not "missing token").
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
