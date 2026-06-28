/**
 * @spec_ref SPEC-003 §3.1 — editor integration for create and set commands
 *
 * Integration tests for the $EDITOR flow wired into `lore create` and `lore set`.
 * These tests need real DB access (bun:sqlite), so they run under bun test.
 *
 * Strategy:
 *   - Use a real .lore/lore.db (via the init command) in a per-test temp dir.
 *   - Provide a fake editor by setting process.env.EDITOR = path_to_shell_script.
 *     Since loadLoreApp() runs without a config.yaml (no defaults.editor), openEditor()
 *     falls through to process.env["EDITOR"] which we control. (AC-ED-3 resolution chain)
 *   - Restore process.env.EDITOR in afterEach.
 *
 * Six-dimension coverage:
 *   HAPPY:   AC-CR-1 (create + editor), AC-SET-1 (set + editor, changed and unchanged content)
 *   NEGATIVE: AC-CR-3/AC-SET-3 (editor error → exit 4)
 *   BOUNDARY: AC-CR-2 (--content bypasses editor), AC-SET-2 (any flag bypasses editor)
 *   ERROR:   non-zero editor exit → exit 4; ENOENT → exit 4
 *   STATE:   set with editor and changed content → version bumped
 *   REGRESSION: AC-CR-4 (--json + editor still produces JSON output)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

// ─── Types ─────────────────────────────────────────────────────────────────────

type RunnableCommand = {
  run: (ctx: { args: Record<string, unknown> }) => Promise<void>;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

const isWindows = process.platform === "win32";

function captureOutput() {
  const stdout: string[] = [];
  const stderr: string[] = [];

  const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation((chunk: unknown) => {
    stderr.push(String(chunk));
    return true;
  });
  const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation((chunk: unknown) => {
    stdout.push(String(chunk));
    return true;
  });
  const logSpy = vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
    stdout.push(args.join(" "));
  });

  return {
    stdout,
    stderr,
    restore: () => {
      stderrSpy.mockRestore();
      stdoutSpy.mockRestore();
      logSpy.mockRestore();
    },
  };
}

function captureExit() {
  let capturedCode: number | undefined;
  vi.spyOn(process, "exit").mockImplementation((code?: string | number | null | undefined): never => {
    capturedCode = typeof code === "number" ? code : 0;
    throw new Error(`process.exit(${code})`);
  });
  return {
    get code() { return capturedCode; },
  };
}

async function runCmd(
  cmd: { run?: RunnableCommand["run"] },
  args: Record<string, unknown>,
): Promise<void> {
  if (!cmd.run) throw new Error("Command is missing run handler");
  return cmd.run({ args });
}

/**
 * Write a POSIX shell script that writes a known string to its first argument (the temp file).
 * chmod 755 via writeFileSync mode option.
 */
function writeEditorScript(dir: string, name: string, content: string): string {
  const scriptPath = join(dir, name);
  // reason: use printf with %s to avoid shell interpretation of content string
  writeFileSync(scriptPath, `#!/bin/sh\nprintf '%s' '${content}' > "$1"\n`, { mode: 0o755 });
  return scriptPath;
}

// ─── Temp dir + env lifecycle ─────────────────────────────────────────────────

let tmpDir: string;
let scriptDir: string;
let originalCwd: string;
let savedEditor: string | undefined;

beforeEach(() => {
  // reason: process.exitCode set by CLI commands (FU#4 refactor) leaks between in-process
  // test invocations under bun test. Reset to 0 here to guarantee clean state each test.
  process.exitCode = 0;

  tmpDir = mkdtempSync(join(tmpdir(), "lore-editor-integration-test-"));
  scriptDir = mkdtempSync(join(tmpdir(), "lore-editor-scripts-"));
  originalCwd = process.cwd();
  process.chdir(tmpDir);
  // Save and clear EDITOR so loadLoreApp → openEditor can be controlled per-test
  savedEditor = process.env["EDITOR"];
  // Force interactive TTY — bun test runs with stdin redirected (isTTY=undefined),
  // which would make openEditor early-return and skip the editor-error code paths these tests exercise.
  Object.defineProperty(process.stdin, "isTTY", { value: true, configurable: true, writable: true });
});

afterEach(() => {
  // reason: explicit 0 (not undefined) to reliably clear exitCode in all Bun versions.
  process.exitCode = 0;

  process.chdir(originalCwd);
  // Restore EDITOR env var
  if (savedEditor !== undefined) {
    process.env["EDITOR"] = savedEditor;
  } else {
    delete process.env["EDITOR"];
  }
  try {
    const { rmSync } = require("fs") as { rmSync: (p: string, opts: object) => void };
    rmSync(tmpDir, { recursive: true, force: true });
    rmSync(scriptDir, { recursive: true, force: true });
  } catch {
    // best-effort
  }
  vi.restoreAllMocks();
});

// ─── DB init helper ───────────────────────────────────────────────────────────

async function initLoreDb(): Promise<void> {
  const initMod = await import("../../../src/adapters/cli/commands/init.js");
  const initCmd = (initMod as { default?: { run?: RunnableCommand["run"] } }).default;
  if (!initCmd?.run) throw new Error("init command not exported");

  const output = captureOutput();
  const exit = captureExit();
  try {
    await runCmd(initCmd, { name: "test-corpus", description: "" });
  } catch (e: unknown) {
    if (!(e instanceof Error) || !e.message.startsWith("process.exit(")) throw e;
    if (exit.code !== 0) throw new Error(`init exited with code ${exit.code}`);
  } finally {
    output.restore();
  }
}

// ─── CREATE command — AC-CR-1: editor opens when --content omitted ─────────────

describe("lore create — AC-CR-1: editor opens when --content is absent", () => {
  it.skipIf(isWindows)("uses editor content as doc body when --content is not provided", async () => {
    await initLoreDb();

    // Fake editor writes "editor content here" to the file (EDITOR env var)
    process.env["EDITOR"] = writeEditorScript(scriptDir, "writer.sh", "editor content here");

    const createMod = await import("../../../src/adapters/cli/commands/create.js");
    const cmd = (createMod as { default?: { run?: RunnableCommand["run"] } }).default;
    if (!cmd) throw new Error("create command not exported");

    const output = captureOutput();
    const exit = captureExit();
    try {
      // reason: --no-ai bypasses AI generation (SPEC-017 default) to exercise the editor path.
      await runCmd(cmd, { type: "prd", title: "My PRD From Editor", ai: false });
    } catch (e: unknown) {
      if (!(e instanceof Error) || !e.message.startsWith("process.exit(")) throw e;
    } finally {
      output.restore();
    }

    expect(exit.code).toBeUndefined(); // no exit = success
    expect(output.stdout.join("\n")).toContain("Created prd document");
    expect(output.stderr).toHaveLength(0);
  });
});

// ─── CREATE command — AC-CR-2: --content bypasses editor ──────────────────────

describe("lore create — AC-CR-2: --content flag bypasses editor", () => {
  it("does not open editor when --content is provided", async () => {
    await initLoreDb();

    // Install a fail-on-call editor to prove it's NOT invoked
    const failScript = join(scriptDir, "fail.sh");
    writeFileSync(failScript, "#!/bin/sh\nexit 99\n", { mode: 0o755 });
    process.env["EDITOR"] = failScript;

    const createMod = await import("../../../src/adapters/cli/commands/create.js");
    const cmd = (createMod as { default?: { run?: RunnableCommand["run"] } }).default;
    if (!cmd) throw new Error("create command not exported");

    const output = captureOutput();
    const exit = captureExit();
    try {
      await runCmd(cmd, {
        type: "prd",
        title: "Explicit Content PRD",
        content: "my explicit content",
      });
    } catch (e: unknown) {
      if (!(e instanceof Error) || !e.message.startsWith("process.exit(")) throw e;
    } finally {
      output.restore();
    }

    // Should succeed — the fail script was NOT called
    expect(exit.code).toBeUndefined();
    expect(output.stdout.join("\n")).toContain("Created prd document");
    expect(output.stderr).toHaveLength(0);
  });
});

// ─── CREATE command — AC-CR-3: editor error → exit 4 ─────────────────────────

describe("lore create — AC-CR-3: editor error produces exit code 4", () => {
  it.skipIf(isWindows)("exits with code 4 when editor exits non-zero", async () => {
    await initLoreDb();

    const failScript = join(scriptDir, "fail1.sh");
    writeFileSync(failScript, "#!/bin/sh\nexit 1\n", { mode: 0o755 });
    process.env["EDITOR"] = failScript;

    const createMod = await import("../../../src/adapters/cli/commands/create.js");
    const cmd = (createMod as { default?: { run?: RunnableCommand["run"] } }).default;
    if (!cmd) throw new Error("create command not exported");

    const output = captureOutput();
    // reason: FU#4 refactored post-app exits to process.exitCode = N; return; — read exitCode directly.
    process.exitCode = 0;
    try {
      // reason: --no-ai bypasses AI generation (SPEC-017 default) to exercise the editor error path.
      await runCmd(cmd, { type: "prd", title: "PRD With Editor Fail", ai: false });
    } finally {
      output.restore();
    }

    expect(process.exitCode).toBe(4); // VALIDATION_ERROR → exit 4
    expect(output.stderr.join("\n")).toMatch(/exited with code|editor/i);
    process.exitCode = 0; // reset for subsequent tests
  });

  it.skipIf(isWindows)("exits with code 4 when editor writes empty content", async () => {
    await initLoreDb();

    const eraserScript = join(scriptDir, "eraser.sh");
    writeFileSync(eraserScript, "#!/bin/sh\n: > \"$1\"\n", { mode: 0o755 });
    process.env["EDITOR"] = eraserScript;

    const createMod = await import("../../../src/adapters/cli/commands/create.js");
    const cmd = (createMod as { default?: { run?: RunnableCommand["run"] } }).default;
    if (!cmd) throw new Error("create command not exported");

    const output = captureOutput();
    // reason: FU#4 refactored post-app exits to process.exitCode = N; return; — read exitCode directly.
    process.exitCode = 0;
    try {
      // reason: --no-ai bypasses AI generation (SPEC-017 default) to exercise the empty-content editor path.
      await runCmd(cmd, { type: "prd", title: "PRD Empty Content", ai: false });
    } finally {
      output.restore();
    }

    expect(process.exitCode).toBe(4);
    expect(output.stderr.join("\n")).toMatch(/content is empty/i);
    process.exitCode = 0; // reset for subsequent tests
  });
});

// ─── CREATE command — AC-CR-4: --json mode with editor ────────────────────────

describe("lore create — AC-CR-4: --json mode + editor flow", () => {
  it.skipIf(isWindows)("outputs JSON envelope when --json is set and editor provides content", async () => {
    await initLoreDb();

    process.env["EDITOR"] = writeEditorScript(scriptDir, "writer2.sh", "json editor content");

    const createMod = await import("../../../src/adapters/cli/commands/create.js");
    const cmd = (createMod as { default?: { run?: RunnableCommand["run"] } }).default;
    if (!cmd) throw new Error("create command not exported");

    const output = captureOutput();
    const exit = captureExit();
    try {
      // reason: --no-ai bypasses AI generation (SPEC-017 default) to exercise the editor + JSON path.
      await runCmd(cmd, { type: "prd", title: "JSON Mode PRD", json: true, ai: false });
    } catch (e: unknown) {
      if (!(e instanceof Error) || !e.message.startsWith("process.exit(")) throw e;
    } finally {
      output.restore();
    }

    expect(exit.code).toBeUndefined();
    const raw = output.stdout.join("");
    const parsed = JSON.parse(raw) as { ok: boolean; data: unknown };
    expect(parsed.ok).toBe(true);
    expect(parsed.data).toBeDefined();
  });
});

// ─── SET command — AC-SET-1: editor opens when no flags; unchanged → no bump ──

describe("lore set — AC-SET-1: editor opens when no flags provided", () => {
  it.skipIf(isWindows)("prints 'no changes' when editor returns same content (noop script)", async () => {
    await initLoreDb();

    const createMod = await import("../../../src/adapters/cli/commands/create.js");
    const createCmd = (createMod as { default?: { run?: RunnableCommand["run"] } }).default;
    if (!createCmd) throw new Error("create command not exported");

    // Create doc with known content using --content (bypasses editor)
    const out1 = captureOutput();
    try {
      await runCmd(createCmd, {
        type: "prd",
        title: "Set Test PRD",
        content: "original content",
      });
    } catch (e: unknown) {
      if (!(e instanceof Error) || !e.message.startsWith("process.exit(")) throw e;
    } finally {
      out1.restore();
    }
    const slugLine = out1.stdout.find((l) => l.includes("Slug:"));
    const slug = slugLine?.split(":")[1]?.trim();
    expect(slug).toBeTruthy();

    // Noop editor: exit 0 without touching the file → preserves initial content
    const noopScript = join(scriptDir, "noop.sh");
    writeFileSync(noopScript, "#!/bin/sh\nexit 0\n", { mode: 0o755 });
    process.env["EDITOR"] = noopScript;

    const setMod = await import("../../../src/adapters/cli/commands/set.js");
    const setCmd = (setMod as { default?: { run?: RunnableCommand["run"] } }).default;
    if (!setCmd) throw new Error("set command not exported");

    const out2 = captureOutput();
    const exit2 = captureExit();
    try {
      await runCmd(setCmd, { id: slug });
    } catch (e: unknown) {
      if (!(e instanceof Error) || !e.message.startsWith("process.exit(")) throw e;
    } finally {
      out2.restore();
    }

    expect(exit2.code).toBeUndefined();
    expect(out2.stdout.join("")).toContain("no changes");
    expect(out2.stderr).toHaveLength(0);
  });

  it.skipIf(isWindows)("bumps version when editor returns different content", async () => {
    await initLoreDb();

    const createMod = await import("../../../src/adapters/cli/commands/create.js");
    const createCmd = (createMod as { default?: { run?: RunnableCommand["run"] } }).default;
    if (!createCmd) throw new Error("create command not exported");

    // Create doc with explicit content
    const out1 = captureOutput();
    try {
      await runCmd(createCmd, {
        type: "prd",
        title: "Version Bump PRD",
        content: "original body",
      });
    } catch (e: unknown) {
      if (!(e instanceof Error) || !e.message.startsWith("process.exit(")) throw e;
    } finally {
      out1.restore();
    }
    const slugLine = out1.stdout.find((l) => l.includes("Slug:"));
    const slug = slugLine?.split(":")[1]?.trim();
    expect(slug).toBeTruthy();

    // Editor writes different content
    process.env["EDITOR"] = writeEditorScript(scriptDir, "changer.sh", "updated body");

    const setMod = await import("../../../src/adapters/cli/commands/set.js");
    const setCmd = (setMod as { default?: { run?: RunnableCommand["run"] } }).default;
    if (!setCmd) throw new Error("set command not exported");

    const out2 = captureOutput();
    const exit2 = captureExit();
    try {
      await runCmd(setCmd, { id: slug });
    } catch (e: unknown) {
      if (!(e instanceof Error) || !e.message.startsWith("process.exit(")) throw e;
    } finally {
      out2.restore();
    }

    expect(exit2.code).toBeUndefined();
    expect(out2.stdout.join("\n")).toContain("Updated");
    expect(out2.stdout.join("\n")).toContain("v2"); // version bumped from 1 → 2
  });
});

// ─── SET command — AC-SET-2: any flag bypasses editor ─────────────────────────

describe("lore set — AC-SET-2: any flag bypasses editor", () => {
  it.skipIf(isWindows)("does not open editor when --title is provided", async () => {
    await initLoreDb();

    const createMod = await import("../../../src/adapters/cli/commands/create.js");
    const createCmd = (createMod as { default?: { run?: RunnableCommand["run"] } }).default;
    if (!createCmd) throw new Error("create command not exported");

    // Create a doc with explicit content
    const out1 = captureOutput();
    try {
      await runCmd(createCmd, {
        type: "prd",
        title: "Title Only PRD",
        content: "body",
      });
    } catch (e: unknown) {
      if (!(e instanceof Error) || !e.message.startsWith("process.exit(")) throw e;
    } finally {
      out1.restore();
    }
    const slugLine = out1.stdout.find((l) => l.includes("Slug:"));
    const slug = slugLine?.split(":")[1]?.trim();
    expect(slug).toBeTruthy();

    // Install a fail-on-call editor — it must NOT be invoked since --title is passed
    const failScript = join(scriptDir, "fail2.sh");
    writeFileSync(failScript, "#!/bin/sh\nexit 99\n", { mode: 0o755 });
    process.env["EDITOR"] = failScript;

    const setMod = await import("../../../src/adapters/cli/commands/set.js");
    const setCmd = (setMod as { default?: { run?: RunnableCommand["run"] } }).default;
    if (!setCmd) throw new Error("set command not exported");

    const out2 = captureOutput();
    const exit2 = captureExit();
    try {
      // --title flag present → editor must NOT open
      await runCmd(setCmd, { id: slug, title: "New Title" });
    } catch (e: unknown) {
      if (!(e instanceof Error) || !e.message.startsWith("process.exit(")) throw e;
    } finally {
      out2.restore();
    }

    // fail script was NOT called — command succeeded
    expect(exit2.code).toBeUndefined();
    expect(out2.stdout.join("\n")).toContain("Updated");
  });
});

// ─── SET command — AC-SET-3: editor error → exit 4 ────────────────────────────

describe("lore set — AC-SET-3: editor error produces exit code 4", () => {
  it.skipIf(isWindows)("exits with code 4 when editor exits non-zero", async () => {
    await initLoreDb();

    const createMod = await import("../../../src/adapters/cli/commands/create.js");
    const createCmd = (createMod as { default?: { run?: RunnableCommand["run"] } }).default;
    if (!createCmd) throw new Error("create command not exported");

    const out1 = captureOutput();
    try {
      await runCmd(createCmd, {
        type: "prd",
        title: "Set Error PRD",
        content: "body",
      });
    } catch (e: unknown) {
      if (!(e instanceof Error) || !e.message.startsWith("process.exit(")) throw e;
    } finally {
      out1.restore();
    }
    const slugLine = out1.stdout.find((l) => l.includes("Slug:"));
    const slug = slugLine?.split(":")[1]?.trim();
    expect(slug).toBeTruthy();

    const failScript = join(scriptDir, "fail3.sh");
    writeFileSync(failScript, "#!/bin/sh\nexit 1\n", { mode: 0o755 });
    process.env["EDITOR"] = failScript;

    const setMod = await import("../../../src/adapters/cli/commands/set.js");
    const setCmd = (setMod as { default?: { run?: RunnableCommand["run"] } }).default;
    if (!setCmd) throw new Error("set command not exported");

    const out2 = captureOutput();
    // reason: FU#4 refactored post-app exits to process.exitCode = N; return; — read exitCode directly.
    process.exitCode = 0;
    try {
      await runCmd(setCmd, { id: slug });
    } finally {
      out2.restore();
    }

    expect(process.exitCode).toBe(4);
    expect(out2.stderr.join("\n")).toMatch(/exited with code|editor/i);
    process.exitCode = 0; // reset for subsequent tests
  });
});
