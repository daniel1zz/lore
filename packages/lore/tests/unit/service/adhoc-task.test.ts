/**
 * adhoc-task.test.ts — SPEC-069 D2/D3/D4: ad-hoc (planless) task channel.
 *
 * Covers:
 *   - task-an-ad-hoc-task-can-never-reach-the-attestation-path-that: the
 *     ad-hoc branch of `--ac-scope` requiredness — pure predicate +
 *     refusal-message coverage (`isAdhocAcScopeDeclarationMissing`); the
 *     end-to-end exit-code/store-effect wiring lives in
 *     `tests/integration/cli/create-task-ac-scope.test.ts`.
 *   - AC-069-5: `--adhoc` succeeds with no `--plan-id`/`--parent`, sets
 *     `extra.adhoc === true`, parents to the root PRD; `--adhoc` + `--plan-id`
 *     is a single-pass mutual-exclusion conflict (CLI-layer, exit-2 shape).
 *   - AC-069-6: `--linkage` stores `extra.linkage` verbatim.
 *   - AC-069-7: `lore ready <plan>` output is regression-unchanged for plan
 *     tasks; a new `readyAdhoc()` corpus-wide listing surfaces OPEN ad-hoc
 *     tasks (and excludes closed ones / plan-scoped ones).
 *
 * CLI-layer validation (mutex/required-flag single-pass aggregation) is tested
 * directly against the pure functions in `create-task-validation.ts` —
 * `commands/create.ts` transitively imports `loader.ts` (`bun:sqlite`), which
 * vitest cannot resolve (same split rationale as SPEC-065's own
 * `create-task-validation.test.ts`). Service-layer behavior (schema relaxation,
 * root-PRD auto-parenting) is tested against InMemoryStore.
 *
 * Coverage: HAPPY / NEGATIVE / BOUNDARY / ERROR / STATE / REGRESSION
 *
 * @spec_ref AC-069-5, AC-069-6, AC-069-7 — SPEC-069 D2, D3, D4
 */

import { RecordLockService } from "../../../src/service/record-lock-service.js";
import { GateEnforcer } from "../../../src/service/gate-enforcer.js";
import { describe, it, expect } from "vitest";
import { InMemoryStore } from "../../../src/store/in-memory-store.js";
import { CorpusService } from "../../../src/service/corpus-service.js";
import { TaskWorkflowService } from "../../../src/service/task-workflow-service.js";
import {
  checkTaskCreateAdhocConflicts,
  checkTaskCreateRequiredFlags,
  formatAdhocAcScopeMissingError,
  formatTaskCreateAdhocConflictError,
  isAdhocAcScopeDeclarationMissing,
  resolveAcScopeForCreate,
} from "../../../src/adapters/cli/create-task-validation.js";
import type { CreateDocInput, PlanBundle } from "@lore/core";
import { actedStore } from "../../live-invocation.js";

// ─── Fixture helpers ────────────────────────────────────────────────────────

function makeServices(ttl = 120) {
  const store = actedStore(new InMemoryStore());
  const corpusService = new CorpusService(store, new RecordLockService(store, new GateEnforcer(undefined)));
  const taskWorkflowService = new TaskWorkflowService(store, undefined, { claimTtlMinutes: ttl });
  return { store, corpusService, taskWorkflowService };
}

async function createRootPrd(cs: CorpusService, title = "Root PRD"): Promise<string> {
  const result = await cs.create({ type: "prd", title, content: "root" } as CreateDocInput);
  if (!result.ok) throw new Error(`Failed to create prd: ${JSON.stringify(result.error)}`);
  return result.value.id;
}

async function createPlan(cs: CorpusService, title = "Test Plan"): Promise<string> {
  const result = await cs.create({ type: "plan", title, content: "body" } as CreateDocInput);
  if (!result.ok) throw new Error(`Failed to create plan: ${JSON.stringify(result.error)}`);
  return result.value.id;
}

async function createTask(
  cs: CorpusService,
  planId: string,
  title = "Test Task",
  extraOpts: Record<string, unknown> = {},
): Promise<string> {
  const result = await cs.create({
    type: "task",
    title,
    parent_id: planId,
    content: "body",
    extra: { plan_id: planId, ...extraOpts },
  } as CreateDocInput);
  if (!result.ok) throw new Error(`Failed to create task: ${JSON.stringify(result.error)}`);
  return result.value.id;
}

// ─── AC-069-5: --adhoc creation + CLI mutual exclusion ─────────────────────

describe("AC-069-5: create task --adhoc — CLI single-pass validation (pure)", () => {
  // ── HAPPY ──────────────────────────────────────────────────────────────

  it("AC-069-5: --adhoc alone (no --plan-id/--parent) reports nothing missing", () => {
    const missing = checkTaskCreateRequiredFlags({
      planId: undefined,
      parent: undefined,
      adhoc: true,
    });
    expect(missing).toEqual([]);
  });

  it("AC-069-5: --adhoc alone reports zero conflicts", () => {
    const conflicts = checkTaskCreateAdhocConflicts({
      planId: undefined,
      parent: undefined,
      adhoc: true,
    });
    expect(conflicts).toEqual([]);
  });

  // ── NEGATIVE ───────────────────────────────────────────────────────────

  it("AC-069-5: --adhoc + --plan-id is a mutual-exclusion conflict (exit-2 shape)", () => {
    const conflicts = checkTaskCreateAdhocConflicts({
      planId: "plan-x",
      parent: undefined,
      adhoc: true,
    });
    expect(conflicts).toEqual(["--plan-id"]);
  });

  it("AC-069-5: the formatted conflict message names --adhoc and --plan-id", () => {
    const conflicts = checkTaskCreateAdhocConflicts({
      planId: "plan-x",
      parent: undefined,
      adhoc: true,
    });
    const message = formatTaskCreateAdhocConflictError(conflicts);
    expect(message).toContain("--adhoc");
    expect(message).toContain("--plan-id");
    // single message, not a stacked pair — one "Error:" prefix
    expect(message.match(/Error:/g)?.length).toBe(1);
  });

  it("--adhoc + --phase is ALSO a conflict (plan-scoped grouping, no plan to belong to)", () => {
    const conflicts = checkTaskCreateAdhocConflicts({
      planId: undefined,
      parent: undefined,
      adhoc: true,
      phase: "Phase 1",
    });
    expect(conflicts).toEqual(["--phase"]);
  });

  it("--adhoc + --linkage is a conflict (D3: one says no plan, the other justifies one)", () => {
    const conflicts = checkTaskCreateAdhocConflicts({
      planId: undefined,
      parent: undefined,
      adhoc: true,
      linkage: "found while testing",
    });
    expect(conflicts).toEqual(["--linkage"]);
  });

  it("all three conflicts are reported together in ONE pass, --plan-id first", () => {
    const conflicts = checkTaskCreateAdhocConflicts({
      planId: "plan-x",
      parent: undefined,
      adhoc: true,
      phase: "Phase 1",
      linkage: "why",
    });
    expect(conflicts).toEqual(["--plan-id", "--phase", "--linkage"]);
  });

  // ── BOUNDARY ───────────────────────────────────────────────────────────

  it("BOUNDARY: --adhoc=false (falsy) behaves exactly like --adhoc omitted — required flags still enforced", () => {
    const missing = checkTaskCreateRequiredFlags({ planId: undefined, parent: undefined, adhoc: false });
    expect(missing).toEqual(["--plan-id", "--parent"]);
  });

  it("BOUNDARY: --adhoc not set at all → checkTaskCreateAdhocConflicts is a no-op regardless of other flags", () => {
    const conflicts = checkTaskCreateAdhocConflicts({
      planId: "plan-x",
      parent: undefined,
      phase: "P1",
      linkage: "why",
    });
    expect(conflicts).toEqual([]);
  });

  // ── STATE ──────────────────────────────────────────────────────────────

  it("STATE: --adhoc true short-circuits checkTaskCreateRequiredFlags before any other flag is inspected", () => {
    // even with --plan-id/--parent ALSO both absent, --adhoc alone makes the
    // required-flags check a pure no-op — the two concerns never double-report.
    const missing = checkTaskCreateRequiredFlags({ planId: undefined, parent: undefined, adhoc: true });
    expect(missing).toEqual([]);
  });

  // ── REGRESSION ─────────────────────────────────────────────────────────

  it("REGRESSION: pre-SPEC-069 callers passing only {planId, parent} (no adhoc field) are unaffected", () => {
    expect(checkTaskCreateRequiredFlags({ planId: "plan-x", parent: undefined })).toEqual([]);
    expect(checkTaskCreateRequiredFlags({ planId: undefined, parent: undefined })).toEqual([
      "--plan-id",
      "--parent",
    ]);
    expect(checkTaskCreateAdhocConflicts({ planId: "plan-x", parent: undefined })).toEqual([]);
  });
});

// ─── The ad-hoc branch of --ac-scope requiredness (pure) ─────────────────────
//
// task-an-ad-hoc-task-can-never-reach-the-attestation-path-that. The plan
// branch's requiredness is a service-side gate predicate keyed on the parent
// plan's spec lineage; `--adhoc` guarantees that lineage is absent, so the
// ad-hoc branch is keyed on the author's flag at the CLI layer instead.

describe("isAdhocAcScopeDeclarationMissing — ad-hoc --ac-scope requiredness (pure)", () => {
  const adhoc = { planId: undefined, parent: undefined, adhoc: true };

  // ── NEGATIVE (the refusal this exists for) ────────────────────────────────

  it("NEGATIVE: --adhoc with --ac-scope never passed is missing its declaration", () => {
    expect(isAdhocAcScopeDeclarationMissing(adhoc, false)).toBe(true);
  });

  // ── HAPPY ────────────────────────────────────────────────────────────────

  it("HAPPY: --adhoc with --ac-scope passed satisfies the requirement", () => {
    expect(isAdhocAcScopeDeclarationMissing(adhoc, true)).toBe(false);
  });

  // ── BOUNDARY ─────────────────────────────────────────────────────────────

  it("BOUNDARY: the bit read is PASSED, not non-empty — `--ac-scope \"\"` (passed, zero ids) satisfies it", () => {
    // resolveAcScopeForCreate("") => { passed: true, ids: [] }: an explicitly
    // empty declaration is an auditable claim, distinct from an absent key.
    expect(isAdhocAcScopeDeclarationMissing(adhoc, resolveAcScopeForCreate("").passed)).toBe(false);
    expect(isAdhocAcScopeDeclarationMissing(adhoc, resolveAcScopeForCreate(undefined).passed)).toBe(true);
  });

  it("BOUNDARY: --adhoc=false (falsy) behaves exactly like --adhoc omitted — no requirement", () => {
    expect(isAdhocAcScopeDeclarationMissing({ planId: undefined, parent: undefined, adhoc: false }, false)).toBe(
      false,
    );
  });

  // ── STATE ────────────────────────────────────────────────────────────────

  it("STATE: the check reads ONLY the adhoc flag — --phase/--linkage/--plan-id never affect it", () => {
    // (those are the mutual-exclusion family's business, reported first and
    // separately, so the two concerns can never double-report)
    expect(
      isAdhocAcScopeDeclarationMissing(
        { planId: "plan-x", parent: "plan-x", adhoc: true, phase: "P1", linkage: "why" },
        false,
      ),
    ).toBe(true);
  });

  // ── REGRESSION (the plan branch stays byte-identical) ────────────────────

  it("REGRESSION: a plan-parented task with no --ac-scope is NOT refused here — the gate predicate still owns it", () => {
    expect(isAdhocAcScopeDeclarationMissing({ planId: "plan-x", parent: "plan-x" }, false)).toBe(false);
    expect(isAdhocAcScopeDeclarationMissing({ planId: undefined, parent: "spec-x" }, false)).toBe(false);
  });

  // ── ERROR (the message an author acts on) ─────────────────────────────────

  it("ERROR: the refusal message names both legal forms — real ids AND the explicit-empty declaration", () => {
    const message = formatAdhocAcScopeMissingError();
    expect(message).toContain("--adhoc");
    expect(message).toContain("--ac-scope");
    expect(message).toContain('--ac-scope ""');
    // names the reason, so the author learns WHY rather than just obeying
    expect(message).toContain("lore verify");
  });
});

describe("AC-069-5: CorpusService.create — extra.adhoc service-layer behavior", () => {
  // ── HAPPY ──────────────────────────────────────────────────────────────

  it("AC-069-5: an --adhoc task with no parent_id/plan_id succeeds, sets extra.adhoc, parents to the root PRD", async () => {
    const { corpusService } = makeServices();
    const rootPrdId = await createRootPrd(corpusService);

    const result = await corpusService.create({
      type: "task",
      title: "Ad-hoc bugfix",
      content: "found mid-plan",
      extra: { adhoc: true },
    } as CreateDocInput);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.extra["adhoc"]).toBe(true);
    expect(result.value.parent_id).toBe(rootPrdId);
    expect(result.value.extra["plan_id"]).toBeUndefined();
  });

  // ── NEGATIVE ───────────────────────────────────────────────────────────

  it("a NON-adhoc task with no plan_id still fails loud (plan_id required unless adhoc)", async () => {
    const { corpusService } = makeServices();
    await createRootPrd(corpusService);

    const result = await corpusService.create({
      type: "task",
      title: "Missing plan",
      extra: {},
    } as CreateDocInput);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code === "VALIDATION_ERROR" || result.error.code === "PARENT_REQUIRED").toBe(true);
  });

  it("an --adhoc task fails loud when the corpus has no root PRD to parent to", async () => {
    const { corpusService } = makeServices(); // no PRD created

    const result = await corpusService.create({
      type: "task",
      title: "Orphaned ad-hoc",
      extra: { adhoc: true },
    } as CreateDocInput);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("VALIDATION_ERROR");
  });

  // ── BOUNDARY ───────────────────────────────────────────────────────────

  it("BOUNDARY: an explicit parent_id on an --adhoc task WINS over root-PRD auto-parenting", async () => {
    const { corpusService } = makeServices();
    await createRootPrd(corpusService);
    const planId = await createPlan(corpusService);

    const result = await corpusService.create({
      type: "task",
      title: "Explicitly parented but adhoc",
      parent_id: planId,
      extra: { adhoc: true },
    } as CreateDocInput);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // reason: the auto-parenting block only fires when parent_id is UNDEFINED —
    // an explicitly supplied parent_id is never overridden.
    expect(result.value.parent_id).toBe(planId);
  });

  // ── STATE ──────────────────────────────────────────────────────────────

  it("STATE: two --adhoc tasks created in sequence both parent to the SAME root PRD", async () => {
    const { corpusService } = makeServices();
    const rootPrdId = await createRootPrd(corpusService);

    const r1 = await corpusService.create({
      type: "task",
      title: "Ad-hoc one",
      extra: { adhoc: true },
    } as CreateDocInput);
    const r2 = await corpusService.create({
      type: "task",
      title: "Ad-hoc two",
      extra: { adhoc: true },
    } as CreateDocInput);

    expect(r1.ok && r2.ok).toBe(true);
    if (!r1.ok || !r2.ok) return;
    expect(r1.value.parent_id).toBe(rootPrdId);
    expect(r2.value.parent_id).toBe(rootPrdId);
  });

  // ── REGRESSION ─────────────────────────────────────────────────────────

  it("REGRESSION: a normal --plan-id task's creation is byte-unaffected by the adhoc branch", async () => {
    const { corpusService } = makeServices();
    const planId = await createPlan(corpusService);

    const result = await corpusService.create({
      type: "task",
      title: "Normal task",
      parent_id: planId,
      extra: { plan_id: planId },
    } as CreateDocInput);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.parent_id).toBe(planId);
    expect(result.value.extra["adhoc"]).toBeUndefined();
  });
});

// ─── AC-069-6: --linkage verbatim storage ───────────────────

describe("AC-069-6: --linkage stores extra.linkage verbatim", () => {
  // ── HAPPY ──────────────────────────────────────────────────────────────

  it("AC-069-6: extra.linkage is stored VERBATIM on a --plan-id task", async () => {
    const { corpusService } = makeServices();
    const planId = await createPlan(corpusService);

    const linkageText = "found while testing X — attaching here since it blocks the same rollout";
    const result = await corpusService.create({
      type: "task",
      title: "Linked-but-explained",
      parent_id: planId,
      extra: { plan_id: planId, linkage: linkageText },
    } as CreateDocInput);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.extra["linkage"]).toBe(linkageText);
  });
});

// ─── AC-069-7: lore ready regression + --adhoc listing ─────────────────────

describe("AC-069-7: lore ready <plan> regression (plan-task output unchanged)", () => {
  // ── HAPPY / REGRESSION ─────────────────────────────────────────────────

  it("REGRESSION: ready(plan) output shape for ordinary plan tasks is unaffected by the adhoc channel", async () => {
    const { corpusService, taskWorkflowService } = makeServices();
    const planId = await createPlan(corpusService);
    const taskId = await createTask(corpusService, planId, "Plan task");

    const result = await taskWorkflowService.ready(planId);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.records).toHaveLength(1);
    const record = result.value.records[0];
    expect(record?.task.id).toBe(taskId);
    expect(record?.ready).toBe(true);
    expect(record?.unmet_blockers).toEqual([]);
    expect(result.value.sessions).toEqual([]);
    expect(result.value.anchor_conflicts).toEqual([]);
  });

  it("REGRESSION: an ad-hoc task never appears in a plan's ready() report (it has no plan_id to belong to)", async () => {
    const { corpusService, taskWorkflowService } = makeServices();
    await createRootPrd(corpusService);
    const planId = await createPlan(corpusService);
    await createTask(corpusService, planId, "Plan task");
    await corpusService.create({
      type: "task",
      title: "Stray adhoc",
      extra: { adhoc: true },
    } as CreateDocInput);

    const result = await taskWorkflowService.ready(planId);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.records).toHaveLength(1);
    expect(result.value.records[0]?.task.title).toBe("Plan task");
  });
});

describe("AC-069-7: readyAdhoc() lists OPEN ad-hoc tasks corpus-wide", () => {
  // ── HAPPY ──────────────────────────────────────────────────────────────

  it("AC-069-7: an open --adhoc task is listed by readyAdhoc()", async () => {
    const { corpusService, taskWorkflowService } = makeServices();
    await createRootPrd(corpusService);
    const created = await corpusService.create({
      type: "task",
      title: "Stray bugfix",
      extra: { adhoc: true },
    } as CreateDocInput);
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const result = await taskWorkflowService.readyAdhoc();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toHaveLength(1);
    expect(result.value[0]?.task.id).toBe(created.value.id);
    expect(result.value[0]?.ready).toBe(true);
  });

  // ── NEGATIVE ───────────────────────────────────────────────────────────

  it("a --plan-id (non-adhoc) task is NEVER listed by readyAdhoc()", async () => {
    const { corpusService, taskWorkflowService } = makeServices();
    const planId = await createPlan(corpusService);
    await createTask(corpusService, planId, "Ordinary plan task");

    const result = await taskWorkflowService.readyAdhoc();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual([]);
  });

  it("a CLOSED (archived) ad-hoc task is NOT listed — 'open' excludes terminal status", async () => {
    const { corpusService, taskWorkflowService } = makeServices();
    await createRootPrd(corpusService);
    const created = await corpusService.create({
      type: "task",
      title: "Done adhoc",
      extra: { adhoc: true },
    } as CreateDocInput);
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    await corpusService.set(created.value.id, { status: "approved" });
    await corpusService.set(created.value.id, { status: "archived" });

    const result = await taskWorkflowService.readyAdhoc();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual([]);
  });

  // ── BOUNDARY ───────────────────────────────────────────────────────────

  it("BOUNDARY: an empty corpus (no tasks at all) yields an empty array, not an error", async () => {
    const { taskWorkflowService } = makeServices();
    const result = await taskWorkflowService.readyAdhoc();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual([]);
  });

  // ── STATE ──────────────────────────────────────────────────────────────

  it("STATE: readyAdhoc() reflects a claim placed on an ad-hoc task", async () => {
    const { corpusService, taskWorkflowService } = makeServices();
    await createRootPrd(corpusService);
    const created = await corpusService.create({
      type: "task",
      title: "Claimed adhoc",
      extra: { adhoc: true },
    } as CreateDocInput);
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    await taskWorkflowService.claim(created.value.id, { by: "alice" });

    const result = await taskWorkflowService.readyAdhoc();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value[0]?.claim?.by).toBe("alice");
  });

  // ── ERROR ──────────────────────────────────────────────────────────────

  it("readyAdhoc() never fails loud on a mixed corpus of adhoc/non-adhoc/deleted docs", async () => {
    const { corpusService, taskWorkflowService } = makeServices();
    await createRootPrd(corpusService);
    const planId = await createPlan(corpusService);
    await createTask(corpusService, planId, "Ordinary task");
    const adhocResult = await corpusService.create({
      type: "task",
      title: "Ad-hoc task",
      extra: { adhoc: true },
    } as CreateDocInput);
    expect(adhocResult.ok).toBe(true);
    if (!adhocResult.ok) return;
    const deletedAdhoc = await corpusService.create({
      type: "task",
      title: "Deleted ad-hoc",
      extra: { adhoc: true },
    } as CreateDocInput);
    expect(deletedAdhoc.ok).toBe(true);
    if (!deletedAdhoc.ok) return;
    await corpusService.delete(deletedAdhoc.value.id, true);

    const result = await taskWorkflowService.readyAdhoc();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // reason: findMany's default exclude_deleted:true drops the soft-deleted task —
    // only the ONE live, open, adhoc task remains.
    expect(result.value).toHaveLength(1);
    expect(result.value[0]?.task.id).toBe(adhocResult.value.id);
  });

  // ── REGRESSION ─────────────────────────────────────────────────────────

  it("REGRESSION (SPEC-072): a plain --adhoc task with no extra.issue_report is NOT review-gated — draft status still appears", async () => {
    const { corpusService, taskWorkflowService } = makeServices();
    await createRootPrd(corpusService);
    const created = await corpusService.create({
      type: "task",
      title: "Self-authored ad-hoc, still draft",
      extra: { adhoc: true },
    } as CreateDocInput);
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    // reason: default creation status is "draft" (CorpusService) — this task
    // is deliberately left unapproved to prove the SPEC-072 issue-report
    // review-gate carve-out is scoped to `extra.issue_report` tasks only.
    expect(created.value.status).toBe("draft");
    expect(created.value.extra["issue_report"]).toBeUndefined();

    const result = await taskWorkflowService.readyAdhoc();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toHaveLength(1);
    expect(result.value[0]?.task.id).toBe(created.value.id);
  });

  it("REGRESSION (SPEC-072): an issue-report ad-hoc task IS excluded while draft/in-review, but a plain one alongside it is not", async () => {
    const { corpusService, taskWorkflowService } = makeServices();
    await createRootPrd(corpusService);
    const plainAdhoc = await corpusService.create({
      type: "task",
      title: "Plain ad-hoc",
      extra: { adhoc: true },
    } as CreateDocInput);
    const issueReportAdhoc = await corpusService.create({
      type: "task",
      title: "Foreign issue report",
      extra: {
        adhoc: true,
        issue_report: {
          reporter_project: "consumer-corpus",
          reporter_actor: "agent:someone",
          lore_version: "0.0.0",
          expected: "exit 0",
          actual: "exit 4",
          reported_at: "2026-01-01T00:00:00.000Z",
        },
      },
    } as CreateDocInput);
    expect(plainAdhoc.ok && issueReportAdhoc.ok).toBe(true);
    if (!plainAdhoc.ok || !issueReportAdhoc.ok) return;
    expect(plainAdhoc.value.status).toBe("draft");
    expect(issueReportAdhoc.value.status).toBe("draft");

    const result = await taskWorkflowService.readyAdhoc();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const ids = result.value.map((r) => r.task.id);
    expect(ids).toContain(plainAdhoc.value.id);
    expect(ids).not.toContain(issueReportAdhoc.value.id);

    // Once approved, the (formerly gated) issue-report task appears too.
    await corpusService.set(issueReportAdhoc.value.id, { status: "approved" });
    const resultAfterApprove = await taskWorkflowService.readyAdhoc();
    expect(resultAfterApprove.ok).toBe(true);
    if (!resultAfterApprove.ok) return;
    const idsAfterApprove = resultAfterApprove.value.map((r) => r.task.id);
    expect(idsAfterApprove).toContain(plainAdhoc.value.id);
    expect(idsAfterApprove).toContain(issueReportAdhoc.value.id);
  });

  it("REGRESSION: readyAdhoc() performs zero writes (task version is unchanged after the call)", async () => {
    const { corpusService, taskWorkflowService } = makeServices();
    await createRootPrd(corpusService);
    const created = await corpusService.create({
      type: "task",
      title: "Untouched adhoc",
      extra: { adhoc: true },
    } as CreateDocInput);
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const versionBefore = created.value.version;

    await taskWorkflowService.readyAdhoc();

    const found = await corpusService.get(created.value.id);
    expect(found.ok).toBe(true);
    if (!found.ok) return;
    expect(found.value.doc.version).toBe(versionBefore);
  });
});
