/**
 * @spec_ref spec-spec-038-ac-as-code-structured-acceptance-criteria-oracle-b#AC-ACODE-3, spec-spec-038-ac-as-code-structured-acceptance-criteria-oracle-b#AC-ACODE-8
 *
 * `lore evidence --ac <id>` — adapter-boundary test for SPEC-038 §4/§7 D3.
 *
 * Scope: this file verifies the CLI's translation layer only — that --ac parses
 * and lands as `ac_ref` on the `EvidenceInput` object handed to
 * `TaskWorkflowService.addEvidence`. Whether the service *persists* or
 * *validates* ac_ref is T3's responsibility (SPEC-038 §4 D4, out of scope for
 * this adapter-only task) — asserting on the final persisted DocRecord would
 * couple this test to that not-yet-landed service change. Instead we intercept
 * the call at the adapter→service boundary via an instance-level method
 * override (the command is invoked in-process, unlike
 * tests/integration/cli/task-workflow.test.ts which spawns a subprocess and
 * cannot be spied on this way).
 *
 * Uses bun:sqlite (loadLoreApp → createApp → SQLiteStore) — bun test only.
 *
 * Six-dimension coverage:
 *   HAPPY:      --ac <id> is threaded through as ac_ref on the service call arg
 *   REGRESSION: omitting --ac leaves ac_ref absent from the service call arg
 *               (existing no-flag behavior unchanged)
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "fs";
import { join, resolve } from "path";
import { tmpdir } from "os";
import { createApp } from "../../../src/app.js";
import { TaskWorkflowService } from "../../../src/service/task-workflow-service.js";
import type { EvidenceInput } from "../../../src/service/task-workflow-service.js";
import type { CreateDocInput } from "@lore/core";
import { liveInvocation, liveAmbient, liveWriteContext, runHandlerForExit } from "../../live-invocation.js";
import type { Invocation } from "@lore/core";

import { ensureRequirementsDocId } from "../../helpers/parented-create.js";
// ─── Command type ─────────────────────────────────────────────────────────────

type RunnableCommand = {
  run: (ctx: { args: Record<string, unknown>; inv?: Invocation }) => Promise<void>;
};

async function importEvidenceCommand(): Promise<RunnableCommand> {
  const mod = await import("../../../src/adapters/cli/commands/evidence.js");
  const cmd = (mod as { default?: { run?: RunnableCommand["run"] } }).default;
  if (!cmd?.run) throw new Error("evidence command not exported");
  return cmd as RunnableCommand;
}

// ─── Fixture setup ─────────────────────────────────────────────────────────────

let tmpDir: string;
let originalCwd: string;
let taskSlug: string;

beforeEach(() => {
  tmpDir = resolve(mkdtempSync(join(tmpdir(), "lore-cli-evidence-ac-test-")));
  const loreDir = join(tmpDir, ".lore");
  mkdirSync(loreDir, { recursive: true });

  // Real SQLite DB (plan + task are seeded per-test via seedTask()).
  const app = createApp(join(loreDir, "lore.db"), undefined, liveAmbient(), liveWriteContext());
  app.close();

  originalCwd = process.cwd();
  process.chdir(tmpDir);
});

afterEach(() => {
  process.chdir(originalCwd);
  try {
    const { rmSync } = require("fs") as { rmSync: (p: string, opts: object) => void };
    rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    /* best-effort cleanup */
  }
});

/**
 * Seed a plan + task synchronously against the temp DB (separate short-lived
 * App instance from the one the evidence command will open via loadLoreApp).
 */
async function seedTask(): Promise<string> {
  const app = createApp(join(tmpDir, ".lore", "lore.db"), undefined, liveAmbient(), liveWriteContext());
  try {
    const planResult = await app.corpusService.create({
      parent_id: await ensureRequirementsDocId(app.corpusService), type: "plan",
      title: "AC Ref Test Plan",
      content: "body",
    } as CreateDocInput);
    if (!planResult.ok) throw new Error(`seed plan failed: ${JSON.stringify(planResult.error)}`);

    const taskResult = await app.corpusService.create({
      type: "task",
      title: "AC Ref Test Task",
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
 * Monkey-patches TaskWorkflowService.prototype.addEvidence to capture the
 * EvidenceInput argument the CLI command passes, then delegates to the
 * original implementation so the command still completes normally.
 * Restores the prototype method in the returned `restore()` callback.
 */
function spyOnAddEvidence(): {
  captured: () => EvidenceInput | undefined;
  restore: () => void;
} {
  const original = TaskWorkflowService.prototype.addEvidence;
  let capturedEntry: EvidenceInput | undefined;

  TaskWorkflowService.prototype.addEvidence = function (
    this: TaskWorkflowService,
    idOrSlug: string,
    entry: EvidenceInput,
    now?: () => string,
  ) {
    capturedEntry = entry;
    return original.call(this, idOrSlug, entry, now);
  } as typeof TaskWorkflowService.prototype.addEvidence;

  return {
    captured: () => capturedEntry,
    restore: () => {
      TaskWorkflowService.prototype.addEvidence = original;
    },
  };
}

// ─── HAPPY ───────────────────────────────────────────────────────────────────

describe("lore evidence --ac — HAPPY", () => {
  it("spec-spec-038-ac-as-code-structured-acceptance-criteria-oracle-b#AC-ACODE-3.H1: --ac <id> lands as ac_ref on the EvidenceInput passed to the service", async () => {
    taskSlug = await seedTask();
    const cmd = await importEvidenceCommand();
    const spy = spyOnAddEvidence();

    try {
      await runHandlerForExit(() => cmd.run({
        args: {
          task: taskSlug,
          oracle: "tsc",
          command: "bun run typecheck",
          result: "pass",
          by: "alice",
          ac: "AC-ACODE-8",
        },
 inv: liveInvocation(),
      }));

      expect(spy.captured()?.ac_ref).toBe("AC-ACODE-8");
    } finally {
      spy.restore();
    }
  });
});

// ─── REGRESSION ──────────────────────────────────────────────────────────────

describe("lore evidence --ac — REGRESSION", () => {
  it("spec-spec-038-ac-as-code-structured-acceptance-criteria-oracle-b#AC-ACODE-3.REG1: omitting --ac leaves ac_ref absent from the EvidenceInput (no default value)", async () => {
    taskSlug = await seedTask();
    const cmd = await importEvidenceCommand();
    const spy = spyOnAddEvidence();

    try {
      await runHandlerForExit(() => cmd.run({
        args: {
          task: taskSlug,
          oracle: "tsc",
          command: "cmd",
          result: "pass",
          by: "alice",
        },
 inv: liveInvocation(),
      }));

      const entry = spy.captured();
      expect(entry).toBeDefined();
      expect(entry && "ac_ref" in entry).toBe(false);
    } finally {
      spy.restore();
    }
  });
});
