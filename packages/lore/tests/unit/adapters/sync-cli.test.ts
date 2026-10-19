/**
 * @spec_ref AC-CLI-SYNC (SPEC-009 §5)
 *
 * RED test suite for `lore sync` CLI subcommand handlers.
 *
 * The implementation (src/adapters/cli/commands/sync.ts) does NOT exist yet.
 * All tests in this file MUST FAIL because the module is absent.
 *
 * Path assumption: sync command lives at
 *   src/adapters/cli/commands/sync.ts  (matches the pattern of agent.ts, serve.ts, etc.)
 * This is documented here so the implementer knows where to create it.
 *
 * SPEC-009 §5 defines 4 sync subcommands:
 *   lore sync setup  — configure remote Turso connection
 *   lore sync push   — upload local DB to Turso (first-time sync)
 *   lore sync pull   — manual sync trigger
 *   lore sync status — show sync state
 *
 * ─── Testing strategy ────────────────────────────────────────────────────────
 *
 * The citty `run()` handler is a plain async function. We test it by:
 *   1. Importing the command module's exported subcommand objects via dynamic import
 *   2. Calling `cmd.run({ args: {...} })` directly — same technique used internally
 *      by citty and consistent with the routes.test.ts pattern of calling
 *      handler functions directly.
 *
 * We mock process.stdout / process.stderr using vi.spyOn to capture output
 * without actually writing to the terminal.  Each handler call runs as ONE run
 * (`runHandlerForExit`) and the exit code it ended with is read from there:
 * commands return their code, none calls `process.exit`.
 *
 * We write YAML-based config.yaml files in temp dirs so the handler can call
 * loadConfig(dir) under test — no sqlite DB required for sync status/setup.
 *
 * ─── Six-Dimension coverage ──────────────────────────────────────────────────
 *   HAPPY:    sync status (no sync config) → prints not-configured, exits 0
 *             sync setup --url ... → writes config, exits 0
 *   NEGATIVE: sync push (no sync config) → error message + exits 1
 *             sync pull (no sync config) → error message + exits 1
 *             sync setup without --url → validation error, exits 1
 *   BOUNDARY: sync status with sync.enabled=false → indicates disabled
 *   ERROR:    N/A — DB I/O is not needed for status/setup tests (no SQLite)
 *   STATE:    sync setup idempotent second call (updates existing config)
 *   REGRESSION: sync setup url stored as remote_url (not plaintext token)
 */

import { liveInvocation, runHandlerForExit } from "../../live-invocation.js";
import { patchLoreConfig } from "../../helpers/patch-lore-config.js";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

// ─── Dynamic import helpers ───────────────────────────────────────────────────
//
// We use dynamic imports so collection-time failures (module not found)
// are isolated to this file and do not cascade to other files.

type SyncRunContext = {
  args: Record<string, string | boolean | undefined>;
};

async function importSyncCommand() {
  // When implementation lands, this module will export a default citty command
  // with subCommands: { setup, status, push, pull }
  const mod = await import("../../../src/adapters/cli/commands/sync.js");
  const cmd = (mod as any).default;

  if (!cmd) {
    throw new Error(
      "src/adapters/cli/commands/sync.ts does not export a default command — implementation missing (RED expected)",
    );
  }

  // Extract subcommands — citty stores them in subCommands property
  const subCommands = cmd.subCommands as Record<string, any> | undefined;
  if (!subCommands) {
    throw new Error("sync command has no subCommands — implementation missing (RED expected)");
  }

  const setup = subCommands["setup"];
  const status = subCommands["status"];
  const push = subCommands["push"];
  const pull = subCommands["pull"];

  if (!setup || !status || !push || !pull) {
    throw new Error(
      `sync subcommands incomplete. Found: ${Object.keys(subCommands).join(", ")} — implementation missing (RED expected)`,
    );
  }

  return { setup, status, push, pull };
}

// ─── Temp dir lifecycle ───────────────────────────────────────────────────────

let tmpDir: string;
let originalCwd: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "lore-sync-cli-test-"));
  mkdirSync(join(tmpDir, ".lore"), { recursive: true });
  originalCwd = process.cwd();
  // Change cwd so findLoreDb() can discover .lore/ in tmpDir
  process.chdir(tmpDir);
});

afterEach(() => {
  process.chdir(originalCwd);
  // Clean up tmpDir
  try {
    const { rmSync } = require("fs");
    rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    // best-effort cleanup
  }
  vi.restoreAllMocks();
});

// ─── Output capture helpers ───────────────────────────────────────────────────

function captureOutput() {
  const stdout: string[] = [];
  const stderr: string[] = [];

  const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation((chunk: any) => {
    stdout.push(String(chunk));
    return true;
  });
  const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation((chunk: any) => {
    stderr.push(String(chunk));
    return true;
  });
  // console.log also captures output
  const logSpy = vi.spyOn(process.stdout, "write").mockImplementation((((chunk: unknown) => {
    const args: any[] = [String(chunk).replace(/\n$/, "")];
    stdout.push(args.join(" "));
  
    return true;
  }) as never));

  return {
    stdout,
    stderr,
    restore: () => {
      stdoutSpy.mockRestore();
      stderrSpy.mockRestore();
      logSpy.mockRestore();
    },
    get allOutput() {
      return [...stdout, ...stderr].join("\n");
    },
  };
}

/** The exit code the most recent `*.run` ended with: `exitCli(code)` or a normal return (0); no command calls `process.exit`. */
let lastExitCode = 0;

function captureExit() {
  return { get exitCode(): number { return lastExitCode; } };
}

// ─── Setup: create a .lore/lore.db stub (SQLite not needed for config-only ops)
function createLoreDb() {
  // Many sync subcommands just need the DB file to exist for findLoreDb().
  // We create an empty file as a stub.  For status/setup that only touches
  // config.yaml, this is sufficient.
  writeFileSync(join(tmpDir, ".lore", "lore.db"), "");
}

function writeConfigYaml(content: string) {
  patchLoreConfig(tmpDir, content, { replace: true });
}

// ===========================================================================
// HAPPY PATH
// ===========================================================================

describe("lore sync status — happy path (SPEC-009 §5)", () => {
  it("prints not-configured message and exits 0 when no sync section in config", async () => {
    createLoreDb();
    writeConfigYaml("project:\n  name: local-project\n  author: tester\n");

    const { status } = await importSyncCommand();
    const output = captureOutput();
    const exitCapture = captureExit();

    try {
      lastExitCode = await runHandlerForExit(() => status.run({ args: { json: false }, inv: liveInvocation() }));
    } finally {
      output.restore();
    }

    // Must print something about "not configured" or "no sync" or similar
    const allOutput = output.allOutput.toLowerCase();
    const hasNotConfigured =
      allOutput.includes("not configured") ||
      allOutput.includes("no sync") ||
      allOutput.includes("sync not") ||
      allOutput.includes("disabled") ||
      allOutput.includes("local only") ||
      allOutput.includes("local-only");
    expect(hasNotConfigured).toBe(true);

    // Exit code must be 0 (not an error)
    expect(exitCapture.exitCode).toBe(0);
  });

  it("sync status with json flag outputs JSON with ok:true and exits 0 when not configured", async () => {
    createLoreDb();
    writeConfigYaml("project:\n  name: local-project\n  author: tester\n");

    const { status } = await importSyncCommand();
    const output = captureOutput();
    const exitCapture = captureExit();

    try {
      lastExitCode = await runHandlerForExit(() => status.run({ args: { json: true }, inv: liveInvocation() }));
    } finally {
      output.restore();
    }

    // JSON output should parse and have ok: true (not-configured is not an error state)
    const rawOut = output.stdout.join("");
    if (rawOut.trim().startsWith("{")) {
      const parsed = JSON.parse(rawOut.trim());
      expect(parsed.ok).toBe(true);
    }

    expect(exitCapture.exitCode).toBe(0);
  });
});

describe("lore sync setup — happy path (SPEC-009 §5)", () => {
  it("creates sync section in config.yaml when given --url, exits 0", async () => {
    createLoreDb();
    writeConfigYaml("project:\n  name: setup-test\n  author: tester\n");

    const { setup } = await importSyncCommand();
    const output = captureOutput();
    const exitCapture = captureExit();

    try {
      lastExitCode = await runHandlerForExit(() => setup.run({
        args: {
          url: "libsql://setup-test.turso.io",
          "token-env": undefined, // use default LORE_SYNC_TOKEN
          json: false,
        },
        inv: liveInvocation(),
      }));
    } finally {
      output.restore();
    }

    // Exit code must be 0
    expect(exitCapture.exitCode).toBe(0);

    // config.yaml must now contain the sync section
    const configPath = join(tmpDir, ".lore", "config.yaml");
    expect(existsSync(configPath)).toBe(true);
    const { readFileSync } = require("fs");
    const rawContent = readFileSync(configPath, "utf8");
    expect(rawContent).toContain("libsql://setup-test.turso.io");
    expect(rawContent).toContain("enabled");
  });

  it("sync setup writes auth_token_env (env var NAME), never a plaintext token", async () => {
    createLoreDb();
    writeConfigYaml("project:\n  name: token-test\n  author: tester\n");
    // Set an actual env var — it must NOT appear in the written file
    process.env["LORE_SYNC_TOKEN"] = "plaintext-secret-MUST-NOT-APPEAR-IN-FILE";

    const { setup } = await importSyncCommand();
    const output = captureOutput();

    try {
      lastExitCode = await runHandlerForExit(() => setup.run({
        args: {
          url: "libsql://token-test.turso.io",
          "token-env": "LORE_SYNC_TOKEN",
          json: false,
        },
        inv: liveInvocation(),
      }));
    } finally {
      output.restore();
      delete process.env["LORE_SYNC_TOKEN"];
    }

    const { readFileSync } = require("fs");
    const rawContent = readFileSync(join(tmpDir, ".lore", "config.yaml"), "utf8");
    expect(rawContent).not.toContain("plaintext-secret-MUST-NOT-APPEAR-IN-FILE");
    expect(rawContent).toContain("LORE_SYNC_TOKEN"); // NAME is ok; value is not
  });
});

// ===========================================================================
// NEGATIVE CASES
// ===========================================================================

describe("lore sync push — negative cases (SPEC-009 §5)", () => {
  it("exits with code 1 and prints error when no sync config exists", async () => {
    createLoreDb();
    writeConfigYaml("project:\n  name: no-sync\n  author: tester\n");

    const { push } = await importSyncCommand();
    const output = captureOutput();
    const exitCapture = captureExit();

    try {
      lastExitCode = await runHandlerForExit(() => push.run({ args: { json: false }, inv: liveInvocation() }));
    } finally {
      output.restore();
    }

    // Must exit with non-zero (error) code
    expect(exitCapture.exitCode).toBe(1);

    // Must print something meaningful to stderr
    const errOutput = output.stderr.join("").toLowerCase();
    const hasError =
      errOutput.includes("not configured") ||
      errOutput.includes("no sync") ||
      errOutput.includes("sync") ||
      errOutput.includes("error");
    expect(hasError).toBe(true);
  });

  it("exits with code 1 when sync section exists but env var is not set (D-004)", async () => {
    createLoreDb();
    // Config has sync section but env var is not in environment
    delete process.env["LORE_SYNC_TOKEN"];
    writeConfigYaml(
      "project:\n  name: missing-token\n  author: tester\nsync:\n  enabled: true\n  remote_url: \"libsql://missing-token.turso.io\"\n  auth_token_env: LORE_SYNC_TOKEN\n  interval: 60\n",
    );

    const { push } = await importSyncCommand();
    const output = captureOutput();
    const exitCapture = captureExit();

    try {
      lastExitCode = await runHandlerForExit(() => push.run({ args: { json: false }, inv: liveInvocation() }));
    } finally {
      output.restore();
    }

    // Must fail — no token available
    expect(exitCapture.exitCode).toBe(1);
  });
});

describe("lore sync pull — negative cases (SPEC-009 §5)", () => {
  it("exits with code 1 and prints error when no sync config exists", async () => {
    createLoreDb();
    writeConfigYaml("project:\n  name: no-sync\n  author: tester\n");

    const { pull } = await importSyncCommand();
    const output = captureOutput();
    const exitCapture = captureExit();

    try {
      lastExitCode = await runHandlerForExit(() => pull.run({ args: { json: false }, inv: liveInvocation() }));
    } finally {
      output.restore();
    }

    expect(exitCapture.exitCode).toBe(1);
    // Must produce error output
    const errOutput = output.stderr.join("").toLowerCase();
    expect(errOutput.length).toBeGreaterThan(0);
  });
});

describe("lore sync setup — negative cases (SPEC-009 §5)", () => {
  it("exits with code 1 when --url is missing", async () => {
    createLoreDb();
    writeConfigYaml("project:\n  name: no-url\n  author: tester\n");

    const { setup } = await importSyncCommand();
    const output = captureOutput();
    const exitCapture = captureExit();

    try {
      lastExitCode = await runHandlerForExit(() => setup.run({ args: { url: undefined, json: false }, inv: liveInvocation() }));
    } finally {
      output.restore();
    }

    expect(exitCapture.exitCode).toBe(1);
  });

  it("exits with code 1 when --url is not a libsql:// URL", async () => {
    createLoreDb();
    writeConfigYaml("project:\n  name: bad-url\n  author: tester\n");

    const { setup } = await importSyncCommand();
    const output = captureOutput();
    const exitCapture = captureExit();

    try {
      lastExitCode = await runHandlerForExit(() => setup.run({
        args: {
          url: "https://not-a-libsql-url.example.com",
          json: false,
        },
        inv: liveInvocation(),
      }));
    } finally {
      output.restore();
    }

    // Must reject non-libsql:// URLs (SPEC-009 §6: remote_url.startsWith("libsql://"))
    expect(exitCapture.exitCode).toBe(1);
  });
});

// ===========================================================================
// BOUNDARY VALUES
// ===========================================================================

describe("lore sync status — boundary values (SPEC-009 §5)", () => {
  it("shows disabled/not-active message when sync.enabled=false", async () => {
    createLoreDb();
    writeConfigYaml(
      "project:\n  name: disabled-sync\n  author: tester\nsync:\n  enabled: false\n  auth_token_env: LORE_SYNC_TOKEN\n  interval: 60\n",
    );

    const { status } = await importSyncCommand();
    const output = captureOutput();
    const exitCapture = captureExit();

    try {
      lastExitCode = await runHandlerForExit(() => status.run({ args: { json: false }, inv: liveInvocation() }));
    } finally {
      output.restore();
    }

    // exit 0 — disabled is not an error
    expect(exitCapture.exitCode).toBe(0);
    // output must indicate sync is not active
    const allOutput = output.allOutput.toLowerCase();
    const indicatesNotActive =
      allOutput.includes("disabled") ||
      allOutput.includes("not enabled") ||
      allOutput.includes("not configured") ||
      allOutput.includes("false");
    expect(indicatesNotActive).toBe(true);
  });
});

describe("lore sync setup — boundary values", () => {
  it("setup is idempotent — second call with same URL updates config, exits 0", async () => {
    createLoreDb();
    writeConfigYaml("project:\n  name: idempotent\n  author: tester\n");

    const { setup } = await importSyncCommand();

    // First call
    const output1 = captureOutput();
    const exit1 = captureExit();
    try {
      lastExitCode = await runHandlerForExit(() => setup.run({ args: { url: "libsql://idempotent.turso.io", json: false }, inv: liveInvocation() }));
    } finally {
      output1.restore();
    }
    expect(exit1.exitCode).toBe(0);

    // Second call (same URL — idempotent)
    const output2 = captureOutput();
    const exit2 = captureExit();
    try {
      lastExitCode = await runHandlerForExit(() => setup.run({ args: { url: "libsql://idempotent.turso.io", json: false }, inv: liveInvocation() }));
    } finally {
      output2.restore();
    }
    expect(exit2.exitCode).toBe(0);

    // Config must still have the URL after second call
    const { readFileSync } = require("fs");
    const rawContent = readFileSync(join(tmpDir, ".lore", "config.yaml"), "utf8");
    expect(rawContent).toContain("libsql://idempotent.turso.io");
  });
});

// ===========================================================================
// ERROR HANDLING
// ===========================================================================

// N/A: External DB I/O errors (TursoStore unreachable) are not testable in
// unit tests without an actual Turso instance or complex network mocking.
// Integration-level coverage is deferred to Phase 2c integration tests.
// The relevant SPEC-009 §7 AC ("Turso unreachable → STORE_ERROR, fail loud")
// requires a real TursoStore; we annotate it here as a known gap.

// ===========================================================================
// STATE
// ===========================================================================

describe("lore sync setup — state transitions", () => {
  it("setup then status shows the configured URL", async () => {
    createLoreDb();
    writeConfigYaml("project:\n  name: state-test\n  author: tester\n");
    process.env["LORE_SYNC_TOKEN"] = "test-token-for-state";

    const { setup, status } = await importSyncCommand();

    // Set up sync
    const setupOutput = captureOutput();
    const setupExit = captureExit();
    try {
      lastExitCode = await runHandlerForExit(() => setup.run({ args: { url: "libsql://state-test.turso.io", json: false }, inv: liveInvocation() }));
    } finally {
      setupOutput.restore();
    }
    expect(setupExit.exitCode).toBe(0);

    // Now check status — must show the remote URL
    const statusOutput = captureOutput();
    const statusExit = captureExit();
    try {
      lastExitCode = await runHandlerForExit(() => status.run({ args: { json: false }, inv: liveInvocation() }));
    } finally {
      statusOutput.restore();
      delete process.env["LORE_SYNC_TOKEN"];
    }

    expect(statusExit.exitCode).toBe(0);

    const allStatusOutput = statusOutput.allOutput;
    // Must show the remote URL in status output
    expect(allStatusOutput).toContain("state-test.turso.io");
  });
});

// ===========================================================================
// REGRESSION
// ===========================================================================

describe("REGRESSION — sync command module existence (SPEC-009 §5)", () => {
  it("default export from sync module is a citty command with sync subcommands", async () => {
    // This test verifies the basic module contract.
    // It will fail RED with "module not found" until implementation exists.
    const mod = await import("../../../src/adapters/cli/commands/sync.js");
    const cmd = (mod as any).default;

    expect(cmd).toBeDefined();
    expect(cmd.subCommands).toBeDefined();
    expect(cmd.subCommands).toHaveProperty("setup");
    expect(cmd.subCommands).toHaveProperty("status");
    expect(cmd.subCommands).toHaveProperty("push");
    expect(cmd.subCommands).toHaveProperty("pull");
  });
});

// [Fix 6 regression] push/pull --json unconfigured → JSON error on stdout + exit 1
// Previously push/pull ignored --json for config-load errors and wrote plain text to stderr.
// This guards the consistent json output behavior mirroring setup/status.
describe("REGRESSION Fix6 — push/pull --json flag consistency (SPEC-009 §5)", () => {
  it("push --json unconfigured: outputs JSON {ok:false,error} on stdout and exits 1", async () => {
    createLoreDb();
    writeConfigYaml("project:\n  name: no-sync\n  author: tester\n");

    const { push } = await importSyncCommand();
    const output = captureOutput();
    const exitCapture = captureExit();

    try {
      lastExitCode = await runHandlerForExit(() => push.run({ args: { json: true }, inv: liveInvocation() }));
    } finally {
      output.restore();
    }

    expect(exitCapture.exitCode).toBe(1);

    // Must output valid JSON with ok:false to stdout (not stderr)
    const rawOut = output.stdout.join("").trim();
    expect(rawOut.length).toBeGreaterThan(0);
    const parsed = JSON.parse(rawOut);
    expect(parsed.ok).toBe(false);
    expect(typeof parsed.error).toBe("string");
    expect(parsed.error.length).toBeGreaterThan(0);
  });

  it("pull --json unconfigured: outputs JSON {ok:false,error} on stdout and exits 1", async () => {
    createLoreDb();
    writeConfigYaml("project:\n  name: no-sync\n  author: tester\n");

    const { pull } = await importSyncCommand();
    const output = captureOutput();
    const exitCapture = captureExit();

    try {
      lastExitCode = await runHandlerForExit(() => pull.run({ args: { json: true }, inv: liveInvocation() }));
    } finally {
      output.restore();
    }

    expect(exitCapture.exitCode).toBe(1);

    // Must output valid JSON with ok:false to stdout
    const rawOut = output.stdout.join("").trim();
    expect(rawOut.length).toBeGreaterThan(0);
    const parsed = JSON.parse(rawOut);
    expect(parsed.ok).toBe(false);
    expect(typeof parsed.error).toBe("string");
    expect(parsed.error.length).toBeGreaterThan(0);
  });
});

describe("REGRESSION — sync push/pull error message quality (SPEC-009 §5)", () => {
  it("push without sync config produces a non-empty, human-readable error on stderr", async () => {
    createLoreDb();
    writeConfigYaml("project:\n  name: error-quality\n  author: tester\n");

    const { push } = await importSyncCommand();
    const output = captureOutput();
    const exitCapture = captureExit();

    try {
      lastExitCode = await runHandlerForExit(() => push.run({ args: { json: false }, inv: liveInvocation() }));
    } finally {
      output.restore();
    }

    // Stderr must contain a meaningful error (not just "Error")
    const errOutput = output.stderr.join("").trim();
    expect(errOutput.length).toBeGreaterThan(10);
    expect(exitCapture.exitCode).toBe(1);
  });

  it("pull without sync config produces a non-empty, human-readable error on stderr", async () => {
    createLoreDb();
    writeConfigYaml("project:\n  name: error-quality-pull\n  author: tester\n");

    const { pull } = await importSyncCommand();
    const output = captureOutput();
    const exitCapture = captureExit();

    try {
      lastExitCode = await runHandlerForExit(() => pull.run({ args: { json: false }, inv: liveInvocation() }));
    } finally {
      output.restore();
    }

    const errOutput = output.stderr.join("").trim();
    expect(errOutput.length).toBeGreaterThan(10);
    expect(exitCapture.exitCode).toBe(1);
  });
});
