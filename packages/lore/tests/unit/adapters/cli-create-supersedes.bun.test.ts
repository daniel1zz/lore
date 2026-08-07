/**
 * @spec_ref task-a-task-cannot-be-retracted-supersedes-emits-a-repair, Defect 1;
 *   task-mcp-lore-create-supersedes-still-creates-then-fails-the (precheck later
 *   hoisted out of this command and into the shared flow — see below)
 *
 * Tests for `lore create <type> --supersedes <target>`'s up-front type
 * precondition — the pre-fix bug measured a doc CREATED then a repair command
 * naming the exact invalidate call that had just failed for a structural
 * reason (target type outside knowledge/adr) no retry could change. The fix
 * validates the target's type BEFORE any write. That check (the
 * `SUPERSEDE_CREATE_ELIGIBLE_TYPES` constant) originally lived in
 * `commands/create.ts` itself; task-mcp-lore-create-supersedes-still-creates-
 * then-fails-the moved it into `flows/supersede-flow.ts`'s `createWithSupersedes`
 * (the CLI's local copy meant MCP, which already called that shared function
 * directly, never inherited the check) — this file's assertions are unaffected
 * (still CLI-surface exit-code + doc-count behavior), only the constant's home
 * moved.
 *
 * Strategy mirrors `cli-create.bun.test.ts`: run the real `create.js`
 * command's `run()` handler in-process against a throwaway `.lore/lore.db`
 * (never this repo's own corpus), asserting on `process.exitCode` (the
 * FU#4 soft-exit convention this command uses for service-layer/validation
 * refusals) and a directly-constructed second `App` instance (same db file)
 * to assert the real doc COUNT — the exact oracle the task calls for
 * ("assert the doc count is unchanged — a refusal that still creates the
 * doc is the current bug with a better message").
 *
 * Six-dimension coverage:
 *   HAPPY / CONTROL: --supersedes against a knowledge target still works
 *               end-to-end (create + invalidate both applied) — AC2
 *   NEGATIVE:   --supersedes <task> exits 4 and creates NOTHING — AC1
 *   BOUNDARY:   --supersedes <a nonexistent slug> refuses BEFORE create too
 *               (DOC_NOT_FOUND), same "nothing created" guarantee
 *   ERROR:      the refusal names the offending type in stderr
 *   STATE:      doc count is asserted via a real second App read, not a
 *               parsed stdout heuristic
 *   REGRESSION: an ADR target ALSO still works (the eligible-types set covers
 *               BOTH knowledge and adr, not just one)
 */

import { describe, it, expect, vi } from "vitest";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { createApp } from "../../../src/app.js";
import type { App } from "../../../src/app.js";
import type { DocType } from "@lore/core";

type RunnableCommand = {
  run: (ctx: { args: Record<string, unknown> }) => Promise<void>;
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

async function runCmd(cmd: RunnableCommand, args: Record<string, unknown>): Promise<void> {
  if (!cmd.run) throw new Error("Command is missing run handler");
  return cmd.run({ args });
}

async function importCreateCommand(): Promise<RunnableCommand> {
  const mod = await import("../../../src/adapters/cli/commands/create.js");
  const cmd = (mod as { default?: { run?: RunnableCommand["run"] } }).default;
  if (!cmd?.run) throw new Error("create command not exported");
  return cmd as RunnableCommand;
}

let tmpDir: string;
let originalCwd: string;
let savedEditor: string | undefined;

function setupTmpCorpus(): void {
  tmpDir = mkdtempSync(join(tmpdir(), "lore-cli-create-supersedes-test-"));
  originalCwd = process.cwd();
  process.chdir(tmpDir);

  const editorScript = join(tmpDir, "test-editor.sh");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { writeFileSync } = require("fs") as { writeFileSync: (p: string, d: string, opts: object) => void };
  writeFileSync(editorScript, "#!/bin/sh\nprintf 'test content placeholder' > \"$1\"\n", { mode: 0o755 });
  savedEditor = process.env["EDITOR"];
  process.env["EDITOR"] = editorScript;
}

function teardownTmpCorpus(): void {
  process.exitCode = 0;
  process.chdir(originalCwd);
  if (savedEditor !== undefined) {
    process.env["EDITOR"] = savedEditor;
  } else {
    delete process.env["EDITOR"];
  }
  try {
    rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    // best-effort
  }
  vi.restoreAllMocks();
}

async function initLoreDb(): Promise<void> {
  const initMod = await import("../../../src/adapters/cli/commands/init.js");
  const initCmd = (initMod as { default?: { run?: RunnableCommand["run"] } }).default;
  if (!initCmd?.run) throw new Error("init command not exported");
  const output = captureOutput();
  try {
    await runCmd(initCmd as RunnableCommand, { name: "test-corpus", description: "" });
  } finally {
    output.restore();
  }
}

/** Opens a SECOND App instance against the SAME db file this test's CLI
 *  commands wrote to — the real-state oracle for "doc count unchanged". */
function openDbApp(): App {
  return createApp(join(tmpDir, ".lore", "lore.db"));
}

/**
 * `includeInvalid: true` is REQUIRED for a true doc-count oracle once
 * `ValidityService.invalidate` is in play — CorpusService.list()'s D3
 * default excludes invalidated docs, so a plain count would UNDER-report
 * after a successful supersede (the old doc is still real, merely hidden by
 * default) and could mask "doc count unchanged" (AC1) behind two DIFFERENT
 * defaults cancelling out. Every call site below passes `true` explicitly.
 */
async function countDocsOfType(type: DocType, includeInvalid: boolean): Promise<number> {
  const app = openDbApp();
  try {
    const result = await app.corpusService.list({ type, include_invalid: includeInvalid });
    if (!result.ok) throw new Error(`list failed: ${JSON.stringify(result.error)}`);
    return result.value.total;
  } finally {
    app.close();
  }
}

async function createTitledDoc(
  cmd: RunnableCommand,
  args: Record<string, unknown>,
): Promise<{ slug: string; exitCode: number | undefined }> {
  process.exitCode = 0;
  const output = captureOutput();
  try {
    await runCmd(cmd, { ...args, ai: false });
  } finally {
    output.restore();
  }
  const typePrefix = String(args["type"]);
  const slug = output.stdout.find((l) => l.includes(`${typePrefix}-`))?.match(new RegExp(`${typePrefix}-[\\w-]+`))?.[0];
  return { slug: slug ?? "", exitCode: process.exitCode };
}

describe("lore create --supersedes — up-front target-type precondition (Defect 1)", () => {
  it("NEGATIVE (AC1): --supersedes <task> exits 4 and creates NOTHING", async () => {
    setupTmpCorpus();
    try {
      await initLoreDb();
      const cmd = await importCreateCommand();

      const prd = await createTitledDoc(cmd, { type: "prd", title: "Root PRD" });
      expect(prd.exitCode).toBe(0);

      const plan = await createTitledDoc(cmd, { type: "plan", title: "Plan", parent: prd.slug });
      expect(plan.exitCode).toBe(0);

      const task = await createTitledDoc(cmd, {
        type: "task",
        title: "A Task That Cannot Be Superseded",
        parent: plan.slug,
        "plan-id": plan.slug,
      });
      expect(task.exitCode).toBe(0);
      expect(task.slug).toBeTruthy();

      const knowledgeCountBefore = await countDocsOfType("knowledge", true);

      process.exitCode = 0;
      const output = captureOutput();
      try {
        await runCmd(cmd, {
          type: "knowledge",
          title: "Should Not Be Created",
          "sub-type": "ideation",
          supersedes: task.slug,
          ai: false,
        });
      } finally {
        output.restore();
      }

      expect(process.exitCode).toBe(4);
      expect(output.stderr.join("\n")).toMatch(/task/i);
      expect(output.stderr.join("\n")).toMatch(/supersede/i);

      // The exact oracle the task requires: doc count is UNCHANGED.
      const knowledgeCountAfter = await countDocsOfType("knowledge", true);
      expect(knowledgeCountAfter).toBe(knowledgeCountBefore);
      process.exitCode = 0;
    } finally {
      teardownTmpCorpus();
    }
  });

  it("BOUNDARY: --supersedes <a nonexistent slug> also refuses BEFORE create (DOC_NOT_FOUND)", async () => {
    setupTmpCorpus();
    try {
      await initLoreDb();
      const cmd = await importCreateCommand();
      const knowledgeCountBefore = await countDocsOfType("knowledge", true);

      process.exitCode = 0;
      const output = captureOutput();
      try {
        await runCmd(cmd, {
          type: "knowledge",
          title: "Should Also Not Be Created",
          "sub-type": "ideation",
          supersedes: "knowledge-does-not-exist-at-all",
          ai: false,
        });
      } finally {
        output.restore();
      }

      expect(process.exitCode).toBe(3);
      const knowledgeCountAfter = await countDocsOfType("knowledge", true);
      expect(knowledgeCountAfter).toBe(knowledgeCountBefore);
      process.exitCode = 0;
    } finally {
      teardownTmpCorpus();
    }
  });

  it("CONTROL (AC2): --supersedes against a knowledge target still works end-to-end (create + invalidate applied) — unchanged", async () => {
    setupTmpCorpus();
    try {
      await initLoreDb();
      const cmd = await importCreateCommand();

      const oldKnowledge = await createTitledDoc(cmd, {
        type: "knowledge",
        title: "Old Knowledge Doc",
        "sub-type": "ideation",
      });
      expect(oldKnowledge.exitCode).toBe(0);
      expect(oldKnowledge.slug).toBeTruthy();

      const knowledgeCountBefore = await countDocsOfType("knowledge", true);

      process.exitCode = 0;
      const output = captureOutput();
      try {
        await runCmd(cmd, {
          type: "knowledge",
          title: "New Knowledge Doc",
          "sub-type": "ideation",
          supersedes: oldKnowledge.slug,
          ai: false,
        });
      } finally {
        output.restore();
      }

      expect(process.exitCode).toBe(0);
      expect(output.stdout.join("\n")).toContain("Created knowledge document");

      // A new doc WAS created this time.
      const knowledgeCountAfter = await countDocsOfType("knowledge", true);
      expect(knowledgeCountAfter).toBe(knowledgeCountBefore + 1);

      // ...and the old one was actually invalidated (not just created+ignored).
      const app = openDbApp();
      try {
        const oldDocResult = await app.corpusService.get(oldKnowledge.slug);
        expect(oldDocResult.ok).toBe(true);
        if (!oldDocResult.ok) return;
        expect(oldDocResult.value.doc.extra["validity"]).toBeDefined();
      } finally {
        app.close();
      }
    } finally {
      teardownTmpCorpus();
    }
  });

  it("REGRESSION: --supersedes against an ADR target also still works (both eligible types, not just one)", async () => {
    setupTmpCorpus();
    try {
      await initLoreDb();
      const cmd = await importCreateCommand();

      const oldAdr = await createTitledDoc(cmd, {
        type: "adr",
        title: "Old Decision",
        "decision-status": "accepted",
      });
      expect(oldAdr.exitCode).toBe(0);
      expect(oldAdr.slug).toBeTruthy();

      process.exitCode = 0;
      const output = captureOutput();
      try {
        await runCmd(cmd, {
          type: "adr",
          title: "New Decision",
          "decision-status": "accepted",
          supersedes: oldAdr.slug,
          ai: false,
        });
      } finally {
        output.restore();
      }

      expect(process.exitCode).toBe(0);
      expect(output.stdout.join("\n")).toContain("Created adr document");

      const app = openDbApp();
      try {
        const oldDocResult = await app.corpusService.get(oldAdr.slug);
        expect(oldDocResult.ok).toBe(true);
        if (!oldDocResult.ok) return;
        expect(oldDocResult.value.doc.extra["decision_status"]).toBe("superseded");
      } finally {
        app.close();
      }
    } finally {
      teardownTmpCorpus();
    }
  });
});
