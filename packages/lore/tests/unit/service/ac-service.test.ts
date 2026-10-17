// @layer service-ac-service AC-WH-1 AC-ACODE-3
/**
 * Six-dimension tests for AcService (SPEC-038 §4, §6, §7 D4).
 * Uses InMemoryStore + CorpusService (fixture builder only) — no file I/O, no SQLite.
 *
 * Dimension mapping:
 *   HAPPY:      addCriterion on a clean spec persists + bumps version + writes one
 *               versions row and one audit entry; listCriteria round-trips it;
 *               removeCriterion with zero referencing evidence succeeds unforced
 *   NEGATIVE:   malformed criterion (missing `command` for script mode, bad id
 *               format) → VALIDATION_ERROR, doc unchanged; duplicate id rejected
 *   BOUNDARY:   51st criterion on an already-full (50-entry) spec → VALIDATION_ERROR,
 *               doc unchanged
 *   ERROR:      nonexistent spec id → DOC_NOT_FOUND (all three methods); a
 *               resolvable-but-wrong-type doc (a plan) → VALIDATION_ERROR field "type"
 *   STATE:      removeCriterion blocked by referencing evidence unless --force; forced
 *               removal leaves evidence's ac_ref "dangling" (visible via listCriteria);
 *               spec.version accumulates across sequential addCriterion calls
 *   REGRESSION: listCriteria's `coverage` is `null` (not `[]`/undefined) with no child
 *               plan at all, but a non-null all-zero array once a plan exists with zero
 *               tasks — the null/[] distinction is the behavior under regression risk
 *
 * task-an-ad-hoc-task-s-attested-evidence-cannot-carry-ac-ref adds
 * `findAdhocGovernedTasks` — listCriteria's coverage additionally folds in
 * `--adhoc` tasks whose declared ac_scope resolves unambiguously to the spec
 * (own describe blocks below, search "ad-hoc"):
 *   HAPPY:      an ad-hoc task's evidence counts toward coverage even with NO
 *               child plan at all (coverage flips from null to non-null)
 *   NEGATIVE:   an ad-hoc task whose ac_scope resolves to a DIFFERENT spec is
 *               excluded from this spec's coverage (never cross-counted)
 *   BOUNDARY:   an ad-hoc task with no declared ac_scope contributes nothing
 *               and never errors listCriteria
 *   STATE:      plan-owned tasks and governed ad-hoc tasks both contribute to
 *               the SAME AcCoverageFact simultaneously
 *   REGRESSION: a spec with zero plans AND zero ad-hoc tasks still yields
 *               coverage: null (the pre-existing null/[] distinction, unchanged)
 *
 * @spec_ref AC-ACODE-2 AC-ACODE-3 AC-ACODE-7
 */

import { RecordLockService } from "../../../src/service/record-lock-service.js";
import { GateEnforcer } from "../../../src/service/gate-enforcer.js";
import { describe, it, expect } from "vitest";
import { InMemoryStore } from "../../../src/store/in-memory-store.js";
import { CorpusService } from "../../../src/service/corpus-service.js";
import { AcService } from "../../../src/service/ac-service.js";
import type { CreateDocInput } from "@lore/core";

// ─── Fixture helpers ──────────────────────────────────────────────────────────

function makeServices() {
  const store = new InMemoryStore();
  const corpusService = new CorpusService(store, new RecordLockService(store, new GateEnforcer(undefined)));
  const acService = new AcService(store, new RecordLockService(store, new GateEnforcer(undefined)));
  return { store, corpusService, acService };
}

async function createPrd(cs: CorpusService, title = "Test PRD"): Promise<string> {
  const result = await cs.create({ type: "prd", title, content: "root" } as CreateDocInput);
  if (!result.ok) throw new Error(`Failed to create prd: ${JSON.stringify(result.error)}`);
  return result.value.id;
}

async function createSpec(cs: CorpusService, parentId: string, title = "Test Spec"): Promise<string> {
  const result = await cs.create({
    type: "spec",
    title,
    content: "spec body",
  } as CreateDocInput);
  if (!result.ok) throw new Error(`Failed to create spec: ${JSON.stringify(result.error)}`);
  return result.value.id;
}

async function createPlan(cs: CorpusService, parentId: string, title = "Test Plan"): Promise<string> {
  const result = await cs.create({
    type: "plan",
    title,
    parent_id: parentId,
    content: "plan body",
  } as CreateDocInput);
  if (!result.ok) throw new Error(`Failed to create plan: ${JSON.stringify(result.error)}`);
  return result.value.id;
}

async function createTask(cs: CorpusService, planId: string, title = "Test Task"): Promise<string> {
  const result = await cs.create({
    type: "task",
    title,
    parent_id: planId,
    content: "task body",
    extra: { plan_id: planId },
  } as CreateDocInput);
  if (!result.ok) throw new Error(`Failed to create task: ${JSON.stringify(result.error)}`);
  return result.value.id;
}

/**
 * An `--adhoc` task (SPEC-069 D2) parented to the corpus root PRD, with a
 * declared `ac_scope` — task-an-ad-hoc-task-s-attested-evidence-cannot-carry-
 * ac-ref's `findAdhocGovernedTasks` describe blocks below. Callers must have
 * already created a root PRD (createPrd) for the auto-parenting to succeed.
 */
async function createAdhocTask(
  cs: CorpusService,
  acScope: string[],
  title = "Ad-hoc Task",
): Promise<string> {
  const result = await cs.create({
    type: "task",
    title,
    content: "found mid-plan",
    extra: { adhoc: true, ac_scope: acScope },
  } as CreateDocInput);
  if (!result.ok) throw new Error(`Failed to create adhoc task: ${JSON.stringify(result.error)}`);
  return result.value.id;
}

/** Directly writes verification_evidence with an ac_ref onto an existing task (bypasses TaskWorkflowService — this file tests AcService's own read-side aggregation, not the write-path validation covered in task-workflow-service.test.ts). */
async function recordEvidenceDirect(
  store: InMemoryStore,
  taskId: string,
  acRef: string,
  result: "pass" | "fail" = "pass",
): Promise<void> {
  const taskBefore = await store.find(taskId);
  if (!taskBefore.ok || taskBefore.value === null) throw new Error("task fetch failed");
  await store.update(taskId, {
    extra: {
      ...taskBefore.value.extra,
      verification_evidence: [
        ...(Array.isArray(taskBefore.value.extra["verification_evidence"])
          ? (taskBefore.value.extra["verification_evidence"] as unknown[])
          : []),
        {
          oracle: "test",
          command: "bunx vitest run x.test.ts",
          result,
          recorded_at: new Date().toISOString(),
          recorded_by: "tester",
          ac_ref: acRef,
        },
      ],
    },
  });
}

/** Full spec→plan chain in one call, returning both ids (spec has no tasks yet). */
async function createSpecWithPlan(
  cs: CorpusService,
): Promise<{ specId: string; planId: string }> {
  const prdId = await createPrd(cs);
  const specId = await createSpec(cs, prdId);
  const planId = await createPlan(cs, specId);
  return { specId, planId };
}

function criterion(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "AC-X-1",
    statement: "Does the thing",
    verify: { mode: "script", oracle: "test", command: "bun test x" },
    ...overrides,
  };
}

// ─── HAPPY ─────────────────────────────────────────────────────────────────

describe("HAPPY — addCriterion / listCriteria / removeCriterion round-trip (AC-ACODE-2, AC-ACODE-7)", () => {
  it("addCriterion on a spec with no existing criteria persists the new entry, bumps version, and writes one versions row + one audit entry", async () => {
    const { store, corpusService, acService } = makeServices();
    const prdId = await createPrd(corpusService);
    const specId = await createSpec(corpusService, prdId);

    const before = await store.find(specId);
    if (!before.ok || before.value === null) throw new Error("spec fetch failed");
    const versionBefore = before.value.version;

    const result = await acService.addCriterion(specId, criterion());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual([criterion()]);

    const after = await store.find(specId);
    if (!after.ok || after.value === null) throw new Error("spec re-fetch failed");
    expect(after.value.extra["acceptance_criteria"]).toEqual([criterion()]);
    expect(after.value.version).toBe(versionBefore + 1);

    const versions = await store.findVersions(specId);
    expect(versions.ok).toBe(true);
    if (!versions.ok) return;
    const latestVersion = versions.value[0];
    expect(latestVersion?.action).toBe("update");
    expect(latestVersion?.version).toBe(versionBefore + 1);

    const audit = await store.queryAudit({ doc_id: specId });
    expect(audit.ok).toBe(true);
    if (!audit.ok) return;
    const acAuditEntries = audit.value.filter((e) => e.action === "update");
    expect(acAuditEntries.length).toBeGreaterThanOrEqual(1);
  });

  it("listCriteria round-trips the exact criterion added", async () => {
    const { corpusService, acService } = makeServices();
    const prdId = await createPrd(corpusService);
    const specId = await createSpec(corpusService, prdId);

    await acService.addCriterion(specId, criterion());
    const listed = await acService.listCriteria(specId);
    expect(listed.ok).toBe(true);
    if (!listed.ok) return;
    expect(listed.value.criteria).toEqual([criterion()]);
  });

  it("removeCriterion succeeds without --force when zero task evidence references it", async () => {
    const { corpusService, acService } = makeServices();
    const prdId = await createPrd(corpusService);
    const specId = await createSpec(corpusService, prdId);
    await acService.addCriterion(specId, criterion());

    const removed = await acService.removeCriterion(specId, "AC-X-1");
    expect(removed.ok).toBe(true);
    if (!removed.ok) return;
    expect(removed.value).toEqual([]);
  });
});

// ─── NEGATIVE ─────────────────────────────────────────────────────────────────

describe("NEGATIVE — malformed criterion rejected, doc unchanged (AC-ACODE-2)", () => {
  it("a script-mode criterion missing `command` fails VALIDATION_ERROR without mutating the spec", async () => {
    const { store, corpusService, acService } = makeServices();
    const prdId = await createPrd(corpusService);
    const specId = await createSpec(corpusService, prdId);
    const before = await store.find(specId);
    if (!before.ok || before.value === null) throw new Error("spec fetch failed");

    const bad = { id: "AC-X-1", statement: "Does the thing", verify: { mode: "script", oracle: "test" } };
    const result = await acService.addCriterion(specId, bad);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("VALIDATION_ERROR");

    const after = await store.find(specId);
    if (!after.ok || after.value === null) throw new Error("spec re-fetch failed");
    expect(after.value.version).toBe(before.value.version);
    expect(after.value.extra["acceptance_criteria"]).toBeUndefined();
  });

  it("an id not matching the AC-<SEGMENT>(-<SEGMENT>)* format fails VALIDATION_ERROR without mutating the spec", async () => {
    const { store, corpusService, acService } = makeServices();
    const prdId = await createPrd(corpusService);
    const specId = await createSpec(corpusService, prdId);
    const before = await store.find(specId);
    if (!before.ok || before.value === null) throw new Error("spec fetch failed");

    const bad = criterion({ id: "not-a-valid-id" });
    const result = await acService.addCriterion(specId, bad);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("VALIDATION_ERROR");

    const after = await store.find(specId);
    if (!after.ok || after.value === null) throw new Error("spec re-fetch failed");
    expect(after.value.version).toBe(before.value.version);
  });

  it("a duplicate id on a second addCriterion call fails VALIDATION_ERROR", async () => {
    const { corpusService, acService } = makeServices();
    const prdId = await createPrd(corpusService);
    const specId = await createSpec(corpusService, prdId);

    const first = await acService.addCriterion(specId, criterion());
    expect(first.ok).toBe(true);

    const second = await acService.addCriterion(specId, criterion({ statement: "A different statement" }));
    expect(second.ok).toBe(false);
    if (second.ok) return;
    expect(second.error.code).toBe("VALIDATION_ERROR");

    // Only the first entry survives.
    const listed = await acService.listCriteria(specId);
    expect(listed.ok).toBe(true);
    if (!listed.ok) return;
    expect(listed.value.criteria).toHaveLength(1);
    expect(listed.value.criteria[0]?.statement).toBe("Does the thing");
  });
});

// ─── BOUNDARY ─────────────────────────────────────────────────────────────────

describe("BOUNDARY — 51st criterion rejected on an already-full spec (AC-ACODE-2)", () => {
  it("addCriterion on a spec that already has 50 declared criteria fails VALIDATION_ERROR, doc unchanged", async () => {
    const { store, corpusService, acService } = makeServices();
    const prdId = await createPrd(corpusService);
    const specId = await createSpec(corpusService, prdId);

    // Seed 50 valid criteria directly via store.update — a boundary probe on
    // addCriterion's OWN cap-check, not a round-trip test of every entry.
    const fifty = Array.from({ length: 50 }, (_, i) => criterion({ id: `AC-SEED-${i}` }));
    const seedResult = await store.update(specId, { extra: { acceptance_criteria: fifty } });
    expect(seedResult.ok).toBe(true);

    const before = await store.find(specId);
    if (!before.ok || before.value === null) throw new Error("spec fetch failed");
    expect((before.value.extra["acceptance_criteria"] as unknown[]).length).toBe(50);
    const versionBefore = before.value.version;

    const overflow = await acService.addCriterion(specId, criterion({ id: "AC-SEED-51" }));
    expect(overflow.ok).toBe(false);
    if (overflow.ok) return;
    expect(overflow.error.code).toBe("VALIDATION_ERROR");

    const after = await store.find(specId);
    if (!after.ok || after.value === null) throw new Error("spec re-fetch failed");
    expect(after.value.version).toBe(versionBefore);
    expect((after.value.extra["acceptance_criteria"] as unknown[]).length).toBe(50);
  });
});

// ─── ERROR ────────────────────────────────────────────────────────────────────

describe("ERROR — nonexistent spec id (all three methods)", () => {
  it("addCriterion against a nonexistent spec id → DOC_NOT_FOUND", async () => {
    const { acService } = makeServices();
    const result = await acService.addCriterion("spec-does-not-exist", criterion());
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("DOC_NOT_FOUND");
  });

  it("listCriteria against a nonexistent spec id → DOC_NOT_FOUND", async () => {
    const { acService } = makeServices();
    const result = await acService.listCriteria("spec-does-not-exist");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("DOC_NOT_FOUND");
  });

  it("removeCriterion against a nonexistent spec id → DOC_NOT_FOUND", async () => {
    const { acService } = makeServices();
    const result = await acService.removeCriterion("spec-does-not-exist", "AC-X-1");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("DOC_NOT_FOUND");
  });
});

describe("ERROR — a resolvable-but-wrong-type doc (a plan) rejected with field 'type'", () => {
  it("addCriterion against a plan id → VALIDATION_ERROR, field 'type'", async () => {
    const { corpusService, acService } = makeServices();
    const prdId = await createPrd(corpusService);
    const specId = await createSpec(corpusService, prdId);
    const planId = await createPlan(corpusService, specId);

    const result = await acService.addCriterion(planId, criterion());
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("VALIDATION_ERROR");
    if (result.error.code !== "VALIDATION_ERROR") return;
    expect(result.error.field).toBe("type");
  });

  it("listCriteria against a plan id → VALIDATION_ERROR, field 'type'", async () => {
    const { corpusService, acService } = makeServices();
    const prdId = await createPrd(corpusService);
    const specId = await createSpec(corpusService, prdId);
    const planId = await createPlan(corpusService, specId);

    const result = await acService.listCriteria(planId);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("VALIDATION_ERROR");
    if (result.error.code !== "VALIDATION_ERROR") return;
    expect(result.error.field).toBe("type");
  });

  it("removeCriterion against a plan id → VALIDATION_ERROR, field 'type'", async () => {
    const { corpusService, acService } = makeServices();
    const prdId = await createPrd(corpusService);
    const specId = await createSpec(corpusService, prdId);
    const planId = await createPlan(corpusService, specId);

    const result = await acService.removeCriterion(planId, "AC-X-1");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("VALIDATION_ERROR");
    if (result.error.code !== "VALIDATION_ERROR") return;
    expect(result.error.field).toBe("type");
  });
});

// ─── STATE ────────────────────────────────────────────────────────────────────

describe("STATE — removeCriterion blocked by referencing evidence, --force leaves it dangling (AC-ACODE-7)", () => {
  it("removeCriterion without --force fails when a task under a child plan has evidence referencing the id", async () => {
    const { store, corpusService, acService } = makeServices();
    const { specId, planId } = await createSpecWithPlan(corpusService);
    const taskId = await createTask(corpusService, planId);

    await acService.addCriterion(specId, criterion());

    const taskBefore = await store.find(taskId);
    if (!taskBefore.ok || taskBefore.value === null) throw new Error("task fetch failed");
    await store.update(taskId, {
      extra: {
        ...taskBefore.value.extra,
        verification_evidence: [
          {
            oracle: "test",
            command: "x",
            result: "pass",
            recorded_at: new Date().toISOString(),
            recorded_by: "tester",
            ac_ref: "AC-X-1",
          },
        ],
      },
    });

    const blocked = await acService.removeCriterion(specId, "AC-X-1");
    expect(blocked.ok).toBe(false);
    if (blocked.ok) return;
    expect(blocked.error.code).toBe("VALIDATION_ERROR");
    if (blocked.error.code !== "VALIDATION_ERROR") return;
    expect(blocked.error.message).toMatch(/--force|evidence/i);

    // Criterion must still be declared — the rejected removal must not have mutated it.
    const stillListed = await acService.listCriteria(specId);
    expect(stillListed.ok).toBe(true);
    if (!stillListed.ok) return;
    expect(stillListed.value.criteria.map((c) => c.id)).toContain("AC-X-1");

    const forced = await acService.removeCriterion(specId, "AC-X-1", { force: true });
    expect(forced.ok).toBe(true);
    if (!forced.ok) return;
    expect(forced.value.map((c) => c.id)).not.toContain("AC-X-1");

    const afterForce = await acService.listCriteria(specId);
    expect(afterForce.ok).toBe(true);
    if (!afterForce.ok) return;
    expect(afterForce.value.criteria.map((c) => c.id)).not.toContain("AC-X-1");
    expect(afterForce.value.dangling).toContain("AC-X-1");
  });

  it("spec.version accumulates by exactly the number of successful addCriterion calls", async () => {
    const { store, corpusService, acService } = makeServices();
    const prdId = await createPrd(corpusService);
    const specId = await createSpec(corpusService, prdId);

    const before = await store.find(specId);
    if (!before.ok || before.value === null) throw new Error("spec fetch failed");
    const versionBefore = before.value.version;

    await acService.addCriterion(specId, criterion({ id: "AC-Y-1" }));
    await acService.addCriterion(specId, criterion({ id: "AC-Y-2" }));

    const after = await store.find(specId);
    if (!after.ok || after.value === null) throw new Error("spec re-fetch failed");
    expect(after.value.version).toBe(versionBefore + 2);
  });
});

// ─── REGRESSION ───────────────────────────────────────────────────────────────

describe("REGRESSION — listCriteria's coverage null/[] distinction (no plan vs. plan-with-zero-tasks)", () => {
  it("a spec with NO child plan at all → coverage is exactly null", async () => {
    const { corpusService, acService } = makeServices();
    const prdId = await createPrd(corpusService);
    const specId = await createSpec(corpusService, prdId);
    await acService.addCriterion(specId, criterion());

    const result = await acService.listCriteria(specId);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.coverage).toBeNull();
  });

  it("a spec WITH a child plan that has zero tasks → coverage is a non-null all-zero array, one fact per declared criterion", async () => {
    const { corpusService, acService } = makeServices();
    const { specId } = await createSpecWithPlan(corpusService);
    await acService.addCriterion(specId, criterion());
    await acService.addCriterion(specId, criterion({ id: "AC-X-2" }));

    const result = await acService.listCriteria(specId);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.coverage).not.toBeNull();
    expect(result.value.coverage).toHaveLength(2);
    for (const fact of result.value.coverage ?? []) {
      expect(fact.pass).toBe(0);
      expect(fact.fail).toBe(0);
      expect(fact.refs).toEqual([]);
    }
  });
});

// ─── STATE — expected-fail evidence in AC-coverage aggregation (AC-WH-1) ────
// spec-workflow-hardening-evidence-red-vocabulary-claim-worktree §M1: AC-coverage
// aggregation (computeAcCoverage, consumed here via listCriteria) must classify
// "expected-fail" evidence as non-passing — mirrors "inconclusive"'s existing
// "satisfies neither pass nor fail filter" treatment, never counted as green.

describe("STATE — expected-fail evidence never counted as passing by AC-coverage aggregation (AC-WH-1)", () => {
  it("an AC referenced ONLY by expected-fail evidence has pass:0, fail:0, with the raw ref preserved verbatim in refs[]", async () => {
    const { store, corpusService, acService } = makeServices();
    const { specId, planId } = await createSpecWithPlan(corpusService);
    const taskId = await createTask(corpusService, planId);
    await acService.addCriterion(specId, criterion());

    const taskBefore = await store.find(taskId);
    if (!taskBefore.ok || taskBefore.value === null) throw new Error("task fetch failed");
    await store.update(taskId, {
      extra: {
        ...taskBefore.value.extra,
        verification_evidence: [
          {
            oracle: "test",
            command: "bunx vitest run red.test.ts",
            result: "expected-fail",
            recorded_at: new Date().toISOString(),
            recorded_by: "tester",
            ac_ref: "AC-X-1",
          },
        ],
      },
    });

    const result = await acService.listCriteria(specId);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const fact = result.value.coverage?.find((f) => f.ac_id === "AC-X-1");
    expect(fact).toBeDefined();
    expect(fact?.pass).toBe(0);
    expect(fact?.fail).toBe(0);
    expect(fact?.attested_pass).toBe(0);
    expect(fact?.attested_fail).toBe(0);
    expect(fact?.refs).toEqual([
      { task_id: taskId, result: "expected-fail", recorded_at: expect.any(String) },
    ]);
  });

  it("a real pass entry alongside an expected-fail entry on the same AC counts exactly one pass, never two (no accidental match)", async () => {
    const { store, corpusService, acService } = makeServices();
    const { specId, planId } = await createSpecWithPlan(corpusService);
    const taskId = await createTask(corpusService, planId);
    await acService.addCriterion(specId, criterion());

    const taskBefore = await store.find(taskId);
    if (!taskBefore.ok || taskBefore.value === null) throw new Error("task fetch failed");
    await store.update(taskId, {
      extra: {
        ...taskBefore.value.extra,
        verification_evidence: [
          {
            oracle: "test",
            command: "bunx vitest run x.test.ts",
            result: "pass",
            recorded_at: new Date().toISOString(),
            recorded_by: "tester",
            ac_ref: "AC-X-1",
          },
          {
            oracle: "test",
            command: "bunx vitest run red.test.ts",
            result: "expected-fail",
            recorded_at: new Date().toISOString(),
            recorded_by: "tester",
            ac_ref: "AC-X-1",
          },
        ],
      },
    });

    const result = await acService.listCriteria(specId);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const fact = result.value.coverage?.find((f) => f.ac_id === "AC-X-1");
    expect(fact?.pass).toBe(1);
    expect(fact?.fail).toBe(0);
    expect(fact?.refs).toHaveLength(2);
  });
});

// ─── listCriteria folds in --adhoc-governed tasks ────────────────────────────
// (task-an-ad-hoc-task-s-attested-evidence-cannot-carry-ac-ref)
//
// `findAdhocGovernedTasks` reuses `resolveGoverningSpecByAcScope` (@lore/core) —
// the SAME search VerifyRunnerService.verifyAdhocTask/CorpusService.
// resolveDeclaredAcIdsForAdhocTask run — to decide whether an ad-hoc task's
// evidence belongs to THIS spec's coverage, never a bare ac_ref string match.

describe("HAPPY — an ad-hoc task's evidence flips coverage from null to non-null with NO child plan (AC-2)", () => {
  it("a spec with zero plans but one governed ad-hoc task shows real pass/fail counts", async () => {
    const { store, corpusService, acService } = makeServices();
    const prdId = await createPrd(corpusService);
    const specId = await createSpec(corpusService, prdId);
    await acService.addCriterion(specId, criterion({ id: "AC-ADHOC-1" }));
    const taskId = await createAdhocTask(corpusService, ["AC-ADHOC-1"]);
    await recordEvidenceDirect(store, taskId, "AC-ADHOC-1", "pass");

    const result = await acService.listCriteria(specId);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.coverage).not.toBeNull();
    const fact = result.value.coverage?.find((f) => f.ac_id === "AC-ADHOC-1");
    expect(fact?.pass).toBe(1);
    expect(fact?.fail).toBe(0);
    expect(fact?.refs).toEqual([
      { task_id: taskId, result: "pass", recorded_at: expect.any(String) },
    ]);
  });
});

describe("NEGATIVE — an ad-hoc task governed by a DIFFERENT spec is never cross-counted (AC-2 correctness)", () => {
  it("an ad-hoc task whose ac_scope resolves to spec B contributes nothing to spec A's coverage", async () => {
    const { store, corpusService, acService } = makeServices();
    const prdId = await createPrd(corpusService);
    const specAId = await createSpec(corpusService, prdId, "Spec A");
    const specBId = await createSpec(corpusService, prdId, "Spec B");
    await acService.addCriterion(specAId, criterion({ id: "AC-A-1" }));
    await acService.addCriterion(specBId, criterion({ id: "AC-B-1" }));
    const taskId = await createAdhocTask(corpusService, ["AC-B-1"]);
    await recordEvidenceDirect(store, taskId, "AC-B-1", "pass");

    const resultA = await acService.listCriteria(specAId);
    expect(resultA.ok).toBe(true);
    if (!resultA.ok) return;
    // reason: spec A has zero child plans AND zero ad-hoc tasks GOVERNED by it
    // (the one ad-hoc task in this corpus is governed by spec B) — coverage
    // stays null, never a phantom non-null result contaminated by spec B's task.
    expect(resultA.value.coverage).toBeNull();

    const resultB = await acService.listCriteria(specBId);
    expect(resultB.ok).toBe(true);
    if (!resultB.ok) return;
    expect(resultB.value.coverage).not.toBeNull();
    expect(resultB.value.coverage?.find((f) => f.ac_id === "AC-B-1")?.pass).toBe(1);
  });

  it("an ad-hoc task whose ac_scope matches NO spec (or is ambiguous) is silently excluded, never an error", async () => {
    const { corpusService, acService } = makeServices();
    const prdId = await createPrd(corpusService);
    const specId = await createSpec(corpusService, prdId);
    await acService.addCriterion(specId, criterion({ id: "AC-REAL-1" }));
    await createAdhocTask(corpusService, ["AC-NOWHERE-1"]); // matches no spec at all

    const result = await acService.listCriteria(specId);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // reason: the dangling ad-hoc task's own scope never resolves to ANY spec,
    // so it contributes to no spec's coverage — this spec still has zero
    // plans/governed tasks, coverage stays null (not an error, not a crash).
    expect(result.value.coverage).toBeNull();
  });
});

describe("BOUNDARY — an ad-hoc task with no declared ac_scope contributes nothing and never errors listCriteria", () => {
  it("an ad-hoc task created with an empty ac_scope array is skipped silently", async () => {
    const { corpusService, acService } = makeServices();
    const prdId = await createPrd(corpusService);
    const specId = await createSpec(corpusService, prdId);
    await acService.addCriterion(specId, criterion({ id: "AC-BOUND-1" }));
    await createAdhocTask(corpusService, []); // declared, but empty

    const result = await acService.listCriteria(specId);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.coverage).toBeNull();
  });
});

describe("STATE — plan-owned tasks and governed ad-hoc tasks both contribute to the SAME AcCoverageFact", () => {
  it("a plan task's pass + an ad-hoc task's fail on the same AC id both land in one fact", async () => {
    const { store, corpusService, acService } = makeServices();
    const { specId, planId } = await createSpecWithPlan(corpusService);
    await acService.addCriterion(specId, criterion({ id: "AC-MIXED-1" }));
    const planTaskId = await createTask(corpusService, planId);
    await recordEvidenceDirect(store, planTaskId, "AC-MIXED-1", "pass");
    const adhocTaskId = await createAdhocTask(corpusService, ["AC-MIXED-1"]);
    await recordEvidenceDirect(store, adhocTaskId, "AC-MIXED-1", "fail");

    const result = await acService.listCriteria(specId);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const fact = result.value.coverage?.find((f) => f.ac_id === "AC-MIXED-1");
    expect(fact?.pass).toBe(1);
    expect(fact?.fail).toBe(1);
    expect(fact?.refs).toHaveLength(2);
    expect(fact?.refs.map((r) => r.task_id).sort()).toEqual([adhocTaskId, planTaskId].sort());
  });
});

describe("REGRESSION — zero plans AND zero ad-hoc tasks still yields coverage: null (pre-existing null/[] distinction)", () => {
  it("a spec with no child plan and no ad-hoc task in the whole corpus → coverage is exactly null", async () => {
    const { corpusService, acService } = makeServices();
    const prdId = await createPrd(corpusService);
    const specId = await createSpec(corpusService, prdId);
    await acService.addCriterion(specId, criterion());

    const result = await acService.listCriteria(specId);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.coverage).toBeNull();
  });
});

// ─── D8 declaration-time path-existence check (task-promote-the-oracle-file- ─
// ─── existence-primitives-into-lore, spec-oracle-executability-a-runner-s- ──
// ─── discovery-refusal-is-not-a §M6.3/D8, AC-OX-4 / AC-OX-9) ────────────────

/**
 * The FIVE measured `pass_unfalsified` script-mode commands (2026-08-10
 * corpus measurement, spec §M6.3) carrying NO extractable test-file token at
 * all — `extractTestFileTokens`/`findMissingOracleFiles` (`@lore/core`)
 * return `[]`/no-missing for every one of these regardless of what
 * `fileExists` says, which is the ASSERTED structural blind spot AC-OX-4
 * pins by name rather than hiding behind a green run.
 */
const FIVE_TOKEN_LESS_COMMANDS = [
  "bun run test",
  "bun run typecheck",
  'test $(grep -rln "TODO" packages/lore/src | wc -l) -eq 0',
  "bun run dev -- setup --dry-run --claude-dir /tmp/lore-setup-probe",
  "diff <(shasum assets/hooks/pre-push) <(shasum hooks/pre-push)",
];

describe("NEGATIVE/BOUNDARY — addCriterion declared-path-existence (AC-OX-4)", () => {
  it("refuses a script-mode command naming a nonexistent test path when pathContext is supplied", async () => {
    const { corpusService, acService } = makeServices();
    const prdId = await createPrd(corpusService);
    const specId = await createSpec(corpusService, prdId);

    const result = await acService.addCriterion(
      specId,
      criterion({
        verify: { mode: "script", oracle: "test", command: "bunx vitest run packages/x/ghost.test.ts" },
      }),
      { pathContext: { fileExists: () => false, cwd: "/repo" } },
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("VALIDATION_ERROR");
    if (result.error.code !== "VALIDATION_ERROR") return;
    expect(result.error.message).toContain("packages/x/ghost.test.ts");
  });

  it("RED control — the refusal must NOT fire when the declared path resolves", async () => {
    const { corpusService, acService } = makeServices();
    const prdId = await createPrd(corpusService);
    const specId = await createSpec(corpusService, prdId);

    const result = await acService.addCriterion(
      specId,
      criterion({
        verify: { mode: "script", oracle: "test", command: "bunx vitest run packages/x/real.test.ts" },
      }),
      { pathContext: { fileExists: (p) => p.endsWith("packages/x/real.test.ts"), cwd: "/repo" } },
    );
    expect(result.ok).toBe(true);
  });

  it.each(FIVE_TOKEN_LESS_COMMANDS)(
    "accepts unchanged the measured token-less command %s even when fileExists always returns false",
    async (command) => {
      const { corpusService, acService } = makeServices();
      const prdId = await createPrd(corpusService);
      const specId = await createSpec(corpusService, prdId);

      const result = await acService.addCriterion(
        specId,
        criterion({ verify: { mode: "script", oracle: "other", command } }),
        { pathContext: { fileExists: () => false, cwd: "/repo" } },
      );
      expect(result.ok).toBe(true);
    },
  );

  it("BOUNDARY — no pathContext supplied at all is a complete no-op (existing callers unaffected)", async () => {
    const { corpusService, acService } = makeServices();
    const prdId = await createPrd(corpusService);
    const specId = await createSpec(corpusService, prdId);

    const result = await acService.addCriterion(
      specId,
      criterion({
        verify: { mode: "script", oracle: "test", command: "bunx vitest run packages/x/ghost.test.ts" },
      }),
    );
    expect(result.ok).toBe(true);
  });
});

describe("STATE — allow-missing-path-unredeemed: the D8 escape is tracked until the file exists (AC-OX-9)", () => {
  it("addCriterion refuses --allow-missing-path with an absent or whitespace-only reason", async () => {
    const { corpusService, acService } = makeServices();
    const prdId = await createPrd(corpusService);
    const specId = await createSpec(corpusService, prdId);
    const pathContext = { fileExists: () => false, cwd: "/repo" };
    const scriptVerify = {
      mode: "script" as const,
      oracle: "test" as const,
      command: "bunx vitest run packages/x/new.test.ts",
    };

    const absentReason = await acService.addCriterion(specId, criterion({ verify: scriptVerify }), {
      pathContext,
    });
    expect(absentReason.ok).toBe(false);

    const whitespaceReason = await acService.addCriterion(specId, criterion({ verify: scriptVerify }), {
      pathContext,
      allowMissingPath: "   ",
    });
    expect(whitespaceReason.ok).toBe(false);
  });

  it("a non-empty reason unlocks the escape and the declaration counts as unredeemed while the file is absent", async () => {
    const { corpusService, acService } = makeServices();
    const prdId = await createPrd(corpusService);
    const specId = await createSpec(corpusService, prdId);
    const pathContext = { fileExists: () => false, cwd: "/repo" };

    const added = await acService.addCriterion(
      specId,
      criterion({
        verify: { mode: "script", oracle: "test", command: "bunx vitest run packages/x/new.test.ts" },
      }),
      { pathContext, allowMissingPath: "red-first — test not written yet" },
    );
    expect(added.ok).toBe(true);

    const countResult = await acService.countUnredeemedAllowMissingPath(pathContext);
    expect(countResult.ok).toBe(true);
    if (!countResult.ok) return;
    expect(countResult.value).toBe(1);
  });

  it("creating the previously-missing file drops the unredeemed count on the next read, with no further command", async () => {
    const { corpusService, acService } = makeServices();
    const prdId = await createPrd(corpusService);
    const specId = await createSpec(corpusService, prdId);
    let fileExistsNow = false;
    const pathContext = { fileExists: () => fileExistsNow, cwd: "/repo" };

    const added = await acService.addCriterion(
      specId,
      criterion({
        verify: { mode: "script", oracle: "test", command: "bunx vitest run packages/x/new.test.ts" },
      }),
      { pathContext, allowMissingPath: "red-first — test not written yet" },
    );
    expect(added.ok).toBe(true);

    const before = await acService.countUnredeemedAllowMissingPath(pathContext);
    expect(before.ok).toBe(true);
    if (!before.ok) return;
    expect(before.value).toBe(1);

    // The file comes into existence — NO further AcService command records this;
    // the count MUST be re-derived fresh from the live filesystem on the next read.
    fileExistsNow = true;

    const after = await acService.countUnredeemedAllowMissingPath(pathContext);
    expect(after.ok).toBe(true);
    if (!after.ok) return;
    expect(after.value).toBe(0);
  });

  it("REGRESSION — a declaration for a REMOVED criterion is excluded from the count (removal resolves it)", async () => {
    const { corpusService, acService } = makeServices();
    const prdId = await createPrd(corpusService);
    const specId = await createSpec(corpusService, prdId);
    const pathContext = { fileExists: () => false, cwd: "/repo" };

    await acService.addCriterion(
      specId,
      criterion({
        verify: { mode: "script", oracle: "test", command: "bunx vitest run packages/x/new.test.ts" },
      }),
      { pathContext, allowMissingPath: "red-first — test not written yet" },
    );
    const removed = await acService.removeCriterion(specId, "AC-X-1");
    expect(removed.ok).toBe(true);

    const countResult = await acService.countUnredeemedAllowMissingPath(pathContext);
    expect(countResult.ok).toBe(true);
    if (!countResult.ok) return;
    expect(countResult.value).toBe(0);
  });
});

// ─── task-promote-splitcommandsegments-to-the-one-segmentation-seam ────────
// ─── AC-061-20: SERVICE LAYER — addCriterion/setCriterion accept echo ──────
// ─── prose but still refuse a genuinely missing runner-segment path ───────
//
// `checkDeclaredPathExistence` (this file's own module) composes
// `findMissingOracleFiles` (`@lore/core`), which now scopes
// `extractTestFileTokens` to recognised RUNNER segments only. A bare test
// basename mentioned inside a human-readable `echo` success message is
// prose, not a runner argument, and must never be extracted — but a runner
// segment that genuinely names a nonexistent path must still be refused, per
// D8's own escape-hatch design (widening the check to "accept everything" is
// the false accept this AC's second half exists to rule out).
//
// RED (both halves required, per the AC's own text):
//   (a) revert `extractTestFileTokens` to a flat, unsegmented
//       `command.match(...)` over the raw string — the echo-prose case below
//       is refused again (the basename is (mis)extracted and reported
//       missing).
//   (b) point the RUNNER segment itself at a nonexistent path — the refusal
//       must still fire with the D8 `--allow-missing-path` message intact.
describe("echo-prose-not-a-path — addCriterion declared-path-existence scoped to runner segments (AC-061-20)", () => {
  it("HAPPY: accepts a declaration whose only extra path-shaped token is prose inside a success echo", async () => {
    const { corpusService, acService } = makeServices();
    const prdId = await createPrd(corpusService);
    const specId = await createSpec(corpusService, prdId);

    const result = await acService.addCriterion(
      specId,
      criterion({
        verify: {
          mode: "script",
          oracle: "test",
          command:
            "bunx vitest run packages/x/real.test.ts && echo 'ran real.test.ts successfully'",
        },
      }),
      {
        // Only the REAL runner-segment path resolves — the echo's bare
        // basename ("real.test.ts" joined onto /repo) would fail this check
        // if it were ever extracted, which is exactly what pre-fix behavior
        // did (see this describe block's RED note (a)).
        pathContext: {
          fileExists: (p) => p.endsWith("packages/x/real.test.ts"),
          cwd: "/repo",
        },
      },
    );
    expect(result.ok).toBe(true);
  });

  it("NEGATIVE/REGRESSION: still refuses when the RUNNER segment itself names a genuinely missing path, echo prose notwithstanding", async () => {
    const { corpusService, acService } = makeServices();
    const prdId = await createPrd(corpusService);
    const specId = await createSpec(corpusService, prdId);

    const result = await acService.addCriterion(
      specId,
      criterion({
        verify: {
          mode: "script",
          oracle: "test",
          command: "bunx vitest run packages/x/ghost.test.ts && echo 'done, no test named here'",
        },
      }),
      { pathContext: { fileExists: () => false, cwd: "/repo" } },
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("VALIDATION_ERROR");
    if (result.error.code !== "VALIDATION_ERROR") return;
    expect(result.error.message).toContain("packages/x/ghost.test.ts");
  });

  it("BOUNDARY: an echo mentioning the SAME basename as a genuinely-missing runner-segment path still refuses, naming the real path", async () => {
    const { corpusService, acService } = makeServices();
    const prdId = await createPrd(corpusService);
    const specId = await createSpec(corpusService, prdId);

    const result = await acService.addCriterion(
      specId,
      criterion({
        verify: {
          mode: "script",
          oracle: "test",
          command:
            "bunx vitest run packages/x/ghost.test.ts && echo 'expected ghost.test.ts to exist'",
        },
      }),
      { pathContext: { fileExists: () => false, cwd: "/repo" } },
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("VALIDATION_ERROR");
    if (result.error.code !== "VALIDATION_ERROR") return;
    // The refusal names the REAL runner-segment path, not the echo's bare
    // basename (which is never even extracted post-fix).
    expect(result.error.message).toContain("packages/x/ghost.test.ts");
  });
});
