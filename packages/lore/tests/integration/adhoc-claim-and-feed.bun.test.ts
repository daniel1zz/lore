/**
 * @spec_ref SPEC-069 (execution-time attestation floor + ad-hoc task channel);
 *   task-fix-spec-069-gap-adhoc-task-claim-structurally-impossible.
 *
 * bun test (not vitest): in-process CLI regression, same "import the command
 * module + call its exported `run()` against a real SQLite db in a throwaway
 * tmp corpus" harness `gate-p2-cross-tier.bun.test.ts` establishes — NOT a
 * `dist/lore` subprocess spawn (no rebuild required, and no risk of tripping
 * the `g4-task-claim.sh` PreToolUse hook, which only intercepts actual Bash
 * tool-call strings containing `lore claim`, never an in-process module call).
 *
 * ⛔ Never touches the repo's own `.lore/` corpus — every test operates inside
 * its own `mkdtempSync` directory (project CLAUDE.md hard rule).
 *
 * Root cause under test: `TaskWorkflowService.enforceClaimGate` / `gate.ts`'s
 * `runTaskClaimGate` / `task-feed-wiring.ts`'s `buildTaskBundle` all called
 * `CorpusService.getPlanBundle(task.parent_id)` unconditionally once
 * `parent_id !== null`. A SPEC-069 `--adhoc` task's `parent_id` is the root PRD
 * (auto-parented, non-null, but `type: "prd"` not `"plan"`) — `getPlanBundle`
 * hard-fails with `{code: "VALIDATION_ERROR", field: "type"}` for that shape,
 * making an ad-hoc task structurally unclaimable and un-feedable. The fix
 * (`checkpoint-registry.ts::isNonPlanParentError`) routes that SPECIFIC failure
 * through the SAME "no governing plan" vacuous-pass treatment `parent_id ===
 * null` already gets.
 *
 * Coverage dimensions:
 *   HAPPY      — AC-1: `lore claim <adhoc-task> --by x --worktree y` exits 0.
 *                AC-4: `lore feed task-start <adhoc-task>` exits 0 (does not
 *                crash with the pre-fix "Expected a plan document" error).
 *                `lore gate task-claim --task <adhoc-task>` (the CLI pre-flight
 *                gate `gate.ts` also fixes) exits 0.
 *   STATE      — AC-3: a SECOND ad-hoc task sharing a declared file anchor,
 *                claimed by a DIFFERENT actor while the first claim is fresh,
 *                is BLOCKED (exit 4) — proves `noAnchorOverlap` runs
 *                UNCONDITIONALLY for ad-hoc tasks (SPEC-042), not silently
 *                vacuous-passed alongside the upstream-spec check.
 *   REGRESSION — a task-claim gate scenario with a REAL plan-parented task
 *                (not ad-hoc) still passes exactly as before this fix — the
 *                `getPlanBundle`-succeeds branch is untouched.
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync } from "fs";
import { join, resolve } from "path";
import { tmpdir } from "os";
import { createApp } from "../../src/app.js";
import type { CreateDocInput } from "@lore/core";

// ─── Command import + invocation helpers (mirrors gate-p2-cross-tier.bun.test.ts) ──

type RunnableCommand = { run: (ctx: { args: Record<string, unknown> }) => Promise<void> };

async function importDefaultCommand(modulePath: string): Promise<RunnableCommand> {
  const mod = await import(modulePath);
  const cmd = (mod as { default?: RunnableCommand }).default;
  if (cmd?.run === undefined) throw new Error(`${modulePath} has no default run() export`);
  return cmd;
}

async function importGateTaskClaimSubCommand(): Promise<RunnableCommand> {
  const mod = await import("../../src/adapters/cli/commands/gate.js");
  const group = (mod as { default?: { subCommands?: Record<string, unknown> } }).default;
  const cmd = group?.subCommands?.["task-claim"] as { run?: RunnableCommand["run"] } | undefined;
  if (cmd?.run === undefined) throw new Error("gate task-claim command not exported");
  return cmd as RunnableCommand;
}

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
let originalGateBypass: string | undefined;

beforeEach(() => {
  process.exitCode = 0;
  originalGateBypass = process.env["LORE_GATE_BYPASS"];
  delete process.env["LORE_GATE_BYPASS"];
  tmpDir = resolve(mkdtempSync(join(tmpdir(), "lore-adhoc-claim-feed-test-")));
  const loreDir = join(tmpDir, ".lore");
  mkdirSync(loreDir, { recursive: true });

  const app = createApp(join(loreDir, "lore.db"));
  app.close();

  originalCwd = process.cwd();
  process.chdir(tmpDir);
});

afterEach(() => {
  process.exitCode = 0;
  if (originalGateBypass === undefined) delete process.env["LORE_GATE_BYPASS"];
  else process.env["LORE_GATE_BYPASS"] = originalGateBypass;
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

async function createRootPrd(): Promise<{ prdId: string }> {
  const app = createApp(dbPath());
  try {
    const prdResult = await app.corpusService.create({
      type: "prd",
      title: "Adhoc Claim Fix Test PRD",
      content: "PRD body.",
    } as CreateDocInput);
    if (!prdResult.ok) throw new Error(`prd create failed: ${JSON.stringify(prdResult.error)}`);
    return { prdId: prdResult.value.id };
  } finally {
    app.close();
  }
}

/** Creates a SPEC-069 `--adhoc` task (no --parent/--plan-id; auto-parents to the root PRD). */
async function createAdhocTask(
  title: string,
  anchors?: string[],
): Promise<{ taskId: string; taskSlug: string }> {
  const app = createApp(dbPath());
  try {
    const taskResult = await app.corpusService.create({
      type: "task",
      title,
      content: `# ${title}`,
      extra: { adhoc: true, ...(anchors !== undefined ? { file_anchors: anchors } : {}) },
    } as CreateDocInput);
    if (!taskResult.ok) throw new Error(`adhoc task create failed: ${JSON.stringify(taskResult.error)}`);
    return { taskId: taskResult.value.id, taskSlug: taskResult.value.slug };
  } finally {
    app.close();
  }
}

/** Creates a REAL plan-parented (non-ad-hoc) task, for the regression check. */
async function createPlanParentedTask(): Promise<{ taskId: string; taskSlug: string }> {
  const app = createApp(dbPath());
  try {
    const planResult = await app.corpusService.create({
      type: "plan",
      title: "Adhoc Fix Regression Plan",
      content: "# Plan",
    } as CreateDocInput);
    if (!planResult.ok) throw new Error(`plan create failed: ${JSON.stringify(planResult.error)}`);
    const taskResult = await app.corpusService.create({
      type: "task",
      title: "Adhoc Fix Regression Task",
      parent_id: planResult.value.id,
      content: "# Task",
      extra: { plan_id: planResult.value.id },
    } as CreateDocInput);
    if (!taskResult.ok) throw new Error(`task create failed: ${JSON.stringify(taskResult.error)}`);
    return { taskId: taskResult.value.id, taskSlug: taskResult.value.slug };
  } finally {
    app.close();
  }
}

// ─── Tests ─────────────────────────────────────────────────────────────────

describe("SPEC-069 ad-hoc task claim gap fix", () => {
  it("AC-1 / HAPPY: `lore claim <adhoc-task> --by x --worktree y` exits 0", async () => {
    await createRootPrd();
    const { taskSlug } = await createAdhocTask("Adhoc Task One");

    const claimCmd = await importDefaultCommand("../../src/adapters/cli/commands/claim.js");
    const output = captureOutput();
    try {
      await claimCmd.run({ args: { task: taskSlug, by: "agent:x", worktree: "wt-adhoc-1" } });
    } finally {
      output.restore();
    }

    expect(process.exitCode).toBe(0);
    expect(output.stdout.join("\n")).toContain("Claimed");
    expect(output.stderr.join("\n")).toBe("");
  });

  it("HAPPY: `lore gate task-claim --task <adhoc-task> --by x` (CLI pre-flight gate) exits 0", async () => {
    await createRootPrd();
    const { taskSlug } = await createAdhocTask("Adhoc Task Gate Parity");

    const gateCmd = await importGateTaskClaimSubCommand();
    const output = captureOutput();
    try {
      await gateCmd.run({ args: { task: taskSlug, by: "agent:x" } });
    } finally {
      output.restore();
    }

    expect(process.exitCode).toBe(0);
    expect(output.stdout.join("\n")).toContain("gate: pass");
  });

  it("AC-4 / HAPPY: `lore feed task-start <adhoc-task>` exits 0 (does not crash on the old root cause)", async () => {
    await createRootPrd();
    const { taskSlug } = await createAdhocTask("Adhoc Task Feed Start");

    // `feed.ts` calls the zero-arg `resolveActor()` unconditionally (SPEC-102 trace
    // recording), so its result — and, on an OS-fallback resolution, an stderr
    // ADVISORY — depends on the full `--by` > `$LORE_ACTOR` > session-tier
    // (`$CLAUDE_CODE_SESSION_ID`/`$CLAUDE_SESSION_ID`) > worktree > OS-username
    // precedence chain (task-a-test-s-green-depends-on-an-ambient-claude-code-session
    // sibling finding: this test's `expect(stderr).toBe("")` silently depended on the
    // invoking shell's ambient session var routing resolution through the QUIET
    // session tier; absent it, resolution falls through to the OS-fallback tier,
    // which prints the advisory this assertion does not expect). Pin `$LORE_ACTOR`
    // explicitly — it outranks the session tier — so the actor tier, and therefore
    // the empty-stderr assertion, is constructed rather than inherited.
    const originalLoreActor = process.env["LORE_ACTOR"];
    process.env["LORE_ACTOR"] = "agent:adhoc-claim-and-feed-test";

    const feedCmd = await importDefaultCommand("../../src/adapters/cli/commands/feed.js");
    const output = captureOutput();
    try {
      await feedCmd.run({ args: { checkpoint: "task-start", target: taskSlug } });
    } finally {
      output.restore();
      if (originalLoreActor === undefined) delete process.env["LORE_ACTOR"];
      else process.env["LORE_ACTOR"] = originalLoreActor;
    }

    expect(process.exitCode).toBe(0);
    const stdout = output.stdout.join("\n");
    expect(stdout).toContain("Adhoc Task Feed Start");
    // reason: NO_GOVERNING_PLAN_SENTINEL (task-feed-wiring.ts) — proves the
    // degraded-but-non-fatal "no governing plan" path actually ran, not a
    // coincidental empty-plan-slug render.
    expect(stdout).toContain("no governing plan");
    expect(output.stderr.join("\n")).toBe("");
  });

  it("AC-3 / STATE: noAnchorOverlap still fires for two ad-hoc tasks sharing a fresh-claimed anchor", async () => {
    await createRootPrd();
    const { taskSlug: taskOneSlug } = await createAdhocTask("Adhoc Anchor Task One", ["src/shared-module.ts"]);
    const { taskSlug: taskTwoSlug } = await createAdhocTask("Adhoc Anchor Task Two", ["src/shared-module.ts"]);

    const claimCmd = await importDefaultCommand("../../src/adapters/cli/commands/claim.js");

    // First claim (agent:one) succeeds — establishes the fresh sibling claim.
    const firstOutput = captureOutput();
    try {
      await claimCmd.run({ args: { task: taskOneSlug, by: "agent:one", worktree: "wt-one" } });
    } finally {
      firstOutput.restore();
    }
    expect(process.exitCode).toBe(0);

    // Second claim (agent:two), overlapping anchor, DIFFERENT actor → must be BLOCKED.
    process.exitCode = 0;
    const secondOutput = captureOutput();
    try {
      await claimCmd.run({ args: { task: taskTwoSlug, by: "agent:two", worktree: "wt-two" } });
    } finally {
      secondOutput.restore();
    }

    expect(process.exitCode).toBe(4);
    expect(secondOutput.stderr.join("\n")).toContain("gate:task-claim");
  });

  it("REGRESSION: a REAL plan-parented (non-ad-hoc) task still claims exactly as before this fix", async () => {
    const { taskSlug } = await createPlanParentedTask();

    const claimCmd = await importDefaultCommand("../../src/adapters/cli/commands/claim.js");
    const output = captureOutput();
    try {
      await claimCmd.run({ args: { task: taskSlug, by: "agent:regression", worktree: "wt-regression" } });
    } finally {
      output.restore();
    }

    expect(process.exitCode).toBe(0);
    expect(output.stdout.join("\n")).toContain("Claimed");
  });
});
