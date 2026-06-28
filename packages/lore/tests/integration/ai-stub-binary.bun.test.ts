/**
 * @spec_ref AC-AI-1, AC-AI-5, AC-AI-6, AC-AI-7, AC-AI-20
 *
 * Integration tests for the AI provider path using a real stub binary on $PATH.
 *
 * Each test spawns a fresh `bun run src/index.ts create ...` subprocess with:
 *   - An isolated temp project dir (lore.db + config.yaml)
 *   - A stub binary in a separate temp bin dir
 *   - PATH for the child process prepended with that bin dir
 *   - HOME overridden to isolate global config
 *
 * This is the end-to-end smoke that verifies the full AI provider pipeline from
 * CLI argument to spawned subprocess to doc creation (or failure).
 *
 * Stub binaries:
 *   ai-provider-ok    — exits 0, prints "# AI Generated\n"
 *   ai-provider-fail  — exits 1, prints error to stderr
 *   ai-provider-empty — exits 0, prints nothing
 *
 * AC-AI-20 telemetry verification:
 *   When telemetry.enabled=true + ai.telemetry=true, `lore create` should write
 *   an `ai.generation` event to .lore/telemetry.jsonl. Tests verify this file
 *   is created and contains a parseable JSON line with the right event type.
 *
 * Six-dimension coverage:
 *   HAPPY:    stub binary exits 0 → doc created, content = binary stdout (AC-AI-1)
 *   NEGATIVE: stub binary exits 1 → CLI exits 6 (AC-AI-6)
 *   NEGATIVE: stub binary exits 0, empty stdout → CLI exits 6 (AC-AI-7)
 *   ERROR:    missing binary → CLI exits 6 (AC-AI-5)
 *   STATE:    telemetry event written on success (AC-AI-20)
 *   REGRESSION: verify lore list still works after AI create
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from "fs";
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
const STUB_CONTENT = "# AI Generated PRD\n\nThis content was produced by the stub.\n";

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
      // Suppress editor for any --no-ai fallback paths
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
  const dir = join(tmpdir(), `lore-ai-int-${label}-${Date.now()}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function cleanupDir(dir: string): void {
  try { rmSync(dir, { recursive: true, force: true }); } catch { /* best-effort */ }
}

/** Write a config.yaml pointing to the given stub binary. */
function writeAiConfig(projectDir: string, opts: {
  command: string;
  args?: string[];
  telemetry?: boolean;
  aiTelemetry?: boolean;
}) {
  const config = [
    "project:",
    "  name: ai-integration-test",
    "  author: tester",
    ...(opts.telemetry ? ["telemetry:", "  enabled: true", "  path: .lore/telemetry.jsonl"] : []),
    "ai:",
    `  provider: claude-cli`,
    "  providers:",
    "    claude-cli:",
    `      command: ${opts.command}`,
    `      args: [${(opts.args ?? []).map((a) => `"${a}"`).join(", ")}]`,
    "      timeout_ms: 5000",
    "  templates: {}",
    `  telemetry: ${opts.aiTelemetry !== false ? "true" : "false"}`,
  ].join("\n");
  const loreDir = join(projectDir, ".lore");
  mkdirSync(loreDir, { recursive: true });
  writeFileSync(join(loreDir, "config.yaml"), config + "\n", "utf8");
}

/** Write a stub binary to a new temp dir and return { binDir, binName }. */
function makeStubBinary(opts: {
  exitCode: number;
  stdout?: string;
  stderr?: string;
  binName?: string;
}): { binDir: string; binName: string } {
  const binName = opts.binName ?? "ai-provider-stub";
  const binDir = makeTempDir("stub-bin");
  const binPath = join(binDir, binName);

  const lines: string[] = ["#!/bin/sh"];
  if (opts.stdout) {
    // Use a heredoc to handle arbitrary content safely
    lines.push(`cat <<'__EOF__'`);
    lines.push(opts.stdout.endsWith("\n") ? opts.stdout.trimEnd() : opts.stdout);
    lines.push("__EOF__");
  }
  if (opts.stderr) {
    lines.push(`echo '${opts.stderr.replace(/'/g, "'\\''")}' >&2`);
  }
  lines.push(`exit ${opts.exitCode}`);

  writeFileSync(binPath, lines.join("\n") + "\n", { mode: 0o755 });
  return { binDir, binName };
}

// ─── Project-level state ──────────────────────────────────────────────────────

let tmpDir: string;
let stubBinDir: string | undefined;

beforeEach(() => {
  tmpDir = makeTempDir("project");
  stubBinDir = undefined;
  // Bootstrap corpus
  const initResult = runLore(["init"], tmpDir);
  if (initResult.exitCode !== 0) {
    throw new Error(`lore init failed: ${initResult.stderr}`);
  }
});

afterEach(() => {
  cleanupDir(tmpDir);
  if (stubBinDir) cleanupDir(stubBinDir);
});

// ─── AC-AI-1: stub exits 0 → doc created ─────────────────────────────────────

describe("AI integration — stub exits 0 → doc created (AC-AI-1)", () => {
  it("creates a prd doc when stub binary exits 0 with Markdown content", () => {
    const { binDir, binName } = makeStubBinary({ exitCode: 0, stdout: STUB_CONTENT });
    stubBinDir = binDir;
    writeAiConfig(tmpDir, { command: binName });

    const result = runLore(["create", "prd", "--title", "Stub AI PRD"], tmpDir, binDir);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Created prd document");
    expect(result.stderr).not.toContain("Error:");
  });

  it("lore list shows the created doc after AI creation", () => {
    const { binDir, binName } = makeStubBinary({ exitCode: 0, stdout: STUB_CONTENT });
    stubBinDir = binDir;
    writeAiConfig(tmpDir, { command: binName });

    runLore(["create", "prd", "--title", "List Test PRD"], tmpDir, binDir);
    const listResult = runLore(["list", "--type", "prd"], tmpDir, binDir);

    expect(listResult.exitCode).toBe(0);
    expect(listResult.stdout).toContain("List Test PRD");
  });

  it("lore get shows the doc's AI-generated content", () => {
    const { binDir, binName } = makeStubBinary({ exitCode: 0, stdout: STUB_CONTENT });
    stubBinDir = binDir;
    writeAiConfig(tmpDir, { command: binName });

    const createResult = runLore(["create", "prd", "--title", "Content Test PRD"], tmpDir, binDir);
    // Extract slug from stdout
    const slugMatch = createResult.stdout.match(/prd-[\w-]+/);
    if (!slugMatch) throw new Error("No slug in create output");

    const getResult = runLore(["get", slugMatch[0]], tmpDir, binDir);
    expect(getResult.exitCode).toBe(0);
    // The content should include the stub output
    expect(getResult.stdout).toContain("AI Generated PRD");
  });
});

// ─── AC-AI-6: stub exits 1 → CLI exits 6 ────────────────────────────────────

describe("AI integration — stub exits 1 → CLI exits 6 (AC-AI-6)", () => {
  it("CLI exits 6 when stub binary exits with code 1", () => {
    const { binDir, binName } = makeStubBinary({
      exitCode: 1,
      stderr: "authentication failed: invalid token",
    });
    stubBinDir = binDir;
    writeAiConfig(tmpDir, { command: binName });

    const result = runLore(["create", "prd", "--title", "Failing Provider PRD"], tmpDir, binDir);

    expect(result.exitCode).toBe(6);
  });

  it("stderr contains --no-ai hint when stub exits non-zero", () => {
    const { binDir, binName } = makeStubBinary({ exitCode: 1 });
    stubBinDir = binDir;
    writeAiConfig(tmpDir, { command: binName });

    const result = runLore(["create", "prd", "--title", "Failing PRD"], tmpDir, binDir);

    expect(result.stderr).toContain("--no-ai");
  });

  it("no doc is created when stub exits non-zero", () => {
    const { binDir, binName } = makeStubBinary({ exitCode: 1 });
    stubBinDir = binDir;
    writeAiConfig(tmpDir, { command: binName });

    // Get doc count before
    const beforeList = runLore(["list", "--type", "prd"], tmpDir, binDir);
    const beforeCount = beforeList.stdout.split("\n").filter((l) => l.includes("prd-")).length;

    runLore(["create", "prd", "--title", "Should Not Appear PRD"], tmpDir, binDir);

    // Get doc count after — should be unchanged
    const afterList = runLore(["list", "--type", "prd"], tmpDir, binDir);
    const afterCount = afterList.stdout.split("\n").filter((l) => l.includes("prd-")).length;
    expect(afterCount).toBe(beforeCount);
  });
});

// ─── AC-AI-7: stub exits 0, empty stdout → CLI exits 6 ──────────────────────

describe("AI integration — stub exits 0, empty stdout → CLI exits 6 (AC-AI-7)", () => {
  it("CLI exits 6 when stub exits 0 with no output", () => {
    // Stub that exits 0 but writes nothing to stdout
    const { binDir, binName } = makeStubBinary({ exitCode: 0 });
    stubBinDir = binDir;
    writeAiConfig(tmpDir, { command: binName });

    const result = runLore(["create", "prd", "--title", "Empty Output PRD"], tmpDir, binDir);

    expect(result.exitCode).toBe(6);
    expect(result.stderr).toContain("Error:");
  });
});

// ─── AC-AI-5: missing binary → CLI exits 6 ───────────────────────────────────

describe("AI integration — missing binary → CLI exits 6 (AC-AI-5)", () => {
  it("CLI exits 6 when configured binary is not on PATH", () => {
    // Config points to a binary that is not installed anywhere on PATH
    writeAiConfig(tmpDir, { command: "ghost-ai-binary-not-installed-xyz" });

    const result = runLore(["create", "prd", "--title", "No Binary PRD"], tmpDir);

    expect(result.exitCode).toBe(6);
  });

  it("stderr contains retry hint (--no-ai) when binary is missing", () => {
    writeAiConfig(tmpDir, { command: "ghost-ai-binary-not-installed-xyz" });

    const result = runLore(["create", "prd", "--title", "No Binary PRD"], tmpDir);

    expect(result.stderr).toContain("--no-ai");
  });
});

// ─── AC-AI-20: telemetry event written on success ────────────────────────────

describe("AI integration — telemetry event written (AC-AI-20)", () => {
  it("writes an ai.generation JSONL event on successful AI creation", () => {
    const { binDir, binName } = makeStubBinary({ exitCode: 0, stdout: STUB_CONTENT });
    stubBinDir = binDir;
    // Enable both root telemetry and AI telemetry
    writeAiConfig(tmpDir, { command: binName, telemetry: true, aiTelemetry: true });

    runLore(["create", "prd", "--title", "Telemetry Test PRD"], tmpDir, binDir);

    const telemetryPath = join(tmpDir, ".lore", "telemetry.jsonl");
    expect(existsSync(telemetryPath)).toBe(true);

    const lines = readFileSync(telemetryPath, "utf8").trim().split("\n");
    const aiEvents = lines
      .filter((l) => l.trim())
      .map((l) => JSON.parse(l) as { event?: string; exit_code?: number; output_chars?: number })
      .filter((e) => e.event === "ai.generation");

    expect(aiEvents.length).toBeGreaterThanOrEqual(1);
    expect(aiEvents[0]?.exit_code).toBe(0);
    expect(aiEvents[0]?.output_chars).toBeGreaterThan(0);
  });
});
