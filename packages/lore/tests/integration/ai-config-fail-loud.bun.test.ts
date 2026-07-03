/**
 * @spec_ref SPEC-030 AC-HJ-3
 *
 * Integration test verifying that an INVALID `ai:` block in .lore/config.yaml causes
 * the real CLI process to fail loud — exit code 4 (VALIDATION_ERROR), a clear stderr
 * message naming the offending dotted path — instead of the pre-existing bug where
 * the whole config parse failed and loadLoreApp silently fell back to
 * `rawConfig = undefined`, reverting every `ai.*` override (e.g.
 * `ai.assess.max_diff_chars` 80000 -> 24000, provider `timeout_ms` 180000 -> 60000)
 * to schema defaults with zero warning.
 *
 * Modeled on the sibling `ai-provider-unknown.bun.test.ts` (AC-AI-11): same
 * runLore()/makeTempDir()/cleanupDir() helper pattern, same real-CLI-subprocess
 * spawn strategy via `bun run src/index.ts`, `lore init` bootstrap in beforeEach.
 *
 * Important distinction from ai-provider-unknown.bun.test.ts's scenario: THAT file
 * covers a schema-VALID `ai` block referencing an unknown PROVIDER NAME (e.g.
 * `ai: { provider: "ghost" }`) — loadConfig succeeds, and the failure happens later
 * inside createApp -> buildProviderRegistry, returning STORE_ERROR (exit 1). THIS
 * file covers a SCHEMA-INVALID `ai` block (unrecognized key, wrong type, missing
 * cross-field dependency) that fails inside loadConfig itself, before createApp is
 * ever called (exit 4, VALIDATION_ERROR). One test here re-runs the unknown-provider
 * scenario to prove the two branches don't collide/misclassify each other's errors.
 *
 * Six-dimension coverage:
 *   NEGATIVE:        invalid ai block -> exit 4 (exitCode() maps VALIDATION_ERROR to 4),
 *                     stderr names "ai.cli" and "unrecognized key"
 *   ERROR:           process does not crash with an unrelated stack trace / raw ZodError dump
 *   BOUNDARY:        no `ai:` key at all still runs `list` successfully (exit 0) — AC-HJ-3's
 *                     "absence remains valid" guarantee survives the real CLI path
 *   STATE/REGRESSION: schema-VALID ai block with unknown PROVIDER NAME still exits 1
 *                     (the pre-existing STORE_ERROR path, unaffected by the new branch)
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
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

// reason: 15_000ms test timeout because each test spawns `bun run` subprocesses
// (bun init + bun index.ts <cmd>) which have ~1-2s startup overhead per invocation.
const TEST_TIMEOUT_MS = 15_000;

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
  const dir = join(tmpdir(), `lore-ai-config-fail-loud-${label}-${Date.now()}`);
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

function writeConfig(projectDir: string, yamlBody: string): void {
  const loreDir = join(projectDir, ".lore");
  mkdirSync(loreDir, { recursive: true });
  writeFileSync(join(loreDir, "config.yaml"), yamlBody.trim() + "\n", "utf8");
}

// ─── Project-level state ──────────────────────────────────────────────────────

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

// ─── NEGATIVE: invalid ai block fails loud with exit 4 ───────────────────────

describe("CLI loader — invalid ai block fails loud (SPEC-030 AC-HJ-3) — NEGATIVE", () => {
  it("exits with code 4 (VALIDATION_ERROR mapping) when ai.cli is an unrecognized key", () => {
    writeConfig(
      tmpDir,
      `
project:
  name: fail-loud-test
  author: tester
ai:
  cli: bogus
`,
    );

    const result = runLore(["list"], tmpDir);

    expect(result.exitCode).toBe(4);
  }, TEST_TIMEOUT_MS);

  it("stderr contains the offending dotted path 'ai.cli'", () => {
    writeConfig(
      tmpDir,
      `
project:
  name: fail-loud-test
  author: tester
ai:
  cli: bogus
`,
    );

    const result = runLore(["list"], tmpDir);

    expect(result.stderr).toContain("ai.cli");
  }, TEST_TIMEOUT_MS);

  it("stderr contains 'unrecognized key'", () => {
    writeConfig(
      tmpDir,
      `
project:
  name: fail-loud-test
  author: tester
ai:
  cli: bogus
`,
    );

    const result = runLore(["list"], tmpDir);

    expect(result.stderr).toContain("unrecognized key");
  }, TEST_TIMEOUT_MS);

  it("does NOT exit 0 with silently-defaulted config (the original regression)", () => {
    writeConfig(
      tmpDir,
      `
project:
  name: fail-loud-test
  author: tester
ai:
  cli: bogus
`,
    );

    const result = runLore(["list"], tmpDir);

    expect(result.exitCode).not.toBe(0);
  }, TEST_TIMEOUT_MS);
});

// ─── ERROR: clean failure, not a crash ───────────────────────────────────────

describe("CLI loader — invalid ai block fails loud (SPEC-030 AC-HJ-3) — ERROR", () => {
  it("stderr is the clean formatError message, not a raw ZodError dump or TypeError", () => {
    writeConfig(
      tmpDir,
      `
project:
  name: fail-loud-test
  author: tester
ai:
  cli: bogus
`,
    );

    const result = runLore(["list"], tmpDir);

    expect(result.stderr).not.toContain("TypeError");
    expect(result.stderr).not.toContain("ZodError");
    expect(result.stderr).not.toContain("at Module._compile");
    expect(result.stderr).not.toContain("Cannot read properties");
    // The clean formatError() prefix for VALIDATION_ERROR (utils.ts::formatError)
    expect(result.stderr).toContain("Error: Validation failed on field");
  }, TEST_TIMEOUT_MS);
});

// ─── BOUNDARY: no ai key at all still works ──────────────────────────────────

describe("CLI loader — invalid ai block fails loud (SPEC-030 AC-HJ-3) — BOUNDARY", () => {
  it("a config with ONLY the project section (no ai: key) still runs `list` successfully (exit 0)", () => {
    writeConfig(
      tmpDir,
      `
project:
  name: no-ai-key-test
  author: tester
`,
    );

    const result = runLore(["list"], tmpDir);

    expect(result.exitCode).toBe(0);
  }, TEST_TIMEOUT_MS);
});

// ─── STATE/REGRESSION: unknown provider NAME still exits 1, unaffected ───────

describe("CLI loader — invalid ai block fails loud (SPEC-030 AC-HJ-3) — STATE/REGRESSION", () => {
  it("a schema-VALID ai block referencing an unknown provider NAME (ai.provider='ghost') still exits 1 (pre-existing STORE_ERROR path) — proves the new isAiConfigValidationError branch does not intercept this", () => {
    writeConfig(
      tmpDir,
      `
project:
  name: unknown-provider-name-test
  author: tester
ai:
  provider: ghost
`,
    );

    const result = runLore(["list"], tmpDir);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("ghost");
  }, TEST_TIMEOUT_MS);
});
