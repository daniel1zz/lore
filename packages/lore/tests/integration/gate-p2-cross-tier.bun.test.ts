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

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, rmSync } from "fs";
import { join, resolve } from "path";
import { tmpdir } from "os";
import { createApp, type App } from "../../src/app.js";
import { SQLiteStore } from "../../src/store/sqlite-store.js";
import type { CreateDocInput, LoreConfig, RunId } from "@lore/core";
import { asSessionActor, sessionIdFor } from "../helpers/session-actor";
import { resolveActor } from "../../src/adapters/cli/utils.js";
import { liveInvocation, liveAmbient, liveWriteContext, actedStore, runHandlerForExit, liveIo, LIVE_TEST_RUN } from "../live-invocation.js";

/** The exit code the most recent command call ended with (commands return it; none sets `process.exitCode`). */
let lastExitCode = 0;
import type { Invocation } from "@lore/core";

/**
 * Constructs a fixture-only App with ALL FOUR `lore gate` service-layer checkpoints
 * disabled (retro follow-up item 8 test-fallout reconciliation). This file's fixture
 * helpers (`createSpecParentedPlan`, `approveDoc`, etc.) intentionally construct docs
 * in states the checkpoints themselves would now reject at write time — e.g. AC-P2-3
 * needs to approve a spec with ZERO declared acceptance criteria, to prove
 * `plan-promote`'s OWN downstream AC check (not spec-promote's) is what blocks the
 * plan. GateEnforcer being wired ON by default in `createApp` would otherwise make
 * that "approved, 0 AC" state unreachable via `reviewService.approve` here.
 *
 * This does NOT weaken what this file actually tests: `lore gate plan-promote` /
 * `lore gate task-claim` (the CLI commands under test, invoked via
 * `importGateSubCommand`) resolve their OWN config through `loadLoreApp()` reading
 * `.lore/config.yaml` from disk — a config this file never writes, so those commands'
 * checkpoints stay fully enabled. Only the IN-PROCESS fixture-construction App
 * (`corpusService.create` / `reviewService.approve` / etc., used purely to build doc
 * state before the CLI command under test runs) is gate-disabled here.
 *
 * `sync` is absent, so `createApp` always returns a bare `App` (never `Result<App>`)
 * for this config — see `createApp`'s own JSDoc branch table in `app.ts`.
 */
function createFixtureApp(path: string): App {
  const config = {
    project: { name: "gate-p2-cross-tier-fixture", author: "tester" },
    workflow: {
      claim_ttl_minutes: 120,
      gates: {
        "spec-create": { enabled: false },
        "spec-promote": { enabled: false },
        "plan-promote": { enabled: false },
        "task-claim": { enabled: false },
      },
      // SPEC-103 §Mechanisms M2 — `review-judgment` is a SEPARATE checkpoint from the
      // four `gates.*` entries above (predates this fixture); this file's `approveDoc`
      // helper fast-tracks docs to `approved` purely as SETUP state for plan-promote/
      // task-claim scenarios this file actually tests, so M2 is disabled here too —
      // otherwise every `approveDoc` call on a spec would need a seeded judgment for a
      // concern this file was never testing.
      review: { judgment_required_types: [] },
    },
  } as unknown as LoreConfig;
  return createApp(path, config, liveAmbient(), liveWriteContext()) as App;
}

// ─── Command type (mirrors gate-spec-promote.bun.test.ts) ────────────────────

type RunnableCommand = { run: (ctx: { args: Record<string, unknown>; inv?: Invocation }) => Promise<void> };

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
  const origConsoleLog = process.stdout.write;

  (process.stderr as unknown as { write: (chunk: unknown) => boolean }).write = (chunk: unknown) => {
    stderr.push(String(chunk));
    return true;
  };
  process.stdout.write = (((chunk: unknown) => {
    const args: unknown[] = [String(chunk).replace(/\n$/, "")];
    stdout.push(args.join(" "));
  
    return true;
  }) as typeof process.stdout.write);

  return {
    stdout,
    stderr,
    restore: () => {
      (process.stderr as unknown as { write: typeof origStderrWrite }).write = origStderrWrite;
      process.stdout.write = origConsoleLog;
    },
  };
}

// ─── Project setup ────────────────────────────────────────────────────────────

let tmpDir: string;
let originalCwd: string;
let originalEnv: string | undefined;

/**
 * Ambient-state hygiene (task-a-test-s-green-depends-on-an-ambient-claude-code-session):
 * `lore gate task-claim`'s CLI dry-run (`runTaskClaimGate`, `commands/gate.ts`) and
 * `TaskWorkflowService.claim` (via `createApp`'s `processEnv: process.env` wiring, `app.ts`)
 * both read `$CLAUDE_CODE_SESSION_ID`/`$CLAUDE_SESSION_ID` from `process.env` DIRECTLY —
 * production code that is correct and must not change (SPEC-042 D5's same-session
 * exemption needs a REAL env read to mean anything, and the dry-run must read the SAME
 * variable the real claim does for parity). Neither call site accepts an injectable env
 * argument, so the injection model (`phase-claim-session-capture.test.ts`) does not apply
 * here — this file follows `claim-session-capture-app-wiring.bun.test.ts`'s save/delete/
 * restore model instead: `beforeEach` snapshots the ambient value and clears it, so every
 * case starts from a CONTROLLED absence rather than whatever the invoking shell happens to
 * carry; `afterEach` restores the ambient value so this file never leaks env state into
 * whatever else shares the test process. The two AC-P2-ANCHOR REGRESSION cases below then
 * call `setSessionEnv` explicitly when the session fact is what the case is testing.
 */
const SESSION_ENV_VARS = ["CLAUDE_CODE_SESSION_ID", "CLAUDE_SESSION_ID"] as const;
const originalSessionEnv = new Map<string, string | undefined>();

function setSessionEnv(variable: (typeof SESSION_ENV_VARS)[number] | null, value?: string): void {
  for (const name of SESSION_ENV_VARS) delete process.env[name];
  if (variable !== null && value !== undefined) process.env[variable] = value;
}

beforeEach(() => {
  originalEnv = process.env["LORE_GATE_BYPASS"];
  delete process.env["LORE_GATE_BYPASS"];
  for (const name of SESSION_ENV_VARS) originalSessionEnv.set(name, process.env[name]);
  setSessionEnv(null); // controlled absence by default — never an inherited ambient value
  tmpDir = resolve(mkdtempSync(join(tmpdir(), "lore-gate-p2-cross-tier-test-")));
  const loreDir = join(tmpDir, ".lore");
  mkdirSync(loreDir, { recursive: true });

  const app = createApp(join(loreDir, "lore.db"), undefined, liveAmbient(), liveWriteContext());
  app.close();

  originalCwd = process.cwd();
  process.chdir(tmpDir);
});

afterEach(() => {
  if (originalEnv === undefined) delete process.env["LORE_GATE_BYPASS"];
  else process.env["LORE_GATE_BYPASS"] = originalEnv;
  for (const name of SESSION_ENV_VARS) {
    const original = originalSessionEnv.get(name);
    if (original === undefined) delete process.env[name];
    else process.env[name] = original;
  }
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
  const app = createFixtureApp(dbPath());
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
  const app = createFixtureApp(dbPath());
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
  const app = createFixtureApp(dbPath());
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

/**
 * Creates a task under `planId` declaring `file_anchors` (SPEC-042 §Design
 * Decisions D3) — used by the AC-P2-ANCHOR suite below to set up a sibling-claim
 * anchor-overlap scenario. `title` is caller-supplied (not the fixed "Gate P2
 * Task" literal `createTask` above uses) so two tasks under the same plan get
 * distinguishable slugs.
 */
async function createTaskWithAnchors(
  planId: string,
  title: string,
  anchors: string[],
): Promise<{ taskId: string; taskSlug: string }> {
  const app = createFixtureApp(dbPath());
  try {
    const taskResult = await app.corpusService.create({
      type: "task",
      title,
      parent_id: planId,
      content: "Task body.",
      extra: { plan_id: planId, file_anchors: anchors },
    } as CreateDocInput);
    if (!taskResult.ok) throw new Error(`task create failed: ${JSON.stringify(taskResult.error)}`);
    return { taskId: taskResult.value.id, taskSlug: taskResult.value.slug };
  } finally {
    app.close();
  }
}

/**
 * Claims `taskId` as `by` directly via `TaskWorkflowService.claim` against the
 * fixture app (all four checkpoints disabled — see `createFixtureApp`'s JSDoc).
 * This suite is about `lore gate task-claim`'s PRE-FLIGHT verdict, not the real
 * `lore claim` write path, so fixture claims bypass gating entirely — the same
 * fixture-construction convention `approveDoc`/`softDeleteDoc` already use.
 */
/**
 * The run a caller named by fixture label runs as: the run `asSessionActor(label)` makes `liveInvocation()` resolve
 * to, so a claim written here and a gate call made under `asSessionActor(label)` are the SAME holder (BR-1056: claims
 * compare runs, never names).
 */
function runOfLabel(label: string): string {
  return `cc:${sessionIdFor(label)}`;
}

async function claimTask(taskId: string, by: string, run: string = runOfLabel(by)): Promise<void> {
  const app = createFixtureApp(dbPath());
  try {
    const result = await app.taskWorkflowService.claim(taskId, { by, harnessRun: run as RunId });
    if (!result.ok) throw new Error(`claim failed: ${JSON.stringify(result.error)}`);
  } finally {
    app.close();
  }
}

/** Releases `taskId`'s claim as `by` (fixture app, gates disabled — see `claimTask`). */
async function releaseTask(taskId: string, by: string, run: string = runOfLabel(by)): Promise<void> {
  const app = createFixtureApp(dbPath());
  try {
    const result = await app.taskWorkflowService.release(taskId, { by, harnessRun: run as RunId });
    if (!result.ok) throw new Error(`release failed: ${JSON.stringify(result.error)}`);
  } finally {
    app.close();
  }
}

/**
 * Fast-tracks a doc from draft straight to approved (SPEC-002 §3 valid transition).
 *
 * reason: BR-1007 - approving a spec through `ReviewService` now needs a criterion citing a live rule,
 * which is a concern of spec-approve-requires-citation, not of these plan-promote / task-claim
 * pre-flight scenarios (some of which need an approved spec with ZERO criteria, a legacy shape).
 * A spec's approved state is therefore written directly, the way a corpus holding a pre-BR-1007
 * approved spec looks; every other type still goes through the real approve path.
 */
async function approveDoc(id: string): Promise<void> {
  const app = createFixtureApp(dbPath());
  try {
    const found = await app.corpusService.get(id);
    if (!found.ok) throw new Error(`get failed: ${JSON.stringify(found.error)}`);
    if (found.value.doc.type === "spec") {
      const store = actedStore(new SQLiteStore(dbPath()));
      try {
        const written = await store.update(found.value.doc.id, { status: "approved" });
        if (!written.ok) throw new Error(`approve (direct write) failed: ${JSON.stringify(written.error)}`);
      } finally {
        store.close();
      }
      return;
    }
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
  const app = createFixtureApp(dbPath());
  try {
    const result = await app.corpusService.delete(id, true);
    if (!result.ok) throw new Error(`delete failed: ${JSON.stringify(result.error)}`);
  } finally {
    app.close();
  }
}

/** Adds one structured acceptance criterion (verify.mode=human — simplest valid shape). */
async function addAcceptanceCriterion(specId: string, id = "AC-P2-1"): Promise<void> {
  const app = createFixtureApp(dbPath());
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
      lastExitCode = await runHandlerForExit(() => cmd.run({ args: { plan: planSlug }, inv: liveInvocation() }));
    } finally {
      output.restore();
    }

    expect(lastExitCode).toBe(4);
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
      lastExitCode = await runHandlerForExit(() => cmd.run({ args: { plan: planSlug }, inv: liveInvocation() }));
    } finally {
      output.restore();
    }

    expect(lastExitCode).toBe(4);
    const stdoutText = output.stdout.join("\n");
    expect(stdoutText).toContain("UPSTREAM_NO_AC");
  });
});

// ─── AC-P2-4 (HAPPY): plan-promote, approved spec + ≥1 AC → exit 0 ───────────

describe("lore gate plan-promote — AC-P2-4: ancestor spec approved with ≥1 acceptance criterion", () => {
  it("exits 0 and prints 'gate: pass'", async () => {
    const { specId, planSlug } = await createSpecParentedPlan();
    // The criterion goes in BEFORE the approval: ac add on an approved spec is refused (record-edit gate).
    await addAcceptanceCriterion(specId);
    await approveDoc(specId);

    const cmd = await importGateSubCommand("plan-promote");
    const output = captureOutput();
    try {
      lastExitCode = await runHandlerForExit(() => cmd.run({ args: { plan: planSlug }, inv: liveInvocation() }));
    } finally {
      output.restore();
    }

    expect(lastExitCode).toBe(0);
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
      lastExitCode = await runHandlerForExit(() => cmd.run({ args: { task: taskSlug }, inv: liveInvocation() }));
    } finally {
      output.restore();
    }

    expect(lastExitCode).toBe(4);
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
      lastExitCode = await runHandlerForExit(() => cmd.run({ args: { task: taskSlug }, inv: liveInvocation() }));
    } finally {
      output.restore();
    }

    expect(lastExitCode).toBe(0);
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
      lastExitCode = await runHandlerForExit(() => cmd.run({ args: { plan: planSlug }, inv: liveInvocation() }));
    } finally {
      output.restore();
    }

    expect(lastExitCode).toBe(0);
    expect(output.stdout.join("\n")).toContain("gate: pass");
  });

  it("task-claim exits 0 for a task whose plan is parented directly under a prd", async () => {
    const { planId } = await createPrdParentedPlan();
    const { taskSlug } = await createTask(planId);

    const cmd = await importGateSubCommand("task-claim");
    const output = captureOutput();
    try {
      lastExitCode = await runHandlerForExit(() => cmd.run({ args: { task: taskSlug }, inv: liveInvocation() }));
    } finally {
      output.restore();
    }

    expect(lastExitCode).toBe(0);
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
      lastExitCode = await runHandlerForExit(() => cmd.run({ args: { plan: "does-not-exist-slug" }, inv: liveInvocation() }));
    } finally {
      output.restore();
    }

    expect(lastExitCode).toBe(3);
  });

  it("NEGATIVE: plan-promote exits 4 (VALIDATION_ERROR) when the target is not a plan", async () => {
    const { specSlug } = await createSpecParentedPlan();

    const cmd = await importGateSubCommand("plan-promote");
    const output = captureOutput();
    try {
      lastExitCode = await runHandlerForExit(() => cmd.run({ args: { plan: specSlug }, inv: liveInvocation() }));
    } finally {
      output.restore();
    }

    expect(lastExitCode).toBe(4);
  });

  it("ERROR: task-claim exits 3 (DOC_NOT_FOUND) when the task does not resolve", async () => {
    const { planId } = await createSpecParentedPlan();
    await createTask(planId); // ensure the corpus isn't empty, unrelated to the lookup below

    const cmd = await importGateSubCommand("task-claim");
    const output = captureOutput();
    try {
      lastExitCode = await runHandlerForExit(() => cmd.run({ args: { task: "does-not-exist-slug" }, inv: liveInvocation() }));
    } finally {
      output.restore();
    }

    expect(lastExitCode).toBe(3);
  });

  it("NEGATIVE: task-claim exits 4 (VALIDATION_ERROR) when the target is not a task", async () => {
    const { planSlug } = await createSpecParentedPlan();

    const cmd = await importGateSubCommand("task-claim");
    const output = captureOutput();
    try {
      lastExitCode = await runHandlerForExit(() => cmd.run({ args: { task: planSlug }, inv: liveInvocation() }));
    } finally {
      output.restore();
    }

    expect(lastExitCode).toBe(4);
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
      lastExitCode = await runHandlerForExit(() => cmd.run({ args: { plan: planSlug }, inv: liveInvocation() }));
    } finally {
      output.restore();
      delete process.env["LORE_GATE_BYPASS"];
    }

    expect(lastExitCode).toBe(0);
  });

  it("task-claim exits 0 even with an unapproved ancestor spec, when bypassed", async () => {
    const { planId } = await createSpecParentedPlan();
    const { taskSlug } = await createTask(planId);
    process.env["LORE_GATE_BYPASS"] = "1";

    const cmd = await importGateSubCommand("task-claim");
    const output = captureOutput();
    try {
      lastExitCode = await runHandlerForExit(() => cmd.run({ args: { task: taskSlug }, inv: liveInvocation() }));
    } finally {
      output.restore();
      delete process.env["LORE_GATE_BYPASS"];
    }

    expect(lastExitCode).toBe(0);
  });
});

// ─── AC-P2-SOFTDEL (NEGATIVE): soft-deleted ancestor spec blocks both gates ───

describe("lore gate plan-promote / task-claim — AC-P2-SOFTDEL: soft-deleted ancestor spec", () => {
  it("plan-promote exits 4 (UPSTREAM_DELETED) when the approved+AC ancestor spec was soft-deleted", async () => {
    const { specId, planSlug } = await createSpecParentedPlan();
    // The criterion goes in BEFORE the approval: ac add on an approved spec is refused (record-edit gate).
    await addAcceptanceCriterion(specId);
    await approveDoc(specId);

    // Sanity: before the soft-delete, this exact plan would PASS (same fixture
    // shape as AC-P2-4). Confirms the block below is caused by deletion, not by
    // some other unrelated fixture mistake.
    const preCmd = await importGateSubCommand("plan-promote");
    let output = captureOutput();
    try {
      lastExitCode = await runHandlerForExit(() => preCmd.run({ args: { plan: planSlug }, inv: liveInvocation() }));
    } finally {
      output.restore();
    }
    expect(lastExitCode).toBe(0);

    await softDeleteDoc(specId);

    const cmd = await importGateSubCommand("plan-promote");
    output = captureOutput();
    try {
      lastExitCode = await runHandlerForExit(() => cmd.run({ args: { plan: planSlug }, inv: liveInvocation() }));
    } finally {
      output.restore();
    }

    expect(lastExitCode).toBe(4);
    const stdoutText = output.stdout.join("\n");
    expect(stdoutText).toContain("UPSTREAM_DELETED");
  });

  it("task-claim exits 4 (UPSTREAM_DELETED) when the plan's approved+AC ancestor spec was soft-deleted", async () => {
    const { specId, planId } = await createSpecParentedPlan();
    // The criterion goes in BEFORE the approval: ac add on an approved spec is refused (record-edit gate).
    await addAcceptanceCriterion(specId);
    await approveDoc(specId);
    const { taskSlug } = await createTask(planId);

    const preCmd = await importGateSubCommand("task-claim");
    let output = captureOutput();
    try {
      lastExitCode = await runHandlerForExit(() => preCmd.run({ args: { task: taskSlug }, inv: liveInvocation() }));
    } finally {
      output.restore();
    }
    expect(lastExitCode).toBe(0);

    await softDeleteDoc(specId);

    const cmd = await importGateSubCommand("task-claim");
    output = captureOutput();
    try {
      lastExitCode = await runHandlerForExit(() => cmd.run({ args: { task: taskSlug }, inv: liveInvocation() }));
    } finally {
      output.restore();
    }

    expect(lastExitCode).toBe(4);
    const stdoutText = output.stdout.join("\n");
    expect(stdoutText).toContain("UPSTREAM_DELETED");
  });

  it("BOUNDARY: a soft-deleted spec is NOT treated as 'no spec tier' — it still blocks, it does not vacuously pass", async () => {
    // Regression guard for the correct-semantics requirement in the fix task: a
    // soft-deleted upstream must not fall through to AC-P2-6's vacuous-pass path.
    const { specId, planSlug } = await createSpecParentedPlan();
    // The criterion goes in BEFORE the approval: ac add on an approved spec is refused (record-edit gate).
    await addAcceptanceCriterion(specId);
    await approveDoc(specId);
    await softDeleteDoc(specId);

    const cmd = await importGateSubCommand("plan-promote");
    const output = captureOutput();
    try {
      lastExitCode = await runHandlerForExit(() => cmd.run({ args: { plan: planSlug }, inv: liveInvocation() }));
    } finally {
      output.restore();
    }

    expect(lastExitCode).not.toBe(0);
    expect(lastExitCode).toBe(4);
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
      lastExitCode = await runHandlerForExit(() => planCmd.run({ args: { plan: planSlug }, inv: liveInvocation() }));
    } finally {
      output.restore();
    }
    expect(lastExitCode).toBe(4);

    output = captureOutput();
    try {
      lastExitCode = await runHandlerForExit(() => taskCmd.run({ args: { task: taskSlug }, inv: liveInvocation() }));
    } finally {
      output.restore();
    }
    expect(lastExitCode).toBe(4);

    // -- approve the spec + add AC: plan-promote passes, task-claim passes --
    // The criterion goes in BEFORE the approval: ac add on an approved spec is refused (record-edit gate).
    await addAcceptanceCriterion(specId);
    await approveDoc(specId);

    output = captureOutput();
    try {
      lastExitCode = await runHandlerForExit(() => planCmd.run({ args: { plan: planSlug }, inv: liveInvocation() }));
    } finally {
      output.restore();
    }
    expect(lastExitCode).toBe(0);

    output = captureOutput();
    try {
      lastExitCode = await runHandlerForExit(() => taskCmd.run({ args: { task: taskSlug }, inv: liveInvocation() }));
    } finally {
      output.restore();
    }
    expect(lastExitCode).toBe(0);
  });
});

// ─── AC-P2-ANCHOR: `lore gate task-claim` / `lore claim` PARITY on anchor overlap ──
//
// Live-UAT regression fix (2026-07-11): `runTaskClaimGate` used to build ONLY
// `buildUpstreamSpecContext(...)`, never `buildAnchorGateContext(...)` — so
// `candidateBy`/`candidateAnchors`/`siblingClaims` were always `undefined` and
// `noAnchorOverlap` vacuously passed here, even while the SAME scenario correctly
// blocked at `TaskWorkflowService.claim` (the `lore claim` write path, exercised at
// `tests/unit/adapters/cli-claim-anchors.bun.test.ts`). This suite pins the two
// surfaces AGREEING — the exact drift retro-item-8's SSOT relocation was meant to
// prevent — using `createPrdParentedPlan` (no spec-tier ancestor) so the
// anchor-overlap predicate's own UNCONDITIONAL-evaluation contract (SPEC-042 D5 —
// NOT gated by `hasSpecParent`, unlike `upstreamApproved`) is exercised in isolation.

describe("lore gate task-claim — AC-P2-ANCHOR: anchor-overlap parity with `lore claim` (SPEC-042 D5)", () => {
  it("NEGATIVE: a fresh foreign sibling claim with overlapping anchors → exit 4, feed names the conflicting task/holder/paths + the literal recovery command", async () => {
    const { planId } = await createPrdParentedPlan(); // no spec-tier ancestor — isolates the anchor predicate
    const { taskId: taskAId, taskSlug: taskASlug } = await createTaskWithAnchors(
      planId,
      "Anchor Gate Task A",
      ["src/shared.ts"],
    );
    const { taskSlug: taskBSlug } = await createTaskWithAnchors(planId, "Anchor Gate Task B", [
      "src/shared.ts",
    ]);

    await claimTask(taskAId, "agent:a");

    const cmd = await importGateSubCommand("task-claim");
    const output = captureOutput();
    try {
      lastExitCode = await asSessionActor("agent:b", () => runHandlerForExit(() => cmd.run({ args: { task: taskBSlug }, inv: liveInvocation() })));
    } finally {
      output.restore();
    }

    expect(lastExitCode).toBe(4);
    const stdoutText = output.stdout.join("\n");
    expect(stdoutText).toContain("ANCHOR_OVERLAP");
    expect(stdoutText).toContain(taskASlug);
    expect(stdoutText).toContain("agent:a");
    expect(stdoutText).toContain("src/shared.ts");
    expect(stdoutText).toContain(`lore release ${taskASlug} --force`);
  });

  it("HAPPY: after releasing the conflicting claim, the SAME gate call passes", async () => {
    const { planId } = await createPrdParentedPlan();
    const { taskId: taskAId } = await createTaskWithAnchors(planId, "Anchor Gate Release Task A", [
      "src/shared.ts",
    ]);
    const { taskSlug: taskBSlug } = await createTaskWithAnchors(planId, "Anchor Gate Release Task B", [
      "src/shared.ts",
    ]);

    await claimTask(taskAId, "agent:a");

    const cmd = await importGateSubCommand("task-claim");

    // -- blocked while task A's claim is live --
    let output = captureOutput();
    try {
      lastExitCode = await asSessionActor("agent:b", () => runHandlerForExit(() => cmd.run({ args: { task: taskBSlug }, inv: liveInvocation() })));
    } finally {
      output.restore();
    }
    expect(lastExitCode).toBe(4);

    // -- release task A's claim --
    await releaseTask(taskAId, "agent:a");

    // -- the SAME gate call now passes --
    output = captureOutput();
    try {
      lastExitCode = await asSessionActor("agent:b", () => runHandlerForExit(() => cmd.run({ args: { task: taskBSlug }, inv: liveInvocation() })));
    } finally {
      output.restore();
    }
    expect(lastExitCode).toBe(0);
    expect(output.stdout.join("\n")).toContain("gate: pass");
    expect(lastExitCode).not.toBe(4);
  });

  // The following pair replaces a single test that asserted only the exempt branch —
  // that assertion's truth silently depended on whichever ambient
  // $CLAUDE_CODE_SESSION_ID the invoking shell happened to carry
  // (task-a-test-s-green-depends-on-an-ambient-claude-code-session): present → both
  // sides captured the SAME id and were exempted (exit 0); absent → both captured
  // NOTHING and the fail-safe correctly refused (exit 4), which read as a failure
  // instead of as the SECOND case it actually is. Both branches are now constructed
  // and asserted explicitly, independent of the ambient environment.

  it("REGRESSION: a fresh claim by the SAME run (one measured session) does not conflict, even with overlapping anchors", async () => {
    const { planId } = await createPrdParentedPlan();
    const { taskId: taskAId } = await createTaskWithAnchors(planId, "Anchor Gate Same-Actor Same-Session Task A", [
      "src/shared.ts",
    ]);
    const { taskSlug: taskBSlug } = await createTaskWithAnchors(
      planId,
      "Anchor Gate Same-Actor Same-Session Task B",
      ["src/shared.ts"],
    );

    // Both `claimTask` (via `TaskWorkflowService.claim`) and the gate's dry-run
    // (`runTaskClaimGate`) read the session id from `process.env` at their own call
    // time — set the SAME value explicitly before each so "one measured session" is a
    // constructed fact, never an inherited ambient one.
    // The gate resolves its candidate name from that SAME session (`agent:session-<id8>`), so the
    // holder is recorded under that name: same actor AND same measured session.
    setSessionEnv("CLAUDE_CODE_SESSION_ID", "3de02220-same-session");
    await claimTask(taskAId, "agent:session-3de02220", "cc:3de02220-same-session");

    const cmd = await importGateSubCommand("task-claim");
    setSessionEnv("CLAUDE_CODE_SESSION_ID", "3de02220-same-session");
    const output = captureOutput();
    try {
      lastExitCode = await runHandlerForExit(() => cmd.run({ args: { task: taskBSlug }, inv: liveInvocation() }));
    } finally {
      output.restore();
    }

    expect(lastExitCode).toBe(0);
    expect(output.stdout.join("\n")).toContain("gate: pass");
  });

  it("REGRESSION: the SAME run with NO session id on either side does not conflict — the run decides, an absent session id never does", async () => {
    const { planId } = await createPrdParentedPlan();
    const { taskId: taskAId } = await createTaskWithAnchors(planId, "Anchor Gate Same-Run No-Session Task A", [
      "src/shared.ts",
    ]);
    const { taskSlug: taskBSlug } = await createTaskWithAnchors(
      planId,
      "Anchor Gate Same-Run No-Session Task B",
      ["src/shared.ts"],
    );

    // Explicitly ABSENT on both sides: with no session env the gate's candidate runs as the live test run, and the
    // holder is recorded under that same run.
    setSessionEnv(null);
    await claimTask(taskAId, resolveActor(liveInvocation()), LIVE_TEST_RUN);

    const cmd = await importGateSubCommand("task-claim");
    setSessionEnv(null);
    const output = captureOutput();
    try {
      lastExitCode = await runHandlerForExit(() => cmd.run({ args: { task: taskBSlug }, inv: liveInvocation() }));
    } finally {
      output.restore();
    }

    expect(lastExitCode).toBe(0);
    expect(output.stdout.join("\n")).toContain("gate: pass");
  });

  it("NEGATIVE: a fresh claim under the SAME display name but ANOTHER run refuses as ANCHOR_OVERLAP — a name is not a holder", async () => {
    const { planId } = await createPrdParentedPlan();
    const { taskId: taskAId } = await createTaskWithAnchors(planId, "Anchor Gate Same-Name Other-Run Task A", [
      "src/shared.ts",
    ]);
    const { taskSlug: taskBSlug } = await createTaskWithAnchors(
      planId,
      "Anchor Gate Same-Name Other-Run Task B",
      ["src/shared.ts"],
    );

    setSessionEnv(null);
    await claimTask(taskAId, resolveActor(liveInvocation()), "cc:some-other-run");

    const cmd = await importGateSubCommand("task-claim");
    setSessionEnv(null);
    const output = captureOutput();
    try {
      lastExitCode = await runHandlerForExit(() => cmd.run({ args: { task: taskBSlug }, inv: liveInvocation() }));
    } finally {
      output.restore();
    }

    expect(lastExitCode).toBe(4);
    const stdoutText = output.stdout.join("\n");
    expect(stdoutText).toContain("ANCHOR_OVERLAP");
    expect(stdoutText).toContain("cc:some-other-run");
  });

  it("BOUNDARY: disjoint anchors between fresh siblings → gate: pass", async () => {
    const { planId } = await createPrdParentedPlan();
    const { taskId: taskAId } = await createTaskWithAnchors(planId, "Anchor Gate Disjoint Task A", [
      "src/a.ts",
    ]);
    const { taskSlug: taskBSlug } = await createTaskWithAnchors(planId, "Anchor Gate Disjoint Task B", [
      "src/b.ts",
    ]);

    await claimTask(taskAId, "agent:a");

    const cmd = await importGateSubCommand("task-claim");
    const output = captureOutput();
    try {
      lastExitCode = await asSessionActor("agent:b", () => runHandlerForExit(() => cmd.run({ args: { task: taskBSlug }, inv: liveInvocation() })));
    } finally {
      output.restore();
    }

    expect(lastExitCode).toBe(0);
  });

  it("STATE: candidate task itself declares no anchors → vacuous pass regardless of a conflicting-looking sibling", async () => {
    const { planId } = await createPrdParentedPlan();
    const { taskId: taskAId } = await createTaskWithAnchors(planId, "Anchor Gate Anchorless Task A", [
      "src/shared.ts",
    ]);
    const { taskSlug: taskBSlug } = await createTaskWithAnchors(
      planId,
      "Anchor Gate Anchorless Task B",
      [], // candidate declares NO anchors — noAnchorOverlap short-circuits to pass
    );

    await claimTask(taskAId, "agent:a");

    const cmd = await importGateSubCommand("task-claim");
    const output = captureOutput();
    try {
      lastExitCode = await asSessionActor("agent:b", () => runHandlerForExit(() => cmd.run({ args: { task: taskBSlug }, inv: liveInvocation() })));
    } finally {
      output.restore();
    }

    expect(lastExitCode).toBe(0);
  });
});
