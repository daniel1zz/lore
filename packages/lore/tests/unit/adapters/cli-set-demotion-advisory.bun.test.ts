// @reads packages/lore/src/adapters/cli/commands/set.ts
/**
 * @spec_ref spec-plan-closure-must-be-loud-terminality-divergence-silent DD-3
 *   (AC-CLOSURE-4) — `lore set`'s approved→draft auto-demotion advisory must
 *   fire on EVERY surface, not only the AI-mutation (--regenerate/--refine)
 *   branch. The live incident: appending a closure record to an APPROVED
 *   plan via the standard `--content-file` patch path silently demoted it
 *   to draft with zero operator-visible signal, so `plan-close` never
 *   evaluated the (now non-terminal) doc.
 *
 * Six-dimension coverage:
 *   HAPPY:      approved doc + --content-file change (standard patch path)
 *               → advisory printed AND status is draft afterward.
 *   NEGATIVE:   draft doc + --content-file change (same path) → no advisory.
 *   BOUNDARY:   approved doc + --priority only (no content/title) → no
 *               demotion, no advisory (rule is content-or-title only).
 *   ERROR:      --content-file against a nonexistent doc id → the new
 *               prior-status fetch surfaces DOC_NOT_FOUND (exit 3), not a
 *               crash or a silently-skipped advisory check.
 *   STATE:      doc status actually transitions approved -> draft as a
 *               side effect of the write (verified via a follow-up `get`).
 *   REGRESSION: the AI-mutation branch and the standard patch branch print
 *               the SAME exported APPROVED_DEMOTION_ADVISORY constant — a
 *               duplicated string literal (drift risk) fails this check.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { fileURLToPath } from "node:url";
import { mkdtempSync, writeFileSync } from "fs";
import { readFileSync } from "node:fs";
import { join } from "path";
import { tmpdir } from "os";
import { liveInvocation, runHandlerForExit } from "../../live-invocation.js";
import type { Invocation } from "@lore/core";

type RunnableCommand = {
  run: (ctx: { args: Record<string, unknown>; inv?: Invocation }) => Promise<void>;
};

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
    restore(): void {},
  };
}

async function runCmd(
  cmd: { run?: RunnableCommand["run"] },
  args: Record<string, unknown>,
): Promise<void> {
  if (!cmd.run) {
    throw new Error("Command is missing run handler");
  }
  const run = cmd.run;
  lastExitCode = await runHandlerForExit(() => run({ args, inv: liveInvocation() }));
}

async function importCreateCommand(): Promise<RunnableCommand> {
  const mod = await import("../../../src/adapters/cli/commands/create.js");
  const cmd = (mod as { default?: { run?: RunnableCommand["run"] } }).default;
  if (!cmd?.run) throw new Error("create command not exported");
  return cmd as RunnableCommand;
}

async function importSetCommand(): Promise<{
  cmd: RunnableCommand;
  APPROVED_DEMOTION_ADVISORY: string;
}> {
  const mod = await import("../../../src/adapters/cli/commands/set.js");
  // reason: set.ts now exports a SECOND top-level binding (APPROVED_DEMOTION_ADVISORY)
  // alongside its default command export — a module shape citty's generated
  // `CommandContext<Args>` type makes structurally incomparable to the naive
  // `{ default?: { run?: ... } }` cast target used elsewhere in this test suite
  // (TS2352 "may be a mistake"). Cast through `unknown` first, exactly as TS's own
  // diagnostic recommends, rather than widen the shared target type.
  const modUnknown = mod as unknown as {
    default?: { run?: RunnableCommand["run"] };
    APPROVED_DEMOTION_ADVISORY?: string;
  };
  const cmd = modUnknown.default;
  if (!cmd?.run) throw new Error("set command not exported");
  const advisory = modUnknown.APPROVED_DEMOTION_ADVISORY;
  if (typeof advisory !== "string" || advisory.length === 0) {
    throw new Error("set command does not export APPROVED_DEMOTION_ADVISORY");
  }
  return { cmd: cmd as RunnableCommand, APPROVED_DEMOTION_ADVISORY: advisory };
}

async function importGetCommand(): Promise<RunnableCommand> {
  const getMod = await import("../../../src/adapters/cli/commands/get.js");
  const getCmd = (getMod as { default?: { run?: RunnableCommand["run"] } }).default;
  if (!getCmd?.run) throw new Error("get command not exported");
  return getCmd as RunnableCommand;
}

let tmpDir: string;
let originalCwd: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "lore-cli-set-demotion-advisory-test-"));
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

/** Creates a draft `prd` doc (no parent required, no gate on approval) and returns its slug. */
async function createDraftPrd(createCmd: RunnableCommand, title: string): Promise<string> {
  const out = captureOutput();
  try {
    await runCmd(createCmd, {
      type: "prd",
      title,
      content: "## Overview\n\nbody",
      ai: false,
    });
  } finally {
    out.restore();
  }
  const slugLine = out.stdout.find((l) => l.includes("Slug:"));
  const slug = slugLine?.split(":")[1]?.trim() ?? out.stdout.find((l) => l.includes("prd-"))?.match(/prd-[\w-]+/)?.[0];
  if (!slug) throw new Error(`could not extract prd slug from create output: ${out.stdout.join("\n")}`);
  return slug;
}

async function setStatus(setCmd: RunnableCommand, id: string, status: string): Promise<void> {
  const out = captureOutput();
  const exit = captureExit();
  try {
    await runCmd(setCmd, { id, status });
  } finally {
    out.restore();
  }
  if (exit.code !== undefined) {
    throw new Error(`set --status ${status} exited ${exit.code}: ${out.stderr.join("\n")}`);
  }
}

async function getDocStatus(getCmd: RunnableCommand, id: string): Promise<string> {
  const out = captureOutput();
  try {
    await runCmd(getCmd, { id, json: true });
  } finally {
    out.restore();
  }
  const parsed = JSON.parse(out.stdout.join("")) as { data?: { doc?: { status?: string } } };
  const status = parsed.data?.doc?.status;
  if (!status) throw new Error(`could not read doc status from get output: ${out.stdout.join("\n")}`);
  return status;
}

describe("lore set — approved→draft demotion advisory on the standard patch path (AC-CLOSURE-4)", () => {
  it("HAPPY: approved doc + --content-file change prints the advisory and lands the doc in draft", async () => {
    await initLoreDb();
    const createCmd = await importCreateCommand();
    const { cmd: setCmd, APPROVED_DEMOTION_ADVISORY } = await importSetCommand();
    const getCmd = await importGetCommand();

    const slug = await createDraftPrd(createCmd, "Happy Path Doc");
    await setStatus(setCmd, slug, "approved");
    expect(await getDocStatus(getCmd, slug)).toBe("approved");

    const contentFile = join(tmpDir, "new-content.md");
    writeFileSync(contentFile, "## Overview\n\nupdated body\n", "utf8");

    const out = captureOutput();
    const exit = captureExit();
    try {
      await runCmd(setCmd, { id: slug, "content-file": contentFile });
    } finally {
      out.restore();
    }

    expect(exit.code).toBeUndefined();
    expect(out.stdout.join("\n")).toContain(APPROVED_DEMOTION_ADVISORY);
    expect(await getDocStatus(getCmd, slug)).toBe("draft");
  });

  it("NEGATIVE: draft doc + --content-file change prints no advisory", async () => {
    await initLoreDb();
    const createCmd = await importCreateCommand();
    const { cmd: setCmd, APPROVED_DEMOTION_ADVISORY } = await importSetCommand();
    const getCmd = await importGetCommand();

    const slug = await createDraftPrd(createCmd, "Negative Path Doc");
    expect(await getDocStatus(getCmd, slug)).toBe("draft");

    const contentFile = join(tmpDir, "new-content-negative.md");
    writeFileSync(contentFile, "## Overview\n\nupdated body (still draft)\n", "utf8");

    const out = captureOutput();
    const exit = captureExit();
    try {
      await runCmd(setCmd, { id: slug, "content-file": contentFile });
    } finally {
      out.restore();
    }

    expect(exit.code).toBeUndefined();
    expect(out.stdout.join("\n")).not.toContain(APPROVED_DEMOTION_ADVISORY);
    expect(await getDocStatus(getCmd, slug)).toBe("draft");
  });

  it("BOUNDARY: approved doc + --priority only triggers no demotion and no advisory", async () => {
    await initLoreDb();
    const createCmd = await importCreateCommand();
    const { cmd: setCmd, APPROVED_DEMOTION_ADVISORY } = await importSetCommand();
    const getCmd = await importGetCommand();

    const slug = await createDraftPrd(createCmd, "Boundary Path Doc");
    await setStatus(setCmd, slug, "approved");
    expect(await getDocStatus(getCmd, slug)).toBe("approved");

    const out = captureOutput();
    const exit = captureExit();
    try {
      await runCmd(setCmd, { id: slug, priority: "high" });
    } finally {
      out.restore();
    }

    expect(exit.code).toBeUndefined();
    expect(out.stdout.join("\n")).not.toContain(APPROVED_DEMOTION_ADVISORY);
    // Still approved — priority/tags-only patches never trigger the reset.
    expect(await getDocStatus(getCmd, slug)).toBe("approved");
  });

  it("ERROR: --content-file against a nonexistent doc id surfaces DOC_NOT_FOUND (exit 3), not a crash", async () => {
    await initLoreDb();
    const { cmd: setCmd } = await importSetCommand();

    const contentFile = join(tmpDir, "new-content-error.md");
    writeFileSync(contentFile, "## Overview\n\nbody\n", "utf8");

    const out = captureOutput();
    // reason: this failure path sets `process.exitCode` (a property, checked at process
    // exit) rather than calling `process.exit()` directly — see set.ts's new prior-status
    // fetch block, which mirrors the existing resolve/get error-handling shape used
    // throughout this command (e.g. the --kind branch's resolve/get failures). So the
    // assertion reads `process.exitCode` itself, not a `process.exit()` spy.
    try {
      await runCmd(setCmd, { id: "prd-does-not-exist", "content-file": contentFile });
    } finally {
      out.restore();
    }

    expect(lastExitCode).toBe(3);
  });

  it("REGRESSION: the AI-mutation branch and the standard patch branch share ONE exported advisory constant, never a duplicated literal", async () => {
    // Source-level check: this is the only way to assert the two independent code paths
    // (the --regenerate/--refine branch, which requires a live AI provider to exercise,
    // and the standard --content/--content-file/--title branch exercised above) can NEVER
    // drift on wording — they must both reference the SAME identifier, not two copies of
    // the same string literal (AC-CLOSURE-4: "a duplicated string literal fails this AC").
    const { APPROVED_DEMOTION_ADVISORY } = await importSetCommand();
    const setSourcePath = join(
      fileURLToPath(new URL(".", import.meta.url)),
      "../../../src/adapters/cli/commands/set.ts",
    );
    const source = readFileSync(setSourcePath, "utf8");

    // The literal advisory string must appear EXACTLY once — as the constant's own
    // definition. Any second occurrence would mean a branch re-wrote its own copy.
    const literalOccurrences = source.split(APPROVED_DEMOTION_ADVISORY).length - 1;
    expect(literalOccurrences).toBe(1);

    // Both the AI-mutation branch and the standard patch branch must reference the
    // exported identifier by name.
    const identifierOccurrences = source.split("APPROVED_DEMOTION_ADVISORY").length - 1;
    // 1 export declaration + JSDoc mentions + >=2 printLine call sites.
    expect(identifierOccurrences).toBeGreaterThanOrEqual(3);
    const consoleLogUsages = (source.match(/printLine\(inv\.io\.stdout, APPROVED_DEMOTION_ADVISORY\)/g) ?? []).length;
    expect(consoleLogUsages).toBe(2);
  });
});
