// @reads assets/project/lore-config-template.yaml
/**
 * @spec_ref SPEC-003 §3.1 create command
 *
 * Tests for `lore create` CLI command — type-specific extra flags for adr, knowledge, task.
 *
 * Strategy:
 *   - For validation tests (before DB is touched), call cmd.run({ args }) directly with
 *     the run's exit code read from `runHandlerForExit` (commands return it; none calls `process.exit`).
 *   - For happy-path tests that create actual documents, set up a real .lore/lore.db
 *     using createApp + SQLiteStore in a temp dir and call cmd.run() directly.
 *     Note: SQLiteStore uses bun:sqlite which vitest treats as external (SSR). The
 *     bun:sqlite calls only happen in run(), which we protect with try/catch. In
 *     practice vitest under bun handles bun:sqlite fine for integration scenarios.
 *
 * Six-dimension coverage:
 *   HAPPY:      adr / knowledge / task each create a document with correct extra fields
 *   NEGATIVE:   missing required flag, invalid enum value, type-flag mismatch
 *   BOUNDARY:   --plan-id accepts slug (resolve → ID) and raw ULID
 *   ERROR:      --plan-id points to non-existent doc → exit with error
 *   STATE:      after create, lore get returns correct extra fields
 *   REGRESSION: prd / spec / plan create still work (no extra required); no silent fallback
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { liveInvocation, runHandlerForExit } from "../../live-invocation.js";
import type { Invocation } from "@lore/core";
import { planFieldsArgs, templatedFieldsArgs } from "../../helpers/templated-create.js";

// ─── Command type with required run handler ────────────────────────────────────

/** A CLI command shape where the run handler is guaranteed to be present. */
type RunnableCommand = {
  run: (ctx: { args: Record<string, unknown>; inv?: Invocation }) => Promise<void>;
};

// ─── Test helpers ──────────────────────────────────────────────────────────────

function captureOutput() {
  const stdout: string[] = [];
  const stderr: string[] = [];

  const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation((chunk: unknown) => {
    stderr.push(String(chunk));
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
  };
}

/**
 * Run a CLI command's run handler with the given args.
 * Asserts the run handler exists (fail-loud) before calling it.
 * This eliminates TS2722 "Cannot invoke an object which is possibly 'undefined'"
 * at every callsite — the check happens once, here.
 */
/**
 * BR-1528: a templated type is created from FIELDS. This file is about the create command's parent, kind, status and
 * gate behaviour, not the body's source, so a create that names no fields file gets the filled approved template of its
 * (type, kind) here, in the one place every create passes through.
 */
function withFields(args: Record<string, unknown>): Record<string, unknown> {
  const type = args["type"];
  if (typeof type !== "string" || args["fields-file"] !== undefined || args["content"] !== undefined) return args;
  if (type === "plan") {
    return typeof args["parent"] === "string" ? { ...args, "fields-file": planFieldsArgs(args["parent"])[1] } : { ...args, "fields-file": templatedFieldsArgs("plan")[1] };
  }
  const kind = type === "spec" ? args["kind"] ?? "feature" : type === "knowledge" ? args["sub-type"] : undefined;
  if (!["prd", "spec", "task", "adr", "knowledge"].includes(type)) return args;
  return { ...args, "fields-file": templatedFieldsArgs(type, typeof kind === "string" ? { kind } : {})[1] };
}

async function runCmd(
  cmd: { run?: RunnableCommand["run"] },
  args: Record<string, unknown>,
): Promise<void> {
  if (!cmd.run) {
    throw new Error("Command is missing run handler");
  }
  const run = cmd.run;
  const filled = withFields(args);
  lastExitCode = await runHandlerForExit(() => run({ args: filled, inv: liveInvocation() }));
}

async function importCreateCommand(): Promise<RunnableCommand> {
  // Using dynamic import so module-not-found errors are localised
  const mod = await import("../../../src/adapters/cli/commands/create.js");
  const cmd = (mod as { default?: { run?: RunnableCommand["run"] } }).default;
  if (!cmd?.run) throw new Error("create command not exported");
  return cmd as RunnableCommand;
}

/**
 * Files a requirements document and returns its slug: the parent a knowledge, adr or plan create needs
 * (spec-documents-that-need-a-parent-are-refused-without-one-an-ad D6) when the test is not about a parent.
 * Runs before the caller's own output capture starts, so it never nests two captures.
 */
async function createFixtureParentSlug(cmd: { run?: RunnableCommand["run"] }): Promise<string> {
  const output = captureOutput();
  try {
    await runCmd(cmd, { type: "prd", title: "Fixture Requirements", ai: false });
  } finally {
    output.restore();
  }
  const slug = output.stdout.join("\n").match(/prd-[\w-]+/)?.[0];
  if (lastExitCode !== 0 || slug === undefined) throw new Error(`fixture parent prd failed (exit ${lastExitCode}): ${output.stderr.join("\n")}`);
  return slug;
}

async function importGetCommand(): Promise<RunnableCommand> {
  const getMod = await import("../../../src/adapters/cli/commands/get.js");
  const getCmd = (getMod as { default?: { run?: RunnableCommand["run"] } }).default;
  if (!getCmd?.run) throw new Error("get command not exported");
  return getCmd as RunnableCommand;
}

// ─── Temp dir lifecycle ────────────────────────────────────────────────────────

let tmpDir: string;
let originalCwd: string;
let savedEditor: string | undefined;

beforeEach(() => {
  lastExitCode = 0;

  tmpDir = mkdtempSync(join(tmpdir(), "lore-cli-create-test-"));
  originalCwd = process.cwd();
  process.chdir(tmpDir);

  // reason: lore create now opens $EDITOR when --content is absent (SPEC-003 §3.1).
  // These tests focus on type-specific flags, not content — provide a minimal fake editor
  // that writes placeholder content so the tests do not block waiting for a real editor.
  const editorScript = join(tmpDir, "test-editor.sh");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { writeFileSync } = require("fs") as { writeFileSync: (p: string, d: string, opts: object) => void };
  writeFileSync(
    editorScript,
    "#!/bin/sh\nprintf 'test content placeholder' > \"$1\"\n",
    { mode: 0o755 },
  );
  savedEditor = process.env["EDITOR"];
  process.env["EDITOR"] = editorScript;
});

afterEach(() => {
  lastExitCode = 0;

  process.chdir(originalCwd);
  // Restore EDITOR env var
  if (savedEditor !== undefined) {
    process.env["EDITOR"] = savedEditor;
  } else {
    delete process.env["EDITOR"];
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { rmSync } = require("fs") as { rmSync: (p: string, opts: object) => void };
    rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    // best-effort
  }
  vi.restoreAllMocks();
});

// ─── Helper: create a real .lore/lore.db in tmpDir via lore init ──────────────

async function initLoreDb(): Promise<void> {
  // We bootstrap using the init command so that the SQLite schema is applied
  const initMod = await import("../../../src/adapters/cli/commands/init.js");
  const initCmd = (initMod as { default?: { run?: RunnableCommand["run"] } }).default;
  if (!initCmd?.run) throw new Error("init command not exported");

  const output = captureOutput();
  const exit = captureExit();
  try {
    await runCmd(initCmd, { name: "test-corpus", description: "" });
    if (lastExitCode !== 0) throw new Error(`init exited with code ${lastExitCode}`);
  } finally {
    output.restore();
  }
}

// ─── HAPPY path ───────────────────────────────────────────────────────────────

describe("lore create — happy path", () => {
  it("creates an adr with decision-status=proposed", async () => {
    await initLoreDb();

    // First create a parent prd
    const cmd = await importCreateCommand();
    const output1 = captureOutput();
    const exit1 = captureExit();
    try {
      // reason: --no-ai bypasses AI generation (SPEC-017 default) for setup steps that test other flags.
      await runCmd(cmd, { type: "prd", title: "Parent PRD", ai: false });
    } catch (e: unknown) {
      if (!(e instanceof Error) || !e.message.startsWith("process.exit(")) throw e;
    } finally {
      output1.restore();
    }
    expect(exit1.code).toBeUndefined(); // no exit = success

    // Get prd slug
    const prdSlug = output1.stdout.find((l) => l.includes("prd-"))?.match(/prd-[\w-]+/)?.[0];
    expect(prdSlug).toBeTruthy();

    const output = captureOutput();
    const exit = captureExit();
    try {
      await runCmd(cmd, {
        type: "adr",
        title: "Use X over Y",
        "decision-status": "proposed",
        parent: prdSlug,
        ai: false,
      });
    } catch (e: unknown) {
      if (!(e instanceof Error) || !e.message.startsWith("process.exit(")) throw e;
    } finally {
      output.restore();
    }

    expect(exit.code).toBeUndefined();
    expect(output.stdout.join("\n")).toContain("Created adr document");
    expect(output.stderr).toHaveLength(0);
  });

  it("creates a knowledge doc with sub-type=research", async () => {
    await initLoreDb();
    const cmd = await importCreateCommand();
    const parent = await createFixtureParentSlug(cmd);

    const output = captureOutput();
    const exit = captureExit();
    try {
      await runCmd(cmd, { type: "knowledge", title: "Research Notes", "sub-type": "research", parent, ai: false });
    } catch (e: unknown) {
      if (!(e instanceof Error) || !e.message.startsWith("process.exit(")) throw e;
    } finally {
      output.restore();
    }

    expect(exit.code).toBeUndefined();
    expect(output.stdout.join("\n")).toContain("Created knowledge document");
    expect(output.stderr).toHaveLength(0);
  });

  it("creates a task with --plan-id as slug", async () => {
    await initLoreDb();
    const cmd = await importCreateCommand();

    // Create a plan first
    const out1 = captureOutput();
    const exit1 = captureExit();
    try {
      await runCmd(cmd, { type: "prd", title: "Root PRD", ai: false });
    } catch (e: unknown) {
      if (!(e instanceof Error) || !e.message.startsWith("process.exit(")) throw e;
    } finally {
      out1.restore();
    }
    expect(exit1.code).toBeUndefined();
    const prdSlug = out1.stdout.find((l) => l.includes("prd-"))?.match(/prd-[\w-]+/)?.[0];

    const out2 = captureOutput();
    const exit2 = captureExit();
    try {
      await runCmd(cmd, { type: "plan", title: "Sprint Plan", parent: prdSlug, ai: false });
    } catch (e: unknown) {
      if (!(e instanceof Error) || !e.message.startsWith("process.exit(")) throw e;
    } finally {
      out2.restore();
    }
    expect(exit2.code).toBeUndefined();
    const planSlug = out2.stdout.find((l) => l.includes("plan-"))?.match(/plan-[\w-]+/)?.[0];
    expect(planSlug).toBeTruthy();

    // Create task with plan-id as slug
    const out3 = captureOutput();
    const exit3 = captureExit();
    try {
      await runCmd(cmd, {
        type: "task",
        title: "Do the thing",
        parent: planSlug,
        "plan-id": planSlug,
        kind: "code",
        ai: false,
      });
    } catch (e: unknown) {
      if (!(e instanceof Error) || !e.message.startsWith("process.exit(")) throw e;
    } finally {
      out3.restore();
    }

    expect(exit3.code).toBeUndefined();
    expect(out3.stdout.join("\n")).toContain("Created task document");
    expect(out3.stderr).toHaveLength(0);
  });

  it("creates a prd without any extra flags (regression)", async () => {
    await initLoreDb();
    const cmd = await importCreateCommand();

    const output = captureOutput();
    const exit = captureExit();
    try {
      await runCmd(cmd, { type: "prd", title: "My PRD", ai: false });
    } catch (e: unknown) {
      if (!(e instanceof Error) || !e.message.startsWith("process.exit(")) throw e;
    } finally {
      output.restore();
    }

    expect(exit.code).toBeUndefined();
    expect(output.stdout.join("\n")).toContain("Created prd document");
  });

  it("creates a plan without any extra flags (regression)", async () => {
    await initLoreDb();
    const cmd = await importCreateCommand();

    // Need a prd parent
    const out1 = captureOutput();
    try {
      await runCmd(cmd, { type: "prd", title: "Root", ai: false });
    } catch (e: unknown) {
      if (!(e instanceof Error) || !e.message.startsWith("process.exit(")) throw e;
    } finally {
      out1.restore();
    }
    const prdSlug = out1.stdout.find((l) => l.includes("prd-"))?.match(/prd-[\w-]+/)?.[0];

    const output = captureOutput();
    const exit = captureExit();
    try {
      await runCmd(cmd, { type: "plan", title: "My Plan", parent: prdSlug, ai: false });
    } catch (e: unknown) {
      if (!(e instanceof Error) || !e.message.startsWith("process.exit(")) throw e;
    } finally {
      output.restore();
    }

    expect(exit.code).toBeUndefined();
    expect(output.stdout.join("\n")).toContain("Created plan document");
  });
});

// ─── NEGATIVE cases ───────────────────────────────────────────────────────────

describe("lore create — negative cases", () => {
  it("exits 2 when adr is missing --decision-status", async () => {
    await initLoreDb();
    const cmd = await importCreateCommand();
    const output = captureOutput();
    const exit = captureExit();

    try {
      await runCmd(cmd, { type: "adr", title: "Some ADR" });
    } catch (e: unknown) {
      if (!(e instanceof Error) || !e.message.startsWith("process.exit(")) throw e;
    } finally {
      output.restore();
    }

    expect(exit.code).toBe(2);
    const errText = output.stderr.join("\n");
    expect(errText).toContain("--decision-status");
    expect(errText).toMatch(/proposed|accepted|deprecated|superseded/);
  });

  it("exits 2 when --decision-status value is invalid (bogus)", async () => {
    await initLoreDb();
    const cmd = await importCreateCommand();
    const output = captureOutput();
    const exit = captureExit();

    try {
      await runCmd(cmd, { type: "adr", title: "ADR", "decision-status": "bogus" });
    } catch (e: unknown) {
      if (!(e instanceof Error) || !e.message.startsWith("process.exit(")) throw e;
    } finally {
      output.restore();
    }

    expect(exit.code).toBe(2);
    const errText = output.stderr.join("\n");
    expect(errText).toContain("bogus");
    expect(errText).toMatch(/proposed|accepted|deprecated|superseded/);
  });

  it("exits 2 when knowledge is missing --sub-type", async () => {
    await initLoreDb();
    const cmd = await importCreateCommand();
    const output = captureOutput();
    const exit = captureExit();

    try {
      await runCmd(cmd, { type: "knowledge", title: "Notes" });
    } catch (e: unknown) {
      if (!(e instanceof Error) || !e.message.startsWith("process.exit(")) throw e;
    } finally {
      output.restore();
    }

    expect(exit.code).toBe(2);
    const errText = output.stderr.join("\n");
    expect(errText).toContain("--sub-type");
    expect(errText).toMatch(/ideation|retro|research|reference/);
  });

  it("exits 2 when --sub-type value is invalid", async () => {
    await initLoreDb();
    const cmd = await importCreateCommand();
    const output = captureOutput();
    const exit = captureExit();

    try {
      await runCmd(cmd, { type: "knowledge", title: "Notes", "sub-type": "invalid" });
    } catch (e: unknown) {
      if (!(e instanceof Error) || !e.message.startsWith("process.exit(")) throw e;
    } finally {
      output.restore();
    }

    expect(exit.code).toBe(2);
    const errText = output.stderr.join("\n");
    expect(errText).toContain("invalid");
    expect(errText).toMatch(/ideation|retro|research|reference/);
  });

  it("exits 2 when task is missing --plan-id", async () => {
    await initLoreDb();
    const cmd = await importCreateCommand();
    const output = captureOutput();
    const exit = captureExit();

    try {
      await runCmd(cmd, { type: "task", title: "Do X", parent: "plan-foo" });
    } catch (e: unknown) {
      if (!(e instanceof Error) || !e.message.startsWith("process.exit(")) throw e;
    } finally {
      output.restore();
    }

    expect(exit.code).toBe(2);
    const errText = output.stderr.join("\n");
    expect(errText).toContain("--plan-id");
  });

  it("exits 2 when --decision-status is passed for prd (type-flag mismatch)", async () => {
    await initLoreDb();
    const cmd = await importCreateCommand();
    const output = captureOutput();
    const exit = captureExit();

    try {
      await runCmd(cmd, { type: "prd", title: "My PRD", "decision-status": "accepted" });
    } catch (e: unknown) {
      if (!(e instanceof Error) || !e.message.startsWith("process.exit(")) throw e;
    } finally {
      output.restore();
    }

    expect(exit.code).toBe(2);
    const errText = output.stderr.join("\n");
    expect(errText).toContain("--decision-status");
    expect(errText).toContain("adr");
  });

  it("exits 2 when --sub-type is passed for plan (type-flag mismatch)", async () => {
    await initLoreDb();
    const cmd = await importCreateCommand();
    const output = captureOutput();
    const exit = captureExit();

    try {
      await runCmd(cmd, { type: "plan", title: "Plan", "sub-type": "research" });
    } catch (e: unknown) {
      if (!(e instanceof Error) || !e.message.startsWith("process.exit(")) throw e;
    } finally {
      output.restore();
    }

    expect(exit.code).toBe(2);
    const errText = output.stderr.join("\n");
    expect(errText).toContain("--sub-type");
    expect(errText).toContain("knowledge");
  });

  it("exits 2 when --plan-id is passed for adr (type-flag mismatch)", async () => {
    await initLoreDb();
    const cmd = await importCreateCommand();
    const output = captureOutput();
    const exit = captureExit();

    try {
      await runCmd(cmd, {
        type: "adr",
        title: "ADR",
        "decision-status": "proposed",
        "plan-id": "plan-foo",
      });
    } catch (e: unknown) {
      if (!(e instanceof Error) || !e.message.startsWith("process.exit(")) throw e;
    } finally {
      output.restore();
    }

    expect(exit.code).toBe(2);
    const errText = output.stderr.join("\n");
    expect(errText).toContain("--plan-id");
    expect(errText).toContain("task");
  });

  it("exits 2 when --title is missing", async () => {
    await initLoreDb();
    const cmd = await importCreateCommand();
    const output = captureOutput();
    const exit = captureExit();

    try {
      await runCmd(cmd, { type: "prd" });
    } catch (e: unknown) {
      if (!(e instanceof Error) || !e.message.startsWith("process.exit(")) throw e;
    } finally {
      output.restore();
    }

    expect(exit.code).toBe(2);
    expect(output.stderr.join("\n")).toContain("--title");
  });

  it("exits 2 when --parent is an empty string", async () => {
    await initLoreDb();
    const cmd = await importCreateCommand();
    const output = captureOutput();
    const exit = captureExit();

    try {
      await runCmd(cmd, {
        type: "adr",
        title: "x",
        "decision-status": "accepted",
        parent: "",
      });
    } catch (e: unknown) {
      if (!(e instanceof Error) || !e.message.startsWith("process.exit(")) throw e;
    } finally {
      output.restore();
    }

    expect(exit.code).toBe(2);
    expect(output.stderr.join("\n")).toMatch(/empty string|--parent/);
  });
});

// ─── BOUNDARY cases ───────────────────────────────────────────────────────────

describe("lore create — boundary cases", () => {
  it("--plan-id accepts a ULID (bypasses slug resolution)", async () => {
    await initLoreDb();
    const cmd = await importCreateCommand();

    // Create parent prd and plan
    const out1 = captureOutput();
    try {
      await runCmd(cmd, { type: "prd", title: "Root", ai: false });
    } catch (e: unknown) {
      if (!(e instanceof Error) || !e.message.startsWith("process.exit(")) throw e;
    } finally {
      out1.restore();
    }
    const prdSlug = out1.stdout.find((l) => l.includes("prd-"))?.match(/prd-[\w-]+/)?.[0];

    const out2 = captureOutput();
    try {
      await runCmd(cmd, { type: "plan", title: "Sprint", parent: prdSlug, ai: false });
    } catch (e: unknown) {
      if (!(e instanceof Error) || !e.message.startsWith("process.exit(")) throw e;
    } finally {
      out2.restore();
    }
    const planSlug = out2.stdout.find((l) => l.includes("plan-"))?.match(/plan-[\w-]+/)?.[0];
    expect(planSlug).toBeTruthy();

    // Retrieve plan ID by using `lore get`
    const getCmd = await importGetCommand();
    const out3 = captureOutput();
    try {
      await runCmd(getCmd, { id: planSlug, json: true });
    } catch (e: unknown) {
      if (!(e instanceof Error) || !e.message.startsWith("process.exit(")) throw e;
    } finally {
      out3.restore();
    }
    const planJson = JSON.parse(out3.stdout.join("")) as {
      data?: { doc?: { id?: string } };
    };
    const planId = planJson.data?.doc?.id;
    expect(planId).toBeTruthy();

    // Now create task using raw ULID for --plan-id
    const out4 = captureOutput();
    const exit4 = captureExit();
    try {
      await runCmd(cmd, {
        type: "task",
        title: "Do X",
        parent: planSlug,
        "plan-id": planId, // ULID, not slug
        kind: "code",
        ai: false,
      });
    } catch (e: unknown) {
      if (!(e instanceof Error) || !e.message.startsWith("process.exit(")) throw e;
    } finally {
      out4.restore();
    }

    expect(exit4.code).toBeUndefined();
    expect(out4.stdout.join("\n")).toContain("Created task document");
  });

  it("all valid --decision-status enum values are accepted", async () => {
    await initLoreDb();
    const cmd = await importCreateCommand();
    const parent = await createFixtureParentSlug(cmd);

    for (const status of ["proposed", "accepted", "deprecated", "superseded"]) {
      const output = captureOutput();
      const exit = captureExit();
      try {
        await runCmd(cmd, { type: "adr", title: `ADR-${status}`, "decision-status": status, parent, ai: false });
      } catch (e: unknown) {
        if (!(e instanceof Error) || !e.message.startsWith("process.exit(")) throw e;
      } finally {
        output.restore();
      }
      expect(exit.code).toBeUndefined();
      expect(output.stdout.join("\n")).toContain("Created adr document");
    }
  });

  it("all valid --sub-type enum values are accepted", async () => {
    await initLoreDb();
    const cmd = await importCreateCommand();
    const parent = await createFixtureParentSlug(cmd);

    for (const subType of ["ideation", "retro", "research", "reference"]) {
      const output = captureOutput();
      const exit = captureExit();
      try {
        await runCmd(cmd, {
          type: "knowledge",
          title: `Knowledge-${subType}`,
          "sub-type": subType,
          parent,
          ai: false,
        });
      } catch (e: unknown) {
        if (!(e instanceof Error) || !e.message.startsWith("process.exit(")) throw e;
      } finally {
        output.restore();
      }
      expect(exit.code).toBeUndefined();
      expect(output.stdout.join("\n")).toContain("Created knowledge document");
    }
  });
});

// ─── ERROR handling ───────────────────────────────────────────────────────────

describe("lore create — error handling", () => {
  it("exits non-zero when --plan-id points to a non-existent document", async () => {
    await initLoreDb();
    const cmd = await importCreateCommand();
    const output = captureOutput();
    lastExitCode = 0;

    try {
      // reason: --no-ai bypasses AI generation (SPEC-017) to reach the service layer where
      // plan-does-not-exist triggers DOC_NOT_FOUND (the intended error under test).
      await runCmd(cmd, {
        type: "task",
        title: "Task",
        parent: "plan-does-not-exist",
        "plan-id": "plan-does-not-exist",
        ai: false,
      });
    } finally {
      output.restore();
    }

    // Should exit with a non-zero code (3 = DOC_NOT_FOUND or 4 = validation)
    expect(lastExitCode).not.toBe(0);
    expect(output.stderr.join("\n")).toMatch(/not found|Error/i);
  });

  it("exits 2 for invalid doc type", async () => {
    await initLoreDb();
    const cmd = await importCreateCommand();
    const output = captureOutput();
    const exit = captureExit();

    try {
      await runCmd(cmd, { type: "bogustype", title: "X" });
    } catch (e: unknown) {
      if (!(e instanceof Error) || !e.message.startsWith("process.exit(")) throw e;
    } finally {
      output.restore();
    }

    expect(exit.code).toBe(2);
    expect(output.stderr.join("\n")).toContain("Invalid type");
  });
});

// ─── STATE verification ───────────────────────────────────────────────────────

describe("lore create — state verification", () => {
  it("after creating adr, lore get shows extra.decision_status", async () => {
    await initLoreDb();
    const cmd = await importCreateCommand();
    const parent = await createFixtureParentSlug(cmd);

    const out1 = captureOutput();
    try {
      await runCmd(cmd, {
        type: "adr",
        title: "Architecture Decision",
        "decision-status": "accepted",
        parent,
        ai: false,
      });
    } catch (e: unknown) {
      if (!(e instanceof Error) || !e.message.startsWith("process.exit(")) throw e;
    } finally {
      out1.restore();
    }

    // Extract the slug from stdout output
    const slugLine = out1.stdout.find((l) => l.includes("Slug:"));
    const slug = slugLine?.split(":")[1]?.trim();
    expect(slug).toBeTruthy();

    // Use get command with --json to read back the doc
    const getCmd = await importGetCommand();

    const out2 = captureOutput();
    try {
      await runCmd(getCmd, { id: slug, json: true });
    } catch (e: unknown) {
      if (!(e instanceof Error) || !e.message.startsWith("process.exit(")) throw e;
    } finally {
      out2.restore();
    }

    const doc = JSON.parse(out2.stdout.join("")) as {
      data?: { doc?: { extra?: { decision_status?: string } } };
    };
    expect(doc.data?.doc?.extra?.decision_status).toBe("accepted");
  });

  it("after creating knowledge, lore get shows extra.sub_type", async () => {
    await initLoreDb();
    const cmd = await importCreateCommand();
    const parent = await createFixtureParentSlug(cmd);

    const out1 = captureOutput();
    try {
      await runCmd(cmd, { type: "knowledge", title: "Team Retro", "sub-type": "retro", parent, ai: false });
    } catch (e: unknown) {
      if (!(e instanceof Error) || !e.message.startsWith("process.exit(")) throw e;
    } finally {
      out1.restore();
    }

    const slugLine = out1.stdout.find((l) => l.includes("Slug:"));
    const slug = slugLine?.split(":")[1]?.trim();
    expect(slug).toBeTruthy();

    const getCmd = await importGetCommand();

    const out2 = captureOutput();
    try {
      await runCmd(getCmd, { id: slug, json: true });
    } catch (e: unknown) {
      if (!(e instanceof Error) || !e.message.startsWith("process.exit(")) throw e;
    } finally {
      out2.restore();
    }

    const doc = JSON.parse(out2.stdout.join("")) as {
      data?: { doc?: { extra?: { sub_type?: string } } };
    };
    expect(doc.data?.doc?.extra?.sub_type).toBe("retro");
  });

  it("after creating task, lore get shows extra.plan_id matching the plan's ULID", async () => {
    await initLoreDb();
    const cmd = await importCreateCommand();

    // Setup: prd → plan → task
    const outPrd = captureOutput();
    try {
      await runCmd(cmd, { type: "prd", title: "Root PRD", ai: false });
    } catch (e: unknown) {
      if (!(e instanceof Error) || !e.message.startsWith("process.exit(")) throw e;
    } finally {
      outPrd.restore();
    }
    const prdSlug = outPrd.stdout.find((l) => l.includes("prd-"))?.match(/prd-[\w-]+/)?.[0];

    const outPlan = captureOutput();
    try {
      await runCmd(cmd, { type: "plan", title: "Sprint 1", parent: prdSlug, ai: false });
    } catch (e: unknown) {
      if (!(e instanceof Error) || !e.message.startsWith("process.exit(")) throw e;
    } finally {
      outPlan.restore();
    }
    const planSlug = outPlan.stdout.find((l) => l.includes("plan-"))?.match(/plan-[\w-]+/)?.[0];
    expect(planSlug).toBeTruthy();

    // Get plan's ULID
    const getCmd = await importGetCommand();
    const outGetPlan = captureOutput();
    try {
      await runCmd(getCmd, { id: planSlug, json: true });
    } catch (e: unknown) {
      if (!(e instanceof Error) || !e.message.startsWith("process.exit(")) throw e;
    } finally {
      outGetPlan.restore();
    }
    const planData = JSON.parse(outGetPlan.stdout.join("")) as {
      data?: { doc?: { id?: string } };
    };
    const planId = planData.data?.doc?.id;
    expect(planId).toBeTruthy();

    // Create task with plan-id as slug (should resolve to ULID)
    const outTask = captureOutput();
    const exitTask = captureExit();
    try {
      await runCmd(cmd, {
        type: "task",
        title: "Implement feature",
        parent: planSlug,
        "plan-id": planSlug, // slug input
        kind: "code",
        ai: false,
      });
    } catch (e: unknown) {
      if (!(e instanceof Error) || !e.message.startsWith("process.exit(")) throw e;
    } finally {
      outTask.restore();
    }
    expect(exitTask.code).toBeUndefined();

    const taskSlugLine = outTask.stdout.find((l) => l.includes("Slug:"));
    const taskSlug = taskSlugLine?.split(":")[1]?.trim();
    expect(taskSlug).toBeTruthy();

    // Verify extra.plan_id is the ULID (not the slug)
    const outGetTask = captureOutput();
    try {
      await runCmd(getCmd, { id: taskSlug, json: true });
    } catch (e: unknown) {
      if (!(e instanceof Error) || !e.message.startsWith("process.exit(")) throw e;
    } finally {
      outGetTask.restore();
    }
    const taskData = JSON.parse(outGetTask.stdout.join("")) as {
      data?: { doc?: { extra?: { plan_id?: string } } };
    };
    // plan_id must be the ULID (26-char uppercase), not the slug
    expect(taskData.data?.doc?.extra?.plan_id).toBe(planId);
    expect(taskData.data?.doc?.extra?.plan_id).toMatch(/^[0-9A-Z]{26}$/);
  });

  // spec_kind taxonomy (SPEC-032 §3.1) — happy-path CLI wiring only; the exhaustive
  // schema/service coverage lives in packages/lore/tests/unit/core/schemas.test.ts
  // and corpus-service.test.ts's "spec_kind" describe block.
  it("AC-SPECKIND.CLI-01: creating spec with no --kind → extra.spec_kind defaults to 'feature'", async () => {
    await initLoreDb();
    const cmd = await importCreateCommand();

    // a spec takes no parent (BR-1); see "spec refuses --parent" regression test below
    const outPrd = captureOutput();
    try {
      await runCmd(cmd, { type: "prd", title: "Root PRD For Kind", ai: false });
    } catch (e: unknown) {
      if (!(e instanceof Error) || !e.message.startsWith("process.exit(")) throw e;
    } finally {
      outPrd.restore();
    }
    const prdSlug = outPrd.stdout.find((l) => l.includes("prd-"))?.match(/prd-[\w-]+/)?.[0];
    expect(prdSlug).toBeTruthy();

    const out1 = captureOutput();
    try {
      // reason: spec-create's GateEnforcer checkpoint (retro follow-up item 8) requires
      // a `## ` skeleton heading — the in-process fake-editor script never actually runs
      // (bun test's own stdin isn't a TTY, so openEditor's non-interactive branch wins
      // and content stays ""), so this must pass --content explicitly.
      await runCmd(cmd, {
        type: "spec",
        title: "Undeclared Kind Spec",
        ai: false,
      });
    } catch (e: unknown) {
      if (!(e instanceof Error) || !e.message.startsWith("process.exit(")) throw e;
    } finally {
      out1.restore();
    }

    const slugLine = out1.stdout.find((l) => l.includes("Slug:"));
    const slug = slugLine?.split(":")[1]?.trim();
    expect(slug).toBeTruthy();

    const getCmd = await importGetCommand();
    const out2 = captureOutput();
    try {
      await runCmd(getCmd, { id: slug, json: true });
    } catch (e: unknown) {
      if (!(e instanceof Error) || !e.message.startsWith("process.exit(")) throw e;
    } finally {
      out2.restore();
    }

    const doc = JSON.parse(out2.stdout.join("")) as {
      data?: { doc?: { extra?: { spec_kind?: string } } };
    };
    expect(doc.data?.doc?.extra?.spec_kind).toBe("feature");
  });

  it("AC-SPECKIND.CLI-02: creating spec with --kind design → extra.spec_kind persists 'design'", async () => {
    await initLoreDb();
    const cmd = await importCreateCommand();

    const outPrd = captureOutput();
    try {
      await runCmd(cmd, { type: "prd", title: "Root PRD For Design Kind", ai: false });
    } catch (e: unknown) {
      if (!(e instanceof Error) || !e.message.startsWith("process.exit(")) throw e;
    } finally {
      outPrd.restore();
    }
    const prdSlug = outPrd.stdout.find((l) => l.includes("prd-"))?.match(/prd-[\w-]+/)?.[0];
    expect(prdSlug).toBeTruthy();

    const out1 = captureOutput();
    try {
      // reason: spec-create's GateEnforcer checkpoint (retro follow-up item 8) requires
      // a `## ` skeleton heading — see the identical comment on CLI-01 above.
      await runCmd(cmd, {
        type: "spec",
        title: "Design Kind Spec",
        kind: "design",
        ai: false,
      });
    } catch (e: unknown) {
      if (!(e instanceof Error) || !e.message.startsWith("process.exit(")) throw e;
    } finally {
      out1.restore();
    }

    const slugLine = out1.stdout.find((l) => l.includes("Slug:"));
    const slug = slugLine?.split(":")[1]?.trim();
    expect(slug).toBeTruthy();

    const getCmd = await importGetCommand();
    const out2 = captureOutput();
    try {
      await runCmd(getCmd, { id: slug, json: true });
    } catch (e: unknown) {
      if (!(e instanceof Error) || !e.message.startsWith("process.exit(")) throw e;
    } finally {
      out2.restore();
    }

    const doc = JSON.parse(out2.stdout.join("")) as {
      data?: { doc?: { extra?: { spec_kind?: string } } };
    };
    expect(doc.data?.doc?.extra?.spec_kind).toBe("design");
  });

  it("AC-SPECKIND.CLI-N01: --kind bogus flows through to schema validation → VALIDATION_ERROR (exit 4)", async () => {
    await initLoreDb();
    const cmd = await importCreateCommand();

    const outPrd = captureOutput();
    try {
      await runCmd(cmd, { type: "prd", title: "Root PRD For Bogus Kind", ai: false });
    } catch (e: unknown) {
      if (!(e instanceof Error) || !e.message.startsWith("process.exit(")) throw e;
    } finally {
      outPrd.restore();
    }
    const prdSlug = outPrd.stdout.find((l) => l.includes("prd-"))?.match(/prd-[\w-]+/)?.[0];
    expect(prdSlug).toBeTruthy();

    const output = captureOutput();
    // reason: this is NOT a CLI usage-error pre-check (like --decision-status) — --kind is
    // OPTIONAL, so an invalid value is deliberately passed through to createDocInputSchema's
    // superRefine and surfaces as VALIDATION_ERROR mapped to exit 4 (SPEC-032 §3.1). No --parent
    // is supplied (a spec takes no parent, BR-2) so the parent refusal (also exit 4, but the wrong
    // reason) cannot mask the assertion under test.
    try {
      await runCmd(cmd, {
        type: "spec",
        title: "Bogus Kind Spec",
        kind: "bogus",
        ai: false,
      });
    } finally {
      output.restore();
    }

    expect(lastExitCode).toBe(4);
    expect(output.stderr.join("\n")).toMatch(/spec_kind|bogus/i);
  });

  it("exits 2 when --kind is passed for prd (type-flag mismatch)", async () => {
    await initLoreDb();
    const cmd = await importCreateCommand();
    const output = captureOutput();
    const exit = captureExit();

    try {
      await runCmd(cmd, { type: "prd", title: "My PRD", kind: "feature" });
    } catch (e: unknown) {
      if (!(e instanceof Error) || !e.message.startsWith("process.exit(")) throw e;
    } finally {
      output.restore();
    }

    expect(exit.code).toBe(2);
    const errText = output.stderr.join("\n");
    expect(errText).toContain("--kind");
    expect(errText).toContain("spec");
  });
});

// ─── --requires-uat (SPEC-058 hotfix: plan-add-requires-uat-authoring-path) ────
//
// NOTE on ERROR-dimension exit code: the task doc that spawned this test file
// addition stated "exit 4" for the type-flag mismatch case. The ACTUAL,
// pre-existing TYPE_SPECIFIC_FLAGS mismatch-validation block (~line 212, which
// this hotfix reuses verbatim for --requires-uat, same as every other entry:
// --decision-status/--sub-type/--plan-id/--kind) calls `process.exit(2)`, not 4
// — verified against the sibling tests above ("exits 2 when --kind is passed
// for prd", "exits 2 when --sub-type is passed for plan", etc.). This test
// asserts the REAL, observed exit code (2) rather than the task doc's prose,
// per this repo's established evidence-over-spec-prose correction discipline
// (see CLAUDE.md's SPEC-059/060/061 eval-log rows for the same pattern).

describe("lore create — --requires-uat (SPEC-058 hotfix)", () => {
  it("HAPPY: --requires-uat sets extra.requires_uat=true on a plan", async () => {
    await initLoreDb();
    const cmd = await importCreateCommand();

    const out1 = captureOutput();
    try {
      await runCmd(cmd, { type: "prd", title: "Root", ai: false });
    } catch (e: unknown) {
      if (!(e instanceof Error) || !e.message.startsWith("process.exit(")) throw e;
    } finally {
      out1.restore();
    }
    const prdSlug = out1.stdout.find((l) => l.includes("prd-"))?.match(/prd-[\w-]+/)?.[0];

    const out2 = captureOutput();
    const exit2 = captureExit();
    try {
      await runCmd(cmd, {
        type: "plan",
        title: "UAT-Gated Plan",
        parent: prdSlug,
        "requires-uat": true,
        ai: false,
      });
    } catch (e: unknown) {
      if (!(e instanceof Error) || !e.message.startsWith("process.exit(")) throw e;
    } finally {
      out2.restore();
    }
    expect(exit2.code).toBeUndefined();
    const planSlug = out2.stdout.find((l) => l.includes("plan-"))?.match(/plan-[\w-]+/)?.[0];
    expect(planSlug).toBeTruthy();

    const getCmd = await importGetCommand();
    const out3 = captureOutput();
    try {
      await runCmd(getCmd, { id: planSlug, json: true });
    } catch (e: unknown) {
      if (!(e instanceof Error) || !e.message.startsWith("process.exit(")) throw e;
    } finally {
      out3.restore();
    }
    const planJson = JSON.parse(out3.stdout.join("")) as {
      data?: { doc?: { extra?: { requires_uat?: boolean } } };
    };
    expect(planJson.data?.doc?.extra?.requires_uat).toBe(true);
  });

  it("REGRESSION: plan created WITHOUT --requires-uat has no requires_uat key (absent, not false)", async () => {
    await initLoreDb();
    const cmd = await importCreateCommand();

    const out1 = captureOutput();
    try {
      await runCmd(cmd, { type: "prd", title: "Root", ai: false });
    } catch (e: unknown) {
      if (!(e instanceof Error) || !e.message.startsWith("process.exit(")) throw e;
    } finally {
      out1.restore();
    }
    const prdSlug = out1.stdout.find((l) => l.includes("prd-"))?.match(/prd-[\w-]+/)?.[0];

    const out2 = captureOutput();
    const exit2 = captureExit();
    try {
      await runCmd(cmd, { type: "plan", title: "Plain Plan", parent: prdSlug, ai: false });
    } catch (e: unknown) {
      if (!(e instanceof Error) || !e.message.startsWith("process.exit(")) throw e;
    } finally {
      out2.restore();
    }
    expect(exit2.code).toBeUndefined();
    const planSlug = out2.stdout.find((l) => l.includes("plan-"))?.match(/plan-[\w-]+/)?.[0];
    expect(planSlug).toBeTruthy();

    const getCmd = await importGetCommand();
    const out3 = captureOutput();
    try {
      await runCmd(getCmd, { id: planSlug, json: true });
    } catch (e: unknown) {
      if (!(e instanceof Error) || !e.message.startsWith("process.exit(")) throw e;
    } finally {
      out3.restore();
    }
    const planJson = JSON.parse(out3.stdout.join("")) as {
      data?: { doc?: { extra?: Record<string, unknown> } };
    };
    expect(planJson.data?.doc?.extra?.["requires_uat"]).toBeUndefined();
    expect("requires_uat" in (planJson.data?.doc?.extra ?? {})).toBe(false);
  });

  it("BOUNDARY: --requires-uat=false is treated as absent — no requires_uat key written", async () => {
    await initLoreDb();
    const cmd = await importCreateCommand();

    const out1 = captureOutput();
    try {
      await runCmd(cmd, { type: "prd", title: "Root", ai: false });
    } catch (e: unknown) {
      if (!(e instanceof Error) || !e.message.startsWith("process.exit(")) throw e;
    } finally {
      out1.restore();
    }
    const prdSlug = out1.stdout.find((l) => l.includes("prd-"))?.match(/prd-[\w-]+/)?.[0];

    const out2 = captureOutput();
    const exit2 = captureExit();
    try {
      await runCmd(cmd, {
        type: "plan",
        title: "Explicit False Plan",
        parent: prdSlug,
        "requires-uat": false,
        ai: false,
      });
    } catch (e: unknown) {
      if (!(e instanceof Error) || !e.message.startsWith("process.exit(")) throw e;
    } finally {
      out2.restore();
    }
    expect(exit2.code).toBeUndefined();
    const planSlug = out2.stdout.find((l) => l.includes("plan-"))?.match(/plan-[\w-]+/)?.[0];
    expect(planSlug).toBeTruthy();

    const getCmd = await importGetCommand();
    const out3 = captureOutput();
    try {
      await runCmd(getCmd, { id: planSlug, json: true });
    } catch (e: unknown) {
      if (!(e instanceof Error) || !e.message.startsWith("process.exit(")) throw e;
    } finally {
      out3.restore();
    }
    const planJson = JSON.parse(out3.stdout.join("")) as {
      data?: { doc?: { extra?: Record<string, unknown> } };
    };
    expect("requires_uat" in (planJson.data?.doc?.extra ?? {})).toBe(false);
  });

  it("ERROR: --requires-uat on a non-plan type (spec) is rejected as a type-flag mismatch (exit 2, per the REAL mismatch-validation block — see file-header note)", async () => {
    await initLoreDb();
    const cmd = await importCreateCommand();
    const output = captureOutput();
    const exit = captureExit();

    try {
      await runCmd(cmd, { type: "spec", title: "Spec", "requires-uat": true });
    } catch (e: unknown) {
      if (!(e instanceof Error) || !e.message.startsWith("process.exit(")) throw e;
    } finally {
      output.restore();
    }

    expect(exit.code).toBe(2);
    const errText = output.stderr.join("\n");
    expect(errText).toContain("--requires-uat");
    expect(errText).toContain("plan");
  });
});

// ─── Parentless knowledge is refused (BR-709; replaced the warn-only orphan advisory) ──────────

describe("lore create — parentless knowledge is refused", () => {
  it("HAPPY refusal: parentless knowledge --sub-type retro, root PRD exists → exit 4, names --parent and the PRD, nothing created", async () => {
    await initLoreDb();
    const cmd = await importCreateCommand();

    const prdOutput = captureOutput();
    const prdExit = captureExit();
    try {
      await runCmd(cmd, { type: "prd", title: "Root PRD", ai: false });
    } catch (e: unknown) {
      if (!(e instanceof Error) || !e.message.startsWith("process.exit(")) throw e;
    } finally {
      prdOutput.restore();
    }
    expect(prdExit.code).toBeUndefined();
    const prdSlug = prdOutput.stdout.find((l) => l.includes("prd-"))?.match(/prd-[\w-]+/)?.[0];
    expect(prdSlug).toBeTruthy();

    const output = captureOutput();
    const exit = captureExit();
    try {
      await runCmd(cmd, { type: "knowledge", title: "Team Retro", "sub-type": "retro", ai: false });
    } catch (e: unknown) {
      if (!(e instanceof Error) || !e.message.startsWith("process.exit(")) throw e;
    } finally {
      output.restore();
    }

    expect(exit.code).toBe(4);
    expect(output.stdout.join("\n")).not.toContain("Created knowledge document");
    const errText = output.stderr.join("\n");
    expect(errText).toContain("--parent");
    expect(errText).toContain(String(prdSlug));
  });

  it("NEGATIVE refusal: parentless knowledge, NO document that could take it → exit 4, says to create the requirements document first", async () => {
    await initLoreDb();
    const cmd = await importCreateCommand();

    const output = captureOutput();
    const exit = captureExit();
    try {
      await runCmd(cmd, { type: "knowledge", title: "Early Note", "sub-type": "retro", ai: false });
    } catch (e: unknown) {
      if (!(e instanceof Error) || !e.message.startsWith("process.exit(")) throw e;
    } finally {
      output.restore();
    }

    expect(exit.code).toBe(4);
    expect(output.stderr.join("\n")).toContain("create the requirements document first");
  });

  it("BOUNDARY: knowledge created WITH --parent succeeds, nothing on stderr", async () => {
    await initLoreDb();
    const cmd = await importCreateCommand();

    const prdOutput = captureOutput();
    const prdExit = captureExit();
    try {
      await runCmd(cmd, { type: "prd", title: "Root PRD", ai: false });
    } catch (e: unknown) {
      if (!(e instanceof Error) || !e.message.startsWith("process.exit(")) throw e;
    } finally {
      prdOutput.restore();
    }
    expect(prdExit.code).toBeUndefined();
    const prdSlug = prdOutput.stdout.find((l) => l.includes("prd-"))?.match(/prd-[\w-]+/)?.[0];
    expect(prdSlug).toBeTruthy();

    const output = captureOutput();
    const exit = captureExit();
    try {
      await runCmd(cmd, {
        type: "knowledge",
        title: "Attached Note",
        "sub-type": "retro",
        parent: prdSlug,
        ai: false,
      });
    } catch (e: unknown) {
      if (!(e instanceof Error) || !e.message.startsWith("process.exit(")) throw e;
    } finally {
      output.restore();
    }

    expect(exit.code).toBeUndefined();
    expect(output.stdout.join("\n")).toContain("Created knowledge document");
    expect(output.stderr).toHaveLength(0);
  });
});

// ─── REGRESSION guards ────────────────────────────────────────────────────────

describe("lore create — regression guards", () => {
  // Regression: a spec takes no parent (BR-2) - `--parent` on a spec is refused, exit 4, naming citations
  it("spec refuses --parent (BR-2), exit 4, nothing created", async () => {
    await initLoreDb();
    const cmd = await importCreateCommand();
    const outPrd = captureOutput();
    try {
      await runCmd(cmd, { type: "prd", title: "Root PRD For Refusal", ai: false });
    } catch (e: unknown) {
      if (!(e instanceof Error) || !e.message.startsWith("process.exit(")) throw e;
    } finally {
      outPrd.restore();
    }
    const prdSlug = outPrd.stdout.find((l) => l.includes("prd-"))?.match(/prd-[\w-]+/)?.[0];
    expect(prdSlug).toBeTruthy();

    const output = captureOutput();
    try {
      await runCmd(cmd, {
        type: "spec",
        title: "Spec With Parent",
        parent: prdSlug,
        ai: false,
      });
    } finally {
      output.restore();
    }

    expect(lastExitCode).toBe(4);
    expect(output.stderr.join("")).toContain("lore ac cite");
  });

  // N/A: no other known historical regressions beyond what spec/plan coverage above provides
});
