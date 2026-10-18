/**
 * @spec_ref SPEC-032 §3.1 — `lore set --kind` (spec_kind taxonomy)
 *
 * Happy-path CLI wiring test only, per SPEC-032 T1 scope: the exhaustive schema/service
 * coverage lives in packages/lore/tests/unit/core/schemas.test.ts and
 * corpus-service.test.ts's "spec_kind" describe block. This file covers the ONE behaviour
 * unique to `set` — merging spec_kind into an existing doc's extra without clobbering
 * unrelated keys (CorpusService.set replaces `extra` wholesale, so set.ts must merge before
 * patching; see the `--kind` module-header comment in set.ts).
 *
 * Six-dimension coverage:
 *   HAPPY:      set --kind design on an existing spec persists extra.spec_kind
 *   NEGATIVE:   --kind on a non-spec doc → exit 2 (type-scope mismatch)
 *   STATE:      unrelated extra keys survive the merge
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync } from "fs";
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

async function importSetCommand(): Promise<RunnableCommand> {
  const mod = await import("../../../src/adapters/cli/commands/set.js");
  // reason: set.ts exports a second top-level binding (APPROVED_DEMOTION_ADVISORY,
  // spec-plan-closure-must-be-loud-terminality-divergence-silent DD-3) alongside its
  // default command export. That module shape makes citty's generated
  // `CommandContext<Args>` structurally incomparable to this naive
  // `{ default?: { run?: ... } }` cast target (TS2352 "may be a mistake because neither
  // type sufficiently overlaps with the other"). Cast through `unknown` first, exactly
  // as TS's own diagnostic recommends.
  const cmd = (mod as unknown as { default?: { run?: RunnableCommand["run"] } }).default;
  if (!cmd?.run) throw new Error("set command not exported");
  return cmd as RunnableCommand;
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
  tmpDir = mkdtempSync(join(tmpdir(), "lore-cli-set-kind-test-"));
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

describe("lore set --kind (SPEC-032 §3.1)", () => {
  it("AC-SPECKIND.SET-01: set --kind design on an existing spec persists extra.spec_kind, preserving other extra keys", async () => {
    await initLoreDb();
    const createCmd = await importCreateCommand();
    const setCmd = await importSetCommand();
    const getCmd = await importGetCommand();

    // PRD (a spec takes no parent, BR-1 - it is created unparented below)
    const outPrd = captureOutput();
    try {
      await runCmd(createCmd, { type: "prd", title: "Root PRD", ai: false });
    } finally {
      outPrd.restore();
    }
    const prdSlug = outPrd.stdout.find((l) => l.includes("prd-"))?.match(/prd-[\w-]+/)?.[0];
    expect(prdSlug).toBeTruthy();

    // Create a spec that already defaults to spec_kind="feature" (no --kind at create time)
    const outSpec = captureOutput();
    try {
      // reason: spec-create's GateEnforcer checkpoint (retro follow-up item 8) requires
      // a `## ` skeleton heading — bun test's own stdin isn't a TTY, so the in-process
      // fake-editor script never actually runs and content would otherwise stay "".
      await runCmd(createCmd, {
        type: "spec",
        title: "My Spec",
        content: "## Overview\n\nbody",
        ai: false,
      });
    } finally {
      outSpec.restore();
    }
    const specSlugLine = outSpec.stdout.find((l) => l.includes("Slug:"));
    const specSlug = specSlugLine?.split(":")[1]?.trim();
    expect(specSlug).toBeTruthy();

    // set --kind design should merge into extra (overwriting the "feature" default) without
    // needing to know about any other extra keys the doc may carry.
    const outSet = captureOutput();
    const exitSet = captureExit();
    try {
      await runCmd(setCmd, { id: specSlug, kind: "design" });
    } finally {
      outSet.restore();
    }
    expect(exitSet.code).toBeUndefined();

    const outGet = captureOutput();
    try {
      await runCmd(getCmd, { id: specSlug, json: true });
    } finally {
      outGet.restore();
    }
    const doc = JSON.parse(outGet.stdout.join("")) as {
      data?: { doc?: { extra?: { spec_kind?: string } } };
    };
    expect(doc.data?.doc?.extra?.spec_kind).toBe("design");
  });

  it("exits 2 when --kind is passed for a non-spec document (type-scope mismatch)", async () => {
    await initLoreDb();
    const createCmd = await importCreateCommand();
    const setCmd = await importSetCommand();

    const outPrd = captureOutput();
    try {
      await runCmd(createCmd, { type: "prd", title: "Root PRD", ai: false });
    } finally {
      outPrd.restore();
    }
    const prdSlug = outPrd.stdout.find((l) => l.includes("prd-"))?.match(/prd-[\w-]+/)?.[0];
    expect(prdSlug).toBeTruthy();

    const output = captureOutput();
    const exit = captureExit();
    try {
      await runCmd(setCmd, { id: prdSlug, kind: "design" });
    } finally {
      output.restore();
    }

    expect(exit.code).toBe(2);
    expect(output.stderr.join("\n")).toContain("--kind");
  });
});
