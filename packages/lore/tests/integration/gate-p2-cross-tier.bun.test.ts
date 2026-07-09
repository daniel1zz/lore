/**
 * @spec_ref IoC vertical-slice tech-spec §4.1/§5.1/§11 — `lore gate plan-promote` /
 * `lore gate task-claim` (the two commit-time cross-tier gates)
 *
 * bun test (not vitest) — uses a real SQLiteStore via `createApp()`, same in-process
 * pattern as `gate-spec-promote.bun.test.ts`: chdir into a throwaway temp corpus,
 * import the gate command module directly, and call its `plan-promote` / `task-claim`
 * subcommand's `run()` in the SAME process.
 *
 * ⛔ Never touches the repo's own `.lore/` corpus (project CLAUDE.md hard rule) — every
 * test operates inside its own `mkdtempSync` directory.
 *
 * Acceptance criteria under test (task's AC-P2-2 .. AC-P2-6):
 *   AC-P2-2 — plan-promote, parent spec "draft" → exit 4 + "upstream spec not
 *             approved"-type message.
 *   AC-P2-3 — plan-promote, parent spec "approved" but 0 AC → exit 4 + "no AC"-type
 *             message.
 *   AC-P2-4 — plan-promote, parent spec "approved" + ≥1 AC → exit 0.
 *   AC-P2-5 — task-claim, plan's parent spec unapproved → exit 4; spec approved → exit 0.
 *   AC-P2-6 — plan parented under a "prd" (no spec tier) → plan-promote exit 0; a task
 *             under such a plan → task-claim exit 0.
 *   AC-P2-SOFTDEL (adversarial-review FIX 3) — the ancestor spec is APPROVED with ≥1 AC
 *             (i.e. would otherwise PASS both gates) but has been soft-deleted
 *             (`lore delete --confirm`, which never touches `status`) → plan-promote
 *             AND task-claim must both BLOCK (exit 4, reason UPSTREAM_DELETED), never
 *             silently pass. A soft-deleted upstream is a WITHDRAWN spec-tier
 *             ancestor, not the "no spec tier at all" vacuous-pass case (AC-P2-6) —
 *             `hasSpecParent` must still be `true`.
 *
 * Coverage dimensions: HAPPY / NEGATIVE / BOUNDARY / ERROR / STATE / REGRESSION.
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync } from "fs";
import { join, resolve } from "path";
import { tmpdir } from "os";
import { createApp } from "../../src/app.js";
import type { CreateDocInput } from "@lore/core";

// ─── Command type (mirrors gate-spec-promote.bun.test.ts) ────────────────────

type RunnableCommand = { run: (ctx: { args: Record<string, unknown> }) => Promise<void> };

async function importGateSubCommand(name: "plan-promote" | "task-claim"): Promise<RunnableCommand> {
  const mod = await import("../../src/adapters/cli/commands/gate.js");
  const group = (mod as { default?: { subCommands?: Record<string, unknown> } }).default;
  const cmd = group?.subCommands?.[name] as { run?: RunnableCommand["run"] } | undefined;
  if (!cmd?.run) throw new Error(`gate ${name} command not exported`);
  return cmd as RunnableCommand;
}

// ─── Output / exit capture ────────────────────────────────────────────────────

function captureOutput() {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const origStderrWrite = process.stderr.write.bind(process.stderr);
  const origConsoleLog = console.log.bind(console);

  (process.stderr as unknown as { write: (chunk: unknown) => boolean }).write = (chunk: unknown) => {
    stderr.push(String(chunk));
    return true;
  };
  console.log = (...args: unknown[]) => {
    stdout.push(args.join(" "));
  };

  return {
    stdout,
    stderr,
    restore: () => {
      (process.stderr as unknown as { write: typeof origStderrWrite }).write = origStderrWrite;
      console.log = origConsoleLog;
    },
  };
}

// ─── Project setup ────────────────────────────────────────────────────────────

let tmpDir: string;
let originalCwd: string;
let originalEnv: string | undefined;

beforeEach(() => {
  process.exitCode = 0;
  originalEnv = process.env["LORE_GATE_BYPASS"];
  delete process.env["LORE_GATE_BYPASS"];
  tmpDir = resolve(mkdtempSync(join(tmpdir(), "lore-gate-p2-cross-tier-test-")));
  const loreDir = join(tmpDir, ".lore");
  mkdirSync(loreDir, { recursive: true });

  const app = createApp(join(loreDir, "lore.db"));
  app.close();

  originalCwd = process.cwd();
  process.chdir(tmpDir);
});

afterEach(() => {
  process.exitCode = 0;
  if (originalEnv === undefined) delete process.env["LORE_GATE_BYPASS"];
  else process.env["LORE_GATE_BYPASS"] = originalEnv;
  process.chdir(originalCwd);
  try {
    rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    // best-effort
  }
});

function dbPath(): string {
  return join(tmpDir, ".lore", "lore.db");
}

// ─── Fixture helpers ──────────────────────────────────────────────────────────

/**
 * Creates a PRD → spec (draft, no AC) → plan chain. Returns every id/slug the tests
 * need. The spec is left in "draft" unless the caller approves it via `approveSpec`.
 */
async function createSpecParentedPlan(): Promise<{
  specId: string;
  specSlug: string;
  planId: string;
  planSlug: string;
}> {
  const app = createApp(dbPath());
  try {
    const prdResult = await app.corpusService.create({
      type: "prd",
      title: "Gate P2 PRD",
      content: "PRD body for gate P2 cross-tier tests.",
    } as CreateDocInput);
    if (!prdResult.ok) throw new Error(`prd create failed: ${JSON.stringify(prdResult.error)}`);

    const specResult = await app.corpusService.create({
      type: "spec",
      title: "Gate P2 Target Spec",
      parent_id: prdResult.value.id,
      content: "## Overview\n\nSpec body for gate P2 cross-tier tests.\n",
    } as CreateDocInput);
    if (!specResult.ok) throw new Error(`spec create failed: ${JSON.stringify(specResult.error)}`);

    const planResult = await app.corpusService.create({
      type: "plan",
      title: "Gate P2 Plan",
      parent_id: specResult.value.id,
      content: "Plan body.",
    } as CreateDocInput);
    if (!planResult.ok) throw new Error(`plan create failed: ${JSON.stringify(planResult.error)}`);

    return {
      specId: specResult.value.id,
      specSlug: specResult.value.slug,
      planId: planResult.value.id,
      planSlug: planResult.value.slug,
    };
  } finally {
    app.close();
  }
}

/** Creates a plan parented directly under a PRD (no spec tier). */
async function createPrdParentedPlan(): Promise<{ planId: string; planSlug: string }> {
  const app = createApp(dbPath());
  try {
    const prdResult = await app.corpusService.create({
      type: "prd",
      title: "Gate P2 No-Spec PRD",
      content: "PRD body.",
    } as CreateDocInput);
    if (!prdResult.ok) throw new Error(`prd create failed: ${JSON.stringify(prdResult.error)}`);

    const planResult = await app.corpusService.create({
      type: "plan",
      title: "Gate P2 No-Spec Plan",
      parent_id: prdResult.value.id,
      content: "Plan body.",
    } as CreateDocInput);
    if (!planResult.ok) throw new Error(`plan create failed: ${JSON.stringify(planResult.error)}`);

    return { planId: planResult.value.id, planSlug: planResult.value.slug };
  } finally {
    app.close();
  }
}

/** Creates a task under `planId`, per SPEC-025's parent_id + extra.plan_id contract. */
async function createTask(planId: string): Promise<{ taskId: string; taskSlug: string }> {
  const app = createApp(dbPath());
  try {
    const taskResult = await app.corpusService.create({
      type: "task",
      title: "Gate P2 Task",
      parent_id: planId,
      content: "Task body.",
      extra: { plan_id: planId },
    } as CreateDocInput);
    if (!taskResult.ok) throw new Error(`task create failed: ${JSON.stringify(taskResult.error)}`);
    return { taskId: taskResult.value.id, taskSlug: taskResult.value.slug };
  } finally {
    app.close();
  }
}

/** Fast-tracks a doc from draft straight to approved (SPEC-002 §3 valid transition). */
async function approveDoc(id: string): Promise<void> {
  const app = createApp(dbPath());
  try {
    const result = await app.reviewService.approve(id);
    if (!result.ok) throw new Error(`approve failed: ${JSON.stringify(result.error)}`);
  } finally {
    app.close();
  }
}

/**
 * Soft-deletes a doc via `CorpusService.delete` (confirm=true) — `softDelete` never
 * touches `status`, which is exactly the false-allow FIX 3 closes: a soft-deleted
 * `approved` spec must still block `plan-promote`/`task-claim`, not silently pass
 * because its `status` column still reads "approved".
 */
async function softDeleteDoc(id: string): Promise<void> {
  const app = createApp(dbPath());
  try {
    const result = await app.corpusService.delete(id, true);
    if (!result.ok) throw new Error(`delete failed: ${JSON.stringify(result.error)}`);
  } finally {
    app.close();
  }
}

/** Adds one structured acceptance criterion (verify.mode=human — simplest valid shape). */
async function addAcceptanceCriterion(specId: string, id = "AC-P2-1"): Promise<void> {
  const app = createApp(dbPath());
  try {
    if (app.acService === undefined) throw new Error("AcService not wired");
    const result = await app.acService.addCriterion(specId, {
      id,
      statement: "The gated behaviour works as declared.",
      verify: { mode: "human" },
    });
    if (!result.ok) throw new Error(`addCriterion failed: ${JSON.stringify(result.error)}`);
  } finally {
    app.close();
  }
}

// ─── AC-P2-2 (NEGATIVE): plan-promote, parent spec draft → exit 4 ────────────

describe("lore gate plan-promote — AC-P2-2: ancestor spec not approved", () => {
  it("exits 4 with an 'upstream spec not approved'-type message when the ancestor spec is draft", async () => {
    const { planSlug } = await createSpecParentedPlan();

    const cmd = await importGateSubCommand("plan-promote");
    const output = captureOutput();
    try {
      await cmd.run({ args: { plan: planSlug } });
    } finally {
      output.restore();
    }

    expect(process.exitCode).toBe(4);
    const stdoutText = output.stdout.join("\n");
    expect(stdoutText).toContain("UPSTREAM_NOT_APPROVED");
    expect(stdoutText.toLowerCase()).toContain("approved");
  });
});

// ─── AC-P2-3 (NEGATIVE): plan-promote, approved spec but 0 AC → exit 4 ───────

describe("lore gate plan-promote — AC-P2-3: ancestor spec approved but 0 acceptance criteria", () => {
  it("exits 4 with a 'no AC'-type message when the approved ancestor spec declares zero AC", async () => {
    const { specId, planSlug } = await createSpecParentedPlan();
    await approveDoc(specId);

    const cmd = await importGateSubCommand("plan-promote");
    const output = captureOutput();
    try {
      await cmd.run({ args: { plan: planSlug } });
    } finally {
      output.restore();
    }

    expect(process.exitCode).toBe(4);
    const stdoutText = output.stdout.join("\n");
    expect(stdoutText).toContain("UPSTREAM_NO_AC");
  });
});

// ─── AC-P2-4 (HAPPY): plan-promote, approved spec + ≥1 AC → exit 0 ───────────

describe("lore gate plan-promote — AC-P2-4: ancestor spec approved with ≥1 acceptance criterion", () => {
  it("exits 0 and prints 'gate: pass'", async () => {
    const { specId, planSlug } = await createSpecParentedPlan();
    await approveDoc(specId);
    await addAcceptanceCriterion(specId);

    const cmd = await importGateSubCommand("plan-promote");
    const output = captureOutput();
    try {
      await cmd.run({ args: { plan: planSlug } });
    } finally {
      output.restore();
    }

    expect(process.exitCode).toBe(0);
    const stdoutText = output.stdout.join("\n");
    expect(stdoutText).toContain("gate: pass");
  });
});

// ─── AC-P2-5 (HAPPY + NEGATIVE): task-claim vs. plan's ancestor spec status ──

describe("lore gate task-claim — AC-P2-5: plan's ancestor spec approval status", () => {
  it("exits 4 when the plan's ancestor spec is unapproved", async () => {
    const { planId, planSlug: _planSlug } = await createSpecParentedPlan();
    const { taskSlug } = await createTask(planId);

    const cmd = await importGateSubCommand("task-claim");
    const output = captureOutput();
    try {
      await cmd.run({ args: { task: taskSlug } });
    } finally {
      output.restore();
    }

    expect(process.exitCode).toBe(4);
    const stdoutText = output.stdout.join("\n");
    expect(stdoutText).toContain("UPSTREAM_NOT_APPROVED");
  });

  it("exits 0 when the plan's ancestor spec is approved", async () => {
    const { specId, planId } = await createSpecParentedPlan();
    await approveDoc(specId);
    const { taskSlug } = await createTask(planId);

    const cmd = await importGateSubCommand("task-claim");
    const output = captureOutput();
    try {
      await cmd.run({ args: { task: taskSlug } });
    } finally {
      output.restore();
    }

    expect(process.exitCode).toBe(0);
    const stdoutText = output.stdout.join("\n");
    expect(stdoutText).toContain("gate: pass");
  });
});

// ─── AC-P2-6 (BOUNDARY): no spec tier ⇒ vacuous pass ──────────────────────────

describe("lore gate — AC-P2-6: no spec-tier ancestor passes vacuously", () => {
  it("plan-promote exits 0 for a plan parented directly under a prd", async () => {
    const { planSlug } = await createPrdParentedPlan();

    const cmd = await importGateSubCommand("plan-promote");
    const output = captureOutput();
    try {
      await cmd.run({ args: { plan: planSlug } });
    } finally {
      output.restore();
    }

    expect(process.exitCode).toBe(0);
    expect(output.stdout.join("\n")).toContain("gate: pass");
  });

  it("task-claim exits 0 for a task whose plan is parented directly under a prd", async () => {
    const { planId } = await createPrdParentedPlan();
    const { taskSlug } = await createTask(planId);

    const cmd = await importGateSubCommand("task-claim");
    const output = captureOutput();
    try {
      await cmd.run({ args: { task: taskSlug } });
    } finally {
      output.restore();
    }

    expect(process.exitCode).toBe(0);
    expect(output.stdout.join("\n")).toContain("gate: pass");
  });
});

// ─── ERROR / NEGATIVE: doc resolution failures ───────────────────────────────

describe("lore gate plan-promote / task-claim — doc resolution failures", () => {
  it("ERROR: plan-promote exits 3 (DOC_NOT_FOUND) when the plan does not resolve", async () => {
    await createSpecParentedPlan(); // ensure the corpus isn't empty, unrelated to the lookup below

    const cmd = await importGateSubCommand("plan-promote");
    const output = captureOutput();
    try {
      await cmd.run({ args: { plan: "does-not-exist-slug" } });
    } finally {
      output.restore();
    }

    expect(process.exitCode).toBe(3);
  });

  it("NEGATIVE: plan-promote exits 4 (VALIDATION_ERROR) when the target is not a plan", async () => {
    const { specSlug } = await createSpecParentedPlan();

    const cmd = await importGateSubCommand("plan-promote");
    const output = captureOutput();
    try {
      await cmd.run({ args: { plan: specSlug } });
    } finally {
      output.restore();
    }

    expect(process.exitCode).toBe(4);
  });

  it("ERROR: task-claim exits 3 (DOC_NOT_FOUND) when the task does not resolve", async () => {
    const { planId } = await createSpecParentedPlan();
    await createTask(planId); // ensure the corpus isn't empty, unrelated to the lookup below

    const cmd = await importGateSubCommand("task-claim");
    const output = captureOutput();
    try {
      await cmd.run({ args: { task: "does-not-exist-slug" } });
    } finally {
      output.restore();
    }

    expect(process.exitCode).toBe(3);
  });

  it("NEGATIVE: task-claim exits 4 (VALIDATION_ERROR) when the target is not a task", async () => {
    const { planSlug } = await createSpecParentedPlan();

    const cmd = await importGateSubCommand("task-claim");
    const output = captureOutput();
    try {
      await cmd.run({ args: { task: planSlug } });
    } finally {
      output.restore();
    }

    expect(process.exitCode).toBe(4);
  });
});

// ─── STATE: LORE_GATE_BYPASS=1 ────────────────────────────────────────────────

describe("lore gate plan-promote / task-claim — STATE: LORE_GATE_BYPASS=1", () => {
  it("plan-promote exits 0 even with an unapproved ancestor spec, when bypassed", async () => {
    const { planSlug } = await createSpecParentedPlan();
    process.env["LORE_GATE_BYPASS"] = "1";

    const cmd = await importGateSubCommand("plan-promote");
    const output = captureOutput();
    try {
      await cmd.run({ args: { plan: planSlug } });
    } finally {
      output.restore();
      delete process.env["LORE_GATE_BYPASS"];
    }

    expect(process.exitCode).toBe(0);
  });

  it("task-claim exits 0 even with an unapproved ancestor spec, when bypassed", async () => {
    const { planId } = await createSpecParentedPlan();
    const { taskSlug } = await createTask(planId);
    process.env["LORE_GATE_BYPASS"] = "1";

    const cmd = await importGateSubCommand("task-claim");
    const output = captureOutput();
    try {
      await cmd.run({ args: { task: taskSlug } });
    } finally {
      output.restore();
      delete process.env["LORE_GATE_BYPASS"];
    }

    expect(process.exitCode).toBe(0);
  });
});

// ─── AC-P2-SOFTDEL (NEGATIVE): soft-deleted ancestor spec blocks both gates ───

describe("lore gate plan-promote / task-claim — AC-P2-SOFTDEL: soft-deleted ancestor spec", () => {
  it("plan-promote exits 4 (UPSTREAM_DELETED) when the approved+AC ancestor spec was soft-deleted", async () => {
    const { specId, planSlug } = await createSpecParentedPlan();
    await approveDoc(specId);
    await addAcceptanceCriterion(specId);

    // Sanity: before the soft-delete, this exact plan would PASS (same fixture
    // shape as AC-P2-4). Confirms the block below is caused by deletion, not by
    // some other unrelated fixture mistake.
    const preCmd = await importGateSubCommand("plan-promote");
    let output = captureOutput();
    try {
      await preCmd.run({ args: { plan: planSlug } });
    } finally {
      output.restore();
    }
    expect(process.exitCode).toBe(0);

    await softDeleteDoc(specId);

    const cmd = await importGateSubCommand("plan-promote");
    output = captureOutput();
    try {
      await cmd.run({ args: { plan: planSlug } });
    } finally {
      output.restore();
    }

    expect(process.exitCode).toBe(4);
    const stdoutText = output.stdout.join("\n");
    expect(stdoutText).toContain("UPSTREAM_DELETED");
  });

  it("task-claim exits 4 (UPSTREAM_DELETED) when the plan's approved+AC ancestor spec was soft-deleted", async () => {
    const { specId, planId } = await createSpecParentedPlan();
    await approveDoc(specId);
    await addAcceptanceCriterion(specId);
    const { taskSlug } = await createTask(planId);

    const preCmd = await importGateSubCommand("task-claim");
    let output = captureOutput();
    try {
      await preCmd.run({ args: { task: taskSlug } });
    } finally {
      output.restore();
    }
    expect(process.exitCode).toBe(0);

    await softDeleteDoc(specId);

    const cmd = await importGateSubCommand("task-claim");
    output = captureOutput();
    try {
      await cmd.run({ args: { task: taskSlug } });
    } finally {
      output.restore();
    }

    expect(process.exitCode).toBe(4);
    const stdoutText = output.stdout.join("\n");
    expect(stdoutText).toContain("UPSTREAM_DELETED");
  });

  it("BOUNDARY: a soft-deleted spec is NOT treated as 'no spec tier' — it still blocks, it does not vacuously pass", async () => {
    // Regression guard for the correct-semantics requirement in the fix task: a
    // soft-deleted upstream must not fall through to AC-P2-6's vacuous-pass path.
    const { specId, planSlug } = await createSpecParentedPlan();
    await approveDoc(specId);
    await addAcceptanceCriterion(specId);
    await softDeleteDoc(specId);

    const cmd = await importGateSubCommand("plan-promote");
    const output = captureOutput();
    try {
      await cmd.run({ args: { plan: planSlug } });
    } finally {
      output.restore();
    }

    expect(process.exitCode).not.toBe(0);
    expect(process.exitCode).toBe(4);
  });
});

// ─── REGRESSION: plan-promote / task-claim agree with each other on the same spec ──

describe("lore gate — REGRESSION: plan-promote and task-claim agree on the same ancestor spec", () => {
  it("both gates block while the spec is draft, and both pass once it is approved with AC", async () => {
    const { specId, planId, planSlug } = await createSpecParentedPlan();
    const { taskSlug } = await createTask(planId);

    const planCmd = await importGateSubCommand("plan-promote");
    const taskCmd = await importGateSubCommand("task-claim");

    // -- both blocked while draft --
    let output = captureOutput();
    try {
      await planCmd.run({ args: { plan: planSlug } });
    } finally {
      output.restore();
    }
    expect(process.exitCode).toBe(4);

    output = captureOutput();
    try {
      await taskCmd.run({ args: { task: taskSlug } });
    } finally {
      output.restore();
    }
    expect(process.exitCode).toBe(4);

    // -- approve the spec + add AC: plan-promote passes, task-claim passes --
    await approveDoc(specId);
    await addAcceptanceCriterion(specId);

    output = captureOutput();
    try {
      await planCmd.run({ args: { plan: planSlug } });
    } finally {
      output.restore();
    }
    expect(process.exitCode).toBe(0);

    output = captureOutput();
    try {
      await taskCmd.run({ args: { task: taskSlug } });
    } finally {
      output.restore();
    }
    expect(process.exitCode).toBe(0);
  });
});
