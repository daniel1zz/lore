/**
 * @spec_ref AC-AI-8, AC-HJ-4
 *
 * Integration test verifying that a provider command that exceeds timeout_ms produces
 * an error message containing the word "timeout" (AC-AI-8, SPEC-017 §3.4).
 *
 * Also pins SPEC-030 AC-HJ-4: the same timeout message must additionally name the exact
 * config knob to raise (`ai.providers.<name>.timeout_ms`), the actual configured timeout_ms
 * value, and the entry-REPLACES-built-in-entirely semantics (no deep merge) — read verbatim
 * from claude-cli-provider.ts before writing these assertions (see the "REGRESSION: AC-HJ-4"
 * describe block below for the exact source string this pins against).
 *
 * Strategy: spawn the real CLI process (`bun run src/index.ts create ...`) with:
 *   - A stub binary `sleep_long.sh` that sleeps 5 seconds before exiting 0
 *   - timeout_ms: 200 in the config so the watchdog fires first
 *
 * Expected outcome:
 *   - CLI exits with code 6 (AI_PROVIDER_ERROR)
 *   - stderr contains the word "timeout"
 *
 * Six-dimension coverage:
 *   ERROR:      provider exceeds timeout_ms → CLI exits 6, stderr contains "timeout" (AC-AI-8)
 *   REGRESSION: the AC-HJ-4 timeout message pins the config-knob guidance substrings
 *               (ai.providers., .timeout_ms, REPLACES, the exact configured 200ms value) —
 *               guards against a future wording rewrite silently dropping the guidance
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

/** Run the lore CLI in the given cwd with an optional extra PATH prefix. */
function runLore(args: string[], cwd: string, extraPath?: string): RunResult {
  const basePath = process.env["PATH"] ?? "";
  const fullPath = extraPath ? `${extraPath}:${basePath}` : basePath;
  const proc = Bun.spawnSync(["bun", "run", INDEX_TS, ...args], {
    cwd,
    env: {
      ...process.env,
      HOME: cwd,
      PATH: fullPath,
      EDITOR: "/usr/bin/true",
    },
  });
  return {
    stdout: proc.stdout.toString(),
    stderr: proc.stderr.toString(),
    exitCode: proc.exitCode ?? 1,
  };
}

function makeTempDir(label: string): string {
  const dir = join(tmpdir(), `lore-ai-timeout-${label}-${Date.now()}`);
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
 * Write a config.yaml pointing to the given stub binary with a specific timeout.
 * reason: timeout_ms must be small (200ms) to trigger the watchdog in tests
 * without making the test suite slow.
 */
function writeAiConfigWithTimeout(
  projectDir: string,
  command: string,
  timeoutMs: number,
): void {
  const config = [
    "project:",
    "  name: ai-timeout-test",
    "  author: tester",
    "ai:",
    "  provider: claude-cli",
    "  providers:",
    "    claude-cli:",
    `      command: ${command}`,
    "      args: []",
    `      timeout_ms: ${timeoutMs}`,
    "  templates: {}",
    "  telemetry: false",
  ].join("\n");
  const loreDir = join(projectDir, ".lore");
  mkdirSync(loreDir, { recursive: true });
  writeFileSync(join(loreDir, "config.yaml"), config + "\n", "utf8");
}

/** Write a stub shell binary that sleeps N seconds before exiting.
 *
 * reason: `exec sleep N` replaces the shell process with `sleep` so that when the
 * timeout watchdog sends SIGTERM to the child PID, the signal reaches `sleep` directly.
 * Without `exec`, the shell process receives SIGTERM but the `sleep` child may remain
 * running for the full duration, causing the test to take N seconds instead of timeout_ms.
 */
function makeSleepBinary(sleepSeconds: number): {
  binDir: string;
  binName: string;
} {
  const binName = "sleep-long-stub";
  const binDir = makeTempDir("stub-bin");
  const binPath = join(binDir, binName);
  // reason: `exec` replaces the shell with `sleep` at the same PID so SIGTERM from
  // the provider watchdog reaches `sleep` directly (signal propagation through sh is
  // not guaranteed without exec).
  const script = `#!/bin/sh\nexec sleep ${sleepSeconds}\n`;
  writeFileSync(binPath, script, { mode: 0o755 });
  return { binDir, binName };
}

// ─── Project-level state ──────────────────────────────────────────────────────

let tmpDir: string;
let stubBinDir: string | undefined;

beforeEach(() => {
  tmpDir = makeTempDir("project");
  stubBinDir = undefined;
  const initResult = runLore(["init"], tmpDir);
  if (initResult.exitCode !== 0) {
    throw new Error(`lore init failed: ${initResult.stderr}`);
  }
});

afterEach(() => {
  cleanupDir(tmpDir);
  if (stubBinDir) cleanupDir(stubBinDir);
});

// ─── AC-AI-8: timeout → exit 6 + "timeout" in stderr ────────────────────────

// reason: 15_000ms test timeout because each test spawns `bun run` subprocesses
// (bun init + bun index.ts create) which have ~1–2s startup overhead per invocation.
// The stub sleeps 5s but is killed at 200ms; total wall time is dominated by bun startup.
const TEST_TIMEOUT_MS = 15_000;

describe("AI integration — provider timeout (AC-AI-8)", () => {
  it("CLI exits 6 when provider exceeds timeout_ms", () => {
    const { binDir, binName } = makeSleepBinary(5); // sleep 5s, but timeout_ms=200
    stubBinDir = binDir;
    writeAiConfigWithTimeout(tmpDir, binName, 200);

    const result = runLore(
      ["create", "prd", "--title", "Timeout Test PRD", "--ai"],
      tmpDir,
      binDir,
    );

    expect(result.exitCode).toBe(6);
  }, TEST_TIMEOUT_MS);

  it("stderr contains the word 'timeout' when provider is killed by watchdog", () => {
    const { binDir, binName } = makeSleepBinary(5);
    stubBinDir = binDir;
    writeAiConfigWithTimeout(tmpDir, binName, 200);

    const result = runLore(
      ["create", "prd", "--title", "Timeout Message Test PRD", "--ai"],
      tmpDir,
      binDir,
    );

    // AC-AI-8: error message must contain "timeout" to distinguish from regular failures
    expect(result.stderr.toLowerCase()).toContain("timeout");
  }, TEST_TIMEOUT_MS);

  it("no doc is created when provider times out", () => {
    const { binDir, binName } = makeSleepBinary(5);
    stubBinDir = binDir;
    writeAiConfigWithTimeout(tmpDir, binName, 200);

    const beforeList = runLore(["list", "--type", "prd"], tmpDir, binDir);
    const beforeCount = beforeList.stdout
      .split("\n")
      .filter((l) => l.includes("prd-")).length;

    runLore(["create", "prd", "--title", "Should Not Appear PRD", "--ai"], tmpDir, binDir);

    const afterList = runLore(["list", "--type", "prd"], tmpDir, binDir);
    const afterCount = afterList.stdout
      .split("\n")
      .filter((l) => l.includes("prd-")).length;
    expect(afterCount).toBe(beforeCount);
  }, TEST_TIMEOUT_MS);

  it("stderr contains --no-ai retry hint when provider times out", () => {
    const { binDir, binName } = makeSleepBinary(5);
    stubBinDir = binDir;
    writeAiConfigWithTimeout(tmpDir, binName, 200);

    const result = runLore(
      ["create", "prd", "--title", "Timeout Retry Hint PRD", "--ai"],
      tmpDir,
      binDir,
    );

    expect(result.stderr).toContain("--no-ai");
  }, TEST_TIMEOUT_MS);
});

// ─── AC-HJ-4: timeout message pins the config-knob guidance ─────────────────

// reason: this describe block pins the AC-HJ-4 addition to the SAME timeout error path
// exercised above (AC-AI-8) rather than duplicating the stub/config plumbing — the
// guidance substrings are appended to the identical message, so re-running the identical
// timeout scenario and asserting on the extended substrings is the correct regression proof.
//
// Exact source string this pins against (packages/lore/src/ai/claude-cli-provider.ts,
// read verbatim at the time this test was written):
//   `provider "${this.name}" timeout: process killed after ${this.cfg.timeout_ms}ms. ` +
//   `Raise the limit via ai.providers.${this.name}.timeout_ms in .lore/config.yaml — ` +
//   `NOTE: that config entry REPLACES the built-in provider entry entirely (no merge), ` +
//   `so you must also restate command and args alongside the new timeout_ms, e.g.: ` +
//   `ai.providers.${this.name}: { command: ${this.cfg.command}, args: ${JSON.stringify(this.cfg.args)}, timeout_ms: <new value> }`
//
// The provider name configured by writeAiConfigWithTimeout() is always "claude-cli"
// (the fixed `providers: { claude-cli: ... }` key in the YAML template above), and
// timeout_ms is always the value passed to writeAiConfigWithTimeout(). Assertions below
// deliberately target substrings that carry the MEANING (config path, REPLACES semantics,
// the exact configured number) rather than the whole message verbatim, so a minor wording
// tweak elsewhere in the sentence doesn't spuriously break this pin.
describe("AI integration — provider timeout message names the config knob to raise (AC-HJ-4)", () => {
  it('stderr names the exact config path "ai.providers.claude-cli.timeout_ms"', () => {
    const { binDir, binName } = makeSleepBinary(5);
    stubBinDir = binDir;
    writeAiConfigWithTimeout(tmpDir, binName, 200);

    const result = runLore(
      ["create", "prd", "--title", "AC-HJ-4 Config Path PRD", "--ai"],
      tmpDir,
      binDir,
    );

    expect(result.stderr).toContain("ai.providers.");
    expect(result.stderr).toContain(".timeout_ms");
    expect(result.stderr).toContain("ai.providers.claude-cli.timeout_ms");
  }, TEST_TIMEOUT_MS);

  it('stderr states the entry-REPLACES-built-in-entirely semantics (literal "REPLACES")', () => {
    const { binDir, binName } = makeSleepBinary(5);
    stubBinDir = binDir;
    writeAiConfigWithTimeout(tmpDir, binName, 200);

    const result = runLore(
      ["create", "prd", "--title", "AC-HJ-4 Replaces Semantics PRD", "--ai"],
      tmpDir,
      binDir,
    );

    expect(result.stderr).toContain("REPLACES");
  }, TEST_TIMEOUT_MS);

  it("stderr instructs the reader to restate command and args alongside the new timeout_ms", () => {
    const { binDir, binName } = makeSleepBinary(5);
    stubBinDir = binDir;
    writeAiConfigWithTimeout(tmpDir, binName, 200);

    const result = runLore(
      ["create", "prd", "--title", "AC-HJ-4 Restate Command Args PRD", "--ai"],
      tmpDir,
      binDir,
    );

    expect(result.stderr).toContain("command");
    expect(result.stderr).toContain("args");
  }, TEST_TIMEOUT_MS);

  it('stderr pins the exact configured timeout_ms value (200) appearing together with "timeout"', () => {
    const { binDir, binName } = makeSleepBinary(5);
    stubBinDir = binDir;
    writeAiConfigWithTimeout(tmpDir, binName, 200);

    const result = runLore(
      ["create", "prd", "--title", "AC-HJ-4 Timeout Value PRD", "--ai"],
      tmpDir,
      binDir,
    );

    // The source format is "${timeout_ms}ms" (e.g. "200ms"), embedded right after
    // "timeout: process killed after".
    expect(result.stderr).toContain("200ms");
    expect(result.stderr.toLowerCase()).toContain("timeout");
    // Still contains the literal word "timeout" (backward compat with AC-AI-8's assertion).
    expect(result.stderr).toMatch(/timeout/);
  }, TEST_TIMEOUT_MS);

  it("a differently-configured timeout_ms value (350) is reflected verbatim in stderr, proving the number is not hardcoded", () => {
    const { binDir, binName } = makeSleepBinary(5);
    stubBinDir = binDir;
    writeAiConfigWithTimeout(tmpDir, binName, 350);

    const result = runLore(
      ["create", "prd", "--title", "AC-HJ-4 Different Timeout PRD", "--ai"],
      tmpDir,
      binDir,
    );

    expect(result.stderr).toContain("350ms");
    expect(result.stderr).not.toContain("200ms");
  }, TEST_TIMEOUT_MS);
});
