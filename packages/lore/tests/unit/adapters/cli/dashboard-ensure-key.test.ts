/**
 * Tests for ensureLocalApiKey — local API key file management.
 * Source: SPEC-016 §3.6, AC-A-C1, AC-A-C2
 *
 * Test plan (6-dimension):
 *   HAPPY (AC-A-C1, AC-A-C2):
 *     - Creates .lore/local-key file when absent; returns the raw key
 *     - File content equals the rawKey from apiKeyStore.create()
 *
 *   NEGATIVE:
 *     - store.create() returns err → calls process.exit(1) (fail-loud)
 *
 *   BOUNDARY (AC-A-C2):
 *     - Existing .lore/local-key file is reused without calling store.create()
 *     - Whitespace in existing file is trimmed
 *
 *   ERROR:
 *     - Non-ok result from store.create does not leak (exits)
 *
 *   STATE:
 *     - First call creates file; second call on same dir reads file (not store)
 *
 *   REGRESSION:
 *     - Returned key matches file contents exactly
 */

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ensureLocalApiKey } from "../../../../src/adapters/cli/local-key.js";
import type { LocalApiKeyCreator } from "../../../../src/adapters/cli/local-key.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeTmpDir(): string {
  const dir = join(tmpdir(), `lore-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function makeSuccessStore(rawKey = "lore_ak_" + "a".repeat(64)): LocalApiKeyCreator {
  return {
    create: vi.fn().mockResolvedValue({
      ok: true,
      value: { rawKey, record: {} },
    }),
  };
}

function makeFailStore(code = "VALIDATION_ERROR", message = "Agent name 'dashboard-local' already exists"): LocalApiKeyCreator {
  return {
    create: vi.fn().mockResolvedValue({
      ok: false,
      error: { code, message },
    }),
  };
}

// ─── HAPPY ───────────────────────────────────────────────────────────────────

describe("ensureLocalApiKey — happy path", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("creates .lore/local-key when absent and returns the raw key (AC-A-C1)", async () => {
    const expectedKey = "lore_ak_" + "b".repeat(64);
    const store = makeSuccessStore(expectedKey);
    const result = await ensureLocalApiKey(store, tmpDir);
    expect(result).toBe(expectedKey);
  });

  it("writes the raw key to .lore/local-key file", async () => {
    const expectedKey = "lore_ak_" + "c".repeat(64);
    const store = makeSuccessStore(expectedKey);
    await ensureLocalApiKey(store, tmpDir);
    const filePath = join(tmpDir, "local-key");
    expect(existsSync(filePath)).toBe(true);
    expect(readFileSync(filePath, "utf8")).toBe(expectedKey);
  });

  it("calls store.create with name='dashboard-local' and owner='admin'", async () => {
    const store = makeSuccessStore();
    await ensureLocalApiKey(store, tmpDir);
    expect(store.create).toHaveBeenCalledWith("dashboard-local", "admin");
    expect(store.create).toHaveBeenCalledTimes(1);
  });
});

// ─── BOUNDARY (AC-A-C2) ───────────────────────────────────────────────────────

describe("ensureLocalApiKey — boundary values", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("reuses existing .lore/local-key without calling store.create (AC-A-C2)", async () => {
    const existingKey = "lore_ak_" + "e".repeat(64);
    const filePath = join(tmpDir, "local-key");

    // Write the key file before calling ensureLocalApiKey
    const { writeFileSync } = await import("node:fs");
    writeFileSync(filePath, existingKey, { mode: 0o600 });

    const store = makeSuccessStore();
    const result = await ensureLocalApiKey(store, tmpDir);
    expect(result).toBe(existingKey);
    expect(store.create).not.toHaveBeenCalled();
  });

  it("trims whitespace from existing key file content", async () => {
    const existingKey = "lore_ak_" + "f".repeat(64);
    const filePath = join(tmpDir, "local-key");
    const { writeFileSync } = await import("node:fs");
    writeFileSync(filePath, `  ${existingKey}\n`, { mode: 0o600 });

    const store = makeSuccessStore();
    const result = await ensureLocalApiKey(store, tmpDir);
    expect(result).toBe(existingKey);
  });
});

// ─── ERROR ───────────────────────────────────────────────────────────────────

describe("ensureLocalApiKey — error cases", () => {
  let tmpDir: string;
  let originalExit: typeof process.exit;

  beforeEach(() => {
    tmpDir = makeTmpDir();
    originalExit = process.exit;
    // Mock process.exit to prevent test process from terminating
    process.exit = vi.fn() as never;
  });

  afterEach(() => {
    process.exit = originalExit;
    rmSync(tmpDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("calls process.exit(1) when store.create returns err", async () => {
    const store = makeFailStore("VALIDATION_ERROR", "already exists");
    await ensureLocalApiKey(store, tmpDir);
    expect(process.exit).toHaveBeenCalledWith(1);
  });

  it("does not create local-key file when store.create fails", async () => {
    const store = makeFailStore();
    await ensureLocalApiKey(store, tmpDir);
    const filePath = join(tmpDir, "local-key");
    expect(existsSync(filePath)).toBe(false);
  });
});

// ─── STATE ───────────────────────────────────────────────────────────────────

describe("ensureLocalApiKey — state transitions", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("first call creates file; second call reads file without calling store", async () => {
    const firstKey = "lore_ak_" + "1".repeat(64);
    const store1 = makeSuccessStore(firstKey);
    await ensureLocalApiKey(store1, tmpDir);
    expect(store1.create).toHaveBeenCalledTimes(1);

    // Second call should read existing file
    const store2 = makeSuccessStore("lore_ak_" + "2".repeat(64));
    const result2 = await ensureLocalApiKey(store2, tmpDir);
    expect(store2.create).not.toHaveBeenCalled();
    expect(result2).toBe(firstKey);
  });
});

// ─── REGRESSION ──────────────────────────────────────────────────────────────

describe("ensureLocalApiKey — regression", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returned key matches file contents exactly", async () => {
    const expectedKey = "lore_ak_" + "a".repeat(64);
    const store = makeSuccessStore(expectedKey);
    const returnedKey = await ensureLocalApiKey(store, tmpDir);
    const fileContent = readFileSync(join(tmpDir, "local-key"), "utf8");
    expect(returnedKey).toBe(fileContent);
    expect(returnedKey).toBe(expectedKey);
  });
});
