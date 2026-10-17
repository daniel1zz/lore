// @spawns packages/lore/src/index.ts
/**
 * @spec_ref AC-AI-11
 *
 * Integration test verifying that an unknown ai.provider in config.yaml causes the
 * CLI to exit 1 with a clean STORE_ERROR message — not a cryptic TypeError crash
 * from downstream code accessing app.corpusService on an unwrapped Result.
 *
 * Context: Before the loader.ts fix, `createApp` with an unknown ai.provider returned
 * a `Result<App, LoreError>` (not an `App`). The `as App` cast in loader.ts hid this,
 * so downstream command code accessing `.corpusService` crashed with a TypeError like
 * "Cannot read properties of undefined (reading 'corpusService')".
 *
 * After the fix: loader.ts duck-type-checks the createApp return value ("ok" in result),
 * detects the Result, surfaces the STORE_ERROR via formatError(), and calls process.exit(1).
 *
 * Strategy: spawn the real CLI process (`bun run src/index.ts`) with:
 *   - A temp project initialized via `lore init`
 *   - `.lore/config.yaml` containing `ai: { provider: "ghost" }`
 *   - Any subcommand (e.g. `list`) that triggers loadLoreApp()
 *
 * Expected outcome:
 *   - CLI exits with code 1
 *   - stderr contains "Unknown ai.provider 'ghost'"
 *   - stderr contains "Known: claude-cli" (listing known providers)
 *
 * Six-dimension coverage:
 *   NEGATIVE: unknown ai.provider → exit 1, clean STORE_ERROR message (AC-AI-11)
 *   ERROR:    exit 1 (not unhandled TypeError crash)
 *   BOUNDARY: provider name that exists in no registered set
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

// ─── Types ───────────────────────────────────────────────────────────────────

interface RunResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const PROJECT_ROOT = new URL("../../", import.meta.url).pathname.replace(/\/$/, "");
const INDEX_TS = join(PROJECT_ROOT, "src", "index.ts");

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Run the lore CLI in the given cwd. */
function runLore(args: string[], cwd: string): RunResult {
  const proc = Bun.spawnSync(["bun", "run", INDEX_TS, ...args], {
    cwd,
    env: {
      ...process.env,
      HOME: cwd,
    },
  });
  return {
    stdout: proc.stdout.toString(),
    stderr: proc.stderr.toString(),
    exitCode: proc.exitCode ?? 1,
  };
}

function makeTempDir(label: string): string {
  const dir = join(tmpdir(), `lore-ai-unknown-${label}-${Date.now()}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function cleanupDir(dir: string): void {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    /* best-effort */
  }
}

/**
 * Write a minimal config.yaml with an unknown ai.provider.
 * reason: only the ai.provider key is set to trigger the registry failure path;
 * everything else is left at defaults so the config is otherwise valid.
 */
function writeUnknownProviderConfig(projectDir: string, providerName: string): void {
  const config = [
    "project:",
    "  name: unknown-provider-test",
    "  author: tester",
    "ai:",
    `  provider: ${providerName}`,
  ].join("\n");
  const loreDir = join(projectDir, ".lore");
  mkdirSync(loreDir, { recursive: true });
  writeFileSync(join(loreDir, "config.yaml"), config + "\n", "utf8");
}

// ─── Project-level state ──────────────────────────────────────────────────────

// reason: 15_000ms test timeout because each test spawns `bun run` subprocesses
// (bun init + bun index.ts <cmd>) which have ~1–2s startup overhead per invocation.
const TEST_TIMEOUT_MS = 15_000;

let tmpDir: string;

beforeEach(() => {
  tmpDir = makeTempDir("project");
  const initResult = runLore(["init"], tmpDir);
  if (initResult.exitCode !== 0) {
    throw new Error(`lore init failed: ${initResult.stderr}`);
  }
}, TEST_TIMEOUT_MS);

afterEach(() => {
  cleanupDir(tmpDir);
});

// ─── AC-AI-11: unknown ai.provider → exit 1 with clean message ───────────────

describe("CLI loader — unknown ai.provider (AC-AI-11)", () => {
  it("exits with code 1 when ai.provider is unknown", () => {
    writeUnknownProviderConfig(tmpDir, "ghost");

    const result = runLore(["list"], tmpDir);

    expect(result.exitCode).toBe(1);
  }, TEST_TIMEOUT_MS);

  it("stderr contains the unknown provider name", () => {
    writeUnknownProviderConfig(tmpDir, "ghost");

    const result = runLore(["list"], tmpDir);

    expect(result.stderr).toContain("ghost");
  }, TEST_TIMEOUT_MS);

  it("stderr contains listing of known providers", () => {
    writeUnknownProviderConfig(tmpDir, "ghost");

    const result = runLore(["list"], tmpDir);

    // The STORE_ERROR message includes "Known: claude-cli" so user can diagnose
    expect(result.stderr).toContain("claude-cli");
  }, TEST_TIMEOUT_MS);

  it("does not crash with TypeError (no unhandled exception in stderr)", () => {
    writeUnknownProviderConfig(tmpDir, "ghost");

    const result = runLore(["list"], tmpDir);

    // Before the fix, accessing app.corpusService on an unwrapped Result
    // would throw: "Cannot read properties of undefined"
    expect(result.stderr).not.toContain("TypeError");
    expect(result.stderr).not.toContain("Cannot read properties");
  }, TEST_TIMEOUT_MS);

  it("exits 1 for any subcommand when ai.provider is unknown (list)", () => {
    writeUnknownProviderConfig(tmpDir, "ghost");
    const result = runLore(["list"], tmpDir);
    expect(result.exitCode).toBe(1);
  }, TEST_TIMEOUT_MS);

  it("exits 1 for any subcommand when ai.provider is unknown (status)", () => {
    writeUnknownProviderConfig(tmpDir, "ghost");
    const result = runLore(["status"], tmpDir);
    expect(result.exitCode).toBe(1);
  }, TEST_TIMEOUT_MS);

  it("unknown provider name is surfaced in error message exactly as configured", () => {
    // Use a highly distinctive name to verify the exact value is reported
    writeUnknownProviderConfig(tmpDir, "nonexistent-provider-xyz-9999");

    const result = runLore(["list"], tmpDir);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("nonexistent-provider-xyz-9999");
  }, TEST_TIMEOUT_MS);
});
