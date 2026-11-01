/**
 * @spec_ref AC-AI-1, AC-AI-2, AC-AI-3, AC-AI-5, AC-AI-6, AC-AI-7
 *
 * CLI create command AI path tests — bun:test only (uses real SQLiteStore via loadLoreApp).
 *
 * Strategy:
 *   - Create a real .lore/lore.db in a temp dir via createApp()
 *   - Write .lore/config.yaml pointing to a well-known system binary (cat/true/false)
 *     for reliable cross-platform execution without PATH manipulation
 *   - Call cmd.run() directly (same process) as one run (runHandlerForExit) with mocked stderr
 *
 * Provider commands used:
 *   /bin/cat     — reads stdin, echoes to stdout (success path: non-empty content)
 *   /usr/bin/true  — exits 0, no output (empty output path)
 *   /usr/bin/false — exits 1, no output (non-zero exit path)
 *   nonexistent-binary-xyz — binary missing (ENOENT path)
 *
 * AC-AI-5 Note (resolved — commit 78395bf):
 *   SPEC-017 §3.4 says stderr should contain "command not found: <cmd>" when binary is
 *   missing. Commit 78395bf fixed formatError() for AI_PROVIDER_ERROR to include
 *   error.message as the second output line, so the "command not found" string is now
 *   surfaced to the user. The test "(AC-AI-5) stderr should contain 'command not found'"
 *   now passes by design.
 *
 * Six-dimension coverage:
 *   HAPPY:    AI path creates draft prd (AC-AI-1)
 *   HAPPY:    --content flag skips AI (AC-AI-3)
 *   HAPPY:    --no-ai with content skips AI (AC-AI-2)
 *   NEGATIVE: missing binary → exit 6 (AC-AI-5)
 *   NEGATIVE: binary exits 1 → exit 6 (AC-AI-6)
 *   NEGATIVE: binary exits 0, empty stdout → exit 6 (AC-AI-7)
 *   STATE:    stderr contains --no-ai hint on AI failure
 *   REGRESSION: content flag bypasses AI even when ai flag is true (AC-AI-3)
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync } from "fs";
import { join, resolve } from "path";
import { tmpdir } from "os";
import { createApp } from "../../../src/app.js";
import { saveConfig } from "@lore/core/node";
import { liveInvocation, liveAmbient, liveWriteContext, runHandlerForExit } from "../../live-invocation.js";
import type { Invocation } from "@lore/core";
import { templatedFieldsArgs } from "../../helpers/templated-create.js";

// ─── Command type ─────────────────────────────────────────────────────────────

type RunnableCommand = {
  run: (ctx: { args: Record<string, unknown>; inv?: Invocation }) => Promise<void>;
};

// ─── Output / exit capture ────────────────────────────────────────────────────

function captureOutput() {
  const stdout: string[] = [];
  const stderr: string[] = [];

  const origStderrWrite = process.stderr.write.bind(process.stderr);
  const origConsoleLog = process.stdout.write;

  (process.stderr as unknown as { write: (chunk: unknown) => boolean }).write = (chunk: unknown) => {
    stderr.push(String(chunk));
    return true;
  };
  process.stdout.write = (((chunk: unknown) => {
    const args: unknown[] = [String(chunk).replace(/\n$/, "")];
    stdout.push(args.join(" "));
  
    return true;
  }) as typeof process.stdout.write);

  return {
    stdout,
    stderr,
    restore: () => {
      (process.stderr as unknown as { write: typeof origStderrWrite }).write = origStderrWrite;
      process.stdout.write = origConsoleLog;
    },
  };
}

/** The exit code the most recent run ended with (see {@link runCmd}); commands return it, they never call `process.exit`. */
let lastExitCode = 0;

/** Reads the last run's code: `undefined` when the run ended 0 (what "process.exit was never called" used to assert). */
function captureExit() {
  return {
    get code(): number | undefined {
      return lastExitCode === 0 ? undefined : lastExitCode;
    },
    restore(): void {},
  };
}

async function runCmd(
  cmd: { run?: RunnableCommand["run"] },
  args: Record<string, unknown>,
): Promise<void> {
  if (!cmd.run) throw new Error("Command is missing run handler");
  const run = cmd.run;
  lastExitCode = await runHandlerForExit(() => run({ args, inv: liveInvocation() }));
}

async function importCreateCommand(): Promise<RunnableCommand> {
  const mod = await import("../../../src/adapters/cli/commands/create.js");
  const cmd = (mod as { default?: { run?: RunnableCommand["run"] } }).default;
  if (!cmd?.run) throw new Error("create command not exported");
  return cmd as RunnableCommand;
}

// ─── Project setup ────────────────────────────────────────────────────────────

let tmpDir: string;
let originalCwd: string;
let savedEditor: string | undefined;

beforeEach(() => {
  // reason: process.exitCode set by CLI commands (FU#4 refactor) leaks between in-process
  // test invocations under bun test. Reset to 0 here to guarantee clean state each test.
  tmpDir = resolve(mkdtempSync(join(tmpdir(), "lore-cli-ai-test-")));
  const loreDir = join(tmpDir, ".lore");
  mkdirSync(loreDir, { recursive: true });

  // Create real SQLite DB
  const app = createApp(join(loreDir, "lore.db"), undefined, liveAmbient(), liveWriteContext());
  app.close();

  originalCwd = process.cwd();
  savedEditor = process.env["EDITOR"];
  process.chdir(tmpDir);

  // Provide a fake editor for --no-ai tests that don't provide --content
  const editorScript = join(tmpDir, "fake-editor.sh");
  writeFileSync(
    editorScript,
    "#!/bin/sh\nprintf 'editor content here' > \"$1\"\n",
    { mode: 0o755 },
  );
  process.env["EDITOR"] = editorScript;
});

afterEach(() => {
  // reason: explicit 0 (not undefined) to reliably clear exitCode in all Bun versions.
  process.chdir(originalCwd);
  if (savedEditor !== undefined) {
    process.env["EDITOR"] = savedEditor;
  } else {
    delete process.env["EDITOR"];
  }
  try {
    const { rmSync } = require("fs") as { rmSync: (p: string, opts: object) => void };
    rmSync(tmpDir, { recursive: true, force: true });
  } catch { /* best-effort */ }
});

/**
 * Write config.yaml pointing to the given AI command.
 * Uses `saveConfig` (writes as YAML, no Zod validation at write time).
 */
function writeAiConfig(command: string, args: string[] = [], timeout_ms = 5000) {
  saveConfig(tmpDir, {
    project: { name: "ai-test", author: "tester" },
    ai: {
      provider: "claude-cli",
      providers: {
        "claude-cli": { command, args, timeout_ms },
      },
      templates: {},
      telemetry: false,
    },
  } as never);
}

// ─── AC-AI-1: AI path creates draft doc ──────────────────────────────────────

describe("lore create prd — AI default path (AC-AI-1)", () => {
  it("creates a prd using /bin/cat as the provider (echoes prompt to stdout)", async () => {
    // /bin/cat reads stdin (the rendered prompt) and writes it to stdout.
    // This produces non-empty content → AI path succeeds.
    writeAiConfig("/bin/cat");

    const cmd = await importCreateCommand();
    const output = captureOutput();
    const exit = captureExit();
    try {
      await runCmd(cmd, { type: "prd", title: "AI Generated PRD", ai: true });
    } finally {
      output.restore();
      exit.restore();
    }

    // No error exit → success
    expect(exit.code).toBeUndefined();
    // stdout confirms doc was created
    expect(output.stdout.join("\n")).toContain("Created prd document");
    // No error messages
    expect(output.stderr.join("")).not.toContain("Error:");
  });

  it("created doc has status 'draft' (existing lifecycle rule preserved)", async () => {
    writeAiConfig("/bin/cat");

    const cmd = await importCreateCommand();
    const output = captureOutput();
    const exit = captureExit();
    try {
      await runCmd(cmd, { type: "prd", title: "Draft Status PRD", ai: true });
    } finally {
      output.restore();
      exit.restore();
    }

    expect(exit.code).toBeUndefined();
    // The status line should show "draft"
    const stdoutText = output.stdout.join("\n");
    expect(stdoutText).toContain("draft");
  });
});

// ─── AC-AI-3: --content flag skips AI entirely ───────────────────────────────

describe("lore create prd — --content flag skips AI (AC-AI-3)", () => {
  it("--content bypasses AI path; uses content verbatim", async () => {
    // Use a nonexistent command — if AI were called, this would exit 6.
    // If content is provided, AI is skipped entirely.
    writeAiConfig("nonexistent-ai-binary-xyz");

    const cmd = await importCreateCommand();
    const output = captureOutput();
    const exit = captureExit();
    try {
      await runCmd(cmd, {
        type: "prd",
        title: "Manual PRD",
        "fields-file": templatedFieldsArgs("prd")[1],
        ai: true, // ai=true but a fields file is provided → AI is bypassed
      });
    } finally {
      output.restore();
      exit.restore();
    }

    // Success despite nonexistent AI binary — content skipped AI path
    expect(exit.code).toBeUndefined();
    expect(output.stdout.join("\n")).toContain("Created prd document");
  });
});

// ─── AC-AI-2: --no-ai flag uses editor, not AI ───────────────────────────────

describe("lore create prd — --no-ai flag (AC-AI-2)", () => {
  it("--no-ai with --content skips both AI and editor", async () => {
    writeAiConfig("nonexistent-ai-binary-xyz");

    const cmd = await importCreateCommand();
    const output = captureOutput();
    const exit = captureExit();
    try {
      await runCmd(cmd, {
        type: "prd",
        title: "No-AI PRD",
        "fields-file": templatedFieldsArgs("prd")[1],
        ai: false, // --no-ai
      });
    } finally {
      output.restore();
      exit.restore();
    }

    expect(exit.code).toBeUndefined();
    expect(output.stdout.join("\n")).toContain("Created prd document");
    // No AI error messages on stderr
    expect(output.stderr.join("")).not.toContain("AI provider");
  });
});

// ─── AC-AI-5: binary missing → exit 6 ───────────────────────────────────────

describe("lore create prd — missing binary (AC-AI-5)", () => {
  it("exits code 6 when AI binary does not exist", async () => {
    writeAiConfig("nonexistent-ai-binary-xyz-not-installed");

    const cmd = await importCreateCommand();
    const output = captureOutput();
    // reason: FU#4 refactored post-app exits to process.exitCode = N; return; — read exitCode directly.
    // Cast defeats TypeScript's property narrowing after the explicit = undefined assignment above.
    try {
      await runCmd(cmd, { type: "prd", title: "Missing Binary PRD", ai: true });
    } finally {
      output.restore();
    }

    expect(lastExitCode).toBe(6);
  });

  /**
   * (AC-AI-5) Defect fixed in commit 78395bf.
   *
   * Original defect: formatError() for AI_PROVIDER_ERROR did NOT include error.message
   * in its output — only exit_code and stderr fields were shown. Since a missing binary
   * has no exit_code or stderr, the "command not found" message from ClaudeCliProvider
   * was silently dropped and never shown to the user.
   *
   * Fix: commit 78395bf added `  ${error.message}` as the second line in the
   * AI_PROVIDER_ERROR case of formatError(), so "command not found: <cmd>" is now
   * included in stderr output per SPEC-017 §3.4.
   *
   * This test now passes by design and documents the correct post-fix behavior.
   */
  it("(AC-AI-5) stderr should contain 'command not found' message per spec", async () => {
    writeAiConfig("nonexistent-ai-binary-xyz-not-installed");

    const cmd = await importCreateCommand();
    const output = captureOutput();
    const exit = captureExit();
    try {
      await runCmd(cmd, { type: "prd", title: "Missing Binary PRD", ai: true });
    } finally {
      output.restore();
      exit.restore();
    }

    const stderrText = output.stderr.join("");
    // SPEC says this should be present but implementation omits it from formatError output
    // This test FAILS by design to signal the implementation bug.
    expect(stderrText).toContain("command not found");
  });

  it("stderr contains --no-ai retry hint when binary is missing", async () => {
    writeAiConfig("nonexistent-ai-binary-xyz-not-installed");

    const cmd = await importCreateCommand();
    const output = captureOutput();
    const exit = captureExit();
    try {
      await runCmd(cmd, { type: "prd", title: "Missing Binary PRD", ai: true });
    } finally {
      output.restore();
      exit.restore();
    }

    expect(output.stderr.join("")).toContain("--no-ai");
  });
});

// ─── AC-AI-6: binary exits non-zero → exit 6 ────────────────────────────────

describe("lore create prd — binary exits non-zero (AC-AI-6)", () => {
  it("exits code 6 when AI binary exits 1 (/usr/bin/false)", async () => {
    // /usr/bin/false always exits with code 1, no stdout/stderr
    writeAiConfig("/usr/bin/false");

    const cmd = await importCreateCommand();
    const output = captureOutput();
    // reason: FU#4 refactored post-app exits to process.exitCode = N; return; — read exitCode directly.
    try {
      await runCmd(cmd, { type: "prd", title: "Failing Binary PRD", ai: true });
    } finally {
      output.restore();
    }

    expect(lastExitCode).toBe(6);
  });

  it("stderr contains --no-ai hint when binary exits non-zero", async () => {
    writeAiConfig("/usr/bin/false");

    const cmd = await importCreateCommand();
    const output = captureOutput();
    const exit = captureExit();
    try {
      await runCmd(cmd, { type: "prd", title: "Failing Binary PRD", ai: true });
    } finally {
      output.restore();
      exit.restore();
    }

    expect(output.stderr.join("")).toContain("--no-ai");
  });
});

// ─── AC-AI-7: binary exits 0, empty stdout → exit 6 ─────────────────────────

describe("lore create prd — empty output (AC-AI-7)", () => {
  it("exits code 6 when AI binary exits 0 with no output (/usr/bin/true)", async () => {
    // /usr/bin/true exits 0 with no stdout — triggers empty output check
    writeAiConfig("/usr/bin/true");

    const cmd = await importCreateCommand();
    const output = captureOutput();
    // reason: FU#4 refactored post-app exits to process.exitCode = N; return; — read exitCode directly.
    try {
      await runCmd(cmd, { type: "prd", title: "Empty Output PRD", ai: true });
    } finally {
      output.restore();
    }

    expect(lastExitCode).toBe(6);
  });

  it("stderr contains error message and --no-ai hint on empty output", async () => {
    writeAiConfig("/usr/bin/true");

    const cmd = await importCreateCommand();
    const output = captureOutput();
    const exit = captureExit();
    try {
      await runCmd(cmd, { type: "prd", title: "Empty Output PRD", ai: true });
    } finally {
      output.restore();
      exit.restore();
    }

    const stderrText = output.stderr.join("");
    expect(stderrText).toContain("Error:");
    expect(stderrText).toContain("--no-ai");
  });
});
