// @reads assets/project/lore-config-template.yaml
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
import { liveInvocation, runHandlerForExit } from "../../live-invocation.js";
import type { Invocation } from "@lore/core";
import { patchLoreConfig } from "../../helpers/patch-lore-config.js";
import { templatedFieldsArgs } from "../../helpers/templated-create.js";

// ─── Types ─────────────────────────────────────────────────────────────────────

type RunnableCommand = {
  run: (ctx: { args: Record<string, unknown>; inv?: Invocation }) => Promise<void>;
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
  const logSpy = vi.spyOn(process.stdout, "write").mockImplementation((((chunk: unknown) => {
    const args: unknown[] = [String(chunk).replace(/\n$/, "")];
    stdout.push(args.join(" "));
  
    return true;
  }) as never));

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

/**
 * The editor-as-body create path (AC-CR-1/3/4) IS the legacy body path: with `require_create` ON a templated create takes
 * fields, never an editor body. These cases test that path itself, so each pins the switch OFF in its own throwaway corpus.
 */
function pinLegacyBodyCreate(): void {
  patchLoreConfig(tmpDir, { workflow: { structured_documents: { require_create: false } } });
}

// ─── CREATE command — AC-CR-1: editor opens when --content omitted ─────────────

describe("lore create — AC-CR-1: editor opens when --content is absent", () => {
  it.skipIf(isWindows)("uses editor content as doc body when --content is not provided", async () => {
    await initLoreDb();
    pinLegacyBodyCreate();

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
        "fields-file": templatedFieldsArgs("prd")[1],
      });
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
    pinLegacyBodyCreate();

    const failScript = join(scriptDir, "fail1.sh");
    writeFileSync(failScript, "#!/bin/sh\nexit 1\n", { mode: 0o755 });
    process.env["EDITOR"] = failScript;

    const createMod = await import("../../../src/adapters/cli/commands/create.js");
    const cmd = (createMod as { default?: { run?: RunnableCommand["run"] } }).default;
    if (!cmd) throw new Error("create command not exported");

    const output = captureOutput();
    // reason: FU#4 refactored post-app exits to process.exitCode = N; return; — read exitCode directly.
    try {
      // reason: --no-ai bypasses AI generation (SPEC-017 default) to exercise the editor error path.
      await runCmd(cmd, { type: "prd", title: "PRD With Editor Fail", ai: false });
    } finally {
      output.restore();
    }

    expect(lastExitCode).toBe(4); // VALIDATION_ERROR → exit 4
    expect(output.stderr.join("\n")).toMatch(/exited with code|editor/i);
  });

  it.skipIf(isWindows)("exits with code 4 when editor writes empty content", async () => {
    await initLoreDb();
    pinLegacyBodyCreate();

    const eraserScript = join(scriptDir, "eraser.sh");
    writeFileSync(eraserScript, "#!/bin/sh\n: > \"$1\"\n", { mode: 0o755 });
    process.env["EDITOR"] = eraserScript;

    const createMod = await import("../../../src/adapters/cli/commands/create.js");
    const cmd = (createMod as { default?: { run?: RunnableCommand["run"] } }).default;
    if (!cmd) throw new Error("create command not exported");

    const output = captureOutput();
    // reason: FU#4 refactored post-app exits to process.exitCode = N; return; — read exitCode directly.
    try {
      // reason: --no-ai bypasses AI generation (SPEC-017 default) to exercise the empty-content editor path.
      await runCmd(cmd, { type: "prd", title: "PRD Empty Content", ai: false });
    } finally {
      output.restore();
    }

    expect(lastExitCode).toBe(4);
    expect(output.stderr.join("\n")).toMatch(/content is empty/i);
  });
});

// ─── CREATE command — AC-CR-4: --json mode with editor ────────────────────────

describe("lore create — AC-CR-4: --json mode + editor flow", () => {
  it.skipIf(isWindows)("outputs JSON envelope when --json is set and editor provides content", async () => {
    await initLoreDb();
    pinLegacyBodyCreate();

    process.env["EDITOR"] = writeEditorScript(scriptDir, "writer2.sh", "json editor content");

    const createMod = await import("../../../src/adapters/cli/commands/create.js");
    const cmd = (createMod as { default?: { run?: RunnableCommand["run"] } }).default;
    if (!cmd) throw new Error("create command not exported");

    const output = captureOutput();
    const exit = captureExit();
    try {
      // reason: --no-ai bypasses AI generation (SPEC-017 default) to exercise the editor + JSON path.
      await runCmd(cmd, { type: "prd", title: "JSON Mode PRD", json: true, ai: false });
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
        "fields-file": templatedFieldsArgs("prd")[1],
      });
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
    // reason: set.ts exports a second top-level binding (APPROVED_DEMOTION_ADVISORY,
    // spec-plan-closure-must-be-loud-terminality-divergence-silent DD-3) alongside its
    // default command export. That module shape makes citty's generated
    // `CommandContext<Args>` structurally incomparable to this naive
    // `{ default?: { run?: ... } }` cast target (TS2352 "may be a mistake because
    // neither type sufficiently overlaps with the other"). Cast through `unknown`
    // first, exactly as TS's own diagnostic recommends.
    const setCmd = (setMod as unknown as { default?: { run?: RunnableCommand["run"] } }).default;
    if (!setCmd) throw new Error("set command not exported");

    const out2 = captureOutput();
    const exit2 = captureExit();
    try {
      await runCmd(setCmd, { id: slug });
    } finally {
      out2.restore();
    }

    expect(exit2.code).toBeUndefined();
    expect(out2.stdout.join("")).toContain("no changes");
    expect(out2.stderr).toHaveLength(0);
  });

  it.skipIf(isWindows)("refuses an editor-written body for a templated document and keeps its version", async () => {
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
        "fields-file": templatedFieldsArgs("prd")[1],
      });
    } finally {
      out1.restore();
    }
    const slugLine = out1.stdout.find((l) => l.includes("Slug:"));
    const slug = slugLine?.split(":")[1]?.trim();
    expect(slug).toBeTruthy();

    // Editor writes different content
    process.env["EDITOR"] = writeEditorScript(scriptDir, "changer.sh", "updated body");

    const setMod = await import("../../../src/adapters/cli/commands/set.js");
    // reason: set.ts exports a second top-level binding (APPROVED_DEMOTION_ADVISORY,
    // spec-plan-closure-must-be-loud-terminality-divergence-silent DD-3) alongside its
    // default command export. That module shape makes citty's generated
    // `CommandContext<Args>` structurally incomparable to this naive
    // `{ default?: { run?: ... } }` cast target (TS2352 "may be a mistake because
    // neither type sufficiently overlaps with the other"). Cast through `unknown`
    // first, exactly as TS's own diagnostic recommends.
    const setCmd = (setMod as unknown as { default?: { run?: RunnableCommand["run"] } }).default;
    if (!setCmd) throw new Error("set command not exported");

    const out2 = captureOutput();
    const exit2 = captureExit();
    try {
      await runCmd(setCmd, { id: slug });
    } finally {
      out2.restore();
    }

    // A templated document's content is its fields (BR-1528): an editor-written body is refused and names the fields path,
    // so the version does not move.
    expect(exit2.code).toBe(4);
    expect(out2.stdout.join("\n")).not.toContain("Updated");
    expect(out2.stderr.join("\n")).toContain("--fields-file");
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
        "fields-file": templatedFieldsArgs("prd")[1],
      });
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
    // reason: set.ts exports a second top-level binding (APPROVED_DEMOTION_ADVISORY,
    // spec-plan-closure-must-be-loud-terminality-divergence-silent DD-3) alongside its
    // default command export. That module shape makes citty's generated
    // `CommandContext<Args>` structurally incomparable to this naive
    // `{ default?: { run?: ... } }` cast target (TS2352 "may be a mistake because
    // neither type sufficiently overlaps with the other"). Cast through `unknown`
    // first, exactly as TS's own diagnostic recommends.
    const setCmd = (setMod as unknown as { default?: { run?: RunnableCommand["run"] } }).default;
    if (!setCmd) throw new Error("set command not exported");

    const out2 = captureOutput();
    const exit2 = captureExit();
    try {
      // --title flag present → editor must NOT open
      await runCmd(setCmd, { id: slug, title: "New Title" });
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
        "fields-file": templatedFieldsArgs("prd")[1],
      });
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
    // reason: set.ts exports a second top-level binding (APPROVED_DEMOTION_ADVISORY,
    // spec-plan-closure-must-be-loud-terminality-divergence-silent DD-3) alongside its
    // default command export. That module shape makes citty's generated
    // `CommandContext<Args>` structurally incomparable to this naive
    // `{ default?: { run?: ... } }` cast target (TS2352 "may be a mistake because
    // neither type sufficiently overlaps with the other"). Cast through `unknown`
    // first, exactly as TS's own diagnostic recommends.
    const setCmd = (setMod as unknown as { default?: { run?: RunnableCommand["run"] } }).default;
    if (!setCmd) throw new Error("set command not exported");

    const out2 = captureOutput();
    // reason: FU#4 refactored post-app exits to process.exitCode = N; return; — read exitCode directly.
    try {
      await runCmd(setCmd, { id: slug });
    } finally {
      out2.restore();
    }

    expect(lastExitCode).toBe(4);
    expect(out2.stderr.join("\n")).toMatch(/exited with code|editor/i);
  });
});
