/**
 * done-command.test.ts — spec-workflow-hardening-evidence-red-vocabulary-claim-worktree
 * §M3, AC-WH-3: `lore done`'s human-readable success message must clearly distinguish
 * the idempotent no-op branch (already at a terminal status) from a real lifecycle walk,
 * and name the transitions actually performed.
 *
 * `commands/done.ts` transitively imports `loader.ts` (`bun:sqlite`), which vitest
 * cannot resolve, so this suite exercises the pure unit extracted for testability:
 *   - `formatDoneMessage` (`packages/lore/src/adapters/cli/done-render.ts`) — same
 *     split pattern as `pending-render.ts`/`status-stamp-verdict.ts`/`review-render.ts`.
 *
 * The substantive service-layer behavior (evidence/claim validation, the actual
 * VALID_TRANSITIONS walk, blocks-link readiness flip, idempotency) is covered by
 * `tests/unit/service/task-workflow-service.test.ts`'s AC-WH-3 suite — this file's
 * scope is the CLI adapter's own OUTPUT rendering.
 *
 * Coverage: HAPPY / NEGATIVE / BOUNDARY / ERROR / STATE / REGRESSION
 *
 * @spec_ref spec-workflow-hardening-evidence-red-vocabulary-claim-worktree#AC-WH-3 — spec-workflow-hardening-evidence-red-vocabulary-claim-worktree §M3
 */

import { RecordLockService } from "../../../src/service/record-lock-service.js";
import { GateEnforcer } from "../../../src/service/gate-enforcer.js";
import { describe, it, expect } from "vitest";
import { formatDoneMessage } from "../../../src/adapters/cli/done-render.js";
// reason: namespace import (not a named `formatLastTaskAdvisory` import) — that
// export does NOT exist yet on `done-render.ts` (this is the RED phase; the
// paired impl task adds it). A named import of a nonexistent export would fail
// `bun run typecheck` immediately, which this task's oracle scope requires to
// stay GREEN even while vitest is RED. `resolveFormatLastTaskAdvisory` below
// reads the export off the namespace object at RUNTIME instead, so the failure
// surfaces as a clear, loud vitest assertion ("expected undefined to be
// 'function' — missing implementation") rather than a compile error.
import * as doneRenderModule from "../../../src/adapters/cli/done-render.js";
import { InMemoryStore } from "../../../src/store/in-memory-store.js";
import { CorpusService } from "../../../src/service/corpus-service.js";
import { TaskWorkflowService } from "../../../src/service/task-workflow-service.js";
import type { DoneResult, EvidenceInput, VerifiedEvidenceInput } from "../../../src/service/task-workflow-service.js";
import type { DocRecord, CreateDocInput } from "@lore/core";
import { actedStore } from "../../live-invocation.js";

function makeTaskDoc(overrides: Partial<DocRecord> = {}): DocRecord {
  return {
    id: "01HDONE0000000000000000001",
    slug: "task-example",
    type: "task",
    role: "plan",
    title: "Example Task",
    status: "draft",
    priority: "medium",
    content: "# Example Task",
    parent_id: "01HPLAN000000000000000000",
    created_at: "2026-07-27T00:00:00.000Z",
    updated_at: "2026-07-27T00:00:00.000Z",
    created_by: "system",
    version: 1,
    deleted_at: null,
    tags: [],
    extra: { plan_id: "01HPLAN000000000000000000" },
    ...overrides,
  };
}

describe("lore done — success message rendering (spec-workflow-hardening-evidence-red-vocabulary-claim-worktree#AC-WH-3)", () => {
  // ── HAPPY ──────────────────────────────────────────────────────────────

  it("HAPPY: a real lifecycle walk names the slug, final version, and full transitions path", () => {
    const result: DoneResult = {
      task: makeTaskDoc({ status: "archived", version: 4 }),
      already_done: false,
      transitions: ["approved", "active", "archived"],
    };

    const message = formatDoneMessage(result);
    expect(message).toContain("task-example");
    expect(message).toContain("v4");
    expect(message).toContain("approved -> active -> archived");
    expect(message).not.toContain("no-op");
  });

  it("HAPPY: a single-step walk (already approved) renders just that one step", () => {
    const result: DoneResult = {
      task: makeTaskDoc({ status: "archived", version: 2 }),
      already_done: false,
      transitions: ["archived"],
    };

    const message = formatDoneMessage(result);
    expect(message).toContain("archived");
    expect(message).not.toContain("->");
  });

  // ── NEGATIVE ───────────────────────────────────────────────────────────
  // (formatDoneMessage only ever receives a successful DoneResult — the error
  // path is rendered by the shared formatError/exitCode pair every other CLI
  // command uses, exercised at the service layer's own NEGATIVE suite. This
  // dimension is satisfied here by proving the STATE discriminant is never
  // misread — an already_done:false result never claims to be a no-op.)

  it("NEGATIVE: a real walk (already_done: false) never renders the no-op phrase", () => {
    const result: DoneResult = {
      task: makeTaskDoc({ status: "archived", version: 2 }),
      already_done: false,
      transitions: ["approved", "active", "archived"],
    };
    expect(formatDoneMessage(result)).not.toContain("idempotent");
  });

  // ── BOUNDARY ───────────────────────────────────────────────────────────

  it("BOUNDARY: the longest possible walk (draft -> archived, 3 steps) renders every step in order", () => {
    const result: DoneResult = {
      task: makeTaskDoc({ status: "archived", version: 4 }),
      already_done: false,
      transitions: ["approved", "active", "archived"],
    };
    const message = formatDoneMessage(result);
    const approvedIdx = message.indexOf("approved");
    const activeIdx = message.indexOf("active");
    const archivedIdx = message.lastIndexOf("archived");
    expect(approvedIdx).toBeGreaterThanOrEqual(0);
    expect(activeIdx).toBeGreaterThan(approvedIdx);
    expect(archivedIdx).toBeGreaterThan(activeIdx);
  });

  // ── ERROR ──────────────────────────────────────────────────────────────

  it("ERROR: an empty transitions array on a non-idempotent result renders no dangling arrow", () => {
    // reason: structurally unreachable in production (already_done: false always
    // carries ≥1 transition — computeArchiveWalk only returns [] for an already-
    // terminal status, which is exactly the already_done: true branch) — this
    // guards formatDoneMessage's OWN rendering against ever emitting a trailing
    // "-> " artifact if that invariant were ever violated upstream.
    const result: DoneResult = {
      task: makeTaskDoc({ status: "draft", version: 1 }),
      already_done: false,
      transitions: [],
    };
    const message = formatDoneMessage(result);
    expect(message.endsWith("-> ")).toBe(false);
    expect(message.endsWith(": ")).toBe(true);
  });

  // ── STATE ──────────────────────────────────────────────────────────────

  it("STATE: already_done discriminates the no-op branch from the real-walk branch", () => {
    const noOp: DoneResult = {
      task: makeTaskDoc({ status: "archived", version: 2 }),
      already_done: true,
      transitions: [],
    };
    const realWalk: DoneResult = {
      task: makeTaskDoc({ status: "archived", version: 2 }),
      already_done: false,
      transitions: ["archived"],
    };
    expect(formatDoneMessage(noOp)).toContain("no-op");
    expect(formatDoneMessage(realWalk)).not.toContain("no-op");
  });

  it("STATE: an idempotent no-op names the CURRENT terminal status, including 'deprecated' (not hardcoded 'archived')", () => {
    const deprecatedNoOp: DoneResult = {
      task: makeTaskDoc({ status: "deprecated", version: 3 }),
      already_done: true,
      transitions: [],
    };
    const message = formatDoneMessage(deprecatedNoOp);
    expect(message).toContain("already deprecated");
    expect(message).not.toContain("already archived");
  });

  // ── REGRESSION ─────────────────────────────────────────────────────────

  it("REGRESSION: message always leads with the doc's slug (stable prefix for scripting/grep)", () => {
    const result: DoneResult = {
      task: makeTaskDoc({ slug: "task-regression-check", status: "archived", version: 1 }),
      already_done: true,
      transitions: [],
    };
    expect(formatDoneMessage(result).startsWith("task-regression-check ")).toBe(true);
  });
});

/**
 * RED suite (TDD-Role: red, paired-impl "lore done last-task advisory + service
 * result fact") — AC-CLOSURE-3, spec-plan-closure-must-be-loud-terminality-
 * divergence-silent DD-2: when `lore done` archives the LAST non-terminal task
 * of a plan, it must print a stderr advisory naming the plan slug and the
 * literal next command (`lore set <plan> --status archived`) — never perform
 * the plan write itself (that stays a human/AI decision behind the `plan-close`
 * gate).
 *
 * Neither the service fact (`DoneResult.plan_now_fully_terminal`) nor the CLI
 * render helper (`formatLastTaskAdvisory`) exist yet — this suite is the
 * CONTRACT PROPOSAL the paired impl task fulfils, mirroring the two closest
 * precedents in this codebase:
 *   - `done-render.ts`'s existing split (`commands/done.ts` transitively imports
 *     `loader.ts`/`bun:sqlite`, unresolvable by vitest — the CLI's advisory text
 *     must live in a sibling pure `*-render.ts` function to be testable here).
 *   - `plan-close-prd-sync.test.ts`'s RED-suite convention of exercising the
 *     REAL service (InMemoryStore + CorpusService + TaskWorkflowService, no
 *     bare-fixture shortcuts) rather than a hand-rolled DoneResult wherever the
 *     scenario needs genuine plan/task state (sibling terminality, `done()`'s
 *     own no-plan-write guarantee).
 *
 * `formatLastTaskAdvisory` is read off a NAMESPACE import at runtime
 * (`resolveFormatLastTaskAdvisory`), never a named import — a named import of a
 * not-yet-existing export fails `bun run typecheck` immediately, which this
 * task's oracle scope requires to stay GREEN even while vitest is RED. Every
 * scenario below is expected to fail LOUD with a "missing implementation"
 * reason (either `plan_now_fully_terminal` not carried on `DoneResult`, or
 * `formatLastTaskAdvisory` not yet exported) until the paired impl task lands.
 *
 * Coverage: HAPPY / NEGATIVE / BOUNDARY / ERROR / STATE
 *
 * @spec_ref AC-CLOSURE-3 — spec-plan-closure-must-be-loud-terminality-divergence-silent DD-2
 */
describe("lore done — last non-terminal task advisory (AC-CLOSURE-3, DD-2)", () => {
  // ── Harness (real service, InMemoryStore — mirrors task-workflow-service.test.ts) ──

  function makeServices() {
    const store = actedStore(new InMemoryStore());
    const corpusService = new CorpusService(store, new RecordLockService(store, new GateEnforcer(undefined)));
    const taskWorkflowService = new TaskWorkflowService(store, undefined, { claimTtlMinutes: 120 });
    return { store, corpusService, taskWorkflowService };
  }

  async function createPlan(cs: CorpusService, title = "Closure Test Plan"): Promise<DocRecord> {
    const result = await cs.create({ type: "plan", title, content: "body" } as CreateDocInput);
    if (!result.ok) throw new Error(`Failed to create plan: ${JSON.stringify(result.error)}`);
    return result.value;
  }

  async function createTask(cs: CorpusService, planId: string, title = "Closure Test Task"): Promise<string> {
    const result = await cs.create({
      type: "task",
      title,
      parent_id: planId,
      content: "body",
      extra: { plan_id: planId },
    } as CreateDocInput);
    if (!result.ok) throw new Error(`Failed to create task: ${JSON.stringify(result.error)}`);
    return result.value.id;
  }

  function evidence(overrides: Partial<EvidenceInput> = {}): EvidenceInput {
    return {
      oracle: "tsc",
      command: "bun run typecheck",
      result: "pass",
      recorded_by: "alice",
      // reason: task-capture-source-is-optional-at-the-evidence-write-boundary —
      // now compile-time-required on EvidenceInput; "self-report" mirrors this
      // fixture's pre-existing implicit behaviour.
      capture_source: "self-report",
      ...overrides,
    };
  }

  /**
   * A runner-attested `result: "pass"` row (SPEC-039 §2 D2) — mirrors
   * task-workflow-service.test.ts's own `attestedPass()` helper. `done()`'s
   * attestation floor (adr-lore-done-requires-a-runner-attested-pass-the-
   * sixth-false) requires at least one of these; `evidence()` above (self-
   * reported, structurally excludes `attestation`) alone no longer suffices.
   */
  function attestedPass(overrides: Partial<VerifiedEvidenceInput> = {}): VerifiedEvidenceInput {
    return {
      oracle: "tsc",
      command: "bun run typecheck",
      result: "pass",
      recorded_by: "runner",
      // reason: task-capture-source-is-optional-at-the-evidence-write-boundary —
      // now compile-time-required on VerifiedEvidenceInput; "runner" is the
      // value the real-world caller (VerifyRunnerService) actually proves.
      capture_source: "runner",
      attestation: { runner: "lore-cli", exit_code: 0, duration_ms: 1, timed_out: false },
      ...overrides,
    };
  }

  /** DD-2's proposed `DoneResult` extension — `TaskWorkflowService.done` gains
   *  this fact, never a plan write. Declared here as a local intersection type
   *  (not editing `task-workflow-service.ts`, out of this RED task's boundary)
   *  so property access below typechecks against the CURRENT `DoneResult`
   *  shape via a bounded cast, not `any`. */
  type DoneResultWithPlanFact = DoneResult & {
    plan_now_fully_terminal?: { plan_slug: string };
  };

  type LastTaskAdvisoryFn = (result: DoneResultWithPlanFact) => string | undefined;

  /** Reads `formatLastTaskAdvisory` off the namespace import at runtime —
   *  `undefined` until the paired impl task adds the export. See module header
   *  for why this is a namespace read, not a named import. */
  function resolveFormatLastTaskAdvisory(): LastTaskAdvisoryFn | undefined {
    const candidate = (doneRenderModule as unknown as { formatLastTaskAdvisory?: unknown })
      .formatLastTaskAdvisory;
    return typeof candidate === "function" ? (candidate as LastTaskAdvisoryFn) : undefined;
  }

  // ── HAPPY ──────────────────────────────────────────────────────────────

  it("HAPPY: archiving the LAST non-terminal task of a plan yields an advisory naming the plan slug and '--status archived'", async () => {
    const { corpusService, taskWorkflowService } = makeServices();
    const plan = await createPlan(corpusService, "Last Task Advisory Plan");
    const alreadyDoneTask = await createTask(corpusService, plan.id, "Already Archived Sibling");
    const lastTask = await createTask(corpusService, plan.id, "Last Non-Terminal Task");

    await taskWorkflowService.addEvidence(alreadyDoneTask, evidence());
    await taskWorkflowService.recordVerifiedEvidence(alreadyDoneTask, attestedPass(), "2026-07-27T09:00:00.000Z");
    const siblingDone = await taskWorkflowService.done(alreadyDoneTask, { by: "alice" });
    expect(siblingDone.ok).toBe(true);

    await taskWorkflowService.addEvidence(lastTask, evidence());
    await taskWorkflowService.recordVerifiedEvidence(lastTask, attestedPass(), "2026-07-27T09:00:00.000Z");
    const doneResult = await taskWorkflowService.done(lastTask, { by: "alice" });
    expect(doneResult.ok).toBe(true);
    if (!doneResult.ok) return;

    const value = doneResult.value as DoneResultWithPlanFact;
    expect(
      value.plan_now_fully_terminal,
      "MISSING IMPLEMENTATION: DoneResult does not yet carry plan_now_fully_terminal (paired impl task: 'lore done last-task advisory + service result fact', DD-2)",
    ).toEqual({ plan_slug: plan.slug });

    const formatLastTaskAdvisory = resolveFormatLastTaskAdvisory();
    expect(
      typeof formatLastTaskAdvisory,
      "MISSING IMPLEMENTATION: done-render.ts does not yet export formatLastTaskAdvisory (paired impl task: 'lore done last-task advisory + service result fact', DD-2)",
    ).toBe("function");
    const advisory = formatLastTaskAdvisory!(value);
    expect(advisory).toContain(plan.slug);
    expect(advisory).toContain("--status archived");
  });

  // ── NEGATIVE ───────────────────────────────────────────────────────────

  it("NEGATIVE: archiving a NON-last task of a plan produces no advisory", async () => {
    const { corpusService, taskWorkflowService } = makeServices();
    const plan = await createPlan(corpusService, "Non-Last Task Plan");
    const taskA = await createTask(corpusService, plan.id, "Task A");
    const taskB = await createTask(corpusService, plan.id, "Task B (stays draft)");
    void taskB; // reason: intentionally left non-terminal — that's what makes taskA "not the last"

    await taskWorkflowService.addEvidence(taskA, evidence());
    await taskWorkflowService.recordVerifiedEvidence(taskA, attestedPass(), "2026-07-27T09:00:00.000Z");
    const doneResult = await taskWorkflowService.done(taskA, { by: "alice" });
    expect(doneResult.ok).toBe(true);
    if (!doneResult.ok) return;

    const value = doneResult.value as DoneResultWithPlanFact;
    expect(value.plan_now_fully_terminal).toBeUndefined();

    // ⛔ explicit ABSENCE assertion — not merely "the HAPPY case fires, so this
    // must be fine by omission". Once formatLastTaskAdvisory is implemented it
    // MUST return undefined for a non-last-task DoneResult; until then this
    // fails loud with the same missing-implementation reason as HAPPY, rather
    // than silently skipping the check.
    const formatLastTaskAdvisory = resolveFormatLastTaskAdvisory();
    expect(
      typeof formatLastTaskAdvisory,
      "MISSING IMPLEMENTATION: done-render.ts does not yet export formatLastTaskAdvisory — cannot assert ABSENCE of the advisory for a non-last task (paired impl task: 'lore done last-task advisory + service result fact', DD-2)",
    ).toBe("function");
    expect(formatLastTaskAdvisory!(value)).toBeUndefined();
  });

  // ── STATE ──────────────────────────────────────────────────────────────

  it("STATE: in BOTH the advisory and no-advisory cases, the plan doc's status and version are unchanged before and after — done never writes the plan", async () => {
    const { corpusService, taskWorkflowService } = makeServices();

    // Case 1: last task archived (advisory case).
    const advisoryPlan = await createPlan(corpusService, "State Advisory Plan");
    const alreadyDoneTask = await createTask(corpusService, advisoryPlan.id, "Already Archived Sibling");
    const lastTask = await createTask(corpusService, advisoryPlan.id, "Last Non-Terminal Task");
    await taskWorkflowService.addEvidence(alreadyDoneTask, evidence());
    await taskWorkflowService.recordVerifiedEvidence(alreadyDoneTask, attestedPass(), "2026-07-27T09:00:00.000Z");
    await taskWorkflowService.done(alreadyDoneTask, { by: "alice" });

    const advisoryPlanBefore = await corpusService.get(advisoryPlan.id);
    expect(advisoryPlanBefore.ok).toBe(true);
    if (!advisoryPlanBefore.ok) return;

    await taskWorkflowService.addEvidence(lastTask, evidence());
    await taskWorkflowService.recordVerifiedEvidence(lastTask, attestedPass(), "2026-07-27T09:00:00.000Z");
    const advisoryDoneResult = await taskWorkflowService.done(lastTask, { by: "alice" });
    expect(advisoryDoneResult.ok).toBe(true);

    const advisoryPlanAfter = await corpusService.get(advisoryPlan.id);
    expect(advisoryPlanAfter.ok).toBe(true);
    if (!advisoryPlanAfter.ok) return;
    expect(advisoryPlanAfter.value.doc.status).toBe(advisoryPlanBefore.value.doc.status);
    expect(advisoryPlanAfter.value.doc.version).toBe(advisoryPlanBefore.value.doc.version);

    // Case 2: non-last task archived (no-advisory case).
    const noAdvisoryPlan = await createPlan(corpusService, "State No-Advisory Plan");
    const taskA = await createTask(corpusService, noAdvisoryPlan.id, "Task A");
    await createTask(corpusService, noAdvisoryPlan.id, "Task B (stays draft)");

    const noAdvisoryPlanBefore = await corpusService.get(noAdvisoryPlan.id);
    expect(noAdvisoryPlanBefore.ok).toBe(true);
    if (!noAdvisoryPlanBefore.ok) return;

    await taskWorkflowService.addEvidence(taskA, evidence());
    await taskWorkflowService.recordVerifiedEvidence(taskA, attestedPass(), "2026-07-27T09:00:00.000Z");
    const noAdvisoryDoneResult = await taskWorkflowService.done(taskA, { by: "alice" });
    expect(noAdvisoryDoneResult.ok).toBe(true);

    const noAdvisoryPlanAfter = await corpusService.get(noAdvisoryPlan.id);
    expect(noAdvisoryPlanAfter.ok).toBe(true);
    if (!noAdvisoryPlanAfter.ok) return;
    expect(noAdvisoryPlanAfter.value.doc.status).toBe(noAdvisoryPlanBefore.value.doc.status);
    expect(noAdvisoryPlanAfter.value.doc.version).toBe(noAdvisoryPlanBefore.value.doc.version);
  });

  // ── BOUNDARY ───────────────────────────────────────────────────────────

  it("BOUNDARY: an adhoc/planless task produces no advisory and does not throw", async () => {
    const { corpusService, taskWorkflowService } = makeServices();
    const rootPrd = await corpusService.create({
      type: "prd",
      title: "Root PRD For Adhoc Boundary",
      content: "root",
    } as CreateDocInput);
    if (!rootPrd.ok) throw new Error(`Failed to create root PRD: ${JSON.stringify(rootPrd.error)}`);

    const adhocTask = await corpusService.create({
      type: "task",
      title: "Adhoc Planless Task",
      content: "body",
      extra: { adhoc: true },
    } as CreateDocInput);
    if (!adhocTask.ok) throw new Error(`Failed to create adhoc task: ${JSON.stringify(adhocTask.error)}`);
    const adhocId = adhocTask.value.id;

    await taskWorkflowService.addEvidence(adhocId, evidence());
    await taskWorkflowService.recordVerifiedEvidence(adhocId, attestedPass(), "2026-07-27T09:00:00.000Z");

    let threw = false;
    let doneResult: Awaited<ReturnType<typeof taskWorkflowService.done>> | undefined;
    try {
      doneResult = await taskWorkflowService.done(adhocId, { by: "alice" });
    } catch {
      threw = true;
    }
    expect(threw).toBe(false);
    expect(doneResult?.ok).toBe(true);
    if (!doneResult || !doneResult.ok) return;

    const value = doneResult.value as DoneResultWithPlanFact;
    expect(value.plan_now_fully_terminal).toBeUndefined();
  });

  // ── ERROR ──────────────────────────────────────────────────────────────

  it("ERROR: a plan whose OTHER task is 'deprecated' (terminal) counts as fully terminal — advisory fires", async () => {
    const { corpusService, taskWorkflowService } = makeServices();
    const plan = await createPlan(corpusService, "Deprecated Sibling Plan");
    const deprecatedTask = await createTask(corpusService, plan.id, "Deprecated Sibling");
    const lastTask = await createTask(corpusService, plan.id, "Last Non-Terminal Task");

    const toApproved = await corpusService.set(deprecatedTask, { status: "approved" });
    expect(toApproved.ok).toBe(true);
    const toDeprecated = await corpusService.set(deprecatedTask, { status: "deprecated" });
    expect(toDeprecated.ok).toBe(true);

    await taskWorkflowService.addEvidence(lastTask, evidence());
    await taskWorkflowService.recordVerifiedEvidence(lastTask, attestedPass(), "2026-07-27T09:00:00.000Z");
    const doneResult = await taskWorkflowService.done(lastTask, { by: "alice" });
    expect(doneResult.ok).toBe(true);
    if (!doneResult.ok) return;

    const value = doneResult.value as DoneResultWithPlanFact;
    expect(
      value.plan_now_fully_terminal,
      "MISSING IMPLEMENTATION: DoneResult does not yet carry plan_now_fully_terminal for a deprecated-sibling plan (paired impl task: 'lore done last-task advisory + service result fact', DD-2)",
    ).toEqual({ plan_slug: plan.slug });
  });
});
