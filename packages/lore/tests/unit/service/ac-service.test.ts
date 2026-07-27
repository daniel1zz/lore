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
 * @spec_ref AC-ACODE-2 AC-ACODE-3 AC-ACODE-7
 */

import { describe, it, expect } from "vitest";
import { InMemoryStore } from "../../../src/store/in-memory-store.js";
import { CorpusService } from "../../../src/service/corpus-service.js";
import { AcService } from "../../../src/service/ac-service.js";
import type { CreateDocInput } from "@lore/core";

// ─── Fixture helpers ──────────────────────────────────────────────────────────

function makeServices() {
  const store = new InMemoryStore();
  const corpusService = new CorpusService(store);
  const acService = new AcService(store);
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
    parent_id: parentId,
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
    expect(fact?.refs).toEqual([{ task_id: taskId, result: "expected-fail" }]);
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
