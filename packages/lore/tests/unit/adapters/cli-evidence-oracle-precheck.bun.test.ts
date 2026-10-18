/**
 * @spec_ref task-lore-evidence-self-reported-pass-lacks-oracle-file AC-2, AC-3
 *
 * `lore evidence --oracle test|e2e --result pass` — CLI-layer missing-oracle-file
 * precheck (defect: a self-reported pass used to record cleanly even when the
 * referenced test file did not exist on disk — the AC-080-3 incident).
 *
 * Scope: this file verifies the CLI adapter's END-TO-END behavior — exit code,
 * whether the service call happens at all, and that every OTHER
 * oracle/result combination stays byte-identical (REGRESSION). Token-extraction
 * edge cases (cd-prefix, quoting, -t filters) are covered in the pure
 * `evidence-precheck.test.ts` unit suite (vitest) — not duplicated here.
 *
 * Uses bun:sqlite (loadLoreApp → createApp → SQLiteStore) — bun test only.
 *
 * Six-dimension coverage:
 *   HAPPY:      test/e2e + pass + an EXISTING referenced file → records normally
 *   NEGATIVE:   test + pass + a command with no extractable test-file token →
 *               records normally (fail-open, nothing to check)
 *   BOUNDARY:   e2e oracle (not just test) also gates; missing-file message names
 *               the exact path
 *   ERROR:      test/e2e + pass + a MISSING referenced file → exit 4, no service
 *               call, no doc mutation
 *   STATE:      after a blocked precheck, the task's evidence array is unchanged
 *   REGRESSION: manual oracle and result=fail are completely unaffected even when
 *               the command references a nonexistent file
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "fs";
import { join, resolve } from "path";
import { tmpdir } from "os";
import { createApp } from "../../../src/app.js";
import { TaskWorkflowService } from "../../../src/service/task-workflow-service.js";
import type { EvidenceInput } from "../../../src/service/task-workflow-service.js";
import type { CreateDocInput } from "@lore/core";
import { liveInvocation, liveAmbient } from "../../live-invocation.js";
import type { Invocation } from "@lore/core";

// ─── Command type ────────────────────────────────────────────────────────────

type RunnableCommand = {
  run: (ctx: { args: Record<string, unknown>; inv?: Invocation }) => Promise<void>;
};

async function importEvidenceCommand(): Promise<RunnableCommand> {
  const mod = await import("../../../src/adapters/cli/commands/evidence.js");
  const cmd = (mod as { default?: { run?: RunnableCommand["run"] } }).default;
  if (!cmd?.run) throw new Error("evidence command not exported");
  return cmd as RunnableCommand;
}

// ─── Fixture setup ───────────────────────────────────────────────────────────

let tmpDir: string;
let originalCwd: string;

beforeEach(() => {
  process.exitCode = 0;

  tmpDir = resolve(mkdtempSync(join(tmpdir(), "lore-cli-evidence-precheck-test-")));
  const loreDir = join(tmpDir, ".lore");
  mkdirSync(loreDir, { recursive: true });

  const app = createApp(join(loreDir, "lore.db"), undefined, liveAmbient());
  app.close();

  originalCwd = process.cwd();
  process.chdir(tmpDir);
});

afterEach(() => {
  process.exitCode = 0;
  process.chdir(originalCwd);
  try {
    rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    /* best-effort cleanup */
  }
});

/** Seed a plan + task synchronously against the temp DB. */
async function seedTask(): Promise<string> {
  const app = createApp(join(tmpDir, ".lore", "lore.db"), undefined, liveAmbient());
  try {
    const planResult = await app.corpusService.create({
      type: "plan",
      title: "Oracle Precheck Test Plan",
      content: "body",
    } as CreateDocInput);
    if (!planResult.ok) throw new Error(`seed plan failed: ${JSON.stringify(planResult.error)}`);

    const taskResult = await app.corpusService.create({
      type: "task",
      title: "Oracle Precheck Test Task",
      parent_id: planResult.value.id,
      content: "body",
      extra: { plan_id: planResult.value.id },
    } as CreateDocInput);
    if (!taskResult.ok) throw new Error(`seed task failed: ${JSON.stringify(taskResult.error)}`);
    return taskResult.value.slug;
  } finally {
    app.close();
  }
}

/**
 * Monkey-patches TaskWorkflowService.prototype.addEvidence to capture whether
 * (and with what argument) the CLI command reaches the service layer, then
 * delegates to the original implementation so a non-blocked call still
 * completes normally. Restores the prototype method in `restore()`.
 */
function spyOnAddEvidence(): {
  called: () => boolean;
  captured: () => EvidenceInput | undefined;
  restore: () => void;
} {
  const original = TaskWorkflowService.prototype.addEvidence;
  let wasCalled = false;
  let capturedEntry: EvidenceInput | undefined;

  TaskWorkflowService.prototype.addEvidence = function (
    this: TaskWorkflowService,
    idOrSlug: string,
    entry: EvidenceInput,
    now?: () => string,
  ) {
    wasCalled = true;
    capturedEntry = entry;
    return original.call(this, idOrSlug, entry, now);
  } as typeof TaskWorkflowService.prototype.addEvidence;

  return {
    called: () => wasCalled,
    captured: () => capturedEntry,
    restore: () => {
      TaskWorkflowService.prototype.addEvidence = original;
    },
  };
}

function captureStderr(): { text: () => string; restore: () => void } {
  const chunks: string[] = [];
  const spy = vi
    .spyOn(process.stderr, "write")
    .mockImplementation((chunk: unknown) => {
      chunks.push(String(chunk));
      return true;
    });
  return {
    text: () => chunks.join(""),
    restore: () => spy.mockRestore(),
  };
}

// ─── HAPPY ───────────────────────────────────────────────────────────────────

describe("lore evidence oracle precheck — HAPPY", () => {
  // reason: SUPERSEDED (task-raise-the-evidence-tail-guard-s-predicate-to-its-
  // own, spec-falsifiability-reachability-a-feedable-checkpoint-an §D5) — the
  // oracle-file precheck this file exists to test still clears this call
  // (proven by addEvidence being REACHED at all — a precheck refusal would
  // short-circuit before ever calling it), but D5 separately raises
  // rejectMissingPassOutputTail to refuse EVERY self-reported oracle-"test"
  // pass without --capture. `--oracle manual` is not usable here (it would
  // skip the precheck this file exists to test).
  it("AC-2.H1 SUPERSEDED: test + pass + an existing referenced file clears the precheck, but is now refused by D5 without --capture", async () => {
    const taskSlug = await seedTask();
    mkdirSync(join(tmpDir, "tests"), { recursive: true });
    writeFileSync(join(tmpDir, "tests", "foo.test.ts"), "// exists\n");

    const cmd = await importEvidenceCommand();
    const spy = spyOnAddEvidence();
    const stderr = captureStderr();
    try {
      await cmd.run({
        args: {
          task: taskSlug,
          oracle: "test",
          command: "bunx vitest run tests/foo.test.ts",
          result: "pass",
          by: "alice",
          "output-tail": "ok",
        },
 inv: liveInvocation(),
      });

      expect(spy.called()).toBe(true);
      expect(process.exitCode).toBe(4);
      expect(stderr.text()).toContain("--capture");
      expect(stderr.text()).not.toContain("not found");
    } finally {
      spy.restore();
      stderr.restore();
      process.exitCode = undefined;
    }
  });
});

// ─── NEGATIVE ────────────────────────────────────────────────────────────────

describe("lore evidence oracle precheck — NEGATIVE", () => {
  // reason: SUPERSEDED (task-raise-the-evidence-tail-guard-s-predicate-to-its-
  // own, D5) — the precheck's fail-open behavior for "no extractable token"
  // is STILL true (addEvidence is reached), but D5 separately refuses this
  // self-reported oracle-"test" pass regardless.
  it("AC-2.N1 SUPERSEDED: test + pass + no extractable test-file token stays fail-open at the precheck, but is now refused by D5", async () => {
    const taskSlug = await seedTask();
    const cmd = await importEvidenceCommand();
    const spy = spyOnAddEvidence();
    const stderr = captureStderr();
    try {
      await cmd.run({
        args: {
          task: taskSlug,
          oracle: "test",
          command: "bun run typecheck",
          result: "pass",
          by: "alice",
          "output-tail": "ok",
        },
 inv: liveInvocation(),
      });

      expect(spy.called()).toBe(true);
      expect(process.exitCode).toBe(4);
      expect(stderr.text()).toContain("--capture");
      expect(stderr.text()).not.toContain("not found");
    } finally {
      spy.restore();
      stderr.restore();
      process.exitCode = undefined;
    }
  });
});

// ─── BOUNDARY ────────────────────────────────────────────────────────────────

describe("lore evidence oracle precheck — BOUNDARY", () => {
  it("AC-2.B1: e2e oracle also gates on a missing referenced file", async () => {
    const taskSlug = await seedTask();
    const cmd = await importEvidenceCommand();
    const spy = spyOnAddEvidence();
    const stderr = captureStderr();
    try {
      await cmd.run({
        args: {
          task: taskSlug,
          oracle: "e2e",
          command: "bunx playwright test missing.e2e.test.ts",
          result: "pass",
          by: "alice",
        },
 inv: liveInvocation(),
      });

      expect(process.exitCode).toBe(4);
      expect(spy.called()).toBe(false);
    } finally {
      spy.restore();
      stderr.restore();
    }
  });

  it("AC-2.B2: the exit-4 message names the exact missing path", async () => {
    const taskSlug = await seedTask();
    const cmd = await importEvidenceCommand();
    const spy = spyOnAddEvidence();
    const stderr = captureStderr();
    try {
      await cmd.run({
        args: {
          task: taskSlug,
          oracle: "test",
          command: "bunx vitest run packages/lore/tests/ghost.test.ts",
          result: "pass",
          by: "alice",
        },
 inv: liveInvocation(),
      });

      expect(stderr.text()).toContain("packages/lore/tests/ghost.test.ts");
      expect(stderr.text()).toContain("--oracle manual");
    } finally {
      spy.restore();
      stderr.restore();
    }
  });
});

// ─── ERROR ───────────────────────────────────────────────────────────────────

describe("lore evidence oracle precheck — ERROR", () => {
  it("AC-2.E1: test + pass + a missing referenced file exits 4 without calling the service", async () => {
    const taskSlug = await seedTask();
    const cmd = await importEvidenceCommand();
    const spy = spyOnAddEvidence();
    const stderr = captureStderr();
    try {
      await cmd.run({
        args: {
          task: taskSlug,
          oracle: "test",
          command: "bunx vitest run does-not-exist.test.ts",
          result: "pass",
          by: "alice",
        },
 inv: liveInvocation(),
      });

      expect(process.exitCode).toBe(4);
      expect(spy.called()).toBe(false);
    } finally {
      spy.restore();
      stderr.restore();
    }
  });
});

// ─── STATE ───────────────────────────────────────────────────────────────────

describe("lore evidence oracle precheck — STATE", () => {
  it("AC-2.S1: a blocked precheck leaves the task's evidence array unchanged", async () => {
    const taskSlug = await seedTask();
    const cmd = await importEvidenceCommand();
    const stderr = captureStderr();
    try {
      await cmd.run({
        args: {
          task: taskSlug,
          oracle: "test",
          command: "bunx vitest run absent.test.ts",
          result: "pass",
          by: "alice",
        },
 inv: liveInvocation(),
      });
      expect(process.exitCode).toBe(4);

      const app = createApp(join(tmpDir, ".lore", "lore.db"), undefined, liveAmbient());
      try {
        const docResult = await app.corpusService.get(taskSlug);
        expect(docResult.ok).toBe(true);
        if (docResult.ok) {
          const extra = docResult.value.doc.extra as { verification_evidence?: unknown[] } | undefined;
          expect(extra?.verification_evidence ?? []).toHaveLength(0);
        }
      } finally {
        app.close();
      }
    } finally {
      stderr.restore();
    }
  });
});

// ─── REGRESSION ──────────────────────────────────────────────────────────────

describe("lore evidence oracle precheck — REGRESSION", () => {
  it("AC-2.REG1: manual oracle with the same missing-file command is unaffected", async () => {
    const taskSlug = await seedTask();
    const cmd = await importEvidenceCommand();
    const spy = spyOnAddEvidence();
    try {
      await cmd.run({
        args: {
          task: taskSlug,
          oracle: "manual",
          command: "bunx vitest run does-not-exist.test.ts",
          result: "pass",
          by: "alice",
          "output-tail": "ok",
        },
 inv: liveInvocation(),
      });

      expect(spy.called()).toBe(true);
      expect(process.exitCode === 0 || process.exitCode === undefined).toBe(true);
    } finally {
      spy.restore();
    }
  });

  it("AC-2.REG2: result=fail with a missing referenced file is unaffected", async () => {
    const taskSlug = await seedTask();
    const cmd = await importEvidenceCommand();
    const spy = spyOnAddEvidence();
    try {
      await cmd.run({
        args: {
          task: taskSlug,
          oracle: "test",
          command: "bunx vitest run does-not-exist.test.ts",
          result: "fail",
          by: "alice",
          "output-tail": "AssertionError: expected 1 to equal 2",
        },
 inv: liveInvocation(),
      });

      expect(spy.called()).toBe(true);
      expect(process.exitCode === 0 || process.exitCode === undefined).toBe(true);
    } finally {
      spy.restore();
    }
  });
});
