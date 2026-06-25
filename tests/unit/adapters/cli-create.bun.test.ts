/**
 * @spec_ref SPEC-003 §3.1 create command
 *
 * Tests for `lore create` CLI command — type-specific extra flags for adr, knowledge, task.
 *
 * Strategy:
 *   - For validation tests (before DB is touched), call cmd.run({ args }) directly with
 *     process.exit mocked to throw (preventing test runner from dying).
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

// ─── Command type with required run handler ────────────────────────────────────

/** A CLI command shape where the run handler is guaranteed to be present. */
type RunnableCommand = {
  run: (ctx: { args: Record<string, unknown> }) => Promise<void>;
};

// ─── Test helpers ──────────────────────────────────────────────────────────────

function captureOutput() {
  const stdout: string[] = [];
  const stderr: string[] = [];

  const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation((chunk: unknown) => {
    stderr.push(String(chunk));
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
      logSpy.mockRestore();
    },
  };
}

function captureExit() {
  let capturedCode: number | undefined;
  const spy = vi.spyOn(process, "exit").mockImplementation((code?: string | number | null | undefined): never => {
    capturedCode = typeof code === "number" ? code : 0;
    throw new Error(`process.exit(${code})`);
  });
  return {
    get code() {
      return capturedCode;
    },
    spy,
  };
}

/**
 * Run a CLI command's run handler with the given args.
 * Asserts the run handler exists (fail-loud) before calling it.
 * This eliminates TS2722 "Cannot invoke an object which is possibly 'undefined'"
 * at every callsite — the check happens once, here.
 */
async function runCmd(
  cmd: { run?: RunnableCommand["run"] },
  args: Record<string, unknown>,
): Promise<void> {
  if (!cmd.run) {
    throw new Error("Command is missing run handler");
  }
  return cmd.run({ args });
}

async function importCreateCommand(): Promise<RunnableCommand> {
  // Using dynamic import so module-not-found errors are localised
  const mod = await import("@adapters/cli/commands/create");
  const cmd = (mod as { default?: { run?: RunnableCommand["run"] } }).default;
  if (!cmd?.run) throw new Error("create command not exported");
  return cmd as RunnableCommand;
}

async function importGetCommand(): Promise<RunnableCommand> {
  const getMod = await import("@adapters/cli/commands/get");
  const getCmd = (getMod as { default?: { run?: RunnableCommand["run"] } }).default;
  if (!getCmd?.run) throw new Error("get command not exported");
  return getCmd as RunnableCommand;
}

// ─── Temp dir lifecycle ────────────────────────────────────────────────────────

let tmpDir: string;
let originalCwd: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "lore-cli-create-test-"));
  originalCwd = process.cwd();
  process.chdir(tmpDir);
});

afterEach(() => {
  process.chdir(originalCwd);
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
  const initMod = await import("@adapters/cli/commands/init");
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

// ─── HAPPY path ───────────────────────────────────────────────────────────────

describe("lore create — happy path", () => {
  it("creates an adr with decision-status=proposed", async () => {
    await initLoreDb();

    // First create a parent prd
    const cmd = await importCreateCommand();
    const output1 = captureOutput();
    const exit1 = captureExit();
    try {
      await runCmd(cmd, { type: "prd", title: "Parent PRD" });
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

    const output = captureOutput();
    const exit = captureExit();
    try {
      await runCmd(cmd, { type: "knowledge", title: "Research Notes", "sub-type": "research" });
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
      await runCmd(cmd, { type: "prd", title: "Root PRD" });
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
      await runCmd(cmd, { type: "plan", title: "Sprint Plan", parent: prdSlug });
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
      await runCmd(cmd, { type: "prd", title: "My PRD" });
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
      await runCmd(cmd, { type: "prd", title: "Root" });
    } catch (e: unknown) {
      if (!(e instanceof Error) || !e.message.startsWith("process.exit(")) throw e;
    } finally {
      out1.restore();
    }
    const prdSlug = out1.stdout.find((l) => l.includes("prd-"))?.match(/prd-[\w-]+/)?.[0];

    const output = captureOutput();
    const exit = captureExit();
    try {
      await runCmd(cmd, { type: "plan", title: "My Plan", parent: prdSlug });
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
      await runCmd(cmd, { type: "prd", title: "Root" });
    } catch (e: unknown) {
      if (!(e instanceof Error) || !e.message.startsWith("process.exit(")) throw e;
    } finally {
      out1.restore();
    }
    const prdSlug = out1.stdout.find((l) => l.includes("prd-"))?.match(/prd-[\w-]+/)?.[0];

    const out2 = captureOutput();
    try {
      await runCmd(cmd, { type: "plan", title: "Sprint", parent: prdSlug });
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

    for (const status of ["proposed", "accepted", "deprecated", "superseded"]) {
      const output = captureOutput();
      const exit = captureExit();
      try {
        await runCmd(cmd, { type: "adr", title: `ADR-${status}`, "decision-status": status });
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

    for (const subType of ["ideation", "retro", "research", "reference"]) {
      const output = captureOutput();
      const exit = captureExit();
      try {
        await runCmd(cmd, {
          type: "knowledge",
          title: `Knowledge-${subType}`,
          "sub-type": subType,
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
    const exit = captureExit();

    try {
      await runCmd(cmd, {
        type: "task",
        title: "Task",
        parent: "plan-does-not-exist",
        "plan-id": "plan-does-not-exist",
      });
    } catch (e: unknown) {
      if (!(e instanceof Error) || !e.message.startsWith("process.exit(")) throw e;
    } finally {
      output.restore();
    }

    // Should exit with a non-zero code (3 = DOC_NOT_FOUND or 4 = validation)
    expect(exit.code).toBeDefined();
    expect(exit.code).not.toBe(0);
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

    const out1 = captureOutput();
    try {
      await runCmd(cmd, {
        type: "adr",
        title: "Architecture Decision",
        "decision-status": "accepted",
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

    const out1 = captureOutput();
    try {
      await runCmd(cmd, { type: "knowledge", title: "Team Retro", "sub-type": "retro" });
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
      await runCmd(cmd, { type: "prd", title: "Root PRD" });
    } catch (e: unknown) {
      if (!(e instanceof Error) || !e.message.startsWith("process.exit(")) throw e;
    } finally {
      outPrd.restore();
    }
    const prdSlug = outPrd.stdout.find((l) => l.includes("prd-"))?.match(/prd-[\w-]+/)?.[0];

    const outPlan = captureOutput();
    try {
      await runCmd(cmd, { type: "plan", title: "Sprint 1", parent: prdSlug });
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
});

// ─── REGRESSION guards ────────────────────────────────────────────────────────

describe("lore create — regression guards", () => {
  // Regression: spec create still requires --parent (not broken by type-specific changes)
  it("spec still requires --parent (existing behaviour preserved)", async () => {
    await initLoreDb();
    const cmd = await importCreateCommand();
    const output = captureOutput();
    const exit = captureExit();

    try {
      await runCmd(cmd, { type: "spec", title: "Spec Without Parent" });
    } catch (e: unknown) {
      if (!(e instanceof Error) || !e.message.startsWith("process.exit(")) throw e;
    } finally {
      output.restore();
    }

    // Should fail (parent required for spec)
    expect(exit.code).toBeDefined();
    expect(exit.code).not.toBe(0);
  });

  // N/A: no other known historical regressions beyond what spec/plan coverage above provides
});
